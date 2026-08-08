import { app, autoUpdater, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
import path from "node:path";
import { IPC, isUpdateUnsavedWorkState, type UpdateInstallResult, type UpdateState } from "../shared/types";
import type { AddDownloadRequest, AppSettings, DownloadItem, DownloadQueue, SettingKey, SettingsPatch } from "../shared/types";
import { isExportFormat } from "../shared/export";
import { normalizeHistoryFilter } from "../shared/history";
import { validateSettingResetKeys, validateSettingsPatch } from "../shared/settings";
import {
  normalizeRegexEvaluationRequest,
} from "../shared/regex";
import { notifyDownloadComplete as showCompletionNotification, type CompletionNotificationPort } from "./completionNotification";
import { extractBrowserHandoffRequests } from "./download/browserHandoff";
import { assertQueueCreatePayload, DownloadManager } from "./download/DownloadManager";
import { HandoffServer } from "./extension/HandoffServer";
import { evaluateRegexBatchIsolated } from "./regex/RegexWorkerClient";
import {
  CHANGELOG_REPOSITORY_URL,
  ChangelogStore,
  createChangelogIpcHandlers,
  DEFAULT_CHANGELOG_ENTRIES,
} from "./history/ChangelogStore";
import { isDevelopmentLaunch, resolveRendererPath } from "./runtimePaths";
import {
  normalizeReleaseNotesUrl,
  readUpdateFeedUrl,
  readUpdateReleaseNotesBaseUrl,
  UpdateService,
} from "./updater/UpdateService";

const isDev = isDevelopmentLaunch(app.isPackaged);
const UPDATE_WORK_STATE_MAX_AGE_MS = 10_000;

// Windows/Linux: only one instance of a download manager should ever run at
// once (a second launch — e.g. from a browser's "open with" — should just
// focus the existing window instead of starting a second download engine).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let progressWindow: BrowserWindow | null = null;
let manager: DownloadManager;
let updater: UpdateService | null = null;
let handoffServer: HandoffServer | null = null;
let rendererWorkState: { hasUnsavedWork: boolean; reason: string; receivedAt: number } | null = null;
const changelogHandlers = createChangelogIpcHandlers(
  new ChangelogStore(DEFAULT_CHANGELOG_ENTRIES, CHANGELOG_REPOSITORY_URL)
);

const appIconPath = path.join(__dirname, "../../build/icon.ico");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: "#16171d",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(resolveRendererPath(__dirname));
  }

  mainWindow.on("closed", () => {
    rendererWorkState = null;
    mainWindow = null;
  });
}

function createProgressWindow(itemId: string): boolean {
  const item = manager.getState().items.find((candidate) => candidate.id === itemId);
  if (!item) return false;

  if (progressWindow && !progressWindow.isDestroyed()) {
    if (progressWindow.isMinimized()) progressWindow.restore();
    progressWindow.show();
    progressWindow.focus();
    progressWindow.webContents.send(IPC.PROGRESS_TARGET_CHANGED, itemId);
    progressWindow.webContents.send(IPC.STATE_CHANGED, manager.getState());
    return true;
  }

  progressWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 720,
    minHeight: 460,
    show: false,
    frame: false,
    backgroundColor: "#16171d",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  progressWindow.once("ready-to-show", () => {
    progressWindow?.show();
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send(IPC.PROGRESS_TARGET_CHANGED, itemId);
      progressWindow.webContents.send(IPC.STATE_CHANGED, manager.getState());
    }
  });
  if (isDev) {
    const query = new URLSearchParams({ view: "progress", progressItem: itemId });
    progressWindow.loadURL(`http://localhost:5173/?${query.toString()}`);
  } else {
    progressWindow.loadFile(resolveRendererPath(__dirname), { query: { view: "progress", progressItem: itemId } });
  }
  progressWindow.on("closed", () => {
    progressWindow = null;
  });
  return true;
}

