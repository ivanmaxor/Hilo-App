/**
 * Rutas de archivos en el texto de una terminal (#10, D35). Aquí solo se detectan candidatas: si existen,
 * y dónde, lo decide el proceso principal. Una candidata que no existe no se subraya.
 */

export interface PathCandidate {
  /** Dónde empieza en el texto. */
  start: number;
  /** Dónde termina, sin incluir. */
  end: number;
  /** La ruta tal como se escribió, sin el `@` de Claude ni el número de línea. */
  path: string;
  /** El número de línea que venía detrás (`a.ts:12`, `a.ts#L12`), si venía. */
  line: number | null;
}

/** Lo que corta una ruta: espacios, comillas, paréntesis y los adornos de la pantalla de Claude. */
const TOKEN = /[^\s"'`<>|()[\]{}│┃┆─━╭╮╰╯┌┐└┘├┤⎿●❯✻✳✶✢·…⏺→←]+/gu;
const TRAILING = /[.,;:!?¡¿»]+$/;
const LINE_SUFFIX =
  /^(.*?)(?::(\d{1,7})(?:[:-]\d{1,7})?|#L(\d{1,7})(?:-L?\d{1,7})?)$/;
const WIN_ABS = /^[A-Za-z]:[\\/]/;
/** `/c/Proyectos/...`, como escriben las rutas Git Bash y a veces Claude. */
const DRIVE_POSIX = /^\/([A-Za-z])\//;
/** Una ruta que empieza por una carpeta de la persona (`Documentos/...`, `~/...`): su nombre puede tener espacios. */
const USER_START =
  /^(?:~|documentos|documents|escritorio|desktop|descargas|downloads|im[aá]genes|pictures|m[uú]sica|music|v[ií]deos|videos)[\\/]/i;
const MAX_LENGTH = 400;
/** Cuántas palabras más se prueban tras una ruta absoluta o de una carpeta de la persona, por si su nombre tiene espacios. */
const MAX_SPACED_WORDS = 5;
/** Una línea con más candidatas que esto es otra cosa (un volcado, una tabla): no se mira entera. */
const MAX_CANDIDATES = 40;

/** Quita la puntuación del final y separa el número de línea. null si lo que queda no puede ser una ruta. */
function parse(
  raw: string,
): { path: string; line: number | null; length: number } | null {
  let text = raw;
  // La puntuación de una frase ("mira src/a.ts.") no es parte de la ruta, pero `a.ts:12:` sí trae su línea.
  for (;;) {
    const trimmed = text.replace(TRAILING, "");
    const suffix = LINE_SUFFIX.exec(text);
    if (suffix || trimmed === text) break;
    text = trimmed;
  }
  const length = text.length;
  let line: number | null = null;
  const suffix = LINE_SUFFIX.exec(text);
  if (suffix && suffix[1]) {
    text = suffix[1];
    line = Number(suffix[2] ?? suffix[3]) || null;
  }
  if (text.startsWith("@")) text = text.slice(1);
  text = text.replace(TRAILING, "");
  return isPathLike(text) ? { path: text, line, length } : null;
}

function isPathLike(text: string): boolean {
  if (text.length < 3 || text.length > MAX_LENGTH) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (text.startsWith("-")) return false;
  // Red (`\\servidor`, `//servidor`) y enlaces web no: abrirlos sería una conexión.
  if (/^[\\/]{2}/.test(text) || text.includes("://")) return false;
  const colon = text.indexOf(":");
  if (colon !== -1 && !(colon === 1 && WIN_ABS.test(text))) return false;
  if (colon !== -1 && text.indexOf(":", 2) !== -1) return false;
  if (WIN_ABS.test(text) || DRIVE_POSIX.test(text)) return true;
  if (text.startsWith("/")) return false;
  if (/[\\/]/.test(text)) return true;
  // Un nombre suelto: `package.json`, `.env`. La extensión empieza con letra, así `1.2.3` no cuenta.
  return /^[^\\/]*\.[\p{L}][\p{L}\p{N}_-]{0,11}$/u.test(text);
}

/**
 * Las rutas que podría haber en `text`. Pueden solaparse: tras una ruta absoluta se prueban también las
 * versiones con las palabras siguientes, por si el nombre tiene espacios. `pickLinks` elige entre ellas.
 */
export function findPathCandidates(text: string): PathCandidate[] {
  const out: PathCandidate[] = [];
  TOKEN.lastIndex = 0;
  for (
    let match = TOKEN.exec(text);
    match && out.length < MAX_CANDIDATES;
    match = TOKEN.exec(text)
  ) {
    const start = match.index;
    const parsed = parse(match[0]);
    if (parsed)
      out.push({
        start,
        end: start + parsed.length,
        path: parsed.path,
        line: parsed.line,
      });
    const raw = match[0].startsWith("@") ? match[0].slice(1) : match[0];
    if (!WIN_ABS.test(raw) && !DRIVE_POSIX.test(raw) && !USER_START.test(raw))
      continue;
    // `C:\Mis documentos\informe final.pdf`: se agregan palabras mientras las separe un solo espacio.
    let end = start + match[0].length;
    for (
      let words = 0;
      words < MAX_SPACED_WORDS && text[end] === " ";
      words++
    ) {
      TOKEN.lastIndex = end + 1;
      const next = TOKEN.exec(text);
      if (!next || next.index !== end + 1) break;
      end = next.index + next[0].length;
      const spaced = parse(text.slice(start, end));
      if (spaced)
        out.push({
          start,
          end: start + spaced.length,
          path: spaced.path,
          line: spaced.line,
        });
    }
    TOKEN.lastIndex = start + match[0].length;
  }
  // El proceso principal no responde a más que esto de una vez.
  return out.slice(0, MAX_CANDIDATES);
}

/** De las candidatas que existen, las que se subrayan: la más larga gana cuando se solapan. */
export function pickLinks<T extends PathCandidate>(
  candidates: T[],
  exists: boolean[],
): T[] {
  const found = candidates
    .filter((_, i) => exists[i])
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: T[] = [];
  for (const candidate of found) {
    const last = out[out.length - 1];
    if (last && candidate.start < last.end) continue;
    out.push(candidate);
  }
  return out;
}

/** La ruta de un enlace `file:///C:/...` de la terminal. null si es otra cosa o apunta a un servidor. */
export function fileUriToPath(uri: string): string | null {
  const match = /^file:\/\/(?:localhost)?\/([A-Za-z]:\/.*)$/i.exec(uri);
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[1]!.split(/[?#]/)[0]!);
    return /[\x00-\x1f]/.test(path) ? null : path;
  } catch {
    return null;
  }
}

/** Lo que el proceso principal sabe de una ruta que existe. */
export interface TerminalPath {
  /** La ruta completa. */
  abs: string;
  dir: boolean;
  /** Relativa al proyecto, con `/`, si queda dentro: la que acepta el IDE del proyecto. */
  rel: string | null;
}
