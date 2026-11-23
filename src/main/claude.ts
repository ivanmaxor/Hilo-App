import { open } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { SessionRecord } from '../shared/types';
import { isClaudeId, isValidEffort, isValidModel } from '../shared/validate';
import { claudePathProblem } from '../shared/claudePath';

/**
 * Busca `claude` en la ruta configurada, en el PATH y en la ruta del instalador nativo. Una ruta configurada
 * que no parece Claude Code (un instalador, Claude Desktop) se ignora: Ajustes lo avisa.
 */
export function resolveClaude(configured: string): string | null {
  // Una ruta de red caída bloquearía el proceso principal 20 s al arrancar: que falle al lanzar.
  if (configured && !claudePathProblem(configured)) return configured.startsWith('\\\\') || existsSync(configured) ? configured : null;
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = join(dir, `claude${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

function transcriptPath(cwd: string, claudeId: string): string {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return join(claudeConfigDir(), 'projects', slug, `${claudeId}.jsonl`);
}

/**
 * Dónde está la conversación. Claude la guarda en la carpeta donde empezó, y `--resume <id>` la encuentra
 * aunque se abra desde otra (o si la original ya no existe): por eso, si no está en la carpeta de la sesión,
 * se busca el mismo id en las demás carpetas de `projects`. Solo se comprueba que el archivo exista: no se
 * lee, no se copia y no se cambia (#6).
 */
function locateTranscript(cwd: string, claudeId: string): string | null {
  if (!isClaudeId(claudeId)) return null;
  const own = transcriptPath(cwd, claudeId);
  if (existsSync(own)) return own;
  const root = join(claudeConfigDir(), 'projects');
  let folders: string[];
  try {
    folders = readdirSync(root);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const candidate = join(root, folder, `${claudeId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Cuándo se escribió por última vez la conversación: el último mensaje. null si no existe. */
export function transcriptMtime(cwd: string, claudeId: string): number | null {
  const found = locateTranscript(cwd, claudeId);
  if (!found) return null;
  try {
    return statSync(found).mtimeMs;
  } catch {
    return null;
  }
}

/** Solo comprueba si existe, en la carpeta de la sesión o en cualquier otra. */
export function transcriptExists(cwd: string, claudeId: string): boolean {
  return locateTranscript(cwd, claudeId) !== null;
}

/** Lo que se lee de una conversación: el final, para el último mensaje de Claude, y solo cuando el usuario pide copiarlo (D26). */
const TRANSCRIPT_TAIL = 4 * 1024 * 1024;

export async function readTranscriptTail(cwd: string, claudeId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(claudeId)) return null;
  const found = locateTranscript(cwd, claudeId);
  if (!found) return null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(found, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, TRANSCRIPT_TAIL);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export interface ClaudeArgsOptions {
  session: SessionRecord;
  resume: boolean;
  settingsFile: string | null;
  skipPermissions?: boolean;
}

/** Lo que no se elija se hereda de la configuración del usuario. */
export function buildClaudeArgs({ session, resume, settingsFile, skipPermissions }: ClaudeArgsOptions): string[] {
  const args = resume ? ['--resume', session.claudeId] : ['--session-id', session.claudeId];
  args.push('--name', session.name);
  if (isValidModel(session.model)) args.push('--model', session.model);
  if (isValidEffort(session.effort)) args.push('--effort', session.effort);
  if (settingsFile) args.push('--settings', settingsFile);
  if (skipPermissions) args.push('--dangerously-skip-permissions');
  return args;
}

/** Comillas según CommandLineToArgvW: el programa recibe exactamente este argumento. */
export function quoteArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

export function buildCommandLine(args: string[]): string {
  return args.map(quoteArg).join(' ');
}

/** Caracteres que cmd.exe interpreta dentro de la línea de un `.cmd`. No se pueden neutralizar del todo. */
const CMD_META = /[&|<>^%!"()\r\n]/;

/**
 * Un `.cmd` o `.bat` pasa por cmd.exe, que reinterpreta la línea: un nombre `R&D`
 * ejecutaría `D`. Sin forma fiable de escapar `%`, un nombre con esos caracteres no se
 * pasa como `--name`; la sesión funciona igual y conserva su nombre en Hilo.
 */
export function buildCmdLine(batch: string, args: string[]): string {
  const safe: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // Una barra al final se comería la comilla de cierre, y con ella el argumento siguiente.
    if (arg === '--name' && (CMD_META.test(args[i + 1] ?? '') || (args[i + 1] ?? '').endsWith('\\'))) {
      i++;
      continue;
    }
    safe.push(arg);
  }
  // /s: cmd quita solo las comillas exteriores y deja intacto lo de adentro.
  return `/d /s /c "${[batch, ...safe].map((a) => `"${a}"`).join(' ')}"`;
}

export interface LaunchCommand {
  file: string;
  commandLine: string;
  /** El proceso lanzado es cmd.exe, y el de Claude cuelga de él. */
  wrapped: boolean;
}

export function commandFor(file: string, args: string[]): LaunchCommand {
  if (/\.(cmd|bat)$/i.test(file)) {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    return { file: comspec, commandLine: buildCmdLine(file, args), wrapped: true };
  }
  return { file, commandLine: buildCommandLine(args), wrapped: false };
}

const STRIP_ENV = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'WT_PROFILE_ID',
  'HILO_E2E',
  'HILO_DATA_DIR',
  'HILO_TEST_CLIPBOARD',
  'HILO_TEST_HIDDEN',
  'HILO_TEST_SHELL',
  'HILO_TEST_CLAUDE_ARGS',
  'HILO_TEST_REAL_NOTIFY',
]);

/**
 * Lo que una sesión de Claude le deja a sus hijos. Si Hilo se abre desde una de ellas
 * hay que quitarlo: `CLAUDE_CODE_CHILD_SESSION` apaga el guardado de la conversación,
 * y sin eso no se puede retomar.
 */
const PARENT_SESSION_ENV = new Set([
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SSE_PORT',
]);
/** Estas pueden ser del usuario: solo se quitan si vienen de una sesión de Claude. */
const PARENT_SESSION_ONLY = new Set(['NO_COLOR', 'GIT_EDITOR']);

/**
 * Entorno de las terminales. `WT_SESSION` hace que Claude Code recorra la misma
 * rama que en Windows Terminal: salida sincronizada sin parpadeo (decisión D3).
 */
/**
 * `classic`: Claude Code usa su pantalla clásica, como con `/tui default`. La pantalla completa dibuja en una
 * pantalla alternativa sin historial, y la rueda y la barra de Hilo no la desplazan (D31). Solo en las sesiones
 * de Hilo: es una variable del proceso, no se toca la configuración del usuario.
 */
export function buildEnv(sessionId: string, base: NodeJS.ProcessEnv = process.env, classic = false): Record<string, string> {
  const env: Record<string, string> = {};
  const insideClaude = Object.keys(base).some((k) => k.toUpperCase() === 'CLAUDECODE' || k.toUpperCase() === 'CLAUDE_CODE_CHILD_SESSION');
  for (const [key, value] of Object.entries(base)) {
    const name = key.toUpperCase();
    if (value === undefined || STRIP_ENV.has(name) || PARENT_SESSION_ENV.has(name)) continue;
    if (insideClaude && PARENT_SESSION_ONLY.has(name)) continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.WT_SESSION = sessionId;
  if (classic) env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1';
  return env;
}

export function defaultShell(): { file: string; args: string[] } {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return { file: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo'] };
}