function assertTrustedSender(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }) {
  const trustedWindows = [mainWindow, progressWindow].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));
  const trustedWindow = trustedWindows.find((window) => window.webContents === event.sender);
  if (!trustedWindow) {
    throw new Error("Untrusted renderer IPC sender");
  }
  if (event.senderFrame && event.senderFrame !== trustedWindow.webContents.mainFrame) {
    throw new Error("Untrusted renderer IPC frame");
  }
}

function assertString(value: unknown, field: string, maxLength = 4_096): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertId(value: unknown): asserts value is string {
  assertString(value, "identifier", 256);
}

function assertHttpUrl(value: unknown): asserts value is string {
  assertString(value, "URL", 8_192);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Invalid download URL");
  }
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Invalid ${field}`);
}

function assertAddDownloadRequest(value: unknown): asserts value is AddDownloadRequest {
  assertRecord(value, "download request");
  assertHttpUrl(value.url);
  assertString(value.folder, "download folder", 32_768);
  assertString(value.fileName, "download file name", 512);
  if (value.queueId !== undefined && value.queueId !== null) assertId(value.queueId);
  if (typeof value.startImmediately !== "boolean") throw new Error("Invalid startImmediately");
  if (value.headers !== undefined) {
    assertRecord(value.headers, "download headers");
    for (const [key, headerValue] of Object.entries(value.headers)) {
      assertString(key, "header name", 256);
      assertString(headerValue, "header value", 8_192);
    }
  }
}

function assertCategoryPreviewInput(fileName: unknown, url: unknown): asserts fileName is string {
  assertString(fileName, "category preview file name", 512);
  if (typeof url !== "string" || url.length > 8_192) throw new Error("Invalid category preview URL");
}

function assertPartialSettings(value: unknown): asserts value is SettingsPatch {
  validateSettingsPatch(value);
}

function assertDownloadQueue(value: unknown): asserts value is DownloadQueue {
  assertQueueCreatePayload(value);
  if (
    value.id === undefined ||
    value.name === undefined ||
    value.maxConcurrent === undefined ||
    value.isRunning === undefined ||
    value.itemIds === undefined
  ) {
    throw new Error("Invalid queue");
  }
}

function broadcastState() {
  const state = manager.getState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.STATE_CHANGED, state);
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.STATE_CHANGED, state);
}

async function processBrowserHandoffs(commandLine: readonly string[]) {
  if (!manager) return;
  const settings = manager.getSettings();
  for (const request of extractBrowserHandoffRequests(commandLine)) {
    try {
      await manager.addDownload({
        ...request,
        folder: request.folder || settings.defaultSaveFolder,
        fileName: request.fileName || "download",
      });
    } catch (error) {
      console.warn(`Browser handoff could not be queued: ${error instanceof Error ? error.message : "unknown failure"}`);
    }
  }
}

function updateFallbackState(): UpdateState {
  return {
    status: "failed",
    version: app.getVersion(),
    releaseNotesUrl: null,
    checkedAt: Date.now(),
    message: "Updates are not available until the unsigned HTTPS feed is configured.",
  };
}

function getUpdateState(): UpdateState {
  return updater?.getState() ?? updateFallbackState();
}

function broadcastUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC.UPDATE_STATE_CHANGED, getUpdateState());
}

function installGuardFailure(): string | null {
  if (!rendererWorkState) {
    return "Restart is blocked until the renderer confirms that no work is unsaved.";
  }
  if (rendererWorkState.receivedAt + UPDATE_WORK_STATE_MAX_AGE_MS < Date.now()) {
    return "Restart is blocked because the unsaved-work check is stale.";
  }
  if (rendererWorkState.hasUnsavedWork) return rendererWorkState.reason;
  return null;
}

function registerIpcHandlers() {
  ipcMain.handle(IPC.GET_STATE, (event) => {
    assertTrustedSender(event);
    return manager.getState();
  });

  ipcMain.handle(IPC.PROBE_URL, (event, url: unknown) => {
    assertTrustedSender(event);
    assertHttpUrl(url);
    return manager.probeUrl(url);
  });

  ipcMain.handle(IPC.PREVIEW_CATEGORY, (event, fileName: unknown, url: unknown) => {
    assertTrustedSender(event);
    assertCategoryPreviewInput(fileName, url);
    return manager.previewCategory(fileName, url as string);
  });

  ipcMain.handle(
    IPC.EVALUATE_REGEX,
    (event, pattern: unknown, flags: unknown, samples: unknown, includeMatches: unknown) => {
      assertTrustedSender(event);
      const request = normalizeRegexEvaluationRequest(pattern, flags, samples, includeMatches);
      return evaluateRegexBatchIsolated(request.pattern, request.flags, request.samples, request.includeMatches);
    }
  );

  ipcMain.handle(IPC.ADD_DOWNLOAD, (event, req: unknown) => {
    assertTrustedSender(event);
    assertAddDownloadRequest(req);
    return manager.addDownload(req);
  });

  ipcMain.handle(IPC.PAUSE, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.pause(id);
  });
  ipcMain.handle(IPC.RESUME, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.resume(id);
  });
  ipcMain.handle(IPC.CANCEL, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.cancel(id);
  });
  ipcMain.handle(IPC.REMOVE, (event, id: unknown, deleteFile: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    if (typeof deleteFile !== "boolean") throw new Error("Invalid deleteFile");
    return manager.remove(id, deleteFile);
  });
  ipcMain.handle(IPC.RETRY, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.retry(id);
  });

  ipcMain.handle(IPC.OPEN_FILE, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.openFile(id);
  });
  ipcMain.handle(IPC.OPEN_FOLDER, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.openFolder(id);
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrustedSender(event);
    return manager.getSettings();
  });
  ipcMain.handle(IPC.SETTINGS_SET, (event, settings: unknown, resetKeys: unknown = []) => {
    assertTrustedSender(event);
    assertPartialSettings(settings);
    const validatedResetKeys: SettingKey[] = validateSettingResetKeys(resetKeys);
    if (validatedResetKeys.some((key) => Object.prototype.hasOwnProperty.call(settings, key))) {
      throw new Error("A setting cannot be changed and reset in the same mutation");
    }
    return manager.setSettings(settings, validatedResetKeys);
  });

  ipcMain.handle(IPC.HISTORY_GET_VIEW, (event, filter: unknown) => {
    assertTrustedSender(event);
    const normalized = normalizeHistoryFilter(filter);
    return manager.getHistoryView(normalized);
  });
  ipcMain.handle(IPC.HISTORY_EXPORT_VIEW, (event, format: unknown, filter: unknown) => {
    assertTrustedSender(event);
    if (!isExportFormat(format)) throw new Error("Invalid history export format");
    const normalized = normalizeHistoryFilter(filter);
    return manager.exportHistory(format, normalized);
  });

  ipcMain.handle(IPC.CHANGELOG_GET_VIEW, (event, request: unknown) => {
    assertTrustedSender(event);
    return changelogHandlers.getView(request);
  });
  ipcMain.handle(IPC.CHANGELOG_EXPORT_VIEW, (event, format: unknown, request: unknown) => {
    assertTrustedSender(event);
    return changelogHandlers.exportView(request, format);
  });

  ipcMain.handle(IPC.QUEUE_CREATE, (event, queue: unknown) => {
    assertTrustedSender(event);
    assertQueueCreatePayload(queue);
    return manager.createQueue(queue);
  });
  ipcMain.handle(IPC.QUEUE_UPDATE, (event, queue: unknown) => {
    assertTrustedSender(event);
    assertDownloadQueue(queue);
    return manager.updateQueue(queue);
  });
  ipcMain.handle(IPC.QUEUE_DELETE, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.deleteQueue(id);
  });
  ipcMain.handle(IPC.QUEUE_START, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.startQueue(id);
  });
  ipcMain.handle(IPC.QUEUE_STOP, (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return manager.stopQueue(id);
  });

  ipcMain.handle(IPC.PICK_FOLDER, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    assertTrustedSender(event);
    mainWindow?.minimize();
  });
  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
    assertTrustedSender(event);
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    assertTrustedSender(event);
    mainWindow?.close();
  });
  ipcMain.handle(IPC.PROGRESS_OPEN, (event, itemId: unknown) => {
    assertTrustedSender(event);
    assertId(itemId);
    return createProgressWindow(itemId);
  });
  ipcMain.on(IPC.PROGRESS_MINIMIZE, (event) => {
    assertTrustedSender(event);
    progressWindow?.minimize();
  });
  ipcMain.on(IPC.PROGRESS_CLOSE, (event) => {
    assertTrustedSender(event);
    progressWindow?.close();
  });

  ipcMain.handle(IPC.UPDATE_GET_STATE, (event) => {
    assertTrustedSender(event);
    return getUpdateState();
  });
  ipcMain.handle(IPC.UPDATE_CHECK, async (event) => {
    assertTrustedSender(event);
    return updater ? updater.checkForUpdates() : getUpdateState();
  });
  ipcMain.handle(IPC.UPDATE_SET_UNSAVED_WORK, (event, state: unknown) => {
    assertTrustedSender(event);
    if (!isUpdateUnsavedWorkState(state)) throw new Error("Invalid unsaved-work state");
    rendererWorkState = { ...state, receivedAt: Date.now() };
  });
  ipcMain.handle(IPC.UPDATE_INSTALL, (event): UpdateInstallResult => {
    assertTrustedSender(event);
    const guardFailure = installGuardFailure();
    if (guardFailure) return { started: false, reason: guardFailure };
    if (!updater) return { started: false, reason: "The updater is not available." };
    const started = updater.quitAndInstall();
    return {
      started,
      reason: started ? null : "The staged update is no longer ready or could not be installed.",
    };
  });
  ipcMain.handle(IPC.UPDATE_OPEN_RELEASE_NOTES, async (event) => {
    assertTrustedSender(event);
    const releaseNotesUrl = normalizeReleaseNotesUrl(updater?.getReleaseNotesUrl());
    if (!releaseNotesUrl) return false;
    try {
      await shell.openExternal(releaseNotesUrl);
      return true;
    } catch {
      return false;
    }
  });
}

const nativeCompletionNotifications: CompletionNotificationPort = {
  isSupported: () => Notification.isSupported(),
  show: (options) => new Notification(options).show(),
};

function notifyDownloadComplete(item: DownloadItem) {
  showCompletionNotification(item, manager.getSettings(), nativeCompletionNotifications, appIconPath);
}

function startUpdater() {
  updater = new UpdateService({
    adapter: autoUpdater,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    supportedPlatform: process.platform === "win32",
    feedUrl: readUpdateFeedUrl(),
    releaseNotesBaseUrl: readUpdateReleaseNotesBaseUrl(),
    canInstall: () => installGuardFailure() === null,
  });
  updater.onStateChanged(broadcastUpdateState);
  updater.start();
}

app.on("second-instance", (_event, commandLine) => {
  void processBrowserHandoffs(commandLine);
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  manager = new DownloadManager(app.getPath("userData"));
  await manager.init();
  manager.on("stateChanged", broadcastState);
  manager.on("itemCompleted", notifyDownloadComplete);
  await processBrowserHandoffs(process.argv);
  handoffServer = new HandoffServer({
    manager,
    logger: (message) => console.warn(message),
  });
  await handoffServer.start();
  app.setLoginItemSettings({ openAtLogin: manager.getSettings().startOnSystemStartup });

  registerIpcHandlers();
  createWindow();
  startUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await handoffServer?.stop();
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  await manager?.shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  updater?.stop();
  if (manager && !manager.isShutDown) {
    e.preventDefault();
    await handoffServer?.stop();
    if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
    await manager.shutdown();
    app.quit();
  }
});

// Re-export shell for use by DownloadManager without needing its own import cycle issues.
export { shell };
