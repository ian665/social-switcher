const serviceList = document.querySelector('#serviceList');
const serviceTitle = document.querySelector('#serviceTitle');
const accountList = document.querySelector('#accountList');
const emptyState = document.querySelector('#emptyState');
const addButton = document.querySelector('#addAccount');
const accountSectionLabel = document.querySelector('#accountSectionLabel');
const socialToolbar = document.querySelector('#socialToolbar');
const projectSidebar = document.querySelector('#projectSidebar');
const projectSidebarCount = document.querySelector('#projectSidebarCount');
const projectSidebarTime = document.querySelector('#projectSidebarTime');
const projectDashboard = document.querySelector('#projectDashboard');
const projectRootLabel = document.querySelector('#projectRootLabel');
const projectStats = document.querySelector('#projectStats');
const projectGrid = document.querySelector('#projectGrid');
const projectError = document.querySelector('#projectError');
const projectEmpty = document.querySelector('#projectEmpty');
const chooseProjectRootButton = document.querySelector('#chooseProjectRoot');
const refreshProjectsButton = document.querySelector('#refreshProjects');
const backdrop = document.querySelector('#dialogBackdrop');
const dialog = document.querySelector('#accountDialog');
const dialogTitle = document.querySelector('#dialogTitle');
const dialogHint = document.querySelector('#dialogHint');
const nameInput = document.querySelector('#accountName');
const cancelButton = document.querySelector('#cancelDialog');
const workModePanel = document.querySelector('#workModePanel');
const workModeToggle = document.querySelector('#workModeToggle');
const workModeStatus = document.querySelector('#workModeStatus');
const loginButton = document.querySelector('#login');
const chatButton = document.querySelector('#chat');

let state = {
  services: [],
  accounts: [],
  activeAccountId: null,
  activeServiceId: 'threads',
  projects: { root: null, items: [], refreshedAt: null, refreshing: false, error: null },
};
let dialogMode = 'add';
let editingId = null;

function activeService() {
  return state.services.find((service) => service.id === state.activeServiceId);
}

function activeAccount() {
  return state.accounts.find((account) => account.id === state.activeAccountId);
}

function isProjectView() {
  return state.activeServiceId === 'projects';
}

function relativeTime(value) {
  if (!value) return '尚無紀錄';
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff)) return '時間未知';
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function closeMenus() {
  document.querySelectorAll('.context-menu').forEach((menu) => menu.remove());
}

async function openDialog(mode, account = null) {
  closeMenus();
  dialogMode = mode;
  editingId = account?.id || null;
  const service = activeService();
  dialogTitle.textContent = mode === 'add' ? `新增 ${service?.label || ''} 帳號` : '重新命名';
  dialogHint.textContent = mode === 'add'
    ? `建立獨立登入空間後，請在右側登入 ${service?.label || '社群平台'}。`
    : '這只會修改左側顯示名稱。';
  nameInput.value = account?.name || '';
  await window.threadsApp.setOverlayVisible(true);
  backdrop.classList.remove('hidden');
  setTimeout(() => nameInput.focus(), 0);
}

async function closeDialog() {
  if (backdrop.classList.contains('hidden')) return;
  backdrop.classList.add('hidden');
  nameInput.value = '';
  editingId = null;
  await window.threadsApp.setOverlayVisible(false);
}

