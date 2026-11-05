/**
 * Reemplaza `ConoutConnection` de node-pty por una versión que comparte un Worker.
 * `windowsPtyAgent` lee la clase del módulo cada vez que crea una terminal, así que
 * alcanza con sustituirla al arrancar, sin tocar node_modules.
 * Si una versión nueva de node-pty cambia esto, `installSharedConout` lanza error
 * al arrancar en lugar de romper de forma silenciosa.
 *
 * Crear una terminal bloquea el hilo principal en ConnectNamedPipe hasta que el Worker
 * se conecta al conout: por eso `ensureConoutWorker` tiene que resolverse antes.
 */
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const conoutModule = require('node-pty/lib/windowsConoutConnection') as { ConoutConnection: unknown };
import type { WorkerReply, WorkerRequest } from './conoutWorker';

const ONLINE_TIMEOUT_MS = 10_000;

let worker: Worker | null = null;
let online: Promise<void> | null = null;
const waiting = new Map<string, () => void>();
let onWorkerLost: (() => void) | null = null;

/** Se llama si el Worker muere: todas las terminales pierden su salida a la vez. */
export function setConoutLostHandler(fn: () => void): void {
  onWorkerLost = fn;
}

function startWorker(): Promise<void> {
  const w = new Worker(join(__dirname, 'conoutWorker.js').replace('app.asar', 'app.asar.unpacked'), {
    resourceLimits: { maxYoungGenerationSizeMb: 4, maxOldGenerationSizeMb: 32 },
  });
  w.unref();
  worker = w;
  w.on('message', (msg: WorkerReply) => {
    if (msg.t === 'ready') waiting.get(msg.pipe)?.();
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El proceso auxiliar de terminales no arrancó')), ONLINE_TIMEOUT_MS);
    w.once('online', () => {
      clearTimeout(timer);
      resolve();
    });
    w.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  w.on('error', (err) => console.error('[conout] error en el Worker', err));
  w.on('exit', () => {
    if (worker !== w) return;
    worker = null;
    online = null;
    waiting.clear();
    onWorkerLost?.();
  });
  return ready;
}

/** Deja el Worker listo. Se queda vivo mientras la app corre: lanzarlo es lo que puede fallar. */
export function ensureConoutWorker(): Promise<void> {
  if (!online) {
    online = startWorker().catch((err) => {
      online = null;
      void worker?.terminate();
      worker = null;
      throw err;
    });
  }
  return online;
}

function post(msg: WorkerRequest): void {
  if (!worker) throw new Error('El proceso auxiliar de terminales no está listo');
  worker.postMessage(msg);
}

let lastConnection: SharedConoutConnection | null = null;

/** Se llama antes de cada lanzamiento: solo cuenta la conexión que abra ese intento. */
export function forgetLastConout(): void {
  lastConnection = null;
}

/** La creación del proceso falló después de abrir su conexión: nadie más la va a cerrar. */
export function abandonLastConout(): void {
  lastConnection?.dispose();
  lastConnection = null;
}

class SharedConoutConnection {
  private readyCallbacks: (() => void)[] = [];
  private drainTimer: NodeJS.Timeout | null = null;

  constructor(private readonly pipe: string) {
    waiting.set(pipe, () => {
      waiting.delete(pipe);
      for (const cb of this.readyCallbacks) cb();
    });
    post({ t: 'open', pipe });
    lastConnection = this;
  }

  get onReady() {
    return (listener: () => void) => {
      this.readyCallbacks.push(listener);
      return { dispose: () => undefined };
    };
  }

  dispose(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    // Igual que node-pty: da tiempo a drenar lo que falte antes de cerrar.
    this.drainTimer = setTimeout(() => {
      waiting.delete(this.pipe);
      if (worker) post({ t: 'close', pipe: this.pipe });
    }, 1000);
    this.drainTimer.unref();
  }

  connectSocket(socket: { connect(path: string): unknown }): void {
    socket.connect(`${this.pipe}-worker`);
  }
}

export function installSharedConout(): void {
  if (typeof conoutModule.ConoutConnection !== 'function') {
    throw new Error('node-pty ya no expone ConoutConnection: revisar src/main/pty/sharedConout.ts');
  }
  conoutModule.ConoutConnection = SharedConoutConnection;
}
