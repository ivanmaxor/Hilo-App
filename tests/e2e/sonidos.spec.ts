import { expect, test } from '@playwright/test';
import { cleanup, launch, makeState, settle } from './helpers';

const played = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__hiloTest.playedSounds.map((p: any) => p.sound));

test('suena según el estado y los ajustes, y Ajustes deja elegir y probar', async () => {
  const state = makeState([{ id: 'a', name: 'Uno' }]);
  state.settings.soundDone = 'campana';
  state.settings.soundWaiting = 'none';
  const ctx = await launch({ state });
  try {
    const { page, app } = ctx;
    const alert = (status: string, unseen: boolean) =>
      app.evaluate(({ BrowserWindow }, args) => BrowserWindow.getAllWindows()[0]!.webContents.send('session:alert', 'a', args.status, args.unseen), { status, unseen });
    await alert('done', true);
    await alert('waiting', true);
    // A la vista y sin "sonar también si la estoy mirando": silencio.
    await alert('done', false);
    await alert('error', true);
    await settle(300);
    expect(await played(page)).toEqual(['campana', 'grave']);

    await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
    await page.locator('.settings-nav button', { hasText: 'Sesiones' }).click();
    await expect(page.locator('select[data-field="soundDone"]')).toHaveValue('campana');
    await expect(page.locator('[data-action="preview-soundWaiting"]')).toBeDisabled();
    await page.locator('select[data-field="soundWaiting"]').selectOption('cristal');
    await expect(page.locator('[data-action="preview-soundWaiting"]')).toBeEnabled();
    await page.locator('select[data-field="sound-repeat"]').selectOption('5');
    const s = await page.evaluate(() => (window as any).__hiloTest.app.get().state.settings);
    expect(s).toMatchObject({ soundWaiting: 'cristal', soundRepeat: 5 });
    await page.locator('.settings-section[data-section="sessions"]').screenshot({ path: 'test-results/sonidos-ajustes.png' });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