function showAccountMenu(account, anchor) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 142)}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 84)}px`;

  const rename = document.createElement('button');
  rename.textContent = '重新命名';
  rename.addEventListener('click', () => openDialog('rename', account));
  const remove = document.createElement('button');
  remove.className = 'danger';
  remove.textContent = '移除帳號';
  remove.addEventListener('click', async () => {
    closeMenus();
    if (confirm(`要移除「${account.name}」嗎？此帳號的本機登入資料會一併清除。`)) {
      await window.threadsApp.removeAccount(account.id);
    }
  });
  menu.append(rename, remove);
  document.body.append(menu);
}

function renderServices() {
  serviceList.replaceChildren();
  for (const service of state.services) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `service-button service-${service.id}${service.id === state.activeServiceId ? ' active' : ''}`;
    button.title = service.label;
    button.setAttribute('aria-label', service.label);
    const mark = document.createElement('span');
    mark.textContent = service.shortLabel;
    const dot = document.createElement('i');
    button.append(mark, dot);
    button.addEventListener('click', () => window.threadsApp.selectService(service.id));
    serviceList.append(button);
  }
}

function renderAccounts() {
  accountList.replaceChildren();
  const service = activeService();
  serviceTitle.textContent = service?.label || 'Social';
  const visibleAccounts = state.accounts.filter((account) => account.service === state.activeServiceId);
  emptyState.classList.toggle('hidden', visibleAccounts.length > 0);

  for (const account of visibleAccounts) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `account${account.id === state.activeAccountId ? ' active' : ''}`;
    row.addEventListener('click', () => window.threadsApp.activateAccount(account.id));
    const avatar = document.createElement('span');
    avatar.className = `avatar avatar-${account.service}`;
    avatar.textContent = account.name.slice(0, 1).toUpperCase();
    const name = document.createElement('span');
    name.className = 'account-name';
    name.textContent = account.name;
    const menu = document.createElement('span');
    menu.className = 'menu-button';
    menu.textContent = account.loading ? '' : '•••';
    if (account.loading) {
      menu.classList.add('loading-indicator');
      menu.setAttribute('aria-label', '載入中');
    }
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!account.loading) showAccountMenu(account, menu);
    });
    row.append(avatar, name, menu);
    accountList.append(row);
  }
}

function renderProjectCard(project) {
  const card = document.createElement('article');
  card.className = 'project-card';

  const top = document.createElement('header');
  top.className = 'project-card-top';
  const heading = document.createElement('div');
  heading.className = 'thread-heading';
  heading.append(
    createTextElement('span', 'thread-kicker', '在做什麼'),
    createTextElement('h2', '', project.name),
  );
  const badges = document.createElement('div');
  badges.className = 'thread-badges';
  const status = createTextElement('span', 'thread-status', project.status?.label || '待續');
  status.dataset.status = project.status?.key || 'idle';
  badges.append(
    status,
    createTextElement('span', 'thread-age', relativeTime(project.updatedAt)),
  );
  top.append(heading, badges);

  const purpose = document.createElement('section');
  purpose.className = 'thread-detail thread-purpose';
  purpose.append(createTextElement('p', '', project.summary));

  const progress = document.createElement('section');
  progress.className = 'thread-detail thread-progress';
  progress.append(
    createTextElement('span', 'thread-detail-label', '最新進度'),
    createTextElement('p', '', project.latestUpdate || '還沒有可整理的後續進度。'),
  );

  const request = document.createElement('section');
  request.className = 'thread-detail thread-request';
  request.append(
    createTextElement('span', 'thread-detail-label', '目前要求'),
    createTextElement('p', '', project.latestRequest || '目前沒有新的要求。'),
  );

  const meta = document.createElement('div');
  meta.className = 'project-meta';
  meta.append(
    createTextElement('span', '', project.model || 'Codex'),
    createTextElement('span', '', project.pinned ? '已釘選' : 'Codex 對話'),
  );

  card.append(top, purpose, progress, request, meta);
  return card;
}

function renderProjects() {
  const projects = state.projects || { items: [] };
  const items = projects.items || [];
  const visible = isProjectView();
  projectDashboard.classList.toggle('hidden', !visible);
  projectSidebar.classList.toggle('hidden', !visible);
  accountSectionLabel.classList.toggle('hidden', visible);
  accountList.classList.toggle('hidden', visible);
  emptyState.classList.toggle('hidden', visible || state.accounts.some((account) => account.service === state.activeServiceId));
  addButton.classList.toggle('hidden', visible);
  socialToolbar.classList.toggle('hidden', visible);

  if (!visible) return;
  projectRootLabel.textContent = projects.root || '尚未選擇專案資料夾';
  projectRootLabel.title = projects.root || '';
  projectSidebarCount.textContent = `${items.length} 個對話`;
  projectSidebarTime.textContent = projects.refreshedAt ? `更新於 ${relativeTime(projects.refreshedAt)}` : '尚未更新';
  refreshProjectsButton.disabled = Boolean(projects.refreshing);
  refreshProjectsButton.classList.toggle('loading', Boolean(projects.refreshing));
  refreshProjectsButton.lastChild.textContent = projects.refreshing ? '更新中' : ' 更新對話';

  const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const todayCutoff = Date.now() - (24 * 60 * 60 * 1000);
  const activeCount = items.filter((project) => project.updatedAt && Date.parse(project.updatedAt) >= recentCutoff).length;
  const todayCount = items.filter((project) => project.updatedAt && Date.parse(project.updatedAt) >= todayCutoff).length;
  const trackedCount = items.filter((project) => project.latestUpdate).length;

  projectStats.replaceChildren();
  for (const [label, value, detail] of [
    ['專案對話', items.length, '這個 Project 裡'],
    ['本週有更新', activeCount, '最近 7 天'],
    ['今天有更新', todayCount, '最近 24 小時'],
    ['已有進度摘要', trackedCount, '可追蹤後續變化'],
  ]) {
    const stat = document.createElement('article');
    stat.append(
      createTextElement('span', '', label),
      createTextElement('strong', '', String(value)),
      createTextElement('small', '', detail),
    );
    projectStats.append(stat);
  }

  projectError.textContent = projects.error || '';
  projectError.classList.toggle('hidden', !projects.error);
  projectEmpty.classList.toggle('hidden', Boolean(projects.error) || items.length > 0 || projects.refreshing);
  projectGrid.replaceChildren(...items.map(renderProjectCard));
}

function renderControls() {
  const service = activeService();
  const account = activeAccount();
  const supportsWorkMode = Boolean(service?.supportsWorkMode && account);
  const workModeEnabled = Boolean(account?.workMode);

  workModePanel.classList.toggle('hidden', !supportsWorkMode);
  workModeToggle.classList.toggle('active', workModeEnabled);
  workModeToggle.setAttribute('aria-checked', String(workModeEnabled));
  workModeStatus.textContent = workModeEnabled
    ? '已隱藏圖片、影片與限時動態'
    : '顯示完整內容';
  loginButton.classList.toggle('hidden', !service?.hasLogin);
  chatButton.classList.toggle('hidden', !service?.hasChat);
}

function render(nextState) {
  state = nextState;
  renderServices();
  renderAccounts();
  renderControls();
  renderProjects();
}

addButton.addEventListener('click', () => openDialog('add'));
cancelButton.addEventListener('click', closeDialog);
backdrop.addEventListener('click', (event) => {
  if (event.target === backdrop) closeDialog();
});
dialog.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return nameInput.focus();
  if (dialogMode === 'add') await window.threadsApp.addAccount(name, state.activeServiceId);
  else await window.threadsApp.renameAccount(editingId, name);
  await closeDialog();
});
document.querySelector('#reload').addEventListener('click', () => window.threadsApp.reload());
document.querySelector('#home').addEventListener('click', () => window.threadsApp.home());
loginButton.addEventListener('click', () => window.threadsApp.login());
chatButton.addEventListener('click', () => window.threadsApp.chat());
workModeToggle.addEventListener('click', () => {
  const account = activeAccount();
  if (account) window.threadsApp.setWorkMode(account.id, !account.workMode);
});
chooseProjectRootButton.addEventListener('click', () => window.threadsApp.chooseProjectRoot());
refreshProjectsButton.addEventListener('click', () => window.threadsApp.refreshProjects());
document.addEventListener('click', (event) => {
  if (!event.target.closest('.context-menu') && !event.target.closest('.menu-button')) closeMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenus();
    closeDialog();
  }
});

window.threadsApp.onState(render);
window.threadsApp.listAccounts().then(render);
