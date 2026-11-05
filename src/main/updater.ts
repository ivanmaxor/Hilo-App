import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NsisUpdater } from 'electron-updater';
import { describeUpdateError, isStableVersion, UPDATE_OWNER, UPDATE_REPO, type UpdateMode, type UpdatePhase, type UpdateStatus } from '../shared/updates';
import { hardenUpdaterSession } from './security';

export interface UpdateDeps {
  dataDir: string;
  send(status: UpdateStatus): void;
  isWorking(): boolean;
  /** Guarda el estado y apaga las sesiones, como al cerrar la app. */
  stopEverything(): Promise<void>;
  /** Ya no hay sesiones y el instalador no arrancó: reabrir para que vuelvan. */
  recover(): void;
}

/** Tras abrir: las sesiones arrancan primero, escalonadas. */
const STARTUP_DELAY_MS = 8000;

/**
 * Con el origen en el código: `app-update.yml` solo aporta la carpeta de caché y, si la hay, la firma esperada.
 * Se carga en el primer uso, y todo lo que hace pasa por la sesión endurecida.
 */
export async function createUpdater(mode: Exclude<UpdateMode, { kind: 'off' }>, dataDir: string): Promise<NsisUpdater> {
  const { NsisUpdater } = await import('electron-updater');
  const u = new NsisUpdater(mode.kind === 'local' ? { provider: 'generic', url: mode.feed } : { provider: 'github', owner: UPDATE_OWNER, repo: UPDATE_REPO });
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  u.allowPrerelease = false;
  u.allowDowngrade = false;
  u.disableWebInstaller = true;
  u.logger = null;
  u.isUpdateSupported = (info) => isStableVersion(info.version);
  // De serie guarda un identificador en `.updaterId` y lo manda en cada petición, para los lanzamientos
  // graduales. Aquí no se usan, y no se envía nada aparte de la petición: `hardenUpdaterSession` quita la cabecera.
  u.isUserWithinRollout = () => true;
  (u as unknown as { stagingUserIdPromise: { value: Promise<string> } }).stagingUserIdPromise = { value: Promise.resolve('') };
  hardenUpdaterSession(u.netSession, mode);
  if (mode.kind === 'local') {
    // Sin esto electron-updater no corre sin empaquetar, y busca dev-app-update.yml junto a la app.
    const config = join(dataDir, 'dev-app-update.yml');
    writeFileSync(config, `provider: generic\nurl: ${mode.feed}\nupdaterCacheDirName: hilo-updater\n`);
    u.forceDevUpdateConfig = true;
    u.updateConfigPath = config;
  }
  return u;
}

/** Busca, baja e instala solo cuando se lo piden. */
export class UpdateService {
  private status: UpdateStatus;
  private updater: NsisUpdater | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private installer: string | null = null;
  private handedOff = false;

  constructor(
    private readonly mode: UpdateMode,
    private readonly deps: UpdateDeps,
  ) {
    this.status = mode.kind === 'off' ? { state: 'off' } : { state: 'idle' };
  }

  get(): UpdateStatus {
    return this.status;
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.deps.send(status);
  }

  private fail(phase: UpdatePhase, error: unknown, version?: string): void {
    console.error('[actualizar]', phase, error);
    const message = describeUpdateError(error);
    this.set(version ? { state: 'error', phase, message, version } : { state: 'error', phase, message });
  }

  /** Una sola vez, al abrir. */
  scheduleStartupCheck(): void {
    if (this.mode.kind === 'off') return;
    this.startupTimer = setTimeout(() => void this.check(true), this.mode.kind === 'local' ? 300 : STARTUP_DELAY_MS);
  }

  private async load(): Promise<NsisUpdater> {
    if (this.updater) return this.updater;
    if (this.mode.kind === 'off') throw new Error('actualizaciones apagadas');
    const u = await createUpdater(this.mode, this.deps.dataDir);
    u.on('download-progress', (p: { percent: number }) => {
      if (this.status.state !== 'downloading') return;
      const percent = Math.min(100, Math.max(0, Math.floor(p.percent)));
      if (percent !== this.status.percent) this.set({ ...this.status, percent });
    });
    u.on('update-downloaded', (info: { downloadedFile: string }) => {
      this.installer = info.downloadedFile;
    });
    u.on('error', (error: unknown) => {
      if (!this.handedOff) return;
      console.error('[actualizar] el instalador no arrancó', error);
      this.deps.recover();
    });
    this.updater = u;
    return u;
  }

  async check(auto = false): Promise<void> {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (this.mode.kind === 'off') return;
    const s = this.status.state;
    if (s === 'checking' || s === 'downloading' || s === 'ready' || s === 'installing') return;
    this.set({ state: 'checking' });
    try {
      const u = await this.load();
      const result = await u.checkForUpdates();
      if (result?.isUpdateAvailable) this.set({ state: 'available', version: result.updateInfo.version, auto });
      else this.set({ state: 'current' });
    } catch (error) {
      this.fail('check', error);
    }
  }

  /** Solo con una versión ya encontrada; también para reintentar una descarga que falló. */
  async download(): Promise<void> {
    const s = this.status;
    if (!this.updater || (s.state !== 'available' && !(s.state === 'error' && s.phase === 'download'))) return;
    const version = s.version;
    if (!version) return;
    this.set({ state: 'downloading', version, percent: 0 });
    try {
      await this.updater.downloadUpdate();
      this.set({ state: 'ready', version });
    } catch (error) {
      this.fail('download', error, version);
    }
  }

  /** `needsConfirm`: hay sesiones trabajando y falta que la persona diga que sí. */
  async install(force: boolean): Promise<{ needsConfirm: boolean }> {
    const s = this.status;
    if (!this.updater || s.state !== 'ready') return { needsConfirm: false };
    if (!force && this.deps.isWorking()) return { needsConfirm: true };
    // Antes de apagar nada: sin instalador, las sesiones no tienen por qué morir.
    if (!this.installer || !existsSync(this.installer)) {
      this.set({ state: 'error', phase: 'install', message: 'El archivo bajado ya no está. Busca la versión de nuevo.', version: s.version });
      return { needsConfirm: false };
    }
    this.set({ state: 'installing', version: s.version });
    // Primero apagar y después lanzar: el instalador mata a la fuerza lo que siga abierto a los pocos segundos,
    // y apagar las sesiones puede tardar más. Se quedarían procesos huérfanos.
    await this.deps.stopEverything();
    this.handedOff = true;
    // Sin pantallas y con --force-run: la licencia ya se aceptó, y Hilo vuelve a abrirse solo.
    this.updater.quitAndInstall(true, true);
    return { needsConfirm: false };
  }
}
