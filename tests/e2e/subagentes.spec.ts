import { expect, test } from '@playwright/test';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { cleanup, launch, makeState, settle, waitStatus } from './helpers';

test('con subagentes en segundo plano, solo avisa cuando acaba el último', async () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1 para usar Claude real');
  test.setTimeout(240_000);
  const id = uuid();
  const ctx = await launch({ state: makeState([{ id, kind: 'claude', name: 'Con subagentes' }], TRUSTED), claudeArgs: CLAUDE_ARGS, width: 1200, height: 800 });
  try {
    const { page, app } = ctx;
    await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    await acceptTrustIfNeeded(page, id);
    await waitStatus(page, id, 'idle', 40_000);
    // Sin foco: si el aviso de que terminó sale antes de tiempo, queda registrado.
    await app.evaluate(() => (globalThis as any).__hilo.focus(false));
    await send(page, id, 'Use the Agent tool to launch two background subagents at the same time. The first runs the bash command `sleep 15` and then replies OK. The second runs `sleep 30` and then replies OK. Do not wait for them: right after launching, answer only with the word LANZADOS and end your turn.');

    const runtime = () => page.evaluate((sid) => (window as any).__hiloTest.app.get().runtime[sid], id);
    await expect.poll(async () => (await runtime())?.subagents ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(page.locator(`.row[data-session="${id}"] .subagents`)).toContainText('sub');
    await page.screenshot({ path: 'test-results/subagentes-corriendo.png' });

    // Mientras queden, la sesión sigue trabajando y sin aviso.
    const notified = () => app.evaluate((_e, sid) => ((globalThis as any).__hilo.sentNotifications as { id: string; status: string }[]).filter((n) => n.id === sid && n.status === 'done').length, id);
    const seen = new Set<string>();
    const until = Date.now() + 150_000;
    let running = true;
    while (Date.now() < until && running) {
      const now = await runtime();
      seen.add(`${now.status}:${now.subagents ?? 0}`);
      if ((now.subagents ?? 0) > 0) {
        expect(now.status, `con ${now.subagents} subagentes`).not.toBe('done');
        expect(await notified()).toBe(0);
      } else {
        running = false;
      }
      await settle(500);
    }
    console.log('visto:', [...seen].join(' '));
    expect(running).toBe(false);

    await waitStatus(page, id, 'done', 90_000);
    await expect(page.locator(`.row[data-session="${id}"] .subagents`)).toHaveCount(0);
    await expect.poll(notified, { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
