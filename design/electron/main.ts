import { app, autoUpdater, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, type OpenDialogOptions } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  createBrowserExtensionInstallResult,
  IPC,
  type BrowserChromeExtensionsResult,
  type BrowserExtensionInstallState,
  isUpdateUnsavedWorkState,
  type PresentationPatch,
  type PresentationSettings,
  type UpdateInstallResult,
  type UpdateState,
} from "../shared/types";
import {
  installBrowserExtension,
  browserExtensionInstallState,
  installedExtensionPath,
  openChromeExtensionsPage,
  resolveBundledExtensionRoot,
} from "./extension/installExtension";
import { createExtensionCapability } from "./extension/ExtensionCapabilityVault";
import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffDecision,
  BrowserHandoffStart,
  DownloadCompletionNotice,
  DownloadItem,
  DownloadQueue,
  SettingKey,
  SettingsPatch,
} from "../shared/types";
import { isScheduledSettingsRecords, type ScheduledSettingsRecord } from "../shared/scheduledSettings";
import { isExportFormat } from "../shared/export";
import {
  normalizeHistoryFilter,
  normalizeHistoryLabel,
  normalizeHistoryPruneRequest,
  normalizeHistoryRevisionId,
} from "../shared/history";
import {
  isTotpRegistrationMetadata,
  normalizeTotpRegistration,
  type TotpRegistrationMetadata,
  type TotpRegistrationInput,
} from "../shared/authenticator";
import {
  validatePresentationPatch,
  validatePresentationResetKeys,
  validateSettingResetKeys,
  validateSettingsPatch,
  isValidDefaultSaveFolder,
} from "../shared/settings";
import {
  isSshHostDraft,
  isSshHostKeyScanResult,
  isSshHostStatus,
  isSshProvisionResult,
  normalizeSshPrivateKeyCredential,
  type SshHostDraft,
} from "../shared/ssh";
import type { SshHostConfig } from "../shared/types";
import { isDistributedDownloadSelection, isDistributedRequestHeaders } from "../shared/distributedProtocol";
import {
  normalizeRegexEvaluationRequest,
} from "../shared/regex";
import { extractBrowserHandoffRequests } from "./download/browserHandoff";
import { assertQueueCreatePayload, DownloadManager } from "./download/DownloadManager";
import { HandoffServer } from "./extension/HandoffServer";
import { ExtensionCapabilityVault } from "./extension/ExtensionCapabilityVault";
import { evaluateRegexBatchIsolated } from "./regex/RegexWorkerClient";
import {
  CHANGELOG_REPOSITORY_URL,
  ChangelogStore,
  createChangelogIpcHandlers,
  DEFAULT_CHANGELOG_ENTRIES,
} from "./history/ChangelogStore";
import { HistoryAccessVault } from "./history/HistoryAccessVault";
import { HistoryAccessSession } from "./history/HistoryAccessSession";
import { SchoolModeResetVault } from "./schoolMode/SchoolModeResetVault";
import { SchoolModeCredentialService } from "./schoolMode/SchoolModeCredentialService";
import { TotpRegistrationService } from "./authenticator/TotpRegistrationService";
import { ExternalEditorService } from "./externalEditor/ExternalEditorService";
import {
  EXTERNAL_EDITOR_MAX_EXPORT_BYTES,
  isExternalEditorOpenResult,
  isSafeEditorExecutable,
  isSafeExportFileName,
} from "../shared/externalEditor";
import { isDevelopmentLaunch, resolveRendererPath } from "./runtimePaths";
import { CredentialVault } from "./download/distributed/CredentialVault";
import { SshProvisioningService } from "./download/distributed/SshProvisioningService";
import { SshWorkerClient } from "./download/distributed/SshWorkerClient";
import {
  normalizeReleaseNotesUrl,
  readUpdateFeedUrl,
  readUpdateReleaseNotesBaseUrl,
  UpdateService,
} from "./updater/UpdateService";
import { OllamaSuiteStore } from "./ollama/OllamaSuiteStore";
import { ConverterService } from "./converter/ConverterService";
import { isConverterAdapterId, type ConverterState } from "../shared/converter";
import { LogoCustomizationStore, type PreparedLogoVersion } from "./logo/LogoCustomizationStore";
import { cloneAppLogoSettings, DEFAULT_APP_LOGO_SETTINGS, isAppLogoSettings, type AppLogoSettings } from "../shared/appLogo";
import { PersonalVocabularyStore } from "./personalVocabulary/PersonalVocabularyStore";
import { createPersonalVocabularyRuntime, type PersonalVocabularyRuntime } from "../shared/personalVocabulary";

const isDev = isDevelopmentLaunch(app.isPackaged);
const UPDATE_WORK_STATE_MAX_AGE_MS = 10_000;
const FILE_MANAGER_OPEN_TIMEOUT_MS = 3_000;
const COMPLETION_WINDOW_DISMISS_MS = 10_000;
const BROWSER_HANDOFF_START_READY_TIMEOUT_MS = 8_000;

async function openPathWithTimeout(folderPath: string): Promise<string> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      shell.openPath(folderPath),
      new Promise<string>((resolve) => {
        timeoutHandle = setTimeout(() => resolve("The file-manager open request timed out."), FILE_MANAGER_OPEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// Windows/Linux: only one instance of a download manager should ever run at
// once (a second launch — e.g. from a browser's "open with" — should just
// focus the existing window instead of starting a second download engine).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let progressWindow: BrowserWindow | null = null;
let completionWindow: BrowserWindow | null = null;
let completionNotice: DownloadCompletionNotice | null = null;
let completionWindowDismissTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
const browserHandoffWindows = new Map<string, BrowserWindow>();
const settledBrowserHandoffWindows = new Set<string>();
const browserHandoffExpiryTimers = new Map<string, NodeJS.Timeout>();
let showMainWhenReady = false;
let quitting = false;
let manager: DownloadManager;
let sshVault: CredentialVault;
let sshWorkerClient: SshWorkerClient;
let sshProvisioning: SshProvisioningService;
let extensionCapabilityVault: ExtensionCapabilityVault;
let historyAccessVault: HistoryAccessVault;
let schoolModeCredentialService: SchoolModeCredentialService;
let authenticatorService: TotpRegistrationService;
let externalEditorService: ExternalEditorService;
let ollamaSuiteStore: OllamaSuiteStore;
let converterService: ConverterService;
let logoCustomizationStore: LogoCustomizationStore;
let personalVocabularyStore: PersonalVocabularyStore;
const historyAccessSession = new HistoryAccessSession();
let updater: UpdateService | null = null;
let handoffServer: HandoffServer | null = null;
let rendererWorkState: { hasUnsavedWork: boolean; reason: string; receivedAt: number } | null = null;
const changelogHandlers = createChangelogIpcHandlers(
  new ChangelogStore(DEFAULT_CHANGELOG_ENTRIES, CHANGELOG_REPOSITORY_URL)
);

// The installed identity icon is immutable and packaged separately from the
// userData logo cache. Custom app-logo choices only affect renderer chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "app-icon.ico")
  : path.join(__dirname, "../../build/icon.ico");

function showMainWindow() {
  showMainWhenReady = true;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  tray = new Tray(appIconPath);
  tray.setToolTip("Material Download Manager");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Material Download Manager", click: showMainWindow },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("click", showMainWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    show: false,
    skipTaskbar: true,
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

  mainWindow.once("ready-to-show", () => {
    if (showMainWhenReady) showMainWindow();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PRESENTATION_CHANGED, manager.getPresentationSettings());
      mainWindow.webContents.send(IPC.SCHEDULE_CHANGED, manager.getScheduleRules());
      void getRendererPersonalVocabularyRuntime().then((runtime) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.PERSONAL_VOCABULARY_CHANGED, runtime);
      });
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(resolveRendererPath(__dirname));
  }

  mainWindow.on("closed", () => {
    if (mainWindow) historyAccessSession.remove(mainWindow.webContents.id);
    rendererWorkState = null;
    mainWindow = null;
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
    mainWindow?.setSkipTaskbar(true);
  });
}

function closeBrowserHandoffWindow(handoffId: string) {
  const window = browserHandoffWindows.get(handoffId);
  if (!window || window.isDestroyed()) return;
  settledBrowserHandoffWindows.add(handoffId);
  window.close();
}

function closeCompletionWindow() {
  if (completionWindowDismissTimer) {
    clearTimeout(completionWindowDismissTimer);
    completionWindowDismissTimer = null;
  }
  const window = completionWindow;
  completionWindow = null;
  completionNotice = null;
  if (window && !window.isDestroyed()) window.close();
}

function completionNoticeForSender(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }): DownloadCompletionNotice {
  assertTrustedSender(event);
  if (!completionWindow || completionWindow.isDestroyed() || completionWindow.webContents !== event.sender || !completionNotice) {
    throw new Error("Download completion notice is no longer available.");
  }
  return completionNotice;
}

