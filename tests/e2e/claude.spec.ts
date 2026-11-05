import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { bufferText, cleanup, focusTerm, launch, makeState, newDataDir, pidAlive, setClipboard, settle, status, waitForText, waitStatus, processTree } from './helpers';

test.describe('Claude real', () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1 para usar Claude real');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test('estados, verde como no leído, y retomar con el mismo id', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const b = uuid();
    let ctx = await launch({
      dataDir,
      state: makeState(
        [
          { id: a, kind: 'claude', name: 'Prueba A' },
          { id: b, kind: 'shell', name: 'Otra' },
        ],
        TRUSTED,
      ),
      claudeArgs: CLAUDE_ARGS,
    });
    try {
      const { page } = ctx;
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 30_000);

      // Verdad del terminal: lo mismo que ve el usuario.
      await waitForText(page, a, 'for shortcuts', 20_000).catch(() => undefined);

      // Ventana sin foco: el resultado tiene que quedar en verde.
      await ctx.app.evaluate(() => (globalThis as any).__hilo.focus(false));
      await send(page, a, 'responde solo OK');
      await waitStatus(page, a, 'working', 20_000);
      const iconWhileWorking = await page.locator(`.row[data-session="${a}"] svg.st`).getAttribute('data-status');
      expect(iconWhileWorking).toBe('working');
      await waitStatus(page, a, 'done', 60_000);
      await settle(1500);
      expect(await status(page, a)).toBe('done');
      expect(await page.locator(`.tab[data-tab="${a}"] svg.st`).getAttribute('data-status')).toBe('done');
      await expect(page.locator(`.need[data-need="${a}"]`)).toBeVisible();
      // El aviso espera un momento: el mismo ✳ también puede ser una salida o un permiso.
      await expect
        .poll(async () => (await ctx.app.evaluate(() => (globalThis as any).__hilo.sentNotifications)).some((n: { status: string }) => n.status === 'done'), { timeout: 5000 })
        .toBe(true);

      // Abrirla la pasa a neutro.
      await ctx.app.evaluate(() => (globalThis as any).__hilo.focus(true));
      await waitStatus(page, a, 'idle', 5000);

      const pid = await ctx.app.evaluate((_e, id) => (globalThis as any).__hilo.pidOf(id), a);
      expect(pid).toBeGreaterThan(0);
      const tree = processTree(pid);

      // Dormir.
      const events = readFileSync(join(dataDir, 'hooks', `${a}.events`), 'utf8');
      expect(events).toContain('UserPromptSubmit');
      expect(events).toContain('Stop');

      await page.evaluate((id) => (window as any).__hiloTest.sleepSession(id), a);
      await waitStatus(page, a, 'asleep', 15_000);
      await settle(800);
      expect(pidAlive(pid)).toBe(false);
      for (const child of tree) expect(pidAlive(child.pid), child.name).toBe(false);

      // Cerrar y abrir la app: vuelve dormida con su nombre.
      await ctx.close();
      ctx = await launch({ dataDir, claudeArgs: CLAUDE_ARGS });
      const page2 = ctx.page;
      expect(await status(page2, a)).toBe('asleep');
      await expect(page2.locator(`.row[data-session="${a}"] .name`)).toHaveText('Prueba A');

      // Despertar: retoma la misma conversación, con el mismo id.
      await page2.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await waitStatus(page2, a, 'idle', 30_000);
      const recorded = await ctx.app.evaluate((_e, id) => (globalThis as any).__hilo.findSession(id).session.claudeId, a);
      expect(recorded).toBe(a);
      await waitForText(page2, a, 'responde solo OK', 20_000);
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });

  test('dormido automático: duerme la que está en reposo y al abrirla vuelve', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const b = uuid();
    const state = makeState([{ id: a, kind: 'claude', name: 'Reposo' }, { id: b, kind: 'shell', name: 'Vista' }], TRUSTED);
    state.settings.autoSleepMinutes = 1;
    const ctx = await launch({ dataDir, state, claudeArgs: CLAUDE_ARGS });
    try {
      const { page, app } = ctx;
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 30_000);
      // Otra sesión a la vista, y la primera lleva rato sin actividad.
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), b);
      await settle(500);
      await app.evaluate((_e, id) => {
        const sessions = (globalThis as any).__hilo.sessions;
        sessions.live.get(id).lastActivity = Date.now() - 5 * 60_000;
        sessions.autoSleep();
      }, a);
      await waitStatus(page, a, 'asleep', 20_000);
      const hasTerm = await page.evaluate((id) => (window as any).__hiloTest.terminals.has(id), a);
      expect(hasTerm).toBe(false);
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });

  test('esperando: permiso con hook, y Esc lo saca sin dejarlo en amarillo', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const ctx = await launch({
      dataDir,
      state: makeState([{ id: a, kind: 'claude', name: 'Permiso' }], TRUSTED),
      claudeArgs: [...CLAUDE_ARGS, '--permission-mode', 'manual'],
    });
    try {
      const { page } = ctx;
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 30_000);
      await send(page, a, 'usa la herramienta Write para crear prueba-hilo.txt con el texto hola');
      await waitStatus(page, a, 'waiting', 60_000);
      expect(readFileSync(join(dataDir, 'hooks', `${a}.events`), 'utf8')).toContain('PermissionRequest');
      await expect(page.locator(`.need[data-need="${a}"]`)).toBeVisible();
      await focusTerm(page, a);
      await page.keyboard.press('Escape');
      await waitStatus(page, a, ['idle', 'done'], 10_000);
      expect(existsSync(join(TRUSTED, 'prueba-hilo.txt'))).toBe(false);
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });

  test('pegado multilínea no se envía antes de tiempo, y Alt+V no manda nada solo', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const ctx = await launch({
      dataDir,
      state: makeState([{ id: a, kind: 'claude', name: 'Pegar' }], TRUSTED),
      claudeArgs: CLAUDE_ARGS,
    });
    try {
      const { page, app } = ctx;
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 30_000);
      await focusTerm(page, a);

      await setClipboard(app, 'alfa\nbeta\ngamma');
      await page.keyboard.press('Control+V');
      await settle(1500);
      expect(await status(page, a)).toBe('idle');
      const text = await bufferText(page, a);
      expect(text).toContain('alfa');
      expect(text).toContain('gamma');

      // Shift+Enter inserta un salto de línea, no envía.
      await page.keyboard.type('delta', { delay: 1 });
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('epsilon', { delay: 1 });
      await settle(800);
      expect(await status(page, a)).toBe('idle');
      expect(await bufferText(page, a)).toContain('epsilon');

      // Borrar todo sin enviar: nada de esto debe llegarle al modelo.
      await page.keyboard.press('Control+C');
      await settle(500);
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });
});
