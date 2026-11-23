import { stat } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { checkRelativePath } from "../shared/safePath";
import type { TerminalPath } from "../shared/pathLinks";

/**
 * Las rutas que se ven en una terminal (#10, D35). El renderer manda el texto tal cual; aquí se decide a qué
 * archivo apunta, sin leerlo: solo se mira si existe y si es carpeta. Nunca se abre un archivo: se muestra en el
 * Explorador. Abrir un `.exe` o un `.bat` lo ejecutaría.
 */

export type ResolvedPath = TerminalPath;

const MAX_RAW = 1024;
/** Windows trata estos nombres como dispositivos, tengan la extensión que tengan. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;
/** Un disco que no responde no debe dejar la búsqueda colgada. */
const STAT_TIMEOUT_MS = 1500;

/** La ruta completa de lo que escribió la terminal, o null si no se debe ni mirar. */
export function toAbsolute(raw: unknown, cwd: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW)
    return null;
  if (/[\x00-\x1f\x7f]/.test(raw)) return null;
  // `\\servidor\...` o `//servidor/...`: mirarla sería una conexión de red. Tampoco `\\?\` ni `\\.\`.
  if (/^[\\/]{2}/.test(raw)) return null;
  let path = raw.replace(
    /^\/([A-Za-z])\//,
    (_, drive: string) => `${drive.toUpperCase()}:/`,
  );
  const drive = /^[A-Za-z]:[\\/]/.test(path);
  // Otro `:` sería otra unidad sin barra (`C:x`), un esquema (`mailto:`) o un flujo alternativo (`a.txt:oculto`).
  if (path.indexOf(":", drive ? 2 : 0) !== -1) return null;
  if (!drive && /^[\\/]/.test(path)) return null;
  if (!drive && /^[\\/]{2}/.test(cwd)) return null;
  path = drive ? normalize(path) : resolve(cwd, path);
  if (!isAbsolute(path) || /^[\\/]{2}/.test(path)) return null;
  const parts = path.split(/[\\/]/).slice(1);
  if (parts.some((part) => DEVICE.test(part))) return null;
  return path.replace(/[\\/]+$/, "") || null;
}

function statWithTimeout(path: string): Promise<{ dir: boolean } | null> {
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), STAT_TIMEOUT_MS);
    stat(path).then(
      (s) => {
        clearTimeout(timer);
        done(s.isFile() || s.isDirectory() ? { dir: s.isDirectory() } : null);
      },
      () => {
        clearTimeout(timer);
        done(null);
      },
    );
  });
}

/** Relativa al proyecto si queda dentro, ya validada como las del panel Cambios. */
export function relativeToProject(
  abs: string,
  projectPath: string,
): string | null {
  const rel = relative(projectPath, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return checkRelativePath(rel);
}

export async function resolveTerminalPath(
  raw: unknown,
  cwd: string,
  projectPath: string,
): Promise<ResolvedPath | null> {
  const abs = toAbsolute(raw, cwd);
  if (!abs) return null;
  const found = await statWithTimeout(abs);
  if (!found) return null;
  return { abs, dir: found.dir, rel: relativeToProject(abs, projectPath) };
}

/** Si es una carpeta que existe. Sin esperar a un disco que no responde. */
export async function isDirectory(path: string): Promise<boolean> {
  if (/^[\\/]{2}/.test(path)) return false;
  return (await statWithTimeout(path))?.dir === true;
}
