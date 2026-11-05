export interface ShortcutDef {
  id: string;
  label: string;
  defaultKeys: string;
}

/** Ver docs/investigacion/R4: ninguno choca con Claude Code ni con PSReadLine. */
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'newClaude', label: 'Nueva sesión de Claude', defaultKeys: 'Ctrl+Shift+T' },
  { id: 'newShell', label: 'Nueva PowerShell', defaultKeys: 'Ctrl+Shift+H' },
  { id: 'newProject', label: 'Nuevo proyecto', defaultKeys: 'Ctrl+Shift+N' },
  { id: 'closeSession', label: 'Cerrar sesión', defaultKeys: 'Ctrl+Shift+W' },
  { id: 'rename', label: 'Renombrar', defaultKeys: 'F2' },
  { id: 'toggleSleep', label: 'Dormir o despertar', defaultKeys: 'Ctrl+Shift+Z' },
  { id: 'quickOpen', label: 'Selector rápido', defaultKeys: 'Ctrl+Shift+K' },
  { id: 'nextSession', label: 'Siguiente sesión', defaultKeys: 'Ctrl+Tab' },
  { id: 'prevSession', label: 'Sesión anterior', defaultKeys: 'Ctrl+Shift+Tab' },
  { id: 'nextAttention', label: 'Siguiente que requiere atención', defaultKeys: 'Ctrl+Shift+U' },
  { id: 'search', label: 'Buscar en la terminal', defaultKeys: 'Ctrl+Shift+F' },
  { id: 'copyJoined', label: 'Copiar uniendo líneas', defaultKeys: 'Ctrl+Shift+J' },
  { id: 'toggleChanges', label: 'Ver los cambios del proyecto', defaultKeys: 'Ctrl+Shift+G' },
  { id: 'zoomIn', label: 'Aumentar fuente', defaultKeys: 'Ctrl+=' },
  { id: 'zoomOut', label: 'Reducir fuente', defaultKeys: 'Ctrl+-' },
  { id: 'zoomReset', label: 'Fuente normal', defaultKeys: 'Ctrl+0' },
  { id: 'toggleSidebar', label: 'Mostrar u ocultar la barra lateral', defaultKeys: 'Ctrl+Shift+B' },
  { id: 'layout1', label: 'Vista de 1 terminal', defaultKeys: 'Ctrl+Shift+1' },
  { id: 'layout2', label: 'Vista de 2 terminales', defaultKeys: 'Ctrl+Shift+2' },
  { id: 'layout3', label: 'Vista de 3 terminales', defaultKeys: 'Ctrl+Shift+3' },
  { id: 'layout4', label: 'Vista de 4 terminales', defaultKeys: 'Ctrl+Shift+4' },
  { id: 'paneLeft', label: 'Panel de la izquierda', defaultKeys: 'Ctrl+Alt+ArrowLeft' },
  { id: 'paneRight', label: 'Panel de la derecha', defaultKeys: 'Ctrl+Alt+ArrowRight' },
  { id: 'paneUp', label: 'Panel de arriba', defaultKeys: 'Ctrl+Alt+ArrowUp' },
  { id: 'paneDown', label: 'Panel de abajo', defaultKeys: 'Ctrl+Alt+ArrowDown' },
  { id: 'settings', label: 'Ajustes', defaultKeys: 'Ctrl+,' },
  { id: 'fullscreen', label: 'Pantalla completa', defaultKeys: 'F11' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    id: `go${n}`,
    label: `Ir a la sesión ${n}`,
    defaultKeys: `Ctrl+${n}`,
  })),
];

type KeyEventLike = Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'key' | 'code'>;

/**
 * Combinación canónica de un evento. Letras y dígitos salen de `code`, para que
 * Ctrl+Shift+1 funcione en teclado español, donde esa tecla produce "!".
 */
export function eventToKeys(e: KeyEventLike): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(baseKey(e));
  return parts.join('+');
}

function baseKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return '=';
  if (e.key === '-' || e.code === 'NumpadSubtract') return '-';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}

export function isModifierOnly(e: Pick<KeyboardEvent, 'key'>): boolean {
  return e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'AltGraph';
}

/** Mapa de combinación a acción, con lo que el usuario haya cambiado. */
export function buildKeymap(overrides: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of SHORTCUTS) {
    const keys = overrides[def.id] ?? def.defaultKeys;
    if (keys) map.set(keys, def.id);
  }
  return map;
}

/** Combinaciones que Claude Code usa y por eso no se pueden asignar sin avisar. */
export const CLAUDE_RESERVED = new Set([
  'Ctrl+C', 'Ctrl+D', 'Ctrl+G', 'Ctrl+J', 'Ctrl+K', 'Ctrl+L', 'Ctrl+N', 'Ctrl+O', 'Ctrl+P',
  'Ctrl+R', 'Ctrl+S', 'Ctrl+T', 'Ctrl+U', 'Ctrl+V', 'Ctrl+B', 'Ctrl+F', 'Ctrl+X', 'Ctrl+Y',
  'Alt+V', 'Alt+P', 'Alt+T', 'Alt+O', 'Alt+M', 'Alt+B', 'Alt+F', 'Shift+Tab', 'Escape',
  'Ctrl+Shift+C', 'Ctrl+Shift+V', 'Ctrl+Insert', 'Shift+Insert',
  'Ctrl+A', 'Ctrl+E', 'Ctrl+W', 'Ctrl+Z', 'Ctrl+H', 'Ctrl+Enter', 'Alt+Enter', 'Shift+Enter',
  'Ctrl+I', 'Ctrl+M', 'Ctrl+[', 'Alt+D', 'Alt+Y', 'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+Shift+-', 'Ctrl+Shift+_', 'Alt+F4',
]);

/** Devuelve por qué no se puede usar esa combinación, o null si se puede. */
export function shortcutProblem(keys: string): string | null {
  if (keys === 'Alt+F4') return 'Alt+F4 cierra la ventana en Windows';
  if (CLAUDE_RESERVED.has(keys)) return `${prettyKeys(keys)} lo usa Claude Code`;
  const parts = keys.split('+');
  const base = parts[parts.length - 1]!;
  // En teclado español Ctrl+Alt es AltGr: Ctrl+Alt+Q dejaría sin la @.
  if (parts.includes('Ctrl') && parts.includes('Alt') && base.length === 1) return `${prettyKeys(keys)} es AltGr en muchos teclados: quitaría un carácter`;
  const hasModifier = parts.includes('Ctrl') || parts.includes('Alt');
  // Sin Ctrl ni Alt es escribir: la terminal dejaría de recibir esa tecla.
  if (!hasModifier && !/^F([1-9]|1[0-2])$/.test(base)) return 'Usa Ctrl o Alt con otra tecla';
  return null;
}

const KEY_LABEL: Record<string, string> = {
  ArrowLeft: 'Flecha izquierda',
  ArrowRight: 'Flecha derecha',
  ArrowUp: 'Flecha arriba',
  ArrowDown: 'Flecha abajo',
  '=': '+',
  Escape: 'Esc',
};

/** Como se le muestra al usuario. */
export function prettyKeys(keys: string): string {
  if (!keys) return 'Sin asignar';
  return keys
    .split('+')
    .map((k) => KEY_LABEL[k] ?? k)
    .join('+');
}
