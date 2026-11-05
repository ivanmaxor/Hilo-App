import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MAX_DIFF_BYTES, MAX_LISTED_FILES, parseRawNumstat, type ChangesList, type FileChange, type FileDiffRequest, type FileDiffResult } from '../shared/diff';
import { checkRelativePath } from '../shared/safePath';

/**
 * Git, solo para leer. Un repositorio puede venir de cualquier parte, y su `.git/config` puede pedir que
 * se ejecuten programas: nada de lo que dice el repositorio se ejecuta. Ver docs/DECISIONES.md, D21.
 */
const LIST_TIMEOUT_MS = 30_000;
const DIFF_TIMEOUT_MS = 20_000;
const MAX_LIST_BYTES = 32 * 1024 * 1024;
/** Se cuentan las líneas de los nuevos solo hasta aquí: lo demás es trabajo que nadie va a mirar. */
const MAX_COUNTED_NEW_FILES = 300;
const MAX_COUNTED_BYTES = 2 * 1024 * 1024;
/** Más que cualquier archivo por debajo de MAX_DIFF_BYTES: equivale a "todo el archivo". */
const FULL_CONTEXT = 10_000_000;

/** Cada una de estas puede ejecutar un programa o tocar la red, y un `-c` manda sobre el repositorio. */
const HARDENED_CONFIG = [
  'core.fsmonitor=false',
  'core.untrackedCache=false',
  'core.pager=cat',
  'core.sshCommand=false',
  'core.gitProxy=',
  'core.askPass=',
  'core.hooksPath=/dev/null',
  'core.splitIndex=false',
  'credential.helper=',
  'diff.external=',
  'diff.ignoreSubmodules=dirty',
  'pager.diff=false',
  'color.ui=false',
  'core.quotePath=false',
  'protocol.allow=never',
  'submodule.recurse=false',
];

/**
 * `--ignore-submodules=dirty`: si no, git entra a cada submódulo y ejecuta lo que pida su configuración.
 * `-O/dev/null` anula `diff.orderFile`, que puede apuntar a una ruta de red.
 */
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=dirty', '--relative', '-M', '-O/dev/null'];

/** Sin nada heredado que cambie adónde mira git: ni GIT_DIR ni GIT_EXTERNAL_DIFF. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(GIT_|ELECTRON_)/i.test(key) && key.toUpperCase() !== 'NODE_OPTIONS') env[key] = value;
  }
  return {
    ...env,
    // `git status` no refresca el índice. `git diff` no hace caso: para eso está la copia de `prepare`.
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    // Sin esto, un clon parcial bajaría de la red lo que le falte.
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: 'none',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    // Un archivo llamado `*` o `:(top)` es ese archivo, no un patrón.
    GIT_LITERAL_PATHSPECS: '1',
    // Se lee stderr para distinguir los casos.
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}

/**
 * La ruta absoluta de git.exe. Nunca el nombre suelto: en Windows, `spawn('git', { cwd })` busca primero en
 * `cwd`, y un repositorio podría traer su propio git.exe. Tampoco git.cmd, que exigiría shell.
 */
export function findGit(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.HILO_E2E === '1' ? env.HILO_TEST_GIT : undefined;
  if (override) return existsSync(override) ? override : null;
  const dirs = (env.PATH ?? env.Path ?? '')
    .split(delimiter)
    .map((d) => d.replace(/^"|"$/g, '').trim())
    // `.` o una ruta relativa dependen de la carpeta actual: justo lo que se quiere evitar.
    .filter((d) => d && isAbsolute(d) && /^[A-Za-z]:[\\/]/.test(d));
  for (const base of [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (base) dirs.push(join(base, 'Git', 'cmd'));
  }
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd'));
  for (const dir of dirs) {
    const candidate = join(dir, 'git.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface GitResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  overflow: boolean;
  timedOut: boolean;
  failed?: string;
}

function runGit(git: string, cwd: string, args: string[], opts: { maxBytes: number; timeoutMs: number; extraConfig?: string[]; emptyStdin?: boolean; indexFile?: string }): Promise<GitResult> {
  const config = [...HARDENED_CONFIG, ...(opts.extraConfig ?? [])].flatMap((c) => ['-c', c]);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let overflow = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(git, ['--no-pager', ...config, ...args], {
        cwd,
        env: opts.indexFile ? { ...gitEnv(), GIT_INDEX_FILE: opts.indexFile } : gitEnv(),
        shell: false,
        windowsHide: true,
        stdio: [opts.emptyStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: '', overflow: false, timedOut: false, failed: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (opts.emptyStdin) child.stdin?.end();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    timer.unref();
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > opts.maxBytes) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout: Buffer.alloc(0), stderr, overflow, timedOut, failed: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr, overflow, timedOut });
    });
  });
}

