import { expect, test } from '@playwright/test';
import { cleanup, clearSink, focusTerm, launch, makeState, openSink, readSink, setClipboard, settle, waitForSink, type Launched } from './helpers';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const START = '\x1b[200~';
const END = '\x1b[201~';
// Clave falsa armada por partes para que npm run privacy y el CI no la marquen.
const KEY = ['sk-', 'ant-', 'x'.repeat(30)].join('');

test.describe('avisar antes de pegar una clave', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: Launched;

  test.beforeAll(async () => {
    ctx = await launch({ state: makeState([{ id: ID, name: 'prueba' }]) });
    await openSink(ctx.page, ID);
  });
  test.afterAll(async () => {
    await ctx.close();
    cleanup(ctx.dataDir);
  });
  test.beforeEach(async () => {
    clearSink(ctx.sinkFile);
    await focusTerm(ctx.page, ID);
  });

  const typeInto = (text: string) => ctx.page.evaluate(([id, t]) => (window as any).__hiloTest.terminals.typeInto(id, t), [ID, text]);

  test('con una clave pregunta, enfoca Cancelar, no muestra el valor y Cancelar no escribe nada', async () => {
    await setClipboard(ctx.app, `mi clave es ${KEY}`);
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Esto parece una clave');
    await expect(ctx.page.locator('.dialog .proc-list li')).toHaveText(['Clave de Anthropic (sk-ant-…)']);
    expect(await ctx.page.locator('.dialog').innerText()).not.toContain(KEY);
    await expect(ctx.page.locator('.dialog .actions button').first()).toBeFocused();
    await ctx.page.locator('.dialog .actions button').first().click();
    await expect(ctx.page.locator('.dialog')).toHaveCount(0);
    await settle();
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('Pegar escribe el texto con bracketed paste', async () => {
    await setClipboard(ctx.app, `mi clave es ${KEY}`);
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Esto parece una clave');
    expect(readSink(ctx.sinkFile).length).toBe(0);
    await ctx.page.locator('[data-confirm="ok"]').click();
    const want = START + `mi clave es ${KEY}` + END;
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= Buffer.byteLength(want));
    await settle();
    expect(got.toString('utf8')).toBe(want);
  });

  test('lo tecleado durante el diálogo sale después del pegado, en orden', async () => {
    await setClipboard(ctx.app, KEY);
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Esto parece una clave');
    await typeInto('ab');
    await typeInto('cd');
    await settle();
    expect(readSink(ctx.sinkFile).length).toBe(0);
    await ctx.page.locator('[data-confirm="ok"]').click();
    const want = START + KEY + END + 'abcd';
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= Buffer.byteLength(want));
    await settle();
    expect(got.toString('utf8')).toBe(want);
  });

  test('al cancelar, lo tecleado durante el diálogo sí sale', async () => {
    await setClipboard(ctx.app, KEY);
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Esto parece una clave');
    await typeInto('xy');
    await ctx.page.locator('.dialog .actions button').first().click();
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= 2);
    await settle();
    expect(got.toString('utf8')).toBe('xy');
  });

  test('un texto normal se pega sin diálogo', async () => {
    await setClipboard(ctx.app, 'KEYBOARD=us-intl y task-ant-nada');
    await ctx.page.keyboard.press('Control+V');
    const want = START + 'KEYBOARD=us-intl y task-ant-nada' + END;
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= Buffer.byteLength(want));
    expect(got.toString('utf8')).toBe(want);
    await expect(ctx.page.locator('.dialog')).toHaveCount(0);
  });
});

test('sin bracketed paste, clave y varias líneas: un solo diálogo con los dos avisos', async () => {
  const ctx = await launch({ state: makeState([{ id: ID, name: 'prueba' }]), sinkFlags: [] });
  try {
    await openSink(ctx.page, ID);
    await setClipboard(ctx.app, `a\r\n${KEY}`);
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Esto parece una clave');
    await expect(ctx.page.locator('.dialog .proc-list li')).toHaveCount(2);
    expect(readSink(ctx.sinkFile).length).toBe(0);
    await ctx.page.locator('[data-confirm="ok"]').click();
    await expect(ctx.page.locator('.dialog')).toHaveCount(0);
    const want = `a\r${KEY}`;
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= want.length);
    await settle();
    expect(got.toString('utf8')).toBe(want);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
