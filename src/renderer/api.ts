import type { PlanUsage } from '../shared/usage';
import type { TerminalPath } from '../shared/pathLinks';
import type { Action, AppInfo, BackgroundProcess, PersistedState, RuntimeMap, SessionRuntime, SessionStatus, ToolCheck } from '../shared/types';
import type { UpdateStatus } from '../shared/updates';
import type { ChangesList, FileDiffRequest, FileDiffResult } from '../shared/diff';
import type { DetectedIde, IdeOpenResult } from '../shared/ide';

export interface HiloApi {
  getState(): Promise<{ state: PersistedState; runtime: RuntimeMap; info: AppInfo; notice: string | null; afterCrash?: boolean; focused?: boolean }>;
  dispatch(action: Action): Promise<void>;
  wake(id: string, cols: number, rows: number): Promise<boolean>;
  sleep(id: string): Promise<boolean>;
  background(id: string): Promise<BackgroundProcess[] | null>;
  removeSession(id: string): Promise<void>;
  removeProject(id: string): Promise<void>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  ack(id: string, chars: number): void;
  setView(visible: string[], focused: boolean): void;
  clipRead(): Promise<{ text: string; hasImage: boolean }>;
  clipWrite(text: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  /** La carpeta de una sesión ya no existe: 'pick' abre el diálogo de Windows, 'project' usa la carpeta del proyecto. */
  fixFolder(id: string, mode: 'pick' | 'project'): Promise<{ ok: boolean; message?: string }>;
  /** Su historial existe pero Claude no lo retoma: empieza una conversación nueva en esta sesión. El historial viejo no se toca. */
  freshConversation(id: string): Promise<boolean>;
  pathExists(path: string): Promise<boolean>;
  toolsCheck(): Promise<ToolCheck>;
  usageGet(): Promise<PlanUsage | null>;
  /** El último mensaje de Claude con el nombre de la sesión delante, listo para copiar. */
  lastMessage(id: string): Promise<string | null>;
  /** Quita el verde de "terminó" sin abrir la sesión. */
  markRead(id: string): Promise<void>;
  /** Abre la carpeta del proyecto en el Explorador. Devuelve el problema, o '' si se abrió. */
  openProjectFolder(id: string): Promise<string>;
  /** Qué rutas escritas en la terminal existen, vistas desde la carpeta de la sesión (#10). null: no existe. */
  pathResolve(id: string, paths: string[]): Promise<(TerminalPath | null)[]>;
  /** Muestra la ruta en el Explorador. Devuelve el problema, o vacío. */
  pathReveal(id: string, path: string): Promise<string>;
  openSessionFolder(id: string): Promise<string>;
  onUsage(cb: (usage: PlanUsage) => void): () => void;
  changesList(projectId: string): Promise<ChangesList>;
  changesDiff(projectId: string, request: FileDiffRequest): Promise<FileDiffResult>;
  ideDetect(): Promise<DetectedIde[]>;
  ideChoose(projectId: string, ideId: string): Promise<boolean>;
  /** Abre el diálogo nativo. Devuelve qué pasó con lo elegido. */
  idePick(projectId: string): Promise<{ ok: boolean; message?: string }>;
  ideOpen(projectId: string, file: string | null, line: number | null): Promise<IdeOpenResult>;
  toggleFullscreen(): void;
  openLink(url: string): void;
  updateGet(): Promise<UpdateStatus>;
  updateCheck(): Promise<void>;
  updateDownload(): Promise<void>;
  updateInstall(force: boolean): Promise<{ needsConfirm: boolean }>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  onPtyData(cb: (id: string, data: string) => void): () => void;
  onPtyExit(cb: (id: string, code: number, status: SessionStatus) => void): () => void;
  onPtyReset(cb: (id: string) => void): () => void;
  onState(cb: (state: PersistedState) => void): () => void;
  onRuntime(cb: (id: string, runtime: SessionRuntime) => void): () => void;
  onWindowFocus(cb: (focused: boolean) => void): () => void;
  onSessionFocus(cb: (id: string) => void): () => void;
  onAutoSlept(cb: (id: string) => void): () => void;
  /** Una sesión terminó, te espera o falló. `unseen`: no la estabas mirando. */
  onAlert(cb: (id: string, status: SessionStatus, unseen: boolean) => void): () => void;
  onNotice(cb: (message: string) => void): () => void;
}

declare global {
  interface Window {
    hilo: HiloApi;
  }
}

export const api: HiloApi = window.hilo;
