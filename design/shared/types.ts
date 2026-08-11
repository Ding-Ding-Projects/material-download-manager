// Shared type definitions used by both the Electron main process (download engine)
// and the React renderer (UI). Keep this file free of runtime imports so it can be
// consumed from either side without pulling in Node or DOM specific code.

import type { ExportFormat, ExportResult } from "./export";
import type { HistoryFilter, HistoryView, HistoryAccessState } from "./history";
import type { DistributedDownloadSelection, SourceIdentity } from "./distributedProtocol";

export type DownloadCategory =
  | "image"
  | "music"
  | "video"
  | "apps"
  | "document"
  | "compressed"
  | "other";

/** The six user-selectable folder targets. Images remain an internal detected category that routes to General. */
export type AutoOrganizeTargetCategory = Exclude<DownloadCategory, "image">;

/**
 * Auto-organize folder names, keyed by detected category. The six visible
 * folders are General, Documents, Videos, Music, Programs, and Compressed;
 * images and uncategorized files both land in General so the on-disk layout
 * matches the documented six-folder contract.
 */
export const AUTO_ORGANIZE_FOLDERS: Record<DownloadCategory, string> = {
  other: "General",
  image: "General",
  document: "Documents",
  video: "Videos",
  music: "Music",
  apps: "Programs",
  compressed: "Compressed",
};

export const AUTO_ORGANIZE_RULE_LIMIT = 50;
export const AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH = 64;
export const AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH = 512;

/**
 * A user-authored regex filter that assigns a download to a category before
 * the built-in extension mapping runs. The pattern is evaluated against the
 * download's file name and its URL under the shared bounded regex evaluator.
 */
export interface AutoOrganizeRule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  category: AutoOrganizeTargetCategory;
}

export type DownloadStatus =
  | "added"
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface PartInfo {
  id: number;
  from: number;
  to: number | null;
  current: number;
  status: "idle" | "connecting" | "downloading" | "completed" | "error";
}

export interface DownloadItem {
  id: string;
  url: string;
  fileName: string;
  folder: string;
  category: DownloadCategory;
  status: DownloadStatus;
  totalSize: number | null;
  downloadedSize: number;
  speed: number; // bytes/sec, instantaneous
  eta: number | null; // seconds remaining
  resumeSupport: boolean;
  queueId: string | null;
  dateAdded: number;
  dateCompleted: number | null;
  error: string | null;
  /** Non-blocking truthful notice when a requested transport falls back locally. */
  transferNotice?: string;
  /** True when sensitive local-source headers/URL are held in the main-process vault. */
  sourceSecretStoredInVault?: boolean;
  parts: PartInfo[];
  connections: number;
  /** Missing on legacy records; new records always set one of these modes. */
  transferMode?: "local" | "ssh-distributed";
  /** Stable, non-secret identifiers only. Host addresses and keys remain in settings/vault state. */
  sshHostIds?: string[];
  /** Public validator metadata required to resume without persisting the raw credentialed URL. */
  sshSourceIdentity?: SourceIdentity;
  /** Optional user-supplied whole-file trust anchor. */
  sshExpectedSha256?: string | null;
  sshProgress?: SshHostTransferProgress[];
}

export interface DownloadQueue {
  id: string;
  name: string;
  maxConcurrent: number;
  isRunning: boolean;
  itemIds: string[];
  // schedule support (matches original app's queue scheduling concept)
  scheduleEnabled: boolean;
  startAt: string | null; // "HH:mm"
  endAt: string | null; // "HH:mm"
}

export type LanguageMode = "english" | "cantonese" | "bilingual";
export type FunnyLevel = 1 | 2 | 3 | 4 | 5;
export type DensityMode = "compact" | "comfortable" | "spacious";
export type UIFontFamily = "segoe-ui" | "inter" | "cascadia-code" | "system";
export type UIFontWeight = 400 | 500 | 600 | 700;
export type SettingSource = "persisted" | "compiled-in";

export type SshBootstrapAuthMode = "system-agent" | "stored-private-key";

/**
 * Public, non-secret metadata for one Docker-backed SSH download host.
 * Private keys and passphrases are addressed by this stable identifier but
 * live only in the operating-system credential vault owned by the main
 * process.
 */
export interface SshHostConfig {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  username: string;
  hostKeySha256: string;
  bootstrapAuthMode: SshBootstrapAuthMode;
  workerPort: number;
  workerHostKeySha256: string | null;
  enabled: boolean;
  trustedForSourceSecrets: boolean;
  provisionedAt: number | null;
}

export interface SshHostTransferProgress {
  hostId: string;
  pieceId?: string | null;
  rangeStart?: number | null;
  rangeEndExclusive?: number | null;
  transferredBytes?: number;
  bytesPerSecond?: number;
  activePieces: number;
  completedPieces: number;
  failedPieces: number;
  state: "waiting" | "connecting" | "downloading" | "completed" | "quarantined" | "error";
  message: string | null;
}

