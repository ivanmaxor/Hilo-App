import { expect, test, type Page } from '@playwright/test';
import { cleanup, launch, makeState, status } from './helpers';

const [A, B, C] = ['a', 'b', 'c'].map((l) => `${l.repeat(8)}-4444-4000-8000-00000000000${l}`) as [string, string, string];
const ui = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.ui);
const names = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.projects[0].sessions.map((s: any) => s.name));
const tab = (id: string) => `[data-tab="${id}"]`;

function fresh() {
  const state = makeState([{ id: A, name: 'Uno' }, { id: B, name: 'Dos' }, { id: C, name: 'Tres' }]);
  state.settings.wakeOnSelect = false;
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  return state;
}

test('la X de la pestaña no cierra la sesión: sigue viva y en la barra, y un clic la reabre', async () => {
  const run = await launch({ state: fresh(), width: 1100, height: 700 });
  const { dataDir } = run;
  let second: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    const { page } = run;
    await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), A);
    await expect.poll(() => status(page, A), { timeout: 15_000 }).not.toBe('asleep');
    const pid = await page.evaluate((id) => (window as any).__hiloTest.terminals.has(id), A);
    expect(pid).toBe(true);

    await page.locator(`${tab(A)} .tab-close`).click();
    await page.waitForTimeout(400);
    await expect(page.locator(tab(A))).toHaveCount(0);
    await expect(page.locator(`.row[data-session="${A}"]`)).toHaveCount(1);
    expect(await names(page)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(await status(page, A)).not.toBe('asleep');
    // Entra la vecina, sin despertarla.
    expect((await ui(page)).panes).toEqual([B]);
    expect(await status(page, B)).toBe('asleep');
    await expect(page.locator('.dialog')).toHaveCount(0);

    // Clic central, igual.
    await page.locator(tab(C)).click({ button: 'middle' });
    await page.waitForTimeout(300);
    await expect(page.locator(tab(C))).toHaveCount(0);
    expect(await names(page)).toEqual(['Uno', 'Dos', 'Tres']);

    // Sobrevive a reabrir la app.
    await run.close();
    second = await launch({ dataDir });
    const page2 = second.page;
    await expect(page2.locator(tab(A))).toHaveCount(0);
    await expect(page2.locator(tab(B))).toHaveCount(1);

    // Un clic en la barra la reabre.
    await page2.locator(`.row[data-session="${A}"]`).click();
    await expect(page2.locator(tab(A))).toHaveCount(1);
    expect((await ui(page2)).activeSessionId).toBe(A);
  } finally {
    await second?.close();
    await run.close().catch(() => undefined);
    cleanup(dataDir);
  }
});

test('con la última pestaña cerrada se ve el selector, y sigue siendo ese proyecto', async () => {
  const state = fresh();
  state.projects.unshift({ id: 'otro', name: 'otro', path: state.projects[0]!.path, color: null, collapsed: false, sessions: [] });
  state.projects[1]!.sessions = state.projects[1]!.sessions.slice(0, 1);
  const run = await launch({ state, width: 1100, height: 700 });
  try {
    const { page } = run;
    await page.locator(`${tab(A)} .tab-close`).click();
    await expect(page.locator('.picker-item')).toHaveCount(1);
    await expect(page.locator(tab(A))).toHaveCount(0);
    await expect(page.locator('.tabs')).toHaveAttribute('aria-label', 'Sesiones de proyecto');
    await page.locator('.picker-item').click();
    await expect(page.locator(tab(A))).toHaveCount(1);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('cerrar desde el menú pregunta, y cancelar no cierra nada', async () => {
  const run = await launch({ state: fresh(), width: 1100, height: 700 });
  try {
    const { page } = run;
    await page.locator(`.row[data-session="${B}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Cerrar esta sesión/ }).click();
    await expect(page.locator('.dialog h2')).toHaveText('¿Cerrar «Dos»?');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(await names(page)).toEqual(['Uno', 'Dos', 'Tres']);

    await page.locator(`.row[data-session="${B}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Cerrar esta sesión/ }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect.poll(() => names(page)).toEqual(['Uno', 'Tres']);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
