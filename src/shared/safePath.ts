/**
 * Comprobación de una ruta relativa que llega del renderer, sin tocar el disco. Lo que sale por un
 * enlace o una unión se comprueba después en el proceso principal, con la ruta real.
 */
const MAX_REL_PATH = 2048;
/** Windows trata estos nombres como dispositivos, tengan la extensión que tengan. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Devuelve la ruta con `/` si es relativa y se queda dentro de su carpeta; si no, null.
 * Sin `:` no hay unidad (`C:x`) ni flujo alternativo (`a.txt:oculto`). Windows quita los puntos y
 * espacios del final de cada tramo, así que `.. ` valdría `..`: tampoco pasan.
 */
export function checkRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_REL_PATH) return null;
  if (/[\x00-\x1f:]/.test(raw)) return null;
  const path = raw.replace(/\\/g, '/');
  if (path.startsWith('/')) return null;
  for (const part of path.split('/')) {
    if (part === '' || part.endsWith('.') || part.endsWith(' ')) return null;
    // La carpeta interna de git no es parte del proyecto, tampoco con su nombre corto.
    if (/^\.git$/i.test(part) || /^git~\d+$/i.test(part) || DEVICE.test(part)) return null;
  }
  return path;
}
