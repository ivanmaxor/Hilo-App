import type { PaneEdge, PaneNode } from './paneLayout';
export type SessionKind = 'claude' | 'shell';

/** Estado que se ve en el ícono. `done` es el verde "no leído". */
export type SessionStatus =
  | 'asleep'
  | 'starting'
  | 'working'
  | 'idle'
  | 'done'
  | 'waiting'
  | 'error'
  | 'exited';

export interface SessionRecord {
  id: string;
  /** El `--session-id` de Claude Code. Normalmente igual a `id`. */
  claudeId: string;
  kind: SessionKind;
  name: string;
  color: string | null;
  /** Fijo desde la creación: Claude guarda la conversación por carpeta. */
  cwd: string;
  model?: string;
  effort?: string;
  createdAt: number;
}

/** El IDE de un proyecto. La ruta sale de la detección o del diálogo nativo, nunca del renderer. */
export interface IdeChoice {
  path: string;
  name: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  color: string | null;
  collapsed: boolean;
  sessions: SessionRecord[];
  ide?: IdeChoice;
}

export type StartupMode = 'restore' | 'asleep' | 'wakeLast' | 'wakeAll';
export type ThemeName = 'dark' | 'light';
export type TerminalColors = 'hilo' | 'campbell';

export interface Settings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  theme: ThemeName;
  terminalColors: TerminalColors;
  claudePath: string;
  startup: StartupMode;
  wakeOnSelect: boolean;
  autoSleepMinutes: number;
  notifications: boolean;
  useHooks: boolean;
  /** Lanza Claude con --dangerously-skip-permissions: decisión del dueño, ver docs/DECISIONES.md. */
  skipPermissions: boolean;
  /** Avisar antes de pegar varias líneas donde cada salto ejecuta, como PowerShell. */
  confirmMultilinePaste: boolean;
  shortcuts: Record<string, string>;
  /** Tamaño de toda la ventana, en %. */
  appZoom: number;
  scrollbarAlways: boolean;
  /** Velocidad de la rueda del ratón, en %. */
  wheelSpeed: number;
  /** Parte de los eventos del touchpad que se atienden, en %. */
  touchpadSpeed: number;
  /** Buscar versión nueva una vez al abrir. Nunca instala sin preguntar. */
  checkUpdatesOnStart: boolean;
  /** Ya se mostró la guía de requisitos: no vuelve a salir sola. */
  setupSeen: boolean;
  /** Uso del plan en la línea de estado de Claude y en la barra lateral (D25). */
  usageMeter: boolean;
  /** La versión cuyas novedades ya se avisaron (D27). Vacío en una instalación nueva. */
  lastSeenVersion: string;
  /** En el panel Cambios, los signos + y − además del color. */
  changesShowSigns: boolean;
  /** En el panel Cambios, todo el archivo en vez de solo las zonas cambiadas. */
  changesFullFile: boolean;
}

export type LayoutCount = 1 | 2 | 3 | 4;

export interface UiState {
  activeSessionId: string | null;
  layout: LayoutCount;
  /** Cada panel: una sesión, un panel Cambios (`changes:<proyecto>`, ver paneContent.ts) o null si espera que se elija. */
  panes: (string | null)[];
  /** Cómo se reparten los paneles. Sin él, el reparto normal para esa cantidad. */
  tree?: PaneNode;
  activePane: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** Las que tienen proceso. Sobrevive a cerrar la app o apagar el PC: al abrir vuelven a encenderse. */
  awake: string[];
  /** Pestañas cerradas: la sesión sigue en la barra lateral y con su proceso. */
  hiddenTabs: string[];
  /** El proyecto a la vista cuando se cerró su última pestaña y no hay sesión activa. */
  emptyProjectId?: string;
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface PersistedState {
  version: 1;
  projects: ProjectRecord[];
  settings: Settings;
  ui: UiState;
  window: WindowBounds;
}

export interface SessionRuntime {
  status: SessionStatus;
  /** Subagentes de esta sesión que siguen corriendo. */
  subagents?: number;
  exitCode?: number;
  /** Mensaje de error para mostrar en el panel, si no pudo arrancar. */
  message?: string;
}

export type RuntimeMap = Record<string, SessionRuntime>;

export interface BackgroundProcess {
  pid: number;
  name: string;
}

export interface AppInfo {
  version: string;
  windowsBuild: number;
  claudePath: string | null;
  isTest: boolean;
}

/** Dónde está cada programa que usa Hilo, o null si no está. */
export interface ToolCheck {
  claude: string | null;
  git: string | null;
}

export type Action =
  | { type: 'project/add'; project: ProjectRecord }
  | { type: 'project/rename'; id: string; name: string }
  | { type: 'project/color'; id: string; color: string | null }
  | { type: 'project/collapse'; id: string; collapsed: boolean }
  | { type: 'project/remove'; id: string }
  | { type: 'project/move'; id: string; toIndex: number }
  /** Solo la dispara el proceso principal: no está en la lista blanca del IPC. */
  | { type: 'project/ide'; id: string; ide: IdeChoice | null }
  | { type: 'session/add'; projectId: string; session: SessionRecord; index?: number }
  | { type: 'session/rename'; id: string; name: string }
  | { type: 'session/color'; id: string; color: string | null }
  | { type: 'session/remove'; id: string }
  | { type: 'session/claudeId'; id: string; claudeId: string }
  | { type: 'session/awake'; id: string; awake: boolean }
  | { type: 'session/move'; id: string; toProjectId: string; toIndex: number }
  | { type: 'ui/select'; id: string | null; inPlace?: boolean }
  | { type: 'ui/layout'; layout: LayoutCount }
  | { type: 'ui/pane'; pane: number; sessionId: string | null }
  | { type: 'ui/paneInsert'; pane: number; edge: PaneEdge; sessionId: string }
  | { type: 'ui/paneRemove'; pane: number }
  | { type: 'ui/activePane'; pane: number }
  | { type: 'ui/tabClose'; id: string }
  | { type: 'ui/tree'; tree: PaneNode }
  | { type: 'ui/sidebar'; width?: number; collapsed?: boolean }
  | { type: 'settings/set'; patch: Partial<Settings> }
  | { type: 'window/bounds'; bounds: WindowBounds };
