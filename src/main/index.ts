import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { checkTools } from './tools';
import type { ToolCheck } from '../shared/types';
import { mkdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { release } from 'node:os';
import { join } from 'node:path';
import { STATUS_LABEL } from '../shared/statusMachine';
import { findSession } from '../shared/reducer';
import { isSafeId, isValidAction, sanitizeSettings } from '../shared/validate';
import { ideName, isValidIdePath, type DetectedIde, type IdeOpenResult } from '../shared/ide';
import type { Action, AppInfo, PersistedState, SessionRecord, SessionStatus, WindowBounds } from '../shared/types';
import { resolveClaude } from './claude';
import { createClipboard } from './clipboard';
import { fileDiff, listChanges, resolveInside } from './git';
import { detectIdes, ideRootsFromEnv, launchIde } from './ide';
import { installSharedConout } from './pty/sharedConout';
import { APP_ORIGIN, applyNetworkSwitches, hardenSession, hardenWebContents, installEditMenu, openExternalSafe, registerAppScheme, serveRenderer } from './security';
import { SessionController } from './sessions';
import { Store } from './store';
import { UpdateService } from './updater';
import { resolveUpdateMode } from '../shared/updates';

const isTest = process.env.HILO_E2E === '1';

// Un depurador remoto abierto daría control total de la app: solo en pruebas.
if (app.isPackaged && !isTest && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

const dataDir = (isTest && process.env.HILO_DATA_DIR) || join(app.getPath('appData'), 'Hilo');
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
app.setAppUserModelId('com.hilo.app');

const updateMode = resolveUpdateMode({ isPackaged: app.isPackaged, isTest, testFeed: process.env.HILO_TEST_UPDATE_FEED, testReal: process.env.HILO_TEST_UPDATE_REAL });
applyNetworkSwitches(updateMode);
registerAppScheme();
installSharedConout();

if (!isTest && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

const store = new Store(dataDir);
store.onSaveError = (message) => send('app:notice', message);
const clip = createClipboard();
let win: BrowserWindow | null = null;
let quitting = false;
let crashNotice: string | null = null;

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

const NOTIFY_TEXT: Partial<Record<SessionStatus, string>> = {
  done: 'Terminó',
  waiting: 'Te está esperando',
  error: 'Terminó con error',
};

const sentNotifications: { id: string; name: string; status: SessionStatus; shown?: boolean; failed?: string }[] = [];

/** Sin una referencia, el recolector puede llevarse la notificación y su clic. */
const liveNotifications = new Set<Notification>();

function focusSession(id: string): void {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  send('session:focus', id);
}

const sessions = new SessionController(store, dataDir, {
  send,
  statusChanged: updateWindowTitle,
  notify(session: SessionRecord, status: SessionStatus) {
    if (!store.get().settings.notifications) return;
    const record: (typeof sentNotifications)[number] = { id: session.id, name: session.name, status };
    if (isTest) sentNotifications.push(record);
    if ((isTest && process.env.HILO_TEST_REAL_NOTIFY !== '1') || !Notification.isSupported()) return;
    const n = new Notification({ title: session.name, body: NOTIFY_TEXT[status] ?? STATUS_LABEL[status] });
    liveNotifications.add(n);
    n.on('click', () => {
      liveNotifications.delete(n);
      focusSession(session.id);
    });
    n.on('close', () => liveNotifications.delete(n));
    n.on('show', () => {
      record.shown = true;
    });
    n.on('failed', (_e, error) => {
      record.failed = error;
      console.error('[notificación] falló', error);
    });
    n.show();
  },
});

const updates = new UpdateService(updateMode, {
  dataDir,
  send: (status) => send('update:status', status),
  isWorking: () => sessions.isWorking(),
  stopEverything,
  recover: () => {
    app.relaunch();
    app.exit(0);
  },
});

function updateWindowTitle(): void {
  if (!win || win.isDestroyed()) return;
  const map = sessions.runtimeMap();
  let waiting = 0;
  let done = 0;
  let error = 0;
  for (const r of Object.values(map)) {
    if (r.status === 'waiting') waiting++;
    else if (r.status === 'done') done++;
    else if (r.status === 'error') error++;
  }
  const parts: string[] = [];
  if (waiting) parts.push(`${waiting} esperando`);
  if (error) parts.push(`${error} con error`);
  if (done) parts.push(`${done} sin leer`);
  win.setTitle(parts.length ? `Hilo · ${parts.join(', ')}` : 'Hilo');
}

function clampBounds(b: WindowBounds): WindowBounds {
  // Con el monitor donde estaba: una ventana en un monitor más grande no debe encogerse.
  const area = (b.x !== undefined && b.y !== undefined
    ? screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height })
    : screen.getPrimaryDisplay()
  ).workArea;
  const width = Math.min(Math.max(b.width, 640), area.width);
  const height = Math.min(Math.max(b.height, 420), area.height);
  if (b.x === undefined || b.y === undefined) return { ...b, width, height };
  const visible = screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x! < w.x + w.width - 80 && b.x! + width > w.x + 80 && b.y! >= w.y - 20 && b.y! < w.y + w.height - 40;
  });
  return visible ? { ...b, width, height } : { maximized: b.maximized, width, height };
}