export const SETTING_KEYS = [
  "defaultSaveFolder",
  "maxConnectionsPerDownload",
  "maxActiveDownloads",
  "globalSpeedLimitBytes",
  "showCompleteDialog",
  "startOnSystemStartup",
  "displayName",
  "theme",
  "minConnectionPartSize",
  "languageMode",
  "funnyLevelEnglish",
  "funnyLevelCantonese",
  "density",
  "accentSeedColor",
  "uiFontFamily",
  "uiFontSize",
  "uiFontWeight",
  "autoOrganizeEnabled",
  "autoOrganizeRules",
  "sshHosts",
  "sshDefaultWorkerCount",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type SettingsProvenance = Record<SettingKey, SettingSource>;

export interface AppSettings {
  settingsVersion: number;
  defaultSaveFolder: string;
  maxConnectionsPerDownload: number;
  maxActiveDownloads: number;
  globalSpeedLimitBytes: number; // 0 = unlimited
  showCompleteDialog: boolean;
  startOnSystemStartup: boolean;
  /** User-facing label only; it never changes appData, package, or update identity. */
  displayName: string;
  theme: "dark" | "light" | "system";
  minConnectionPartSize: number; // bytes, minimum size worth splitting further
  languageMode: LanguageMode;
  funnyLevelEnglish: FunnyLevel;
  funnyLevelCantonese: FunnyLevel;
  density: DensityMode;
  accentSeedColor: string;
  uiFontFamily: UIFontFamily;
  uiFontSize: number;
  uiFontWeight: UIFontWeight;
  autoOrganizeEnabled: boolean;
  autoOrganizeRules: AutoOrganizeRule[];
  sshHosts: SshHostConfig[];
  sshDefaultWorkerCount: number;
  settingProvenance: SettingsProvenance;
}

/** Renderer/main mutations may contain only user-editable setting keys. */
export type SettingsPatch = Partial<Pick<AppSettings, SettingKey>>;

export interface AddDownloadRequest {
  url: string;
  folder: string;
  fileName: string;
  queueId?: string | null;
  startImmediately: boolean;
  headers?: Record<string, string>;
  ssh?: DistributedDownloadSelection | null;
}

/**
 * Browser captures deliberately use the same request shape as the in-app
 * add flow. The main process is the only owner of enqueueing, persistence,
 * and progress broadcasts; a handoff cannot create a second download store.
 */
export type BrowserHandoffRequest = Omit<AddDownloadRequest, "ssh"> & { ssh?: never };

/**
 * Result of staging the bundled Chromium extension onto disk from the app UI.
 * `path` is the stable installed folder the user selects with Load unpacked.
 */
export interface BrowserExtensionInstallResult {
  installed: true;
  path: string;
  folderOpened: boolean;
  folderOpenError: string | null;
}

export function isBrowserExtensionInstallResult(value: unknown): value is BrowserExtensionInstallResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.installed !== true || typeof record.path !== "string" || record.path.length === 0) return false;
  if (typeof record.folderOpened !== "boolean") return false;
  if (record.folderOpenError !== null && (typeof record.folderOpenError !== "string" || record.folderOpenError.length === 0)) {
    return false;
  }
  return record.folderOpened ? record.folderOpenError === null : typeof record.folderOpenError === "string";
}

/**
 * Report a completed extension staging operation without letting a file-manager
 * launch failure turn the successful install into a failed install.
 */
export async function createBrowserExtensionInstallResult(
  installedPath: string,
  openFolder: (folderPath: string) => Promise<string>,
): Promise<BrowserExtensionInstallResult> {
  if (typeof installedPath !== "string" || installedPath.length === 0) {
    throw new Error("The installed extension path is missing.");
  }
  try {
    const failure = await openFolder(installedPath);
    if (failure) {
      return { installed: true, path: installedPath, folderOpened: false, folderOpenError: failure };
    }
    return { installed: true, path: installedPath, folderOpened: true, folderOpenError: null };
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "The extension folder could not be opened.";
    return { installed: true, path: installedPath, folderOpened: false, folderOpenError: message };
  }
}

export interface NewDownloadInfo {
  url: string;
  suggestedFileName: string;
  contentLength: number | null;
  resumeSupport: boolean;
  contentType: string | null;
}

export const DEFAULT_QUEUE_ID = "default";

export interface StateSnapshot {
  items: DownloadItem[];
  queues: DownloadQueue[];
  settings: AppSettings;
}

