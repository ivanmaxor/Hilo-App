import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, launch, makeState, ROOT, status } from './helpers';

const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'].map((l) => `${l.repeat(8)}-1111-4000-8000-00000000000${l}`) as [string, string, string, string, string];
const SHOTS = join(ROOT, 'test-results', 'split');
mkdirSync(SHOTS, { recursive: true });
const ui = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.ui);

function fresh() {
  const state = makeState([
    { id: A, name: 'Uno' },
    { id: B, name: 'Dos' },
    { id: C, name: 'Tres' },
    { id: D, name: 'Cuatro' },
    { id: E, name: 'Cinco' },
  ]);
  state.settings.wakeOnSelect = false;
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  return state;
}

/**
 * Suelta a mano para poder ver la marca antes de soltar.
 * Con la máquina cargada Chromium a veces no arranca el arrastre (nunca dispara `dragstart`) y el resto de la prueba
 * espera una marca que no va a llegar: se comprueba que arrancó y, si no, se suelta y se repite el gesto.
 */
async function dragOver(page: Page, fromSelector: string, pane: number, fx: number, fy: number): Promise<() => Promise<void>> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.evaluate(() => {
      (window as any).__dragStarted = false;
      window.addEventListener('dragstart', () => ((window as any).__dragStarted = true), { once: true, capture: true });
    });
    const from = await page.locator(fromSelector).boundingBox();
    const to = await page.locator(`[data-pane="${pane}"]`).boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(from!.x + 40, from!.y + from!.height / 2 + 4, { steps: 3 });
    const started = await page.waitForFunction(() => (window as any).__dragStarted === true, undefined, { timeout: 1500 }).then(
      () => true,
      () => false,
    );
    if (started) {
      await page.mouse.move(to!.x + to!.width * fx, to!.y + to!.height * fy, { steps: 6 });
      await page.waitForTimeout(100);
      if (attempt > 1) console.log(`[dragOver] el arrastre arrancó al intento ${attempt}`);
      return async () => {
        await page.mouse.up();
        await page.waitForTimeout(250);
      };
    }
    // No arrancó: se suelta FUERA de la fila (soltar sobre ella contaría como un clic y seleccionaría la sesión, y el estado
    // ya no sería el de la prueba) y se vuelve a empezar.
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  throw new Error('dragOver: el arrastre no arrancó en 5 intentos');
}
const row = (id: string) => `.row[data-session="${id}"]`;

