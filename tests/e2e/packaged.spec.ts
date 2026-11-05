import { chromium, expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeState, newDataDir, pidAlive, processTree, ROOT, settle } from './helpers';

/**
 * Sobre el ejecutable empaquetado o instalado: HILO_PACKAGED_EXE=ruta a Hilo.exe
 * Con los fusibles de Electron puestos no se puede usar _electron; se entra por CDP.
 */
const EXE = process.env.HILO_PACKAGED_EXE;

/** Con la lista de hosts de verdad y el GitHub real: solo lecturas públicas. HILO_E2E_RED=1 además de HILO_PACKAGED_EXE. */
test('la app empaquetada busca en GitHub, solo con los hosts permitidos', async () => {
  test.skip(!EXE || !process.env.HILO_E2E_RED, 'Definir HILO_PACKAGED_EXE y HILO_E2E_RED=1: sale a internet');
  test.setTimeout(120_000);
  const dataDir = newDataDir();
  const id = 'aaaaaaaa-0000-4000-8000-000000000002';
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(makeState([{ id, name: 'Empaquetada' }])));
  const netlog = join(dataDir, 'net.json');
  const port = 9378;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HILO_E2E: '1',
    HILO_DATA_DIR: dataDir,
    HILO_TEST_HIDDEN: '1',
    HILO_TEST_CLIPBOARD: 'memory',
    HILO_TEST_UPDATE_REAL: '1',
    // Lo que se bajara iría aquí, y no a la carpeta del Hilo instalado.
    LOCALAPPDATA: dataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE!, [`--remote-debugging-port=${port}`, `--log-net-log=${netlog}`], { env, stdio: 'ignore' });
  try {
    let browser = null;
    for (let i = 0; i < 40 && !browser; i++) {
      await settle(500);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    }
    expect(browser).not.toBeNull();
    const page = browser!.contexts()[0]!.pages()[0]!;
    await page.waitForFunction(() => !!(window as any).__hiloTest, undefined, { timeout: 20_000 });
    // La búsqueda al abrir sale sola, a los pocos segundos.
    await page.waitForFunction(() => !['idle', 'checking'].includes((window as any).__hiloTest.view.get().update.state), undefined, { timeout: 40_000 });
    const update = await page.evaluate(() => (window as any).__hiloTest.view.get().update);
    console.log('resultado de la búsqueda:', update);
    expect(update.state).not.toBe('off');
    // Mientras el repo no tenga versiones responde eso; después, una versión o "al día".
    if (update.state === 'error') expect(update.message).toContain('Todavía no hay versiones');
    const fetched = await page.evaluate(() =>
      fetch('https://github.com/robots.txt').then(
        () => 'llegó',
        (e) => String(e),
      ),
    );
    console.log('fetch desde la página:', fetched);
    expect(fetched).not.toBe('llegó');
    await browser!.close();
    child.kill();
    await settle(4000);

    const log = readFileSync(netlog, 'utf8');
    const urls = [...new Set([...log.matchAll(/"(?:https?|wss?):\/\/([^"/:]+)[^"]*"/g)].map((m) => m[1]))];
    console.log('hosts en el registro de red:', urls);
    expect(urls.length).toBeGreaterThan(0);
    for (const host of urls) expect(['github.com', 'release-assets.githubusercontent.com']).toContain(host);
    expect(log).not.toContain('wpad');
    expect(existsSync(join(dataDir, '.updaterId'))).toBe(false);
  } finally {
    if (child.pid && pidAlive(child.pid)) child.kill();
    await settle(1000);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('la app empaquetada arranca, pega, y no deja procesos', async () => {
  test.skip(!EXE, 'Definir HILO_PACKAGED_EXE');
  test.setTimeout(120_000);
  const dataDir = newDataDir();
  const sink = join(dataDir, 'sink.bin');
  const id = 'aaaaaaaa-0000-4000-8000-000000000001';
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(makeState([{ id, name: 'Empaquetada' }])));
  const netlog = join(dataDir, 'net.json');
  const port = 9377;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HILO_E2E: '1',
    HILO_DATA_DIR: dataDir,
    HILO_TEST_HIDDEN: '1',
    HILO_TEST_CLIPBOARD: 'memory',
    HILO_TEST_SHELL: JSON.stringify([process.execPath, join(ROOT, 'tests', 'fixtures', 'sink.cjs'), sink, '--bracket']),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE!, [`--remote-debugging-port=${port}`, `--log-net-log=${netlog}`], { env, stdio: 'ignore' });
  try {
    let browser = null;
    for (let i = 0; i < 40 && !browser; i++) {
      await settle(500);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
    }
    expect(browser).not.toBeNull();
    const page = browser!.contexts()[0]!.pages()[0]!;
    await page.waitForFunction(() => !!(window as any).__hiloTest, undefined, { timeout: 20_000 });
    await expect(page.locator('.row .name', { hasText: 'Empaquetada' })).toBeVisible();

    // La fuente empaquetada carga por el protocolo propio.
    const fontOk = await page.evaluate(async () => {
      await document.fonts.load('16px "Hilo Mono"');
      return document.fonts.check('16px "Hilo Mono"');
    });
    expect(fontOk).toBe(true);

    await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
    await page.waitForFunction(
      (sid) => {
        const e = (window as any).__hiloTest.terminals.debugEntry(sid);
        if (!e) return false;
        const b = e.term.buffer.active;
        for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString(true).includes('LISTO')) return true;
        return false;
      },
      id,
      { timeout: 30_000 },
    );
    await page.evaluate((sid) => (window as any).__hiloTest.terminals.focus(sid), id);
    await settle(300);
    await page.keyboard.type('hola ñandú', { delay: 2 });
    await settle(800);
    expect(readFileSync(sink).toString('utf8')).toBe('hola ñandú');

    // Toda navegación externa está bloqueada, y nada de la página llega a la red.
    const blocked = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);

    const tree = processTree(child.pid!);
    expect(tree.some((p) => p.name === 'OpenConsole.exe')).toBe(true);

    await browser!.close();
    await settle(500);
    // Cierre normal: WM_CLOSE a la ventana.
    child.kill();
    await settle(5000);
    const alive = tree.filter((p) => pidAlive(p.pid));
    expect(alive, JSON.stringify(alive)).toEqual([]);

    // Registro de red de Chromium: ni una conexión a Internet. Se revisa si se escribió.
    let urls: string[] = [];
    try {
      const log = readFileSync(netlog, 'utf8');
      urls = [...new Set([...log.matchAll(/"(https?|wss?):\/\/[^"]+"/g)].map((m) => m[0]))];
    } catch {
      urls = ['sin registro'];
    }
    console.log('URLs en el registro de red:', urls);
    expect(urls).toEqual([]);
    // Ni siquiera la búsqueda de proxy: WPAD resolvería un nombre y descargaría un PAC.
    const log = readFileSync(netlog, 'utf8');
    expect(log).not.toContain('wpad');
    expect(log).not.toContain('"host":');
  } finally {
    if (child.pid && pidAlive(child.pid)) child.kill();
    await settle(1000);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
});
