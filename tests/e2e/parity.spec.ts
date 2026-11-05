import { join } from 'node:path';
import { test } from '@playwright/test';
import { cleanup, launch, makeState, ROOT, settle, waitForText } from './helpers';

// Mismo contenido que scripts/compare-wt.ps1 pinta en Windows Terminal.
test('captura para comparar con Windows Terminal', async () => {
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  const ctx = await launch({
    state: makeState([{ id, name: 'Comparar' }]),
    width: 1100,
    height: 640,
    env: {
      HILO_TEST_SHELL: JSON.stringify(['powershell.exe', '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'tests', 'fixtures', 'parity-content.ps1')]),
    },
  });
  try {
    await ctx.page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    await waitForText(ctx.page, id, 'Texto normal', 20_000);
    await settle(1500);
    await ctx.page.screenshot({ path: join(ROOT, 'test-results', 'capturas', 'paridad-hilo.png') });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