/** Sin `..` en el resultado: `..algo` es un nombre válido y queda dentro. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * La ruta absoluta dentro del proyecto, o null. Mira la ruta real: una unión o un enlace que salen de la
 * carpeta se rechazan. Para lo que ya no existe se comprueba el último tramo que sí existe.
 */
export async function resolveInside(root: string, rel: unknown): Promise<string | null> {
  const clean = checkRelativePath(rel);
  if (!clean) return null;
  const abs = join(root, clean);
  try {
    const realRoot = await realpath(root);
    let probe = abs;
    for (;;) {
      try {
        return isInside(realRoot, await realpath(probe)) ? abs : null;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
        const parent = join(probe, '..');
        if (parent === probe || !isInside(root, parent)) return null;
        probe = parent;
      }
    }
  } catch {
    return null;
  }
}

/** Git da bytes tal cual. Los proyectos de Java viejos suelen estar en Windows-1252, no en UTF-8. */
export function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** El mismo criterio que git: un NUL en los primeros 8000 bytes es un binario. */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

type Prepared = { ok: true; git: string; filters: string[]; base: string; noCommits: boolean; subfolder: boolean; indexFile: string; done(): Promise<void> } | { ok: false; status: 'no-folder' | 'no-git' | 'not-repo' | 'untrusted' | 'unsafe-config' } | { ok: false; status: 'error'; message: string };

const shortError = (r: GitResult) => (r.failed ?? r.stderr ?? '').trim().slice(0, 300) || 'git no respondió.';

/**
 * Lo que hay que saber antes de pedirle un diff a git. Los filtros son los únicos programas que el
 * repositorio nombra con un nombre libre, así que un `-c` fijo no los alcanza: se piden sus nombres y se
 * vacían todos. Si un nombre no se puede escribir en un `-c`, no se sigue.
 *
 * `git diff` actualiza el índice aunque `GIT_OPTIONAL_LOCKS=0` y escribe `.git/index.lock` al hacerlo: se le
 * da una copia en la carpeta temporal, y el repositorio no se toca. Quien recibe esto llama a `done`.
 */
