import { win32 } from 'node:path';
import type { GitHead } from './types';

/**
 * La rama de una carpeta, leyendo `.git/HEAD` sin ejecutar git (y por eso sin ejecutar nada de lo que el
 * repositorio configure, D21). Es una función pura: el acceso al disco entra por `GitHeadFs`, así las
 * pruebas arman repositorios falsos. El adaptador real y sus plazos están en `src/main/git.ts`.
 */

/** Lo único que se necesita saber de una ruta. `link`: es un enlace simbólico (no se sigue nunca). */
export interface GitHeadStat {
  file: boolean;
  dir: boolean;
  link: boolean;
}

export interface GitHeadFs {
  /** null si no existe o no se puede mirar. No sigue enlaces. */
  lstat(path: string): Promise<GitHeadStat | null>;
  /** El texto del archivo, o null si falla o pesa más de `max` bytes. */
  readText(path: string, max: number): Promise<string | null>;
}

export interface ReadBranchOptions {
  /** Se consulta en cada paso: el llamador la usa para cortar la búsqueda al vencer su plazo. */
  cancelled?: () => boolean;
}

/** Cuántos niveles se sube buscando `.git`. */
export const MAX_LEVELS = 40;
const MAX_DOTGIT_FILE = 1024;
const MAX_HEAD = 512;
export const MAX_BRANCH_CHARS = 60;

/** Controles y marcas de dirección de texto: una rama no debe poder disfrazar la fila. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

export async function readBranch(start: string, fs: GitHeadFs, opts: ReadBranchOptions = {}): Promise<GitHead | null> {
  try {
    if (typeof start !== 'string' || start.startsWith('\\\\') || start.startsWith('//') || !win32.isAbsolute(start)) return null;
    const gitDir = await findGitDir(win32.normalize(start), fs, opts);
    if (!gitDir) return null;
    const head = win32.join(gitDir, 'HEAD');
    const stat = await fs.lstat(head);
    if (!stat || !stat.file || stat.link) return null;
    const text = await fs.readText(head, MAX_HEAD);
    return text === null ? null : parseHead(text);
  } catch {
    return null;
  }
}

async function findGitDir(start: string, fs: GitHeadFs, opts: ReadBranchOptions): Promise<string | null> {
  let dir = start;
  for (let level = 0; level < MAX_LEVELS; level++) {
    if (opts.cancelled?.()) return null;
    const dotGit = win32.join(dir, '.git');
    const stat = await fs.lstat(dotGit);
    if (stat) {
      // Un enlace no se sigue: apuntaría a donde el repositorio quiera.
      if (stat.link) return null;
      if (stat.dir) return dotGit;
      if (!stat.file) return null;
      // Worktrees y submódulos: `.git` es un archivo que dice dónde está el directorio. No se sigue `commondir`.
      const text = await fs.readText(dotGit, MAX_DOTGIT_FILE);
      const match = text === null ? null : /^gitdir:[ \t]*(.+?)[ \t\r]*$/m.exec(stripBom(text));
      if (!match) return null;
      const target = win32.resolve(dir, match[1]!);
      // Una ruta de red podría colgar el proceso principal.
      if (target.startsWith('\\\\')) return null;
      return target;
    }
    const parent = win32.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseHead(raw: string): GitHead | null {
  const text = stripBom(raw).trim();
  const ref = /^ref:[ \t]*(.+)$/.exec(text);
  if (ref) {
    const full = ref[1]!.trim();
    if (!full.startsWith('refs/heads/')) return null;
    const name = full.slice('refs/heads/'.length);
    if (!validBranchName(name)) return null;
    return { kind: 'branch', name: clean(name) };
  }
  if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(text)) return { kind: 'detached', name: text.slice(0, 7).toLowerCase() };
  return null;
}

/** Lo que Git rechaza en un nombre de rama (`git check-ref-format`), salvo lo que ya se limpia al mostrar. */
function validBranchName(name: string): boolean {
  if (!name || name === '@' || name.endsWith('/') || name.endsWith('.') || name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (/[ ~^:?*[\\]/.test(name)) return false;
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}

function clean(name: string): string {
  const letters = Array.from(name.replace(INVISIBLE, ''));
  return letters.length > MAX_BRANCH_CHARS ? `${letters.slice(0, MAX_BRANCH_CHARS - 1).join('')}…` : letters.join('');
}
