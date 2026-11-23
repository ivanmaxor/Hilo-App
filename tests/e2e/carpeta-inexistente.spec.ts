import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { cleanup, launch, makeState, newDataDir, ROOT, status, waitStatus } from './helpers';

/** #6: la carpeta de una sesión ya no existe. El panel deja elegir otra y no pierde la conversación. */
const cwdOf = (page: any, id: string) =>
  page.evaluate((sid: string) => (window as any).__hiloTest.app.get().state.projects[0].sessions.find((s: any) => s.id === sid).cwd, id);

test('con la carpeta inexistente el panel ofrece elegir otra y abrirla en la del proyecto', async () => {
  const id = crypto.randomUUID();
  const gone = join(newDataDir(), 'ya-no-existe');
  const state = makeState([{ id, name: 'Movida' }]);
  state.projects[0]!.sessions[0]!.cwd = gone;
  state.projects[0]!.path = ROOT;
  const dataDir = newDataDir();
  const run = await launch({ dataDir, state });
  try {
    const page = run.page;
    await page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
    await waitStatus(page, id, 'error');

    const panel = page.locator(`[data-missing-cwd="${id}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('La carpeta de esta sesión ya no existe');
    await expect(panel).toContainText(gone);
    await expect(panel.getByRole('button', { name: 'Elegir dónde está ahora' })).toBeVisible();
    // No es el panel de "no se encontró claude": no ofrece Ajustes.
    await expect(panel.getByRole('button', { name: 'Abrir Ajustes' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Abrirla en la carpeta del proyecto' }).click();
    await expect.poll(() => cwdOf(page, id)).toBe(ROOT);
    await expect.poll(() => status(page, id), { timeout: 30_000 }).not.toBe('error');
    await expect(page.locator(`[data-missing-cwd="${id}"]`)).toHaveCount(0);
    // La conversación sigue siendo la misma: no se cambió el id.
    const claudeId = await page.evaluate((sid) => (window as any).__hiloTest.app.get().state.projects[0].sessions.find((s: any) => s.id === sid).claudeId, id);
    expect(claudeId).toBe(id);
  } finally {
    await run.close();
    cleanup(dataDir);
  }
});

test('si la carpeta del proyecto tampoco existe, avisa y no cambia nada', async () => {
  const id = crypto.randomUUID();
  const scratch = newDataDir();
  const gone = join(scratch, 'sesion-perdida');
  const state = makeState([{ id, name: 'Movida' }], gone);
  const dataDir = newDataDir();
  const run = await launch({ dataDir, state });
  try {
    const page = run.page;
    await page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
    await waitStatus(page, id, 'error');
    const panel = page.locator(`[data-missing-cwd="${id}"]`);
    await panel.getByRole('button', { name: 'Abrirla en la carpeta del proyecto' }).click();
    await expect(page.getByText('La carpeta del proyecto tampoco existe.')).toBeVisible();
    expect(await cwdOf(page, id)).toBe(gone);
    expect(await status(page, id)).toBe('error');
    await expect(panel).toBeVisible();
  } finally {
    await run.close();
    cleanup(dataDir);
    cleanup(scratch);
  }
});
