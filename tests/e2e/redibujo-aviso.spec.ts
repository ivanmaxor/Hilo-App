import { expect, test } from '@playwright/test';
import { uuid } from './claude-helpers';
import { cleanup, launch, makeState, openSink, setWindowSize, settle } from './helpers';

test('al arrastrar la ventana, el proceso solo recibe el tamaño final', async () => {
  const id = uuid();
  const ctx = await launch({ state: makeState([{ id, kind: 'shell', name: 'Shell' }]), width: 1400, height: 800 });
  try {
    const { page, app } = ctx;
    await openSink(page, id);
    await settle(1500);
    await app.evaluate(({ ipcMain }) => {
      const seen: string[] = [];
      (globalThis as any).__resizes = seen;
      ipcMain.on('pty:resize', (_event, _id, cols, rows) => seen.push(`${cols}x${rows}`));
    });
    for (let w = 1400; w >= 800; w -= 30) {
      await setWindowSize(app, w, 800);
      await settle(16);
    }
    // Con la ventana oculta de las pruebas, Chromium atrasa los temporizadores hasta un segundo.
    await settle(2500);
    const seen = await app.evaluate(() => (globalThis as any).__resizes as string[]);
    const size = await page.evaluate((sid) => {
      const { term } = (window as any).__hiloTest.terminals.debugEntry(sid);
      return `${term.cols}x${term.rows}`;
    }, id);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(3);
    expect(seen.at(-1)).toBe(size);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
