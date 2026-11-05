import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { OscTitleScanner, classifyTitle } from '../shared/oscScanner';
import { findSession, allSessions } from '../shared/reducer';
import { initialState, transition, type MachineEvent, type MachineState } from '../shared/statusMachine';
import type { BackgroundProcess, RuntimeMap, SessionRecord, SessionRuntime, SessionStatus } from '../shared/types';
import { buildClaudeArgs, buildCommandLine, buildEnv, claudeConfigDir, commandFor, defaultShell, resolveClaude, transcriptExists } from './claude';
import { HookChannel } from './hooks';
import { backgroundProcesses, descendants, killPid, shellChildren, snapshotProcesses, taskkillTree, type ProcInfo } from './processes';
import { ensureConoutWorker, setConoutLostHandler } from './pty/sharedConout';
import { PtyManager } from './pty/ptyManager';
import type { Store } from './store';
import { isClaudeId } from '../shared/validate';

const POLL_MS = 1500;
/** Con 9 arranques a la vez una sesión sana puede tardar más de 10 s: esto es solo la red de seguridad. */
const START_TIMEOUT_MS = 45_000;
const VIEW_DELAY_MS = 1000;
const GRACEFUL_WAIT_MS = 2500;
const CTRL_C_GAP_MS = 250;
/** Una salida con error antes de este tiempo se trata como fallo al lanzar. */
const FAST_FAIL_MS = 20_000;
/** ✳ llega unos 60 ms antes que el hook de un permiso: no se avisa "terminó" por eso. */
/** Además, `/exit` emite un destello de "trabajando" y tarda hasta 1,5 s en salir: no es un turno terminado. */
const DONE_NOTIFY_DELAY_MS = 1600;
/** Lo que se espera a la foto de procesos antes de apagar. Con la máquina saturada no puede comerse el plazo. */
const SNAPSHOT_WAIT_MS = 1500;
/** El título va por delante del archivo de sesión: una lectura recién hecha puede estar vieja. */
const SESSION_FILE_SETTLE_MS = 500;
const STALE_SESSION_FILE_MS = 5000;
const UNEXPECTED_EXIT_GRACE_MS = 3000;
const REAL_PID_DELAY_MS = 3000;
/** Un envoltorio cuyo hijo no se reconoce no debe costar una PowerShell cada 1,5 s para siempre. */
const REAL_PID_MAX_TRIES = 5;

interface Live {
  pid: number;
  /** Con un `.cmd`, `pid` es cmd.exe y el de Claude cuelga de él. */
  claudePid: number | null;
  pidTries: number;
  nextPidTry: number;
  wrapped: boolean;
  session: SessionRecord;
  scanner: OscTitleScanner;
  requested: boolean;
  startedAt: number;
  lastActivity: number;
  lastSignalAt: number;
  tail: string;
  attempts: number;
  startTimer: NodeJS.Timeout | null;
  onExit: (() => void)[];
  stopping: Promise<void> | null;
  /** Otro id de conversación visto en el archivo de sesión: se adopta si se repite. */
  otherClaudeId: string | null;
  cols: number;
  rows: number;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

export interface SessionEvents {
  send(channel: string, ...args: unknown[]): void;
  notify(session: SessionRecord, status: SessionStatus): void;
  statusChanged(): void;
}

export class SessionController {
  private readonly machines = new Map<string, MachineState>();
  private readonly messages = new Map<string, string>();
  private readonly live = new Map<string, Live>();
  private readonly pty: PtyManager;
  private readonly hooks: HookChannel;
  private readonly viewTimers = new Map<string, NodeJS.Timeout>();
  private readonly notifyTimers = new Map<string, NodeJS.Timeout>();
  private visible = new Set<string>();
  private windowFocused = false;
  private readonly pollTimer: NodeJS.Timeout;
  private pollCount = 0;
  private shuttingDown = false;

