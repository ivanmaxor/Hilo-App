/**
 * Actualizaciones: lo que se puede comprobar sin Electron. Ver docs/DECISIONES.md, D19.
 * Es la única conexión de la app, y el origen está fijo aquí.
 */
/** Lo pone la compilación desde `publish` en electron-builder.yml, el único sitio donde está: scripts/update-target.cjs. */
declare const __HILO_UPDATE_TARGET__: { owner: string; repo: string };
export const UPDATE_OWNER = __HILO_UPDATE_TARGET__.owner;
export const UPDATE_REPO = __HILO_UPDATE_TARGET__.repo;
export const RELEASES_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`;

/**
 * Comprobado el 2026-11-04 con descargas reales: el feed y `latest.yml` salen de github.com,
 * y cada archivo publicado redirige a release-assets.githubusercontent.com.
 * `tests/e2e/updates-red.spec.ts` lo vuelve a comprobar contra GitHub.
 */
export const UPDATE_HOSTS: readonly string[] = ['github.com', 'release-assets.githubusercontent.com'];

export type UpdateMode =
  /** Desarrollo y pruebas: nada sale a la red. */
  | { kind: 'off' }
  | { kind: 'github' }
  /** Solo pruebas, y solo contra un servidor en esta máquina. */
  | { kind: 'local'; feed: string; host: string };

const LOCAL_FEED = /^http:\/\/(127\.0\.0\.1:\d{1,5})\/$/;

export function resolveUpdateMode(env: { isPackaged: boolean; isTest: boolean; testFeed?: string | undefined; testReal?: string | undefined }): UpdateMode {
  if (env.isTest) {
    const local = LOCAL_FEED.exec(env.testFeed ?? '');
    if (local) return { kind: 'local', feed: env.testFeed!, host: local[1]! };
    // Para probar el empaquetado contra GitHub de verdad. Es lo mismo que hace fuera de pruebas.
    return env.isPackaged && env.testReal === '1' ? { kind: 'github' } : { kind: 'off' };
  }
  return env.isPackaged ? { kind: 'github' } : { kind: 'off' };
}

/** Chromium no resuelve ningún nombre salvo estos. Vale para todo el proceso: lo que separa al renderer es `hardenSession`. */
export function resolverRules(mode: UpdateMode): string {
  const hosts = mode.kind === 'github' ? UPDATE_HOSTS : mode.kind === 'local' ? ['127.0.0.1'] : [];
  return ['MAP * ~NOTFOUND', ...hosts.map((h) => `EXCLUDE ${h}`)].join(', ');
}

/** Lista exacta, sin comodines ni subdominios. Se comprueba también en cada redirección. */
export function isAllowedUpdateUrl(url: string, mode: UpdateMode): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (mode.kind === 'github') return u.protocol === 'https:' && u.port === '' && UPDATE_HOSTS.includes(u.hostname);
  if (mode.kind === 'local') return u.protocol === 'http:' && u.host === mode.host;
  return false;
}

/** Sin prerreleases: `1.2.3` sí, `1.2.3-beta.1` no. */
export function isStableVersion(version: unknown): version is string {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
}

export type UpdatePhase = 'check' | 'download' | 'install';

export type UpdateStatus =
  | { state: 'off' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'current' }
  /** `auto`: la encontró la búsqueda al abrir, y hay que avisar. */
  | { state: 'available'; version: string; auto: boolean }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'installing'; version: string }
  | { state: 'error'; phase: UpdatePhase; message: string; version?: string };

const NO_CONNECTION = /ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_\w+|NETWORK_\w+|TIMED_OUT|ADDRESS_\w+|PROXY_\w+|TUNNEL_\w+|EMPTY_RESPONSE|SOCKET_\w+)/;

/** Lo que dice electron-updater, en palabras de quien usa la app. */
export function describeUpdateError(error: unknown): string {
  const text = error instanceof Error ? `${(error as Error & { code?: string }).code ?? ''} ${error.message}` : String(error);
  if (text.includes('ERR_BLOCKED_BY_CLIENT')) return 'La descarga intentó salir de GitHub y Hilo la bloqueó. No se instaló nada. Puedes bajar la versión a mano desde la página de versiones.';
  if (NO_CONNECTION.test(text)) return 'No se pudo conectar con GitHub. Revisa tu conexión a internet. Hilo no usa el proxy del sistema: si tu red lo exige, baja la versión a mano desde la página de versiones.';
  if (/ERR_(CERT|SSL)/.test(text)) return 'La conexión con GitHub no pasó la comprobación de seguridad. No se bajó nada. Un antivirus o una red que intercepta el tráfico puede causarlo.';
  if (/checksum mismatch|ERR_CHECKSUM/i.test(text)) return 'El archivo bajado no coincide con el publicado. Se descartó y no se instaló nada.';
  if (/ERR_UPDATER_INVALID_SIGNATURE|not signed by the application owner/.test(text)) return 'La versión bajada no tiene la firma del autor de Hilo. Se descartó y no se instaló nada.';
  if (/ENOSPC/.test(text)) return 'No hay espacio suficiente en el disco para bajar la versión.';
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|Cannot find latest\.yml/.test(text)) return 'La última versión publicada no trae el archivo de actualización. Puedes bajarla a mano desde la página de versiones.';
  if (/No published versions|ERR_UPDATER_NO_PUBLISHED_VERSIONS|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/.test(text)) return 'Todavía no hay versiones publicadas en GitHub.';
  const http = /(?:HttpError: |statusCode: |status code )(\d{3})/.exec(text);
  if (http) return `GitHub respondió con un error (código ${http[1]}). Vuelve a intentarlo más tarde.`;
  return 'No se pudo completar la actualización. Vuelve a intentarlo más tarde, o baja la versión a mano desde la página de versiones.';
}
