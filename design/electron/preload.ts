import { contextBridge, ipcRenderer } from "electron";
import { IPC, isBrowserHandoffDecision, isBrowserHandoffStart, isDownloadCompletionNotice } from "../shared/types";
import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffDecision,
  BrowserHandoffRequest,
  BrowserHandoffStart,
  DownloadCompletionNotice,
  DownloadQueue,
  StateSnapshot,
  NewDownloadInfo,
  PresentationPatch,
  PresentationSettings,
  PresentationSettingKey,
  SettingKey,
  SettingsPatch,
  UpdateInstallResult,
  UpdateState,
  UpdateUnsavedWorkState,
  ExportFormat,
  ExportResult,
  HistoryDiff,
  HistoryFilter,
  HistoryPruneResult,
  HistoryView,
  HistoryAccessState,
} from "../shared/types";
import type { SshHostDraft, SshHostStatus } from "../shared/ssh";
import type {
  TotpRegistrationExportRecord,
  TotpRegistrationInput,
  TotpRegistrationMetadata,
} from "../shared/authenticator";
import { isTotpRegistrationExportRecord, isTotpRegistrationMetadata } from "../shared/authenticator";
import { isSshHostStatus } from "../shared/ssh";
import { isExportResult } from "../shared/export";
import { isOllamaRefreshResult, isOllamaSuiteState, type OllamaRefreshResult, type OllamaSuiteState } from "../shared/ollama";
import { isConverterState, type ConverterState } from "../shared/converter";
import { isHistoryAccessState, isHistoryDiff, isHistoryPruneResult, isHistoryRevision, isHistoryView } from "../shared/history";
import { isDownloadCategory } from "../shared/settings";
import { isRegexEvaluation, type RegexEvaluation } from "../shared/regex";
import {
  isBrowserChromeExtensionsResult,
  isBrowserExtensionInstallResult,
  isBrowserExtensionInstallState,
  type BrowserChromeExtensionsResult,
  type BrowserExtensionInstallResult,
  type BrowserExtensionInstallState,
} from "../shared/types";
import { isPresentationSettings, isUpdateInstallResult, isUpdateState, isUpdateUnsavedWorkState } from "../shared/types";
import { isScheduledSettingsRecords, type ScheduledSettingsRecord } from "../shared/scheduledSettings";
import { isAppLogoSettings, isAppLogoSnapshot, type AppLogoSettings, type AppLogoSnapshot } from "../shared/appLogo";
import { isPersonalVocabularyRuntime, type PersonalVocabularyRuntime } from "../shared/personalVocabulary";
import {
  isExternalEditorDiscovery,
  isExternalEditorOpenResult,
  type ExternalEditorDiscovery,
  type ExternalEditorOpenResult,
} from "../shared/externalEditor";
import {
  isChangelogView,
  type ChangelogView,
  type ChangelogViewRequest,
} from "./history/ChangelogStore";

async function invokeOllamaState(channel: string, ...args: unknown[]): Promise<OllamaSuiteState> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);
  if (!isOllamaSuiteState(result)) throw new Error("Invalid local Ollama suite state from main process");
  return result;
}