function createWindow(): void {
  const state = store.get();
  const bounds = clampBounds(state.window);
  const dark = state.settings.theme === 'dark';
  const hidden = isTest && process.env.HILO_TEST_HIDDEN === '1';
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'Hilo',
    backgroundColor: dark ? '#1a1b1e' : '#f6f6f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: dark ? '#17181b' : '#ececee', symbolColor: dark ? '#b8b9bf' : '#3a3b40', height: 36 },
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // La salida de las terminales tiene que seguir procesándose con la ventana minimizada.
      backgroundThrottling: false,
      devTools: !app.isPackaged,
      enableWebSQL: false,
    },
  };
  if (bounds.x !== undefined && bounds.y !== undefined) {
    opts.x = bounds.x;
    opts.y = bounds.y;
  }
  win = new BrowserWindow(opts);
  hardenWebContents(win.webContents);
  installEditMenu(win.webContents);
  void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  win.webContents.on('did-finish-load', applyAppZoom);
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || quitting) return;
    console.error('[hilo] se cayó la interfaz:', details.reason);
    // Las terminales vivían ahí: se duermen las sesiones (las conversaciones están guardadas) y se recarga.
    void sessions.restartAfterRendererCrash().finally(() => {
      if (win && !win.isDestroyed()) {
        crashNotice = 'La interfaz se cerró de forma inesperada. Tus sesiones quedaron dormidas: despiértalas para seguir.';
        void win.loadURL(`${APP_ORIGIN}/index.html`);
      }
    });
  });
  win.once('ready-to-show', () => {
    if (!win) return;
    if (bounds.maximized) win.maximize();
    // En pruebas no se le roba el foco al usuario.
    if (hidden) win.showInactive();
    else win.show();
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const b = maximized ? store.get().window : win.getBounds();
    store.dispatch({ type: 'window/bounds', bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } } as Action);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);
  win.on('focus', () => send('window:focus', true));
  win.on('blur', () => send('window:focus', false));

  win.on('close', (event) => {
    if (quitting || isTest || !sessions.isWorking()) return;
    event.preventDefault();
    // Asíncrono: un diálogo síncrono congelaría todas las terminales mientras está abierto.
    void dialog
      .showMessageBox(win!, {
        type: 'warning',
        buttons: ['Cerrar de todos modos', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Hilo',
        message: 'Hay sesiones trabajando',
        detail: 'Si cierras Hilo se interrumpen. Podrás retomarlas después.',
      })
      .then(({ response }) => {
        if (response !== 0) return;
        quitting = true;
        app.quit();
      });
  });
  // Windows se apaga o se cierra la sesión: no hay tiempo para más.
  win.on('session-end', () => {
    store.flushSafe();
    sessions.killAllNow();
  });
  win.on('closed', () => {
    win = null;
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);
}

/** Toda IPC viene del documento propio de la ventana principal. */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!win && event.sender === win.webContents && !!frame && frame === win.webContents.mainFrame && frame.url.startsWith(`${APP_ORIGIN}/`);
}

