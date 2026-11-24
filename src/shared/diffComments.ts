/**
 * Comentarios que la persona deja en líneas del diff para pasárselos a Claude. Lógica pura: sin Electron ni DOM.
 * Viven solo en memoria del renderer (no van al disco ni a `state.json`) y se pegan en una sesión sin Enter.
 */
import { sanitizePaste } from './paste';

/** `new`: la línea del archivo actual. `old`: una línea quitada, que ya no está en el archivo. */
export type CommentSide = 'new' | 'old';

export interface DiffComment {
  /** Para borrar o reemplazar uno concreto; solo vale dentro de esta ejecución. */
  id: number;
  /** Relativa a la carpeta del proyecto, con `/`. */
  path: string;
  line: number;
  side: CommentSide;
  /** El código de esa línea cuando se comentó: sirve de contexto aunque el archivo cambie después. */
  code: string;
  text: string;
}

/** Más comentarios que esto no caben en una sesión razonable. */
export const MAX_COMMENTS = 100;
/** Por comentario. */
export const MAX_COMMENT_CHARS = 2000;
/** Del contexto de código. */
export const MAX_CONTEXT_CHARS = 160;
/** Todo el bloque pegado: pasado esto, los últimos se quedan fuera y se avisa. */
export const MAX_PASTE_CHARS = 30_000;

const INDENT = '    ';

/** Una línea, sin saltos ni tabuladores ni caracteres de control. */
function oneLine(text: string): string {
  return sanitizePaste(text.replace(/[\r\n\t\v\f\u2028\u2029]+/g, ' ')).trim();
}

function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/** `código` entre comillas invertidas; con comillas dentro, se usa un delimitador más largo, como en Markdown. */
export function inlineCode(code: string): string {
  const flat = cut(oneLine(code), MAX_CONTEXT_CHARS);
  if (!flat) return '';
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return longest > 0 ? `${fence} ${flat} ${fence}` : `${fence}${flat}${fence}`;
}

/** El texto de un comentario: sin caracteres de control, sin líneas vacías y sin pasarse del tope. */
export function commentLines(text: string): string[] {
  const body = cut(text, MAX_COMMENT_CHARS);
  return body
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map(oneLine)
    .filter((l) => l !== '');
}

/** Orden estable: por archivo, luego por línea (las quitadas después de la nueva de la misma línea) y al final por antigüedad. */
export function sortComments(list: readonly DiffComment[]): DiffComment[] {
  return [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.side === b.side ? 0 : a.side === 'new' ? -1 : 1) || a.id - b.id));
}

export interface BuiltPaste {
  /** Lo que se pega. Vacío si no hay nada que pegar. */
  text: string;
  /** Los ids que sí entraron. */
  included: number[];
  /** Cuántos quedaron fuera por el tope. */
  omitted: number;
}

/**
 * Arma el bloque a pegar: una entrada por comentario, `archivo:línea: comentario`, y debajo, con sangría,
 * el código comentado entre comillas invertidas. Un comentario de varias líneas sigue con sangría. No termina
 * en salto de línea: nunca llega un Enter a la sesión.
 */
export function buildCommentsPaste(list: readonly DiffComment[], maxChars = MAX_PASTE_CHARS): BuiltPaste {
  const blocks: string[] = [];
  const included: number[] = [];
  let total = 0;
  let omitted = 0;
  for (const c of sortComments(list)) {
    const [first, ...rest] = commentLines(c.text);
    if (first === undefined) continue;
    const place = `${oneLine(c.path) || '?'}:${Math.max(1, Math.trunc(c.line) || 1)}${c.side === 'old' ? ' (antes)' : ''}`;
    const out = [`${place}: ${first}`, ...rest.map((l) => `${INDENT}${l}`)];
    const code = inlineCode(c.code);
    if (code) out.push(`${INDENT}${code}`);
    const block = out.join('\n');
    // +1 por el salto que lo separa del anterior. El primero siempre entra: un solo comentario no se pierde.
    if (blocks.length > 0 && total + block.length + 1 > maxChars) {
      omitted++;
      continue;
    }
    total += block.length + (blocks.length > 0 ? 1 : 0);
    blocks.push(block);
    included.push(c.id);
  }
  return { text: blocks.join('\n'), included, omitted };
}

/** La clave de una línea comentable: un archivo, un lado y un número. */
export const commentKey = (path: string, side: CommentSide, line: number): string => `${path}|${side}|${line}`;
