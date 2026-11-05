import { isValidTree, presetTree } from '../shared/paneLayout';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { defaultState } from '../shared/defaults';
import { isValidIdePath } from '../shared/ide';
import { changesProjectOf, sessionInPane } from '../shared/paneContent';
import { reduce } from '../shared/reducer';
import type { Action, PersistedState, ProjectRecord, SessionRecord } from '../shared/types';
import { isClaudeId, isColor, isPath, isSafeId, isValidEffort, isValidModel, MAX_NAME, sanitizeSettings } from '../shared/validate';

const SAVE_DELAY_MS = 300;
const RETRIES = 6;
const RETRY_WAIT_MS = 60;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Con el archivo bloqueado se reintenta sin congelar nada, cada vez más despacio. */
const SAVE_RETRY_MS = 1000;
const SAVE_RETRY_MAX_MS = 30_000;
/** Al arrancar se espera más: lo que no se pudo leer se pisaría al primer guardado. */
const READ_LOCK_WAIT_MS = 5000;
const STATE_VERSION = 1;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** En Windows un antivirus o el indexador pueden tener el archivo abierto un instante. */
function withRetry(fn: () => void, retries = RETRIES): void {
  for (let i = 0; ; i++) {
    try {
      fn();
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= retries || !code || !RETRY_CODES.has(code)) throw err;
      sleepSync(RETRY_WAIT_MS);
    }
  }
}

/**
 * Estado persistente. Escribe a un temporal, hace fsync y renombra: un corte de luz
 * deja el archivo anterior o el nuevo, nunca uno a medias. Conserva una copia .bak.
 */
export class Store {
  private state: PersistedState;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private readonly listeners = new Set<(s: PersistedState, a: Action) => void>();
  private readonly file: string;
  /** El archivo actual se pudo leer: es válido como copia de seguridad. */
  private fileHealthy = true;
  private saveFailures = 0;
  private retryDelay = SAVE_RETRY_MS;
  /** Hay un state.json que no se pudo leer ni apartar: guardar lo destruiría. */
  private saveBlocked = false;
  /** Lo que hay que contarle al usuario una vez, por ejemplo que se recuperó de la copia. */
  notice: string | null = null;
  onSaveError: ((message: string) => void) | null = null;

  constructor(dir: string) {
    this.file = join(dir, 'state.json');
    this.state = this.load();
  }

  private load(): PersistedState {
    const main = tryRead(this.file);
    // Un cierre con el archivo bloqueado deja el último guardado en el temporal, ya con fsync.
    const tmp = `${this.file}.tmp`;
    if (main.state && existsSync(tmp) && statSync(tmp).mtimeMs > statSync(this.file).mtimeMs) {
      const pending = tryRead(tmp);
      if (pending.state) {
        this.dirty = true;
        return pending.state;
      }
    }
    if (main.state) return main.state;
    if (main.locked) {
      this.saveBlocked = true;
      this.notice = 'Otro programa tiene bloqueado el archivo de estado. Hilo empieza vacío y no guardará nada hasta que lo vuelvas a abrir: tus datos siguen ahí.';
      return defaultState();
    }
    if (main.exists) {
      // Se conserva para poder recuperarlo a mano: el primer guardado lo sobrescribiría.
      this.fileHealthy = false;
      const aside = `${this.file}.corrupto-${Date.now()}`;
      try {
        withRetry(() => renameSync(this.file, aside));
      } catch (err) {
        console.error('[store] no se pudo apartar el archivo dañado', err);
        this.saveBlocked = true;
        this.notice = 'El archivo de estado está dañado y no se pudo apartar. Hilo no guardará nada hasta que lo vuelvas a abrir.';
        return defaultState();
      }
    }
    const backup = tryRead(`${this.file}.bak`);
    if (backup.newer) {
      // Puede ser lo único que queda de esos datos: el segundo guardado lo pisaría.
      try {
        renameSync(`${this.file}.bak`, `${this.file}.bak.futura-${Date.now()}`);
      } catch (err) {
        console.error('[store] no se pudo apartar la copia', err);
      }
    }
    const what = main.newer ? 'El archivo de estado es de una versión más nueva de Hilo' : 'El archivo de estado estaba dañado';
    if (backup.state) {
      if (main.exists) this.notice = `${what}: se recuperó la copia anterior. El archivo se conservó en su carpeta de datos.`;
      return backup.state;
    }
    if (main.exists) this.notice = `${what} y no había copia: Hilo empieza vacío. El archivo se conservó en su carpeta de datos.`;
    return defaultState();
  }