async function prepare(projectPath: string): Promise<Prepared> {
  try {
    if (!(await stat(projectPath)).isDirectory()) return { ok: false, status: 'no-folder' };
  } catch {
    return { ok: false, status: 'no-folder' };
  }
  const git = findGit();
  if (!git) return { ok: false, status: 'no-git' };
  const limits = { maxBytes: 1024 * 1024, timeoutMs: DIFF_TIMEOUT_MS };
  const top = await runGit(git, projectPath, ['rev-parse', '--show-toplevel', '--git-path', 'index'], limits);
  if (top.failed) return { ok: false, status: 'error', message: shortError(top) };
  if (top.timedOut) return { ok: false, status: 'error', message: 'git tardó demasiado en responder.' };
  if (top.code !== 0) {
    if (/dubious ownership/i.test(top.stderr)) return { ok: false, status: 'untrusted' };
    if (/not a git repository|must be run in a work tree|this operation must be run/i.test(top.stderr)) return { ok: false, status: 'not-repo' };
    return { ok: false, status: 'error', message: shortError(top) };
  }
  // `core.worktree` puede apuntar a cualquier otra carpeta: entonces esto no es un repositorio de este proyecto.
  const realProject = await realpath(projectPath).catch(() => null);
  const [topLine, indexLine] = top.stdout.toString('utf8').split(/\r?\n/);
  const realTop = await realpath(topLine ?? '').catch(() => null);
  if (!realProject || !realTop || !isInside(realTop, realProject)) return { ok: false, status: 'not-repo' };

  const config = await runGit(git, projectPath, ['config', '--name-only', '-z', '--get-regexp', '^filter\\.'], limits);
  if (config.failed || config.timedOut || config.overflow || (config.code !== 0 && config.code !== 1)) return { ok: false, status: 'unsafe-config' };
  const names = new Set<string>();
  for (const key of config.stdout.toString('utf8').split('\0')) {
    if (!key) continue;
    const name = key.slice('filter.'.length, key.lastIndexOf('.'));
    if (key.lastIndexOf('.') < 'filter.'.length) continue;
    if (/[=\r\n]/.test(name)) return { ok: false, status: 'unsafe-config' };
    names.add(name);
  }
  const filters = [...names].flatMap((n) => [`filter.${n}.clean=`, `filter.${n}.smudge=`, `filter.${n}.process=`, `filter.${n}.required=false`]);

  const head = await runGit(git, projectPath, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { ...limits, extraConfig: filters });
  let base = 'HEAD';
  let noCommits = false;
  if (head.code !== 0) {
    // Sin ningún commit se compara con el árbol vacío; `hash-object` sin `-w` no escribe nada.
    const empty = await runGit(git, projectPath, ['hash-object', '-t', 'tree', '--stdin'], { ...limits, extraConfig: filters, emptyStdin: true });
    if (empty.code !== 0) return { ok: false, status: 'error', message: shortError(empty) };
    base = empty.stdout.toString('utf8').trim();
    noCommits = true;
  }
  const scratch = await mkdtemp(join(tmpdir(), 'hilo-index-'));
  const done = () => rm(scratch, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
  const indexFile = join(scratch, 'index');
  try {
    await copyFile(resolve(projectPath, indexLine ?? ''), indexFile);
  } catch (err) {
    // Un repositorio recién creado todavía no tiene índice, y para git una copia que no existe es uno vacío.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      await done();
      return { ok: false, status: 'error', message: 'No se pudo leer el índice de git.' };
    }
  }
  return { ok: true, git, filters, base, noCommits, subfolder: !isSameDir(realTop, realProject), indexFile, done };
}

function isSameDir(a: string, b: string): boolean {
  return relative(a, b) === '';
}

