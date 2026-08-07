import type {
  AddDownloadRequest,
  AppSettings,
  DownloadQueue,
  NewDownloadInfo,
  StateSnapshot,
  UpdateInstallResult,
  UpdateState,
  UpdateUnsavedWorkState,
} from "@shared/types";

export interface MaterialDownloadManagerAPI {
  getState(): Promise<StateSnapshot>;
  onStateChanged(cb: (state: StateSnapshot) => void): () => void;
  getUpdateState(): Promise<UpdateState>;
  onUpdateStateChanged(cb: (state: UpdateState) => void): () => void;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateInstallResult>;
  openUpdateReleaseNotes(): Promise<boolean>;
  setUnsavedWorkState(state: UpdateUnsavedWorkState): Promise<void>;
  probeUrl(url: string): Promise<NewDownloadInfo>;
  addDownload(req: AddDownloadRequest): Promise<string>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  removeDownload(id: string, deleteFile: boolean): Promise<void>;
  retryDownload(id: string): Promise<void>;
  openFile(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  createQueue(queue: Partial<DownloadQueue>): Promise<DownloadQueue>;
  updateQueue(queue: DownloadQueue): Promise<void>;
  deleteQueue(id: string): Promise<void>;
  startQueue(id: string): Promise<void>;
  stopQueue(id: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  openProgressWindow(): Promise<void>;
}

declare global {
  interface Window {
    api: MaterialDownloadManagerAPI;
  }
}