export type UpdateState =
  | {
      status: "current";
      version: string;
      releaseNotesUrl: string | null;
      checkedAt: number;
    }
  | {
      status: "available";
      version: string | null;
      releaseNotesUrl: string | null;
      checkedAt: number;
    }
  | {
      status: "downloading";
      version: string | null;
      releaseNotesUrl: string | null;
      checkedAt: number;
      percent: number;
    }
  | {
      status: "ready";
      version: string;
      releaseNotesUrl: string;
      checkedAt: number;
    }
  | {
      status: "failed" | "offline";
      version: string | null;
      releaseNotesUrl: string | null;
      checkedAt: number;
      message: string;
    };

export interface UpdateUnsavedWorkState {
  hasUnsavedWork: boolean;
  reason: string;
}

export interface UpdateInstallResult {
  started: boolean;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown, maxLength = 512): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isUpdateState(value: unknown): value is UpdateState {
  if (!isRecord(value)) return false;
  if (typeof value.status !== "string" || typeof value.checkedAt !== "number" || !Number.isFinite(value.checkedAt)) {
    return false;
  }
  if (!isOptionalString(value.version, 128)) return false;
  if (value.releaseNotesUrl !== null && !isSafeHttpsUrl(value.releaseNotesUrl)) return false;

  switch (value.status) {
    case "current":
      return typeof value.version === "string";
    case "available":
      return true;
    case "downloading":
      return typeof value.percent === "number" && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100;
    case "ready":
      return typeof value.version === "string" && isSafeHttpsUrl(value.releaseNotesUrl);
    case "failed":
    case "offline":
      return typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512;
    default:
      return false;
  }
}

export function isUpdateUnsavedWorkState(value: unknown): value is UpdateUnsavedWorkState {
  return (
    isRecord(value) &&
    typeof value.hasUnsavedWork === "boolean" &&
    typeof value.reason === "string" &&
    value.reason.length > 0 &&
    value.reason.length <= 512
  );
}

export function isUpdateInstallResult(value: unknown): value is UpdateInstallResult {
  return isRecord(value) && typeof value.started === "boolean" && isOptionalString(value.reason, 512);
}

// IPC channel names, centralized so main/preload/renderer never typo a string.
export const IPC = {
  ADD_DOWNLOAD: "download:add",
  PROBE_URL: "download:probe",
  PREVIEW_CATEGORY: "download:previewCategory",
  EVALUATE_REGEX: "regex:evaluate",
  PAUSE: "download:pause",
  RESUME: "download:resume",
  CANCEL: "download:cancel",
  REMOVE: "download:remove",
  RETRY: "download:retry",
  OPEN_FILE: "download:openFile",
  OPEN_FOLDER: "download:openFolder",
  EXTENSION_INSTALL: "extension:install",
  EXTENSION_REVEAL: "extension:reveal",
  HANDOFF_ADD_DOWNLOAD: "download:handoffAdd",
  GET_STATE: "state:get",
  STATE_CHANGED: "state:changed",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  QUEUE_CREATE: "queue:create",
  QUEUE_UPDATE: "queue:update",
  QUEUE_DELETE: "queue:delete",
  QUEUE_START: "queue:start",
  QUEUE_STOP: "queue:stop",
  PICK_FOLDER: "dialog:pickFolder",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  PROGRESS_OPEN: "progress:open",
  PROGRESS_CLOSE: "progress:close",
  PROGRESS_MINIMIZE: "progress:minimize",
  PROGRESS_TARGET_CHANGED: "progress:targetChanged",
  UPDATE_GET_STATE: "update:getState",
  UPDATE_STATE_CHANGED: "update:stateChanged",
  UPDATE_CHECK: "update:check",
  UPDATE_INSTALL: "update:install",
  UPDATE_OPEN_RELEASE_NOTES: "update:openReleaseNotes",
  UPDATE_SET_UNSAVED_WORK: "update:setUnsavedWork",
  SSH_HOST_SAVE: "ssh:hostSave",
  SSH_HOST_IMPORT_KEY: "ssh:hostImportKey",
  SSH_HOST_PROVISION: "ssh:hostProvision",
  SSH_HOST_VERIFY: "ssh:hostVerify",
  SSH_HOST_REMOVE: "ssh:hostRemove",
  SSH_HOST_TRUST: "ssh:hostTrust",
  HISTORY_GET_VIEW: "history:getView",
  HISTORY_EXPORT_VIEW: "history:exportView",
  HISTORY_ACCESS_GET_STATE: "historyAccess:getState",
  HISTORY_ACCESS_SETUP: "historyAccess:setup",
  HISTORY_ACCESS_UNLOCK: "historyAccess:unlock",
  HISTORY_ACCESS_LOCK: "historyAccess:lock",
  CHANGELOG_GET_VIEW: "changelog:getView",
  CHANGELOG_EXPORT_VIEW: "changelog:exportView",
} as const;

export type { ExportFormat, ExportResult, HistoryFilter, HistoryView, HistoryAccessState };
