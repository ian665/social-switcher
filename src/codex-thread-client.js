const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUEST_TIMEOUT_MS = 15000;
const LOG_TAIL_BYTES = 3 * 1024 * 1024;

function findCodexExecutable() {
  const candidates = [
    process.env.SOCIAL_SWITCHER_CODEX_PATH,
    // 新版 ChatGPT 將 Codex CLI 包在獨立的 CodexCLI.app 內。
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean);

  const executable = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

  if (!executable) {
    throw new Error('找不到 Codex。請先安裝或開啟 ChatGPT／Codex 桌面版。');
  }
  return executable;
}

function cleanText(value, limit = 220) {
  let text = String(value || '')
    .replace(/^\s*(?:#+\s*)?Files mentioned by the user:[\s\S]*?(?:#+\s*)?My request:\s*/i, '')
    .replace(/^\s*(?:#+\s*)?Referenced ChatGPT conversation:[\s\S]*?(?:#+\s*)?My request:\s*/i, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, '')
    .replace(/<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/gi, '')
    .replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi, '')
    .replace(/:::writing\{[^}]+}/gi, '')
    .replace(/:::/g, '')
    .replace(/^\s*(?:#+\s*)?My request:\s*/i, '')
    .replace(/!\[([^\]]*)]\([^\s)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
    .replace(/:[a-z-]+\{[^}]+}/gi, '')
    .replace(/[\*_`]+/g, '')
    .replace(/^[#>*`\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 某些瀏覽器操作內容可能在預覽中被截斷，避免把內部環境標記顯示給使用者。
  if (text.includes('<in-app-browser-context')) text = '這是一個需要操作網頁的專案對話。';
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
}

function cleanPreview(value) {
  return cleanText(value, 180) || '這個對話目前沒有可顯示的說明。';
}

function messageContentText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => item?.text || '')
    .filter(Boolean)
    .join(' ');
}

function isUsefulUserText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^\s*(?:#+\s*)?(Applications|Files) mentioned by the user:/i.test(text) || /<appshot\b/i.test(text)) return false;
  return !/^<(environment_context|external_codex_apps_open_page|codex_apps_open_page_instructions)\b/i.test(text);
}

async function readLogTail(filePath) {
  if (!filePath) return '';
  let handle;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString('utf8');
    if (size > length) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readRecentThreadContext(filePath) {
  const log = await readLogTail(filePath);
  let latestRequest = '';
  let latestUpdate = '';

  for (const line of log.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === 'response_item' && record.payload?.type === 'message') {
      const { role, content, phase } = record.payload;
      const text = messageContentText(content);
      if (role === 'user') {
        const cleanedRequest = cleanText(text, 145);
        if (isUsefulUserText(cleanedRequest)) latestRequest = cleanedRequest;
      }
      if (role === 'assistant' && ['commentary', 'final_answer', 'final'].includes(phase)) {
        latestUpdate = cleanText(text, 190);
      }
    }

    const item = record.type === 'event_msg' && record.payload?.type === 'item_completed'
      ? record.payload.item
      : null;
    if (item?.type === 'AgentMessage' && ['commentary', 'final_answer', 'final'].includes(item.phase)) {
      latestUpdate = cleanText(messageContentText(item.content), 190);
    }
  }

  return { latestRequest, latestUpdate };
}

function statusDetails(status = {}) {
  const type = status.type || 'notLoaded';
  const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
  const needsAction = flags.some((flag) => /approval|user.?input|waiting/i.test(String(flag)));

  if (needsAction) return { key: 'attention', label: '等你處理', needsAction: true };
  if (type === 'active') return { key: 'active', label: '進行中', needsAction: false };
  if (type === 'systemError') return { key: 'error', label: '發生錯誤', needsAction: true };
  return { key: 'idle', label: '待續', needsAction: false };
}

function normalizeThread(thread) {
  const status = statusDetails(thread.status);
  return {
    id: thread.id,
    name: String(thread.name || '').trim() || cleanPreview(thread.preview).slice(0, 48) || '未命名對話',
    summary: cleanPreview(thread.preview),
    updatedAt: thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null,
    createdAt: thread.createdAt ? new Date(thread.createdAt * 1000).toISOString() : null,
    model: thread.model || null,
    pinned: Boolean(thread.isPinned),
    cwd: thread.cwd || null,
    status,
  };
}

function createRpcClient(child) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();

  const failPending = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || 'Codex 回傳錯誤'));
      else request.resolve(message.result);
    }
  });
  child.on('error', (error) => failPending(error));
  child.on('exit', (code) => {
    if (pending.size) failPending(new Error(`Codex 連線已中斷（${code ?? '未知'}）`));
  });

  const send = (message) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  return {
    notify(method, params) {
      send(params === undefined ? { method } : { method, params });
    },
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('讀取 Codex 對話逾時，請稍後再試。'));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    },
  };
}

async function listCodexThreads(projectRoot) {
  const executable = findCodexExecutable();
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const rpc = createRpcClient(child);

  try {
    await rpc.request('initialize', {
      clientInfo: { name: 'social_switcher', title: 'Social Switcher', version: '0.5.0' },
      capabilities: { experimentalApi: false },
    });
    rpc.notify('initialized');

    const result = await rpc.request('thread/list', {
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      cwd: path.resolve(projectRoot),
    });
    if (!Array.isArray(result?.data)) return [];
    return Promise.all(result.data.map(async (thread) => ({
      ...normalizeThread(thread),
      ...await readRecentThreadContext(thread.path),
    })));
  } finally {
    child.stdin.end();
    if (!child.killed) child.kill();
  }
}

module.exports = { cleanText, listCodexThreads, normalizeThread, readRecentThreadContext };