function handle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('remitente no autorizado');
    return (fn as (...a: unknown[]) => unknown)(...args);
  });
}

function on(channel: string, fn: (...args: never[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (trusted(event)) (fn as (...a: unknown[]) => void)(...args);
  });
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
/** conpty guarda filas y columnas en un SHORT. */
const isCells = (v: unknown): v is number => isInt(v) && v <= 2000;

const ALLOWED_ACTIONS = new Set<Action['type']>([
  'project/add', 'project/rename', 'project/color', 'project/collapse', 'project/remove', 'project/move',
  'session/add', 'session/rename', 'session/color', 'session/remove', 'session/move',
  'ui/select', 'ui/layout', 'ui/pane', 'ui/paneInsert', 'ui/paneRemove', 'ui/activePane', 'ui/tabClose', 'ui/tree', 'ui/sidebar', 'settings/set',
]);

const projectById = (id: unknown) => (isSafeId(id) ? store.get().projects.find((p) => p.id === id) : undefined);
/** Lo último que se detectó. El renderer elige por id: la ruta del programa nunca viene de él. */
let detectedIdes: DetectedIde[] = [];
const listInFlight = new Map<string, ReturnType<typeof listChanges>>();

async function openInIde(projectId: unknown, file: unknown, line: unknown): Promise<IdeOpenResult> {
  const project = projectById(projectId);
  if (!project) return { ok: false, reason: 'file', message: 'Ese proyecto ya no está.' };
  if (!project.ide) return { ok: false, reason: 'none', message: 'Este proyecto todavía no tiene un IDE elegido.' };
  const target: { project: string; file?: string; line?: number } = { project: project.path };
  if (file !== null) {
    const abs = await resolveInside(project.path, file);
    if (!abs) return { ok: false, reason: 'file', message: 'Esa ruta queda fuera de la carpeta del proyecto.' };
    target.file = abs;
    if (typeof line === 'number' && Number.isInteger(line) && line > 0 && line < 1e8) target.line = line;
  }
  return launchIde(project.ide.path, target);
}

function registerIpc(): void {
  handle('state:get', () => {
    const notice = crashNotice ?? store.notice;
    const afterCrash = crashNotice !== null;
    crashNotice = null;
    store.notice = null;
    // En pruebas la ventana nunca tiene el foco del sistema.
    return { state: store.get(), runtime: sessions.runtimeMap(), info: appInfo(), notice, afterCrash, focused: isTest || !!win?.isFocused() };
  });
  handle('state:dispatch', (action: Action) => {
    if (!action || !ALLOWED_ACTIONS.has(action.type) || !isValidAction(action)) throw new Error('acción no permitida');
    if (action.type === 'session/add') sessions.register(action.session);
    if (action.type === 'settings/set') {
      // Se sanean juntos con lo que ya hay: un valor inválido se descarta.
      const current = store.get().settings;
      store.dispatch({ type: 'settings/set', patch: sanitizeSettings({ ...current, ...action.patch }, current) });
    } else {
      store.dispatch(action);
    }
    if (action.type === 'settings/set' && action.patch.theme) applyTheme(action.patch.theme);
    if (action.type === 'settings/set' && action.patch.appZoom !== undefined) applyAppZoom();
  });

  handle('session:wake', (id: unknown, cols: unknown, rows: unknown) => {
    return isStr(id) && isCells(cols) && isCells(rows) ? sessions.wake(id, cols, rows) : false;
  });
  handle('session:sleep', (id: unknown) => (isStr(id) ? sessions.sleep(id) : false));
  handle('session:background', (id: unknown) => (isStr(id) ? sessions.background(id) : []));
  handle('session:remove', (id: unknown) => {
    if (!isStr(id)) return;
    // Sale de la lista ya; el proceso se apaga por detrás.
    store.dispatch({ type: 'session/remove', id });
    void sessions.remove(id);
  });
  handle('session:removeProject', async (id: unknown) => {
    if (!isStr(id)) return;
    const project = store.get().projects.find((p) => p.id === id);
    if (!project) return;
    store.dispatch({ type: 'project/remove', id });
    await Promise.all(project.sessions.map((s) => sessions.remove(s.id)));
  });

  on('pty:write', (id: unknown, data: unknown) => {
    if (isStr(id) && isStr(data)) sessions.write(id, data);
  });
  on('pty:resize', (id: unknown, cols: unknown, rows: unknown) => {
    if (isStr(id) && isCells(cols) && isCells(rows)) sessions.resize(id, cols, rows);
  });
  on('pty:ack', (id: unknown, chars: unknown) => {
    if (isStr(id) && isInt(chars)) sessions.ack(id, chars);
  });
  on('view:set', (visible: unknown, focused: unknown) => {
    if (Array.isArray(visible) && visible.every(isStr)) sessions.setView(visible, focused === true);
  });

  handle('path:exists', async (p: unknown) => {
    if (!isStr(p) || p.length >= 4096) return false;
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  });
  handle('changes:list', (projectId: unknown) => {
    const project = projectById(projectId);
    if (!project) return { status: 'no-project' };
    // Dos avisos a la vez (foco y una sesión que termina) comparten la misma lectura.
    const running = listInFlight.get(project.id);
    if (running) return running;
    const started = listChanges(project.path).finally(() => listInFlight.delete(project.id));
    listInFlight.set(project.id, started);
    return started;
  });
  handle('changes:diff', (projectId: unknown, raw: unknown) => {
    const project = projectById(projectId);
    const req = raw as { path?: unknown; oldPath?: unknown; untracked?: unknown; full?: unknown } | null;
    if (!project || !req || !isStr(req.path) || (req.oldPath !== undefined && !isStr(req.oldPath))) return { status: 'rejected' };
    return fileDiff(project.path, {
      path: req.path,
      ...(isStr(req.oldPath) ? { oldPath: req.oldPath } : {}),
      untracked: req.untracked === true,
      full: req.full === true,
    });
  });
  handle('ide:detect', () => {
    detectedIdes = detectIdes(ideRootsFromEnv());
    return detectedIdes;
  });
  handle('ide:choose', (projectId: unknown, ideId: unknown) => {
    const project = projectById(projectId);
    const ide = detectedIdes.find((d) => d.id === ideId);
    if (!project || !ide) return false;
    store.dispatch({ type: 'project/ide', id: project.id, ide: { path: ide.path, name: ide.name } });
    return true;
  });
  handle('ide:pick', async (projectId: unknown) => {
    const project = projectById(projectId);
    if (!project || !win) return { ok: false };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: `Elige el programa para abrir «${project.name}»`,
      filters: [{ name: 'Programas', extensions: ['exe'] }],
    });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!path) return { ok: false };
    if (!isValidIdePath(path)) return { ok: false, message: 'Elige un archivo .exe de este PC. Un .cmd, un .bat o una ruta de red no sirven.' };
    store.dispatch({ type: 'project/ide', id: project.id, ide: { path, name: ideName(path) } });
    return { ok: true };
  });
  handle('ide:open', (projectId: unknown, file: unknown, line: unknown) => openInIde(projectId, file, line));
  handle('clip:read', async () => {
    const [text, hasImage] = await Promise.all([clip.readText(), clip.hasImage()]);
    return { text, hasImage };
  });
  handle('clip:write', (text: unknown) => {
    if (isStr(text)) return clip.writeText(text);
  });

  handle('dialog:pickFolder', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Elige la carpeta del proyecto' });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('dialog:pickFile', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Ruta de claude',
      filters: [{ name: 'Ejecutables', extensions: ['exe', 'cmd', 'bat'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('tools:check', () => {
    if (isTest && process.env.HILO_TEST_TOOLS) return JSON.parse(process.env.HILO_TEST_TOOLS) as ToolCheck;
    return checkTools(store.get().settings.claudePath);
  });

  handle('update:get', () => updates.get());
  handle('update:check', () => updates.check());
  handle('update:download', () => updates.download());
  handle('update:install', (force: unknown) => updates.install(force === true));

  on('win:fullscreen', () => {
    if (win) win.setFullScreen(!win.isFullScreen());
  });
  on('link:open', (url: unknown) => {
    if (isStr(url)) openExternalSafe(url);
  });
}

function appInfo(): AppInfo {
  const build = Number(release().split('.')[2]) || 0;
  return {
    version: app.getVersion(),
    windowsBuild: build,
    claudePath: resolveClaude(store.get().settings.claudePath),
    isTest,
  };
}

function applyAppZoom(): void {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(store.get().settings.appZoom / 100);
}

function applyTheme(theme: PersistedState['settings']['theme']): void {
  if (!win) return;
  const dark = theme === 'dark';
  win.setBackgroundColor(dark ? '#1a1b1e' : '#f6f6f7');
  win.setTitleBarOverlay({ color: dark ? '#17181b' : '#ececee', symbolColor: dark ? '#b8b9bf' : '#3a3b40', height: 36 });
}

store.subscribe((state, action) => {
  // Lo de la ventana no le interesa al renderer.
  if (action.type !== 'window/bounds') send('state:update', state);
});

Menu.setApplicationMenu(null);

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

app.whenReady().then(() => {
  hardenSession();
  serveRenderer(join(__dirname, '..', 'renderer'));
  registerIpc();
  createWindow();
  if (store.get().settings.checkUpdatesOnStart) updates.scheduleStartupCheck();
  if (isTest) {
    (globalThis as unknown as { __hilo: unknown }).__hilo = {
      clipboard: clip,
      sessions,
      store,
      updates,
      sentNotifications,
      focusSession,
      pidOf: (id: string) => (sessions as unknown as { live: Map<string, { pid: number }> }).live.get(id)?.pid,
      focus: (focused: boolean) => send('window:focus', focused),
      statusOf: (id: string) => sessions.statusOf(id),
      findSession: (id: string) => findSession(store.get(), id),
    };
  }
}).catch((err: unknown) => {
  // Una app sin ventana y con el cerrojo de instancia única no se podría volver a abrir.
  console.error('[hilo] no se pudo arrancar', err);
  dialog.showErrorBox('Hilo no pudo arrancar', err instanceof Error ? err.message : String(err));
  app.exit(1);
});

app.on('window-all-closed', () => {
  app.quit();
});

let shutdownStarted = false;

/** Lo mismo al cerrar que al actualizar: guarda y apaga. Lo que estaba encendido sigue contando como encendido. */
async function stopEverything(): Promise<void> {
  shutdownStarted = true;
  quitting = true;
  store.flushSafe();
  try {
    win?.hide();
  } catch {
    // La ventana ya no está.
  }
  await sessions.shutdown(isTest).catch((err) => console.error('[hilo] al cerrar', err));
  store.flushSafe();
}

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  // Pase lo que pase con el guardado, la app sale: una que no sale no se puede volver a abrir.
  void stopEverything().finally(() => app.exit(0));
});


process.on('uncaughtException', (err) => {
  console.error('[hilo] excepción no controlada', err);
});
