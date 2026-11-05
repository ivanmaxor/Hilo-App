import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { changesPaneId } from '../../src/shared/paneContent';
import type { SessionKind } from '../../src/shared/types';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { cleanup, launch, makeState, ROOT, settle, waitStatus } from './helpers';

/**
 * Las imágenes del README, con la app y Claude reales sobre un proyecto de demostración.
 *   HILO_README_MEDIA=1 npx playwright test tests/e2e/readme-media.spec.ts
 * Deja docs/img/hilo.png y los cuadros de la animación en test-results/media. Hay que mirarlas antes de
 * subirlas: es Claude de verdad, y su cabecera muestra la carpeta y el plan.
 */
const CHECKOUT_BEFORE = `export function total(items: Item[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

export function checkout(cart: Cart): Order {
  const amount = total(cart.items);
  return createOrder(cart.user, amount);
}
`;

const CHECKOUT_AFTER = `export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function checkout(cart: Cart): Order {
  if (cart.items.length === 0) {
    throw new Error('The cart is empty');
  }
  const amount = total(cart.items);
  return createOrder(cart.user, amount);
}
`;

function demoRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shop-api-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'checkout.ts'), CHECKOUT_BEFORE);
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  writeFileSync(join(dir, 'src', 'checkout.ts'), CHECKOUT_AFTER);
  return dir;
}

test('imágenes del README', async () => {
  test.skip(!process.env.HILO_README_MEDIA, 'Definir HILO_README_MEDIA=1: usa Claude real');
  test.setTimeout(240_000);
  const frames = join(ROOT, 'test-results', 'media');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  mkdirSync(join(ROOT, 'docs', 'img'), { recursive: true });

  const repo = demoRepo();
  const [a, b, c] = [uuid(), uuid(), uuid()] as [string, string, string];
  const record = (id: string, name: string, kind: SessionKind = 'claude') => ({ id, claudeId: id, kind, name, color: null, cwd: TRUSTED, createdAt: 1 });
  const state = makeState([]);
  state.projects = [
    { id: 'shop', name: 'shop-api', path: repo, color: '#6ea8fe', collapsed: false, sessions: [record(a, 'Checkout review'), record(b, 'Release haiku')] },
    { id: 'web', name: 'landing-page', path: TRUSTED, color: '#c58cc4', collapsed: false, sessions: [record(c, 'Notes file'), record(uuid(), 'Dev server', 'shell')] },
    { id: 'mobile', name: 'mobile-app', path: TRUSTED, color: '#7bc48f', collapsed: false, sessions: [record(uuid(), 'Push notifications'), record(uuid(), 'App store copy')] },
  ];
  state.ui = { ...state.ui, activeSessionId: a, panes: [a, changesPaneId('shop')], layout: 2, activePane: 0 };

  const ctx = await launch({ state, claudeArgs: [...CLAUDE_ARGS, '--permission-mode', 'default'], width: 1280, height: 800 });
  let count = 0;
  try {
    const { page } = ctx;
    const statusOf = (id: string) => page.evaluate((sid) => (window as any).__hiloTest.app.get().runtime[sid]?.status, id);
    const show = (id: string) => page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    const select = async (id: string) => {
      await show(id);
      await acceptTrustIfNeeded(page, id);
    };
    /** La cabecera de Claude muestra la carpeta y el plan: un cuadro con ella no se guarda. */
    const frame = async (id: string) => {
      const visible = await page.evaluate((sid) => {
        const buf = (window as any).__hiloTest.terminals.debugEntry(sid).term.buffer.active;
        const out: string[] = [];
        for (let i = buf.viewportY; i < buf.viewportY + 60 && i < buf.length; i++) out.push(buf.getLine(i).translateToString(true));
        return out.join(' ');
      }, id);
      if (/Claude Code v|Claude (Pro|Max)|Desktop|proyectos/.test(visible)) {
        console.log('cuadro omitido: se ve la cabecera');
        return;
      }
      await page.screenshot({ path: join(frames, `f-${String(count++).padStart(3, '0')}.png`) });
    };
    const list = (topic: string) => `List 45 practical checks for ${topic}. One short line each, numbered. No tools.`;

    await select(b);
    await waitStatus(page, b, 'idle', 40_000);
    await send(page, b, list('a safe release'));
    await waitStatus(page, b, 'working', 20_000);

    await select(c);
    await waitStatus(page, c, 'idle', 40_000);
    await send(page, c, `${list('a landing page')} Then create a file named notes.txt with the text hello, using the Write tool.`);
    await waitStatus(page, c, 'waiting', 90_000);

    await select(a);
    await waitStatus(page, a, 'idle', 40_000);
    await send(page, a, list('reviewing a checkout flow'));
    await waitStatus(page, a, 'working', 20_000);
    await page.waitForFunction((sid) => (window as any).__hiloTest.app.get().runtime[sid]?.status !== 'working', a, { timeout: 90_000 });
    await waitStatus(page, b, 'done', 60_000);
    await settle(2000);
    await page.screenshot({ path: join(ROOT, 'docs', 'img', 'hilo.png') });

    // La animación: Claude trabaja, y se recorre lo que necesita atención.
    await frame(a);
    await send(page, a, 'List 25 more checks. One short line each, numbered. No tools.');
    await waitStatus(page, a, 'working', 20_000);
    const start = Date.now();
    while (Date.now() - start < 60_000 && (await statusOf(a)) === 'working') {
      await frame(a);
      await settle(400);
    }
    await settle(1200);
    await frame(a);
    await frame(a);
    for (const id of [b, b, c, c, c, a, a]) {
      await show(id);
      await settle(700);
      await frame(id);
    }
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
    rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  }
});
