/**
 * Auditoría A5 (ronda 3): SessionController sin Electron (pty y procesos falsos), máquina de estados y guardado.
 * Afirman lo CORRECTO: si fallan, el fallo está reproducido.
 * Solo con HILO_AUDIT=1, para que `npm test` siga en verde mientras no se arreglen.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OscTitleScanner, classifyTitle } from '../../src/shared/oscScanner';
import { initialState, transition, type MachineEvent, type MachineState } from '../../src/shared/statusMachine';
import { defaultState } from '../../src/shared/defaults';
import { Store } from '../../src/main/store';
import type { ProcInfo } from '../../src/main/processes';

const h = vi.hoisted(() => ({
  pty: null as any,
  log: [] as string[],
  exitOnKill: true,
  nextPid: 100,
  snapshots: [] as (() => Promise<unknown>)[],
  killed: [] as number[],
}));

vi.mock('../../src/main/pty/sharedConout', () => ({
  ensureConoutWorker: async () => undefined,
  setConoutLostHandler: () => undefined,
  abandonLastConout: () => undefined,
}));

vi.mock('../../src/main/pty/ptyManager', () => ({
  PtyManager: class {
    ev: any;
    current = new Map<string, number>();
    spawned: { id: string; pid: number; commandLine: string }[] = [];
    writes: string[] = [];
    constructor(ev: any) {
      this.ev = ev;
      h.pty = this;
    }
    spawn(id: string, opts: { commandLine: string }) {
      const pid = h.nextPid++;
      this.current.set(id, pid);
      this.spawned.push({ id, pid, commandLine: opts.commandLine });
      h.log.push(`spawn:${pid}`);
      return pid;
    }
    write(_id: string, data: string) {
      this.writes.push(data);
    }
    resize() {}
    ack() {}
    resetFlowControl() {}
    kill(id: string) {
      h.log.push(`kill:${id}`);
      if (h.exitOnKill) queueMicrotask(() => this.exit(id, 0));
    }
    exit(id: string, code: number | undefined) {
      const pid = this.current.get(id);
      if (pid === undefined) return;
      this.current.delete(id);
      h.log.push(`exit:${pid}`);
      this.ev.onExit(id, code, pid);
    }
  },
}));

vi.mock('../../src/main/processes', async (orig) => {
  const real = (await orig()) as typeof import('../../src/main/processes');
  return {
    ...real,
    snapshotProcesses: () => {
      const next = h.snapshots.shift();
      return next ? next() : Promise.resolve([]);
    },
    killPid: (pid: number) => {
      h.killed.push(pid);
    },
    taskkillTree: async () => undefined,
  };
});

const { SessionController } = await import('../../src/main/sessions');

const audit = describe.skipIf(!process.env.HILO_AUDIT);
const BASE = process.env.A5R3_DIR ?? tmpdir();
mkdirSync(BASE, { recursive: true });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function proc(pid: number, ppid: number, name = 'node.exe', created = 1000): ProcInfo {
  return { pid, ppid, name, created, command: '' };
}

const until = async (fn: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 5));
  if (!fn()) throw new Error('no se cumplió a tiempo');
};

function setup(kind: 'shell' | 'claude', claudeFile = false) {
  const data = mkdtempSync(join(BASE, 'u-data-'));
  const cfg = mkdtempSync(join(BASE, 'u-cfg-'));
  mkdirSync(join(cfg, 'sessions'), { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const exe = join(data, 'claude.exe');
  if (claudeFile) writeFileSync(exe, '');
  const state = defaultState();
  const id = 'sesion-1';
  const claudeId = '11111111-1111-4111-8111-111111111111';
  state.projects = [{ id: 'p', name: 'p', path: data, color: null, collapsed: false, sessions: [{ id, claudeId, kind, name: 'x', color: null, cwd: data, createdAt: 1 }] }];
  state.settings.claudePath = claudeFile ? exe : '';
  state.settings.useHooks = false;
  writeFileSync(join(data, 'state.json'), JSON.stringify(state));
  const store = new Store(data);
  const sends: string[] = [];
  const ctrl = new SessionController(store, data, {
    send: (channel: string) => {
      sends.push(channel);
      if (channel === 'pty:reset') h.log.push('reset');
    },
    notify: () => undefined,
    statusChanged: () => undefined,
  });
  return { ctrl, store, id, claudeId, data, cfg, sends };
}

beforeEach(() => {
  h.log.length = 0;
  h.exitOnKill = true;
  h.snapshots.length = 0;
  h.killed.length = 0;
  h.nextPid = 100;
});
afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
});

audit('wake y pty:reset', () => {
  it('un despertar que esperaba al apagado no borra la terminal del proceso que ya arrancó', async () => {
    const { ctrl, id } = setup('shell');
    await ctrl.wake(id, 80, 24);
    const after = deferred<ProcInfo[] | null>();
    h.snapshots.push(async () => [proc(100, 1, 'node.exe'), proc(500, 100)], () => after.promise);
    const stopping = ctrl.sleep(id);
    // X: pide despertar con el apagado en curso.
    await until(() => h.log.includes('kill:sesion-1') || (ctrl as any).live.get(id).stopping !== null);
    const x = ctrl.wake(id, 80, 24);
    await until(() => h.log.includes('exit:100'));
    // Y: otro despertar, ya sin proceso vivo pero con el apagado aún esperando la segunda foto.
    await ctrl.wake(id, 80, 24);
    expect(h.log).toContain('spawn:101');
    after.resolve([]);
    await Promise.all([x, stopping]);
    console.log(`[wake] ${h.log.join(' ')}`);
    const spawnAt = h.log.indexOf('spawn:101');
    expect(h.log.slice(spawnAt)).not.toContain('reset');
  });
});

audit('followClaudeId', () => {
  const write = (cfg: string, pid: number, body: object) => writeFileSync(join(cfg, 'sessions', `${pid}.json`), JSON.stringify(body));
  const poll = (ctrl: any, id: string) => ctrl.pollSessionFile(id, ctrl.live.get(id));

  it('el archivo de otro Claude con el mismo PID (startedAt viejo) no se adopta', async () => {
    const { ctrl, store, id, claudeId, cfg } = setup('claude', true);
    await ctrl.wake(id, 80, 24);
    const other = '22222222-2222-4222-8222-222222222222';
    write(cfg, 100, { sessionId: other, status: 'busy', startedAt: Date.now() - 60_000 });
    await poll(ctrl, id);
    await poll(ctrl, id);
    expect(store.get().projects[0]!.sessions[0]!.claudeId).toBe(claudeId);
    expect(ctrl.statusOf(id)).toBe('starting');
  });

  it('un archivo sin startedAt no permite adoptar: no se puede saber de quién es', async () => {
    const { ctrl, store, id, claudeId, cfg } = setup('claude', true);
    await ctrl.wake(id, 80, 24);
    write(cfg, 100, { sessionId: '22222222-2222-4222-8222-222222222222', status: 'idle' });
    await poll(ctrl, id);
    await poll(ctrl, id);
    console.log(`[sin startedAt] claudeId=${store.get().projects[0]!.sessions[0]!.claudeId}`);
    expect(store.get().projects[0]!.sessions[0]!.claudeId).toBe(claudeId);
  });

  it('un id temporal que dura dos lecturas no sustituye una conversación que existe', async () => {
    const { ctrl, store, id, claudeId, cfg, data } = setup('claude', true);
    // La conversación existe: se retomaría.
    const slug = data.replace(/[^a-zA-Z0-9]/g, '-');
    mkdirSync(join(cfg, 'projects', slug), { recursive: true });
    writeFileSync(join(cfg, 'projects', slug, `${claudeId}.jsonl`), '');
    await ctrl.wake(id, 80, 24);
    expect(h.pty.spawned[0].commandLine).toContain('--resume');
    const temp = '33333333-3333-4333-8333-333333333333';
    write(cfg, 100, { sessionId: temp, startedAt: Date.now() });
    await poll(ctrl, id);
    await poll(ctrl, id);
    const adopted = store.get().projects[0]!.sessions[0]!.claudeId;
    // Se apaga justo ahora: el siguiente despertar decide con el id guardado.
    h.pty.exit(id, 0);
    await ctrl.wake(id, 80, 24);
    const line = h.pty.spawned[1].commandLine as string;
    console.log(`[id temporal] adoptado=${adopted}; siguiente lanzamiento=${line.slice(0, 70)}`);
    expect(adopted).toBe(claudeId);
    expect(line).toContain('--resume');
  });

  it('dos sesiones de Hilo no acaban apuntando a la misma conversación por /resume', async () => {
    const { ctrl, store, id, cfg } = setup('claude', true);
    const other = '44444444-4444-4444-8444-444444444444';
    store.dispatch({
      type: 'session/add',
      projectId: 'p',
      session: { id: 'sesion-2', claudeId: other, kind: 'claude', name: 'b', color: null, cwd: 'C:\\', createdAt: 1 },
    });
    ctrl.register(store.get().projects[0]!.sessions[1]!);
    await ctrl.wake(id, 80, 24);
    write(cfg, 100, { sessionId: other, startedAt: Date.now() });
    await poll(ctrl, id);
    await poll(ctrl, id);
    const ids = store.get().projects[0]!.sessions.map((s) => s.claudeId);
    console.log(`[misma conversación] ${ids.join(' ')}`);
    expect(new Set(ids).size).toBe(2);
  });
});

audit('doStop', () => {
  it('si el proceso nunca avisa de la salida, despertar no deja un panel en blanco sin decir nada', async () => {
    const { ctrl, id } = setup('shell');
    await ctrl.wake(id, 80, 24);
    h.exitOnKill = false;
    const ok = await ctrl.sleep(id);
    const status = ctrl.statusOf(id);
    h.log.length = 0;
    await ctrl.wake(id, 80, 24);
    console.log(`[sin salida] sleep=${ok} estado=${status}; al despertar: ${h.log.join(' ') || '(nada)'} ; pantalla borrada=${h.log.includes('reset')}`);
    // Sin proceso nuevo y con la terminal recién borrada, el panel queda en blanco.
    expect(h.log.includes('reset') && !h.log.some((l) => l.startsWith('spawn'))).toBe(false);
  }, 20_000);
});

// ---------------------- máquina de estados contra las grabaciones ---------------------------

const FIXTURES = join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures');

interface Line {
  t?: number;
  data?: string;
  sessfile?: { status?: string };
  exit?: number;
}

function replay(name: string, inject: { at: 'spawn'; ev: MachineEvent } | null): string[] {
  const lines = readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
  const scanner = new OscTitleScanner();
  let s: MachineState = transition(initialState('claude'), { t: 'spawn' }, 0);
  if (inject) s = transition(s, inject.ev, 0);
  const seen = [s.status as string];
  const apply = (ev: MachineEvent, t: number) => {
    s = transition(s, ev, t);
    if (seen[seen.length - 1] !== s.status) seen.push(s.status);
  };
  for (const l of lines) {
    const t = l.t ?? 0;
    if (l.data !== undefined) for (const title of scanner.feed(l.data)) apply({ t: 'title', kind: classifyTitle(title) }, t);
    const st = l.sessfile?.status;
    if (st === 'busy' || st === 'idle' || st === 'waiting') apply({ t: 'sessionFile', status: st }, t);
    if (l.exit !== undefined) apply({ t: 'exit', code: l.exit, requested: false }, t);
  }
  return seen;
}

audit('blockedAtStart contra las grabaciones', () => {
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith('.jsonl') && !n.startsWith('calibracion'))) {
    it(`${f}: con el diálogo de confianza al principio, termina igual que sin él`, () => {
      const plain = replay(f, null);
      const blocked = replay(f, { at: 'spawn', ev: { t: 'startTimeout' } });
      console.log(`[${f}] sin=${plain.join('>')} con=${blocked.join('>')}`);
      expect(blocked[blocked.length - 1]).toBe(plain[plain.length - 1]);
      // Lo único distinto es el amarillo del principio.
      const core = (l: string[]) => l.filter((x, i) => !(i === 0 && (x === 'waiting' || x === 'starting'))).join('>');
      expect(core(blocked)).toBe(core(plain));
    });
  }

  it('la marca no sobrevive al arranque: un permiso visto por el archivo de sesión sigue en amarillo con ✳', () => {
    let s: MachineState = transition(initialState('claude'), { t: 'spawn' }, 0);
    s = transition(s, { t: 'startTimeout' }, 0); // 45 s sin título: arranque lento
    s = transition(s, { t: 'title', kind: 'working' }, 1); // ◐ antes que ✳
    s = transition(s, { t: 'title', kind: 'ready' }, 2);
    s = transition(s, { t: 'sessionFile', status: 'waiting' }, 3); // permiso, sin hooks
    s = transition(s, { t: 'title', kind: 'ready' }, 4); // ✳ también sale esperando
    console.log(`[marca] estado=${s.status} blockedAtStart=${s.blockedAtStart}`);
    expect(s.status).toBe('waiting');
  });

  it('el archivo de sesión también saca del bloqueo y limpia la marca', () => {
    let s: MachineState = transition(initialState('claude'), { t: 'spawn' }, 0);
    s = transition(s, { t: 'startTimeout' }, 0);
    s = transition(s, { t: 'sessionFile', status: 'idle' }, 1);
    s = transition(s, { t: 'sessionFile', status: 'waiting' }, 2);
    s = transition(s, { t: 'title', kind: 'ready' }, 3);
    console.log(`[marca 2] estado=${s.status} blockedAtStart=${s.blockedAtStart}`);
    expect(s.status).toBe('waiting');
  });
});

// ---------------------- guardado ------------------------------------------------------------

function storeDir(): string {
  return mkdtempSync(join(BASE, 'u-store-'));
}

/** Abre el archivo sin compartirlo, como un antivirus. Devuelve cómo soltarlo. */
async function lockExclusive(file: string): Promise<() => Promise<void>> {
  const ps = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `$f=[IO.File]::Open('${file.replace(/'/g, "''")}','Open','ReadWrite','None'); Write-Output LOCKED; [Console]::In.ReadLine() | Out-Null; $f.Close()`],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    ps.stdout.on('data', (d: Buffer) => {
      if (d.toString().includes('LOCKED')) resolve();
    });
    ps.on('exit', () => reject(new Error('no se pudo bloquear')));
  });
  return async () => {
    ps.removeAllListeners('exit');
    const gone = new Promise((r) => ps.on('exit', r));
    ps.stdin.write('\n');
    await gone;
  };
}

