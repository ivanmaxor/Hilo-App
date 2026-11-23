import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDateStamp } from '../../src/shared/dailySummary';
import { cleanup, getClipboard, launch, makeState, settle } from './helpers';

test('resumen del día: se ve, se copia y se guarda sin pisar nada', async () => {
  const state = makeState([
    { id: 'a', name: 'Login', kind: 'claude' as const },
    { id: 'b', name: 'Pagos' },
    { id: 'c', name: 'De ayer' },
  ]);
  const now = Date.now();
  const [a, b, c] = state.projects[0]!.sessions;
  a!.lastActiveAt = now - 1000;
  a!.mark = '🔥';
  a!.note = '# Falta probar\n- con Google\n**ya**';
  b!.lastActiveAt = now - 2000;
  // Hace dos días: nunca es "hoy".
  c!.lastActiveAt = now - 2 * 24 * 3600 * 1000;
  const out = mkdtempSync(join(tmpdir(), 'hilo-resumen-e2e-'));
  const ctx = await launch({ state });
  try {
    const { page, app } = ctx;
    const stamp = localDateStamp(new Date());
    const file = (n = '') => join(out, `${stamp}-resumen-hilo${n}.md`);
    const pickFolder = (canceled: boolean) =>
      app.evaluate(({ dialog }, [dir, cancel]) => {
        (dialog as any).showOpenDialog = async () => ({ canceled: cancel, filePaths: cancel ? [] : [dir] });
      }, [out, canceled] as const);

    // Desde el selector rápido, escribiendo.
    await page.keyboard.press('Control+Shift+K');
    await page.locator('.quick input').fill('resumen');
    await expect(page.locator('.quick-item.command')).toBeVisible();
    await expect(page.locator('.quick-item:not(.command)')).toHaveCount(0);
    await page.locator('.quick-item.command').click();

    const preview = page.locator('[data-field="summary-preview"]');
    await expect(preview).toBeVisible();
    const text = (await preview.textContent()) ?? '';
    expect(text).toContain('# Resumen del día');
    expect(text).toContain('## proyecto');
    expect(text).toContain('- 🔥 **Login** — Dormida');
    expect(text).toContain('  > **Nota:** \\# Falta probar');
    expect(text).toContain('  > \\- con Google');
    expect(text).toContain('  > \\*\\*ya\\*\\*');
    expect(text).toContain('**Pagos**');
    expect(text).not.toContain('De ayer');
    await page.screenshot({ path: 'test-results/resumen-del-dia.png' });

    await page.locator('[data-action="summary-copy"]').click();
    await expect(page.locator('[data-field="summary-message"]')).toHaveText('Copiado al portapapeles.');
    expect(await getClipboard(app)).toBe(text);

    // Ya hay un archivo de hoy: el nuevo lleva número y el anterior queda intacto.
    writeFileSync(file(), 'mío');
    await pickFolder(false);
    await page.locator('[data-action="summary-save"]').click();
    await expect(page.locator('[data-field="summary-message"]')).toContainText('Guardado en');
    expect(readFileSync(file('-2'), 'utf8')).toBe(text);
    expect(readFileSync(file(), 'utf8')).toBe('mío');

    await page.locator('[data-action="summary-save"]').click();
    await expect.poll(() => readdirSync(out).includes(`${stamp}-resumen-hilo-3.md`)).toBe(true);
    expect(readFileSync(file('-3'), 'utf8')).toBe(text);

    // Si cancela el diálogo de carpeta, no se escribe nada ni se avisa de un error.
    await pickFolder(true);
    await page.locator('[data-action="summary-save"]').click();
    await settle(400);
    expect(readdirSync(out)).toHaveLength(3);
    await expect(page.locator('[data-field="summary-message"]')).toHaveText('');
    expect(readdirSync(out).some((n) => n.endsWith('.tmp'))).toBe(false);

    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
    rmSync(out, { recursive: true, force: true });
  }
});

test('resumen del día: sin actividad hoy lo dice, y se abre también por el comando', async () => {
  const state = makeState([{ id: 'a', name: 'Vieja' }]);
  state.projects[0]!.sessions[0]!.lastActiveAt = Date.now() - 3 * 24 * 3600 * 1000;
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    await page.evaluate(() => (window as any).__hiloTest.runCommand('dailySummary'));
    await expect(page.locator('[data-field="summary-preview"]')).toContainText('Hoy no hubo actividad');
    await expect(page.locator('[data-field="summary-preview"]')).not.toContainText('Vieja');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