test('dividir: el otro lado pide elegir, y solo se abre lo elegido', async () => {
  const run = await launch({ state: fresh(), width: 1200, height: 760 });
  try {
    const { page } = run;
    await page.getByRole('button', { name: 'Ver 2 terminales', exact: true }).click();
    expect((await ui(page)).panes).toEqual([A, null]);
    await expect(page.locator('[data-pane="1"] .picker-item')).toHaveCount(4);
    await page.screenshot({ path: join(SHOTS, '1-elegir.png') });
    for (const id of [A, B, C, D, E]) expect(await status(page, id)).toBe('asleep');
    await page.locator(`[data-pane="1"] [data-pick="${C}"]`).click();
    await expect.poll(async () => (await ui(page)).panes).toEqual([A, C]);
    expect(await status(page, B)).toBe('asleep');

    await page.getByRole('button', { name: 'Ver 4 terminales', exact: true }).click();
    await expect(page.locator('.picker')).toHaveCount(2);
    await page.locator('[data-pane="3"] .secondary', { hasText: 'Quitar este panel' }).click();
    expect((await ui(page)).panes.length).toBe(3);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('arrastrar: centro reemplaza, borde suma, y a 4 solo reemplaza', async () => {
  const run = await launch({ state: fresh(), width: 1200, height: 760 });
  try {
    const { page } = run;
    // Borde derecho con una sola terminal: círculo con más.
    let drop = await dragOver(page, row(B), 0, 0.97, 0.5);
    await expect(page.locator('.drop-mark.edge.right .drop-plus')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '2-borde-mas.png') });
    await drop();
    expect((await ui(page)).panes).toEqual([A, B]);

    // Centro: reemplaza.
    drop = await dragOver(page, row(C), 1, 0.5, 0.5);
    await expect(page.locator('.drop-mark.center .drop-label')).toHaveText('Reemplazar «Dos»');
    await page.screenshot({ path: join(SHOTS, '3-reemplazar.png') });
    await drop();
    expect((await ui(page)).panes).toEqual([A, C]);
    expect(await status(page, B)).toBe('asleep');

    // Abajo del primero, y después en el borde entre paneles.
    drop = await dragOver(page, row(D), 0, 0.5, 0.97);
    await expect(page.locator('.drop-mark.edge.bottom')).toBeVisible();
    await drop();
    drop = await dragOver(page, row(E), 1, 0.03, 0.5);
    await expect(page.locator('.drop-mark.edge.left .drop-plus')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '4-entre-paneles.png') });
    await drop();
    expect((await ui(page)).panes.length).toBe(4);
    await page.screenshot({ path: join(SHOTS, '5-cuatro.png') });

    // Con 4, el borde ya no ofrece sumar.
    drop = await dragOver(page, row(B), 0, 0.97, 0.5);
    await expect(page.locator('.drop-mark.edge')).toHaveCount(0);
    await expect(page.locator('.drop-mark.center .drop-label')).toContainText('Ya hay 4 paneles');
    await page.screenshot({ path: join(SHOTS, '6-limite.png') });
    await drop();
    const after = await ui(page);
    expect(after.panes.length).toBe(4);
    expect(after.panes).toContain(B);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('arrastrar desde un panel a otro intercambia; a un borde lo mueve', async () => {
  const state = fresh();
  state.ui = { ...state.ui, panes: [A, B], layout: 2, activePane: 0 };
  const run = await launch({ state, width: 1200, height: 760 });
  try {
    const { page } = run;
    let drop = await dragOver(page, '[data-pane="0"] .pane-head', 1, 0.5, 0.5);
    await expect(page.locator('.drop-mark.center .drop-label')).toHaveText('Intercambiar con «Dos»');
    await drop();
    expect((await ui(page)).panes).toEqual([B, A]);

    drop = await dragOver(page, '[data-pane="0"] .pane-head', 1, 0.5, 0.97);
    await drop();
    const after = await ui(page);
    expect(after.panes.length).toBe(2);
    expect(after.tree.dir).toBe('col');
    expect(after.activeSessionId).toBe(B);

    // Soltar sobre sí misma no marca nada.
    drop = await dragOver(page, '[data-pane="0"] .pane-head', 0, 0.5, 0.5);
    await expect(page.locator('.drop-mark')).toHaveCount(0);
    await drop();
    await expect(page.locator('.drop-mark')).toHaveCount(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('la división y el reparto sobreviven a cerrar y abrir', async () => {
  const run = await launch({ state: fresh(), width: 1200, height: 760 });
  const { dataDir } = run;
  let second: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    const drop = await dragOver(run.page, row(B), 0, 0.5, 0.97);
    await drop();
    const tree = (await ui(run.page)).tree;
    await run.close();
    second = await launch({ dataDir });
    const after = await ui(second.page);
    expect(after.panes).toEqual([A, B]);
    expect(after.tree).toEqual(tree);
  } finally {
    await second?.close();
    cleanup(dataDir);
  }
});

test('terminales vivas: quitar una no la mata, y moverse entre paneles no le manda flechas', async () => {
  const state = fresh();
  state.ui = { ...state.ui, panes: [A, B], layout: 2, activePane: 0 };
  const run = await launch({ state, width: 1200, height: 760 });
  try {
    const { page } = run;
    await page.evaluate(async ([a, b]) => {
      await (window as any).__hiloTest.wakeSession(a);
      await (window as any).__hiloTest.wakeSession(b);
    }, [A, B]);
    await expect.poll(async () => (await status(page, B)) !== 'asleep', { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(1500);
    await page.evaluate((id) => (window as any).__hiloTest.terminals.focus(id), A);
    const size = () => {
      try {
        return readFileSync(run.sinkFile, 'latin1');
      } catch {
        return '';
      }
    };
    const before = size();
    await page.keyboard.press('Control+Alt+ArrowLeft');
    await page.waitForTimeout(200);
    expect((await ui(page)).activePane).toBe(1);
    await page.keyboard.press('Control+Alt+ArrowLeft');
    await page.waitForTimeout(400);
    expect((await ui(page)).activePane).toBe(0);
    expect(size()).toBe(before);

    await page.locator('[data-pane="1"] .pane-close').click();
    await page.waitForTimeout(400);
    expect((await ui(page)).panes).toEqual([A]);
    expect(await status(page, B)).not.toBe('asleep');
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
