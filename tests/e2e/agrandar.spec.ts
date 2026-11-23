import { expect, test, type Page } from '@playwright/test';
import { cleanup, launch, makeState, settle, waitForText, bufferText, focusTerm } from './helpers';

const [A, B, C] = ['a', 'b', 'c'].map((l) => `${l.repeat(8)}-1111-4000-8000-00000000000${l}`) as [string, string, string];
const ui = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.ui);
const gl = (page: Page) => page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount());
const sizeOf = (page: Page, id: string) =>
  page.evaluate((sid) => {
    const { term } = (window as any).__hiloTest.terminals.debugEntry(sid);
    return `${term.cols}x${term.rows}`;
  }, id);
const debug = (page: Page, id: string) =>
  page.evaluate((sid) => {
    const t = (window as any).__hiloTest.terminals;
    const e = t.debugEntry(sid);
    return { parked: e.parked, hasGl: e.hasGl, generation: t.generationOf(sid), focus: t.hasFocus(sid) };
  }, id);

function fresh() {
  const state = makeState([
    { id: A, name: 'Uno' },
    { id: B, name: 'Dos' },
    { id: C, name: 'Tres' },
  ]);
  state.settings.wakeOnSelect = false;
  state.ui = { ...state.ui, activeSessionId: A, panes: [A, B, C], layout: 3, activePane: 0 };
  return state;
}

async function wakeAll(page: Page) {
  await page.evaluate(async (ids) => {
    for (const id of ids) await (window as any).__hiloTest.wakeSession(id);
  }, [A, B, C]);
  for (const id of [A, B, C]) await waitForText(page, id, 'LISTO');
  await settle(1500);
}

/** Cada aviso de tamaño que le llega a un proceso, con su sesión. */
async function recordResizes(app: import('@playwright/test').ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const seen: string[] = [];
    (globalThis as any).__resizes = seen;
    ipcMain.on('pty:resize', (_event, id, cols, rows) => seen.push(`${id}:${cols}x${rows}`));
  });
  return () => app.evaluate(() => [...((globalThis as any).__resizes as string[])]);
}

