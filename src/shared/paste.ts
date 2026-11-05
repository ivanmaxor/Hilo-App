/**
 * Limpia el texto antes de `term.paste()`. Igual que Windows Terminal: se eliminan
 * C0 y C1 salvo tab, LF y CR. Así un portapapeles con `ESC[201~` no puede salirse
 * del bracketed paste ni ejecutar nada.
 */
export function sanitizePaste(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

function trimEnd(line: string): string {
  let end = line.length;
  while (end > 0) {
    const c = line.charCodeAt(end - 1);
    if (c !== 32 && c !== 9) break;
    end--;
  }
  return line.slice(0, end);
}

/**
 * Quita los espacios al final de cada línea sin tocar la sangría.
 * `getSelection()` de xterm ya une las líneas que la terminal envolvió.
 * Va línea por línea: una expresión regular tarda segundos con una tirada larga de espacios.
 */
export function cleanCopy(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((part, i) => (i % 2 === 1 ? part : trimEnd(part)))
    .join('');
}

/** Sin nada que no sea espacio o salto: una selección así no se copia. */
export function isBlankSelection(text: string): boolean {
  return text.trim() === '';
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 32) n++;
  return n;
}

/** Ancho aproximado en celdas: CJK y emoji ocupan dos. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return width;
}

/** CJK sin espacios entre palabras. El coreano sí los lleva. */
function isCjk(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0)!;
  return (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60) || (code >= 0x20000 && code <= 0x3fffd);
}

/** Empieza un elemento nuevo: una lista o una fila de tabla no se pega a la anterior. */
const STARTS_ITEM = /^(?:[-*+•●⎿|]\s|\d+[.)]\s|\|)/;
/** Con esta sangría colgante continúan las filas de un elemento de lista. */
const BULLET = /^(\s*(?:[-*+•]|\d+[.)])\s+)/;
/** Una línea que termina así es código o una tabla. */
const ENDS_BLOCK = /[;{}([<|]$/;
/** Estos cierran también una frase: solo cuentan si la fila no llegó al borde. */
const ENDS_BRACKET = /[)\]>]$/;
const BOX = /[\u2500-\u257f]/;
/** Líneas que empiezan así suelen ser una lista: rutas, enlaces, hashes. */
const ENTRY_START = /^(?:[A-Za-z]:[\\/]|https?:\/\/|\.{0,2}[\\/]|[0-9a-f]{7,40}\s)/;
const LAST_TOKEN = /\S+$/;
/** Una línea de código: asignación o palabra clave al inicio. */
const CODE_START = /^(?:[\w.[\]]+ = |[\w.-]+: |\S+\s+--?\w|(?:const|let|var|def|class|import|function|return|npm|npx|pnpm|yarn|node|git|cd|docker|python|pip|curl)\s)/;

const RELATIVE_PATH = /^[\w.-]+[\\/]\S*$/;
const PLAIN_WORD = /^\p{L}+[,.;:!?)]?$/u;
/** Solo esto empieza un token propio. Una barra sola puede ser el resto de una ruta cortada. */
const TOKEN_START = /^(?:[A-Za-z]:[\\/]|https?:\/\/)/;
/** Ninguna palabra acaba así: lo que sigue es su continuación, sea lo que sea. */
const OPEN_ENDED = /[/\\:(=_?&#-]$/;

/**
 * Claude solo corta dentro de una palabra si no cabría entera en una fila: si no, la pasa completa a
 * la siguiente. Así que un corte a la fuerza es un token que, unido, no entraría en una fila.
 * Un token entero también puede acabar justo en el borde: ante la duda se trata como palabras
 * separadas, porque un espacio de más se ve y una palabra pegada no.
 */
function isCutToken(line: string, end: number, next: string, room: number, cols: number): boolean {
  if (end < cols - 1) return false;
  const token = LAST_TOKEN.exec(line)?.[0] ?? '';
  if (cellWidth(token) + cellWidth(next) <= room) return false;
  // Lo que sigue empieza un token propio: no es la continuación de nada.
  if (TOKEN_START.test(next)) return false;
  return OPEN_ENDED.test(token) || !PLAIN_WORD.test(next);
}

/**
 * "Copiar uniendo líneas": Claude Code corta las líneas largas con saltos reales,
 * y esas no se distinguen de un salto normal. La señal de un corte automático es que
 * la primera palabra de la línea siguiente no habría cabido en la anterior.
 * También quita el margen común. Es heurístico, por eso se ofrece aparte de copiar.
 *
 * `startCol` es la columna donde empieza la selección: la primera línea casi nunca
 * empieza en el margen, porque abre con la viñeta de Claude o a media fila.
 */
export function joinHardWrapped(text: string, cols: number, startCol = 0): string {
  const lines = text.split(/\r?\n/).map(trimEnd);
  // La primera línea solo cuenta si empieza de verdad en el margen, sin viñeta ni a media fila.
  const firstCounts = startCol === 0 && !STARTS_ITEM.test(lines[0] ?? '');
  const margin = (firstCounts ? lines : lines.slice(1)).reduce((min, l) => (l ? Math.min(min, leadingSpaces(l)) : min), Number.MAX_SAFE_INTEGER);
  const strip = margin === Number.MAX_SAFE_INTEGER ? 0 : margin;
  // Claude deja dos celdas libres al envolver. Lo que parece otra línea lo filtra looksSeparate.
  const width = Math.max(20, cols - 2);
  const out: string[] = [];
  let previous = '';
  let previousBody = '';
  let previousEnd = 0;
  let hang = 0;
  lines.forEach((line, i) => {
    const body = line.slice(Math.min(strip, leadingSpaces(line)));
    const indent = leadingSpaces(body);
    const text = body.trimStart();
    const firstWord = text.split(/\s/, 1)[0] ?? '';
    const span = (i === 0 ? startCol : 0) + cellWidth(line);
    // getSelection ya une lo que la terminal envolvió: importa dónde acaba su última fila.
    const lineEnd = span > cols ? ((span - 1) % cols) + 1 : span;
    const cut = isCutToken(previous, previousEnd, firstWord, Math.max(20, cols - strip - hang), cols);
    const isContinuation = indent === 0 || (hang > 0 && indent === hang);
    // Un token cortado a la fuerza puede acabar o seguir en cualquier carácter: esas señales no cuentan.
    const looksSeparate =
      !cut &&
      (ENDS_BLOCK.test(previous) ||
        (ENDS_BRACKET.test(previous) && previousEnd < cols - 1) ||
        previous.endsWith(':') ||
        CODE_START.test(text) ||
        (ENTRY_START.test(text) && ENTRY_START.test(previousBody.trimStart())) ||
        (RELATIVE_PATH.test(text) && RELATIVE_PATH.test(previousBody.trim())) ||
        previous.endsWith('\\'));
    const blocked = !isContinuation || STARTS_ITEM.test(text) || BOX.test(previous) || BOX.test(text.charAt(0)) || looksSeparate;
    const wrapped = i > 0 && text !== '' && previous !== '' && !blocked && (cut || previousEnd + 1 + cellWidth(firstWord) > width);
    if (wrapped) {
      const joined = out[out.length - 1]!;
      const tight = cut || (isCjk([...joined].pop()) && isCjk([...text][0]));
      out[out.length - 1] = tight ? joined + text : `${joined} ${text}`;
    } else {
      out.push(body);
      hang = BULLET.exec(body)?.[1]?.length ?? 0;
    }
    previous = line;
    previousBody = body;
    previousEnd = lineEnd;
  });
  return out.join('\r\n');
}
