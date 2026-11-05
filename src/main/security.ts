import { app, Menu, protocol, session, shell, type Session, type WebContents } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { isAllowedUpdateUrl, resolverRules, type UpdateMode } from '../shared/updates';

export const APP_ORIGIN = 'hilo://app';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // xterm.js inyecta estilos en línea para medir y posicionar.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Tiene que correr antes de `app.ready`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'hilo', privileges: { standard: true, secure: true, codeCache: true } }]);
}

/** Sirve solo archivos de la carpeta del renderer, con CSP estricta. */
export function serveRenderer(rendererDir: string): void {
  const root = normalize(rendererDir + sep);
  protocol.handle('hilo', async (request) => {
    const url = new URL(request.url);
    const refuse = (status: number) => new Response(null, { status, headers: { 'content-security-policy': CSP } });
    if (url.host !== 'app') return refuse(404);
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return refuse(400);
    }
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) return refuse(403);
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return refuse(404);
    }
  });
}

/** Se corta toda petición que no sea local, y lo que hace Chromium por su cuenta. La única salida es la del actualizador (D19). */
export function applyNetworkSwitches(updates: UpdateMode): void {
  const c = app.commandLine;
  // Sin esto Chromium busca un proxy por WPAD al arrancar, y webRequest no lo ve.
  // Se queda también con actualizaciones: tras un proxy obligatorio no se puede buscar versión, y se avisa (D19).
  c.appendSwitch('no-proxy-server');
  c.appendSwitch('disable-background-networking');
  c.appendSwitch('disable-component-update');
  c.appendSwitch('disable-domain-reliability');
  c.appendSwitch('disable-sync');
  c.appendSwitch('disable-breakpad');
  c.appendSwitch('disable-client-side-phishing-detection');
  c.appendSwitch('no-pings');
  c.appendSwitch('dns-prefetch-disable');
  // Ninguna resolución de nombres sale de Chromium, salvo los hosts del actualizador. Abrir un enlace va por el navegador del sistema.
  c.appendSwitch('host-resolver-rules', resolverRules(updates));
  c.appendSwitch('disable-features', 'AutofillServerCommunication,OptimizationHints,MediaRouter,Translate,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,DialMediaRouteProvider,NetworkTimeServiceQuerying');
  // Sin caché en disco: no hay nada remoto que guardar.
  c.appendSwitch('disk-cache-size', '1');
  c.appendSwitch('media-cache-size', '1');
}

export function hardenSession(): void {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  s.setSpellCheckerEnabled(false);
  s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = /^(hilo|data|blob|devtools):/i.test(details.url);
    if (!allowed) console.error('[seguridad] petición bloqueada:', details.url);
    callback({ cancel: !allowed });
  });
}

/** Lo que no hace falta para pedir un archivo. `x-user-staging-id` es un identificador persistente de electron-updater. */
const DROPPED_UPDATE_HEADERS = new Set(['x-user-staging-id', 'cookie']);

/** La sesión propia de electron-updater: solo la lista de hosts, también tras una redirección. */
export function hardenUpdaterSession(s: Session, mode: UpdateMode): void {
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  s.setSpellCheckerEnabled(false);
  s.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = isAllowedUpdateUrl(details.url, mode);
    if (!allowed) console.error('[seguridad] actualizador, petición bloqueada:', details.url);
    callback({ cancel: !allowed });
  });
  s.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.requestHeaders)) {
      if (!DROPPED_UPDATE_HEADERS.has(name.toLowerCase())) requestHeaders[name] = value;
    }
    callback({ requestHeaders });
  });
}

export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  // about:blank no pasa por will-navigate.
  contents.on('did-navigate', (_event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) void contents.loadURL(`${APP_ORIGIN}/index.html`);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // WebRTC no pasa por la CSP ni por webRequest.
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/** Menú de cortar, copiar y pegar en los campos de texto. La terminal tiene el suyo propio. */
export function installEditMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const f = params.editFlags;
    Menu.buildFromTemplate([
      { label: 'Cortar', role: 'cut', enabled: f.canCut },
      { label: 'Copiar', role: 'copy', enabled: f.canCopy },
      { label: 'Pegar', role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { label: 'Seleccionar todo', role: 'selectAll', enabled: f.canSelectAll },
    ]).popup();
  });
}

/** Abre un enlace de la terminal en el navegador del usuario, y solo si es http(s). */
export function openExternalSafe(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}