test('agrandar y devolver: mismo árbol, foco y contenido; ninguna terminal se recrea; el proceso recibe solo el tamaño final', async () => {
  const run = await launch({ state: fresh(), width: 1200, height: 760 });
  try {
    const { page, app } = run;
    await wakeAll(page);
    await focusTerm(page, A);

    const uiBefore = await ui(page);
    const textBefore = [await bufferText(page, A), await bufferText(page, B), await bufferText(page, C)];
    const sizesBefore = [await sizeOf(page, A), await sizeOf(page, B), await sizeOf(page, C)];
    const debugBefore = [await debug(page, A), await debug(page, B), await debug(page, C)];
    expect(debugBefore.map((d) => d.hasGl)).toEqual([true, true, true]);
    expect(await gl(page)).toBe(3);
    expect(debugBefore[0]!.focus).toBe(true);
    const resizes = await recordResizes(app);

    // Agrandar el panel activo.
    await page.locator('[data-pane="0"] [data-action="zoom-pane"]').click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(1);
    await expect(page.locator('[data-pane="1"]')).toBeHidden();
    await expect(page.locator('[data-pane="2"]')).toBeHidden();
    await expect(page.locator('[data-pane="0"] [data-zoom-note]')).toHaveText('2 paneles ocultos');
    await expect(page.locator('.pane-divider')).toHaveCount(0);
    const full = (await page.locator('.panes').boundingBox())!;
    const big = (await page.locator('[data-pane="0"]').boundingBox())!;
    expect(Math.abs(big.width - full.width)).toBeLessThan(2);
    expect(Math.abs(big.height - full.height)).toBeLessThan(2);
    // Las ocultas siguen vivas pero estacionadas y sin WebGL; el árbol no se tocó.
    expect(await ui(page)).toEqual(uiBefore);
    for (const id of [B, C]) {
      const d = await debug(page, id);
      expect(d.parked).toBe(true);
      expect(d.hasGl).toBe(false);
    }
    expect(await gl(page)).toBe(1);
    expect((await debug(page, A)).focus).toBe(true);
    // Con la ventana oculta de las pruebas, Chromium atrasa los temporizadores hasta un segundo.
    await settle(2500);
    const bigSize = await sizeOf(page, A);
    expect(bigSize).not.toBe(sizesBefore[0]);
    expect(await resizes()).toEqual([`${A}:${bigSize}`]);

    // Devolver.
    await page.locator('[data-pane="0"] [data-action="zoom-pane"]').click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(0);
    await expect(page.locator('[data-pane="1"]')).toBeVisible();
    await expect(page.locator('[data-pane="2"]')).toBeVisible();
    await expect(page.locator('[data-zoom-note]')).toHaveCount(0);
    await settle(2500);

    expect(await ui(page)).toEqual(uiBefore);
    expect([await sizeOf(page, A), await sizeOf(page, B), await sizeOf(page, C)]).toEqual(sizesBefore);
    expect([await bufferText(page, A), await bufferText(page, B), await bufferText(page, C)]).toEqual(textBefore);
    const debugAfter = [await debug(page, A), await debug(page, B), await debug(page, C)];
    // Misma instancia de terminal: nada se recreó. WebGL vuelve a estar solo en lo visible.
    expect(debugAfter.map((d) => d.generation)).toEqual(debugBefore.map((d) => d.generation));
    expect(debugAfter.map((d) => d.hasGl)).toEqual([true, true, true]);
    expect(debugAfter.map((d) => d.parked)).toEqual([false, false, false]);
    expect(debugAfter[0]!.focus).toBe(true);
    // Solo A avisó al proceso, una vez al agrandar y otra al volver. B y C nunca cambiaron de tamaño.
    expect(await resizes()).toEqual([`${A}:${bigSize}`, `${A}:${sizesBefore[0]}`]);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('agrandar uno que no es el activo lo activa; cerrarlo o cambiar el reparto lo devuelve a su lugar', async () => {
  const run = await launch({ state: fresh(), width: 1200, height: 760 });
  try {
    const { page } = run;
    await wakeAll(page);
    await focusTerm(page, A);

    await page.locator('[data-pane="1"] [data-action="zoom-pane"]').click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(1);
    await expect(page.locator('[data-pane="0"]')).toBeHidden();
    await expect(page.locator('[data-pane="1"]')).toBeVisible();
    expect((await ui(page)).activePane).toBe(1);
    expect((await ui(page)).panes).toEqual([A, B, C]);
    const genB = (await debug(page, B)).generation;

    // Cerrar la sesión agrandada la devuelve a su lugar; las demás siguen vivas.
    await page.locator('[data-pane="1"] .pane-close').click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(0);
    expect((await ui(page)).panes).toEqual([A, C]);
    await expect(page.locator('[data-pane]:visible')).toHaveCount(2);
    await expect(page.locator('[data-zoom-note]')).toHaveCount(0);
    expect((await debug(page, A)).parked).toBe(false);
    expect((await debug(page, C)).parked).toBe(false);
    expect(await gl(page)).toBe(2);
    // B no se destruyó: solo dejó de verse.
    expect((await debug(page, B)).generation).toBe(genB);

    // Cambiar el reparto con un panel agrandado también lo devuelve.
    await page.locator('[data-pane="0"] [data-action="zoom-pane"]').click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ver 3 terminales', exact: true }).click();
    await expect(page.locator('.panes.zoomed')).toHaveCount(0);
    await expect(page.locator('[data-pane]:visible')).toHaveCount(3);
    expect((await ui(page)).panes.length).toBe(3);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('con un solo panel no hay botón de agrandar', async () => {
  const state = fresh();
  state.ui = { ...state.ui, panes: [A], layout: 1, activePane: 0 };
  const run = await launch({ state, width: 1200, height: 760 });
  try {
    await expect(run.page.locator('[data-action="zoom-pane"]')).toHaveCount(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
