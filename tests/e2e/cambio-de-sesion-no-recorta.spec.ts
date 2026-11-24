import { expect, test } from '@playwright/test';
import { cleanup, launch, makeState, newDataDir, waitForText } from './helpers';

/**
 * #11: cambiar de sesión no debe redimensionar ninguna terminal ni recortar lo que ya está dibujado.
 * Antes, cada actualización del estado llamaba a `applySettings`, que reajustaba también las terminales
 * estacionadas (con otro ancho): xterm con `windowsPty: conpty` recorta las columnas que sobran, así que cada
 * línea completa (los bordes de la caja de Claude) perdía su final y al volver al ancho real no reaparecía.
 * El proceso no se enteraba (el tamaño final coincidía), y Claude no la redibujaba: quedaba una línea corta suelta.
 */
test('cambiar de sesión no redimensiona las terminales ni recorta las líneas completas', async () => {
  const A = 'aaaaaaaa-7777-4000-8000-00000000000a';
  const B = 'bbbbbbbb-7777-4000-8000-00000000000b';
  const state = makeState([{ id: A, name: 'Uno' }, { id: B, name: 'Dos' }]);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  const dataDir = newDataDir();
  const run = await launch({ dataDir, state, width: 1100, height: 700 });
  try {
    const { page } = run;
    const select = (id: string) => page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);

    await select(A);
    await waitForText(page, A, 'LISTO');
    await select(B);
    await waitForText(page, B, 'LISTO');
    await select(A);
    await page.waitForTimeout(600);

    // Una línea que ocupa todo el ancho, como el borde de la caja de Claude.
    const cols = await page.evaluate(
      (id) =>
        new Promise<number>((resolve) => {
          const term = (window as any).__hiloTest.terminals.debugEntry(id).term;
          term.write('─'.repeat(term.cols) + '\r\nfin de la línea completa\r\n', () => resolve(term.cols));
        }),
      A,
    );
    // Contar cuántas veces xterm cambia de tamaño a partir de aquí.
    await page.evaluate(([a, b]) => {
      const w = window as any;
      w.__resizes = [];
      for (const [name, id] of [['A', a], ['B', b]] as const) {
        w.__hiloTest.terminals.debugEntry(id).term.onResize((e: any) => w.__resizes.push(`${name}:${e.cols}x${e.rows}`));
      }
    }, [A, B]);

    for (let i = 0; i < 3; i++) {
      await select(B);
      await page.waitForTimeout(500);
      await select(A);
      await page.waitForTimeout(500);
    }

    const resizes = await page.evaluate(() => (window as any).__resizes as string[]);
    expect(resizes, 'ninguna terminal debe cambiar de tamaño al cambiar de sesión').toEqual([]);

    const longitudes = await page.evaluate((id) => {
      const term = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const b = term.buffer.active;
      const out: number[] = [];
      for (let i = 0; i < b.length; i++) {
        const t = b.getLine(i)?.translateToString(true) ?? '';
        if (/^─+$/.test(t)) out.push(t.length);
      }
      return out;
    }, A);
    expect(longitudes.length).toBeGreaterThan(0);
    expect(longitudes, 'la línea completa no debe quedar recortada').toEqual(longitudes.map(() => cols));
  } finally {
    await run.close();
    cleanup(dataDir);
  }
});
