import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffDecision,
  BrowserHandoffRequest,
  BrowserHandoffStart,
  DownloadCategory,
  DownloadQueue,
  NewDownloadInfo,
  PresentationPatch,
  PresentationSettings,
  PresentationSettingKey,
  SettingKey,
  SettingsPatch,
  StateSnapshot,
  UpdateInstallResult,
  UpdateState,
  UpdateUnsavedWorkState,
  ExportFormat,
  ExportResult,
  HistoryFilter,
  HistoryDiff,
  HistoryPruneResult,
  HistoryRevision,
  HistoryView,
  HistoryAccessState,
  BrowserExtensionInstallState,
  BrowserChromeExtensionsResult,
} from "@shared/types";
import type { ScheduledSettingsRecord } from "@shared/scheduledSettings";
import type {
  ExternalEditorDiscovery,
  ExternalEditorOpenResult,
} from "@shared/externalEditor";
import type { ChangelogView, ChangelogViewRequest } from "../electron/history/ChangelogStore";
import type { RegexEvaluation } from "@shared/regex";
import type { SshHostDraft, SshHostStatus } from "@shared/ssh";
import type {
  TotpRegistrationExportRecord,
  TotpRegistrationInput,
  TotpRegistrationMetadata,
} from "@shared/authenticator";
import type { OllamaRefreshResult, OllamaSuiteState } from "@shared/ollama";
import type { ConverterState } from "@shared/converter";
import type { AppLogoSettings, AppLogoSnapshot } from "@shared/appLogo";
import type { PersonalVocabularyRuntime } from "@shared/personalVocabulary";

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
  getBrowserHandoffStart(): Promise<BrowserHandoffStart>;
  approveBrowserHandoff(input: { fileName: string; folder: string }): Promise<BrowserHandoffDecision>;
  rejectBrowserHandoff(): Promise<BrowserHandoffDecision>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  removeDownload(id: string, deleteFile: boolean): Promise<void>;
  retryDownload(id: string): Promise<void>;
  openFile(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  installBrowserExtension(): Promise<import("@shared/types").BrowserExtensionInstallResult>;
  getBrowserExtensionInstallState(): Promise<BrowserExtensionInstallState>;
  openChromeExtensions(): Promise<BrowserChromeExtensionsResult>;
  revealBrowserExtension(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  setSettings(settings: SettingsPatch, resetKeys?: SettingKey[]): Promise<AppSettings>;
  getAppLogo(): Promise<AppLogoSnapshot>;
  pickAppLogo(): Promise<AppLogoSnapshot>;
  setAppLogo(settings: AppLogoSettings): Promise<AppLogoSnapshot>;
  clearAppLogo(): Promise<AppLogoSnapshot>;
  getPresentationSettings(): Promise<PresentationSettings>;
  setPresentationSettings(settings: PresentationPatch, resetKeys?: PresentationSettingKey[]): Promise<PresentationSettings>;
  getScheduleRules(): Promise<ScheduledSettingsRecord[]>;
  setScheduleRules(records: ScheduledSettingsRecord[]): Promise<ScheduledSettingsRecord[]>;
  onScheduleChanged(cb: (records: ScheduledSettingsRecord[]) => void): () => void;
  setupSchoolModeCredential(next: string, confirmation: string): Promise<PresentationSettings>;
  changeSchoolModeCredential(current: string, next: string, confirmation: string): Promise<PresentationSettings>;
  resetSchoolModeCredential(current: string): Promise<PresentationSettings>;
  disableSchoolMode(current: string): Promise<PresentationSettings>;
  onPresentationChanged(cb: (settings: PresentationSettings) => void): () => void;
  getPersonalVocabularyRuntime(): Promise<PersonalVocabularyRuntime>;
  choosePersonalVocabularyFile(): Promise<PersonalVocabularyRuntime>;
  clearPersonalVocabulary(): Promise<PersonalVocabularyRuntime>;
  onPersonalVocabularyChanged(cb: (runtime: PersonalVocabularyRuntime) => void): () => void;
  saveSshHost(draft: SshHostDraft): Promise<AppSettings>;
  importSshBootstrapKey(hostId: string): Promise<AppSettings>;
  provisionSshHost(hostId: string): Promise<AppSettings>;
  verifySshHost(hostId: string): Promise<SshHostStatus>;
  setSshHostSecretTrust(hostId: string, trusted: boolean): Promise<AppSettings>;
  removeSshHost(hostId: string): Promise<AppSettings>;
  getHistoryView(filter?: HistoryFilter): Promise<HistoryView>;
  getHistoryDiff(revisionId: string): Promise<HistoryDiff>;
  restoreHistoryRevision(revisionId: string): Promise<HistoryRevision>;
  labelHistoryRevision(revisionId: string, label: string | null): Promise<HistoryRevision | null>;
  pruneHistory(keep: number): Promise<HistoryPruneResult>;
  getHistoryAccessState(): Promise<HistoryAccessState>;
  setupHistoryAccess(password: string): Promise<HistoryAccessState>;
  unlockHistory(password: string): Promise<HistoryAccessState>;
  lockHistory(): Promise<HistoryAccessState>;
  exportHistory(format: ExportFormat, filter?: HistoryFilter): Promise<ExportResult>;
  registerAuthenticator(input: TotpRegistrationInput): Promise<TotpRegistrationMetadata>;
  confirmAuthenticatorRegistration(input: TotpRegistrationInput, candidate: string, timestampMs?: number, skewSteps?: number): Promise<boolean>;
  generateAuthenticatorCode(metadata: TotpRegistrationMetadata, timestampMs?: number): Promise<string>;
  verifyAuthenticatorCode(metadata: TotpRegistrationMetadata, candidate: string, timestampMs?: number, skewSteps?: number): Promise<boolean>;
  removeAuthenticator(metadata: TotpRegistrationMetadata): Promise<void>;
  exportAuthenticatorMetadata(metadata: TotpRegistrationMetadata): Promise<TotpRegistrationExportRecord>;
  getChangelogView(request?: ChangelogViewRequest): Promise<ChangelogView>;
  exportChangelog(format: ExportFormat, request?: ChangelogViewRequest): Promise<ExportResult>;
  discoverExternalEditors(): Promise<ExternalEditorDiscovery>;
  pickExternalEditor(): Promise<string | null>;
  openExportInEditor(content: string, fileName: string): Promise<ExternalEditorOpenResult>;
  openWorkspaceInEditor(): Promise<ExternalEditorOpenResult>;
  getOllamaSuiteState(): Promise<OllamaSuiteState>;
  addOllamaProvider(input: { name: string; endpoint: string }): Promise<OllamaSuiteState>;
  removeOllamaProvider(id: string): Promise<OllamaSuiteState>;
  refreshOllamaProvider(id: string): Promise<OllamaRefreshResult>;
  exportOllamaMetadata(format: ExportFormat): Promise<ExportResult>;
  importOllamaMetadata(value: unknown): Promise<OllamaSuiteState>;
  resetOllamaSuiteState(): Promise<OllamaSuiteState>;
  getConverterState(): Promise<ConverterState>;
  pickConverterSources(): Promise<ConverterState>;
  clearConverterSources(): Promise<ConverterState>;
  queueConverterSources(adapterId: string): Promise<ConverterState>;
  pauseConverterQueue(): Promise<ConverterState>;
  resumeConverterQueue(): Promise<ConverterState>;
  cancelConverterJob(id: string): Promise<ConverterState>;
  retryConverterJob(id: string): Promise<ConverterState>;
  openConverterResult(id: string): Promise<boolean>;
  openConverterResultInEditor(id: string): Promise<boolean>;
  exportConverterHistory(format: ExportFormat): Promise<ExportResult>;
  onConverterStateChanged(cb: (state: ConverterState) => void): () => void;
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
