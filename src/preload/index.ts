import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
  /** Rutas reales de los archivos soltados. Un File no cruza el puente: la ruta se calcula aquí. */
  pathsOfFiles: (files: unknown): string[] => {
    const out: string[] = [];
    for (const file of Array.isArray(files) ? (files as File[]) : []) {
      try {
        const path = webUtils.getPathForFile(file);
        if (path) out.push(path);
      } catch {
        // No era un File, o no está en disco.
      }
    }
    return out;
  },
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  fixFolder: (id: string, mode: 'pick' | 'project') => ipcRenderer.invoke('session:fixFolder', id, mode),
  pickProjectFolder: (projectId: string) => ipcRenderer.invoke('project:pickFolder', projectId),
  applyProjectFolder: (projectId: string, token: string, sessionIds: string[]) => ipcRenderer.invoke('project:applyFolder', projectId, token, sessionIds),
  changeSessionFolder: (id: string) => ipcRenderer.invoke('session:changeFolder', id),
  freshConversation: (id: string) => ipcRenderer.invoke('session:freshConversation', id),
  pathExists: (p: string) => ipcRenderer.invoke('path:exists', p),
  toolsCheck: () => ipcRenderer.invoke('tools:check'),
  usageGet: () => ipcRenderer.invoke('usage:get'),
  lastMessage: (id: string) => ipcRenderer.invoke('session:lastMessage', id),
  markRead: (id: string) => ipcRenderer.invoke('session:markRead', id),
  openProjectFolder: (id: string) => ipcRenderer.invoke('project:openFolder', id),
  pathResolve: (id: string, paths: string[]) => ipcRenderer.invoke('path:resolve', id, paths),
  pathReveal: (id: string, path: string) => ipcRenderer.invoke('path:reveal', id, path),
  openSessionFolder: (id: string) => ipcRenderer.invoke('session:openFolder', id),
  onUsage: (cb: Listener) => subscribe('usage:update', cb),
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
  onAlert: (cb: Listener) => subscribe('session:alert', cb),
  // Al suscribirse avisa que escucha: recién entonces el proceso principal marca un aviso como avisado.
  onUsageAlert: (cb: Listener) => {
    const off = subscribe('usage:alert', cb);
    void ipcRenderer.invoke('usage:listen');
    return off;
  },
  soundPick: () => ipcRenderer.invoke('sound:pick'),
  soundRead: () => ipcRenderer.invoke('sound:read'),
  soundClear: () => ipcRenderer.invoke('sound:clear'),
  onNotice: (cb: Listener) => subscribe('app:notice', cb),
};

contextBridge.exposeInMainWorld('hilo', api);
