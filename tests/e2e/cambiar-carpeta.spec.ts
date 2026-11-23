import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PersistedState, RuntimeMap } from '../../src/shared/types';
import { cleanup, launch, makeState, newDataDir, ROOT, status, waitStatus } from './helpers';

/**
 * #7: cambiar la carpeta de un proyecto o de una sesión. La ruta sale siempre del diálogo de Windows (aquí
 * simulado con `stubFolder`) y nunca del renderer. Shells y Claude falsos: no se usa Claude real.
 */
mkdirSync(join(ROOT, 'test-results', 'capturas'), { recursive: true });

const appState = (page: Page) =>
  page.evaluate(() => (window as any).__hiloTest.app.get() as { state: PersistedState; runtime: RuntimeMap });
const session = async (page: Page, id: string) => {
  const { state } = await appState(page);
  return state.projects.flatMap((p) => p.sessions).find((s) => s.id === id)!;
};
const cwdOf = async (page: Page, id: string) => (await session(page, id)).cwd;
const projectPath = async (page: Page, id = 'proy') => (await appState(page)).state.projects.find((p) => p.id === id)!.path;

async function stubFolder(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never;
  }, folder);
}

/** Carpetas de prueba: la vieja con una subcarpeta, la nueva con la misma subcarpeta, y otra aparte. */
function folders() {
  const base = newDataDir();
  const dir = (...parts: string[]) => {
    const p = join(base, ...parts);
    mkdirSync(p, { recursive: true });
    return p;
  };
  return { base, viejo: dir('viejo'), viejoSub: dir('viejo', 'sub'), nuevo: dir('nuevo'), nuevoSub: dir('nuevo', 'sub'), otra: dir('otra'), perdida: join(base, 'viejo', 'ya-no-existe') };
}

const rec = (id: string, name: string, cwd: string, kind: 'claude' | 'shell' = 'shell') => ({ id, claudeId: crypto.randomUUID(), kind, name, color: null, cwd, createdAt: 1 });

async function projectMenu(page: Page, projectId = 'proy') {
  await page.locator(`[data-project="${projectId}"] .project-head`).click({ button: 'right' });
}
async function sessionMenu(page: Page, id: string) {
  await page.locator(`[data-session="${id}"]`).first().click({ button: 'right' });
}

