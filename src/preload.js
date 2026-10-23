const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('threadsApp', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  selectService: (serviceId) => ipcRenderer.invoke('services:select', serviceId),
  addAccount: (name, serviceId) => ipcRenderer.invoke('accounts:add', name, serviceId),
  activateAccount: (id) => ipcRenderer.invoke('accounts:activate', id),
  renameAccount: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  setWorkMode: (id, enabled) => ipcRenderer.invoke('accounts:set-work-mode', id, enabled),
  refreshProjects: () => ipcRenderer.invoke('projects:refresh'),
  chooseProjectRoot: () => ipcRenderer.invoke('projects:choose-root'),
  setOverlayVisible: (visible) => ipcRenderer.invoke('ui:set-overlay', visible),
  reload: () => ipcRenderer.invoke('page:reload'),
  home: () => ipcRenderer.invoke('page:home'),
  login: () => ipcRenderer.invoke('page:login'),
  chat: () => ipcRenderer.invoke('page:chat'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('accounts:state', listener);
    return () => ipcRenderer.removeListener('accounts:state', listener);
  },
});
