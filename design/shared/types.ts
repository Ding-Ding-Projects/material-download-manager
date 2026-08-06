// Shared type definitions used by both the Electron main process (download engine)
// and the React renderer (UI). Keep this file free of runtime imports so it can be
// consumed from either side without pulling in Node or DOM specific code.

export type DownloadCategory =
  | "image"
  | "music"
  | "video"
  | "apps"
  | "document"
  | "compressed"
  | "other";

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
  parts: PartInfo[];
  connections: number;
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

export const SETTING_KEYS = [
  "defaultSaveFolder",
  "maxConnectionsPerDownload",
  "maxActiveDownloads",
  "globalSpeedLimitBytes",
  "showCompleteDialog",
  "startOnSystemStartup",
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
  settingProvenance: SettingsProvenance;
}

export interface AddDownloadRequest {
  url: string;
  folder: string;
  fileName: string;
  queueId?: string | null;
  startImmediately: boolean;
  headers?: Record<string, string>;
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

// IPC channel names, centralized so main/preload/renderer never typo a string.
export const IPC = {
  ADD_DOWNLOAD: "download:add",
  PROBE_URL: "download:probe",
  PAUSE: "download:pause",
  RESUME: "download:resume",
  CANCEL: "download:cancel",
  REMOVE: "download:remove",
  RETRY: "download:retry",
  OPEN_FILE: "download:openFile",
  OPEN_FOLDER: "download:openFolder",
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
} as const;
