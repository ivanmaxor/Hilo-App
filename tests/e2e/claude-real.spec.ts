import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { bufferText, cleanup, focusTerm, launch, makeState, newDataDir, pidAlive, processTree, ROOT, settle, status, waitForText, waitStatus } from './helpers';

/**
 * Con la configuración real del usuario: sus hooks globales, su modo de permisos.
 * Reproduce el sonido de su hook Stop, por eso va aparte.
 */
test.describe('Claude real con la configuración del usuario', () => {
  test.skip(process.env.HILO_E2E_CLAUDE_REAL !== '1', 'Definir HILO_E2E_CLAUDE_REAL=1');
  test.setTimeout(300_000);

  test('pregunta, verde sin esperar a los hooks, procesos en segundo plano, cerrar con confirmación', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const ctx = await launch({
      dataDir,
      state: makeState([{ id: a, kind: 'claude', name: 'Config real' }], TRUSTED),
      claudeArgs: ['--model', 'haiku', '--effort', 'low'],
    });
    try {
      const { page, app } = ctx;
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 60_000);

      // Una pregunta: amarillo, también sin prompts de permisos.
      await send(page, a, 'usa la herramienta AskUserQuestion para preguntarme si o no, sin hacer nada mas');
      await waitStatus(page, a, 'waiting', 90_000);
      await focusTerm(page, a);
      await page.keyboard.press('Escape');
      await waitStatus(page, a, ['idle', 'done'], 15_000);
      await settle(1500);

      // Un turno normal: el verde llega con el hook de Hilo, sin esperar los del usuario.
      await app.evaluate(() => (globalThis as any).__hilo.focus(false));
      await send(page, a, 'responde solo OK');
      await waitStatus(page, a, 'working', 30_000);
      await waitStatus(page, a, 'done', 90_000);
      const events = readFileSync(join(dataDir, 'hooks', `${a}.events`), 'utf8');
      console.log('Eventos de hook:', events.replace(/\s+/g, ' '));
      expect(events).toContain('Stop');
      expect(events).toContain('UserPromptSubmit');
      expect(events).toContain('AskUserQuestion');
      // Sigue en verde mientras los hooks del usuario terminan.
      await settle(8000);
      expect(await status(page, a)).toBe('done');
      await app.evaluate(() => (globalThis as any).__hilo.focus(true));
      await waitStatus(page, a, 'idle', 5000);

      // Proceso en segundo plano: dormir avisa y lo mata.
      await send(page, a, 'usa Bash con run_in_background true para ejecutar exactamente: node -e "setInterval(()=>{},1000)" y luego responde solo LISTO');
      await waitStatus(page, a, 'working', 30_000);
      await waitStatus(page, a, ['done', 'idle'], 120_000);
      await settle(1000);
      const pid = await app.evaluate((_e, id) => (globalThis as any).__hilo.pidOf(id), a);
      const tree = processTree(pid);
      console.log('Árbol:', tree.map((p) => p.name).join(', '));
      expect(tree.filter((p) => p.name.toLowerCase() === 'node.exe').length).toBeGreaterThan(0);
      const sleeping = page.evaluate((id) => (window as any).__hiloTest.sleepSession(id), a);
      await expect(page.locator('.dialog h2')).toHaveText('Dormir esta sesión cierra sus procesos', { timeout: 15_000 });
      await expect(page.locator('.proc-list')).toContainText('node.exe');
      await page.screenshot({ path: join(ROOT, 'test-results', 'capturas', 'aviso-procesos.png') });
      await page.locator('[data-confirm="ok"]').click();
      await sleeping;
      await waitStatus(page, a, 'asleep', 15_000);
      await settle(1000);
      for (const p of tree) expect(pidAlive(p.pid), p.name).toBe(false);

      // Cerrar mientras trabaja pide confirmación.
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await waitStatus(page, a, 'idle', 60_000);
      await send(page, a, 'cuenta del 1 al 40 en palabras, una por linea');
      await waitStatus(page, a, 'working', 30_000);
      await page.keyboard.press('Control+Shift+W');
      await expect(page.locator('.dialog h2')).toContainText('está trabajando');
      await page.keyboard.press('Escape');
      await expect(page.locator(`.row[data-session="${a}"]`)).toBeVisible();
      // Dormir mientras trabaja no se hace.
      await page.keyboard.press('Control+Shift+Z');
      await expect(page.locator('.toast')).toContainText('está trabajando');
      expect(await status(page, a)).toBe('working');
      await waitStatus(page, a, ['done', 'idle'], 120_000);
      await page.screenshot({ path: join(ROOT, 'test-results', 'capturas', 'claude-real.png') });
    } finally {
      await ctx.close();
      cleanup(dataDir);
    }
  });
});

