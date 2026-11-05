import { expect, test, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, launch, makeState, pidAlive, ROOT, status, type Launched } from './helpers';

/**
 * Actualizaciones contra un servidor en esta máquina: nada sale a la red y nada se ejecuta.
 * El "instalador" son bytes al azar, y `spawnLog` se sustituye para ver con qué se lanzaría.
 */

const A = 'aaaaaaaa-3333-4000-8000-00000000000a';
const SHOTS = join(ROOT, 'test-results', 'updates');
mkdirSync(SHOTS, { recursive: true });

interface Feed {
  url: string;
  requests: { url: string; headers: IncomingHttpHeaders }[];
  /** Lo que devuelve cada ruta; se puede cambiar en medio de la prueba. */
  version: string;
  file: Buffer;
  /** sha512 que anuncia latest.yml. */
  sha512: string;
  fileUrl: string;
  redirectFile?: string;
  chunkDelay: number;
  close(): Promise<void>;
}

function sha512(b: Buffer): string {
  return createHash('sha512').update(b).digest('base64');
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

async function feedServer(version = '9.9.9'): Promise<Feed> {
  const file = randomBytes(2 * 1024 * 1024);
  const feed: Feed = {
    url: '',
    requests: [],
    version,
    file,
    sha512: sha512(file),
    fileUrl: `Hilo-Setup-${version}.exe`,
    chunkDelay: 40,
    close: () => closeServer(server),
  };
  const sendFile = async (res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': feed.file.length });
    // De a poco, para que se vea el progreso.
    for (let i = 0; i < feed.file.length; i += 256 * 1024) {
      res.write(feed.file.subarray(i, i + 256 * 1024));
      await new Promise((r) => setTimeout(r, feed.chunkDelay));
    }
    res.end();
  };
  const server = createServer((req, res) => {
    feed.requests.push({ url: req.url ?? '', headers: req.headers });
    const path = (req.url ?? '').split('?')[0]!;
    if (path === '/latest.yml') {
      res.writeHead(200, { 'content-type': 'text/yaml', 'set-cookie': 'rastreo=1' });
      res.end(`version: ${feed.version}\nfiles:\n  - url: ${feed.fileUrl}\n    sha512: ${feed.sha512}\n    size: ${feed.file.length}\npath: ${feed.fileUrl}\nsha512: ${feed.sha512}\nreleaseDate: '2026-11-04T00:00:00.000Z'\n`);
    } else if (path.endsWith('.exe')) {
      if (feed.redirectFile) {
        res.writeHead(302, { location: feed.redirectFile });
        res.end();
      } else void sendFile(res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  feed.url = await listen(server);
  return feed;
}

function tempCache(): string {
  return mkdtempSync(join(tmpdir(), 'hilo-e2e-cache-'));
}

async function launchWithFeed(feed: Feed | null, cache: string, state = makeState([{ id: A, name: 'Uno' }])): Promise<Launched> {
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  // LOCALAPPDATA: lo bajado va a una carpeta temporal, y no a la del Hilo instalado.
  return launch({ state, env: { LOCALAPPDATA: cache, ...(feed ? { HILO_TEST_UPDATE_FEED: feed.url } : {}) }, width: 1100, height: 720 });
}

const statusLine = (page: Page) => page.locator('[data-field="update-status"]');
const stateOf = (page: Page) => page.evaluate(() => (window as any).__hiloTest.view.get().update.state as string);

async function openUpdates(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__hiloTest.runCommand('settings'));
  await page.locator('.settings-nav button', { hasText: 'Actualizaciones' }).click();
  await expect(page.locator('[data-field="update-check"]')).toBeInViewport();
}

test('al abrir avisa sin bajar nada; bajar e instalar piden permiso y guardan todo antes de lanzar el instalador', async () => {
  test.setTimeout(150_000);
  const feed = await feedServer();
  const cache = tempCache();
  const state = makeState([{ id: A, name: 'Uno' }]);
  state.settings.startup = 'restore';
  state.ui.awake = [A];
  const run = await launchWithFeed(feed, cache, state);
  const marker = join(run.dataDir, 'instalador.json');
  let second: Launched | null = null;
  try {
    const { page, app } = run;
    await expect.poll(() => status(page, A), { timeout: 20_000 }).not.toBe('asleep');
    const pid = (await app.evaluate((_e, id) => (globalThis as any).__hilo.pidOf(id), A)) as number;
    expect(pid).toBeGreaterThan(0);

    // El aviso llega solo, no se lleva el foco y no baja el instalador.
    const toast = page.locator('.toast', { hasText: 'Hay una versión nueva de Hilo: 9.9.9' });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.activeElement?.closest('.toast') ?? null)).toBeNull();
    await page.waitForTimeout(500);
    expect(feed.requests.filter((r) => r.url.includes('.exe'))).toEqual([]);
    console.log('peticiones al abrir:', feed.requests.map((r) => r.url));
    expect(feed.requests.filter((r) => r.url.includes('latest.yml'))).toHaveLength(1);
    await page.screenshot({ path: join(SHOTS, 'aviso.png') });

    // "Ver" lleva a la sección, que dice qué hay.
    await toast.getByRole('button', { name: 'Ver' }).click();
    await expect(page.locator('[data-section="updates"] h3')).toBeInViewport();
    await expect(page.locator('[data-field="current-version"]')).toHaveText(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
    await expect(statusLine(page)).toContainText('Hay una versión nueva: 9.9.9');
    await page.screenshot({ path: join(SHOTS, 'hay-version.png') });

    // Baja, con progreso, y el botón dice lo que hace. electron-updater avisa del progreso una vez por segundo.
    feed.chunkDelay = 500;
    const seen: number[] = [];
    const watcher = setInterval(() => {
      void page
        .evaluate(() => (window as any).__hiloTest.view.get().update)
        .then((u: { state: string; percent?: number }) => {
          if (u.state === 'downloading' && u.percent !== undefined) seen.push(u.percent);
        })
        .catch(() => undefined);
    }, 30);
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(toast).toBeHidden();
    await expect.poll(() => seen.some((p) => p > 0 && p < 100), { timeout: 20_000 }).toBe(true);
    await page.screenshot({ path: join(SHOTS, 'bajando.png') });
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible({ timeout: 30_000 });
    clearInterval(watcher);
    console.log('porcentajes vistos:', [...new Set(seen)].join(', '));
    await expect(statusLine(page)).toContainText('La versión 9.9.9 está lista');
    await page.screenshot({ path: join(SHOTS, 'lista.png') });
    // Lo bajado, en la carpeta temporal y entero.
    const pending = join(cache, 'hilo-updater', 'pending', 'Hilo-Setup-9.9.9.exe');
    expect(sha512(readFileSync(pending))).toBe(feed.sha512);

    // Lo único sustituido: lanzar el proceso. El resto es el camino real de quitAndInstall.
    await app.evaluate((_e, file) => {
      const fs = (process as any).getBuiltinModule('node:fs');
      const hilo = (globalThis as any).__hilo;
      hilo.sessions.isWorking = () => true;
      hilo.updates.updater.spawnLog = async (cmd: string, args: string[]) => {
        fs.writeFileSync(file, JSON.stringify({ cmd, args, sessionsLive: hilo.sessions.live.size, state: JSON.parse(fs.readFileSync(`${process.env.HILO_DATA_DIR}/state.json`, 'utf8')).ui.awake }));
        return true;
      };
    }, marker);

    // Con sesiones trabajando avisa, y esperar no cierra nada.
    await page.getByRole('button', { name: 'Reiniciar e instalar' }).click();
    await expect(page.locator('[data-field="update-working"]')).toContainText('Hay sesiones trabajando');
    await page.screenshot({ path: join(SHOTS, 'trabajando.png') });
    await page.getByRole('button', { name: 'Esperar' }).click();
    expect(existsSync(marker)).toBe(false);
    expect(pidAlive(pid)).toBe(true);

    await page.getByRole('button', { name: 'Reiniciar e instalar' }).click();
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
    await page.getByRole('button', { name: 'Reiniciar de todos modos' }).click();
    await exited;

    const launched = JSON.parse(readFileSync(marker, 'utf8'));
    console.log('instalador:', launched);
    expect(launched.cmd).toBe(pending);
    expect(launched.args).toEqual(['--updated', '/S', '--force-run']);
    // Al lanzar el instalador ya no quedaba ninguna sesión, y lo guardado las recuerda.
    expect(launched.sessionsLive).toBe(0);
    expect(launched.state).toContain(A);
    expect(pidAlive(pid)).toBe(false);

    // Al volver, con sus sesiones. Sin feed: el "Hilo nuevo" no sale a ningún lado.
    second = await launch({ dataDir: run.dataDir, env: { LOCALAPPDATA: cache } });
    await expect.poll(() => status(second!.page, A), { timeout: 20_000 }).not.toBe('asleep');
  } finally {
    await second?.close();
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('sin instalador no se apaga nada; y si no arranca, Hilo se vuelve a abrir', async () => {
  const feed = await feedServer();
  const cache = tempCache();
  const state = makeState([{ id: A, name: 'Uno' }]);
  state.settings.startup = 'restore';
  state.ui.awake = [A];
  const run = await launchWithFeed(feed, cache, state);
  const marker = join(run.dataDir, 'reabrir.json');
  try {
    const { page, app } = run;
    await expect.poll(() => status(page, A), { timeout: 20_000 }).not.toBe('asleep');
    const pid = (await app.evaluate((_e, id) => (globalThis as any).__hilo.pidOf(id), A)) as number;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('available');
    await openUpdates(page);
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible({ timeout: 30_000 });

    // El archivo desapareció (un antivirus, por ejemplo): la sesión sigue viva y se dice.
    const pending = join(cache, 'hilo-updater', 'pending', 'Hilo-Setup-9.9.9.exe');
    const bytes = readFileSync(pending);
    rmSync(pending);
    await page.getByRole('button', { name: 'Reiniciar e instalar' }).click();
    await expect(statusLine(page)).toContainText('El archivo bajado ya no está');
    expect(pidAlive(pid)).toBe(true);

    // Vuelve a bajarlo, y esta vez el instalador no arranca.
    writeFileSync(pending, bytes);
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible({ timeout: 30_000 });
    await app.evaluate(({ app: electronApp }, file) => {
      const fs = (process as any).getBuiltinModule('node:fs');
      electronApp.relaunch = () => fs.writeFileSync(file, 'reabrir');
      const u = (globalThis as any).__hilo.updates.updater;
      u.doInstall = () => {
        u.dispatchError(new Error('no arrancó'));
        return false;
      };
    }, marker);
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
    await page.getByRole('button', { name: 'Reiniciar e instalar' }).click();
    await exited;
    expect(readFileSync(marker, 'utf8')).toBe('reabrir');
    expect(pidAlive(pid)).toBe(false);
    expect(JSON.parse(readFileSync(join(run.dataDir, 'state.json'), 'utf8')).ui.awake).toContain(A);
  } finally {
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('lo único que recibe el servidor: pedir archivos, sin identificador ni cookies', async () => {
  const feed = await feedServer();
  const cache = tempCache();
  const run = await launchWithFeed(feed, cache);
  try {
    const { page } = run;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('available');
    await openUpdates(page);
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible({ timeout: 30_000 });
    // latest.yml pone una cookie al responder: la descarga que sigue no la devuelve.
    const headers = feed.requests.map((r) => Object.keys(r.headers).sort().join(','));
    console.log('cabeceras:', [...new Set(headers)]);
    for (const r of feed.requests) {
      expect(r.headers['x-user-staging-id']).toBeUndefined();
      expect(r.headers.cookie).toBeUndefined();
      expect(r.headers.authorization).toBeUndefined();
      expect(r.url).not.toMatch(/\?.*(id|user)=/i);
    }
    expect(existsSync(join(run.dataDir, '.updaterId'))).toBe(false);
    expect(readdirSync(run.dataDir)).not.toContain('.updaterId');
  } finally {
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('con el interruptor apagado no sale nada al abrir; el botón busca igual, y se recuerda', async () => {
  const feed = await feedServer(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  const cache = tempCache();
  const state = makeState([{ id: A, name: 'Uno' }]);
  state.settings.checkUpdatesOnStart = false;
  const run = await launchWithFeed(feed, cache, state);
  let second: Launched | null = null;
  try {
    const { page } = run;
    await page.waitForTimeout(2500);
    expect(feed.requests).toEqual([]);
    expect(await stateOf(page)).toBe('idle');
    await openUpdates(page);
    await expect(page.locator('[data-field="check-updates"]')).not.toBeChecked();
    await page.screenshot({ path: join(SHOTS, 'apagado.png') });
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await expect(statusLine(page)).toContainText('Estás al día');
    await page.screenshot({ path: join(SHOTS, 'al-dia.png') });
    expect(feed.requests.filter((r) => r.url.includes('latest.yml'))).toHaveLength(1);

    await run.close();
    const before = feed.requests.length;
    second = await launch({ dataDir: run.dataDir, env: { LOCALAPPDATA: cache, HILO_TEST_UPDATE_FEED: feed.url } });
    await second.page.waitForTimeout(2000);
    expect((await second.page.evaluate(() => (window as any).__hiloTest.app.get().state.settings)).checkUpdatesOnStart).toBe(false);
    expect(feed.requests.length).toBe(before);

    // Encenderlo vale desde la próxima vez que se abra, una sola vez.
    await openUpdates(second.page);
    await second.page.locator('[data-field="check-updates"]').check();
    await second.page.waitForTimeout(200);
    await second.close();
    second = await launch({ dataDir: run.dataDir, env: { LOCALAPPDATA: cache, HILO_TEST_UPDATE_FEED: feed.url } });
    await expect.poll(() => feed.requests.filter((r) => r.url.includes('latest.yml')).length, { timeout: 15_000 }).toBe(2);
    await second.page.waitForTimeout(1500);
    expect(feed.requests.filter((r) => r.url.includes('latest.yml'))).toHaveLength(2);
  } finally {
    await second?.close();
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('no ofrece ni la misma versión, ni una vieja, ni una prerrelease', async () => {
  const feed = await feedServer('0.0.1');
  const cache = tempCache();
  const run = await launchWithFeed(feed, cache);
  try {
    const { page } = run;
    await openUpdates(page);
    for (const version of ['0.0.1', '9.9.9-beta.1', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string]) {
      feed.version = version;
      await page.waitForFunction(() => (window as any).__hiloTest.view.get().update.state !== 'checking');
      await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
      await expect(statusLine(page)).toHaveAttribute('data-state', 'current');
      expect(await page.getByRole('button', { name: /Bajar la versión/ }).count()).toBe(0);
    }
  } finally {
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('una redirección o un archivo fuera del origen se bloquean: el otro servidor no recibe nada', async () => {
  test.setTimeout(120_000);
  const feed = await feedServer();
  const cache = tempCache();
  let otherHits = 0;
  const other = createServer((_req, res) => {
    otherHits++;
    res.writeHead(200);
    res.end('malo');
  });
  const otherUrl = await listen(other);
  const run = await launchWithFeed(feed, cache);
  try {
    const { page } = run;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('available');
    await openUpdates(page);

    // Redirección a otro puerto, a https de otro host, y archivo con URL absoluta.
    const attempts: [string, () => void][] = [
      ['redirección a otro servidor', () => (feed.redirectFile = `${otherUrl}Hilo-Setup-9.9.9.exe`)],
      ['redirección a https externo', () => (feed.redirectFile = 'https://example.com/Hilo-Setup-9.9.9.exe')],
    ];
    for (const [name, arrange] of attempts) {
      arrange();
      const retry = page.getByRole('button', { name: 'Reintentar la descarga' });
      if (await retry.count()) await retry.click();
      else await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
      await expect(statusLine(page), name).toHaveAttribute('data-state', 'error', { timeout: 20_000 });
      await expect(statusLine(page), name).toContainText('Hilo la bloqueó');
      await expect(page.getByRole('button', { name: 'Abrir la página de versiones' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toHaveCount(0);
    }
    await page.screenshot({ path: join(SHOTS, 'bloqueado.png') });

    feed.redirectFile = undefined;
    feed.fileUrl = `${otherUrl}Hilo-Setup-9.9.9.exe`;
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(statusLine(page)).toContainText('Hilo la bloqueó', { timeout: 20_000 });

    expect(otherHits).toBe(0);
  } finally {
    await run.close();
    await feed.close();
    await closeServer(other);
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('un archivo alterado se descarta y no se ofrece instalarlo; volver a bajarlo funciona', async () => {
  test.setTimeout(120_000);
  const feed = await feedServer();
  const cache = tempCache();
  const good = feed.sha512;
  feed.sha512 = sha512(randomBytes(16));
  const run = await launchWithFeed(feed, cache);
  try {
    const { page } = run;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('available');
    await openUpdates(page);
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(statusLine(page)).toContainText('no coincide con el publicado', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toHaveCount(0);
    const pending = join(cache, 'hilo-updater', 'pending');
    const left = existsSync(pending) ? readdirSync(pending).filter((f) => f.endsWith('.exe')) : [];
    console.log('quedó en pending tras el fallo:', left);
    expect(left).toEqual([]);
    await page.screenshot({ path: join(SHOTS, 'alterado.png') });

    // El archivo bueno, volviendo a buscar: la información de la versión se lee de nuevo.
    feed.sha512 = good;
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await page.getByRole('button', { name: 'Bajar la versión 9.9.9' }).click();
    await expect(page.getByRole('button', { name: 'Reiniciar e instalar' })).toBeVisible({ timeout: 30_000 });
  } finally {
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('sin conexión: mensaje útil, al abrir no molesta, y el botón vuelve a intentar', async () => {
  const feed = await feedServer();
  const url = feed.url;
  await feed.close();
  const cache = tempCache();
  const state = makeState([{ id: A, name: 'Uno' }]);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  const run = await launch({ state, env: { LOCALAPPDATA: cache, HILO_TEST_UPDATE_FEED: url }, width: 1100, height: 720 });
  try {
    const { page } = run;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('error');
    await expect(page.locator('.toast')).toHaveCount(0);
    await openUpdates(page);
    await expect(statusLine(page)).toContainText('No se pudo conectar con GitHub');
    await page.screenshot({ path: join(SHOTS, 'sin-red.png') });
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await expect(statusLine(page)).toContainText('No se pudo conectar con GitHub');
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('el renderer sigue sin red, aunque el servidor del actualizador esté permitido', async () => {
  const feed = await feedServer();
  const cache = tempCache();
  const run = await launchWithFeed(feed, cache);
  try {
    const { page, app } = run;
    await expect.poll(() => stateOf(page), { timeout: 20_000 }).toBe('available');
    const before = feed.requests.length;
    const fromPage = await page.evaluate(async (url) => {
      try {
        await fetch(`${url}latest.yml`, { mode: 'no-cors' });
        return 'llegó';
      } catch (e) {
        return String(e);
      }
    }, feed.url);
    console.log('fetch desde la página:', fromPage);
    expect(fromPage).not.toBe('llegó');
    // Sin la CSP de por medio: la sesión por defecto también lo corta.
    const fromDefault = await app.evaluate(async ({ session }, url) => {
      try {
        await session.defaultSession.fetch(`${url}latest.yml`);
        return 'llegó';
      } catch (e) {
        return String(e);
      }
    }, feed.url);
    console.log('fetch desde la sesión por defecto:', fromDefault);
    expect(fromDefault).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(feed.requests.length).toBe(before);
  } finally {
    await run.close();
    await feed.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('sin empaquetar y sin servidor de prueba, no hay nada que busque', async () => {
  const cache = tempCache();
  const run = await launchWithFeed(null, cache);
  try {
    const { page, app } = run;
    await page.waitForTimeout(1500);
    expect(await stateOf(page)).toBe('off');
    await openUpdates(page);
    await expect(statusLine(page)).toContainText('no se conecta a nada');
    await expect(page.locator('[data-field="update-check"]')).toBeDisabled();
    await page.evaluate(() => (window as any).hilo.updateCheck());
    expect(await stateOf(page)).toBe('off');
    // electron-updater ni se llegó a cargar.
    expect(await app.evaluate(() => (globalThis as any).__hilo.updates.updater)).toBeFalsy();
    await page.screenshot({ path: join(SHOTS, 'desarrollo.png') });
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});

test('un feed de prueba que no sea de esta máquina no se acepta', async () => {
  const cache = tempCache();
  const state = makeState([{ id: A, name: 'Uno' }]);
  const run = await launch({ state, env: { LOCALAPPDATA: cache, HILO_TEST_UPDATE_FEED: 'https://example.com/' } });
  try {
    expect(await stateOf(run.page)).toBe('off');
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(cache, { recursive: true, force: true });
  }
});
