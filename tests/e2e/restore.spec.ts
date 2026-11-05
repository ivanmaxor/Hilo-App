import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, launch, makeState, newDataDir, status } from './helpers';

const live = (app: any, id: string) => app.evaluate((_e: unknown, sid: string) => !!(globalThis as any).__hilo.pidOf(sid), id);

/** Lo que el dueño dejó encendido vuelve al abrir, y lo que durmió sigue dormido. */
test('al reabrir se encienden solo las sesiones que quedaron encendidas', async () => {
  const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const state = makeState([{ id: a, name: 'A' }, { id: b, name: 'B' }, { id: c, name: 'C' }]);
  state.settings.startup = 'restore';
  const dataDir = newDataDir();
  let run = await launch({ dataDir, state });
  try {
    const page = run.page;
    await page.evaluate(async ([x, y]) => {
      const t = (window as any).__hiloTest;
      await t.wakeSession(x);
      await t.wakeSession(y);
    }, [a, b]);
    await expect.poll(() => status(page, b)).toBe('idle');
    // Una se duerme a propósito: esa ya no debe volver.
    await page.evaluate((y) => (window as any).__hiloTest.sleepSession(y), b);
    await expect.poll(() => status(page, b), { timeout: 15_000 }).toBe('asleep');
    await page.evaluate((x) => (window as any).__hiloTest.terminals.debugEntry(x).term.write('MARCA'), a);
    await run.close();

    const saved = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));
    expect(saved.ui.awake).toEqual([a]);

    run = await launch({ dataDir });
    await expect.poll(() => live(run.app, a), { timeout: 15_000 }).toBe(true);
    expect(await live(run.app, b)).toBe(false);
    expect(await live(run.app, c)).toBe(false);
    expect(await status(run.page, b)).toBe('asleep');
    await run.page.waitForTimeout(800);
    expect(await run.page.evaluate((x) => (window as any).__hiloTest.terminals.has(x), a)).toBe(true);
  } finally {
    await run.close();
    cleanup(dataDir);
  }
});

test('una sesión que sale sola no vuelve a encenderse', async () => {
  const a = crypto.randomUUID();
  const state = makeState([{ id: a, name: 'A' }]);
  state.settings.startup = 'restore';
  const dataDir = newDataDir();
  let run = await launch({ dataDir, state });
  try {
    await run.page.evaluate((x) => (window as any).__hiloTest.wakeSession(x), a);
    await expect.poll(() => live(run.app, a), { timeout: 15_000 }).toBe(true);
    await run.app.evaluate((_e, x) => {
      const pid = (globalThis as any).__hilo.pidOf(x);
      process.kill(pid);
    }, a);
    await expect.poll(() => live(run.app, a), { timeout: 15_000 }).toBe(false);
    // Espera por si era un apagado del PC: entonces la marca tiene que sobrevivir.
    await run.page.waitForTimeout(3800);
    await run.close();
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).ui.awake).toEqual([]);
  } finally {
    await run.close();
    cleanup(dataDir);
  }
});