  constructor(
    private readonly store: Store,
    dataDir: string,
    private readonly events: SessionEvents,
  ) {
    this.pty = new PtyManager({
      onRaw: (id, data) => this.onRaw(id, data),
      onData: (id, data) => this.events.send('pty:data', id, data),
      onExit: (id, code, pid) => this.onExit(id, code, pid),
    });
    this.hooks = new HookChannel(join(dataDir, 'hooks'), (id, name) => {
      const live = this.live.get(id);
      if (live) live.lastSignalAt = Date.now();
      this.apply(id, { t: 'hook', name });
    });
    for (const s of allSessions(store.get())) this.machines.set(s.id, initialState(s.kind));
    setConoutLostHandler(() => console.error('[sesiones] se perdió el proceso auxiliar de terminales'));
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    this.pollTimer.unref();
  }

  runtimeMap(): RuntimeMap {
    const map: RuntimeMap = {};
    for (const s of allSessions(this.store.get())) map[s.id] = this.runtimeOf(s.id, s);
    return map;
  }

  private runtimeOf(id: string, session?: SessionRecord): SessionRuntime {
    const machine = this.machines.get(id) ?? initialState(session?.kind ?? 'claude');
    const runtime: SessionRuntime = { status: machine.status };
    if (machine.exitCode !== undefined) runtime.exitCode = machine.exitCode;
    if (machine.subagents) runtime.subagents = machine.subagents;
    const message = this.messages.get(id);
    if (message) runtime.message = message;
    return runtime;
  }

  private publish(id: string): void {
    this.events.send('runtime:update', id, this.runtimeOf(id));
    this.events.statusChanged();
  }

  private apply(id: string, ev: MachineEvent): void {
    const prev = this.machines.get(id);
    if (!prev) return;
    const next = transition(prev, ev, Date.now());
    if (next === prev) return;
    this.machines.set(id, next);
    if (next.status !== prev.status || next.exitCode !== prev.exitCode) this.onStatusChange(id, prev.status, next.status);
    else if ((next.subagents ?? 0) !== (prev.subagents ?? 0)) this.publish(id);
  }

  private onStatusChange(id: string, from: SessionStatus, to: SessionStatus): void {
    this.publish(id);
    const pending = this.notifyTimers.get(id);
    if (pending) {
      clearTimeout(pending);
      this.notifyTimers.delete(id);
    }
    if (to === 'done') this.scheduleViewed(id);
    if (from === to) return;
    if (to === 'done') {
      const timer = setTimeout(() => {
        this.notifyTimers.delete(id);
        if (this.machines.get(id)?.status === 'done') this.notifyIfUnseen(id, 'done');
      }, DONE_NOTIFY_DELAY_MS);
      timer.unref();
      this.notifyTimers.set(id, timer);
    } else if (to === 'waiting' || to === 'error') {
      this.notifyIfUnseen(id, to);
    }
  }

  private notifyIfUnseen(id: string, status: SessionStatus): void {
    if (this.windowFocused && this.visible.has(id)) return;
    const found = findSession(this.store.get(), id);
    if (found) this.events.notify(found.session, status);
  }

  /** El verde dura hasta que el usuario abre la sesión, con un segundo de gracia. */
  private scheduleViewed(id: string): void {
    const pending = this.viewTimers.get(id);
    if (pending) clearTimeout(pending);
    this.viewTimers.delete(id);
    if (!this.windowFocused || !this.visible.has(id)) return;
    const timer = setTimeout(() => {
      this.viewTimers.delete(id);
      if (this.windowFocused && this.visible.has(id)) this.apply(id, { t: 'viewed' });
    }, VIEW_DELAY_MS);
    timer.unref();
    this.viewTimers.set(id, timer);
  }

  setView(visible: string[], windowFocused: boolean): void {
    this.visible = new Set(visible);
    this.windowFocused = windowFocused;
    for (const id of visible) {
      if (this.machines.get(id)?.status === 'done') this.scheduleViewed(id);
    }
  }

