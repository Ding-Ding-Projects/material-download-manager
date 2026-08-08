import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffRequest,
  DownloadCategory,
  DownloadQueue,
  NewDownloadInfo,
  SettingKey,
  SettingsPatch,
  StateSnapshot,
  UpdateInstallResult,
  UpdateState,
  UpdateUnsavedWorkState,
  ExportFormat,
  ExportResult,
  HistoryFilter,
  HistoryView,
} from "@shared/types";
import type { ChangelogView, ChangelogViewRequest } from "../electron/history/ChangelogStore";
import type { RegexEvaluation } from "@shared/regex";
import type { SshHostDraft, SshHostStatus } from "@shared/ssh";

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
  previewCategory(fileName: string, url: string): Promise<DownloadCategory>;
  evaluateRegexBatch(pattern: string, flags: string, samples: string[], includeMatches?: boolean): Promise<RegexEvaluation[]>;
  addDownload(req: AddDownloadRequest): Promise<string>;
  enqueueCapturedDownload(req: BrowserHandoffRequest): Promise<string>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  removeDownload(id: string, deleteFile: boolean): Promise<void>;
  retryDownload(id: string): Promise<void>;
  openFile(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  installBrowserExtension(): Promise<import("@shared/types").BrowserExtensionInstallResult>;
  revealBrowserExtension(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(settings: SettingsPatch, resetKeys?: SettingKey[]): Promise<AppSettings>;
  saveSshHost(draft: SshHostDraft): Promise<AppSettings>;
  importSshBootstrapKey(hostId: string): Promise<AppSettings>;
  provisionSshHost(hostId: string): Promise<AppSettings>;
  verifySshHost(hostId: string): Promise<SshHostStatus>;
  setSshHostSecretTrust(hostId: string, trusted: boolean): Promise<AppSettings>;
  removeSshHost(hostId: string): Promise<AppSettings>;
  getHistoryView(filter?: HistoryFilter): Promise<HistoryView>;
  exportHistory(format: ExportFormat, filter?: HistoryFilter): Promise<ExportResult>;
  getChangelogView(request?: ChangelogViewRequest): Promise<ChangelogView>;
  exportChangelog(format: ExportFormat, request?: ChangelogViewRequest): Promise<ExportResult>;
  createQueue(queue: Partial<DownloadQueue>): Promise<DownloadQueue>;
  updateQueue(queue: DownloadQueue): Promise<void>;
  deleteQueue(id: string): Promise<void>;
  startQueue(id: string): Promise<void>;
  stopQueue(id: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  openProgressWindow(itemId: string): Promise<boolean>;
  onProgressTargetChanged(cb: (itemId: string) => void): () => void;
  minimizeProgressWindow(): void;
  closeProgressWindow(): void;
}

declare global {
  interface Window {
    api: MaterialDownloadManagerAPI;
  }
}
