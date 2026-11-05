import { mkdirSync } from 'node:fs';
import { defaultState } from '../../src/shared/defaults';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PersistedState, RuntimeMap } from '../../src/shared/types';
import { bufferText, cleanup, focusTerm, launch, makeState, newDataDir, openSink, pidAlive, processTree, ROOT, settle, status, waitForText, waitStatus, setWindowSize } from './helpers';

const SHOTS = join(ROOT, 'test-results', 'capturas');
mkdirSync(SHOTS, { recursive: true });

const appState = (page: Page) =>
  page.evaluate(() => (window as any).__hiloTest.app.get() as { state: PersistedState; runtime: RuntimeMap });

const sessionNames = async (page: Page, project = 0) => (await appState(page)).state.projects[project]!.sessions.map((s) => s.name);

async function stubFolder(ctx: { app: import('@playwright/test').ElectronApplication }, folder: string) {
  await ctx.app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never;
  }, folder);
}

async function createShell(page: Page, name: string, projectIndex = 0) {
  await page.locator('.project').nth(projectIndex).locator('.project-head').hover();
  await page.locator('.project').nth(projectIndex).locator('.project-head .add').click();
  await page.locator('.seg button', { hasText: 'PowerShell' }).click();
  await page.locator('input[data-field="name"]').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.locator('.row .name', { hasText: new RegExp(`^${name}$`) })).toBeVisible();
}

test('crear, renombrar, colorear, mover, reordenar, colapsar, y sobrevive a reiniciar', async () => {
  test.setTimeout(150_000);
  const dataDir = newDataDir();
  // Encender lo que quedó encendido se prueba en restore.spec.ts.
  const empty = defaultState();
  empty.settings.startup = 'asleep';
  let ctx = await launch({ dataDir, state: empty });
  try {
    let { page } = ctx;

    // Pantalla vacía clara.
    await expect(page.locator('.empty h1')).toHaveText('Abre la carpeta de un proyecto');
    await page.screenshot({ path: join(SHOTS, 'vacio.png') });

    // Abrir carpeta y crear.
    await stubFolder(ctx, ROOT);
    await page.locator('.empty .primary').click();
    await expect(page.locator('.dialog h2')).toHaveText('Nueva sesión');
    await page.locator('.seg button', { hasText: 'PowerShell' }).click();
    await page.locator('input[data-field="name"]').fill('Uno');
    await page.keyboard.press('Enter');
    await expect(page.locator('.row .name', { hasText: 'Uno' })).toBeVisible();
    await createShell(page, 'Dos');
    await createShell(page, 'Tres');
    expect(await sessionNames(page)).toEqual(['Uno', 'Dos', 'Tres']);

    // Las pestañas muestran las sesiones del proyecto, con ícono.
    await expect(page.locator('.tab')).toHaveCount(3);
    await expect(page.locator('.tab svg.st')).toHaveCount(3);

    // Renombrar con F2.
    await page.locator('.row', { hasText: 'Uno' }).click();
    await page.keyboard.press('F2');
    await page.locator('.row .rename').fill('Uno bis');
    await page.keyboard.press('Enter');
    await expect(page.locator('.row .name', { hasText: 'Uno bis' })).toBeVisible();

    // Renombrar con doble clic. Esc cancela.
    await page.locator('.row', { hasText: 'Dos' }).dblclick();
    await page.locator('.row .rename').fill('No quiero esto');
    await page.keyboard.press('Escape');
    await expect(page.locator('.row .name', { hasText: /^Dos$/ })).toBeVisible();
    await page.locator('.row', { hasText: 'Dos' }).dblclick();
    await page.locator('.row .rename').fill('Dos bis');
    await page.keyboard.press('Enter');
    await expect(page.locator('.row .name', { hasText: 'Dos bis' })).toBeVisible();

    // Color de sesión y de proyecto.
    await page.locator('.row', { hasText: 'Tres' }).click({ button: 'right' });
    await page.locator('.menu .swatch[title="Rosa"]').click();
    await page.locator('.project-head').first().click({ button: 'right' });
    await page.locator('.menu .swatch[title="Azul"]').click();
    let s = (await appState(page)).state;
    expect(s.projects[0]!.color).toBe('#6f9bd1');
    expect(s.projects[0]!.sessions[2]!.color).toBe('#d68fa8');

    // Reordenar arrastrando.
    await page.locator('.row', { hasText: 'Tres' }).dragTo(page.locator('.row', { hasText: 'Uno bis' }), { targetPosition: { x: 20, y: 2 } });
    await expect.poll(() => sessionNames(page)).toEqual(['Tres', 'Uno bis', 'Dos bis']);

    // Otro proyecto y mover entre proyectos, arrastrando y por menú.
    await stubFolder(ctx, join(ROOT, 'docs'));
    await page.locator('.add-project').click();
    await page.locator('.seg button', { hasText: 'PowerShell' }).click();
    await page.locator('input[data-field="name"]').fill('Cuatro');
    await page.keyboard.press('Enter');
    await expect(page.locator('.project')).toHaveCount(2);
    await page.locator('.row', { hasText: 'Dos bis' }).dragTo(page.locator('.project-head').nth(1));
    await expect.poll(() => sessionNames(page, 1)).toEqual(['Dos bis', 'Cuatro']);
    await page.locator('.row', { hasText: 'Cuatro' }).click({ button: 'right' });
    await page.locator('.menu button', { hasText: basename(ROOT) }).click();
    await expect.poll(() => sessionNames(page, 0)).toEqual(['Tres', 'Uno bis', 'Cuatro']);

    // Reordenar proyectos.
    await page.locator('.project-head').nth(1).dragTo(page.locator('.project-head').nth(0), { targetPosition: { x: 40, y: 2 } });
    await expect.poll(async () => (await appState(page)).state.projects.map((p) => p.name)).toEqual(['docs', basename(ROOT)]);

    // Colapsar.
    await page.locator('.project-head').nth(1).click();
    await expect(page.locator('.row', { hasText: 'Tres' })).toHaveCount(0);

    // Guardar y reiniciar: todo vuelve, dormido.
    await page.waitForTimeout(500);
    const before = (await appState(page)).state;
    await ctx.close();
    ctx = await launch({ dataDir });
    page = ctx.page;
    const after = await appState(page);
    expect(after.state.projects).toEqual(before.projects);
    for (const p of after.state.projects) for (const x of p.sessions) expect(after.runtime[x.id]?.status).toBe('asleep');
    await page.locator('.project-head').nth(1).click();
    await expect(page.locator('.row', { hasText: 'Tres' })).toBeVisible();

    // No gasta memoria: ninguna terminal existe hasta que se selecciona.
    const count = await page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount());
    expect(count).toBe(0);
  } finally {
    await ctx.close();
    cleanup(dataDir);
  }
});

