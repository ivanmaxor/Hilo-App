import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedState, SessionKind, SessionRecord } from '../../src/shared/types';
import { defaultState } from '../../src/shared/defaults';

export const ROOT = join(__dirname, '..', '..');
const SINK = join(ROOT, 'tests', 'fixtures', 'sink.cjs');

export interface LaunchOptions {
  dataDir?: string;
  sinkFlags?: string[];
  state?: PersistedState;
  /** Portapapeles real del sistema. Solo para las pruebas que lo guardan y restauran. */
  realClipboard?: boolean;
  claudeArgs?: string[];
  /** Argumentos de Chromium: escala de pantalla, sin WebGL. */
  args?: string[];
  env?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
  sinkFile: string;
  close(): Promise<void>;
}

export function newDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'hilo-e2e-'));
}

export async function launch(opts: LaunchOptions = {}): Promise<Launched> {
  const dataDir = opts.dataDir ?? newDataDir();
  mkdirSync(dataDir, { recursive: true });
  if (opts.state) writeFileSync(join(dataDir, 'state.json'), JSON.stringify(opts.state));
  const sinkFile = join(dataDir, 'sink-out.bin');
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HILO_E2E: '1',
    HILO_DATA_DIR: dataDir,
    HILO_TEST_HIDDEN: '1',
    HILO_TEST_SHELL: JSON.stringify([process.execPath, SINK, sinkFile, ...(opts.sinkFlags ?? ['--bracket'])]),
    ...(opts.env ?? {}),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!opts.realClipboard) env.HILO_TEST_CLIPBOARD = 'memory';
  if (opts.claudeArgs) env.HILO_TEST_CLAUDE_ARGS = JSON.stringify(opts.claudeArgs);

  const app = await _electron.launch({ args: ['.', ...(opts.args ?? [])], cwd: ROOT, env, timeout: 60_000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window as unknown as { __hiloTest?: unknown }).__hiloTest, undefined, { timeout: 30_000 });
  if (opts.width && opts.height) await setWindowSize(app, opts.width, opts.height);
  return {
    app,
    page,
    dataDir,
    sinkFile,
    close: async () => {
      await app.close().catch(() => undefined);
    },
  };
}

export async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setContentSize(w as number, h as number);
  }, [width, height]);
}

export function makeState(sessions: { id: string; kind?: SessionKind; name?: string }[], cwd = ROOT): PersistedState {
  const state = defaultState();
  const records: SessionRecord[] = sessions.map((s) => ({
    id: s.id,
    claudeId: s.id,
    kind: s.kind ?? 'shell',
    name: s.name ?? s.id,
    color: null,
    cwd,
    createdAt: 1,
  }));
  state.projects = [{ id: 'proy', name: 'proyecto', path: cwd, color: null, collapsed: false, sessions: records }];
  state.window = { width: 1200, height: 760, maximized: false };
  // Las pruebas de estados necesitan que Claude pida permisos de verdad.
  state.settings.skipPermissions = false;
  state.settings.setupSeen = true;
  // Cada prueba decide qué despierta. Encender lo que quedó encendido se prueba aparte.
  state.settings.startup = 'asleep';
  return state;
}

export function cleanup(dataDir: string): void {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows puede tardar en soltar archivos; está en la carpeta temporal.
  }
}

/** Selecciona una sesión, espera a que arranque y a que la falsa shell haya escrito todo. */
export async function openSink(page: Page, id: string): Promise<void> {
  await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
  await waitForText(page, id, 'LISTO');
  await focusTerm(page, id);
  await page.waitForTimeout(150);
}

export async function focusTerm(page: Page, id: string): Promise<void> {
  await page.evaluate((sid) => (window as any).__hiloTest.terminals.focus(sid), id);
}

export async function bufferText(page: Page, id: string): Promise<string> {
  return page.evaluate((sid) => {
    const entry = (window as any).__hiloTest.terminals.debugEntry(sid);
    if (!entry) return '';
    const buf = entry.term.buffer.active;
    const out: string[] = [];
    for (let i = 0; i < buf.length; i++) out.push(buf.getLine(i).translateToString(true));
    return out.join('\n');
  }, id);
}

export async function waitForText(page: Page, id: string, text: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    ([sid, t]) => {
      const entry = (window as any).__hiloTest?.terminals.debugEntry(sid);
      if (!entry) return false;
      const buf = entry.term.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        if (buf.getLine(i).translateToString(true).includes(t)) return true;
      }
      return false;
    },
    [id, text] as const,
    { timeout, polling: 100 },
  );
}

export async function setClipboard(app: ElectronApplication, text: string, image = false): Promise<void> {
  await app.evaluate((_e, [t, img]) => {
    const clip = (globalThis as any).__hilo.clipboard;
    clip.text = t;
    clip.image = img;
  }, [text, image] as const);
}

export async function getClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(() => (globalThis as any).__hilo.clipboard.text as string);
}

export function readSink(file: string): Buffer {
  try {
    return readFileSync(file);
  } catch {
    return Buffer.alloc(0);
  }
}

export async function waitForSink(file: string, predicate: (b: Buffer) => boolean, timeout = 30_000): Promise<Buffer> {
  const start = Date.now();
  for (;;) {
    const data = readSink(file);
    if (predicate(data)) return data;
    if (Date.now() - start > timeout) return data;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function clearSink(file: string): void {
  writeFileSync(file, '');
}

/** Espera un poco para comprobar que no llegó nada de más. */
export async function settle(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function status(page: Page, id: string): Promise<string> {
  return page.evaluate((sid) => (window as any).__hiloTest.app.get().runtime[sid]?.status ?? 'asleep', id);
}

export async function waitStatus(page: Page, id: string, want: string | string[], timeout = 60_000): Promise<void> {
  const wanted = Array.isArray(want) ? want : [want];
  await page.waitForFunction(
    ([sid, w]) => (w as string[]).includes((window as any).__hiloTest.app.get().runtime[sid as string]?.status ?? 'asleep'),
    [id, wanted] as const,
    { timeout, polling: 100 },
  );
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Todos los descendientes vivos de un PID. Para comprobar que no quedan huérfanos, y varias pruebas
 * matan lo que devuelve. Windows recicla los PID: un programa ajeno cuyo padre ya murió puede apuntar
 * a un PID que ahora es de la prueba. Un hijo nunca es más viejo que su padre.
 */
export function processTree(root: number): { pid: number; name: string }[] {
  const out = execSync(
    `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,$_.Name,$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0}) }"`,
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const procs = out
    .split(/\r?\n/)
    .map((l) => l.split('|'))
    .filter((p) => p.length === 4)
    .map(([pid, ppid, name, created]) => ({ pid: Number(pid), ppid: Number(ppid), name: name!, created: Number(created) }));
  const rootCreated = procs.find((p) => p.pid === root)?.created;
  // Sin fecha de la raíz no se puede distinguir un hijo real de uno ajeno: mejor no devolver nada.
  if (!rootCreated) return [];
  const seen = new Map([[root, rootCreated]]);
  const found: { pid: number; name: string }[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      const parentCreated = seen.get(p.ppid);
      if (parentCreated !== undefined && !seen.has(p.pid) && p.created >= parentCreated) {
        seen.set(p.pid, p.created);
        found.push({ pid: p.pid, name: p.name });
        grew = true;
      }
    }
  }
  return found;
}
