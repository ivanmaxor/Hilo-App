import * as nodePty from 'node-pty';
import { abandonLastConout, forgetLastConout } from './sharedConout';

export interface SpawnOptions {
  file: string;
  /** Línea de comandos ya armada: el heurístico de node-pty rompe argumentos con comillas. */
  commandLine: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyEvents {
  /** Trozo crudo, antes del agrupado. Es lo que se usa para leer señales. */
  onRaw(id: string, data: string): void;
  /** Trozo agrupado para el renderer. */
  onData(id: string, data: string): void;
  /** `exitCode` es undefined si se perdió la conexión y el proceso puede seguir vivo. */
  onExit(id: string, exitCode: number | undefined, pid: number): void;
}

/** Con esta cantidad de caracteres sin confirmar se pausa el proceso. */
const HIGH_WATER = 1_000_000;
const LOW_WATER = 250_000;
const MAX_BATCH = 256 * 1024;
const BATCH_MS = 6;

interface Entry {
  pty: nodePty.IPty;
  buffer: string;
  timer: NodeJS.Timeout | null;
  lastFlush: number;
  unacked: number;
  paused: boolean;
  /** Tras cerrar la consola, tocarla sería usar memoria ya liberada dentro de conpty. */
  killed: boolean;
}

export class PtyManager {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly events: PtyEvents) {}

  spawn(id: string, opts: SpawnOptions): number {
    if (this.entries.has(id)) throw new Error(`La sesión ${id} ya tiene un proceso`);
    let pty: nodePty.IPty;
    forgetLastConout();
    try {
      pty = nodePty.spawn(opts.file, opts.commandLine, {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: opts.env,
        // Bytes reales de la aplicación, sin los repintados del ConPTY del sistema (R2).
        useConptyDll: true,
      });
    } catch (err) {
      abandonLastConout();
      throw err;
    }
    forgetLastConout();
    const entry: Entry = { pty, buffer: '', timer: null, lastFlush: 0, unacked: 0, paused: false, killed: false };
    this.entries.set(id, entry);

    pty.onData((data) => {
      this.events.onRaw(id, data);
      this.queue(id, entry, data);
    });
    pty.onExit(({ exitCode }) => {
      this.flush(id, entry);
      this.entries.delete(id);
      closeInput(pty);
      this.events.onExit(id, exitCode as number | undefined, pty.pid);
    });
    return pty.pid;
  }

  private queue(id: string, entry: Entry, data: string): void {
    entry.buffer += data;
    entry.unacked += data.length;
    if (!entry.paused && entry.unacked > HIGH_WATER) {
      entry.paused = true;
      entry.pty.pause();
    }
    if (entry.buffer.length >= MAX_BATCH) {
      this.flush(id, entry);
      return;
    }
    if (entry.timer) return;
    // Tras un silencio se manda ya, para que escribir no tenga latencia: un setTimeout(0)
    // esperaría al siguiente tic de Windows, hasta 15 ms.
    if (Date.now() - entry.lastFlush > 16) {
      this.flush(id, entry);
      return;
    }
    entry.timer = setTimeout(() => this.flush(id, entry), BATCH_MS);
  }

  private flush(id: string, entry: Entry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (!entry.buffer) return;
    const data = entry.buffer;
    entry.buffer = '';
    entry.lastFlush = Date.now();
    this.events.onData(id, data);
  }

  ack(id: string, chars: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.unacked = Math.max(0, entry.unacked - chars);
    if (entry.paused && entry.unacked < LOW_WATER) {
      entry.paused = false;
      entry.pty.resume();
    }
  }

  /** El renderer que confirmaba la salida ya no está: nada debe quedar pausado esperándolo. */
  resetFlowControl(): void {
    for (const entry of this.entries.values()) {
      entry.unacked = 0;
      if (entry.paused) {
        entry.paused = false;
        entry.pty.resume();
      }
    }
  }

  write(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (entry && !entry.killed) entry.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.killed || cols < 2 || rows < 1) return;
    try {
      entry.pty.resize(cols, rows);
    } catch {
      // El proceso pudo haber salido entre medio.
    }
  }

  /** Cierra la consola. Los procesos de esa consola reciben CTRL_CLOSE_EVENT. */
  kill(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.killed) return;
    entry.killed = true;
    if (entry.paused) entry.pty.resume();
    try {
      entry.pty.kill();
    } catch {
      // Ya no existe.
    }
  }
}

/** node-pty no cierra el socket de entrada cuando el proceso sale solo: se pierde un handle por sesión. */
function closeInput(pty: nodePty.IPty): void {
  try {
    (pty as unknown as { _agent?: { inSocket?: { destroy(): void } } })._agent?.inSocket?.destroy();
  } catch {
    // Campo interno de node-pty: si cambia, solo se pierde esta limpieza.
  }
}