test('cambiar la carpeta de un proyecto mueve las sesiones marcadas que estaban dentro de la vieja y no toca las demás', async () => {
  test.setTimeout(120_000);
  const f = folders();
  const state = makeState([], f.viejo);
  state.projects[0]!.sessions = [
    rec('raiz', 'En la raíz', f.viejo),
    rec('sub', 'En una subcarpeta', f.viejoSub),
    rec('dejada', 'La dejo donde está', f.viejo),
    rec('perdida', 'Carpeta perdida', f.perdida),
    rec('fuera', 'En otra carpeta', f.otra),
  ];
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state });
  try {
    const { page, app } = ctx;
    // Una sesión con la carpeta inexistente falla al despertar y muestra su panel.
    await page.evaluate(() => (window as any).__hiloTest.selectSession('perdida'));
    await waitStatus(page, 'perdida', 'error');
    await expect(page.locator('[data-missing-cwd="perdida"]')).toBeVisible();

    await stubFolder(app, f.nuevo);
    await projectMenu(page);
    await page.locator('[data-action="menu-change-folder"]').click();

    // El diálogo muestra la carpeta vieja y la nueva, y solo las sesiones que estaban dentro de la vieja, marcadas.
    const dialog = page.locator('.dialog');
    await expect(dialog.locator('h2')).toContainText('Cambiar la carpeta de');
    await expect(dialog.locator('[data-relocate="paths"]')).toContainText(f.viejo);
    await expect(dialog.locator('[data-relocate="paths"]')).toContainText(f.nuevo);
    await expect(dialog.locator('[data-relocate-session]')).toHaveCount(4);
    await expect(dialog.locator('[data-relocate-session="fuera"]')).toHaveCount(0);
    for (const id of ['raiz', 'sub', 'dejada', 'perdida']) {
      await expect(dialog.locator(`[data-relocate-session="${id}"] input`)).toBeChecked();
    }
    // Solo la de la carpeta inexistente trae la marca.
    await expect(dialog.locator('[data-relocate-gone]')).toHaveCount(1);
    await expect(dialog.locator('[data-relocate-session="perdida"] [data-relocate-gone]')).toContainText('ya no existe');
    await expect(dialog.locator('[data-relocate="outside"]')).toContainText('Otra sesión trabaja en una carpeta distinta');

    await page.screenshot({ path: join(ROOT, 'test-results', 'capturas', 'cambiar-carpeta.png') });

    // Nada cambió hasta aceptar.
    expect(await projectPath(page)).toBe(f.viejo);
    await dialog.locator('[data-relocate-session="dejada"] input').uncheck();
    await dialog.locator('[data-confirm="ok"]').click();

    await expect.poll(() => projectPath(page)).toBe(f.nuevo);
    expect(await cwdOf(page, 'raiz')).toBe(f.nuevo);
    expect(await cwdOf(page, 'sub')).toBe(join(f.nuevo, 'sub'));
    // La subcarpeta no existe en la nueva: se abre en la raíz del proyecto.
    expect(await cwdOf(page, 'perdida')).toBe(f.nuevo);
    // Desmarcada y de otra carpeta: no se tocan.
    expect(await cwdOf(page, 'dejada')).toBe(f.viejo);
    expect(await cwdOf(page, 'fuera')).toBe(f.otra);
    // La conversación sigue siendo la misma.
    for (const id of ['raiz', 'sub', 'perdida']) {
      const s = await session(page, id);
      expect(s.claudeId).toMatch(/^[0-9a-f-]{36}$/);
    }
    await expect(page.locator('.toast')).toContainText('Se movieron 3 sesiones');
    await expect(page.locator('.toast').first()).toContainText('quedó en la raíz');

    // La que no arrancaba por su carpeta vuelve a dormida: el aviso de carpeta inexistente ya no vale. Y no se despertó sola.
    await expect.poll(() => status(page, 'perdida')).toBe('asleep');
    await expect(page.locator('[data-missing-cwd="perdida"]')).toHaveCount(0);
    for (const id of ['raiz', 'sub', 'dejada', 'fuera']) expect(await status(page, id)).toBe('asleep');
  } finally {
    await ctx.close();
    cleanup(dataDir);
    cleanup(f.base);
  }
});

test('la carpeta nueva ya es de otro proyecto, o es la misma: avisa y no cambia nada', async () => {
  const f = folders();
  const state = makeState([], f.viejo);
  state.projects[0]!.sessions = [rec('raiz', 'En la raíz', f.viejo)];
  state.projects.push({ id: 'otro', name: 'Otro proyecto', path: f.otra, color: null, collapsed: false, sessions: [] });
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state });
  try {
    const { page, app } = ctx;
    // Con otra forma de escribirla: mayúsculas y barras.
    await stubFolder(app, f.otra.toUpperCase().replace(/\\/g, '/'));
    await projectMenu(page);
    await page.locator('[data-action="menu-change-folder"]').click();
    await expect(page.locator('.toast')).toContainText('ya es la del proyecto «Otro proyecto»');
    await expect(page.locator('.dialog')).toHaveCount(0);
    expect(await projectPath(page)).toBe(f.viejo);
    expect(await cwdOf(page, 'raiz')).toBe(f.viejo);

    await stubFolder(app, f.viejo);
    await projectMenu(page);
    await page.locator('[data-action="menu-change-folder"]').click();
    await expect(page.locator('.toast').last()).toContainText('ya usa esa carpeta');
    expect(await projectPath(page)).toBe(f.viejo);
  } finally {
    await ctx.close();
    cleanup(dataDir);
    cleanup(f.base);
  }
});

