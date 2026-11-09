import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, launch, makeState, ROOT, status } from './helpers';

const A = 'aaaaaaaa-2222-4000-8000-00000000000a';
const B = 'bbbbbbbb-2222-4000-8000-00000000000b';
const SHOTS = join(ROOT, 'test-results', 'ajustes');
mkdirSync(SHOTS, { recursive: true });
const ui = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.ui);
const settings = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.settings);

function oneTerminal() {
  const state = makeState([{ id: A, name: 'Uno' }, { id: B, name: 'Dos' }]);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  return state;
}

async function awakeWithHistory(page: Page, lines = 400): Promise<void> {
  await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), A);
  await expect.poll(() => status(page, A), { timeout: 15_000 }).not.toBe('asleep');
  await page.waitForTimeout(800);
  await page.evaluate(
    ([id, n]) =>
      new Promise<void>((resolve) => {
        const text = Array.from({ length: n as number }, (_, i) => `linea ${i}`).join('\r\n') + '\r\n';
        (window as any).__hiloTest.terminals.debugEntry(id).term.write(text, () => resolve());
      }),
    [A, lines],
  );
  await page.waitForTimeout(200);
}

const viewportY = (page: Page) => page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.buffer.active.viewportY, A);
const barOpacity = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.term-slot .xterm-scrollable-element > .scrollbar.vertical');
    return bar ? getComputedStyle(bar).opacity : 'sin barra';
  });