async function writePng(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    // PNG de 1x1.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
}

test.describe('portapapeles real', () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1');
  test.setTimeout(120_000);

  test('imagen con Alt+V y con Ctrl+V; el portapapeles del usuario queda como estaba', async () => {
    const dataDir = newDataDir();
    const a = uuid();
    const ctx = await launch({
      dataDir,
      realClipboard: true,
      state: makeState([{ id: a, kind: 'claude', name: 'Imagen' }], TRUSTED),
      claudeArgs: CLAUDE_ARGS,
    });
    const { page, app } = ctx;
    // Guarda lo que haya, sea lo que sea.
    // Primero se comprueba que se puede restaurar: si no, la prueba no toca nada.
    const before = await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const items = await clipboard.read();
      const copies = [];
      for (const item of items) {
        const data: Record<string, Blob> = {};
        for (const type of item.types) {
          if (type.startsWith('electron application/')) continue;
          data[type] = (await item.getType(type)) as Blob;
        }
        if (Object.keys(data).length) copies.push(new ClipboardItem(data));
      }
      (globalThis as any).__saved = copies;
      const text = await clipboard.readText();
      (globalThis as any).__savedText = text;
      if (copies.length) await clipboard.write(copies);
      const again = await clipboard.readText();
      if (again !== text) throw new Error('No se pudo restaurar el portapapeles: la prueba no continúa');
      return { items: items.length, types: items.flatMap((i) => i.types), length: text.length };
    });
    console.log('Portapapeles antes:', JSON.stringify(before));
    try {
      await page.evaluate((id) => (window as any).__hiloTest.selectSession(id), a);
      await acceptTrustIfNeeded(page, a);
      await waitStatus(page, a, 'idle', 30_000);
      await focusTerm(page, a);

      // Texto real: copiar y pegar por el portapapeles de Windows.
      await app.evaluate(({ clipboard }) => clipboard.writeText('prueba-portapapeles-real'));
      await page.keyboard.press('Control+V');
      await waitForText(page, a, 'prueba-portapapeles-real', 10_000);
      await page.keyboard.press('Control+U');
      await settle(500);

      // Imagen. Alt+V lo resuelve Claude leyendo el portapapeles. Nunca se manda Enter.
      await writePng(app);
      await page.keyboard.press('Alt+V');
      await waitForText(page, a, '[Image #1]', 20_000);
      expect(await status(page, a)).toBe('idle');

      // Con solo imagen en el portapapeles, Ctrl+V hace lo mismo.
      await page.keyboard.press('Control+V');
      await waitForText(page, a, '[Image #2]', 20_000);
      expect(await status(page, a)).toBe('idle');
      console.log((await bufferText(page, a)).split('\n').filter(Boolean).slice(-6).join('\n'));

      // Se descarta sin enviarle nada al modelo.
      await page.keyboard.press('Control+C');
      await settle(500);
    } finally {
      const restored = await app.evaluate(async ({ clipboard }) => {
        const saved = (globalThis as any).__saved;
        if (saved?.length) await clipboard.write(saved);
        else clipboard.clear();
        return (await clipboard.readText()) === (globalThis as any).__savedText;
      });
      console.log('Portapapeles restaurado:', restored);
      expect(restored).toBe(true);
      await ctx.close();
      cleanup(dataDir);
    }
  });
});