test('cambiar la carpeta de una sola sesión, aunque la suya exista', async () => {
  test.setTimeout(90_000);
  const f = folders();
  const state = makeState([], f.viejo);
  state.projects[0]!.sessions = [rec('sana', 'Sana', f.viejo, 'claude'), rec('shell', 'PowerShell', f.viejo), rec('perdida', 'Perdida', f.perdida)];
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state });
  try {
    const { page, app } = ctx;
    const claudeId = (await session(page, 'sana')).claudeId;

    // Una sesión de Claude dormida: cambia la carpeta y nada más. Sin tocar el proyecto ni las demás.
    await stubFolder(app, f.otra);
    await sessionMenu(page, 'sana');
    await page.locator('[data-action="change-session-folder"]').click();
    await expect.poll(() => cwdOf(page, 'sana')).toBe(f.otra);
    expect((await session(page, 'sana')).claudeId).toBe(claudeId);
    expect(await cwdOf(page, 'shell')).toBe(f.viejo);
    expect(await projectPath(page)).toBe(f.viejo);
    await expect(page.locator('.toast')).toContainText('Al despertarla sigue su conversación desde ahí');
    expect(await status(page, 'sana')).toBe('asleep');

    // También una PowerShell.
    await stubFolder(app, f.nuevoSub);
    await sessionMenu(page, 'shell');
    await page.locator('[data-action="change-session-folder"]').click();
    await expect.poll(() => cwdOf(page, 'shell')).toBe(f.nuevoSub);

    // La misma carpeta: avisa y no cambia.
    await stubFolder(app, f.nuevoSub);
    await sessionMenu(page, 'shell');
    await page.locator('[data-action="change-session-folder"]').click();
    await expect(page.locator('.toast').last()).toContainText('Esa ya es la carpeta de esta sesión');

    // Una que no arrancaba por su carpeta: al elegir otra se despierta ahí, como hace su panel.
    await page.evaluate(() => (window as any).__hiloTest.selectSession('perdida'));
    await waitStatus(page, 'perdida', 'error');
    await stubFolder(app, f.nuevo);
    await sessionMenu(page, 'perdida');
    await page.locator('[data-action="change-session-folder"]').click();
    await expect.poll(() => cwdOf(page, 'perdida')).toBe(f.nuevo);
    await expect.poll(() => status(page, 'perdida'), { timeout: 30_000 }).not.toBe('error');
    await expect(page.locator('[data-missing-cwd="perdida"]')).toHaveCount(0);
  } finally {
    await ctx.close();
    cleanup(dataDir);
    cleanup(f.base);
  }
});

