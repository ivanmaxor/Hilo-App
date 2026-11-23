import { expect, test } from '@playwright/test';
import { cleanup, launch, makeState, newDataDir } from './helpers';

/**
 * Cerrar la sesión con el foco en la terminal no debe retener el Terminal de xterm.
 * addon-webgl deja vivo su temporizador de parpadeo si se descarga con el foco puesto.
 */
test('cerrar con el foco en la terminal libera la terminal', async () => {
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
  const state = makeState(ids.map((id, i) => ({ id, kind: 'shell', name: `S${i}` })));
  state.settings.startup = 'wakeAll';
  const dataDir = newDataDir();
  const { app, page } = await launch({ dataDir, state });
  try {
    await expect.poll(() => page.evaluate((id) => !!(window as any).__hiloTest.terminals.debugEntry(id), ids[6]), { timeout: 30_000 }).toBe(true);
    await page.evaluate((id) => {
      const term = (window as any).__hiloTest.terminals.debugEntry(id).term;
      (window as any).__TermProto = Object.getPrototypeOf(term);
    }, ids[0]);
    const cdp = await page.context().newCDPSession(page);
    const liveTerminals = async (): Promise<number> => {
      await cdp.send('HeapProfiler.collectGarbage');
      await new Promise((r) => setTimeout(r, 300));
      await cdp.send('HeapProfiler.collectGarbage');
      const proto = await cdp.send('Runtime.evaluate', { expression: 'window.__TermProto' });
      const found = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId! });
      const count = await cdp.send('Runtime.callFunctionOn', { objectId: found.objects.objectId!, functionDeclaration: 'function(){return this.length}', returnByValue: true });
      // Sin soltarlos, estos resultados retendrían las terminales que se quieren medir.
      await cdp.send('Runtime.releaseObject', { objectId: found.objects.objectId! });
      await cdp.send('Runtime.releaseObject', { objectId: proto.result.objectId! });
      return count.result.value as number;
    };
    const before = await liveTerminals();
    expect(before).toBe(ids.length);

    const CLOSE_DOUBLE_PRESS_MS = 800;
    let lastClosePress = 0;
    for (const id of ids.slice(0, 5)) {
      await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
      await page.waitForTimeout(250);
      await page.evaluate((sid) => (window as any).__hiloTest.terminals.focus(sid), id);
      await page.waitForTimeout(100);
      // El atajo de cerrar ignora una pulsación que llega antes de 800 ms de la anterior (CLOSE_DOUBLE_PRESS_MS en
      // controller.ts): así una tecla mantenida no cierra varias sesiones. Esta prueba pulsaba el atajo unos 450 a
      // 700 ms después de la vuelta anterior: si esa sesión se había cerrado rápido, la pulsación se descartaba sin
      // abrir diálogo ni aviso y la sesión nunca se cerraba (#3, visto en el diagnóstico de abajo).
      const wait = CLOSE_DOUBLE_PRESS_MS + 100 - (Date.now() - lastClosePress);
      if (wait > 0) await page.waitForTimeout(wait);
      lastClosePress = Date.now();
      await page.keyboard.press('Control+Shift+W');
      // Si aun así no se cierra, deja el estado de la app a la vista: es lo que falta para entender la falla.
      const diagnostico = () =>
        page
          .evaluate((sid) => {
            const t = (window as any).__hiloTest;
            const v = t.view.get();
            const a = t.app.get();
            return JSON.stringify({
              vuelta: sid,
              activa: a.state.ui.activeSessionId,
              estado: a.runtime[sid]?.status,
              terminalViva: !!t.terminals.debugEntry(sid),
              dialogo: v.modal?.type ?? null,
              cerrando: v.closing,
              ocupadas: v.busy,
              avisos: v.toasts.map((x: any) => x.text),
              foco: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : null,
              sesiones: a.state.projects[0].sessions.length,
            });
          }, id)
          .catch((e) => `sin diagnóstico: ${String(e)}`);
      await expect
        .poll(
          async () => {
            const confirm = page.locator('.dialog [data-confirm="ok"]');
            if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => undefined);
            return page.evaluate((sid) => !(window as any).__hiloTest.terminals.debugEntry(sid), id);
          },
          { timeout: 25_000 },
        )
        .toBe(true)
        .catch(async (error) => {
          console.log('DIAGNÓSTICO al fallar:', await diagnostico());
          throw error;
        });
    }
    // Las entradas siguen en el controlador solo mientras viven: las 5 cerradas no deben quedar en memoria.
    await page.waitForTimeout(800);
    expect(await liveTerminals()).toBe(ids.length - 5);
    expect(await page.evaluate(() => (window as any).__hiloTest.terminals.debugGlCount())).toBeLessThanOrEqual(1);
  } finally {
    await app.close().catch(() => undefined);
    cleanup(dataDir);
  }
});

/**
 * El conpty.node original moría con 0xC0000005 cuando salían dos procesos a la vez.
 * Tres rondas: cerrar todas en el mismo instante, y que todas salgan solas a la vez.
 */
test('cerrar varias sesiones a la vez no tumba la app', async () => {
  for (let round = 0; round < 3; round++) {
    const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
    const state = makeState(ids.map((id, i) => ({ id, kind: 'shell', name: `S${i}` })));
    state.settings.startup = 'wakeAll';
    const dataDir = newDataDir();
    const { app, page } = await launch({ dataDir, state });
    let crashed: number | null = null;
    app.process().on('exit', (code) => {
      crashed = code;
    });
    try {
      await expect.poll(() => page.evaluate((id) => !!(window as any).__hiloTest.terminals.debugEntry(id), ids[7]), { timeout: 30_000 }).toBe(true);
      await page.waitForTimeout(1500);
      await page.evaluate((list) => Promise.all(list.map((id) => (window as any).__hiloTest.closeSession(id))), ids.slice(0, 7));
      await page.waitForTimeout(3000);
      expect(crashed).toBeNull();
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    } finally {
      await app.close().catch(() => undefined);
      cleanup(dataDir);
    }
  }
});

test('el ícono de trabajando no tiene animación CSS que obligue a repintar', async () => {
  const dataDir = newDataDir();
  const { app, page } = await launch({ dataDir, state: makeState([]) });
  try {
    const animated = await page.evaluate(() => {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      probe.setAttribute('class', 'st-half');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.appendChild(probe);
      document.body.appendChild(svg);
      const name = getComputedStyle(probe).animationName;
      svg.remove();
      return name;
    });
    expect(animated).toBe('none');
  } finally {
    await app.close().catch(() => undefined);
    cleanup(dataDir);
  }
});