  private onRaw(id: string, data: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.lastActivity = Date.now();
    if (live.session.kind !== 'claude') return;
    if (live.tail.length < 16_384) {
      live.tail += data;
      // El diálogo de confianza de la carpeta y la advertencia de --dangerously-skip-permissions bloquean
      // el arranque: te están esperando. Hilo no los responde por ti.
      if (this.machines.get(id)?.status === 'starting' && /trust this folder|Bypass Permissions mode[\s\S]*Yes, I accept/.test(stripAnsi(live.tail))) {
        this.apply(id, { t: 'startTimeout' });
      }
    }
    for (const title of live.scanner.feed(data)) {
      live.lastSignalAt = Date.now();
      this.apply(id, { t: 'title', kind: classifyTitle(title) });
    }
  }

  private fail(session: SessionRecord, message: string): void {
    // La marca sigue: una carpeta en un disco sin conectar vuelve a intentarse la próxima vez.
    this.messages.set(session.id, message);
    this.machines.set(session.id, { kind: session.kind, status: 'error', stopLatchUntil: 0 });
    this.publish(session.id);
  }

  /** Lanza el proceso. El renderer ya creó la terminal, que responde a `CSI c`. */
  async wake(id: string, cols: number, rows: number): Promise<boolean> {
    const existing = this.live.get(id);
    const replacing = !!existing?.stopping;
    if (replacing) await existing.stopping;
    if (this.live.has(id)) return true;
    const found = findSession(this.store.get(), id);
    if (!found) return false;
    try {
      // Crear una terminal bloquea hasta que el Worker conecta: tiene que estar listo antes.
      await ensureConoutWorker();
    } catch (err) {
      this.fail(found.session, `No se pudo iniciar la terminal:\n${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    if (this.live.has(id)) return true;
    const current = findSession(this.store.get(), id);
    if (!current) return false;
    // Lo último del proceso anterior no debe quedar en la terminal nueva.
    if (replacing) this.events.send('pty:reset', id);
    this.spawnSession(current.session, cols, rows, null, 0);
    return this.live.has(id);
  }

  private spawnSession(session: SessionRecord, cols: number, rows: number, forceResume: boolean | null, attempts: number): void {
    const id = session.id;
    this.messages.delete(id);
    if (!this.machines.has(id)) this.machines.set(id, initialState(session.kind));

    // Una ruta de red caída bloquearía el proceso principal 20 s: que falle al lanzar.
    if (!session.cwd.startsWith('\\\\') && !existsSync(session.cwd)) {
      this.fail(session, `La carpeta ya no existe:\n${session.cwd}`);
      return;
    }

    let pid: number;
    let wrapped = false;
    try {
      let file: string;
      let commandLine: string;
      if (session.kind === 'shell') {
        const testShell = process.env.HILO_E2E === '1' ? process.env.HILO_TEST_SHELL : undefined;
        const parts = testShell ? (JSON.parse(testShell) as string[]) : null;
        const shell = parts ? { file: parts[0]!, args: parts.slice(1) } : defaultShell();
        file = shell.file;
        commandLine = buildCommandLine(shell.args);
      } else {
        const settings = this.store.get().settings;
        const claude = resolveClaude(settings.claudePath);
        if (!claude) {
          this.fail(
            session,
            settings.claudePath
              ? `No se encontró claude en la ruta configurada:\n${settings.claudePath}`
              : 'No se encontró claude en el PATH.\nEn Ajustes, sección Claude Code, "Ver requisitos" explica cómo instalarlo. Ahí también puedes indicar su ruta.',
          );
          return;
        }
        const resume = forceResume ?? transcriptExists(session.cwd, session.claudeId);
        const settingsFile = settings.useHooks ? this.hooks.prepare(id) : null;
        const claudeArgs = buildClaudeArgs({ session, resume, settingsFile, skipPermissions: settings.skipPermissions });
        if (process.env.HILO_E2E === '1' && process.env.HILO_TEST_CLAUDE_ARGS) {
          claudeArgs.push(...(JSON.parse(process.env.HILO_TEST_CLAUDE_ARGS) as string[]));
        }
        ({ file, commandLine, wrapped } = commandFor(claude, claudeArgs));
      }
      pid = this.pty.spawn(id, { file, commandLine, cwd: session.cwd, env: buildEnv(id), cols, rows });
    } catch (err) {
      this.fail(session, `No se pudo iniciar el proceso:\n${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const now = Date.now();
    const live: Live = {
      pid,
      claudePid: wrapped ? null : pid,
      pidTries: 0,
      nextPidTry: now + REAL_PID_DELAY_MS,
      wrapped,
      session,
      scanner: new OscTitleScanner(),
      requested: false,
      startedAt: now,
      lastActivity: now,
      lastSignalAt: 0,
      tail: '',
      attempts,
      startTimer: null,
      onExit: [],
      stopping: null,
      otherClaudeId: null,
      cols,
      rows,
    };
    if (session.kind === 'claude') {
      live.startTimer = setTimeout(() => this.apply(id, { t: 'startTimeout' }), START_TIMEOUT_MS);
      live.startTimer.unref();
    }
    this.live.set(id, live);
    this.store.dispatch({ type: 'session/awake', id, awake: true });
    this.apply(id, { t: 'spawn' });
  }

  private onExit(id: string, code: number | undefined, pid: number): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    if (live.startTimer) clearTimeout(live.startTimer);
    this.hooks.stop(id);
    const callbacks = live.onExit;

    // Sin código: se perdió la conexión, y el proceso puede seguir vivo sin que nadie lo cierre.
    if (code === undefined) {
      void taskkillTree(pid);
      if (!live.requested) this.messages.set(id, 'Se perdió la conexión con la terminal y su proceso se cerró.');
    }

    if (code !== undefined && this.retryAfterFailedLaunch(live, code)) {
      for (const cb of callbacks) cb();
      return;
    }
    // Un /exit limpio también fue a propósito.
    this.forgetAwake(id, live.requested || code === 0);
    this.apply(id, { t: 'exit', code: code ?? -1, requested: live.requested });
    this.events.send('pty:exit', id, code ?? -1, this.machines.get(id)?.status);
    for (const cb of callbacks) cb();
  }

  /**
   * `--resume` falla si la sesión nunca tuvo conversación, y `--session-id` falla si el
   * id ya se usó. Si los dos fallan, el id está gastado y se asigna uno nuevo.
   * Se busca el mensaje exacto: la salida retomada puede contener cualquier otro texto.
   */
  private retryAfterFailedLaunch(live: Live, code: number): boolean {
    const { session } = live;
    if (session.kind !== 'claude' || live.requested || code !== 1) return false;
    if (Date.now() - live.startedAt > FAST_FAIL_MS || live.attempts >= 2) return false;
    const text = stripAnsi(live.tail);
    const missing = text.includes(`No conversation found with session ID: ${session.claudeId}`);
    const inUse = text.includes(`Session ID ${session.claudeId} is already in use`);
    if (!missing && !inUse) return false;

    const found = findSession(this.store.get(), session.id);
    if (!found) return false;
    let target = found.session;
    let forceResume = inUse && !missing;
    if (live.attempts === 1) {
      this.store.dispatch({ type: 'session/claudeId', id: session.id, claudeId: randomUUID() });
      target = findSession(this.store.get(), session.id)!.session;
      forceResume = false;
    }
    this.events.send('pty:reset', session.id);
    this.spawnSession(target, live.cols, live.rows, forceResume, live.attempts + 1);
    return true;
  }

  write(id: string, data: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.lastActivity = Date.now();
    this.pty.write(id, data);
  }

  resize(id: string, cols: number, rows: number): void {
    const live = this.live.get(id);
    if (live) {
      live.cols = cols;
      live.rows = rows;
    }
    this.pty.resize(id, cols, rows);
  }

  ack(id: string, chars: number): void {
    this.pty.ack(id, chars);
  }

  statusOf(id: string): SessionStatus {
    return this.machines.get(id)?.status ?? 'asleep';
  }

  isWorking(): boolean {
    for (const m of this.machines.values()) if (m.status === 'working') return true;
    return false;
  }

  /** null: no se pudo comprobar. No es lo mismo que "no hay procesos". */
  async background(id: string): Promise<BackgroundProcess[] | null> {
    const live = this.live.get(id);
    if (!live) return [];
    const procs = await snapshotProcesses();
    if (!procs) return null;
    // Una shell siempre figura como "Lista": lo que importa es lo que tenga corriendo.
    if (live.session.kind === 'shell') return shellChildren(live.pid, procs);
    await this.resolveClaudePid(live, procs);
    return backgroundProcesses(live.claudePid ?? live.pid, procs);
  }

  /**
   * Al salir de la app sigue contando como encendida: es lo que se recupera al abrir. Al apagar el PC
   * Windows puede matar las consolas antes de avisar a la app, y por eso una salida que nadie pidió
   * espera un momento: si era el apagado, la app ya no estará para borrar la marca.
   */
  private forgetAwake(id: string, requested: boolean): void {
    if (this.shuttingDown) return;
    const forget = () => {
      if (!this.shuttingDown && !this.live.has(id)) this.store.dispatch({ type: 'session/awake', id, awake: false });
    };
    if (requested) forget();
    else setTimeout(forget, UNEXPECTED_EXIT_GRACE_MS).unref();
  }

  /** Dormir: cierra el proceso y conserva el id. Nunca una sesión que trabaja. */
  async sleep(id: string): Promise<boolean> {
    if (this.machines.get(id)?.status === 'working') return false;
    const live = this.live.get(id);
    // Ya: si se cierra la app antes de que acabe de apagarse, igual se durmió a propósito.
    this.store.dispatch({ type: 'session/awake', id, awake: false });
    await this.stopProcess(id, true);
    // Si mientras tanto se despertó de nuevo, esa instancia no se toca.
    const machine = this.machines.get(id);
    if (machine && machine.status !== 'asleep' && (!live || !this.live.has(id))) {
      this.apply(id, { t: 'sleep' });
    }
    return true;
  }

  async remove(id: string): Promise<void> {
    const stopping = this.stopProcess(id, true);
    // Ya salió de la lista: si se deshace el cierre, vuelve dormida aunque el proceso aún se esté apagando.
    this.apply(id, { t: 'sleep' });
    await stopping;
    // Si se deshizo el cierre mientras se apagaba, la sesión vuelve a estar en la lista.
    if (findSession(this.store.get(), id)) {
      // Y si ya se despertó, ese proceso es otro: no se le toca el estado.
      if (!this.live.has(id)) this.apply(id, { t: 'sleep' });
      return;
    }
    try {
      this.hooks.remove(id);
    } catch (err) {
      console.error('[sesiones] no se pudo borrar el archivo de hooks', err);
    }
    this.machines.delete(id);
    this.messages.delete(id);
  }

  /** Registra una sesión nueva o restaurada. */
  register(session: SessionRecord): void {
    if (!this.machines.has(session.id)) this.machines.set(session.id, initialState(session.kind));
  }

  private stopProcess(id: string, graceful: boolean): Promise<void> {
    const live = this.live.get(id);
    if (!live) return Promise.resolve();
    if (live.stopping) return live.stopping;
    live.requested = true;
    live.stopping = this.doStop(id, live, graceful);
    return live.stopping;
  }

  private async doStop(id: string, live: Live, graceful: boolean): Promise<void> {
    const isCurrent = () => this.live.get(id) === live;
    const exited = new Promise<void>((resolve) => live.onExit.push(resolve));
    const waitExit = (ms: number) => Promise.race([exited, new Promise<void>((r) => setTimeout(r, ms))]);

    // La foto tiene que ver a los hijos antes de que mueran: sin ella un hijo desligado quedaría
    // huérfano. Solo al salir de la app, con su plazo, no se la puede esperar sin límite.
    const snapshot = snapshotProcesses();
    if (this.shuttingDown) await Promise.race([snapshot, new Promise((r) => setTimeout(r, SNAPSHOT_WAIT_MS))]);
    else await snapshot;

    if (graceful && live.session.kind === 'claude' && isCurrent()) {
      // Dos Ctrl+C seguidos es una salida limpia: corren los hooks SessionEnd del usuario.
      this.pty.write(id, '\x03');
      await new Promise((r) => setTimeout(r, CTRL_C_GAP_MS));
      if (isCurrent()) this.pty.write(id, '\x03');
      await waitExit(GRACEFUL_WAIT_MS);
    }
    if (isCurrent()) {
      this.pty.kill(id);
      await waitExit(500);
    }
    if (isCurrent()) {
      await taskkillTree(live.pid);
      await waitExit(1000);
    }
    const before = await snapshot;
    const tree = before ? descendants(live.pid, before) : [];
    if (tree.length === 0) return;
    // Al salir de la app no hay tiempo para otra foto: la app termina y lo pendiente ya no correría.
    if (this.shuttingDown) {
      for (const p of tree) killPid(p.pid);
      return;
    }
    // Lo que Claude lanzó en segundo plano, si sobrevivió. Se confirma pid + fecha: un PID se reutiliza.
    const after = await snapshotProcesses();
    if (!after) return;
    const alive = new Map(after.map((p) => [p.pid, p.created]));
    for (const p of tree) {
      if (alive.get(p.pid) === p.created) killPid(p.pid);
    }
  }

  /** El renderer se cayó: sus terminales ya no existen y hay que empezar de cero. */
  async restartAfterRendererCrash(): Promise<void> {
    this.pty.resetFlowControl();
    const ids = [...this.live.keys()];
    await Promise.allSettled(ids.map((id) => this.stopProcess(id, false)));
    for (const id of ids) this.apply(id, { t: 'sleep' });
  }

  /** Al salir de la app. Nada de procesos huérfanos. */
  async shutdown(fast: boolean): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.pollTimer);
    for (const timer of this.viewTimers.values()) clearTimeout(timer);
    for (const timer of this.notifyTimers.values()) clearTimeout(timer);
    const stops = [...this.live.keys()].map((id) => this.stopProcess(id, !fast));
    // Con la máquina saturada la foto de procesos puede tardar sus 8 s: sin ella quedarían huérfanos.
    await Promise.race([Promise.allSettled(stops), new Promise((r) => setTimeout(r, fast ? 1500 : 9000))]);
    // Se agotó el plazo: lo que siga vivo se cierra con su árbol, sin esperar más comprobaciones.
    if (!fast && this.live.size > 0) {
      const left = [...this.live.values()].map((live) => taskkillTree(live.pid));
      await Promise.race([Promise.allSettled(left), new Promise((r) => setTimeout(r, 1500))]);
    }
    this.hooks.dispose();
  }

