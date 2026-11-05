import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { cleanup, launch, makeState, ROOT } from './helpers';

const A = 'aaaaaaaa-3333-4000-8000-00000000000a';
const O = '\x1b[38;2;215;119;87m';
const LOGO = ` ${O}▐▛███▛█\x1b[0m   Claude Code\r\n${O}▝▜██████▀\x1b[0m  Haiku\r\n ${O}▝▝   ▝▝\x1b[0m   carpeta\r\n`;

test('si la GPU pierde el contexto, la terminal vuelve a dibujar con WebGL', async () => {
  const state = makeState([{ id: A, name: 'Uno' }]);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  const run = await launch({ state, width: 900, height: 400 });
  try {
    const { page } = run;
    await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), A);
    await page.waitForTimeout(1500);
    await page.evaluate(([id, t]) => new Promise<void>((r) => (window as any).__hiloTest.terminals.debugEntry(id).term.write('\x1b[2J\x1b[H' + t, () => r())), [A, LOGO]);
    const gl = () => page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount());
    expect(await gl()).toBe(1);
    const box = (await page.locator('.term-slot').first().boundingBox())!;
    const clip = { x: box.x - 4, y: box.y - 4, width: 400, height: 80 };
    await page.screenshot({ path: join(ROOT, 'test-results', 'logo-webgl.png'), clip });

    await page.evaluate(() => {
      const canvas = [...document.querySelectorAll('.term-slot canvas')].find((c) => (c as HTMLCanvasElement).getContext('webgl2')) as HTMLCanvasElement;
      canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect.poll(gl, { timeout: 4000, intervals: [50] }).toBe(0);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(ROOT, 'test-results', 'logo-respaldo.png'), clip });
    await expect.poll(gl, { timeout: 8000 }).toBe(1);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