test('la ruta del renderer no se acepta: solo vale lo que el proceso principal guardó', async () => {
  const f = folders();
  const state = makeState([], f.viejo);
  state.projects[0]!.sessions = [rec('raiz', 'En la raíz', f.viejo), rec('fuera', 'En otra carpeta', f.otra)];
  state.projects.push({ id: 'otro', name: 'Otro', path: f.otra, color: null, collapsed: false, sessions: [rec('ajena', 'Ajena', f.otra)] });
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state });
  try {
    const { page, app } = ctx;
    const before = (await appState(page)).state.projects;
    const unchanged = async () => expect((await appState(page)).state.projects).toEqual(before);
    const call = (fn: string, ...args: unknown[]) => page.evaluate(([name, a]) => (window as any).hilo[name as string](...(a as unknown[])), [fn, args] as const);

    // Ni una ruta ni un código inventado sirven en el segundo paso.
    expect(await call('applyProjectFolder', 'proy', f.nuevo, ['raiz'])).toMatchObject({ ok: false });
    expect(await call('applyProjectFolder', 'proy', 'C:\\falso', ['raiz'])).toMatchObject({ ok: false });
    expect(await call('applyProjectFolder', 'proy', crypto.randomUUID(), ['raiz'])).toMatchObject({ ok: false });
    expect(await call('applyProjectFolder', '../x', 'abc', ['raiz'])).toMatchObject({ ok: false });
    // Las acciones que traen una ruta no pasan por el IPC de acciones.
    const rejected = await page.evaluate(async ([nuevo]) => {
      const out: string[] = [];
      const h = (window as any).hilo;
      await h.dispatch({ type: 'project/relocate', id: 'proy', path: nuevo, sessions: [] }).catch((e: Error) => out.push(e.message));
      await h.dispatch({ type: 'session/cwd', id: 'raiz', cwd: nuevo }).catch((e: Error) => out.push(e.message));
      return out;
    }, [f.nuevo]);
    expect(rejected).toHaveLength(2);
    await unchanged();

    // El primer paso solo devuelve un código y la ruta para mostrarla; el segundo no cambia lo que no estaba dentro de la vieja.
    await stubFolder(app, f.nuevo);
    const pick = await call('pickProjectFolder', 'proy');
    expect(pick).toMatchObject({ status: 'ok', from: f.viejo, to: f.nuevo });
    expect((pick as any).token).toMatch(/^[0-9a-f-]{36}$/);
    expect((pick as any).sessions.map((s: any) => s.id)).toEqual(['raiz']);
    // Un código de otro proyecto no vale en este.
    expect(await call('applyProjectFolder', 'otro', (pick as any).token, ['ajena'])).toMatchObject({ ok: false });
    // ...y se gastó al usarlo: ya no sirve ni en el suyo.
    expect(await call('applyProjectFolder', 'proy', (pick as any).token, ['raiz'])).toMatchObject({ ok: false });
    await unchanged();

    // Con un código bueno, los ids de otras carpetas o de otro proyecto se ignoran.
    const again = await call('pickProjectFolder', 'proy');
    const done = await call('applyProjectFolder', 'proy', (again as any).token, ['raiz', 'fuera', 'ajena', 'no-existe']);
    expect(done).toMatchObject({ ok: true, moved: 1 });
    expect(await projectPath(page)).toBe(f.nuevo);
    expect(await cwdOf(page, 'raiz')).toBe(f.nuevo);
    expect(await cwdOf(page, 'fuera')).toBe(f.otra);
    expect(await cwdOf(page, 'ajena')).toBe(f.otra);
    // El código usado no se puede repetir para mover otra cosa.
    expect(await call('applyProjectFolder', 'proy', (again as any).token, ['raiz'])).toMatchObject({ ok: false });

    // Cancelar el diálogo no cambia nada y no deja código.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as never;
    });
    expect(await call('pickProjectFolder', 'proy')).toEqual({ status: 'cancelled' });
    expect(await call('changeSessionFolder', 'raiz')).toMatchObject({ ok: false });
    expect(await cwdOf(page, 'raiz')).toBe(f.nuevo);
  } finally {
    await ctx.close();
    cleanup(dataDir);
    cleanup(f.base);
  }
});