test('la barra se ve sin tocar nada, y se puede apagar', async () => {
  const run = await launch({ state: oneTerminal(), width: 1100, height: 700 });
  try {
    const { page } = run;
    await awakeWithHistory(page);
    await page.waitForTimeout(1500);
    expect(Number(await barOpacity(page))).toBe(1);
    const slider = await page.locator('.term-slot .scrollbar.vertical .slider').boundingBox();
    expect(slider!.width).toBeGreaterThan(4);
    await page.screenshot({ path: join(SHOTS, 'barra.png') });

    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.locator('[data-field="scrollbar-always"]').uncheck();
    await page.keyboard.press('Escape');
    // Con el ratón encima, xterm la sigue mostrando.
    await page.mouse.move(40, 400);
    await page.waitForTimeout(1500);
    expect(Number(await barOpacity(page))).toBe(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

/** Lo que manda un touchpad: decenas de eventos chicos por gesto. */
async function touchpadGesture(page: Page, events = 60): Promise<void> {
  const box = await page.locator('.term-slot').first().boundingBox();
  await page.mouse.move(box!.x + 200, box!.y + 200);
  await page.evaluate(
    ([n, x, y]) => {
      const target = document.elementFromPoint(x as number, y as number)!;
      for (let i = 0; i < (n as number); i++) {
        const ev = new WheelEvent('wheel', { deltaY: -37, deltaMode: 0, clientX: x as number, clientY: y as number, bubbles: true, cancelable: true });
        // El navegador calcula wheelDeltaY solo para eventos reales.
        Object.defineProperty(ev, 'wheelDeltaY', { value: 44 });
        target.dispatchEvent(ev);
      }
    },
    [events, box!.x + 200, box!.y + 200],
  );
  await page.waitForTimeout(250);
}

test('el touchpad se calma según el ajuste, y la rueda no cambia', async () => {
  const run = await launch({ state: oneTerminal(), width: 1100, height: 700 });
  try {
    const { page } = run;
    await awakeWithHistory(page, 2000);
    const bottom = await viewportY(page);
    await touchpadGesture(page);
    const at35 = bottom - (await viewportY(page));

    await page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.scrollToBottom(), A);
    await page.waitForTimeout(150);
    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.locator('[data-field="touchpad-speed"]').fill('100');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    expect((await settings(page)).touchpadSpeed).toBe(100);
    await touchpadGesture(page);
    const at100 = (await page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.buffer.active.baseY, A)) - (await viewportY(page));
    console.log(`touchpad: 60 eventos, al 35 % ${at35} líneas, al 100 % ${at100} líneas`);
    expect(at100).toBeGreaterThan(at35 * 2);
    expect(at35).toBeGreaterThan(0);

    // Rueda real: un paso entero se atiende aunque el touchpad esté al mínimo.
    await page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.scrollToBottom(), A);
    await page.waitForTimeout(150);
    const before = await viewportY(page);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => viewportY(page)).toBeLessThan(before);
    console.log(`rueda: ${before - (await viewportY(page))} líneas por paso`);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('ajustes: secciones, tamaño de letra y de ventana; arrastrar el divisor cambia el tamaño', async () => {
  const state = oneTerminal();
  state.ui = { ...state.ui, panes: [A, B], layout: 2 };
  state.settings.wakeOnSelect = false;
  const run = await launch({ state, width: 1200, height: 760 });
  const { dataDir } = run;
  let second: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    const { page } = run;
    await awakeWithHistory(page, 60);
    const widthBefore = (await page.locator('[data-pane="0"]').boundingBox())!.width;

    // Divisor.
    const divider = (await page.locator('.pane-divider.along-x').boundingBox())!;
    await page.mouse.move(divider.x + 3, divider.y + 200);
    await page.mouse.down();
    await page.mouse.move(divider.x + 203, divider.y + 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const widthAfter = (await page.locator('[data-pane="0"]').boundingBox())!.width;
    expect(widthAfter).toBeGreaterThan(widthBefore + 150);
    const saved = (await ui(page)).tree;
    expect(saved.sizes).toBeTruthy();
    await page.screenshot({ path: join(SHOTS, 'divisor.png') });

    // Ajustes.
    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.screenshot({ path: join(SHOTS, 'ajustes-1.png') });
    await expect(page.locator('.settings-nav button')).toHaveText(['Apariencia', 'Terminal', 'Sesiones', 'Claude Code', 'Actualizaciones', 'Novedades', 'Cambios', 'Atajos']);
    await page.getByRole('button', { name: 'Letra más grande' }).click();
    await page.getByRole('button', { name: 'Letra más grande' }).click();
    expect((await settings(page)).fontSize).toBe(18);
    await expect.poll(() => page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.options.fontSize, A)).toBe(18);
    await page.locator('.settings-nav button', { hasText: 'Claude Code' }).click();
    await expect(page.locator('[data-field="skip-permissions"]')).toBeInViewport();
    await expect(page.locator('[data-field="skip-permissions"]')).not.toBeChecked;
    await page.screenshot({ path: join(SHOTS, 'ajustes-2.png') });

    // Zoom: la terminal sigue seleccionando donde se hace clic.
    await page.locator('.settings-nav button', { hasText: 'Apariencia' }).click();
    await page.locator('[data-field="app-zoom"]').selectOption('125');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const zoom = await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor());
    expect(zoom).toBeCloseTo(1.25);
    await page.screenshot({ path: join(SHOTS, 'zoom-125.png') });
    await page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.clearSelection(), A);
    const term = await page.evaluate((id) => {
      const e = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const s = e.element.querySelector('.xterm-screen').getBoundingClientRect();
      return { x: s.x, y: s.y, w: s.width / e.cols, h: s.height / e.rows, rows: e.rows, base: e.buffer.active.viewportY, line: e.buffer.active.getLine(e.buffer.active.viewportY + 2).translateToString(true) };
    }, A);
    await page.mouse.dblclick(term.x + term.w * 2, term.y + term.h * 2.5);
    const selected = await page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.getSelection(), A);
    console.log('doble clic con 125 %:', JSON.stringify(selected), 'línea:', JSON.stringify(term.line));
    expect(term.line.trim().split(/\s+/)).toContain(selected.trim());

    await run.close();
    second = await launch({ dataDir });
    const after = await ui(second.page);
    expect(after.tree).toEqual(saved);
    expect(await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBeCloseTo(1.25);
  } finally {
    await second?.close();
    await run.close().catch(() => undefined);
    cleanup(dataDir);
  }
});

test('una persona nueva no arranca Claude con el flag peligroso', async () => {
  const run = await launch({ width: 1000, height: 640 });
  try {
    const s = await settings(run.page);
    expect(s.skipPermissions).toBe(false);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
