import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { BackgroundProcess } from '../shared/types';

export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  created: number;
  command: string;
}

function powershellPath(): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

const SNAPSHOT_SCRIPT =
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
  "Get-CimInstance Win32_Process | ForEach-Object { " +
  "'{0}|{1}|{2}|{3}|{4}' -f $_.ProcessId,$_.ParentProcessId,$_.Name," +
  "$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0}),($_.CommandLine -replace '[\\r\\n|]',' ') }";

let snapshotInFlight: Promise<ProcInfo[] | null> | null = null;

/**
 * Foto de todos los procesos. Se pide al dormir o cerrar, y con el dormido automático o un
 * envoltorio `.cmd` que aún no se resolvió, nunca de forma continua. Cada una es una PowerShell de unos 80 MB: quien la pida mientras hay otra en curso la comparte.
 * Sirve también para confirmar después de matar: de más solo se intenta matar algo ya muerto.
 */
export function snapshotProcesses(): Promise<ProcInfo[] | null> {
  snapshotInFlight ??= takeSnapshot().finally(() => {
    snapshotInFlight = null;
  });
  return snapshotInFlight;
}

function takeSnapshot(): Promise<ProcInfo[] | null> {
  return new Promise((resolve) => {
    execFile(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-Command', SNAPSHOT_SCRIPT],
      { windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        // Cortada por tiempo o tamaño, la lista está a medias: no diría qué procesos hay.
        if (err && (!stdout || err.killed || (err as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) {
          console.error('[procesos] no se pudo listar', err);
          resolve(null);
          return;
        }
        const procs = parseSnapshot(stdout);
        resolve(procs.length ? procs : null);
      },
    );
  });
}

export function parseSnapshot(text: string): ProcInfo[] {
  const out: ProcInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('|');
    if (parts.length < 4) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || pid <= 0) continue;
    out.push({ pid, ppid, name: parts[2] ?? '', created: Number(parts[3]) || 0, command: parts.slice(4).join('|') });
  }
  return out;
}

/** Descendientes de `root`, sin incluirlo. Un hijo debe ser más nuevo que su padre (reutilización de PID). */
export function descendants(root: number, procs: ProcInfo[]): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>();
  const self = new Map<number, ProcInfo>();
  for (const p of procs) {
    self.set(p.pid, p);
    const list = byParent.get(p.ppid);
    if (list) list.push(p);
    else byParent.set(p.ppid, [p]);
  }
  const out: ProcInfo[] = [];
  const queue: ProcInfo[] = [];
  const seen = new Set<number>([root]);
  const push = (parentCreated: number, kids: ProcInfo[] | undefined) => {
    for (const k of kids ?? []) {
      if (seen.has(k.pid) || (parentCreated && k.created && k.created < parentCreated)) continue;
      seen.add(k.pid);
      out.push(k);
      queue.push(k);
    }
  };
  push(self.get(root)?.created ?? 0, byParent.get(root));
  while (queue.length) {
    const p = queue.shift()!;
    push(p.created, byParent.get(p.pid));
  }
  return out;
}

const WRAPPERS = new Set(['bash.exe', 'sh.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'conhost.exe']);
/** Un hook de PowerShell dura poco; más de esto y es algo que Claude dejó corriendo. */
const POWERSHELL_MIN_AGE_MS = 15_000;
const FILETIME_PER_MS = 10_000;

/**
 * Lo que el usuario perdería al dormir la sesión: lo que Claude lanzó con sus
 * herramientas de shell (por ejemplo `npm run dev`). La herramienta Bash lleva
 * `shell-snapshots` en la línea de comandos. No cuentan los servidores MCP, que van
 * por cmd y Claude los relanza, ni los hooks, que son pasajeros.
 */
export function backgroundProcesses(root: number, procs: ProcInfo[], now = Date.now()): BackgroundProcess[] {
  // FILETIME: intervalos de 100 ns desde 1601.
  const nowFiletime = (now + 11_644_473_600_000) * FILETIME_PER_MS;
  const isToolShell = (p: ProcInfo) => {
    const name = p.name.toLowerCase();
    if (name === 'bash.exe' || name === 'sh.exe') return p.command.includes('shell-snapshots');
    if (name === 'powershell.exe' || name === 'pwsh.exe') {
      return !/mcp/i.test(p.command) && nowFiletime - p.created > POWERSHELL_MIN_AGE_MS * FILETIME_PER_MS;
    }
    return false;
  };
  const out: BackgroundProcess[] = [];
  for (const shell of procs.filter((p) => p.ppid === root && isToolShell(p))) {
    const below = descendants(shell.pid, procs).filter((p) => !WRAPPERS.has(p.name.toLowerCase()));
    for (const p of below.length ? below : [shell]) out.push({ pid: p.pid, name: p.name });
  }
  return out;
}

/** En una PowerShell del usuario, todo lo que tenga corriendo se perdería al cerrarla. */
export function shellChildren(root: number, procs: ProcInfo[]): BackgroundProcess[] {
  return descendants(root, procs)
    .filter((p) => !/^(conhost|openconsole)\.exe$/i.test(p.name))
    .map((p) => ({ pid: p.pid, name: p.name }));
}

export function killPid(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    // Ya no existe.
  }
}

export function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const root = process.env.SystemRoot || 'C:\\Windows';
    execFile(join(root, 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}