/** Un `claude.cmd` falso: anota en qué carpeta y con qué argumentos lo lanzaron, y se queda esperando. */
function fakeClaude(dir: string, log: string): string {
  const file = join(dir, 'claude.cmd');
  writeFileSync(file, `@echo off\r\necho %CD%^|%* >> "${log}"\r\nping -n 120 127.0.0.1 >nul\r\n`);
  return file;
}
const launches = (log: string): { cwd: string; args: string }[] =>
  (existsSync(log) ? readFileSync(log, 'utf8') : '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => ({ cwd: l.split('|')[0]!.trim(), args: l.slice(l.indexOf('|') + 1).replace(/"/g, '') }));

test('una sesión despierta sigue en su carpeta vieja y avisa; una dormida retoma por id desde la nueva', async () => {
  test.setTimeout(150_000);
  const f = folders();
  const config = join(f.base, 'claude-config');
  const log = join(f.base, 'lanzamientos.log');
  const despierta = rec('despierta', 'Despierta', f.viejo, 'claude');
  const dormida = rec('dormida', 'Dormida', f.viejoSub, 'claude');
  const slug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
  // El historial de cada una está donde nació, en la carpeta vieja.
  const transcripts = [despierta, dormida].map((s) => {
    const file = join(config, 'projects', slug(s.cwd), `${s.claudeId}.jsonl`);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{"type":"user"}\n');
    return { file, size: statSync(file).size, id: s.claudeId };
  });
  const state = makeState([], f.viejo);
  state.projects[0]!.sessions = [despierta, dormida];
  state.settings.claudePath = fakeClaude(f.base, log);
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state, env: { CLAUDE_CONFIG_DIR: config } });
  try {
    const { page, app } = ctx;
    await page.evaluate(() => (window as any).__hiloTest.selectSession('despierta'));
    await expect.poll(() => launches(log).length, { timeout: 30_000 }).toBe(1);
    expect(launches(log)[0]!.cwd.toLowerCase()).toBe(f.viejo.toLowerCase());
    expect(launches(log)[0]!.args).toContain(`--resume ${despierta.claudeId}`);
    const pid = await app.evaluate(() => (globalThis as any).__hilo.pidOf('despierta') as number);
    expect(pid).toBeGreaterThan(0);

    await stubFolder(app, f.nuevo);
    await projectMenu(page);
    await page.locator('[data-action="menu-change-folder"]').click();
    await expect(page.locator('.dialog [data-relocate-session]')).toHaveCount(2);
    await page.locator('.dialog [data-confirm="ok"]').click();
    await expect.poll(() => projectPath(page)).toBe(f.nuevo);
    expect(await cwdOf(page, 'despierta')).toBe(f.nuevo);
    expect(await cwdOf(page, 'dormida')).toBe(join(f.nuevo, 'sub'));

    // La despierta no se reinicia ni se apaga: sigue con el mismo proceso y avisa qué hacer.
    await expect(page.locator('.toast', { hasText: 'sigue corriendo en su carpeta anterior' })).toContainText('«Despierta»');
    await expect(page.locator('.toast', { hasText: 'sigue corriendo en su carpeta anterior' })).toContainText('la duermas y la despiertes');
    expect(await status(page, 'despierta')).not.toBe('asleep');
    expect(await app.evaluate(() => (globalThis as any).__hilo.pidOf('despierta') as number)).toBe(pid);
    expect(launches(log)).toHaveLength(1);

    // La dormida retoma por id desde la carpeta nueva, con el mismo id de conversación.
    await page.evaluate(() => (window as any).__hiloTest.wakeSession('dormida'));
    await expect.poll(() => launches(log).length, { timeout: 30_000 }).toBe(2);
    const second = launches(log)[1]!;
    expect(second.cwd.toLowerCase()).toBe(join(f.nuevo, 'sub').toLowerCase());
    expect(second.args).toContain(`--resume ${dormida.claudeId}`);
    expect(second.args).not.toContain('--session-id');
    expect((await session(page, 'dormida')).claudeId).toBe(dormida.claudeId);

    // La despierta, al dormirla y despertarla, pasa a la carpeta nueva.
    await app.evaluate(async () => {
      await (globalThis as any).__hilo.sessions.sleep('despierta');
    });
    await waitStatus(page, 'despierta', 'asleep', 30_000);
    await page.evaluate(() => (window as any).__hiloTest.wakeSession('despierta'));
    await expect.poll(() => launches(log).length, { timeout: 30_000 }).toBe(3);
    expect(launches(log)[2]!.cwd.toLowerCase()).toBe(f.nuevo.toLowerCase());
    expect(launches(log)[2]!.args).toContain(`--resume ${despierta.claudeId}`);

    // El historial no se tocó ni se movió, y el claudeId no cambió.
    for (const t of transcripts) {
      expect(statSync(t.file).size).toBe(t.size);
    }
    expect((await session(page, 'despierta')).claudeId).toBe(despierta.claudeId);
    expect(existsSync(join(config, 'projects', slug(f.nuevo)))).toBe(false);
  } finally {
    await ctx.close();
    cleanup(dataDir);
    cleanup(f.base);
  }
});