test('dormir, despertar, cerrar con deshacer, selector, búsqueda, zoom y ajustes', async () => {
  test.setTimeout(120_000);
  const ids = ['s-1', 's-2', 's-3'].map((x) => `aaaaaaaa-0000-4000-8000-00000000000${x.slice(-1)}`);
  const ctx = await launch({
    state: makeState(ids.map((id, i) => ({ id, name: ['Migración de pedidos', 'Pago con tarjeta', 'Tests'][i]! }))),
  });
  try {
    const { page, app } = ctx;
    const [a, b, c] = ids as [string, string, string];

    // Seleccionar despierta.
    await page.locator(`.row[data-session="${a}"]`).click();
    await waitForText(page, a, 'LISTO');
    expect(await status(page, a)).toBe('idle');

    // Selector rápido: Ctrl+Shift+K, sin tildes ni mayúsculas.
    await page.keyboard.press('Control+Shift+K');
    await page.locator('.quick input').fill('pago');
    await page.screenshot({ path: join(SHOTS, 'selector.png') });
    await page.keyboard.press('Enter');
    await waitForText(page, b, 'LISTO');
    expect((await appState(page)).state.ui.activeSessionId).toBe(b);

    // Ctrl+1 salta a la primera.
    await page.keyboard.press('Control+1');
    await expect.poll(async () => (await appState(page)).state.ui.activeSessionId).toBe(a);

    // Ctrl+Tab solo cicla por las despiertas: no despierta a la tercera.
    await page.keyboard.press('Control+Tab');
    await expect.poll(async () => (await appState(page)).state.ui.activeSessionId).toBe(b);
    await page.keyboard.press('Control+Tab');
    await expect.poll(async () => (await appState(page)).state.ui.activeSessionId).toBe(a);
    expect(await status(page, c)).toBe('asleep');

    // Dormir con el atajo mata el proceso.
    const pid = await app.evaluate((_e, id) => (globalThis as any).__hilo.pidOf(id), a);
    await page.keyboard.press('Control+Shift+Z');
    await waitStatus(page, a, 'asleep');
    await expect(page.locator('.overlay.center .primary')).toHaveText('Despertar');
    await page.screenshot({ path: join(SHOTS, 'dormida.png') });
    await settle(500);
    expect(pidAlive(pid)).toBe(false);

    // Despertar con el mismo botón, teclado incluido.
    await page.keyboard.press('Enter');
    await waitForText(page, a, 'LISTO');
    expect(await status(page, a)).toBe('idle');

    // Búsqueda.
    await page.keyboard.press('Control+Shift+F');
    await page.locator('.searchbar input').fill('sangría');
    await expect(page.locator('.searchbar input')).not.toHaveClass(/missing/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.searchbar')).toHaveCount(0);

    // Zoom con teclado.
    const size = async () => (await appState(page)).state.settings.fontSize;
    const base = await size();
    await page.keyboard.press('Control+=');
    await expect.poll(size).toBe(base + 1);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect.poll(size).toBe(base - 1);
    await page.keyboard.press('Control+0');
    await expect.poll(size).toBe(16);

    // Cerrar una sesión y deshacer.
    await page.keyboard.press('Control+2');
    await expect.poll(async () => (await appState(page)).state.ui.activeSessionId).toBe(b);
    await page.keyboard.press('Control+Shift+W');
    await expect(page.locator(`.row[data-session="${b}"]`)).toHaveCount(0);
    await page.locator('.toast .link').click();
    await expect(page.locator(`.row[data-session="${b}"]`)).toBeVisible();
    expect(await status(page, b)).toBe('asleep');

    // Ajustes: abrir, cambiar el historial, y que los atajos no se disparen dentro.
    await page.keyboard.press('Control+,');
    await expect(page.locator('.settings h2')).toHaveText('Ajustes');
    await page.screenshot({ path: join(SHOTS, 'ajustes.png') });
    await page.locator('input[data-field="scrollback"]').fill('5000');
    await page.locator('input[data-field="scrollback"]').blur();
    await expect.poll(async () => (await appState(page)).state.settings.scrollback).toBe(5000);
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings')).toHaveCount(0);

    // Tema claro.
    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.locator('select[data-field="theme"]').selectOption('light');
    await page.keyboard.press('Escape');
    await settle(300);
    await page.screenshot({ path: join(SHOTS, 'tema-claro.png') });
    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.locator('select[data-field="theme"]').selectOption('dark');
    await page.keyboard.press('Escape');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('vista dividida: WebGL solo en lo visible, y paneles independientes', async () => {
  test.setTimeout(120_000);
  const ids = [1, 2, 3, 4, 5].map((n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`);
  const ctx = await launch({ state: makeState(ids.map((id, i) => ({ id, name: `Sesión ${i + 1}` }))) });
  try {
    const { page } = ctx;
    for (const id of ids) await openSink(page, id);
    expect(await page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount())).toBe(1);

    await page.keyboard.press('Control+Shift+2');
    await expect(page.locator('.pane')).toHaveCount(2);
    // Lo que se muestra en los paneles nuevos lo elige el dueño.
    await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), ids[0]);
    await expect.poll(() => page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount())).toBe(2);
    await page.screenshot({ path: join(SHOTS, 'dividida-2.png') });

    await page.keyboard.press('Control+Shift+4');
    await expect(page.locator('.pane')).toHaveCount(4);
    for (const id of ids.slice(1, 3)) await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    await expect.poll(() => page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount())).toBe(4);
    await page.screenshot({ path: join(SHOTS, 'dividida-4.png') });

    // Cada panel tiene su contenido y su tamaño pasa a la terminal.
    const state = (await appState(page)).state;
    const shown = state.ui.panes.filter(Boolean) as string[];
    expect(new Set(shown).size).toBe(4);
    for (const id of shown) expect(await bufferText(page, id)).toContain('LISTO');

    // Mover el foco entre paneles con el teclado.
    const pane = async () => (await appState(page)).state.ui.activePane;
    const first = await pane();
    await page.keyboard.press('Control+Alt+ArrowRight');
    await expect.poll(pane).not.toBe(first);

    await page.keyboard.press('Control+Shift+1');
    await expect(page.locator('.pane')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount())).toBe(1);

    // La de fondo sigue recibiendo: ahora sin Panel, sigue viva.
    const hidden = ids.find((id) => id !== (state.ui.panes[0] as string))!;
    await focusTerm(page, state.ui.activeSessionId!);
    expect(await status(page, hidden)).toBe('idle');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('una terminal que se cierra sale con un aviso, y al reabrirla vuelve a verse', async () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  const ctx = await launch({ state: makeState([{ id, name: 'Se cierra' }]), sinkFlags: ['--quit-on-q'] });
  try {
    const { page } = ctx;
    await openSink(page, id);
    await page.keyboard.press('Q');
    await waitStatus(page, id, 'exited');
    await expect(page.locator('.overlay.banner')).toContainText('La terminal se cerró');
    await page.locator('.overlay.banner .primary').click();
    await waitForText(page, id, 'LISTO');
    await expect(page.locator('.overlay.banner')).toHaveCount(0);
    // La terminal nueva tiene que estar montada en el panel, no fuera de pantalla.
    const parked = await page.evaluate((sid) => (window as any).__hiloTest.terminals.debugEntry(sid).parked, id);
    expect(parked).toBe(false);
    await expect(page.locator('.pane .term-slot .xterm')).toBeVisible();
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('claude no encontrado: error claro, y corregir la ruta lo resuelve', async () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  const state = makeState([{ id, kind: 'claude', name: 'Sin claude' }]);
  state.settings.claudePath = 'C:\\no\\existe\\claude.exe';
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    await waitStatus(page, id, 'error');
    await expect(page.locator('.overlay.center')).toContainText('No se encontró claude');
    await expect(page.locator('.overlay.center .primary')).toHaveText('Abrir Ajustes');
    await expect(page.locator(`.row[data-session="${id}"] svg.st`)).toHaveAttribute('data-status', 'error');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('el zoom también le llega al tamaño del proceso de las terminales ocultas', async () => {
  const [a, b] = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'] as const;
  const ctx = await launch({ state: makeState([{ id: a, name: 'A' }, { id: b, name: 'B' }]) });
  try {
    const { page } = ctx;
    await openSink(page, a);
    await openSink(page, b);
    const cols = (id: string) => page.evaluate((sid) => (window as any).__hiloTest.terminals.debugEntry(sid).term.cols, id);
    const before = await cols(a);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await expect.poll(() => cols(a)).toBeLessThan(before);
    // Al volver a A, el proceso y xterm coinciden: se comprueba abriendo la sesión.
    await page.keyboard.press('Control+1');
    await expect.poll(() => cols(a)).toBeLessThan(before);
    // El proceso recibe el tamaño un momento después (D23).
    const processCols = () =>
      ctx.app.evaluate((_e, id) => {
        const live = ((globalThis as any).__hilo.sessions as any).live.get(id);
        return live.cols;
      }, a);
    await expect.poll(processCols).toBe(await cols(a));
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('F2 funciona con el proyecto colapsado y en modo riel', async () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  const ctx = await launch({ state: makeState([{ id, name: 'Original' }]) });
  try {
    const { page } = ctx;
    await openSink(page, id);
    await page.locator('.project-head').click();
    await expect(page.locator('.row')).toHaveCount(0);
    await page.keyboard.press('F2');
    await page.locator('.tab .rename').fill('Desde la pestaña');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tab-name')).toHaveText('Desde la pestaña');
    await page.keyboard.press('Control+Shift+B');
    await expect(page.locator('.sidebar.is-rail')).toBeVisible();
    await page.keyboard.press('F2');
    await page.locator('.tab .rename').fill('Desde el riel');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tab-name')).toHaveText('Desde el riel');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('capturas en varias resoluciones y ventana chica', async () => {
  test.setTimeout(120_000);
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`);
  const state = makeState(ids.map((id, i) => ({ id, name: ['Pago con tarjeta', 'Migración de pedidos', 'Arreglar carrito', 'Tests de checkout', 'Exportar a PDF', 'Una sesión con un nombre bastante largo para ver cómo se corta', 'Revisar rutas', 'Barra lateral', 'Medir RAM'][i]! })));
  const project = state.projects[0]!;
  project.name = 'tienda-web';
  project.color = '#6f9bd1';
  const second = { ...project, id: 'p2', name: 'api-facturas', color: '#c9956b', sessions: project.sessions.splice(4, 2) };
  const third = { ...project, id: 'p3', name: 'hilo-demo', color: '#c58cc4', sessions: project.sessions.splice(4, 3) };
  state.projects.push(second, third);
  const ctx = await launch({ state });
  try {
    const { page, app } = ctx;
    await openSink(page, ids[0]!);
    // Simula los estados en el renderer para mostrar los íconos juntos.
    await page.evaluate((list) => {
      const t = (window as any).__hiloTest;
      const statuses = ['waiting', 'working', 'done', 'working', 'error', 'asleep', 'asleep', 'done', 'idle'];
      const runtime = { ...t.app.get().runtime };
      list.forEach((id: string, i: number) => {
        runtime[id] = { status: statuses[i] };
      });
      t.app.set({ runtime });
    }, ids);
    for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1440], [800, 500]] as const) {
      await setWindowSize(app, w, h);
      await settle(500);
      await page.screenshot({ path: join(SHOTS, `app-${w}x${h}.png`) });
    }
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('nada de procesos huérfanos al cerrar la app', async () => {
  test.setTimeout(120_000);
  const ids = [1, 2, 3].map((n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`);
  const ctx = await launch({ state: makeState(ids.map((id, i) => ({ id, name: `S${i}` }))) });
  const { page, app } = ctx;
  for (const id of ids) await openSink(page, id);
  const mainPid = await app.evaluate(() => process.pid);
  const tree = processTree(mainPid);
  expect(tree.length).toBeGreaterThan(5);
  await ctx.close();
  await settle(3000);
  const alive = tree.filter((p) => pidAlive(p.pid));
  expect(alive, JSON.stringify(alive)).toEqual([]);
  expect(pidAlive(mainPid)).toBe(false);
  cleanup(ctx.dataDir);
});
