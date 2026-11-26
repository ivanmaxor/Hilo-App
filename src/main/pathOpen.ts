import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
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

/** Las carpetas de la persona, como las nombra Claude en español o en inglés. En disco van en inglés, salvo en OneDrive. */
const USER_FOLDERS: Record<string, string[]> = {
  documentos: ["Documents", "Documentos"],
  documents: ["Documents", "Documentos"],
  escritorio: ["Desktop", "Escritorio"],
  desktop: ["Desktop", "Escritorio"],
  descargas: ["Downloads", "Descargas"],
  downloads: ["Downloads", "Descargas"],
  imágenes: ["Pictures", "Imágenes"],
  imagenes: ["Pictures", "Imágenes"],
  pictures: ["Pictures", "Imágenes"],
  música: ["Music", "Música"],
  musica: ["Music", "Música"],
  music: ["Music", "Música"],
  vídeos: ["Videos", "Vídeos"],
  videos: ["Videos", "Vídeos"],
};

export interface UserFolders {
  home: string | null;
  oneDrive: string[];
}

/** La carpeta de la persona y las de OneDrive, solo si son de un disco local. */
export function userFolders(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): UserFolders {
  const local = (p: string | undefined) =>
    p && /^[A-Za-z]:[\\/]/.test(p) ? p : null;
  const oneDrive = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial]
    .map(local)
    .filter((p): p is string => p !== null);
  return { home: local(home), oneDrive: [...new Set(oneDrive)] };
}

const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)/;
/** Cuántas carpetas se sube buscando la raíz del repositorio. */
const MAX_UP = 8;
const REPO_CACHE_MS = 60_000;
const repoRoots = new Map<string, { at: number; root: string | null }>();

/**
 * La carpeta con `.git` más cercana que contiene a `cwd`, o null. Solo se mira si existe. Todas las de arriba
 * se miran a la vez: una respuesta lenta hace que xterm no subraye la ruta hasta que el ratón se mueva otra vez.
 */
async function repoRoot(cwd: string): Promise<string | null> {
  const hit = repoRoots.get(cwd);
  if (hit && Date.now() - hit.at < REPO_CACHE_MS) return hit.root;
  const dirs = [cwd];
  while (dirs.length <= MAX_UP) {
    const up = dirname(dirs[dirs.length - 1]!);
    if (up === dirs[dirs.length - 1]) break;
    dirs.push(up);
  }
  const found = await Promise.all(
    dirs.map((dir) => statWithTimeout(join(dir, ".git"))),
  );
  const root = dirs[found.findIndex((f) => f !== null)] ?? null;
  if (repoRoots.size > 200) repoRoots.clear();
  repoRoots.set(cwd, { at: Date.now(), root });
  return root;
}

/**
 * Lo que podría ser una ruta relativa, en orden (#10): desde la carpeta de la sesión, desde las de arriba hasta
 * la raíz de su repositorio (Claude a veces escribe la ruta desde ahí), desde el proyecto, y desde las carpetas
 * de la persona si empieza por una (`Documentos/...`) o por `~/`.
 */
export async function relativeCandidates(
  raw: string,
  cwd: string,
  projectPath: string,
  folders: UserFolders,
): Promise<string[]> {
  const out: string[] = [];
  const add = (path: string | null) => {
    if (path && !out.includes(path)) out.push(path);
  };
  if (/^~[\\/]/.test(raw)) {
    if (folders.home) add(toAbsolute(raw.slice(2), folders.home));
    return out;
  }
  add(toAbsolute(raw, cwd));
  const root = /^[\\/]{2}/.test(cwd) ? null : await repoRoot(cwd);
  for (let dir = cwd; root !== null && dir !== root;) {
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
    add(toAbsolute(raw, dir));
  }
  add(toAbsolute(raw, projectPath));
  const [first, ...rest] = raw.split(/[\\/]/);
  const names = USER_FOLDERS[(first ?? "").toLowerCase()];
  if (names && rest.some(Boolean)) {
    for (const base of [folders.home, ...folders.oneDrive]) {
      if (!base) continue;
      for (const name of names)
        add(toAbsolute(rest.join("/"), join(base, name)));
    }
  }
  return out;
}

export async function resolveTerminalPath(
  raw: unknown,
  cwd: string,
  projectPath: string,
  folders: UserFolders = userFolders(),
): Promise<ResolvedPath | null> {
  if (typeof raw !== "string") return null;
  const result = (abs: string, found: { dir: boolean }): ResolvedPath => ({
    abs,
    dir: found.dir,
    rel: relativeToProject(abs, projectPath),
  });
  const direct = toAbsolute(raw, cwd);
  if (ABSOLUTE.test(raw)) {
    const found = direct ? await statWithTimeout(direct) : null;
    return direct && found ? result(direct, found) : null;
  }
  // Lo de siempre, desde la carpeta de la sesión, responde sin esperar a lo demás. La raíz del repositorio se
  // busca mientras tanto, para que una ruta que no existe ahí tampoco tarde.
  const relativeDirect = /^~[\\/]/.test(raw) ? null : direct;
  const [first] = await Promise.all([
    relativeDirect ? statWithTimeout(relativeDirect) : null,
    /^[\\/]{2}/.test(cwd) ? null : repoRoot(cwd),
  ]);
  if (relativeDirect && first) return result(relativeDirect, first);
  const list = (
    await relativeCandidates(raw, cwd, projectPath, folders)
  ).filter((p) => p !== relativeDirect);
  // Se miran todas a la vez y gana la primera que existe, en el orden de arriba.
  const found = await Promise.all(list.map(statWithTimeout));
  const index = found.findIndex((f) => f !== null);
  return index === -1 ? null : result(list[index]!, found[index]!);
}

/** Si es una carpeta que existe. Sin esperar a un disco que no responde. */
export async function isDirectory(path: string): Promise<boolean> {
  if (/^[\\/]{2}/.test(path)) return false;
  return (await statWithTimeout(path))?.dir === true;
}
