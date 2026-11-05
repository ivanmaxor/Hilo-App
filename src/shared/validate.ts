import { isValidTree } from './paneLayout';
import { DEFAULT_SETTINGS, EFFORTS } from './defaults';
import { changesProjectOf } from './paneContent';
import type { Action, ProjectRecord, SessionRecord, Settings } from './types';

/**
 * Lo que entra por IPC o se lee de disco se comprueba antes de usarlo.
 * Un id termina en una ruta de archivo y en el comando de un hook.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Van en la línea de comandos: empezar con guion los convertiría en un flag. */
const MODEL = /^[A-Za-z0-9][\w.:[\]-]{0,63}$/;
/** Claude solo acepta UUID: con otra cosa la sesión no volvería a arrancar. */
const CLAUDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_NAME = 200;
const MAX_PATH = 4096;

export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && SAFE_ID.test(v);
}

/** Lo que puede ir en un panel: una sesión o un panel Cambios. */
export function isPaneContent(v: unknown): v is string {
  const project = changesProjectOf(v as string | null);
  return project !== null ? isSafeId(project) : isSafeId(v);
}

export function isClaudeId(v: unknown): v is string {
  return typeof v === 'string' && CLAUDE_ID.test(v);
}

export function isValidModel(v: unknown): v is string {
  return typeof v === 'string' && MODEL.test(v);
}

export function isValidEffort(v: unknown): v is string {
  return typeof v === 'string' && EFFORTS.includes(v);
}

export const isColor = (v: unknown): v is string | null => v === null || (typeof v === 'string' && COLOR.test(v));
const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_NAME;
export const isPath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_PATH && !v.includes('\0');
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function isSession(v: unknown): v is SessionRecord {
  const s = v as Partial<SessionRecord> | null;
  return (
    !!s &&
    isSafeId(s.id) &&
    isClaudeId(s.claudeId) &&
    (s.kind === 'claude' || s.kind === 'shell') &&
    isName(s.name) &&
    isColor(s.color ?? null) &&
    isPath(s.cwd) &&
    typeof s.createdAt === 'number' &&
    (s.model === undefined || isValidModel(s.model)) &&
    (s.effort === undefined || isValidEffort(s.effort))
  );
}

function isProject(v: unknown): v is ProjectRecord {
  const p = v as Partial<ProjectRecord> | null;
  // Sin `ide`: esa ruta se ejecuta, y solo la puede poner el proceso principal.
  return !!p && p.ide === undefined && isSafeId(p.id) && isName(p.name) && isPath(p.path) && isColor(p.color ?? null) && Array.isArray(p.sessions) && p.sessions.every(isSession);
}