async function readHead(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Cuenta las líneas de un archivo nuevo sin seguir enlaces. */
async function countNewFile(root: string, file: FileChange): Promise<void> {
  const clean = checkRelativePath(file.path);
  if (!clean) return;
  const abs = join(root, clean);
  try {
    const info = await lstat(abs);
    if (!info.isFile()) return;
    if (info.size === 0) {
      file.added = 0;
      return;
    }
    if (info.size > MAX_COUNTED_BYTES) return;
    const bytes = await readHead(abs, MAX_COUNTED_BYTES);
    if (looksBinary(bytes)) {
      file.binary = true;
      return;
    }
    let lines = 0;
    for (const byte of bytes) if (byte === 10) lines++;
    if (bytes[bytes.length - 1] !== 10) lines++;
    file.added = lines;
  } catch {
    // Se borró mientras tanto: queda sin contar.
  }
}

export async function listChanges(projectPath: string): Promise<ChangesList> {
  const ready = await prepare(projectPath);
  if (!ready.ok) return ready.status === 'error' ? { status: 'error', message: ready.message } : { status: ready.status };
  const { git, filters, base, noCommits, subfolder, indexFile } = ready;
  const options = { maxBytes: MAX_LIST_BYTES, timeoutMs: LIST_TIMEOUT_MS, extraConfig: filters, indexFile };
  const [diff, others] = await Promise.all([
    runGit(git, projectPath, ['diff', ...DIFF_FLAGS, '--raw', '--numstat', '-z', base, '--'], options),
    runGit(git, projectPath, ['ls-files', '--others', '--exclude-standard', '-z'], options),
  ]).finally(() => ready.done());
  for (const r of [diff, others]) {
    if (r.timedOut) return { status: 'error', message: 'git tardó demasiado: puede que la carpeta sea muy grande.' };
    if (r.failed || (r.code !== 0 && !r.overflow)) return { status: 'error', message: shortError(r) };
  }
  const tracked = parseRawNumstat(diff.stdout.toString('utf8'));
  const known = new Set(tracked.map((f) => f.path));
  const fresh: FileChange[] = others.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p && !known.has(p))
    // Un repositorio metido dentro de otro sale como carpeta, con la barra al final.
    .map((p) => ({ path: p.replace(/\/$/, ''), kind: 'untracked' as const, added: null, removed: null, binary: false }));
  const all = [...tracked, ...fresh].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = all.slice(0, MAX_LISTED_FILES);
  const toCount = files.filter((f) => f.kind === 'untracked').slice(0, MAX_COUNTED_NEW_FILES);
  // De a pocos: no tiene sentido abrir cientos de archivos a la vez.
  for (let i = 0; i < toCount.length; i += 8) {
    await Promise.all(toCount.slice(i, i + 8).map((f) => countNewFile(projectPath, f)));
  }
  return { status: 'ok', files, total: all.length + (diff.overflow || others.overflow ? 1 : 0), noCommits, subfolder };
}

async function readNewFile(abs: string): Promise<FileDiffResult> {
  let info;
  try {
    info = await lstat(abs);
  } catch {
    return { status: 'missing' };
  }
  if (info.isSymbolicLink()) return { status: 'symlink' };
  if (info.isDirectory()) return { status: 'folder' };
  if (!info.isFile()) return { status: 'missing' };
  if (info.size > MAX_DIFF_BYTES) return { status: 'too-large', bytes: info.size };
  try {
    const bytes = await readHead(abs, MAX_DIFF_BYTES);
    if (looksBinary(bytes)) return { status: 'binary' };
    return { status: 'new', text: decodeText(bytes) };
  } catch {
    return { status: 'missing' };
  }
}

export async function fileDiff(projectPath: string, req: FileDiffRequest): Promise<FileDiffResult> {
  const abs = await resolveInside(projectPath, req.path);
  if (!abs) return { status: 'rejected' };
  if (req.untracked) return readNewFile(abs);
  if (req.oldPath !== undefined && !(await resolveInside(projectPath, req.oldPath))) return { status: 'rejected' };
  const ready = await prepare(projectPath);
  if (!ready.ok) {
    if (ready.status === 'no-git' || ready.status === 'unsafe-config') return { status: ready.status };
    return { status: 'error', message: ready.status === 'error' ? ready.message : 'No se pudo comparar este archivo.' };
  }
  const clean = checkRelativePath(req.path)!;
  const paths = req.oldPath !== undefined ? [checkRelativePath(req.oldPath)!, clean] : [clean];
  const args = ['diff', ...DIFF_FLAGS, `-U${req.full ? FULL_CONTEXT : 3}`, ready.base, '--', ...paths];
  const out = await runGit(ready.git, projectPath, args, { maxBytes: MAX_DIFF_BYTES, timeoutMs: DIFF_TIMEOUT_MS, extraConfig: ready.filters, indexFile: ready.indexFile }).finally(() => ready.done());
  if (out.overflow) return { status: 'too-large', bytes: null };
  if (out.timedOut) return { status: 'error', message: 'git tardó demasiado en comparar este archivo.' };
  if (out.failed || out.code !== 0) return { status: 'error', message: shortError(out) };
  return { status: 'patch', text: decodeText(out.stdout) };
}
