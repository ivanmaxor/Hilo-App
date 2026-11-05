import { expect, test } from '@playwright/test';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { bufferText, cleanup, launch, makeState, newDataDir, setWindowSize, settle, waitStatus } from './helpers';

const marks = (text: string) => [...text.matchAll(/MARCA-(\d+)\b/g)].map((m) => Number(m[1]));


test('el pie de la barra lateral no corta el atajo', async () => {
  const id = uuid();
  const ctx = await launch({ state: makeState([{ id, kind: 'shell', name: 'Shell' }]), width: 1100, height: 700 });
  try {
    const kbd = ctx.page.locator('.foot-hint kbd');
    await expect(kbd).toBeVisible();
    const fits = await kbd.evaluate((el) => {
      const hint = el.closest('.foot-hint')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.right <= hint.right && box.width > 10;
    });
    expect(fits).toBe(true);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test.describe('Claude real', () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1 para usar Claude real');
  test.setTimeout(300_000);

  test('arrastrar no pierde nada ni acumula una copia por paso', async () => {
    const id = uuid();
    const dataDir = newDataDir();
    const ctx = await launch({ dataDir, state: makeState([{ id, kind: 'claude', name: 'Larga' }], TRUSTED), claudeArgs: CLAUDE_ARGS, width: 1400, height: 800 });
    const expected = Array.from({ length: 70 }, (_, i) => i + 1);
    const copies = async () => {
      await settle(2500);
      const found = marks(await bufferText(ctx.page, id));
      expect(new Set(found).size).toBe(70);
      return found.filter((n) => n === 70).length;
    };
    try {
      const { page, app } = ctx;
      await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
      await acceptTrustIfNeeded(page, id);
      await waitStatus(page, id, 'idle', 40_000);
      await send(page, id, 'Sin herramientas: escribe 35 lineas. Cada una empieza con la palabra MARCA, un guion y su numero, del 1 al 35, seguida de unos 100 caracteres de relleno. Sin nada mas.');
      await waitStatus(page, id, 'working', 20_000);
      await waitStatus(page, id, 'done', 120_000);
      await send(page, id, 'Sin herramientas: sigue igual con los numeros del 36 al 70. Sin nada mas.');
      await waitStatus(page, id, 'working', 20_000);
      await waitStatus(page, id, 'done', 120_000);
      expect(marks(await bufferText(page, id))).toEqual(expected);

      // Claude reimprime lo reciente en cada aviso: arrastrar tiene que costar una copia, no una por paso.
      const before = await copies();
      for (let w = 1400; w >= 700; w -= 40) {
        await setWindowSize(app, w, 800);
        await settle(16);
      }
      const after = await copies();
      const text = await bufferText(page, id);
      const cols = await page.evaluate((sid) => (window as any).__hiloTest.terminals.debugEntry(sid).term.cols, id);
      const rules = text.split(String.fromCharCode(10)).filter((l) => l.includes('─────'));
      console.log(`copias de la última línea: ${before} antes, ${after} después de 18 pasos; ${marks(text).length} marcas; ${cols} columnas`);
      // Claude sí recibió el tamaño final y redibujó con él.
      expect(rules.at(-1)!.trimEnd().length).toBe(cols);
      expect(after - before).toBeLessThanOrEqual(2);
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });
});
