import { open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { SessionRecord } from '../shared/types';
import { isValidEffort, isValidModel } from '../shared/validate';

/** Busca `claude` en la ruta configurada, en el PATH y en la ruta del instalador nativo. */
export function resolveClaude(configured: string): string | null {
  // Una ruta de red caída bloquearía el proceso principal 20 s al arrancar: que falle al lanzar.
  if (configured) return configured.startsWith('\\\\') || existsSync(configured) ? configured : null;
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

/** Solo comprueba si existe. */
export function transcriptExists(cwd: string, claudeId: string): boolean {
  return existsSync(transcriptPath(cwd, claudeId));
}

/** Lo que se lee de una conversación: el final, para el último mensaje de Claude, y solo cuando el usuario pide copiarlo (D26). */
const TRANSCRIPT_TAIL = 4 * 1024 * 1024;

export async function readTranscriptTail(cwd: string, claudeId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(claudeId)) return null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(transcriptPath(cwd, claudeId), 'r');
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
export function buildEnv(sessionId: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
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
  return env;
}

export function defaultShell(): { file: string; args: string[] } {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return { file: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo'] };
}