function createCompletionWindow(item: Pick<DownloadItem, "fileName">): void {
  if (!manager.getSettings().showCompleteDialog) return;
  closeCompletionWindow();

  const createdCompletionWindow = new BrowserWindow({
    width: 420,
    height: 180,
    minWidth: 360,
    minHeight: 156,
    show: false,
    skipTaskbar: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: "#16171d",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  completionWindow = createdCompletionWindow;
  completionNotice = { fileName: item.fileName };
  createdCompletionWindow.setAlwaysOnTop(true, "floating");
  createdCompletionWindow.once("ready-to-show", () => {
    if (completionWindow === createdCompletionWindow && !createdCompletionWindow.isDestroyed()) {
      // Completion is visible above other windows without taking focus from
      // active work or turning the ordinary progress monitor into a topmost surface.
      createdCompletionWindow.showInactive();
    }
  });
  if (isDev) {
    const query = new URLSearchParams({ view: "completion" });
    createdCompletionWindow.loadURL(`http://localhost:5173/?${query.toString()}`);
  } else {
    createdCompletionWindow.loadFile(resolveRendererPath(__dirname), { query: { view: "completion" } });
  }
  createdCompletionWindow.on("closed", () => {
    if (completionWindow !== createdCompletionWindow) return;
    completionWindow = null;
    completionNotice = null;
    if (completionWindowDismissTimer) {
      clearTimeout(completionWindowDismissTimer);
      completionWindowDismissTimer = null;
    }
  });
  completionWindowDismissTimer = setTimeout(() => {
    if (completionWindow === createdCompletionWindow) closeCompletionWindow();
  }, COMPLETION_WINDOW_DISMISS_MS);
}

function browserHandoffIdForSender(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }): string {
  assertTrustedSender(event);
  for (const [handoffId, window] of browserHandoffWindows) {
    if (!window.isDestroyed() && window.webContents === event.sender) return handoffId;
  }
  throw new Error("Browser handoff decision required");
}

async function createBrowserHandoffStartWindow(handoff: BrowserHandoffStart): Promise<boolean> {
  const existing = browserHandoffWindows.get(handoff.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return true;
  }

  const handoffWindow = new BrowserWindow({
    width: 568,
    height: 431,
    minWidth: 460,
    minHeight: 360,
    show: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: "#16171d",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  handoffWindow.setAlwaysOnTop(true, "floating");
  browserHandoffWindows.set(handoff.id, handoffWindow);
  browserHandoffExpiryTimers.set(handoff.id, setTimeout(() => {
    const decision = handoffServer?.getBrowserHandoffDecision(handoff.id);
    if (decision?.state === "expired") closeBrowserHandoffWindow(handoff.id);
  }, Math.max(0, handoff.expiresAt - Date.now() + 25)));
  handoffWindow.on("close", () => {
    const expiryTimer = browserHandoffExpiryTimers.get(handoff.id);
    if (expiryTimer) clearTimeout(expiryTimer);
    browserHandoffExpiryTimers.delete(handoff.id);
    browserHandoffWindows.delete(handoff.id);
    const wasSettled = settledBrowserHandoffWindows.delete(handoff.id);
    if (!wasSettled) handoffServer?.rejectBrowserHandoff(handoff.id);
  });

  // A pending protocol response is only useful if the decision the browser is
  // waiting for is actually visible. Treat a renderer failure, a destroyed
  // window, or an unready window as delivery failure so the extension resumes
  // the original Chrome download instead of leaving it paused without UI.
  let failDelivery = () => {};
  const delivered = await new Promise<boolean>((resolve) => {
    let settled = false;
    let readyTimeout: NodeJS.Timeout | null = null;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (readyTimeout) clearTimeout(readyTimeout);
      handoffWindow.removeListener("ready-to-show", showWhenReady);
      handoffWindow.removeListener("closed", failWhenClosed);
      handoffWindow.webContents.removeListener("did-fail-load", failWhenUnready);
      handoffWindow.webContents.removeListener("render-process-gone", failWhenUnready);
      resolve(value);
    };
    const closeAfterFailure = () => {
      finish(false);
      if (!handoffWindow.isDestroyed()) handoffWindow.close();
    };
    const showWhenReady = () => {
      if (handoffWindow.isDestroyed()) {
        closeAfterFailure();
        return;
      }
      handoffWindow.show();
      handoffWindow.focus();
      finish(true);
    };
    const failWhenUnready = () => closeAfterFailure();
    const failWhenClosed = () => finish(false);
    failDelivery = closeAfterFailure;
    handoffWindow.once("ready-to-show", showWhenReady);
    handoffWindow.once("closed", failWhenClosed);
    handoffWindow.webContents.once("did-fail-load", failWhenUnready);
    handoffWindow.webContents.once("render-process-gone", failWhenUnready);
    readyTimeout = setTimeout(closeAfterFailure, BROWSER_HANDOFF_START_READY_TIMEOUT_MS);
    const query = new URLSearchParams({ view: "browser-handoff", handoffId: handoff.id });
    const load = isDev
      ? handoffWindow.loadURL(`http://localhost:5173/?${query.toString()}`)
      : handoffWindow.loadFile(resolveRendererPath(__dirname), { query: { view: "browser-handoff", handoffId: handoff.id } });
    void load.catch(failDelivery);
  });
  return delivered;
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
    progressWindow.webContents.send(IPC.PRESENTATION_CHANGED, manager.getPresentationSettings());
    progressWindow.webContents.send(IPC.SCHEDULE_CHANGED, manager.getScheduleRules());
    void getRendererPersonalVocabularyRuntime().then((runtime) => {
      if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.PERSONAL_VOCABULARY_CHANGED, runtime);
    });
    return true;
  }

  const createdProgressWindow = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 720,
    minHeight: 460,
    show: false,
    // This is an ordinary, reopenable monitor. Closing it never cancels the
    // background transfer and it must not cover unrelated application work.
    alwaysOnTop: false,
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

  progressWindow = createdProgressWindow;
  createdProgressWindow.once("ready-to-show", () => {
    createdProgressWindow.show();
    if (!createdProgressWindow.isDestroyed()) {
      createdProgressWindow.webContents.send(IPC.PROGRESS_TARGET_CHANGED, itemId);
      createdProgressWindow.webContents.send(IPC.STATE_CHANGED, manager.getState());
      createdProgressWindow.webContents.send(IPC.PRESENTATION_CHANGED, manager.getPresentationSettings());
      createdProgressWindow.webContents.send(IPC.SCHEDULE_CHANGED, manager.getScheduleRules());
      void getRendererPersonalVocabularyRuntime().then((runtime) => {
        if (!createdProgressWindow.isDestroyed()) createdProgressWindow.webContents.send(IPC.PERSONAL_VOCABULARY_CHANGED, runtime);
      });
    }
  });
  if (isDev) {
    const query = new URLSearchParams({ view: "progress", progressItem: itemId });
    createdProgressWindow.loadURL(`http://localhost:5173/?${query.toString()}`);
  } else {
    createdProgressWindow.loadFile(resolveRendererPath(__dirname), { query: { view: "progress", progressItem: itemId } });
  }
  createdProgressWindow.on("closed", () => {
    historyAccessSession.remove(createdProgressWindow.webContents.id);
    if (progressWindow === createdProgressWindow) progressWindow = null;
  });
  return true;
}

