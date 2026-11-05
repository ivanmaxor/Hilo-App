/**
 * Corre en Electron con los mismos conmutadores y la misma sesión que la app empaquetada, contra el GitHub real.
 * Solo lecturas públicas y archivos pequeños. Lo usa tests/e2e/updates-red.spec.ts.
 */
import { app, BrowserWindow, net, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyNetworkSwitches, hardenSession } from '../../src/main/security';
import { createUpdater } from '../../src/main/updater';
import { describeUpdateError, type UpdateMode } from '../../src/shared/updates';

const out = process.env.HILO_NET_OUT!;
const dir = process.env.HILO_NET_DIR!;
const mode: Extract<UpdateMode, { kind: 'github' }> = { kind: 'github' };
app.setPath('userData', dir);
applyNetworkSwitches(mode);

async function attempt(fn: () => Promise<Response>): Promise<string> {
  try {
    const r = await fn();
    return `HTTP ${r.status}`;
  } catch (e) {
    return String((e as Error).message);
  }
}

void app.whenReady().then(async () => {
  const report: Record<string, unknown> = {};
  try {
    hardenSession();
    const u = await createUpdater(mode, dir);
    u.forceDevUpdateConfig = true;
    const s = u.netSession;
    const hops: { host: string; status: number }[] = [];
    const sentHeaders = new Set<string>();
    s.webRequest.onCompleted((d) => hops.push({ host: new URL(d.url).hostname, status: d.statusCode }));
    s.webRequest.onSendHeaders((d) => {
      for (const name of Object.keys(d.requestHeaders)) sentHeaders.add(name.toLowerCase());
    });

    // 1. El repo de Hilo, con el origen que trae la app.
    try {
      const r = await u.checkForUpdates();
      report.hilo = { available: r?.isUpdateAvailable, version: r?.updateInfo.version };
    } catch (e) {
      report.hilo = { error: describeUpdateError(e) };
    }
    report.hiloHops = hops.splice(0);

    // 2. Un repo público que sí publica latest.yml: la cadena entera, con su redirección.
    u.setFeedURL({ provider: 'github', owner: 'laurent22', repo: 'joplin' });
    const r = await u.checkForUpdates();
    report.chain = { version: r?.updateInfo.version };
    report.chainHops = hops.splice(0);
    report.sentHeaders = [...sentHeaders].sort();

    // 3. Lo demás, desde la sesión del actualizador.
    const updaterFetch = (url: string) => attempt(() => s.fetch(url, { redirect: 'manual' }));
    report.blocked = {
      'https://example.com/': await updaterFetch('https://example.com/'),
      'http://github.com/': await updaterFetch('http://github.com/'),
      'https://api.github.com/': await updaterFetch('https://api.github.com/'),
      'https://objects.githubusercontent.com/': await updaterFetch('https://objects.githubusercontent.com/'),
      'https://github.com.example.com/': await updaterFetch('https://github.com.example.com/'),
      'https://gist.github.com/': await updaterFetch('https://gist.github.com/'),
    };
    report.allowed = await updaterFetch('https://github.com/robots.txt');

    // 4. La excepción de DNS es exacta: sin ningún filtro de webRequest, solo resuelven esos hosts.
    const bare = session.fromPartition('sin-filtro', { cache: false });
    report.dns = {
      'github.com': await attempt(() => bare.fetch('https://github.com/robots.txt', { redirect: 'manual' })),
      'example.com': await attempt(() => bare.fetch('https://example.com/')),
      'api.github.com': await attempt(() => bare.fetch('https://api.github.com/')),
    };

    // 5. El resto de la app: la sesión por defecto, también con una página sin CSP.
    report.defaultSession = await attempt(() => session.defaultSession.fetch('https://github.com/robots.txt'));
    report.netDefault = await attempt(() => net.fetch('https://github.com/robots.txt'));
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<title>x</title>');
    report.renderer = await win.webContents.executeJavaScript(`fetch('https://github.com/robots.txt', { mode: 'no-cors' }).then(() => 'llegó', (e) => String(e))`);
    report.updaterId = join(dir, '.updaterId');
  } catch (e) {
    report.fatal = String((e as Error).stack ?? e);
  }
  writeFileSync(out, JSON.stringify(report, null, 2));
  app.exit(0);
});
