const { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { listCodexThreads } = require('./codex-thread-client');

// 即使產品升級為 Social Switcher，仍沿用舊版資料目錄與登入 session。
app.setPath('userData', path.join(app.getPath('appData'), 'threads-switcher'));

const SIDEBAR_WIDTH = 272;
const SERVICES = {
  projects: {
    id: 'projects', label: '專案對話', shortLabel: 'P', local: true,
  },
  threads: {
    id: 'threads', label: 'Threads', shortLabel: '@', url: 'https://www.threads.com/', homeUrl: 'https://www.threads.com/', domains: ['threads.com', 'instagram.com', 'facebook.com'],
  },
  reddit: {
    id: 'reddit', label: 'Reddit', shortLabel: 'r/', url: 'https://www.reddit.com/', homeUrl: 'https://www.reddit.com/', domains: ['reddit.com', 'redd.it'],
  },
  x: {
    id: 'x', label: 'X', shortLabel: 'X', url: 'https://x.com/home', homeUrl: 'https://x.com/home', domains: ['x.com', 'twitter.com'],
  },
  dcard: {
    id: 'dcard', label: 'Dcard', shortLabel: 'D', url: 'https://www.dcard.tw/f', homeUrl: 'https://www.dcard.tw/f', domains: ['dcard.tw'],
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    shortLabel: 'IG',
    url: 'https://www.instagram.com/direct/inbox/',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    homeUrl: 'https://www.instagram.com/',
    chatUrl: 'https://www.instagram.com/direct/inbox/',
    domains: ['instagram.com', 'facebook.com'],
    supportsWorkMode: true,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    shortLabel: 'f',
    url: 'https://www.facebook.com/',
    loginUrl: 'https://www.facebook.com/login/',
    homeUrl: 'https://www.facebook.com/',
    chatUrl: 'https://www.facebook.com/messages/',
    domains: ['facebook.com', 'fb.com', 'messenger.com'],
    supportsWorkMode: true,
  },
};

// 上班模式只影響顯示：保留文字與聊天控制，隱藏容易被旁人看到的媒體內容。
const WORK_MODE_CSS = `
  img, picture, video, canvas, svg image,
  [role="img"][aria-label*="profile" i],
  [role="img"][aria-label*="個人檔案"],
  [role="img"][aria-label*="大頭貼"],
  [role="img"][aria-label*="相片"],
  [role="img"][aria-label*="圖片"] {
    visibility: hidden !important;
    opacity: 0 !important;
  }
  video {
    display: none !important;
  }
  [style*="background-image"], [style*="background: url"] {
    background-image: none !important;
  }
  a[href*="/stories/"], a[href*="/reel/"], a[href*="/reels/"],
  [aria-label*="Stories"], [aria-label*="Reels"],
  [aria-label*="限時動態"], [aria-label*="連續短片"] {
    display: none !important;
  }
`;

let mainWindow;
let activeAccountId = null;
let activeServiceId = 'threads';
let overlayVisible = false;
let accounts = [];
let projectRoot = null;
let projectState = { items: [], refreshedAt: null, refreshing: false, error: null };
const accountViews = new Map();
const workModeCssKeys = new Map();
const loadingAccounts = new Set();
const lastAccountByService = new Map();

function accountsFile() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function serviceList() {
  return Object.values(SERVICES).map(({ id, label, shortLabel, local, loginUrl, chatUrl, supportsWorkMode }) => ({
    id,
    label,
    shortLabel,
    local: Boolean(local),
    hasLogin: Boolean(loginUrl),
    hasChat: Boolean(chatUrl),
    supportsWorkMode: Boolean(supportsWorkMode),
  }));
}

async function loadProjectSettings() {
  try {
    const settings = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    projectRoot = typeof settings.projectRoot === 'string' ? settings.projectRoot : null;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to load settings:', error);
  }

  // 開發版第一次啟動時，自動指向目前工作區；安裝版則沿用已儲存的位置。
  if (!projectRoot && !__dirname.includes('app.asar')) {
    projectRoot = path.resolve(__dirname, '..', '..');
    await saveProjectSettings();
  }
}

async function saveProjectSettings() {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify({ projectRoot }, null, 2), 'utf8');
}

