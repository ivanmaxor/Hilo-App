import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, launch, makeState, openSink, status } from './helpers';

/** Un repositorio de mentira: basta con su `.git/HEAD`, porque Hilo no ejecuta git para esto. */
function fakeRepo(root: string, name: string, head: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), head);
  return dir;
}

test('rama y tiempo en el estado bajo el nombre de cada sesión', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hilo-rama-'));
  const repoA = fakeRepo(root, 'repo-a', 'ref: refs/heads/main\n');
  const repoB = fakeRepo(root, 'repo-b', 'ref: refs/heads/feature/rama-con-un-nombre-bastante-largo-para-cortar\n');
  const repoC = fakeRepo(root, 'repo-c', `${'0123456789abcdef'.repeat(3).slice(0, 40)}\n`);
  const plain = join(root, 'sin-git');
  mkdirSync(plain);

  const state = makeState([
    { id: 'a', name: 'Principal' },
    { id: 'b', name: 'Función larga' },
    { id: 'c', name: 'Commit suelto' },
    { id: 'd', name: 'Sin git' },
    { id: 'e', name: 'Dormida' },
  ]);
  const cwds: Record<string, string> = { a: repoA, b: repoB, c: repoC, d: plain, e: repoA };
  for (const s of state.projects[0]!.sessions) s.cwd = cwds[s.id]!;
  // Desde la 1.4.2 van apagados por defecto.
  state.settings.showBranch = true;
  state.settings.showStateTime = true;

  const ctx = await launch({ state, width: 1000, height: 640 });
  try {
    const { page } = ctx;
    const row = (id: string) => page.locator(`.row[data-session="${id}"]`);
    for (const id of ['a', 'b', 'c', 'd']) await openSink(page, id);

    // Cada sesión muestra la suya; la carpeta sin git no muestra rama ni da error.
    await expect(row('a').locator('.branch')).toHaveText('main');
    await expect(row('b').locator('.branch')).toHaveAttribute('data-branch', /^feature\/rama-con-un-nombre/);
    await expect(row('c').locator('.branch')).toHaveText('(0123456)');
    await expect(row('d').locator('.branch')).toHaveCount(0);

    // El tiempo en el estado: recién cambiada dice "ahora", y la sin git también lo tiene.
    for (const id of ['a', 'b', 'c', 'd']) await expect(row(id).locator('.since')).toHaveText('ahora');
    // Una dormida no muestra nada. Ninguna fila crece: rama y tiempo van en la misma línea del nombre (28 px).
    await expect(row('e').locator('.row-meta')).toHaveCount(0);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect((await row(id).boundingBox())!.height).toBeLessThan(30);
    // La rama y el tiempo quedan a la derecha del nombre, en la misma línea.
    const name = (await row('a').locator('.name').boundingBox())!;
    const meta = (await row('a').locator('.row-meta').boundingBox())!;
    expect(Math.abs(name.y + name.height / 2 - (meta.y + meta.height / 2))).toBeLessThan(6);
    expect(meta.x).toBeGreaterThan(name.x);

    // El reloj de un minuto repinta solo el texto, no la fila: el nodo de la fila es el mismo.
    await page.evaluate(() => {
      (window as any).__fila = document.querySelector('.row[data-session="a"]');
    });
    await page.evaluate(() => (window as any).__hiloTest.clock.set({ now: Date.now() + 5 * 60_000 }));
    await expect(row('a').locator('.since')).toHaveText(/^[56] min$/);
    expect(await page.evaluate(() => (window as any).__fila === document.querySelector('.row[data-session="a"]'))).toBe(true);
    await page.evaluate(() => (window as any).__hiloTest.clock.set({ now: Date.now() }));

    // El título dice rama y desde cuándo.
    const title = (await row('a').getAttribute('title'))!;
    expect(title).toContain('Rama: main');
    expect(title).toMatch(/desde hace/);

    // La rama se refresca al despertar: cambia HEAD con la sesión dormida y vuelve a despertarla.
    writeFileSync(join(repoA, '.git', 'HEAD'), 'ref: refs/heads/otra-rama\n');
    await page.evaluate(() => (window as any).__hiloTest.sleepSession('a'));
    await expect.poll(() => status(page, 'a'), { timeout: 15_000 }).toBe('asleep');
    await expect(row('a').locator('.row-meta')).toHaveCount(0);
    await openSink(page, 'a');
    await expect(row('a').locator('.branch')).toHaveText('otra-rama');

    await expect(row('a')).toHaveCSS('height', '28px');
    // Con una rama larga y un nombre largo el tiempo sigue entero y la fila no se desborda.
    for (const id of ['a', 'b']) {
      const r = (await row(id).boundingBox())!;
      const since = (await row(id).locator('.since').boundingBox())!;
      expect(since.x + since.width).toBeLessThanOrEqual(r.x + r.width + 1);
    }
    await page.screenshot({ path: 'test-results/rama-y-tiempo.png' });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
    rmSync(root, { recursive: true, force: true });
  }
});