  /** Salida inmediata: Windows se está apagando y no da tiempo a más. */
  killAllNow(): void {
    this.shuttingDown = true;
    for (const [id, live] of this.live) {
      live.requested = true;
      this.pty.kill(id);
      killPid(live.pid);
    }
  }

  private async poll(): Promise<void> {
    this.hooks.drainAll();
    await Promise.all([...this.live.entries()].map(([id, live]) => this.pollSessionFile(id, live)));
    this.pollCount++;
    if (this.pollCount % 40 === 0) this.autoSleep();
  }

  /** Con un `.cmd` hay que encontrar el proceso de Claude: es el que tiene archivo de sesión y hijos. */
  private async resolveClaudePid(live: Live, known?: ProcInfo[] | null): Promise<void> {
    if (live.claudePid !== null || !live.wrapped) return;
    const procs = known ?? (await snapshotProcesses());
    if (!procs) return;
    const child = descendants(live.pid, procs).find((p) => /^(claude|node|bun)\.exe$/i.test(p.name));
    if (child) live.claudePid = child.pid;
  }

  /**
   * Único caso sin otra señal: Esc en un permiso. Archivo interno de Claude Code, sin
   * contrato: si falta, cambia o no coincide el id, se ignora. El `.key` de al lado
   * no se abre nunca.
   */
  private async pollSessionFile(id: string, live: Live): Promise<void> {
    if (live.session.kind !== 'claude') return;
    if (live.claudePid === null) {
      if (live.pidTries < REAL_PID_MAX_TRIES && Date.now() >= live.nextPidTry) {
        // 3, 6, 12, 24 y 48 s tras abrir: un arranque lento también se encuentra.
        live.pidTries++;
        live.nextPidTry = Date.now() + REAL_PID_DELAY_MS * 2 ** live.pidTries;
        await this.resolveClaudePid(live);
      }
      if (live.claudePid === null) return;
    }
    try {
      const raw = await fsp.readFile(join(claudeConfigDir(), 'sessions', `${live.claudePid}.json`), 'utf8');
      const parsed = JSON.parse(raw) as { pid?: unknown; sessionId?: unknown; status?: unknown; statusUpdatedAt?: unknown; startedAt?: unknown };
      if (this.live.get(id) !== live) return;
      // De otro Claude que tuvo este mismo PID.
      if (typeof parsed.pid === 'number' && parsed.pid !== live.claudePid) return;
      if (typeof parsed.startedAt === 'number' && parsed.startedAt < live.startedAt - STALE_SESSION_FILE_MS) return;
      const claudeId = findSession(this.store.get(), id)?.session.claudeId;
      if (parsed.sessionId === claudeId) {
        live.otherClaudeId = null;
      } else {
        // Sin fecha no se sabe de quién es este archivo. Con ella es de este proceso, y sus estados valen
        // aunque esté en otra conversación: tras /clear es la única señal al salir de un permiso con Esc.
        if (typeof parsed.startedAt !== 'number') return;
        this.followClaudeId(id, live, parsed.sessionId);
      }
      // El título y los hooks son más nuevos: esta lectura podría ser anterior a ellos.
      if (Date.now() - live.lastSignalAt < SESSION_FILE_SETTLE_MS) return;
      if (typeof parsed.statusUpdatedAt === 'number' && parsed.statusUpdatedAt < live.lastSignalAt) return;
      if (parsed.status === 'busy' || parsed.status === 'idle' || parsed.status === 'waiting') {
        this.apply(id, { t: 'sessionFile', status: parsed.status });
      }
    } catch {
      // Sin archivo: sigue arrancando, o Claude cambió el formato.
    }
  }

