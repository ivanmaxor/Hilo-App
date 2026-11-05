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
  pathExists(path: string): Promise<boolean>;
  toolsCheck(): Promise<ToolCheck>;
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
  onNotice(cb: (message: string) => void): () => void;
}

declare global {
  interface Window {
    hilo: HiloApi;
  }
}

export const api: HiloApi = window.hilo;