/** Forma de cada acción. Devuelve false si no hay que aplicarla. */
export function isValidAction(a: Action): boolean {
  if (!a || typeof a !== 'object') return false;
  switch (a.type) {
    case 'project/add':
      return isProject(a.project);
    case 'project/rename':
    case 'session/rename':
      return isSafeId(a.id) && isName(a.name);
    case 'project/color':
    case 'session/color':
      return isSafeId(a.id) && isColor(a.color);
    case 'project/collapse':
      return isSafeId(a.id) && typeof a.collapsed === 'boolean';
    case 'project/remove':
    case 'session/remove':
      return isSafeId(a.id);
    case 'project/move':
      return isSafeId(a.id) && isIndex(a.toIndex);
    case 'session/add':
      return isSafeId(a.projectId) && isSession(a.session) && (a.index === undefined || isIndex(a.index));
    case 'session/move':
      return isSafeId(a.id) && isSafeId(a.toProjectId) && isIndex(a.toIndex);
    case 'ui/select':
      return a.id === null || isSafeId(a.id);
    case 'ui/tabClose':
      return isSafeId(a.id);
    case 'ui/layout':
      return a.layout === 1 || a.layout === 2 || a.layout === 3 || a.layout === 4;
    case 'ui/pane':
      return isIndex(a.pane) && (a.sessionId === null || isPaneContent(a.sessionId));
    case 'ui/paneInsert':
      return isIndex(a.pane) && isPaneContent(a.sessionId) && (a.edge === 'left' || a.edge === 'right' || a.edge === 'top' || a.edge === 'bottom');
    case 'ui/paneRemove':
    case 'ui/activePane':
      return isIndex(a.pane);
    case 'ui/tree':
      return [1, 2, 3, 4].some((n) => isValidTree(a.tree, n));
    case 'ui/sidebar':
      return (a.width === undefined || (typeof a.width === 'number' && Number.isFinite(a.width))) && (a.collapsed === undefined || typeof a.collapsed === 'boolean');
    case 'settings/set':
      return typeof a.patch === 'object' && a.patch !== null;
    default:
      return false;
  }
}

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return typeof v === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Valor por valor: un ajuste inválido se descarta en vez de dejar la app sin arrancar. */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const shortcuts: Record<string, string> = {};
  if (typeof r.shortcuts === 'object' && r.shortcuts !== null && !Array.isArray(r.shortcuts)) {
    for (const [k, v] of Object.entries(r.shortcuts)) {
      if (typeof v === 'string' && v.length <= 64 && /^[\w]{1,32}$/.test(k)) shortcuts[k] = v;
    }
  } else {
    Object.assign(shortcuts, base.shortcuts);
  }
  const fontFamily = typeof r.fontFamily === 'string' && r.fontFamily.trim() && r.fontFamily.length <= 100 && !/["\\;{}]/.test(r.fontFamily) ? r.fontFamily.trim() : base.fontFamily;
  return {
    fontFamily,
    fontSize: clamp(r.fontSize, 9, 32, base.fontSize),
    lineHeight: clamp(r.lineHeight, 1, 2, base.lineHeight),
    scrollback: Math.round(clamp(r.scrollback, 500, 100_000, base.scrollback)),
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : base.theme,
    terminalColors: r.terminalColors === 'campbell' || r.terminalColors === 'hilo' ? r.terminalColors : base.terminalColors,
    claudePath: typeof r.claudePath === 'string' && r.claudePath.length <= MAX_PATH ? r.claudePath : base.claudePath,
    startup: r.startup === 'restore' || r.startup === 'asleep' || r.startup === 'wakeLast' || r.startup === 'wakeAll' ? r.startup : base.startup,
    wakeOnSelect: typeof r.wakeOnSelect === 'boolean' ? r.wakeOnSelect : base.wakeOnSelect,
    autoSleepMinutes: Math.round(clamp(r.autoSleepMinutes, 0, 1440, base.autoSleepMinutes)),
    notifications: typeof r.notifications === 'boolean' ? r.notifications : base.notifications,
    useHooks: typeof r.useHooks === 'boolean' ? r.useHooks : base.useHooks,
    skipPermissions: typeof r.skipPermissions === 'boolean' ? r.skipPermissions : base.skipPermissions,
    confirmMultilinePaste: typeof r.confirmMultilinePaste === 'boolean' ? r.confirmMultilinePaste : base.confirmMultilinePaste,
    shortcuts,
    appZoom: Math.round(clamp(r.appZoom, 80, 150, base.appZoom)),
    scrollbarAlways: typeof r.scrollbarAlways === 'boolean' ? r.scrollbarAlways : base.scrollbarAlways,
    wheelSpeed: Math.round(clamp(r.wheelSpeed, 25, 300, base.wheelSpeed)),
    touchpadSpeed: Math.round(clamp(r.touchpadSpeed, 10, 100, base.touchpadSpeed)),
    checkUpdatesOnStart: typeof r.checkUpdatesOnStart === 'boolean' ? r.checkUpdatesOnStart : base.checkUpdatesOnStart,
    setupSeen: typeof r.setupSeen === 'boolean' ? r.setupSeen : base.setupSeen,
    changesShowSigns: typeof r.changesShowSigns === 'boolean' ? r.changesShowSigns : base.changesShowSigns,
    changesFullFile: typeof r.changesFullFile === 'boolean' ? r.changesFullFile : base.changesFullFile,
  };
}
