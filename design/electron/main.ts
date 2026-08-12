import { app, autoUpdater, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
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
import type { AddDownloadRequest, AppSettings, DownloadItem, DownloadQueue, SettingKey, SettingsPatch } from "../shared/types";
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
import { notifyDownloadComplete as showCompletionNotification, type CompletionNotificationPort } from "./completionNotification";
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
let sshVault: CredentialVault;
let sshWorkerClient: SshWorkerClient;
let sshProvisioning: SshProvisioningService;
let extensionCapabilityVault: ExtensionCapabilityVault;
let historyAccessVault: HistoryAccessVault;
let schoolModeCredentialService: SchoolModeCredentialService;
let authenticatorService: TotpRegistrationService;
let externalEditorService: ExternalEditorService;
const historyAccessSession = new HistoryAccessSession();
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
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.PRESENTATION_CHANGED, manager.getPresentationSettings());
      mainWindow.webContents.send(IPC.SCHEDULE_CHANGED, manager.getScheduleRules());
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
      progressWindow.webContents.send(IPC.PRESENTATION_CHANGED, manager.getPresentationSettings());
      progressWindow.webContents.send(IPC.SCHEDULE_CHANGED, manager.getScheduleRules());
    }
  });
  if (isDev) {
    const query = new URLSearchParams({ view: "progress", progressItem: itemId });
    progressWindow.loadURL(`http://localhost:5173/?${query.toString()}`);
  } else {
    progressWindow.loadFile(resolveRendererPath(__dirname), { query: { view: "progress", progressItem: itemId } });
  }
  progressWindow.on("closed", () => {
    if (progressWindow) historyAccessSession.remove(progressWindow.webContents.id);
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
}

function broadcastScheduleRules(records: ScheduledSettingsRecord[]) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.SCHEDULE_CHANGED, records);
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.webContents.send(IPC.SCHEDULE_CHANGED, records);
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
    return createBrowserExtensionInstallResult(installedPath, (folderPath) => shell.openPath(folderPath));
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
    const failure = await shell.openPath(installedPath);
    if (failure) throw new Error(failure);
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrustedSender(event);
    return manager.getSettings();
  });
  ipcMain.handle(IPC.SETTINGS_SET, (event, settings: unknown, resetKeys: unknown = []) => {
    assertTrustedSender(event);
    assertPartialSettings(settings);
    const validatedResetKeys: SettingKey[] = validateSettingResetKeys(resetKeys);
    if (validatedResetKeys.includes("sshHosts")) {
      throw new Error("The managed SSH host inventory has a dedicated lifecycle boundary");
    }
    if (validatedResetKeys.some((key) => Object.prototype.hasOwnProperty.call(settings, key))) {
      throw new Error("A setting cannot be changed and reset in the same mutation");
    }
    return manager.setSettings(settings, validatedResetKeys);
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
  externalEditorService = new ExternalEditorService(app.getPath("userData"));
  const hadStateFile = await fsp.stat(path.join(app.getPath("userData"), "state.json")).then(() => true, () => false);
  await manager.init();
  schoolModeCredentialService = new SchoolModeCredentialService(schoolModeResetVault, manager);
  await schoolModeCredentialService.synchronize(hadStateFile).catch((error: unknown) => {
    console.warn(`School mode reset credential metadata could not be reconciled: ${error instanceof Error ? error.message : "unknown failure"}`);
  });
  manager.on("stateChanged", broadcastState);
  manager.on("presentationChanged", broadcastPresentation);
  manager.on("scheduleChanged", broadcastScheduleRules);
  manager.on("itemCompleted", notifyDownloadComplete);
  await processBrowserHandoffs(process.argv);
  handoffServer = new HandoffServer({
    manager,
    loadCapability: () => extensionCapabilityVault.load(),
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