  get(): PersistedState {
    return this.state;
  }

  subscribe(fn: (s: PersistedState, a: Action) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch(action: Action): PersistedState {
    const next = reduce(this.state, action);
    if (next === this.state) return next;
    this.state = next;
    this.dirty = true;
    if (!this.timer) {
      // Sin esperas síncronas: con el archivo bloqueado congelaría la app. Lo reintenta el temporizador.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushSafe(0);
      }, SAVE_DELAY_MS);
      this.timer.unref();
    }
    for (const fn of this.listeners) fn(next, action);
    return next;
  }

  /** Nunca lanza. Si falla, el cambio sigue pendiente y se reintenta. */
  flushSafe(retries = RETRIES): boolean {
    try {
      this.flush(retries);
      this.saveFailures = 0;
      this.retryDelay = SAVE_RETRY_MS;
      return true;
    } catch (err) {
      console.error('[store] no se pudo guardar', err);
      // Un antivirus lo bloquea un instante: solo se avisa si el reintento tampoco pudo.
      this.saveFailures++;
      if (this.saveFailures === 2) this.onSaveError?.('No se pudieron guardar los cambios. Hilo lo seguirá intentando.');
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flushSafe(0);
        }, this.retryDelay);
        this.timer.unref();
        this.retryDelay = Math.min(this.retryDelay * 2, SAVE_RETRY_MAX_MS);
      }
      return false;
    }
  }

  /** Guarda ya, de forma síncrona. Se llama también al salir. */
  flush(retries = RETRIES): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.saveBlocked) return;
    const tmp = `${this.file}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    withRetry(() => {
      const fd = openSync(tmp, 'w');
      try {
        writeFileSync(fd, JSON.stringify(this.state, null, 1));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }, retries);
    if (this.fileHealthy && existsSync(this.file)) {
      try {
        withRetry(() => copyFileSync(this.file, `${this.file}.bak`), retries);
      } catch (err) {
        console.error('[store] no se pudo crear la copia', err);
      }
    }
    withRetry(() => renameSync(tmp, this.file), retries);
    // Solo ahora: si algo falló arriba, el cambio sigue marcado como pendiente.
    this.fileHealthy = true;
    this.dirty = false;
  }
}

interface ReadResult {
  exists: boolean;
  state: PersistedState | null;
  /** Existe y no se pudo abrir: no se sabe qué tiene. */
  locked?: boolean;
  newer?: boolean;
}

/** Un antivirus o el indexador pueden tener el archivo abierto: eso no es un archivo dañado. */
function readWhenFree(file: string): string | null {
  const deadline = Date.now() + READ_LOCK_WAIT_MS;
  for (;;) {
    try {
      return readFileSync(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRY_CODES.has(code)) throw err;
      if (Date.now() >= deadline) return null;
      sleepSync(RETRY_WAIT_MS);
    }
  }
}

function tryRead(file: string): ReadResult {
  if (!existsSync(file)) return { exists: false, state: null };
  try {
    const raw = readWhenFree(file);
    if (raw === null) return { exists: true, state: null, locked: true };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return { exists: true, state: null };
    // De una versión más nueva: no se sabe leer, y el primer guardado lo borraría.
    if (typeof parsed.version === 'number' && parsed.version > STATE_VERSION) return { exists: true, state: null, newer: true };
    return { exists: true, state: sanitize(parsed) };
  } catch (err) {
    console.error(`[store] no se pudo leer ${file}`, err);
    return { exists: true, state: null };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeSession(raw: unknown): SessionRecord | null {
  if (!isRecord(raw) || !isSafeId(raw.id) || !isPath(raw.cwd)) return null;
  const session: SessionRecord = {
    id: raw.id,
    claudeId: isClaudeId(raw.claudeId) ? raw.claudeId : isClaudeId(raw.id) ? raw.id : randomUUID(),
    kind: raw.kind === 'shell' ? 'shell' : 'claude',
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME) : 'Sesión',
    color: typeof raw.color === 'string' && isColor(raw.color) ? raw.color : null,
    cwd: raw.cwd,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
  if (isValidModel(raw.model)) session.model = raw.model;
  if (isValidEffort(raw.effort)) session.effort = raw.effort;
  return session;
}

function sanitizeProject(raw: unknown, seen: Set<string>): ProjectRecord | null {
  if (!isRecord(raw) || !isSafeId(raw.id) || !isPath(raw.path)) return null;
  const sessions: SessionRecord[] = [];
  if (Array.isArray(raw.sessions)) {
    for (const item of raw.sessions) {
      const s = sanitizeSession(item);
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        sessions.push(s);
      }
    }
  }
  const project: ProjectRecord = {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME) : 'Proyecto',
    path: raw.path,
    color: typeof raw.color === 'string' && isColor(raw.color) ? raw.color : null,
    collapsed: raw.collapsed === true,
    sessions,
  };
  // Es una ruta que se ejecuta: si no es un .exe local con ruta absoluta, se olvida.
  if (isRecord(raw.ide) && isValidIdePath(raw.ide.path)) {
    project.ide = { path: raw.ide.path, name: typeof raw.ide.name === 'string' && raw.ide.name ? raw.ide.name.slice(0, MAX_NAME) : 'el IDE' };
  }
  return project;
}

/** Un archivo sin `ui.awake` es de antes de encender al abrir: "dormidas" era solo el valor por defecto. */
function migrateSettings(settings: PersistedState['settings'], ui: unknown): PersistedState['settings'] {
  const known = isRecord(ui) && Array.isArray(ui.awake);
  return !known && settings.startup === 'asleep' ? { ...settings, startup: 'restore' } : settings;
}

function sanitizeWindow(raw: unknown, base: PersistedState['window']): PersistedState['window'] {
  if (!isRecord(raw)) return base;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: PersistedState['window'] = {
    width: finite(raw.width) ? raw.width : base.width,
    height: finite(raw.height) ? raw.height : base.height,
    maximized: raw.maximized === true,
  };
  if (finite(raw.x) && finite(raw.y)) {
    out.x = raw.x;
    out.y = raw.y;
  }
  return out;
}

/** Rellena lo que falte con los valores por defecto. Exportado para las pruebas. */
export function sanitize(raw: unknown): PersistedState {
  const base = defaultState();
  if (!isRecord(raw)) return base;
  const seen = new Set<string>();
  const projects = Array.isArray(raw.projects) ? raw.projects.map((p) => sanitizeProject(p, seen)) : [];
  const state: PersistedState = {
    version: STATE_VERSION,
    projects: projects.filter((p): p is ProjectRecord => p !== null),
    settings: migrateSettings(sanitizeSettings(raw.settings, base.settings), raw.ui),
    ui: { ...base.ui, ...(isRecord(raw.ui) ? raw.ui : {}) },
    window: sanitizeWindow(raw.window, base.window),
  };
  // Los paneles pueden apuntar a sesiones o proyectos que ya no existen.
  const projectIds = new Set(state.projects.map((p) => p.id));
  const stillThere = (p: unknown): p is string => {
    if (typeof p !== 'string') return false;
    const project = changesProjectOf(p);
    return project !== null ? projectIds.has(project) : seen.has(p);
  };
  const layout = state.ui.layout === 2 || state.ui.layout === 3 || state.ui.layout === 4 ? state.ui.layout : 1;
  const panes = (Array.isArray(state.ui.panes) ? state.ui.panes : []).slice(0, layout).map((p) => (stillThere(p) ? p : null));
  while (panes.length < layout) panes.push(null);
  const activePane = Math.max(0, Math.min(layout - 1, Number(state.ui.activePane) || 0));
  const active = typeof state.ui.activeSessionId === 'string' && seen.has(state.ui.activeSessionId) ? state.ui.activeSessionId : null;
  state.ui = {
    ...state.ui,
    layout,
    panes,
    tree: isValidTree(state.ui.tree, layout) ? state.ui.tree : presetTree(layout),
    activePane,
    // Con un panel Cambios activo no hay sesión activa.
    activeSessionId: panes[activePane] ? sessionInPane(panes[activePane]) : active,
    sidebarWidth: typeof state.ui.sidebarWidth === 'number' && Number.isFinite(state.ui.sidebarWidth) ? Math.max(180, Math.min(420, state.ui.sidebarWidth)) : base.ui.sidebarWidth,
    sidebarCollapsed: state.ui.sidebarCollapsed === true,
    awake: Array.isArray(state.ui.awake) ? state.ui.awake.filter((id): id is string => typeof id === 'string' && seen.has(id)) : [],
    hiddenTabs: Array.isArray(state.ui.hiddenTabs) ? state.ui.hiddenTabs.filter((id): id is string => typeof id === 'string' && seen.has(id)) : [],
  };
  return state;
}
