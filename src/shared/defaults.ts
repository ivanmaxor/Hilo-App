import type { PersistedState, Settings, UiState } from './types';

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: 'Cascadia Mono',
  // La misma celda que Windows Terminal por defecto (12 pt): 9 x 19 px.
  fontSize: 16,
  lineHeight: 1,
  scrollback: 3000,
  theme: 'dark',
  // El requisito es verse igual que en Windows Terminal, también en los colores.
  terminalColors: 'campbell',
  claudePath: '',
  // Al abrir, las que estaban encendidas al cerrar la app o apagar el PC.
  startup: 'restore',
  wakeOnSelect: true,
  autoSleepMinutes: 0,
  notifications: true,
  useHooks: true,
  // Quien lo quiera lo enciende en Ajustes: Claude ejecutaría todo sin preguntar.
  skipPermissions: false,
  confirmMultilinePaste: true,
  shortcuts: {},
  appZoom: 100,
  scrollbarAlways: true,
  wheelSpeed: 100,
  touchpadSpeed: 35,
  checkUpdatesOnStart: true,
  setupSeen: false,
  // Sin signos: quien no está acostumbrado a los diffs lee mejor solo el color y los números.
  changesShowSigns: false,
  changesFullFile: false,
};

export const DEFAULT_UI: UiState = {
  activeSessionId: null,
  layout: 1,
  panes: [null],
  activePane: 0,
  sidebarWidth: 248,
  sidebarCollapsed: false,
  awake: [],
  hiddenTabs: [],
};

export function defaultState(): PersistedState {
  return {
    version: 1,
    projects: [],
    settings: { ...DEFAULT_SETTINGS, shortcuts: {} },
    ui: { ...DEFAULT_UI, panes: [null] },
    window: { width: 1280, height: 800, maximized: false },
  };
}

/**
 * Paleta sin verde, amarillo ni rojo puros: esos colores son del estado.
 * Tonos de croma bajo y luminosidad parecida (R5).
 */
export const PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'azul', label: 'Azul', hex: '#6f9bd1' },
  { id: 'cian', label: 'Cian', hex: '#5fb0b7' },
  { id: 'violeta', label: 'Violeta', hex: '#a08fd6' },
  { id: 'lila', label: 'Lila', hex: '#c58cc4' },
  { id: 'rosa', label: 'Rosa', hex: '#d68fa8' },
  { id: 'cobre', label: 'Cobre', hex: '#c9956b' },
  { id: 'arena', label: 'Arena', hex: '#b5a585' },
  { id: 'pizarra', label: 'Pizarra', hex: '#8c98a8' },
];

export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
