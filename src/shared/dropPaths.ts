import { sanitizePaste } from './paste';
import { checkRelativePath } from './safePath';
import type { SessionKind } from './types';

/** Lo máximo que se pega de una sola vez: más sería un pegado enorme sin intención. */
export const MAX_DROPPED = 20;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

function unify(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * La ruta de `file` relativa a `cwd` si queda dentro, ya validada con `checkRelativePath`; si no, null.
 * Windows no distingue mayúsculas en las rutas: la comparación tampoco.
 */
export function relativeInside(file: string, cwd: string | null): string | null {
  if (!cwd) return null;
  const base = unify(cwd);
  const target = unify(file);
  if (!base || target.length <= base.length + 1) return null;
  if (target.slice(0, base.length).toLowerCase() !== base.toLowerCase() || target[base.length] !== '/') return null;
  return checkRelativePath(target.slice(base.length + 1));
}

/** Lo que PowerShell lee tal cual, sin comillas: letras, números y los separadores de una ruta. */
const SHELL_PLAIN = /^[A-Za-z0-9_\-.:\\/]+$/;

/**
 * En PowerShell, la ruta completa. Con espacios u otros caracteres va entre comillas simples, que PowerShell
 * no interpreta (en las dobles, `$` y el acento grave sí): una comilla del nombre se escribe doble.
 */
export function shellReference(file: string): string {
  return SHELL_PLAIN.test(file) ? file : `'${file.replace(/'/g, "''")}'`;
}

/**
 * Claude: `@ruta` dentro de la carpeta de la sesión; fuera, la ruta completa entre comillas.
 * PowerShell no conoce `@ruta` (ahí `@` es otra cosa): recibe la ruta completa (`shellReference`).
 */
export function dropReference(file: string, cwd: string | null, kind: SessionKind = 'claude'): string {
  if (kind === 'shell') return shellReference(file);
  const rel = relativeInside(file, cwd);
  if (rel !== null) return /\s/.test(rel) ? `@"${rel}"` : `@${rel}`;
  return `"${file}"`;
}

export interface DropText {
  /** Lo que se pega, ya limpio. Vacío si no quedó nada. */
  text: string;
  /** Cuántas rutas entraron. */
  used: number;
  /** Las que no entraron por el tope. */
  overLimit: number;
  /** Las que se descartaron por tener caracteres de control: pegarlas cambiaría el nombre. */
  rejected: number;
}

/**
 * Arma el texto de un arrastre: una referencia por archivo, separadas por un espacio y sin Enter.
 * El resultado pasa por `sanitizePaste` aunque ya no deba quedar nada que quitar.
 */
export function buildDropText(paths: string[], cwd: string | null, kind: SessionKind = 'claude'): DropText {
  const refs: string[] = [];
  let rejected = 0;
  let overLimit = 0;
  for (const file of paths) {
    if (typeof file !== 'string' || file === '' || CONTROL.test(file)) {
      rejected++;
      continue;
    }
    if (refs.length >= MAX_DROPPED) {
      overLimit++;
      continue;
    }
    refs.push(dropReference(file, cwd, kind));
  }
  return { text: sanitizePaste(refs.join(' ')), used: refs.length, overLimit, rejected };
}
