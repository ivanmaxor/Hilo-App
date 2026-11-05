import { expect, test } from '@playwright/test';
import { cleanup, launch, makeState } from './helpers';

const settings = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.settings);

test('sin Claude ni Git, la guía sale una vez, y copia el comando', async () => {
  const state = makeState([]);
  state.settings.setupSeen = false;
  const env = { HILO_TEST_TOOLS: JSON.stringify({ claude: null, git: null }) };
  const run = await launch({ state, env, width: 1100, height: 700 });
  const { dataDir } = run;
  let second: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    const { page } = run;
    await expect(page.locator('#setup-title')).toHaveText('Lo que Hilo necesita en este PC');
    await expect(page.locator('[data-tool="claude"] h3')).toContainText('falta instalarlo');
    await expect(page.locator('[data-tool="git"] h3')).toContainText('falta instalarlo');

    await page.locator('[data-tool="claude"] .setup-command button').click();
    await expect(page.locator('[data-tool="claude"] .setup-command button')).toHaveText('Copiado');
    await page.getByRole('button', { name: 'Comprobar de nuevo' }).click();
    await expect(page.locator('.setup-note')).toContainText('Sigue faltando algo');

    await page.screenshot({ path: 'test-results/requisitos-falta-todo.png' });
    await page.getByRole('button', { name: 'Seguir sin esto por ahora' }).click();
    await expect(page.locator('#setup-title')).toHaveCount(0);
    await expect.poll(async () => (await settings(page)).setupSeen).toBe(true);

    await run.close();
    second = await launch({ dataDir, env });
    await second.page.waitForTimeout(600);
    await expect(second.page.locator('#setup-title')).toHaveCount(0);
  } finally {
    await second?.close();
    await run.close().catch(() => undefined);
    cleanup(dataDir);
  }
});

test('con todo instalado no sale sola, y Ajustes la abre', async () => {
  const state = makeState([]);
  state.settings.setupSeen = false;
  const env = { HILO_TEST_TOOLS: JSON.stringify({ claude: 'C:\\x\\claude.exe', git: 'C:\\x\\git.exe' }) };
  const run = await launch({ state, env, width: 1100, height: 700 });
  try {
    const { page } = run;
    await page.waitForTimeout(600);
    await expect(page.locator('#setup-title')).toHaveCount(0);
    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.getByRole('button', { name: 'Ver requisitos' }).click();
    await expect(page.locator('#setup-title')).toHaveText('Todo listo para usar Hilo');
    await expect(page.locator('.setup-command')).toHaveCount(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('falta solo Git: no muestra los pasos de Claude', async () => {
  const state = makeState([]);
  state.settings.setupSeen = false;
  const env = { HILO_TEST_TOOLS: JSON.stringify({ claude: 'C:\\x\\claude.exe', git: null }) };
  const run = await launch({ state, env, width: 1100, height: 700 });
  try {
    const { page } = run;
    await expect(page.locator('[data-tool="claude"] h3')).toContainText('instalado');
    await expect(page.locator('[data-tool="claude"] .setup-command')).toHaveCount(0);
    await expect(page.locator('[data-tool="git"] .setup-command code')).toHaveText('winget install Git.Git');
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