function assertTrustedSender(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }) {
  const trustedWindows = [mainWindow, progressWindow, completionWindow, ...browserHandoffWindows.values()]
    .filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));
  const trustedWindow = trustedWindows.find((window) => window.webContents === event.sender);
  if (!trustedWindow) {
    throw new Error("Untrusted renderer IPC sender");
  }
  if (event.senderFrame && event.senderFrame !== trustedWindow.webContents.mainFrame) {
    throw new Error("Untrusted renderer IPC frame");
  }
}

function assertHistoryUnlocked(event: { sender: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null }) {
  assertTrustedSender(event);
  historyAccessSession.assertUnlocked(event.sender.id);
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
  if (value.ssh !== undefined && value.ssh !== null && !isDistributedDownloadSelection(value.ssh)) {
    throw new Error("Invalid distributed SSH selection");
  }
  if (value.ssh !== undefined && value.ssh !== null && value.headers !== undefined && !isDistributedRequestHeaders(value.headers)) {
    throw new Error("Invalid distributed SSH headers");
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

function broadcastPresentation(presentation: PresentationSettings) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.PRESENTATION_CHANGED, presentation);
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.PRESENTATION_CHANGED, presentation);
  void getRendererPersonalVocabularyRuntime(presentation.schoolModeEnabled).then(broadcastPersonalVocabulary).catch(() => {
    broadcastPersonalVocabulary(createPersonalVocabularyRuntime());
  });
}

function broadcastScheduleRules(records: ScheduledSettingsRecord[]) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.SCHEDULE_CHANGED, records);
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.SCHEDULE_CHANGED, records);
}

function broadcastConverterState(state: ConverterState) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.CONVERTER_STATE_CHANGED, state);
}

function logoPickerCopy(settings: AppSettings): { title: string; filterName: string } {
  const english = { title: "Choose a local app logo", filterName: "Still images" };
  const cantonese = { title: "揀本機應用程式標誌", filterName: "靜態圖片" };
  if (settings.schoolModeEnabled || settings.languageMode === "english") return english;
  if (settings.languageMode === "cantonese") return cantonese;
  return {
    title: `${english.title} · ${cantonese.title}`,
    filterName: `${english.filterName} · ${cantonese.filterName}`,
  };
}

function broadcastPersonalVocabulary(runtime: PersonalVocabularyRuntime) {
  const visibleRuntime = manager.getSettings().schoolModeEnabled ? createPersonalVocabularyRuntime() : runtime;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.PERSONAL_VOCABULARY_CHANGED, visibleRuntime);
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.PERSONAL_VOCABULARY_CHANGED, visibleRuntime);
}

