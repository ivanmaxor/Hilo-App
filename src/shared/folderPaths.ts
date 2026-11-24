/**
 * Comparar carpetas de Windows (#7). Sin tocar el disco: solo texto.
 *
 * Windows no distingue mayúsculas, acepta `\` y `/`, y `C:\Proy` no contiene a `C:\Proyecto`: se compara por
 * segmentos, no por prefijo de texto. Una ruta que no es absoluta (`proy`, `C:proy`, `\proy`) no se compara con nada.
 */

interface Parsed {
  /** `C:\` o `\\servidor\recurso\`, con la barra final. */
  root: string;
  /** Los segmentos tal como se escribieron, sin `.` ni `..`. */
  parts: string[];
}

const lower = (s: string): string => s.toLowerCase();

function parse(path: string): Parsed | null {
  if (typeof path !== 'string' || path === '' || path.includes('\0')) return null;
  let s = path.replace(/\//g, '\\');
  // Prefijos de ruta larga: `\\?\C:\x` es `C:\x`, y `\\?\UNC\srv\share` es `\\srv\share`.
  if (/^\\\\[?.]\\UNC\\/i.test(s)) s = `\\\\${s.slice(8)}`;
  else if (/^\\\\[?.]\\/.test(s)) s = s.slice(4);
  let root: string;
  let rest: string;
  const drive = /^([A-Za-z]):\\/.exec(s);
  if (drive) {
    root = `${drive[1]}:\\`;
    rest = s.slice(3);
  } else {
    const unc = /^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/.exec(s);
    if (!unc) return null;
    root = `\\\\${unc[1]}\\${unc[2]}\\`;
    rest = s.slice(unc[0].length);
  }
  const parts: string[] = [];
  for (const part of rest.split('\\')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return { root, parts };
}

function sameRoot(a: Parsed, b: Parsed): boolean {
  return lower(a.root) === lower(b.root);
}

function startsWithParts(child: string[], folder: string[]): boolean {
  return folder.length <= child.length && folder.every((part, i) => lower(part) === lower(child[i]!));
}

/** La misma carpeta, escrita como se escriba. */
export function samePath(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  return !!pa && !!pb && sameRoot(pa, pb) && pa.parts.length === pb.parts.length && startsWithParts(pa.parts, pb.parts);
}

/** `path` es `folder` o está dentro de ella, a cualquier profundidad. */
export function isInsideFolder(path: string, folder: string): boolean {
  const child = parse(path);
  const parent = parse(folder);
  return !!child && !!parent && sameRoot(child, parent) && startsWithParts(child.parts, parent.parts);
}

/** Lo que `path` tiene de más que `folder`, con `\` (vacío si es la misma carpeta). null si no está dentro. */
export function subfolderOf(path: string, folder: string): string | null {
  const child = parse(path);
  const parent = parse(folder);
  if (!child || !parent || !sameRoot(child, parent) || !startsWithParts(child.parts, parent.parts)) return null;
  return child.parts.slice(parent.parts.length).join('\\');
}

/**
 * Dónde queda `path` si `oldFolder` se mueve a `newFolder`: la carpeta nueva más lo que `path` tenía de más.
 * `C:\Viejo\src` con `C:\Viejo` → `D:\Nuevo` da `D:\Nuevo\src`. null si `path` no estaba dentro de la vieja.
 */
export function rebasePath(path: string, oldFolder: string, newFolder: string): string | null {
  const sub = subfolderOf(path, oldFolder);
  const target = parse(newFolder);
  if (sub === null || !target) return null;
  return `${target.root}${[...target.parts, ...(sub ? sub.split('\\') : [])].join('\\')}`;
}