// Everything exposed to the renderer goes through this bridge. No direct
// Node/ipcRenderer access is ever given to renderer code.
const api = {
  getState: (): Promise<StateSnapshot> => ipcRenderer.invoke(IPC.GET_STATE),

  onStateChanged: (cb: (state: StateSnapshot) => void) => {
    const listener = (_: unknown, state: StateSnapshot) => cb(state);
    ipcRenderer.on(IPC.STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.STATE_CHANGED, listener);
  },

  getPresentationSettings: async (): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.PRESENTATION_GET);
    if (!isPresentationSettings(value)) throw new Error("Invalid presentation settings from main process");
    return value;
  },

  setPresentationSettings: async (settings: PresentationPatch, resetKeys: PresentationSettingKey[] = []): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.PRESENTATION_SET, settings, resetKeys);
    if (!isPresentationSettings(value)) throw new Error("Invalid presentation settings from main process");
    return value;
  },

  setupSchoolModeCredential: async (next: string, confirmation: string): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.SCHOOL_MODE_CREDENTIAL_SETUP, next, confirmation);
    if (!isPresentationSettings(value)) throw new Error("Invalid School mode credential setup result from main process");
    return value;
  },

  changeSchoolModeCredential: async (current: string, next: string, confirmation: string): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.SCHOOL_MODE_CREDENTIAL_CHANGE, current, next, confirmation);
    if (!isPresentationSettings(value)) throw new Error("Invalid School mode credential change result from main process");
    return value;
  },

  resetSchoolModeCredential: async (current: string): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.SCHOOL_MODE_CREDENTIAL_RESET, current);
    if (!isPresentationSettings(value)) throw new Error("Invalid School mode credential reset result from main process");
    return value;
  },

  disableSchoolMode: async (current: string): Promise<PresentationSettings> => {
    const value: unknown = await ipcRenderer.invoke(IPC.SCHOOL_MODE_DISABLE, current);
    if (!isPresentationSettings(value)) throw new Error("Invalid School mode disable result from main process");
    return value;
  },

  onPresentationChanged: (cb: (settings: PresentationSettings) => void) => {
    const listener = (_: unknown, settings: unknown) => {
      if (isPresentationSettings(settings)) cb(settings);
    };
    ipcRenderer.on(IPC.PRESENTATION_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.PRESENTATION_CHANGED, listener);
  },

  getPersonalVocabularyRuntime: async (): Promise<PersonalVocabularyRuntime> => {
    const value: unknown = await ipcRenderer.invoke(IPC.PERSONAL_VOCABULARY_GET);
    if (!isPersonalVocabularyRuntime(value)) throw new Error("Invalid personal vocabulary runtime state from main process");
    return value;
  },

  choosePersonalVocabularyFile: async (): Promise<PersonalVocabularyRuntime> => {
    const value: unknown = await ipcRenderer.invoke(IPC.PERSONAL_VOCABULARY_CHOOSE);
    if (!isPersonalVocabularyRuntime(value)) throw new Error("Invalid personal vocabulary load result from main process");
    return value;
  },

  clearPersonalVocabulary: async (): Promise<PersonalVocabularyRuntime> => {
    const value: unknown = await ipcRenderer.invoke(IPC.PERSONAL_VOCABULARY_CLEAR);
    if (!isPersonalVocabularyRuntime(value)) throw new Error("Invalid personal vocabulary clear result from main process");
    return value;
  },

  onPersonalVocabularyChanged: (cb: (runtime: PersonalVocabularyRuntime) => void) => {
    const listener = (_: unknown, value: unknown) => {
      if (isPersonalVocabularyRuntime(value)) cb(value);
    };
    ipcRenderer.on(IPC.PERSONAL_VOCABULARY_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.PERSONAL_VOCABULARY_CHANGED, listener);
  },

  getScheduleRules: async (): Promise<ScheduledSettingsRecord[]> => {
    const value: unknown = await ipcRenderer.invoke(IPC.SCHEDULE_GET);
    if (!isScheduledSettingsRecords(value)) throw new Error("Invalid scheduled settings records from main process");
    return value;
  },

  setScheduleRules: async (records: ScheduledSettingsRecord[]): Promise<ScheduledSettingsRecord[]> => {
    if (!isScheduledSettingsRecords(records)) throw new Error("Invalid scheduled settings records");
    const value: unknown = await ipcRenderer.invoke(IPC.SCHEDULE_SET, records);
    if (!isScheduledSettingsRecords(value)) throw new Error("Invalid scheduled settings result from main process");
    return value;
  },

  onScheduleChanged: (cb: (records: ScheduledSettingsRecord[]) => void) => {
    const listener = (_unknown: unknown, value: unknown) => {
      if (isScheduledSettingsRecords(value)) cb(value);
    };
    ipcRenderer.on(IPC.SCHEDULE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.SCHEDULE_CHANGED, listener);
  },

  getUpdateState: async (): Promise<UpdateState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.UPDATE_GET_STATE);
    if (!isUpdateState(state)) throw new Error("Invalid update state from main process");
    return state;
  },

  onUpdateStateChanged: (cb: (state: UpdateState) => void) => {
    const listener = (_: unknown, state: unknown) => {
      if (isUpdateState(state)) cb(state);
    };
    ipcRenderer.on(IPC.UPDATE_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATE_CHANGED, listener);
  },

  checkForUpdates: async (): Promise<UpdateState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.UPDATE_CHECK);
    if (!isUpdateState(state)) throw new Error("Invalid update check result from main process");
    return state;
  },

  installUpdate: async (): Promise<UpdateInstallResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.UPDATE_INSTALL);
    if (!isUpdateInstallResult(result)) throw new Error("Invalid update install result from main process");
    return result;
  },

  openUpdateReleaseNotes: async (): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke(IPC.UPDATE_OPEN_RELEASE_NOTES);
    if (typeof result !== "boolean") throw new Error("Invalid update release-notes result from main process");
    return result;
  },

  setUnsavedWorkState: (state: UpdateUnsavedWorkState): Promise<void> => {
    if (!isUpdateUnsavedWorkState(state)) return Promise.reject(new Error("Invalid unsaved-work state"));
    return ipcRenderer.invoke(IPC.UPDATE_SET_UNSAVED_WORK, state);
  },

  probeUrl: (url: string): Promise<NewDownloadInfo> =>
    ipcRenderer.invoke(IPC.PROBE_URL, url),

  previewCategory: async (fileName: string, url: string) => {
    const category: unknown = await ipcRenderer.invoke(IPC.PREVIEW_CATEGORY, fileName, url);
    if (!isDownloadCategory(category)) throw new Error("Invalid category preview from main process");
    return category;
  },

  evaluateRegexBatch: async (
    pattern: string,
    flags: string,
    samples: string[],
    includeMatches = false
  ): Promise<RegexEvaluation[]> => {
    const evaluations: unknown = await ipcRenderer.invoke(IPC.EVALUATE_REGEX, pattern, flags, samples, includeMatches);
    if (!Array.isArray(evaluations) || evaluations.length !== samples.length || !evaluations.every(isRegexEvaluation)) {
      throw new Error("Invalid regular expression evaluations from main process");
    }
    return evaluations;
  },

  addDownload: (req: AddDownloadRequest): Promise<string> =>
    ipcRenderer.invoke(IPC.ADD_DOWNLOAD, req),

  enqueueCapturedDownload: (req: BrowserHandoffRequest): Promise<string> =>
    ipcRenderer.invoke(IPC.HANDOFF_ADD_DOWNLOAD, req),

  getBrowserHandoffStart: async (): Promise<BrowserHandoffStart> => {
    const value: unknown = await ipcRenderer.invoke(IPC.BROWSER_HANDOFF_GET_START);
    if (!isBrowserHandoffStart(value)) throw new Error("Invalid browser handoff start from main process");
    return value;
  },

  approveBrowserHandoff: async (input: { fileName: string; folder: string }): Promise<BrowserHandoffDecision> => {
    const value: unknown = await ipcRenderer.invoke(IPC.BROWSER_HANDOFF_APPROVE, input);
    if (!isBrowserHandoffDecision(value)) throw new Error("Invalid browser handoff decision from main process");
    return value;
  },

  rejectBrowserHandoff: async (): Promise<BrowserHandoffDecision> => {
    const value: unknown = await ipcRenderer.invoke(IPC.BROWSER_HANDOFF_REJECT);
    if (!isBrowserHandoffDecision(value)) throw new Error("Invalid browser handoff decision from main process");
    return value;
  },

  getCompletionNotice: async (): Promise<DownloadCompletionNotice> => {
    const value: unknown = await ipcRenderer.invoke(IPC.COMPLETION_GET_NOTICE);
    if (!isDownloadCompletionNotice(value)) throw new Error("Invalid completion notice from main process");
    return value;
  },

  closeCompletionWindow: () => ipcRenderer.send(IPC.COMPLETION_CLOSE),

  pauseDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PAUSE, id),
  resumeDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.RESUME, id),
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.CANCEL, id),
  removeDownload: (id: string, deleteFile: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE, id, deleteFile),
  retryDownload: (id: string): Promise<void> => ipcRenderer.invoke(IPC.RETRY, id),
  openFile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_FILE, id),
  openFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_FOLDER, id),
  installBrowserExtension: async (): Promise<BrowserExtensionInstallResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTENSION_INSTALL);
    if (!isBrowserExtensionInstallResult(result)) {
      throw new Error("The main process returned a malformed extension install result.");
    }
    return result;
  },
  getBrowserExtensionInstallState: async (): Promise<BrowserExtensionInstallState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTENSION_STATE);
    if (!isBrowserExtensionInstallState(result)) {
      throw new Error("The main process returned a malformed extension install state.");
    }
    return result;
  },
  openChromeExtensions: async (): Promise<BrowserChromeExtensionsResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTENSION_OPEN_CHROME);
    if (!isBrowserChromeExtensionsResult(result)) {
      throw new Error("The main process returned a malformed Chrome extensions result.");
    }
    return result;
  },
  revealBrowserExtension: (): Promise<void> => ipcRenderer.invoke(IPC.EXTENSION_REVEAL),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings: SettingsPatch, resetKeys: SettingKey[] = []): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings, resetKeys),
  getAppLogo: async (): Promise<AppLogoSnapshot> => {
    const result: unknown = await ipcRenderer.invoke(IPC.LOGO_GET);
    if (!isAppLogoSnapshot(result)) throw new Error("Invalid app-logo state from main process");
    return result;
  },
  pickAppLogo: async (): Promise<AppLogoSnapshot> => {
    const result: unknown = await ipcRenderer.invoke(IPC.LOGO_PICK);
    if (!isAppLogoSnapshot(result)) throw new Error("Invalid app-logo picker result from main process");
    return result;
  },
  setAppLogo: async (settings: AppLogoSettings): Promise<AppLogoSnapshot> => {
    if (!isAppLogoSettings(settings)) return Promise.reject(new Error("Invalid app-logo configuration"));
    const result: unknown = await ipcRenderer.invoke(IPC.LOGO_SET, settings);
    if (!isAppLogoSnapshot(result)) throw new Error("Invalid app-logo update result from main process");
    return result;
  },
  clearAppLogo: async (): Promise<AppLogoSnapshot> => {
    const result: unknown = await ipcRenderer.invoke(IPC.LOGO_CLEAR);
    if (!isAppLogoSnapshot(result)) throw new Error("Invalid app-logo reset result from main process");
    return result;
  },
  saveSshHost: (draft: SshHostDraft): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SSH_HOST_SAVE, draft),
  importSshBootstrapKey: (hostId: string): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SSH_HOST_IMPORT_KEY, hostId),
  provisionSshHost: (hostId: string): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SSH_HOST_PROVISION, hostId),
  verifySshHost: async (hostId: string): Promise<SshHostStatus> => {
    const result: unknown = await ipcRenderer.invoke(IPC.SSH_HOST_VERIFY, hostId);
    if (!isSshHostStatus(result)) throw new Error("Invalid SSH host status from main process");
    return result;
  },
  setSshHostSecretTrust: (hostId: string, trusted: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SSH_HOST_TRUST, hostId, trusted),
  removeSshHost: (hostId: string): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SSH_HOST_REMOVE, hostId),

  getHistoryView: async (filter?: HistoryFilter): Promise<HistoryView> => {
    const view: unknown = await ipcRenderer.invoke(IPC.HISTORY_GET_VIEW, filter);
    if (!isHistoryView(view)) throw new Error("Invalid history view from main process");
    return view;
  },
  getHistoryDiff: async (revisionId: string): Promise<HistoryDiff> => {
    const diff: unknown = await ipcRenderer.invoke(IPC.HISTORY_DIFF, revisionId);
    if (!isHistoryDiff(diff)) throw new Error("Invalid history diff from main process");
    return diff;
  },
  restoreHistoryRevision: async (revisionId: string) => {
    const revision: unknown = await ipcRenderer.invoke(IPC.HISTORY_RESTORE, revisionId);
    if (!isHistoryRevision(revision)) throw new Error("Invalid history restore result from main process");
    return revision as import("../shared/history").HistoryRevision;
  },
  labelHistoryRevision: async (revisionId: string, label: string | null) => {
    const revision: unknown = await ipcRenderer.invoke(IPC.HISTORY_LABEL, revisionId, label);
    if (revision === null) return null;
    if (!isHistoryRevision(revision)) throw new Error("Invalid history label result from main process");
    return revision as import("../shared/history").HistoryRevision;
  },
  pruneHistory: async (keep: number): Promise<HistoryPruneResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.HISTORY_PRUNE, { keep });
    if (!isHistoryPruneResult(result)) throw new Error("Invalid history prune result from main process");
    return result;
  },
  getHistoryAccessState: async (): Promise<HistoryAccessState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.HISTORY_ACCESS_GET_STATE);
    if (!isHistoryAccessState(state)) throw new Error("Invalid history access state from main process");
    return state;
  },
  setupHistoryAccess: async (password: string): Promise<HistoryAccessState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.HISTORY_ACCESS_SETUP, password);
    if (!isHistoryAccessState(state)) throw new Error("Invalid history setup result from main process");
    return state;
  },
  unlockHistory: async (password: string): Promise<HistoryAccessState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.HISTORY_ACCESS_UNLOCK, password);
    if (!isHistoryAccessState(state)) throw new Error("Invalid history unlock result from main process");
    return state;
  },
  lockHistory: async (): Promise<HistoryAccessState> => {
    const state: unknown = await ipcRenderer.invoke(IPC.HISTORY_ACCESS_LOCK);
    if (!isHistoryAccessState(state)) throw new Error("Invalid history lock result from main process");
    return state;
  },
  registerAuthenticator: async (input: TotpRegistrationInput): Promise<TotpRegistrationMetadata> => {
    const result: unknown = await ipcRenderer.invoke(IPC.AUTHENTICATOR_REGISTER, input);
    if (!isTotpRegistrationMetadata(result)) throw new Error("Invalid authenticator registration from main process");
    return result;
  },
  confirmAuthenticatorRegistration: async (
    input: TotpRegistrationInput,
    candidate: string,
    timestampMs?: number,
    skewSteps?: number,
  ): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.AUTHENTICATOR_CONFIRM_REGISTRATION,
      input,
      candidate,
      timestampMs,
      skewSteps,
    );
    if (typeof result !== "boolean") throw new Error("Invalid authenticator pairing result from main process");
    return result;
  },
  generateAuthenticatorCode: async (metadata: TotpRegistrationMetadata, timestampMs?: number): Promise<string> => {
    const result: unknown = await ipcRenderer.invoke(IPC.AUTHENTICATOR_GENERATE_CODE, metadata, timestampMs);
    if (typeof result !== "string" || !/^(?:\d{6}|\d{8})$/u.test(result)) throw new Error("Invalid authenticator code from main process");
    return result;
  },
  verifyAuthenticatorCode: async (
    metadata: TotpRegistrationMetadata,
    candidate: string,
    timestampMs?: number,
    skewSteps?: number,
  ): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke(
      IPC.AUTHENTICATOR_VERIFY_CODE,
      metadata,
      candidate,
      timestampMs,
      skewSteps,
    );
    if (typeof result !== "boolean") throw new Error("Invalid authenticator verification from main process");
    return result;
  },
  removeAuthenticator: (metadata: TotpRegistrationMetadata): Promise<void> =>
    ipcRenderer.invoke(IPC.AUTHENTICATOR_REMOVE, metadata),
  exportAuthenticatorMetadata: async (metadata: TotpRegistrationMetadata): Promise<TotpRegistrationExportRecord> => {
    const result: unknown = await ipcRenderer.invoke(IPC.AUTHENTICATOR_EXPORT_METADATA, metadata);
    if (!isTotpRegistrationExportRecord(result)) throw new Error("Invalid authenticator export from main process");
    return result;
  },
  exportHistory: async (format: ExportFormat, filter?: HistoryFilter): Promise<ExportResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.HISTORY_EXPORT_VIEW, format, filter);
    if (!isExportResult(result)) throw new Error("Invalid history export from main process");
    return result;
  },
  getChangelogView: async (request?: ChangelogViewRequest): Promise<ChangelogView> => {
    const view: unknown = await ipcRenderer.invoke(IPC.CHANGELOG_GET_VIEW, request);
    if (!isChangelogView(view)) throw new Error("Invalid changelog view from main process");
    return view;
  },
  exportChangelog: async (format: ExportFormat, request?: ChangelogViewRequest): Promise<ExportResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CHANGELOG_EXPORT_VIEW, format, request);
    if (!isExportResult(result)) throw new Error("Invalid changelog export from main process");
    return result;
  },
  discoverExternalEditors: async (): Promise<ExternalEditorDiscovery> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTERNAL_EDITOR_DISCOVER);
    if (!isExternalEditorDiscovery(result)) throw new Error("Invalid external editor discovery result from main process");
    return result;
  },
  pickExternalEditor: async (): Promise<string | null> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTERNAL_EDITOR_PICK);
    if (result !== null && typeof result !== "string") throw new Error("Invalid external editor picker result from main process");
    return result;
  },
  openExportInEditor: async (content: string, fileName: string): Promise<ExternalEditorOpenResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTERNAL_EDITOR_OPEN_EXPORT, content, fileName);
    if (!isExternalEditorOpenResult(result)) throw new Error("Invalid external editor export result from main process");
    return result;
  },
  openWorkspaceInEditor: async (): Promise<ExternalEditorOpenResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.EXTERNAL_EDITOR_OPEN_WORKSPACE);
    if (!isExternalEditorOpenResult(result)) throw new Error("Invalid external editor workspace result from main process");
    return result;
  },

  getOllamaSuiteState: (): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_GET_STATE),
  onOllamaSuiteStateChanged: (cb: (state: OllamaSuiteState) => void) => {
    const listener = (_: unknown, state: unknown) => { if (isOllamaSuiteState(state)) cb(state); };
    ipcRenderer.on(IPC.OLLAMA_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.OLLAMA_STATE_CHANGED, listener);
  },
  addOllamaProvider: (input: { name: string; endpoint: string }): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_ADD_PROVIDER, input),
  removeOllamaProvider: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REMOVE_PROVIDER, id),
  refreshOllamaProvider: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REFRESH_PROVIDER, id),
  refreshOllamaCatalogCapability: (): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REFRESH_CATALOG_CAPABILITY),
  refreshOllamaModelDetails: (providerId: string, modelName: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REFRESH_MODEL_DETAILS, providerId, modelName),
  probeOllamaHardware: (): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_PROBE_HARDWARE),
  startOllamaPullBatch: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_START_PULL_BATCH, input),
  retryOllamaPullBatch: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_RETRY_PULL_BATCH, id),
  cancelOllamaPullBatch: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_CANCEL_PULL_BATCH, id),
  deleteOllamaModel: (providerId: string, modelName: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_DELETE_MODEL, providerId, modelName),
  copyOllamaModel: (providerId: string, input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_COPY_MODEL, providerId, input),
  generateOllama: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_GENERATE, input),
  createOllamaChat: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_CREATE_CHAT, input),
  renameOllamaChat: (id: string, name: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_RENAME_CHAT, id, name),
  deleteOllamaChat: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_DELETE_CHAT, id),
  sendOllamaChat: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_SEND_CHAT, input),
  cancelOllamaChat: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_CANCEL_CHAT, id),
  exportOllamaChat: async (id: string, format: ExportFormat): Promise<ExportResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.OLLAMA_EXPORT_CHAT, id, format);
    if (!isExportResult(result)) throw new Error("Invalid local Ollama chat export from main process");
    return result;
  },
  registerOllamaHarness: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REGISTER_HARNESS, input),
  pickOllamaHarnessExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC.OLLAMA_PICK_HARNESS_EXECUTABLE),
  pickOllamaHarnessFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.OLLAMA_PICK_HARNESS_FOLDER),
  removeOllamaHarness: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_REMOVE_HARNESS, id),
  preflightOllamaHarness: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_PREFLIGHT_HARNESS, input),
  launchOllamaHarness: (input: unknown): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_LAUNCH_HARNESS, input),
  restoreOllamaHarness: (id: string): Promise<OllamaSuiteState> => invokeOllamaState(IPC.OLLAMA_RESTORE_HARNESS, id),
  exportOllamaMetadata: async (format: ExportFormat): Promise<ExportResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.OLLAMA_EXPORT_METADATA, format);
    if (!isExportResult(result)) throw new Error("Invalid Ollama metadata export from main process");
    return result;
  },
  importOllamaMetadata: async (value: unknown): Promise<OllamaSuiteState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.OLLAMA_IMPORT_METADATA, value);
    if (!isOllamaSuiteState(result)) throw new Error("Invalid Ollama metadata import result from main process");
    return result;
  },
  resetOllamaSuiteState: async (): Promise<OllamaSuiteState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.OLLAMA_RESET_STATE);
    if (!isOllamaSuiteState(result)) throw new Error("Invalid Ollama reset result from main process");
    return result;
  },

  getConverterState: async (): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_GET_STATE);
    if (!isConverterState(result)) throw new Error("Invalid converter state from main process");
    return result;
  },
  pickConverterSources: async (): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_PICK_SOURCES);
    if (!isConverterState(result)) throw new Error("Invalid converter source selection from main process");
    return result;
  },
  clearConverterSources: async (): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_CLEAR_STAGED);
    if (!isConverterState(result)) throw new Error("Invalid converter clear result from main process");
    return result;
  },
  queueConverterSources: async (adapterId: string): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_QUEUE_STAGED, adapterId);
    if (!isConverterState(result)) throw new Error("Invalid converter queue result from main process");
    return result;
  },
  pauseConverterQueue: async (): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_PAUSE_QUEUE);
    if (!isConverterState(result)) throw new Error("Invalid converter pause result from main process");
    return result;
  },
  resumeConverterQueue: async (): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_RESUME_QUEUE);
    if (!isConverterState(result)) throw new Error("Invalid converter resume result from main process");
    return result;
  },
  cancelConverterJob: async (id: string): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_CANCEL_JOB, id);
    if (!isConverterState(result)) throw new Error("Invalid converter cancellation result from main process");
    return result;
  },
  retryConverterJob: async (id: string): Promise<ConverterState> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_RETRY_JOB, id);
    if (!isConverterState(result)) throw new Error("Invalid converter retry result from main process");
    return result;
  },
  openConverterResult: async (id: string): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_OPEN_RESULT, id);
    if (result !== true) throw new Error("The converter result could not be opened.");
    return true;
  },
  openConverterResultInEditor: async (id: string): Promise<boolean> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_OPEN_RESULT_IN_EDITOR, id);
    if (typeof result !== "boolean") throw new Error("Invalid converter external-editor result from main process");
    return result;
  },
  exportConverterHistory: async (format: ExportFormat): Promise<ExportResult> => {
    const result: unknown = await ipcRenderer.invoke(IPC.CONVERTER_EXPORT_HISTORY, format);
    if (!isExportResult(result)) throw new Error("Invalid converter history export from main process");
    return result;
  },
  onConverterStateChanged: (cb: (state: ConverterState) => void) => {
    const listener = (_: unknown, state: unknown) => {
      if (isConverterState(state)) cb(state);
    };
    ipcRenderer.on(IPC.CONVERTER_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CONVERTER_STATE_CHANGED, listener);
  },

  createQueue: (queue: Partial<DownloadQueue>): Promise<DownloadQueue> =>
    ipcRenderer.invoke(IPC.QUEUE_CREATE, queue),
  updateQueue: (queue: DownloadQueue): Promise<void> =>
    ipcRenderer.invoke(IPC.QUEUE_UPDATE, queue),
  deleteQueue: (id: string): Promise<void> => ipcRenderer.invoke(IPC.QUEUE_DELETE, id),
  startQueue: (id: string): Promise<void> => ipcRenderer.invoke(IPC.QUEUE_START, id),
  stopQueue: (id: string): Promise<void> => ipcRenderer.invoke(IPC.QUEUE_STOP, id),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_FOLDER),

  minimizeWindow: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  openProgressWindow: (itemId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PROGRESS_OPEN, itemId),
  onProgressTargetChanged: (cb: (itemId: string) => void) => {
    const listener = (_: unknown, itemId: unknown) => {
      if (typeof itemId === "string" && itemId.length > 0) cb(itemId);
    };
    ipcRenderer.on(IPC.PROGRESS_TARGET_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.PROGRESS_TARGET_CHANGED, listener);
  },
  minimizeProgressWindow: () => ipcRenderer.send(IPC.PROGRESS_MINIMIZE),
  closeProgressWindow: () => ipcRenderer.send(IPC.PROGRESS_CLOSE),
};

contextBridge.exposeInMainWorld("api", api);

export type MaterialDownloadManagerAPI = typeof api;
