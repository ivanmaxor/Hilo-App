import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  bufferText,
  cleanup,
  clearSink,
  focusTerm,
  getClipboard,
  launch,
  makeState,
  openSink,
  readSink,
  setClipboard,
  settle,
  waitForSink,
  type Launched,
} from './helpers';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const START = '\x1b[200~';
const END = '\x1b[201~';

/** Texto con varios bytes por carácter y saltos, de cerca del tamaño pedido. */
function bigText(chars: number): string {
  const unit = 'línea con ñ, áéíóú y 😀 abcdefghijklmnopqrstuvwxyz 0123456789\r\n';
  let s = '';
  let i = 0;
  while (s.length < chars) s += `${i++} ${unit}`;
  return s;
}

function expectedPaste(text: string, bracket = true): Buffer {
  const body = text.replace(/\r?\n/g, '\r');
  return Buffer.from(bracket ? START + body + END : body, 'utf8');
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

test.describe('copiar y pegar', () => {
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
    await ctx.page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.clearSelection(), ID);
  });

  test('pegado de 100 KB completo y en orden, verificado byte a byte', async () => {
    const text = bigText(102_400);
    expect(text.length).toBeGreaterThanOrEqual(102_400);
    await setClipboard(ctx.app, text);
    await ctx.page.keyboard.press('Control+V');
    const want = expectedPaste(text);
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= want.length);
    expect(got.length).toBe(want.length);
    expect(sha(got)).toBe(sha(want));
  });

  test('pegado de 1 MB completo y en orden', async () => {
    test.setTimeout(180_000);
    const text = bigText(1_048_576);
    await setClipboard(ctx.app, text);
    await ctx.page.keyboard.press('Control+V');
    const want = expectedPaste(text);
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= want.length, 150_000);
    expect(got.length).toBe(want.length);
    expect(sha(got)).toBe(sha(want));
  });

  test('Ctrl+V pega una sola vez', async () => {
    await setClipboard(ctx.app, 'una-sola-vez');
    await ctx.page.keyboard.press('Control+V');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('utf8')).toBe(`${START}una-sola-vez${END}`);
  });

  test('Ctrl+Shift+V pega una sola vez', async () => {
    await setClipboard(ctx.app, 'con-shift');
    await ctx.page.keyboard.press('Control+Shift+V');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('utf8')).toBe(`${START}con-shift${END}`);
  });

  test('varias líneas y CRLF van dentro del bracket, sin Enter suelto', async () => {
    await setClipboard(ctx.app, 'uno\r\ndos\ntres\r\n');
    await ctx.page.keyboard.press('Control+V');
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(`${START}uno\rdos\rtres\r${END}`);
  });

  test('tildes, ñ, emojis, ZWJ, banderas, CJK y combinantes llegan intactos', async () => {
    const text = 'ñandú ÁÉÍÓÚ üÜ ¿qué? 😀 👨‍👩‍👧 🇪🇸 日本語 한글 é';
    await setClipboard(ctx.app, text);
    await ctx.page.keyboard.press('Control+V');
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(`${START}${text}${END}`);
  });

  test('un portapapeles malicioso no se sale del bracket', async () => {
    await setClipboard(ctx.app, 'hola\x1b[201~\rcalc\r\x1b]52;c;QUJD\x07\u009b0m');
    await ctx.page.keyboard.press('Control+V');
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    const s = got.toString('utf8');
    expect(s.startsWith(START)).toBe(true);
    expect(s.endsWith(END)).toBe(true);
    const inner = s.slice(START.length, -END.length);
    expect(inner).not.toContain('\x1b');
    expect(inner).not.toContain('\u009b');
    expect(inner).not.toContain('\x07');
  });

  test('Ctrl+C sin selección manda la interrupción una sola vez', async () => {
    await ctx.page.keyboard.press('Control+C');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('hex')).toBe('03');
  });

  test('Ctrl+C con selección copia y no interrumpe', async () => {
    await setClipboard(ctx.app, 'antes');
    await selectLine(ctx, 'sangría');
    await ctx.page.keyboard.press('Control+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('  sangría conservada');
    expect(readSink(ctx.sinkFile).length).toBe(0);
    const still = await ctx.page.evaluate((id) => (window as any).__hiloTest.terminals.debugEntry(id).term.hasSelection(), ID);
    expect(still).toBe(false);
    // Tras copiar, Ctrl+C vuelve a interrumpir.
    await ctx.page.keyboard.press('Control+C');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    expect(readSink(ctx.sinkFile).toString('hex')).toBe('03');
  });

  test('Ctrl+Shift+C copia y nunca interrumpe', async () => {
    await setClipboard(ctx.app, 'antes');
    await ctx.page.keyboard.press('Control+Shift+C');
    await settle();
    expect(readSink(ctx.sinkFile).length).toBe(0);
    expect(await getClipboard(ctx.app)).toBe('antes');
    await selectLine(ctx, 'sangría');
    await ctx.page.keyboard.press('Control+Shift+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('  sangría conservada');
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('copiar una línea envuelta la une, sin saltos', async () => {
    await selectWrapped(ctx);
    await ctx.page.keyboard.press('Control+C');
    await settle();
    const got = await getClipboard(ctx.app);
    expect(got).toBe(`INICIO-${'abcdefghij'.repeat(40)}-FIN`);
    expect(got).not.toMatch(/[\r\n]/);
  });

  test('copiar no arrastra espacios al final', async () => {
    await selectLine(ctx, 'con-espacios-al-final');
    await ctx.page.keyboard.press('Control+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('con-espacios-al-final');
  });

  test('copiar varias líneas sin espacios basura', async () => {
    await selectLines(ctx, 'con-espacios-al-final', 'sangría');
    await ctx.page.keyboard.press('Control+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('con-espacios-al-final\r\n  sangría conservada');
  });

  test('copia tildes, emoji y CJK tal como se ven', async () => {
    await selectLine(ctx, 'ñandú');
    await ctx.page.keyboard.press('Control+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('ñandú áéíóú 😀 日本語');
  });

  test('clic derecho sin selección pega', async () => {
    await setClipboard(ctx.app, 'pegado-con-clic');
    const box = await termBox(ctx);
    await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const got = await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('utf8')).toBe(`${START}pegado-con-clic${END}`);
    expect(got.length).toBeGreaterThan(0);
  });

  test('clic derecho con selección copia y no pega', async () => {
    await setClipboard(ctx.app, 'antes');
    await selectLine(ctx, 'sangría');
    const box = await termBox(ctx);
    await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await settle();
    expect(await getClipboard(ctx.app)).toBe('  sangría conservada');
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('seleccionar con el ratón y copiar', async () => {
    const box = await termBox(ctx);
    const cell = await ctx.page.evaluate((id) => {
      const t = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const dims = t._core._renderService.dimensions.css.cell;
      const buf = t.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        if (buf.getLine(i).translateToString(true).includes('LISTO')) return { w: dims.width, h: dims.height, row: i - buf.viewportY };
      }
      return null;
    }, ID);
    expect(cell).not.toBeNull();
    const y = box.y + (cell!.row + 0.5) * cell!.h;
    await ctx.page.mouse.move(box.x + 1, y);
    await ctx.page.mouse.down();
    await ctx.page.mouse.move(box.x + cell!.w * 5 - 1, y, { steps: 4 });
    await ctx.page.mouse.up();
    await ctx.page.keyboard.press('Control+C');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('LISTO');
  });

  test('después de pegar con clic derecho, la tecla siguiente llega a la terminal', async () => {
    await setClipboard(ctx.app, 'x');
    const box = await termBox(ctx);
    await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    await ctx.page.keyboard.type('enter');
    await ctx.page.keyboard.press('Enter');
    const got = await waitForSink(ctx.sinkFile, (b) => b.toString('utf8').endsWith('enter\r'), 3000);
    expect(got.toString('utf8')).toBe(`${START}x${END}enter\r`);
  });

  test('después de copiar con clic derecho, Ctrl+V sigue funcionando', async () => {
    await selectLine(ctx, 'sangría');
    const box = await termBox(ctx);
    await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await settle();
    await ctx.page.keyboard.press('Control+V');
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END), 3000);
    expect(got.toString('utf8')).toBe(`${START}  sangría conservada${END}`);
  });

  test('una selección de celdas vacías no bloquea Ctrl+C ni el clic derecho', async () => {
    const select = () =>
      ctx.page.evaluate((id) => {
        const t = (window as any).__hiloTest.terminals.debugEntry(id).term;
        t.select(t.cols - 5, t.rows - 1, 3);
        return t.hasSelection();
      }, ID);
    expect(await select()).toBe(true);
    await ctx.page.keyboard.press('Control+C');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0, 3000);
    expect(readSink(ctx.sinkFile).toString('hex')).toBe('03');
    clearSink(ctx.sinkFile);
    await setClipboard(ctx.app, 'y');
    await select();
    const box = await termBox(ctx);
    await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await waitForSink(ctx.sinkFile, (b) => b.includes(END), 3000);
    expect(readSink(ctx.sinkFile).toString('utf8')).toBe(`${START}y${END}`);
  });

  test('Shift+Insert pasa por el mismo filtro que Ctrl+V', async () => {
    await setClipboard(ctx.app, 'hola\x1b[201~\rcalc\r');
    await ctx.page.keyboard.press('Shift+Insert');
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END), 3000);
    const s = got.toString('utf8');
    expect(s).toBe(`${START}hola[201~\rcalc\r${END}`);
  });

  test('Ctrl+Insert copia limpio, sin espacios al final', async () => {
    await selectLine(ctx, 'con-espacios-al-final');
    await ctx.page.keyboard.press('Control+Insert');
    await settle();
    expect(await getClipboard(ctx.app)).toBe('con-espacios-al-final');
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('Alt+V no se intercepta: le llega ESC v a la aplicación', async () => {
    await setClipboard(ctx.app, 'no-debe-pegarse');
    await ctx.page.keyboard.press('Alt+V');
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('hex')).toBe('1b76');
  });

  test('los atajos de Claude Code llegan a la terminal', async () => {
    const cases: [string, string][] = [
      ['Control+T', '14'],
      ['Control+R', '12'],
      ['Control+O', '0f'],
      ['Control+K', '0b'],
      ['Control+P', '10'],
      ['Control+B', '02'],
      ['Control+L', '0c'],
      ['Control+U', '15'],
      ['Shift+Tab', '1b5b5a'],
      ['Escape', '1b'],
      ['Alt+P', '1b70'],
      ['Alt+T', '1b74'],
    ];
    for (const [key, hex] of cases) {
      clearSink(ctx.sinkFile);
      await ctx.page.keyboard.press(key);
      await waitForSink(ctx.sinkFile, (b) => b.length >= hex.length / 2, 3000);
      await settle(120);
      expect(readSink(ctx.sinkFile).toString('hex'), key).toBe(hex);
    }
  });

  test('escribir llega sin perderse y en orden', async () => {
    const text = 'Hola Mundo 123 ñandú';
    await ctx.page.keyboard.type(text, { delay: 2 });
    const got = await waitForSink(ctx.sinkFile, (b) => b.toString('utf8') === text, 5000);
    expect(got.toString('utf8')).toBe(text);
  });

  test('el buffer conserva lo escrito', async () => {
    expect(await bufferText(ctx.page, ID)).toContain('LISTO');
  });
});

test('sin bracketed paste activo no se agregan marcadores', async () => {
  const ctx = await launch({ state: makeState([{ id: ID, name: 'prueba' }]), sinkFlags: [] });
  try {
    await openSink(ctx.page, ID);
    // Sin el modo, cada salto se ejecutaría: se pide confirmación antes de mandar nada.
    await setClipboard(ctx.app, 'a\r\nb');
    await ctx.page.keyboard.press('Control+V');
    await expect(ctx.page.locator('.dialog h2')).toHaveText('Vas a pegar 2 líneas');
    expect(readSink(ctx.sinkFile).length).toBe(0);
    await ctx.page.locator('[data-confirm="ok"]').click();
    const got = await waitForSink(ctx.sinkFile, (b) => b.length >= 3);
    await settle();
    expect(got.toString('utf8')).toBe('a\rb');
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('clic derecho no le llega a una aplicación con seguimiento de ratón', async () => {
  const ctx = await launch({ state: makeState([{ id: ID, name: 'prueba' }]), sinkFlags: ['--bracket', '--mouse'] });
  try {
    await openSink(ctx.page, ID);
    clearSink(ctx.sinkFile);
    await setClipboard(ctx.app, 'pegado');
    const box = await ctx.page.locator('.term-host').first().boundingBox();
    await ctx.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' });
    await waitForSink(ctx.sinkFile, (b) => b.length > 0);
    await settle();
    expect(readSink(ctx.sinkFile).toString('utf8')).toBe(`${START}pegado${END}`);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

async function termBox(ctx: Launched) {
  const box = await ctx.page.locator('.term-host .xterm-screen').first().boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Selecciona una línea completa buscándola en el buffer, con la API de xterm. */
async function selectLine(ctx: Launched, needle: string): Promise<void> {
  await ctx.page.evaluate(
    ([id, text]) => {
      const t = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const buf = t.buffer.active;
      for (let i = 0; i < buf.length; i++) {
        if (buf.getLine(i).translateToString(true).includes(text)) {
          t.selectLines(i, i);
          return;
        }
      }
      throw new Error(`No está: ${text}`);
    },
    [ID, needle] as const,
  );
}

async function selectLines(ctx: Launched, from: string, to: string): Promise<void> {
  await ctx.page.evaluate(
    ([id, a, b]) => {
      const t = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const buf = t.buffer.active;
      let start = -1;
      let end = -1;
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i).translateToString(true);
        if (start < 0 && line.includes(a)) start = i;
        if (line.includes(b)) end = i;
      }
      t.selectLines(start, end);
    },
    [ID, from, to] as const,
  );
}

async function selectWrapped(ctx: Launched): Promise<void> {
  await ctx.page.evaluate((id) => {
    const t = (window as any).__hiloTest.terminals.debugEntry(id).term;
    const buf = t.buffer.active;
    let start = -1;
    let end = -1;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i).translateToString(true);
      if (start < 0 && line.includes('INICIO-')) start = i;
      if (line.includes('-FIN')) end = i;
    }
    if (start === end) throw new Error('La línea no se envolvió');
    t.selectLines(start, end);
  }, ID);
}
