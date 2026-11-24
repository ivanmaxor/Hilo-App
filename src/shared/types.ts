import type { PaneEdge, PaneNode } from './paneLayout';
import type { SoundChoice } from './sounds';
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
  /** Un emoji o símbolo a elección, delante del nombre. */
  mark?: string;
  /** Marcada a mano como no leída: se quita al abrirla. */
  unread?: boolean;
  /** Una nota de la persona, que se ve aunque la sesión esté dormida. */
  note?: string;
  /** El último mensaje, de la persona o de Claude, en milisegundos. */
  lastActiveAt?: number;
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
  /** Sonido al terminar, al esperarte y al fallar (D32). 'none' = sin sonido. */
  soundDone: SoundChoice;
  soundWaiting: SoundChoice;
  soundError: SoundChoice;
  /** De 0 a 100. */
  soundVolume: number;
  /** Minutos entre repeticiones mientras nadie la atiende; 0 = una vez. */
  soundRepeat: number;
  /** Segundos que suena cada aviso, repitiendo el sonido seguido; 0 = una pasada. */
  soundDuration: number;
  /** Sonar también si la sesión está a la vista. */
  soundAlways: boolean;
  /** Nombre del archivo del sonido propio (#12); vacío si no hay. El audio se guarda en la carpeta de datos. */
  customSoundName: string;
  /** Avisos de uso del plan (#8): umbrales en % para la sesión de 5 horas y para la semana. */
  usageAlerts: boolean;
  usageAlertSession: number[];
  usageAlertWeek: number[];
  usageAlertNotify: boolean;
  usageAlertSound: SoundChoice;
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
  /** Claude con su pantalla clásica (como `/tui default`), para que el historial se desplace en Hilo (D31). */
  classicRenderer: boolean;
  /** La versión cuyas novedades ya se avisaron (D27). Vacío en una instalación nueva. */
  lastSeenVersion: string;
  /** Los últimos colores elegidos fuera de la paleta, del más nuevo al más viejo. */
  recentColors: string[];
  /** Colorear las sesiones de Claude sin mensajes desde hace 1 h, 5 h y 1 día (D30). */
  staleMarks: boolean;
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
  /** La carpeta de la sesión ya no existe: es la ruta que falta. El panel deja elegir otra. */
  missingCwd?: string;
  /** Su historial existe pero Claude no pudo retomarlo: el panel deja empezar una conversación nueva, a elección de la persona. */
  unresumable?: boolean;
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
  | { type: 'session/mark'; id: string; mark: string | null }
  | { type: 'session/unread'; id: string; unread: boolean }
  | { type: 'session/note'; id: string; note: string }
  /** Solo las dispara el proceso principal: no están en la lista blanca del IPC. */
  | { type: 'session/adopt'; id: string; claudeId: string; cwd: string }
  | { type: 'session/active'; id: string; at: number }
  /** Solo la dispara el proceso principal, con la carpeta que eligió la persona: no está en la lista blanca del IPC. */
  | { type: 'session/cwd'; id: string; cwd: string }
  /**
   * Solo la dispara el proceso principal (#7): la carpeta nueva sale del diálogo de Windows y no está en la lista blanca del IPC.
   * Cambia la del proyecto y la de las sesiones que traen su carpeta nueva, todo junto. Solo cuentan las del proyecto
   * que estaban dentro de la carpeta vieja.
   */
  | { type: 'project/relocate'; id: string; path: string; sessions: { id: string; cwd: string }[] }
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

/** Una sesión de un proyecto cuya carpeta estaba dentro de la que se cambia (#7). */
export interface RelocateSession {
  id: string;
  name: string;
  kind: SessionKind;
  /** Su carpeta de hoy existe. */
  exists: boolean;
  /** Lo que tiene de más que la carpeta del proyecto, o '' si es la misma. */
  sub: string;
}

/** Primer paso de cambiar la carpeta de un proyecto: la ruta elegida se queda en el proceso principal; aquí solo vuelve para mostrarla. */
export type RelocatePick =
  | { status: 'cancelled' }
  | { status: 'problem'; message: string }
  | {
      status: 'ok';
      /** De un solo uso: el segundo paso lo canjea por la ruta guardada en el proceso principal. */
      token: string;
      from: string;
      to: string;
      sessions: RelocateSession[];
      /** Sesiones del proyecto que usan otra carpeta y no se tocan. */
      outside: number;
      /** De esas, las que tampoco encuentran su carpeta. */
      outsideMissing: number;
    };

export type RelocateResult =
  | { ok: false; message: string }
  | {
      ok: true;
      moved: number;
      /** No tenían su subcarpeta en la nueva y quedaron en la raíz. */
      fellBack: number;
      /** Sesiones movidas que tienen proceso: siguen en la carpeta vieja hasta dormirlas y despertarlas. */
      awake: string[];
    };

export type ChangeFolderResult =
  | { ok: false; message?: string }
  | { ok: true; awake: boolean; wasMissing: boolean };
