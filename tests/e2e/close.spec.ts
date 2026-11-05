import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, launch, makeState, newDataDir, readSink } from './helpers';

const CHILD = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
process.stdout.write('LISTO\\r\\n');
process.stdin.resume();
process.on('exit', () => child.kill());
`;

/**
 * Cerrar una sesión con procesos no abre un diálogo a media frase: se avisa sin quitar el foco,
 * y la sesión sigue abierta hasta que se pida de nuevo.
 */
test('cerrar con procesos avisa sin quitar el foco, y lo escrito sigue en la vecina', async () => {
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
  const state = makeState([{ id: a, name: 'A' }, { id: b, name: 'B' }]);
  state.ui.panes = [a];
  state.ui.activeSessionId = a;
  const dataDir = newDataDir();
  const script = join(mkdtempSync(join(tmpdir(), 'hilo-close-')), 'hijo.cjs');
  writeFileSync(script, CHILD);
  const { app, page, close, sinkFile } = await launch({ dataDir, state });
  try {
    // A tiene un hijo: se le da una shell que lo lanza. B es el receptor normal.
    await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), b);
    await app.evaluate((_e, shell) => {
      process.env.HILO_TEST_SHELL = shell;
    }, JSON.stringify([process.execPath, script]));
    await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), a);
    await page.waitForTimeout(1500);
    await page.evaluate((id) => (window as any).__hiloTest.terminals.focus(id), a);

    await page.keyboard.press('Control+Shift+W');
    await page.keyboard.type('hola mundo', { delay: 60 });
    const toast = page.locator('.toast', { hasText: 'sigue abierta' });
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await page.keyboard.type('!', { delay: 60 });

    // Sin diálogo, y la frase entera en la vecina.
    expect(await page.evaluate(() => (window as any).__hiloTest.view.get().modal)).toBeNull();
    await expect.poll(() => readSink(sinkFile).toString('utf8')).toContain('hola mundo!');
    expect(await app.evaluate((_e, id) => !!(globalThis as any).__hilo.findSession(id), a)).toBe(true);

    // Volver a pedirlo ahora sí la cierra.
    await toast.locator('button').click();
    await expect.poll(() => app.evaluate((_e, id) => !!(globalThis as any).__hilo.findSession(id), a)).toBe(false);
  } finally {
    await close();
    cleanup(dataDir);
  }
});

test('mantener Ctrl+Mayús+W pulsado cierra una sola sesión', async () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const state = makeState(ids.map((id, i) => ({ id, name: `S${i}` })));
  state.ui.panes = [ids[0]!];
  state.ui.activeSessionId = ids[0]!;
  const dataDir = newDataDir();
  const { page, close } = await launch({ dataDir, state });
  try {
    await page.waitForTimeout(300);
    const press = () => page.evaluate(() => {
      for (let i = 0; i < 6; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', code: 'KeyW', ctrlKey: true, shiftKey: true, repeat: i > 0, bubbles: true, cancelable: true }));
      }
    });
    await press();
    await page.waitForTimeout(800);
    const left = await page.evaluate(() => (window as any).__hiloTest.app.get().state.projects[0].sessions.length);
    expect(left).toBe(2);
  } finally {
    await close();
    cleanup(dataDir);
  }
});
