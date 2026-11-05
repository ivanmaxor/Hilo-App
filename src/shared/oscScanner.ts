/**
 * Escáner de títulos OSC 0 y 2 para flujos partidos en trozos arbitrarios.
 * Claude termina los OSC con ST (ESC \); ConPTY del sistema los normaliza a BEL.
 * Se aceptan los dos.
 */
const MAX_OSC = 4096;

export class OscTitleScanner {
  private pending = '';

  /** Devuelve los títulos completos encontrados en este trozo, en orden. */
  feed(chunk: string): string[] {
    const titles: string[] = [];
    let data = this.pending ? this.pending + chunk : chunk;
    this.pending = '';
    let pos = 0;
    for (;;) {
      const start = data.indexOf('\x1b]', pos);
      if (start < 0) {
        // Un ESC al final puede ser el inicio de un OSC partido.
        if (data.endsWith('\x1b')) this.pending = '\x1b';
        return titles;
      }
      const end = findTerminator(data, start + 2);
      if (end === null) {
        const rest = data.slice(start);
        // Secuencia demasiado larga: no es un título, se descarta.
        if (rest.length <= MAX_OSC) this.pending = rest;
        return titles;
      }
      const title = end.aborted ? null : parseTitle(data.slice(start + 2, end.index));
      if (title !== null) titles.push(title);
      pos = end.next;
    }
  }
}

function findTerminator(data: string, from: number): { index: number; next: number; aborted?: boolean } | null {
  for (let i = from; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c === 0x07) return { index: i, next: i + 1 };
    if (c === 0x1b) {
      if (i + 1 >= data.length) return null;
      if (data.charCodeAt(i + 1) === 0x5c) return { index: i, next: i + 2 };
      // ESC seguido de otra cosa: OSC abortado, el contenido no sirve.
      return { index: i, next: i, aborted: true };
    }
  }
  return null;
}

function parseTitle(body: string): string | null {
  const semi = body.indexOf(';');
  if (semi < 0) return null;
  const code = body.slice(0, semi);
  return code === '0' || code === '2' ? body.slice(semi + 1) : null;
}

export type TitleKind = 'working' | 'ready' | 'other';

/**
 * Observado en Claude Code 2.1.316: `◐ ◑` (U+25D0, U+25D1) mientras trabaja y
 * `✳` (U+2733) sin trabajar. Se tolera braille por si vuelve en otra versión.
 */
export function classifyTitle(title: string): TitleKind {
  const first = title.codePointAt(0);
  if (first === undefined) return 'other';
  if (first === 0x25d0 || first === 0x25d1) return 'working';
  if (first >= 0x2801 && first <= 0x28ff) return 'working';
  if (first === 0x2733) return 'ready';
  return 'other';
}