  /**
   * `/clear` y `/resume` cambian de conversación dentro del mismo proceso: al despertar se tiene
   * que retomar la última. Al retomar puede verse un id temporal, y un id sin transcript no se
   * podría retomar: cuenta si se repite en dos lecturas y ya tiene conversación guardada.
   */
  private followClaudeId(id: string, live: Live, sessionId: unknown): void {
    if (!isClaudeId(sessionId)) return;
    if (live.otherClaudeId !== sessionId) {
      live.otherClaudeId = sessionId;
      return;
    }
    if (!transcriptExists(live.session.cwd, sessionId)) return;
    // Otra sesión de Hilo ya sigue esa conversación: dos procesos en el mismo transcript la corromperían.
    if (allSessions(this.store.get()).some((s) => s.id !== id && s.claudeId === sessionId)) return;
    live.otherClaudeId = null;
    this.store.dispatch({ type: 'session/claudeId', id, claudeId: sessionId });
  }

  private autoSleep(): void {
    const minutes = this.store.get().settings.autoSleepMinutes;
    if (!minutes) return;
    const limit = Date.now() - minutes * 60_000;
    for (const [id, live] of this.live) {
      if (live.session.kind !== 'claude' || live.lastActivity > limit) continue;
      if (this.visible.has(id) && this.windowFocused) continue;
      // Solo sesiones leídas y en reposo: nunca una que trabaja o espera.
      if (this.machines.get(id)?.status !== 'idle') continue;
      void this.background(id).then((bg) => {
        // Sin poder comprobarlo, o con servidores corriendo, no se duerme sin que se pida.
        if (bg !== null && bg.length === 0 && this.machines.get(id)?.status === 'idle') void this.autoSleepOne(id);
      });
    }
  }

  private async autoSleepOne(id: string): Promise<void> {
    await this.sleep(id);
    this.events.send('session:autoSlept', id);
  }
}