async function loadAccounts() {
  try {
    const raw = await fs.readFile(accountsFile(), 'utf8');
    const parsed = JSON.parse(raw);
    // 舊版資料沒有 service；自動歸入 Threads，保留既有登入狀態。
    accounts = Array.isArray(parsed)
      ? parsed
        .map((account) => ({
          ...account,
          service: account.service || 'threads',
          workMode: Boolean(account.workMode),
        }))
        .filter((account) => SERVICES[account.service])
      : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to load accounts:', error);
    accounts = [];
  }
}

async function saveAccounts() {
  await fs.mkdir(path.dirname(accountsFile()), { recursive: true });
  await fs.writeFile(accountsFile(), JSON.stringify(accounts, null, 2), 'utf8');
}

function publicAccounts() {
  return accounts.map(({ id, name, service, workMode }) => ({
    id,
    name,
    service,
    workMode: Boolean(workMode),
    loading: loadingAccounts.has(id),
  }));
}

function accountPartition(account) {
  // Threads 沿用舊版 partition 名稱，避免升級後登出。
  if (account.service === 'threads') return `persist:threads-account-${account.id}`;
  return `persist:${account.service}-account-${account.id}`;
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function servicePageUrl(service, candidateUrl) {
  if (!service?.homeUrl || !candidateUrl) return null;
  try {
    const candidate = new URL(candidateUrl);
    const home = new URL(service.homeUrl);
    if (candidate.protocol !== 'https:' || !hostMatches(candidate.hostname, home.hostname.replace(/^www\./, ''))) {
      return null;
    }
    return candidate.href;
  } catch {
    return null;
  }
}

function keepAccountOnServicePage(account, view, preferredUrl = null) {
  const service = SERVICES[account.service];
  if (!service?.url || !view || view.webContents.isDestroyed()) return;

  // 同平台換帳號時沿用目前頁面；若曾被登入流程帶到其他網站，則回到該平台首頁。
  const destination = servicePageUrl(service, preferredUrl) || service.url;
  const current = servicePageUrl(service, view.webContents.getURL());
  if (current !== destination) {
    view.webContents.loadURL(destination).catch((error) => {
      console.error('Unable to keep account on service page:', error);
    });
  }
}

function layoutActiveView() {
  const view = accountViews.get(activeAccountId);
  if (!mainWindow || !view) return;
  const [width, height] = mainWindow.getContentSize();
  view.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, width - SIDEBAR_WIDTH), height });
}

function currentState() {
  return {
    services: serviceList(),
    accounts: publicAccounts(),
    activeAccountId,
    activeServiceId,
    projects: { root: projectRoot, ...projectState },
  };
}

function sendState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('accounts:state', currentState());
}

async function applyWorkMode(account) {
  const view = accountViews.get(account.id);
  if (!view || view.webContents.isDestroyed()) return;

  const oldKey = workModeCssKeys.get(account.id);
  if (oldKey) {
    try {
      await view.webContents.removeInsertedCSS(oldKey);
    } catch {}
    workModeCssKeys.delete(account.id);
  }

  if (account.workMode && SERVICES[account.service]?.supportsWorkMode) {
    try {
      const key = await view.webContents.insertCSS(WORK_MODE_CSS);
      workModeCssKeys.set(account.id, key);
    } catch (error) {
      console.error('Unable to apply work mode:', error);
    }
  }
}

