import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/types";
import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffRequest,
  DownloadQueue,
  StateSnapshot,
  NewDownloadInfo,
  SettingKey,
  SettingsPatch,
  UpdateInstallResult,
  UpdateState,
  UpdateUnsavedWorkState,
  ExportFormat,
  ExportResult,
  HistoryFilter,
  HistoryView,
  HistoryAccessState,
} from "../shared/types";
import type { SshHostDraft, SshHostStatus } from "../shared/ssh";
import { isSshHostStatus } from "../shared/ssh";
import { isExportResult } from "../shared/export";
import { isHistoryAccessState, isHistoryView } from "../shared/history";
import { isDownloadCategory } from "../shared/settings";
import { isRegexEvaluation, type RegexEvaluation } from "../shared/regex";
import { isUpdateInstallResult, isUpdateState, isUpdateUnsavedWorkState } from "../shared/types";
import { isBrowserExtensionInstallResult, type BrowserExtensionInstallResult } from "../shared/types";
import {
  isChangelogView,
  type ChangelogView,
  type ChangelogViewRequest,
} from "./history/ChangelogStore";

// Everything exposed to the renderer goes through this bridge. No direct
// Node/ipcRenderer access is ever given to renderer code.
const api = {
  getState: (): Promise<StateSnapshot> => ipcRenderer.invoke(IPC.GET_STATE),

  onStateChanged: (cb: (state: StateSnapshot) => void) => {
    const listener = (_: unknown, state: StateSnapshot) => cb(state);
    ipcRenderer.on(IPC.STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.STATE_CHANGED, listener);
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
  revealBrowserExtension: (): Promise<void> => ipcRenderer.invoke(IPC.EXTENSION_REVEAL),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings: SettingsPatch, resetKeys: SettingKey[] = []): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings, resetKeys),
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