const withProjects = (n: number) => {
  const s = defaultState();
  s.projects = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, path: 'C:\\x', color: null, collapsed: false, sessions: [] }));
  return s;
};

audit('store.ts', () => {
  it('un state.json bloqueado al arrancar, sin .bak, no se pisa con un estado vacío', async () => {
    const d = storeDir();
    const file = join(d, 'state.json');
    writeFileSync(file, JSON.stringify(withProjects(3)));
    const release = await lockExclusive(file);
    const store = new Store(d);
    const seen = store.get().projects.length;
    const notice = store.notice;
    await release();
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    store.flush();
    const files = readdirSync(d);
    const onDisk = (JSON.parse(readFileSync(file, 'utf8')) as { projects: unknown[] }).projects.length;
    console.log(`[bloqueado] proyectos al arrancar=${seen}; en disco tras guardar=${onDisk}; aviso=${notice}; archivos=${files.join(',')}`);
    const survives = onDisk === 3 || files.some((n) => n.startsWith('state.json.corrupto'));
    expect(survives).toBe(true);
  }, 30_000);

  it('un state.json bloqueado al arrancar, con .bak: no se pierde lo último guardado', async () => {
    const d = storeDir();
    const file = join(d, 'state.json');
    writeFileSync(file, JSON.stringify(withProjects(3)));
    writeFileSync(`${file}.bak`, JSON.stringify(withProjects(2)));
    const release = await lockExclusive(file);
    const store = new Store(d);
    const seen = store.get().projects.length;
    const notice = store.notice;
    await release();
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    store.flush();
    const onDisk = (JSON.parse(readFileSync(file, 'utf8')) as { projects: unknown[] }).projects.length;
    console.log(`[bloqueado con copia] al arrancar=${seen}; en disco=${onDisk}; aviso=${notice}; archivos=${readdirSync(d).join(',')}`);
    expect(onDisk === 3 || readdirSync(d).some((n) => n.startsWith('state.json.corrupto'))).toBe(true);
  }, 30_000);

  it('reintento de guardado: un solo temporizador, y sin congelar el proceso principal', async () => {
    const d = storeDir();
    const file = join(d, 'state.json');
    writeFileSync(file, JSON.stringify(withProjects(1)));
    const store = new Store(d);
    const errors: string[] = [];
    store.onSaveError = (m) => errors.push(m);
    const release = await lockExclusive(file);
    // Mide lo que queda bloqueado el hilo: una tarea cada 10 ms que apunta el mayor hueco.
    let last = Date.now();
    let worst = 0;
    let blocked = 0;
    const tick = setInterval(() => {
      const gap = Date.now() - last - 10;
      if (gap > 30) blocked += gap;
      if (gap > worst) worst = gap;
      last = Date.now();
    }, 10);
    const t0 = Date.now();
    let timers = 0;
    const realSet = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 1000 || ms === 300) timers++;
      return realSet(fn, ms);
    }) as typeof setTimeout);
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    store.dispatch({ type: 'ui/sidebar', collapsed: false });
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    await new Promise((r) => realSet(r, 6000));
    spy.mockRestore();
    clearInterval(tick);
    const elapsed = Date.now() - t0;
    await release();
    await new Promise((r) => realSet(r, 1500));
    const saved = (JSON.parse(readFileSync(file, 'utf8')) as { ui: { sidebarCollapsed: boolean } }).ui.sidebarCollapsed;
    console.log(`[reintento] en ${elapsed} ms: temporizadores=${timers}, hueco máximo=${worst} ms, bloqueado=${blocked} ms (${Math.round((blocked / elapsed) * 100)} %); avisos=${errors.length}; guardado al soltar=${saved}`);
    expect(saved).toBe(true);
    expect(errors.length).toBe(1);
    expect(worst).toBeLessThan(250);
  }, 30_000);

  it('versión futura: se conserva y el aviso no la llama dañada', () => {
    const d = storeDir();
    const file = join(d, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 99, projects: [] }));
    const store = new Store(d);
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    store.flush();
    const files = readdirSync(d);
    console.log(`[futura] aviso=${store.notice}; archivos=${files.join(',')}`);
    expect(files.some((n) => n.startsWith('state.json.corrupto'))).toBe(true);
    expect(store.notice ?? '').not.toMatch(/dañado/);
  });

  it('sin projects: va al camino de archivo dañado y recupera la copia', () => {
    const d = storeDir();
    const file = join(d, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 1 }));
    writeFileSync(`${file}.bak`, JSON.stringify(withProjects(2)));
    const store = new Store(d);
    expect(store.get().projects.length).toBe(2);
    expect(store.notice).toBeTruthy();
    expect(existsSync(file)).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });
});
