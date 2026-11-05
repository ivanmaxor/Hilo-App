import { contextBridge, ipcRenderer } from 'electron';

type Listener = (...args: never[]) => void;

function subscribe(channel: string, cb: Listener): () => void {
  const fn = (_event: unknown, ...args: unknown[]) => (cb as (...a: unknown[]) => void)(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

/** API mínima. Sin acceso a ipcRenderer ni a nada de Node desde la página. */
const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: (action: unknown) => ipcRenderer.invoke('state:dispatch', action),
  wake: (id: string, cols: number, rows: number) => ipcRenderer.invoke('session:wake', id, cols, rows),
  sleep: (id: string) => ipcRenderer.invoke('session:sleep', id),
  background: (id: string) => ipcRenderer.invoke('session:background', id),
  removeSession: (id: string) => ipcRenderer.invoke('session:remove', id),
  removeProject: (id: string) => ipcRenderer.invoke('session:removeProject', id),
  write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  ack: (id: string, chars: number) => ipcRenderer.send('pty:ack', id, chars),
  setView: (visible: string[], focused: boolean) => ipcRenderer.send('view:set', visible, focused),
  clipRead: () => ipcRenderer.invoke('clip:read'),
  clipWrite: (text: string) => ipcRenderer.invoke('clip:write', text),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  pathExists: (p: string) => ipcRenderer.invoke('path:exists', p),
  toolsCheck: () => ipcRenderer.invoke('tools:check'),
  changesList: (projectId: string) => ipcRenderer.invoke('changes:list', projectId),
  changesDiff: (projectId: string, request: unknown) => ipcRenderer.invoke('changes:diff', projectId, request),
  ideDetect: () => ipcRenderer.invoke('ide:detect'),
  ideChoose: (projectId: string, ideId: string) => ipcRenderer.invoke('ide:choose', projectId, ideId),
  idePick: (projectId: string) => ipcRenderer.invoke('ide:pick', projectId),
  ideOpen: (projectId: string, file: string | null, line: number | null) => ipcRenderer.invoke('ide:open', projectId, file, line),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  openLink: (url: string) => ipcRenderer.send('link:open', url),
  updateGet: () => ipcRenderer.invoke('update:get'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: (force: boolean) => ipcRenderer.invoke('update:install', force),
  onUpdateStatus: (cb: Listener) => subscribe('update:status', cb),
  onPtyData: (cb: Listener) => subscribe('pty:data', cb),
  onPtyExit: (cb: Listener) => subscribe('pty:exit', cb),
  onPtyReset: (cb: Listener) => subscribe('pty:reset', cb),
  onState: (cb: Listener) => subscribe('state:update', cb),
  onRuntime: (cb: Listener) => subscribe('runtime:update', cb),
  onWindowFocus: (cb: Listener) => subscribe('window:focus', cb),
  onSessionFocus: (cb: Listener) => subscribe('session:focus', cb),
  onAutoSlept: (cb: Listener) => subscribe('session:autoSlept', cb),
  onNotice: (cb: Listener) => subscribe('app:notice', cb),
};

contextBridge.exposeInMainWorld('hilo', api);