function createAccountView(account) {
  if (accountViews.has(account.id)) return accountViews.get(account.id);
  const service = SERVICES[account.service];
  const view = new WebContentsView({
    webPreferences: {
      partition: accountPartition(account),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  view.setBackgroundColor('#0a0a0a');
  view.webContents.on('did-start-loading', () => {
    loadingAccounts.add(account.id);
    sendState();
  });
  const markLoaded = () => {
    loadingAccounts.delete(account.id);
    sendState();
  };
  view.webContents.on('dom-ready', () => {
    markLoaded();
    applyWorkMode(account);
  });
  view.webContents.on('did-finish-load', markLoaded);
  view.webContents.on('did-stop-loading', markLoaded);
  view.webContents.on('did-fail-load', markLoaded);
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const host = new URL(url).hostname;
      const serviceDomain = service.domains.some((domain) => hostMatches(host, domain));
      const loginDomain = ['accounts.google.com', 'appleid.apple.com'].some((domain) => hostMatches(host, domain));
      if (serviceDomain || loginDomain) return { action: 'allow' };
    } catch {}
    shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.loadURL(service.url);
  accountViews.set(account.id, view);
  return view;
}

function activateAccount(id) {
  const account = accounts.find((item) => item.id === id);
  if (!account || !mainWindow) return false;
  const previousAccount = accounts.find((item) => item.id === activeAccountId);
  const oldView = accountViews.get(activeAccountId);
  const previousPage = previousAccount?.service === account.service
    ? servicePageUrl(SERVICES[account.service], oldView?.webContents.getURL())
    : null;
  if (oldView) mainWindow.contentView.removeChildView(oldView);

  const view = createAccountView(account);
  keepAccountOnServicePage(account, view, previousPage);
  activeAccountId = id;
  activeServiceId = account.service;
  lastAccountByService.set(account.service, account.id);
  if (!overlayVisible) {
    mainWindow.contentView.addChildView(view);
    layoutActiveView();
    view.webContents.focus();
  }
  sendState();
  return true;
}

async function selectService(serviceId) {
  if (!SERVICES[serviceId]) return false;
  if (SERVICES[serviceId].local) {
    const oldView = accountViews.get(activeAccountId);
    if (oldView && mainWindow) mainWindow.contentView.removeChildView(oldView);
    activeAccountId = null;
    activeServiceId = serviceId;
    sendState();
    if (!projectState.refreshedAt && !projectState.refreshing) await refreshProjects();
    return true;
  }
  activeServiceId = serviceId;
  const serviceAccounts = accounts.filter((account) => account.service === serviceId);
  const rememberedId = lastAccountByService.get(serviceId);
  const target = serviceAccounts.find((account) => account.id === rememberedId) || serviceAccounts[0];
  if (target) return activateAccount(target.id);
  await addAccount(`${SERVICES[serviceId].label} 帳號`, serviceId);
  return true;
}

function setOverlayVisible(visible) {
  overlayVisible = Boolean(visible);
  const view = accountViews.get(activeAccountId);
  if (!mainWindow || !view) return;
  if (overlayVisible) {
    // WebContentsView 永遠位於網頁介面上層；顯示表單時先暫時移除。
    mainWindow.contentView.removeChildView(view);
    mainWindow.webContents.focus();
  } else {
    mainWindow.contentView.addChildView(view);
    layoutActiveView();
    view.webContents.focus();
  }
}

async function addAccount(name, requestedServiceId) {
  const serviceId = SERVICES[requestedServiceId] ? requestedServiceId : activeServiceId;
  if (SERVICES[serviceId]?.local) return false;
  const serviceAccounts = accounts.filter((account) => account.service === serviceId);
  const cleanName = String(name || '').trim().slice(0, 30);
  const account = {
    id: crypto.randomUUID(),
    name: cleanName || `${SERVICES[serviceId].label} 帳號 ${serviceAccounts.length + 1}`,
    service: serviceId,
    workMode: false,
  };
  accounts.push(account);
  await saveAccounts();
  activateAccount(account.id);
  return account;
}

async function setWorkMode(id, enabled) {
  const account = accounts.find((item) => item.id === id);
  if (!account || !SERVICES[account.service]?.supportsWorkMode) return false;
  account.workMode = Boolean(enabled);
  await saveAccounts();
  await applyWorkMode(account);
  sendState();
  return true;
}

async function removeAccount(id) {
  const index = accounts.findIndex((item) => item.id === id);
  if (index === -1) return false;
  const removed = accounts[index];
  const view = accountViews.get(id);
  if (view) {
    if (activeAccountId === id) mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    accountViews.delete(id);
    workModeCssKeys.delete(id);
  }

  await session.fromPartition(accountPartition(removed)).clearStorageData();
  accounts.splice(index, 1);
  loadingAccounts.delete(id);
  lastAccountByService.delete(removed.service);
  activeAccountId = null;
  await saveAccounts();
  const replacement = accounts.find((account) => account.service === removed.service);
  if (replacement) activateAccount(replacement.id);
  else sendState();
  return true;
}

async function renameAccount(id, name) {
  const account = accounts.find((item) => item.id === id);
  const cleanName = String(name || '').trim().slice(0, 30);
  if (!account || !cleanName) return false;
  account.name = cleanName;
  await saveAccounts();
  sendState();
  return true;
}

async function refreshProjects() {
  if (!projectRoot) {
    projectState = { items: [], refreshedAt: null, refreshing: false, error: '請先選擇存放專案的資料夾' };
    sendState();
    return projectState;
  }

  projectState = { ...projectState, refreshing: true, error: null };
  sendState();
  try {
    // 使用 Codex 對話的真實標題與狀態，不再從資料夾名稱推測專案名稱或完成度。
    const items = await listCodexThreads(projectRoot);
    projectState = { items, refreshedAt: new Date().toISOString(), refreshing: false, error: null };
  } catch (error) {
    projectState = { ...projectState, refreshing: false, error: error.message || '無法讀取 Codex 對話' };
  }
  sendState();
  return projectState;
}

async function chooseProjectRoot() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇專案資料夾',
    defaultPath: projectRoot || app.getPath('documents'),
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return currentState();
  projectRoot = path.resolve(result.filePaths[0]);
  await saveProjectSettings();
  projectState = { items: [], refreshedAt: null, refreshing: false, error: null };
  await refreshProjects();
  return currentState();
}

async function createWindow() {
  await Promise.all([loadAccounts(), loadProjectSettings()]);
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0a0a0a',
    title: 'Social Switcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('resize', layoutActiveView);
  mainWindow.on('closed', () => {
    mainWindow = null;
    activeAccountId = null;
    accountViews.clear();
    workModeCssKeys.clear();
  });

  if (accounts.length === 0) await addAccount('主要帳號', 'threads');
  else {
    accounts.forEach(createAccountView);
    activateAccount(accounts[0].id);
  }
}

ipcMain.handle('accounts:list', () => currentState());
ipcMain.handle('services:select', (_event, serviceId) => selectService(serviceId));
ipcMain.handle('accounts:add', (_event, name, serviceId) => addAccount(name, serviceId));
ipcMain.handle('accounts:activate', (_event, id) => activateAccount(id));
ipcMain.handle('accounts:rename', (_event, id, name) => renameAccount(id, name));
ipcMain.handle('accounts:remove', (_event, id) => removeAccount(id));
ipcMain.handle('accounts:set-work-mode', (_event, id, enabled) => setWorkMode(id, enabled));
ipcMain.handle('projects:refresh', () => refreshProjects());
ipcMain.handle('projects:choose-root', () => chooseProjectRoot());
ipcMain.handle('ui:set-overlay', (_event, visible) => setOverlayVisible(visible));
ipcMain.handle('page:reload', () => accountViews.get(activeAccountId)?.webContents.reload());
ipcMain.handle('page:home', () => {
  const account = accounts.find((item) => item.id === activeAccountId);
  if (account) accountViews.get(activeAccountId)?.webContents.loadURL(SERVICES[account.service].homeUrl);
});
ipcMain.handle('page:login', () => {
  const account = accounts.find((item) => item.id === activeAccountId);
  const loginUrl = account && SERVICES[account.service].loginUrl;
  if (loginUrl) accountViews.get(activeAccountId)?.webContents.loadURL(loginUrl);
});
ipcMain.handle('page:chat', () => {
  const account = accounts.find((item) => item.id === activeAccountId);
  const chatUrl = account && SERVICES[account.service].chatUrl;
  if (chatUrl) accountViews.get(activeAccountId)?.webContents.loadURL(chatUrl);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