async function getRendererPersonalVocabularyRuntime(schoolModeEnabled = manager.getSettings().schoolModeEnabled): Promise<PersonalVocabularyRuntime> {
  return schoolModeEnabled
    ? createPersonalVocabularyRuntime()
    : personalVocabularyStore.getRuntime();
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
  // Inventory writes are whole-array read/modify/persist operations.  A
  // per-host lock is not enough: a host A scan can otherwise overwrite a
  // concurrent host B provision/remove with its stale snapshot.  Serialize
  // the complete lifecycle boundary while the remote operation is in flight.
  let sshHostMutationTail = Promise.resolve();
  async function withSshHostMutation<T>(_hostId: string, operation: () => Promise<T>): Promise<T> {
    const previous = sshHostMutationTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const next = previous.then(() => gate);
    sshHostMutationTail = next;
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  // Image conversion writes a versioned private cache and settings persistence
  // writes state/history. Serialize the whole prepare → persist → activate
  // transaction so concurrent controls cannot cross-wire their manifests.
  let logoMutationTail = Promise.resolve();
  async function withLogoMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = logoMutationTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    logoMutationTail = previous.then(() => gate);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function restorePriorLogoSetting(previous: AppSettings): Promise<void> {
    if (previous.settingProvenance.appLogo === "compiled-in") {
      await manager.setSettings({}, ["appLogo"]);
      return;
    }
    await manager.setSettings({ appLogo: previous.appLogo });
  }

  async function activatePreparedLogo(previous: AppSettings, prepared: PreparedLogoVersion) {
    let persisted = false;
    try {
      await manager.setSettings({ appLogo: prepared.settings });
      persisted = true;
      await logoCustomizationStore.commitPrepared(prepared);
    } catch {
      await logoCustomizationStore.discardPrepared(prepared);
      if (persisted) await restorePriorLogoSetting(previous).catch(() => undefined);
      throw new Error("The local image was not applied; the previous valid logo remains active.");
    }
    broadcastState();
    return logoCustomizationStore.getSnapshot(prepared.settings);
  }

  async function activatePresetLogo(previous: AppSettings, next: AppLogoSettings, resetToCompiledDefault: boolean) {
    const clear = await logoCustomizationStore.prepareClear();
    let persisted = false;
    try {
      if (resetToCompiledDefault) await manager.setSettings({}, ["appLogo"]);
      else await manager.setSettings({ appLogo: next });
      persisted = true;
      await logoCustomizationStore.commitClear(clear);
    } catch {
      await logoCustomizationStore.rollbackClear(clear).catch(() => undefined);
      if (persisted) await restorePriorLogoSetting(previous).catch(() => undefined);
      throw new Error("The logo reset was not applied; the previous valid logo remains active.");
    }
    broadcastState();
    return logoCustomizationStore.getSnapshot(manager.getSettings().appLogo);
  }

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

  ipcMain.handle(IPC.EXTENSION_INSTALL, async (event) => {
    assertTrustedSender(event);
    const sourceRoot = resolveBundledExtensionRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
    });
    const capability = createExtensionCapability();
    const previousCapability = await extensionCapabilityVault.load();
    const installedPath = await installBrowserExtension(
      sourceRoot,
      app.getPath("userData"),
      capability,
      () => extensionCapabilityVault.write(capability),
      previousCapability ? () => extensionCapabilityVault.write(previousCapability) : undefined,
    );
    return createBrowserExtensionInstallResult(installedPath, openPathWithTimeout);
  });

  ipcMain.handle(IPC.EXTENSION_STATE, async (event): Promise<BrowserExtensionInstallState> => {
    assertTrustedSender(event);
    return browserExtensionInstallState(app.getPath("userData"), await extensionCapabilityVault.load());
  });

  ipcMain.handle(IPC.EXTENSION_OPEN_CHROME, async (event): Promise<BrowserChromeExtensionsResult> => {
    assertTrustedSender(event);
    return openChromeExtensionsPage((url) => shell.openExternal(url));
  });

  ipcMain.handle(IPC.EXTENSION_REVEAL, async (event) => {
    assertTrustedSender(event);
    const installedPath = await installedExtensionPath(app.getPath("userData"), await extensionCapabilityVault.load());
    if (!installedPath) {
      throw new Error("The browser extension has not been installed from this app yet.");
    }
    const failure = await openPathWithTimeout(installedPath);
    if (failure) throw new Error(failure);
  });

  ipcMain.handle(IPC.PERSONAL_VOCABULARY_GET, async (event) => {
    assertTrustedSender(event);
    return getRendererPersonalVocabularyRuntime();
  });
  ipcMain.handle(IPC.PERSONAL_VOCABULARY_CHOOSE, async (event) => {
    assertTrustedSender(event);
    if (manager.getSettings().schoolModeEnabled || !mainWindow) return getRendererPersonalVocabularyRuntime();
    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return getRendererPersonalVocabularyRuntime();
    return personalVocabularyStore.replaceFromFile(picked.filePaths[0]);
  });
  ipcMain.handle(IPC.PERSONAL_VOCABULARY_CLEAR, async (event) => {
    assertTrustedSender(event);
    if (manager.getSettings().schoolModeEnabled) return getRendererPersonalVocabularyRuntime();
    return personalVocabularyStore.clear();
  });

  ipcMain.handle(IPC.OLLAMA_GET_STATE, (event) => {
    assertTrustedSender(event);
    return ollamaSuiteStore.getState();
  });
  ipcMain.handle(IPC.OLLAMA_ADD_PROVIDER, async (event, input: unknown) => {
    assertTrustedSender(event);
    return ollamaSuiteStore.addProvider(input);
  });
  ipcMain.handle(IPC.OLLAMA_REMOVE_PROVIDER, async (event, id: unknown) => {
    assertTrustedSender(event);
    if (typeof id !== "string") throw new Error("Invalid Ollama provider identifier");
    return ollamaSuiteStore.removeProvider(id);
  });
  ipcMain.handle(IPC.OLLAMA_REFRESH_PROVIDER, async (event, id: unknown) => {
    assertTrustedSender(event);
    if (typeof id !== "string") throw new Error("Invalid Ollama provider identifier");
    return ollamaSuiteStore.refreshProvider(id);
  });
  ipcMain.handle(IPC.OLLAMA_EXPORT_METADATA, (event, format: unknown) => {
    assertTrustedSender(event);
    if (!isExportFormat(format)) throw new Error("Unsupported Ollama metadata export format");
    return ollamaSuiteStore.exportMetadata(format);
  });
  ipcMain.handle(IPC.OLLAMA_IMPORT_METADATA, async (event, value: unknown) => {
    assertTrustedSender(event);
    return ollamaSuiteStore.importMetadata(value);
  });
  ipcMain.handle(IPC.OLLAMA_RESET_STATE, async (event) => {
    assertTrustedSender(event);
    return ollamaSuiteStore.reset();
  });

  ipcMain.handle(IPC.CONVERTER_GET_STATE, async (event) => {
    assertTrustedSender(event);
    return converterService.getState();
  });
  ipcMain.handle(IPC.CONVERTER_PICK_SOURCES, async (event) => {
    assertTrustedSender(event);
    const sourceDialogOptions: OpenDialogOptions = {
      title: "Choose local files to convert",
      properties: ["openFile", "multiSelections"],
    };
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, sourceDialogOptions)
      : await dialog.showOpenDialog(sourceDialogOptions);
    if (selected.canceled || selected.filePaths.length === 0) return converterService.getState();
    return converterService.stageSources(selected.filePaths);
  });
  ipcMain.handle(IPC.CONVERTER_CLEAR_STAGED, async (event) => {
    assertTrustedSender(event);
    return converterService.clearStagedSources();
  });
  ipcMain.handle(IPC.CONVERTER_QUEUE_STAGED, async (event, adapterId: unknown) => {
    assertTrustedSender(event);
    if (!isConverterAdapterId(adapterId)) throw new Error("Unknown converter adapter.");
    const destinationDialogOptions: OpenDialogOptions = {
      title: "Choose a local output folder",
      properties: ["openDirectory", "createDirectory"],
    };
    const destination = mainWindow
      ? await dialog.showOpenDialog(mainWindow, destinationDialogOptions)
      : await dialog.showOpenDialog(destinationDialogOptions);
    if (destination.canceled || destination.filePaths.length === 0) return converterService.getState();
    return converterService.queueStagedSources(adapterId, destination.filePaths[0]!);
  });
  ipcMain.handle(IPC.CONVERTER_PAUSE_QUEUE, async (event) => {
    assertTrustedSender(event);
    return converterService.pauseQueue();
  });
  ipcMain.handle(IPC.CONVERTER_RESUME_QUEUE, async (event) => {
    assertTrustedSender(event);
    return converterService.resumeQueue();
  });
  ipcMain.handle(IPC.CONVERTER_CANCEL_JOB, async (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return converterService.cancelJob(id);
  });
  ipcMain.handle(IPC.CONVERTER_RETRY_JOB, async (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    return converterService.retryJob(id);
  });
  ipcMain.handle(IPC.CONVERTER_OPEN_RESULT, async (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    const outputPath = await converterService.outputPathForJob(id);
    if (!outputPath) throw new Error("No validated converter output is available for this job.");
    const failure = await openPathWithTimeout(outputPath);
    if (failure) throw new Error("The validated converter output could not be opened.");
    return true;
  });
  ipcMain.handle(IPC.CONVERTER_OPEN_RESULT_IN_EDITOR, async (event, id: unknown) => {
    assertTrustedSender(event);
    assertId(id);
    const outputPath = await converterService.outputPathForJob(id);
    if (!outputPath) throw new Error("No validated converter output is available for this job.");
    const result = await externalEditorService.openWorkspace(path.dirname(outputPath), manager.getSettings().externalEditorPath);
    return result.opened;
  });
  ipcMain.handle(IPC.CONVERTER_EXPORT_HISTORY, async (event, format: unknown) => {
    assertTrustedSender(event);
    if (!isExportFormat(format)) throw new Error("Unsupported converter history export format.");
    return converterService.exportHistory(format);
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrustedSender(event);
    return manager.getSettings();
  });
  ipcMain.handle(IPC.SETTINGS_SET, (event, settings: unknown, resetKeys: unknown = []) => {
    assertTrustedSender(event);
    assertPartialSettings(settings);
    const validatedResetKeys: SettingKey[] = validateSettingResetKeys(resetKeys);
    if (Object.prototype.hasOwnProperty.call(settings, "appLogo") || validatedResetKeys.includes("appLogo")) {
      throw new Error("App-logo configuration has a dedicated validated image lifecycle.");
    }
    if (validatedResetKeys.includes("sshHosts")) {
      throw new Error("The managed SSH host inventory has a dedicated lifecycle boundary");
    }
    if (validatedResetKeys.some((key) => Object.prototype.hasOwnProperty.call(settings, key))) {
      throw new Error("A setting cannot be changed and reset in the same mutation");
    }
    return manager.setSettings(settings, validatedResetKeys);
  });

  ipcMain.handle(IPC.LOGO_GET, async (event) => {
    assertTrustedSender(event);
    return logoCustomizationStore.getSnapshot(manager.getSettings().appLogo);
  });
  ipcMain.handle(IPC.LOGO_PICK, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The logo picker is unavailable until the app window is ready.");
    const copy = logoPickerCopy(manager.getSettings());
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: copy.title,
      properties: ["openFile"],
      filters: [{ name: copy.filterName, extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (picked.canceled || picked.filePaths.length !== 1) {
      return logoCustomizationStore.getSnapshot(manager.getSettings().appLogo);
    }
    return withLogoMutation(async () => {
      const previous = manager.getSettings();
      const prepared = await logoCustomizationStore.prepareImportFromFile(picked.filePaths[0], previous.appLogo);
      return activatePreparedLogo(previous, prepared);
    });
  });
  ipcMain.handle(IPC.LOGO_SET, async (event, settings: unknown) => {
    assertTrustedSender(event);
    if (!isAppLogoSettings(settings)) throw new Error("Invalid app-logo configuration.");
    return withLogoMutation(async () => {
      const previous = manager.getSettings();
      const next = cloneAppLogoSettings(settings as AppLogoSettings);
      if (next.source === "custom") {
        const prepared = await logoCustomizationStore.prepareUpdate(previous.appLogo, next);
        return activatePreparedLogo(previous, prepared);
      }
      return activatePresetLogo(previous, next, false);
    });
  });
  ipcMain.handle(IPC.LOGO_CLEAR, async (event) => {
    assertTrustedSender(event);
    return withLogoMutation(async () => {
      const previous = manager.getSettings();
      return activatePresetLogo(previous, cloneAppLogoSettings(DEFAULT_APP_LOGO_SETTINGS), true);
    });
  });
  ipcMain.handle(IPC.SCHEDULE_GET, (event) => {
    assertTrustedSender(event);
    return manager.getScheduleRules();
  });
  ipcMain.handle(IPC.SCHEDULE_SET, async (event, records: unknown) => {
    assertTrustedSender(event);
    if (!isScheduledSettingsRecords(records)) throw new Error("Invalid scheduled settings records");
    return manager.setScheduleRules(records);
  });
  ipcMain.handle(IPC.PRESENTATION_GET, (event) => {
    assertTrustedSender(event);
    return manager.getPresentationSettings();
  });
  ipcMain.handle(IPC.PRESENTATION_SET, (event, settings: unknown, resetKeys: unknown = []) => {
    assertTrustedSender(event);
    const validated = validatePresentationPatch(settings);
    const validatedResetKeys = validatePresentationResetKeys(resetKeys);
    if (validatedResetKeys.some((key) => Object.prototype.hasOwnProperty.call(validated, key))) {
      throw new Error("A presentation setting cannot be changed and reset in the same mutation");
    }
    return manager.setPresentationSettings(validated as PresentationPatch, validatedResetKeys);
  });
  ipcMain.handle(IPC.SCHOOL_MODE_CREDENTIAL_SETUP, async (event, next: unknown, confirmation: unknown) => {
    assertTrustedSender(event);
    return schoolModeCredentialService.setup(next, confirmation);
  });
  ipcMain.handle(IPC.SCHOOL_MODE_CREDENTIAL_CHANGE, async (event, current: unknown, next: unknown, confirmation: unknown) => {
    assertTrustedSender(event);
    return schoolModeCredentialService.change(current, next, confirmation);
  });
  ipcMain.handle(IPC.SCHOOL_MODE_CREDENTIAL_RESET, async (event, current: unknown) => {
    assertTrustedSender(event);
    return schoolModeCredentialService.reset(current);
  });
  ipcMain.handle(IPC.SCHOOL_MODE_DISABLE, async (event, current: unknown) => {
    assertTrustedSender(event);
    return schoolModeCredentialService.disable(current);
  });

  ipcMain.handle(IPC.SSH_HOST_SAVE, async (event, draft: unknown) => {
    assertTrustedSender(event);
    if (!isSshHostDraft(draft)) throw new Error("Invalid SSH host draft");
    return withSshHostMutation(draft.id, async () => {
      const current = manager.getSettings().sshHosts;
      const previous = current.find((host) => host.id === draft.id);
      const identityChanged = previous !== undefined && (
        previous.host !== draft.host ||
        previous.sshPort !== draft.sshPort ||
        previous.username !== draft.username ||
        previous.hostKeySha256 !== draft.hostKeySha256 ||
        previous.workerPort !== draft.workerPort ||
        previous.bootstrapAuthMode !== draft.bootstrapAuthMode
      );
      if (previous?.provisionedAt !== null && identityChanged) {
        throw new Error("Remove the provisioned SSH host before changing its connection identity");
      }
      const scan = await sshWorkerClient.scanHostKey(draft.host, draft.sshPort);
      if (!isSshHostKeyScanResult(scan) || scan.algorithm !== "ssh-ed25519" || scan.hostKeySha256 !== draft.hostKeySha256) {
        throw new Error("The configured SSH host key did not match the supplied pin");
      }
      const endpointUnchanged = previous && previous.host === draft.host && previous.sshPort === draft.sshPort &&
        previous.username === draft.username && previous.hostKeySha256 === draft.hostKeySha256 &&
        previous.workerPort === draft.workerPort;
      const host: SshHostConfig = {
        ...draft,
        workerHostKeySha256: endpointUnchanged ? previous.workerHostKeySha256 : null,
        trustedForSourceSecrets: endpointUnchanged ? previous.trustedForSourceSecrets : false,
        provisionedAt: endpointUnchanged ? previous.provisionedAt : null,
      };
      const next = [...current.filter((candidate) => candidate.id !== host.id), host];
      await manager.setManagedSshHosts(next);
      return manager.getSettings();
    });
  });

  ipcMain.handle(IPC.SSH_HOST_IMPORT_KEY, async (event, hostId: unknown) => {
    assertTrustedSender(event);
    assertId(hostId);
    return withSshHostMutation(hostId, async () => {
      const host = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!host) throw new Error("Unknown SSH host");
      if (!mainWindow) throw new Error("The SSH key picker is unavailable");
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{ name: "Ed25519 private key", extensions: ["*", "pem", "key"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return manager.getSettings();
      const bytes = await fsp.readFile(result.filePaths[0]);
      if (bytes.byteLength < 1 || bytes.byteLength > 64 * 1024) {
        bytes.fill(0);
        throw new Error("The SSH private key is too large");
      }
      try {
        const credential = normalizeSshPrivateKeyCredential({ privateKey: bytes.toString("utf8"), passphrase: null });
        await sshVault.store(host.id, "bootstrap", credential);
      } finally {
        bytes.fill(0);
      }
      const updated = { ...host, bootstrapAuthMode: "stored-private-key" as const };
      await manager.setManagedSshHosts(manager.getSettings().sshHosts.map((candidate) => candidate.id === host.id ? updated : candidate));
      return manager.getSettings();
    });
  });

  ipcMain.handle(IPC.SSH_HOST_PROVISION, async (event, hostId: unknown) => {
    assertTrustedSender(event);
    assertId(hostId);
    return withSshHostMutation(hostId, async () => {
      const host = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!host) throw new Error("Unknown SSH host");
      const result = await sshProvisioning.provision(host);
      if (!isSshProvisionResult(result)) throw new Error("Invalid SSH provision result");
      if (host.workerHostKeySha256 && host.workerHostKeySha256 !== result.workerHostKeySha256) {
        throw new Error("The managed worker host key changed; provisioning was rejected");
      }
      const updated = {
        ...host,
        workerHostKeySha256: result.workerHostKeySha256,
        provisionedAt: result.checkedAt,
      };
      await manager.setManagedSshHosts(manager.getSettings().sshHosts.map((candidate) => candidate.id === host.id ? updated : candidate));
      return manager.getSettings();
    });
  });

  ipcMain.handle(IPC.SSH_HOST_VERIFY, async (event, hostId: unknown) => {
    assertTrustedSender(event);
    assertId(hostId);
    return withSshHostMutation(hostId, async () => {
      const host = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!host) throw new Error("Unknown SSH host");
      const result = await sshProvisioning.verify(host);
      if (!isSshHostStatus(result)) throw new Error("Invalid SSH host status");
      return result;
    });
  });

  ipcMain.handle(IPC.SSH_HOST_TRUST, async (event, hostId: unknown, trusted: unknown) => {
    assertTrustedSender(event);
    assertId(hostId);
    if (typeof trusted !== "boolean") throw new Error("Invalid SSH source-secret trust state");
    return withSshHostMutation(hostId, async () => {
      const hosts = manager.getSettings().sshHosts;
      const host = hosts.find((candidate) => candidate.id === hostId);
      if (!host) throw new Error("Unknown SSH host");
      if (trusted && (!host.workerHostKeySha256 || !host.provisionedAt)) {
        throw new Error("Only a successfully provisioned worker can receive source credentials");
      }
      if (trusted) {
        if (!mainWindow) throw new Error("The SSH trust confirmation surface is unavailable");
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          buttons: ["Cancel", "Trust this host"],
          defaultId: 0,
          cancelId: 0,
          message: `Trust ${host.name} for source credentials?`,
          detail: "The managed worker may receive URL query parameters and selected request headers for distributed downloads.",
        });
        if (confirmation.response !== 1) throw new Error("SSH source-secret trust was not granted");
      }
      const currentHost = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!currentHost || currentHost.host !== host.host || currentHost.sshPort !== host.sshPort ||
        currentHost.username !== host.username || currentHost.hostKeySha256 !== host.hostKeySha256 ||
        currentHost.workerPort !== host.workerPort || currentHost.workerHostKeySha256 !== host.workerHostKeySha256 ||
        currentHost.provisionedAt !== host.provisionedAt) {
        throw new Error("The SSH host changed while confirmation was open; trust was not applied");
      }
      await manager.setManagedSshHosts(manager.getSettings().sshHosts.map((candidate) => candidate.id === hostId
        ? { ...candidate, trustedForSourceSecrets: trusted }
        : candidate));
      return manager.getSettings();
    });
  });

  ipcMain.handle(IPC.SSH_HOST_REMOVE, async (event, hostId: unknown) => {
    assertTrustedSender(event);
    assertId(hostId);
    return withSshHostMutation(hostId, async () => {
      const host = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!host) throw new Error("Unknown SSH host");
      if (!mainWindow) throw new Error("The SSH removal confirmation surface is unavailable");
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Cancel", "Remove managed worker"],
        defaultId: 0,
        cancelId: 0,
        message: `Remove ${host.name}?`,
        detail: "This stops and removes only this managed worker, its relay credentials, and its host record. Existing downloaded files are not removed.",
      });
      if (confirmation.response !== 1) throw new Error("SSH worker removal was cancelled");
      const currentHost = manager.getSettings().sshHosts.find((candidate) => candidate.id === hostId);
      if (!currentHost || currentHost.host !== host.host || currentHost.sshPort !== host.sshPort ||
        currentHost.username !== host.username || currentHost.hostKeySha256 !== host.hostKeySha256 ||
        currentHost.workerPort !== host.workerPort || currentHost.workerHostKeySha256 !== host.workerHostKeySha256 ||
        currentHost.provisionedAt !== host.provisionedAt) {
        throw new Error("The SSH host changed while confirmation was open; removal was not applied");
      }
      // Persist a disabled, still-addressable intent before remote mutation.
      // If the process dies or the final inventory save fails, the fallback
      // removal entry point and bootstrap credential remain available for a
      // retry instead of leaving an unrecoverable worker ghost.
      await manager.setManagedSshHosts(manager.getSettings().sshHosts.map((candidate) =>
        candidate.id === hostId ? { ...candidate, enabled: false } : candidate
      ));
      await sshProvisioning.remove(currentHost);
      await manager.setManagedSshHosts(manager.getSettings().sshHosts.filter((candidate) => candidate.id !== host.id));
      await sshProvisioning.finalizeRemoval(currentHost).catch(() => {});
      return manager.getSettings();
    });
  });

  ipcMain.handle(IPC.HISTORY_ACCESS_GET_STATE, async (event) => {
    assertTrustedSender(event);
    const configured = await historyAccessVault.isConfigured();
    return historyAccessSession.state(event.sender.id, configured);
  });
  ipcMain.handle(IPC.HISTORY_ACCESS_SETUP, async (event, password: unknown) => {
    assertTrustedSender(event);
    if (typeof password !== "string") throw new Error("Invalid history password");
    await historyAccessVault.configure(password);
    historyAccessSession.unlock(event.sender.id);
    return historyAccessSession.state(event.sender.id, true);
  });
  ipcMain.handle(IPC.HISTORY_ACCESS_UNLOCK, async (event, password: unknown) => {
    assertTrustedSender(event);
    if (typeof password !== "string") throw new Error("Invalid history password");
    const configured = await historyAccessVault.isConfigured();
    if (!configured || !(await historyAccessVault.verify(password))) throw new Error("History password did not match");
    historyAccessSession.unlock(event.sender.id);
    return historyAccessSession.state(event.sender.id, true);
  });
  ipcMain.handle(IPC.HISTORY_ACCESS_LOCK, async (event) => {
    assertTrustedSender(event);
    historyAccessSession.lock(event.sender.id);
    return historyAccessSession.state(event.sender.id, await historyAccessVault.isConfigured());
  });
  ipcMain.handle(IPC.HISTORY_GET_VIEW, (event, filter: unknown) => {
    assertHistoryUnlocked(event);
    const normalized = normalizeHistoryFilter(filter);
    return manager.getHistoryView(normalized);
  });
  ipcMain.handle(IPC.HISTORY_EXPORT_VIEW, (event, format: unknown, filter: unknown) => {
    assertHistoryUnlocked(event);
    if (!isExportFormat(format)) throw new Error("Invalid history export format");
    const normalized = normalizeHistoryFilter(filter);
    return manager.exportHistory(format, normalized);
  });
  ipcMain.handle(IPC.HISTORY_DIFF, (event, revisionId: unknown) => {
    assertHistoryUnlocked(event);
    return manager.getHistoryDiff(normalizeHistoryRevisionId(revisionId));
  });
  ipcMain.handle(IPC.HISTORY_RESTORE, (event, revisionId: unknown) => {
    assertHistoryUnlocked(event);
    return manager.restoreHistoryRevision(normalizeHistoryRevisionId(revisionId));
  });
  ipcMain.handle(IPC.HISTORY_LABEL, (event, revisionId: unknown, label: unknown) => {
    assertHistoryUnlocked(event);
    return manager.labelHistoryRevision(normalizeHistoryRevisionId(revisionId), normalizeHistoryLabel(label));
  });
  ipcMain.handle(IPC.HISTORY_PRUNE, (event, request: unknown) => {
    assertHistoryUnlocked(event);
    return manager.pruneHistory(normalizeHistoryPruneRequest(request));
  });

  ipcMain.handle(IPC.AUTHENTICATOR_REGISTER, async (event, input: unknown) => {
    assertTrustedSender(event);
    return authenticatorService.register(normalizeTotpRegistration(input));
  });
  ipcMain.handle(
    IPC.AUTHENTICATOR_CONFIRM_REGISTRATION,
    (event, input: unknown, candidate: unknown, timestampMs?: unknown, skewSteps?: unknown) => {
      assertTrustedSender(event);
      const normalized = normalizeTotpRegistration(input);
      if (timestampMs !== undefined && (typeof timestampMs !== "number" || !Number.isFinite(timestampMs))) {
        throw new Error("Invalid authenticator timestamp");
      }
      if (skewSteps !== undefined && (typeof skewSteps !== "number" || !Number.isSafeInteger(skewSteps))) {
        throw new Error("Invalid authenticator clock-skew window");
      }
      return authenticatorService.verifyPendingRegistration(
        normalized,
        candidate,
        timestampMs as number | undefined,
        skewSteps as number | undefined,
      );
    },
  );
  ipcMain.handle(IPC.AUTHENTICATOR_GENERATE_CODE, async (event, metadata: unknown, timestampMs?: unknown) => {
    assertTrustedSender(event);
    if (!isTotpRegistrationMetadata(metadata)) throw new Error("Invalid authenticator registration metadata");
    if (timestampMs !== undefined && (typeof timestampMs !== "number" || !Number.isFinite(timestampMs))) {
      throw new Error("Invalid authenticator timestamp");
    }
    return authenticatorService.generateCode(metadata, timestampMs as number | undefined);
  });
  ipcMain.handle(
    IPC.AUTHENTICATOR_VERIFY_CODE,
    async (event, metadata: unknown, candidate: unknown, timestampMs?: unknown, skewSteps?: unknown) => {
      assertTrustedSender(event);
      if (!isTotpRegistrationMetadata(metadata)) throw new Error("Invalid authenticator registration metadata");
      if (timestampMs !== undefined && (typeof timestampMs !== "number" || !Number.isFinite(timestampMs))) {
        throw new Error("Invalid authenticator timestamp");
      }
      if (skewSteps !== undefined && (typeof skewSteps !== "number" || !Number.isSafeInteger(skewSteps))) {
        throw new Error("Invalid authenticator clock-skew window");
      }
      return authenticatorService.verifyCode(
        metadata,
        candidate,
        timestampMs as number | undefined,
        skewSteps as number | undefined,
      );
    },
  );
  ipcMain.handle(IPC.AUTHENTICATOR_REMOVE, async (event, metadata: unknown) => {
    assertTrustedSender(event);
    if (!isTotpRegistrationMetadata(metadata)) throw new Error("Invalid authenticator registration metadata");
    await authenticatorService.remove(metadata);
  });
  ipcMain.handle(IPC.AUTHENTICATOR_EXPORT_METADATA, (event, metadata: unknown) => {
    assertTrustedSender(event);
    if (!isTotpRegistrationMetadata(metadata)) throw new Error("Invalid authenticator registration metadata");
    return authenticatorService.exportMetadata(metadata);
  });

  ipcMain.handle(IPC.CHANGELOG_GET_VIEW, (event, request: unknown) => {
    assertTrustedSender(event);
    return changelogHandlers.getView(request);
  });
  ipcMain.handle(IPC.CHANGELOG_EXPORT_VIEW, (event, format: unknown, request: unknown) => {
    assertTrustedSender(event);
    return changelogHandlers.exportView(request, format);
  });

  ipcMain.handle(IPC.EXTERNAL_EDITOR_DISCOVER, (event) => {
    assertTrustedSender(event);
    return externalEditorService.discover(manager.getSettings().externalEditorPath);
  });
  ipcMain.handle(IPC.EXTERNAL_EDITOR_PICK, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) return null;
    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Editor executable", extensions: ["exe", "cmd"] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const selected = picked.filePaths[0];
    if (!isSafeEditorExecutable(selected)) {
      throw new Error("The selected editor path is not safe.");
    }
    return selected;
  });
  ipcMain.handle(IPC.EXTERNAL_EDITOR_OPEN_EXPORT, async (event, content: unknown, fileName: unknown) => {
    assertTrustedSender(event);
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > EXTERNAL_EDITOR_MAX_EXPORT_BYTES) {
      throw new Error("The export is too large to open in the external editor.");
    }
    if (!isSafeExportFileName(fileName)) throw new Error("The export file name is not safe.");
    const result = await externalEditorService.openExport(content, fileName, manager.getSettings().externalEditorPath);
    if (!isExternalEditorOpenResult(result)) throw new Error("Invalid external editor result");
    return result;
  });
  ipcMain.handle(IPC.EXTERNAL_EDITOR_OPEN_WORKSPACE, async (event) => {
    assertTrustedSender(event);
    if (!mainWindow) throw new Error("The workspace picker is unavailable.");
    const picked = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (picked.canceled || picked.filePaths.length === 0) {
      return {
        schemaVersion: 1,
        opened: false,
        editor: null,
        filePath: null,
        workspacePath: null,
        error: "Workspace selection was cancelled.",
      };
    }
    const result = await externalEditorService.openWorkspace(picked.filePaths[0], manager.getSettings().externalEditorPath);
    if (!isExternalEditorOpenResult(result)) throw new Error("Invalid external editor result");
    return result;
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
    const parent = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!parent || parent.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(parent, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.BROWSER_HANDOFF_GET_START, (event): BrowserHandoffStart => {
    const handoffId = browserHandoffIdForSender(event);
    const start = handoffServer?.getBrowserHandoffStart(handoffId);
    if (!start) throw new Error("This browser download is no longer waiting for a start decision.");
    return start;
  });
  ipcMain.handle(IPC.BROWSER_HANDOFF_APPROVE, async (event, input: unknown): Promise<BrowserHandoffDecision> => {
    const handoffId = browserHandoffIdForSender(event);
    assertRecord(input, "browser handoff approval");
    assertString(input.fileName, "browser handoff file name", 512);
    assertString(input.folder, "browser handoff folder", 32_768);
    if (!isValidDefaultSaveFolder(input.folder)) throw new Error("Choose an absolute save folder before starting the download.");
    const decision = await handoffServer?.approveBrowserHandoff(handoffId, { fileName: input.fileName, folder: input.folder });
    if (!decision) throw new Error("The browser handoff service is unavailable.");
    if (decision.state === "accepted") {
      closeBrowserHandoffWindow(handoffId);
      if (decision.downloadId) createProgressWindow(decision.downloadId);
    }
    return decision;
  });
  ipcMain.handle(IPC.BROWSER_HANDOFF_REJECT, (event): BrowserHandoffDecision => {
    const handoffId = browserHandoffIdForSender(event);
    const decision = handoffServer?.rejectBrowserHandoff(handoffId);
    if (!decision) throw new Error("The browser handoff service is unavailable.");
    closeBrowserHandoffWindow(handoffId);
    return decision;
  });
  ipcMain.handle(IPC.COMPLETION_GET_NOTICE, (event): DownloadCompletionNotice => {
    return { ...completionNoticeForSender(event) };
  });
  ipcMain.on(IPC.COMPLETION_CLOSE, (event) => {
    completionNoticeForSender(event);
    closeCompletionWindow();
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

function notifyDownloadComplete(item: DownloadItem) {
  // Use an app-owned, always-on-top completion window. Native notifications
  // are not a dependable dialog surface and cannot satisfy the requested
  // close affordance or visible layering contract.
  createCompletionWindow(item);
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
  showMainWindow();
});

app.whenReady().then(async () => {
  extensionCapabilityVault = new ExtensionCapabilityVault();
  historyAccessVault = new HistoryAccessVault();
  const schoolModeResetVault = new SchoolModeResetVault();
  authenticatorService = new TotpRegistrationService();
  sshVault = new CredentialVault();
  sshWorkerClient = new SshWorkerClient({ vault: sshVault });
  const workerBundlePath = app.isPackaged
    ? path.join(process.resourcesPath, "ssh-worker")
    : path.resolve(__dirname, "../../../worker");
  sshProvisioning = new SshProvisioningService({ bundlePath: workerBundlePath, vault: sshVault, client: sshWorkerClient });
  manager = new DownloadManager(app.getPath("userData"), undefined, { credentialVault: sshVault });
  logoCustomizationStore = new LogoCustomizationStore(app.getPath("userData"));
  externalEditorService = new ExternalEditorService(app.getPath("userData"));
  ollamaSuiteStore = new OllamaSuiteStore(app.getPath("userData"));
  converterService = new ConverterService(app.getPath("userData"), { onStateChanged: broadcastConverterState });
  personalVocabularyStore = new PersonalVocabularyStore(app.getPath("userData"));
  const hadStateFile = await fsp.stat(path.join(app.getPath("userData"), "state.json")).then(() => true, () => false);
  await manager.init();
  await ollamaSuiteStore.init();
  await converterService.init();
  await personalVocabularyStore.init();
  schoolModeCredentialService = new SchoolModeCredentialService(schoolModeResetVault, manager);
  await schoolModeCredentialService.synchronize(hadStateFile).catch((error: unknown) => {
    console.warn(`School mode reset credential metadata could not be reconciled: ${error instanceof Error ? error.message : "unknown failure"}`);
  });
  manager.on("stateChanged", broadcastState);
  manager.on("presentationChanged", broadcastPresentation);
  manager.on("scheduleChanged", broadcastScheduleRules);
  personalVocabularyStore.on("changed", broadcastPersonalVocabulary);
  manager.on("itemCompleted", notifyDownloadComplete);
  await processBrowserHandoffs(process.argv);
  handoffServer = new HandoffServer({
    manager,
    loadCapability: () => extensionCapabilityVault.load(),
    presentPendingHandoff: createBrowserHandoffStartWindow,
    logger: (message) => console.warn(message),
  });
  // Register the renderer handlers before opening the loopback listener: a
  // browser capture can arrive immediately after the port starts accepting.
  registerIpcHandlers();
  await handoffServer.start();
  app.setLoginItemSettings({ openAtLogin: manager.getSettings().startOnSystemStartup });

  createWindow();
  createTray();
  startUpdater();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", async () => {
  await handoffServer?.stop();
  await converterService?.shutdown();
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  closeCompletionWindow();
  await manager?.shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  quitting = true;
  tray?.destroy();
  tray = null;
  updater?.stop();
  if (manager && !manager.isShutDown) {
    e.preventDefault();
    await handoffServer?.stop();
    await converterService?.shutdown();
    if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
    closeCompletionWindow();
    await manager.shutdown();
    app.quit();
  }
});

// Re-export shell for use by DownloadManager without needing its own import cycle issues.
export { shell };
