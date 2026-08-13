import { EventEmitter } from "node:events";
import path from "node:path";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { app, shell } from "electron";
import type {
  AddDownloadRequest,
  AppSettings,
  DownloadCategory,
  DownloadItem,
  DownloadStatus,
  DownloadQueue,
  NewDownloadInfo,
  PresentationPatch,
  PresentationSettings,
  ResetCredentialState,
  SettingKey,
  SettingsPatch,
  StateSnapshot,
} from "../../shared/types";
import {
  isDistributedDownloadSelection,
  isDistributedRequestHeaders,
  type DistributedDownloadSelection,
  type SourceIdentity,
} from "../../shared/distributedProtocol";
import type { ExportFormat, ExportResult } from "../../shared/export";
import {
  historyFilterRequest,
  normalizeHistoryFilter,
  normalizeHistoryLabel,
  normalizeHistoryPruneRequest,
  normalizeHistoryRevisionId,
  type HistoryDiff,
  type HistoryFilter,
  type HistoryPruneResult,
  type HistoryRevision,
  type HistoryView,
} from "../../shared/history";
import {
  createDefaultSettings,
  presentationSettingsFromAppSettings,
  validatePresentationPatch,
  validatePresentationResetKeys,
  validateSettingResetKeys,
  validateSettingsPatch,
  isDownloadCategory,
} from "../../shared/settings";
import { DEFAULT_QUEUE_ID, PRESENTATION_SETTING_KEYS, SETTING_KEYS } from "../../shared/types";
import {
  validateScheduledSettingsRecords,
  type ScheduledSettingsRecord,
} from "../../shared/scheduledSettings";
import { cloneSshHostConfigs, isSshHostConfigs } from "../../shared/ssh";
import { migrateSettings, StateStore } from "./persistence";
import { resolveCategoryIsolated, resolveDownloadFolder } from "./categories";
import { probeUrl as httpProbeUrl, proveDownloadReadable, redactErrorMessage, redactUrl, sanitizeFileName } from "./HttpProbe";
import { DownloadTask } from "./DownloadTask";
import { CredentialVault, type DistributedSourceSecret } from "./distributed/CredentialVault";
import {
  DistributedDownloadTask,
  type DistributedIdentityVerifier,
  type DistributedRangeFetcher,
} from "./distributed/DistributedDownloadTask";
import { SshWorkerClient } from "./distributed/SshWorkerClient";
import { DistributedSourceCapabilityError, StrictSourceProbe } from "./distributed/StrictSourceProbe";
import { SpeedLimiter } from "./SpeedLimiter";
import {
  cloneRequestHeaders,
  splitStoredDownload,
  type StoredDownloadItem,
  withStoredHeaders,
} from "./downloadMetadata";
import { isQueueScheduleActive, QueueScheduleClock } from "./queueSchedule";
import { HistoryStore, type HistoryAction } from "../history/HistoryStore";
import {
  isSafeScheduleUrl,
  validateScheduledSettings,
} from "./scheduleSources";

const MAX_QUEUE_NAME_LENGTH = 512;
const MAX_QUEUE_ID_LENGTH = 256;
const MAX_QUEUE_ITEM_IDS = 10_000;

export type LoginItemSettingsWriter = (openAtLogin: boolean) => void;

type ManagedDownloadTask = DownloadTask | DistributedDownloadTask;

function cloneScheduleRules(records: readonly ScheduledSettingsRecord[]): ScheduledSettingsRecord[] {
  return records.map((record) => ({
    ...record,
    weekdays: [...record.weekdays],
    source: record.source.kind === "local"
      ? { kind: "local", settings: { ...record.source.settings } }
      : record.source.kind === "home-assistant"
        ? { kind: "home-assistant", baseUrl: record.source.baseUrl, entityId: record.source.entityId, settings: { ...record.source.settings } }
        : { kind: "api", url: record.source.url, ...(record.source.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}) },
  }));
}

function validateManagedScheduleRules(value: unknown): ScheduledSettingsRecord[] {
  const records = validateScheduledSettingsRecords(value);
  for (const record of records) {
    if (record.source.kind === "local") {
      validateScheduledSettings(record.source.settings);
    } else if (record.source.kind === "api") {
      if (!isSafeScheduleUrl(record.source.url, { allowLoopbackHttp: record.source.allowLoopbackHttp === true })) {
        throw new Error("API schedule URL is not an allowed credential-free HTTPS or bounded loopback URL");
      }
    } else {
      if (!isSafeScheduleUrl(record.source.baseUrl, { allowLoopbackHttp: true, allowPrivateHttps: true })) {
        throw new Error("Home Assistant URL is not an allowed credential-free HTTPS or loopback URL");
      }
      validateScheduledSettings(record.source.settings);
    }
  }
  return records;
}

export interface DownloadManagerDistributedDependencies {
  credentialVault?: CredentialVault;
  sourceProbe?: StrictSourceProbe;
  rangeFetcher?: DistributedRangeFetcher;
  identityVerifier?: DistributedIdentityVerifier;
}

function writeElectronLoginItemSettings(openAtLogin: boolean): void {
  if (!app || typeof app.setLoginItemSettings !== "function") throw new Error("Electron login-item settings are unavailable");
  app.setLoginItemSettings({ openAtLogin });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBoundedString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
  }
}

function isQueueItemId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_QUEUE_ID_LENGTH;
}

function assertQueueItemIds(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_QUEUE_ITEM_IDS || value.some((id) => !isQueueItemId(id))) {
    throw new Error("Invalid queue item IDs");
  }
}

function normalizeDistributedHeaders(input: unknown): Record<string, string> {
  if (input === undefined) return {};
  if (!isRecord(input)) throw new Error("Distributed download headers must be an object");
  const normalized: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(normalized, name)) {
      throw new Error("Distributed download headers contain a duplicate name");
    }
    if (typeof value !== "string") throw new Error("Distributed download headers must contain strings");
    normalized[name] = value;
  }
  if (!isDistributedRequestHeaders(normalized)) {
    throw new Error("Distributed download headers include an unsupported or transport-controlled field");
  }
  return normalized;
}

function sourceRequiresTrustedSshHost(url: string, headers: Record<string, string>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.username || parsed.password || parsed.search.length > 0 || parsed.hash.length > 0) return true;
  return Object.keys(headers).some((name) =>
    /authorization|cookie|token|secret|api[-_]?key|signature|referer/u.test(name)
  );
}

/** Validate the partial shape accepted by the queue:create IPC call. */
export function assertQueueCreatePayload(value: unknown): asserts value is Partial<DownloadQueue> {
  if (!isRecord(value)) throw new Error("Invalid queue");
  if (value.id !== undefined) assertBoundedString(value.id, "queue identifier", MAX_QUEUE_ID_LENGTH);
  if (value.name !== undefined) assertBoundedString(value.name, "queue name", MAX_QUEUE_NAME_LENGTH);
  if (
    value.maxConcurrent !== undefined &&
    (typeof value.maxConcurrent !== "number" || !Number.isFinite(value.maxConcurrent))
  ) {
    throw new Error("Invalid queue concurrency");
  }
  if (value.isRunning !== undefined && typeof value.isRunning !== "boolean") {
    throw new Error("Invalid queue running state");
  }
  if (value.itemIds !== undefined) assertQueueItemIds(value.itemIds);
  if (value.scheduleEnabled !== undefined && typeof value.scheduleEnabled !== "boolean") {
    throw new Error("Invalid queue schedule state");
  }
  if (value.startAt !== undefined && value.startAt !== null) {
    assertBoundedString(value.startAt, "queue start time", 16);
  }
  if (value.endAt !== undefined && value.endAt !== null) {
    assertBoundedString(value.endAt, "queue end time", 16);
  }
}

export class DownloadManager extends EventEmitter {
  private store: StateStore;
  private history: HistoryStore;
  private items: Map<string, DownloadItem> = new Map();
  private queues: Map<string, DownloadQueue> = new Map();
  private settings!: AppSettings;
  private compiledSettings!: AppSettings;
  private scheduleRules: ScheduledSettingsRecord[] = [];
  private tasks: Map<string, ManagedDownloadTask> = new Map();
  private itemHeaders: Map<string, Record<string, string>> = new Map();
  /** Raw source URLs materialize only in memory; protected values persist only in the operating-system vault. */
  private itemSourceUrls: Map<string, string> = new Map();
  private distributedSources: Map<string, DistributedSourceSecret> = new Map();
  private readonly credentialVault: CredentialVault;
  private readonly distributedSourceProbe: StrictSourceProbe;
  private readonly distributedRangeFetcher: DistributedRangeFetcher;
  private readonly distributedIdentityVerifier: DistributedIdentityVerifier;
  private globalSpeedLimiter!: SpeedLimiter;
  private notifyScheduled = false;
  private shutDown = false;
  private itemOrder: string[] = [];
  private scheduledPauses: Map<string, Promise<void>> = new Map();
  private pendingOperations = new Set<Promise<void>>();
  private scheduleClock = new QueueScheduleClock(() => this.processAllQueues());

  constructor(
    private userDataPath: string,
    private readonly writeLoginItemSettings: LoginItemSettingsWriter = writeElectronLoginItemSettings,
    distributedDependencies: DownloadManagerDistributedDependencies = {},
  ) {
    super();
    this.store = new StateStore(userDataPath);
    this.history = new HistoryStore(userDataPath);
    this.credentialVault = distributedDependencies.credentialVault ?? new CredentialVault();
    this.distributedSourceProbe = distributedDependencies.sourceProbe ?? new StrictSourceProbe();
    this.distributedRangeFetcher = distributedDependencies.rangeFetcher ?? new SshWorkerClient({ vault: this.credentialVault });
    this.distributedIdentityVerifier = distributedDependencies.identityVerifier ?? this.distributedSourceProbe;
  }

  get isShutDown() {
    return this.shutDown;
  }

  private sourceUrl(item: DownloadItem): string {
    return this.itemSourceUrls.get(item.id) ?? item.url;
  }

  private sanitizeItem(item: DownloadItem) {
    item.url = redactUrl(item.url);
    if (item.error !== null) item.error = redactErrorMessage(item.error, this.sourceUrl(item), item.url);
  }

  private sanitizeItems() {
    for (const item of this.items.values()) this.sanitizeItem(item);
  }

  /**
   * Give DownloadTask the private source URL without changing the public item
   * object that is persisted, snapshotted or sent to the renderer.
   */
  private taskItem(item: DownloadItem): DownloadItem {
    const sourceUrl = this.itemSourceUrls.get(item.id);
    if (!sourceUrl || sourceUrl === item.url) return item;
    return new Proxy(item, {
      get(target, property, receiver) {
        if (property === "url") return sourceUrl;
        return Reflect.get(target, property, receiver);
      },
    });
  }

  async init() {
    const userHome = process.env.USERPROFILE || process.env.HOME || this.userDataPath;
    // Category folders belong directly under Downloads (Downloads\Videos,
    // Downloads\Documents, and so on), never below an app-name container.
    const defaultSaveFolder = path.join(userHome, "Downloads");
    const legacyManagedFolder = path.join(defaultSaveFolder, "MaterialDownloadManager");
    this.compiledSettings = createDefaultSettings(defaultSaveFolder);
    const state = await this.store.load(defaultSaveFolder);
    let stateNeedsDefaultFolderMigration = false;
    if (path.resolve(state.settings.defaultSaveFolder) === path.resolve(legacyManagedFolder)) {
      state.settings.defaultSaveFolder = defaultSaveFolder;
      state.settings.settingProvenance.defaultSaveFolder = "compiled-in";
      stateNeedsDefaultFolderMigration = true;
    }
    this.settings = state.settings;
    try {
      this.scheduleRules = validateManagedScheduleRules(state.scheduleRules ?? []);
    } catch {
      this.scheduleRules = [];
    }
    this.globalSpeedLimiter = new SpeedLimiter(this.settings.globalSpeedLimitBytes);
    for (const q of state.queues) this.queues.set(q.id, q);
    if (!this.queues.has(DEFAULT_QUEUE_ID)) {
      this.queues.set(DEFAULT_QUEUE_ID, {
        id: DEFAULT_QUEUE_ID,
        name: "Default Queue",
        maxConcurrent: 3,
        isRunning: true,
        itemIds: [],
        scheduleEnabled: false,
        startAt: null,
        endAt: null,
      });
    }
    let stateNeedsUrlMigration = false;
    for (const storedItem of state.items as StoredDownloadItem[]) {
      const { item, headers } = splitStoredDownload(storedItem);
      if (headers && item.transferMode !== "ssh-distributed" && !item.sourceSecretStoredInVault) this.itemHeaders.set(item.id, headers);
      const sourceUrl = item.url;
      item.url = redactUrl(sourceUrl);
      if (sourceUrl !== item.url) {
        this.itemSourceUrls.set(item.id, sourceUrl);
        stateNeedsUrlMigration = true;
      }
      if (item.transferMode === "ssh-distributed") {
        if (item.status === "completed" || item.status === "cancelled") {
          // Completed/cancelled records must never reload a credentialed URL
          // merely because a prior cleanup crashed.  Garbage-collect the
          // opaque vault account without materialising its secret.
          await this.credentialVault.removeDownloadSource(item.id).catch(() => {});
        } else {
          try {
            const source = await this.credentialVault.loadDownloadSource(item.id);
            if (source) {
              this.distributedSources.set(item.id, source);
              this.itemSourceUrls.set(item.id, source.url);
            } else {
              item.status = "error";
              item.error = "The operating-system vault no longer contains this distributed download source.";
            }
          } catch {
            item.status = "error";
            item.error = "The stored distributed download source could not be read safely.";
          }
        }
      }
      if (item.sourceSecretStoredInVault && (item.status === "completed" || item.status === "cancelled") && item.transferMode !== "ssh-distributed") {
        // A protected local fallback can leave a cancellation tombstone when
        // removal is interrupted between vault cleanup and the final state
        // save.  Remove the opaque account without loading its contents.
        await this.credentialVault.removeDownloadSource(item.id).catch(() => {});
      }
      if (item.sourceSecretStoredInVault && item.status !== "completed" && item.status !== "cancelled") {
        try {
          const source = await this.credentialVault.loadDownloadSource(item.id);
          if (source) {
            this.itemHeaders.set(item.id, source.headers);
            this.itemSourceUrls.set(item.id, source.url);
          } else {
            item.status = "error";
            item.error = "The operating-system vault no longer contains this protected local download source.";
          }
        } catch {
          item.status = "error";
          item.error = "The protected local download source could not be read safely.";
        }
      }
      this.sanitizeItem(item);
      item.fileName = sanitizeFileName(item.fileName);
      this.items.set(item.id, item);
      this.itemOrder.push(item.id);
    }
    await fsp.mkdir(this.settings.defaultSaveFolder, { recursive: true }).catch(() => {});
    if (stateNeedsUrlMigration || stateNeedsDefaultFolderMigration) await this.persist();
    await this.recordHistory("created", "Created the initial application state");
    this.scheduleClock.start();
    this.processAllQueues();
  }

  // ---- state / persistence -------------------------------------------------

  getState(): StateSnapshot {
    this.sanitizeItems();
    return {
      items: this.itemOrder.map((id) => this.items.get(id)!).filter(Boolean),
      queues: Array.from(this.queues.values()),
      settings: this.settings,
      scheduleRules: cloneScheduleRules(this.scheduleRules),
    };
  }

  private scheduleNotify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    setTimeout(() => {
      this.notifyScheduled = false;
      this.emit("stateChanged");
    }, 200);
  }

  private async recordHistory(action: HistoryAction, summary: string) {
    try {
      await this.history.appendSnapshot(JSON.stringify(this.getState()), action, redactErrorMessage(summary));
    } catch {
      // History is best effort and must never make the requested operation fail.
    }
  }

  /**
   * EventEmitter does not await async listeners. Keep those listeners visible
   * to shutdown so a Git-backed history write cannot outlive the manager's
   * data directory cleanup.
   */
  private trackOperation(operation: Promise<unknown>): void {
    let tracked!: Promise<void>;
    tracked = operation.then(
      () => {
        this.pendingOperations.delete(tracked);
      },
      () => {
        this.pendingOperations.delete(tracked);
      }
    );
    this.pendingOperations.add(tracked);
  }

  private async drainPendingOperations(): Promise<void> {
    while (this.pendingOperations.size > 0) {
      await Promise.all(Array.from(this.pendingOperations));
    }
  }

  private async saveState() {
    this.sanitizeItems();
    await this.store.save({
      items: Array.from(this.items.values()).map((item) =>
        item.transferMode === "ssh-distributed" || item.sourceSecretStoredInVault
          ? item
          : withStoredHeaders(item, this.itemHeaders.get(item.id))
      ),
      queues: Array.from(this.queues.values()),
      settings: this.settings,
      scheduleRules: cloneScheduleRules(this.scheduleRules),
    });
  }

  private async persist(action?: HistoryAction, summary?: string) {
    await this.saveState();
    if (action && summary) await this.recordHistory(action, summary);
  }

  // ---- probing / adding -----------------------------------------------------

  async probeUrl(url: string, headers: Record<string, string> = {}): Promise<NewDownloadInfo> {
    try {
      return await httpProbeUrl(url, cloneRequestHeaders(headers) ?? {});
    } catch (error) {
      throw new Error(redactErrorMessage(error, url));
    }
  }

  async previewCategory(fileName: string, url: string): Promise<DownloadCategory> {
    return resolveCategoryIsolated(
      sanitizeFileName(fileName || "download"),
      url,
      this.settings.autoOrganizeRules ?? []
    );
  }

  private resolveSelectedSshHosts(selection: DistributedDownloadSelection) {
    if (!isDistributedDownloadSelection(selection)) throw new Error("Invalid distributed download selection");
    const available = this.settings.sshHosts.filter((host) =>
      host.enabled && host.provisionedAt !== null && host.workerHostKeySha256 !== null);
    const selected = selection.hostIds
      ? selection.hostIds.map((id) => available.find((host) => host.id === id))
      : available.slice(0, selection.workerCount);
    if (selected.length === 0 || selected.some((host) => !host)) {
      throw new Error("Every selected SSH host must be enabled and successfully provisioned");
    }
    if (selection.workerCount !== undefined && selected.length !== selection.workerCount) {
      throw new Error(`Only ${selected.length} provisioned SSH hosts are available for ${selection.workerCount} requested workers`);
    }
    return selected.map((host) => ({ ...host! }));
  }

  async addDownload(req: AddDownloadRequest): Promise<string> {
    const id = crypto.randomUUID();
    let fileName = sanitizeFileName(req.fileName || "download");
    const category = await this.previewCategory(fileName, req.url);
    const folder = resolveDownloadFolder(
      req.folder,
      this.settings.defaultSaveFolder,
      category,
      this.settings.autoOrganizeEnabled === true
    );
    fileName = await this.resolveNameCollision(folder, fileName);

    const item: DownloadItem = {
      id,
      url: redactUrl(req.url),
      fileName,
      folder,
      category,
      status: "added",
      totalSize: null,
      downloadedSize: 0,
      speed: 0,
      eta: null,
      resumeSupport: false,
      queueId: req.queueId ?? DEFAULT_QUEUE_ID,
      dateAdded: Date.now(),
      dateCompleted: null,
      error: null,
      parts: [],
      connections: 1,
      transferMode: req.ssh ? "ssh-distributed" : "local",
    };

    let distributedFallback = false;
    if (req.ssh) {
      let selectedHosts: AppSettings["sshHosts"] = [];
      let selectionError: Error | null = null;
      try {
        selectedHosts = this.resolveSelectedSshHosts(req.ssh);
      } catch (error) {
        selectionError = error instanceof Error ? error : new Error("The selected SSH hosts are unavailable");
      }
      const headers = normalizeDistributedHeaders(req.headers);
      let probe: Awaited<ReturnType<StrictSourceProbe["probe"]>> | null = null;
      try {
        probe = await this.distributedSourceProbe.probe(req.url, headers);
      } catch (error) {
        if (!(error instanceof DistributedSourceCapabilityError)) throw error;
        item.transferMode = "local";
        item.connections = 1;
        item.resumeSupport = false;
        this.itemHeaders.set(id, headers);
        try {
          const info = await httpProbeUrl(req.url, headers);
          item.totalSize = info.contentLength;
          item.resumeSupport = info.resumeSupport;
        } catch (localError) {
          item.error = redactErrorMessage(localError, req.url);
        }
        item.transferNotice =
          "SSH distribution was unavailable for this source, so the download was kept local.";
        if (item.error === null && sourceRequiresTrustedSshHost(req.url, headers)) {
          await this.credentialVault.storeDownloadSource(id, { url: req.url, headers });
          item.sourceSecretStoredInVault = true;
        }
        distributedFallback = true;
      }
      const hasSecretBearingRequest = sourceRequiresTrustedSshHost(req.url, headers);
      if (!distributedFallback && (!req.ssh.expectedSha256 || selectionError || (hasSecretBearingRequest && selectedHosts.some((host) => !host.trustedForSourceSecrets)))) {
        item.transferMode = "local";
        item.connections = 1;
        item.resumeSupport = false;
        this.itemHeaders.set(id, headers);
        try {
          const info = await httpProbeUrl(req.url, headers);
          item.totalSize = info.contentLength;
          item.resumeSupport = info.resumeSupport;
        } catch (localError) {
          item.error = redactErrorMessage(localError, req.url);
        }
        item.transferNotice = selectionError
          ? "SSH distribution was kept local because the selected worker hosts are unavailable."
          : !req.ssh.expectedSha256
          ? "SSH distribution was kept local because this source has no trusted whole-file SHA-256 digest."
          : "SSH distribution was kept local because the selected hosts are not trusted for source credentials.";
        if (item.error === null && hasSecretBearingRequest) {
          await this.credentialVault.storeDownloadSource(id, { url: req.url, headers });
          item.sourceSecretStoredInVault = true;
        }
        distributedFallback = true;
      }
      if (!distributedFallback) {
        if (!probe) throw new Error("The distributed source probe returned no identity");
        const source: DistributedSourceSecret = { url: req.url, headers };
        const resolvedSelection: DistributedDownloadSelection = {
          mode: "ssh",
          hostIds: selectedHosts.map((host) => host.id),
          ...(req.ssh.expectedSha256 !== undefined ? { expectedSha256: req.ssh.expectedSha256 } : {}),
        };
        await this.credentialVault.storeDownloadSource(id, source);
        this.distributedSources.set(id, source);
        item.totalSize = probe.identity.length;
        item.resumeSupport = true;
        item.connections = selectedHosts.length;
        item.sshHostIds = resolvedSelection.hostIds;
        item.sshExpectedSha256 = resolvedSelection.expectedSha256 ?? null;
        item.sshSourceIdentity = { ...probe.identity };
        item.sshProgress = selectedHosts.map((host) => ({
          hostId: host.id,
          activePieces: 0,
          completedPieces: 0,
          failedPieces: 0,
          state: "waiting" as const,
          message: null,
        }));
      }
    } else {
      const headers = cloneRequestHeaders(req.headers);
      if (headers) this.itemHeaders.set(id, headers);
      try {
        const info = await httpProbeUrl(req.url, headers ?? {});
        item.totalSize = info.contentLength;
        item.resumeSupport = info.resumeSupport;
      } catch (e) {
        item.error = redactErrorMessage(e, req.url);
      }
      if (item.error === null && sourceRequiresTrustedSshHost(req.url, headers ?? {})) {
        await this.credentialVault.storeDownloadSource(id, { url: req.url, headers: headers ?? {} });
        item.sourceSecretStoredInVault = true;
      }
    }

    this.itemSourceUrls.set(id, req.url);

    this.items.set(id, item);
    this.itemOrder.unshift(id);
    const queue = this.queues.get(item.queueId!) ?? this.queues.get(DEFAULT_QUEUE_ID)!;
    queue.itemIds.unshift(id);

    if (req.startImmediately) {
      item.status = "queued";
    }

    try {
      await this.persist("created", `Created download ${fileName}`);
    } catch (error) {
      this.items.delete(id);
      this.itemOrder = this.itemOrder.filter((candidate) => candidate !== id);
      queue.itemIds = queue.itemIds.filter((candidate) => candidate !== id);
      this.itemHeaders.delete(id);
      this.itemSourceUrls.delete(id);
      this.distributedSources.delete(id);
      if (req.ssh || item.sourceSecretStoredInVault) await this.credentialVault.removeDownloadSource(id).catch(() => {});
      throw error;
    }
    if (req.startImmediately) this.processQueue(queue.id);
    this.scheduleNotify();
    return id;
  }

  /**
   * Queue a browser takeover only after the credential-free source probe and
   * the durable local snapshot both succeed. The browser keeps its own copy
   * whenever this stricter path cannot prove that the app can retrieve it.
   */
  async addBrowserHandoff(req: AddDownloadRequest): Promise<string> {
    try {
      await proveDownloadReadable(req.url, {});
    } catch {
      throw new Error("The browser download source was not usable without browser credentials.");
    }
    const id = await this.addDownload({ ...req, startImmediately: false });
    const item = this.items.get(id);
    if (!item || item.error) {
      await this.remove(id, false).catch(() => {});
      throw new Error("The browser download source was not usable without browser credentials.");
    }
    try {
      await this.resume(id, `Queued browser handoff ${item.fileName}`);
      return id;
    } catch (error) {
      await this.remove(id, false).catch(() => {});
      throw error;
    }
  }

  async rollbackBrowserHandoff(id: string): Promise<void> {
    // A browser cancellation failure must never leave a second partial app
    // transfer behind before the original Chrome item is resumed.
    await this.remove(id, true);
  }

  private async resolveNameCollision(folder: string, fileName: string): Promise<string> {
    fileName = sanitizeFileName(fileName);
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let candidate = fileName;
    let i = 1;
    while (
      await fsp
        .access(path.join(folder, candidate))
        .then(() => true)
        .catch(() => false)
    ) {
      candidate = `${base} (${i})${ext}`;
      i++;
    }
    return candidate;
  }

  // ---- task lifecycle --------------------------------------------------------

  private createTask(item: DownloadItem): ManagedDownloadTask {
    let task: ManagedDownloadTask;
    if (item.transferMode === "ssh-distributed") {
      const source = this.distributedSources.get(item.id);
      if (!source || !item.sshSourceIdentity || !item.sshHostIds?.length) {
        throw new Error("The distributed download is missing its main-process source or host assignment");
      }
      const hosts = item.sshHostIds.map((id) => this.settings.sshHosts.find((host) => host.id === id));
      if (hosts.some((host) => !host || !host.enabled || !host.workerHostKeySha256)) {
        throw new Error("A selected SSH host is unavailable, disabled, or no longer provisioned");
      }
      if (!item.sshExpectedSha256) {
        throw new Error("The distributed download has no trusted expected SHA-256 digest");
      }
      if (sourceRequiresTrustedSshHost(source.url, source.headers) && hosts.some((host) => !host!.trustedForSourceSecrets)) {
        throw new Error("A selected SSH host is no longer trusted for this credentialed source");
      }
      task = new DistributedDownloadTask(item, {
        workRoot: path.join(this.userDataPath, "distributed-downloads"),
        source,
        sourceIdentity: item.sshSourceIdentity,
        selection: {
          mode: "ssh",
          hostIds: [...item.sshHostIds],
          ...(item.sshExpectedSha256 ? { expectedSha256: item.sshExpectedSha256 } : {}),
        },
        hosts: hosts.map((host) => ({ ...host! })),
        rangeFetcher: this.distributedRangeFetcher,
        identityVerifier: this.distributedIdentityVerifier,
      });
    } else {
      task = new DownloadTask(this.taskItem(item), {
        maxConnections: this.settings.maxConnectionsPerDownload,
        minPartSize: this.settings.minConnectionPartSize,
        headers: this.itemHeaders.get(item.id),
        speedLimiters: [this.globalSpeedLimiter],
      });
    }
    task.on("progress", () => this.scheduleNotify());
    task.on("completed", () => {
      this.trackOperation(
        (async () => {
          this.tasks.delete(item.id);
          await this.persist("updated", `Completed download ${item.fileName}`);
          if (item.transferMode === "ssh-distributed" || item.sourceSecretStoredInVault) {
            this.distributedSources.delete(item.id);
            this.itemSourceUrls.delete(item.id);
            await this.credentialVault.removeDownloadSource(item.id).catch(() => {});
          }
          this.scheduleNotify();
          this.emit("itemCompleted", item);
          this.processAllQueues();
        })()
      );
    });
    task.on("error", () => {
      this.trackOperation(
        (async () => {
          this.tasks.delete(item.id);
          if (item.error !== null) item.error = redactErrorMessage(item.error, this.sourceUrl(item));
          await this.persist("updated", `Recorded download error for ${item.fileName}`);
          this.scheduleNotify();
          this.processAllQueues();
        })()
      );
    });
    task.on("paused", () => {
      if (!this.scheduledPauses.has(item.id)) {
        this.trackOperation(
          (async () => {
            await this.persist();
            this.scheduleNotify();
          })()
        );
      }
    });
    this.tasks.set(item.id, task);
    return task;
  }

  private startItem(item: DownloadItem) {
    if (this.tasks.has(item.id)) return;
    item.status = "downloading";
    item.error = null;
    let task: ManagedDownloadTask;
    try {
      task = this.createTask(item);
    } catch (error) {
      item.status = "error";
      item.error = error instanceof Error ? error.message : "The download task could not be created";
      this.trackOperation(this.persist("updated", `Recorded download error for ${item.fileName}`));
      this.scheduleNotify();
      return;
    }
    task.start().catch((e) => {
      this.trackOperation(
        (async () => {
          item.status = "error";
          item.error = redactErrorMessage(e, this.sourceUrl(item));
          this.tasks.delete(item.id);
          await this.persist();
          this.scheduleNotify();
          this.processAllQueues();
        })()
      );
    });
  }

  private pauseQueueForSchedule(queue: DownloadQueue) {
    for (const itemId of queue.itemIds) {
      const task = this.tasks.get(itemId);
      const item = this.items.get(itemId);
      if (!task || !item || this.scheduledPauses.has(itemId)) continue;

      let pausePromise: Promise<void>;
      pausePromise = task
        .pause()
        .then(async () => {
          const stillScheduled = this.scheduledPauses.get(itemId) === pausePromise;
          this.scheduledPauses.delete(itemId);
          this.tasks.delete(itemId);

          if (!stillScheduled) {
            // A user action invalidated this automatic pause. The task still
            // needs to leave the active-task map, but its final status belongs
            // to that user action (resume, cancel, or remove).
            this.scheduleNotify();
            this.processAllQueues();
            return;
          }

          // Scheduled pauses are resumable when the next window opens, but a
          // real shutdown must persist the paused state it just established.
          if (!this.shutDown && item.status === "paused") item.status = "queued";
          await this.persist();
          this.scheduleNotify();
          this.processAllQueues();
        })
        .catch(() => {
          if (this.scheduledPauses.get(itemId) === pausePromise) this.scheduledPauses.delete(itemId);
        });
      this.scheduledPauses.set(itemId, pausePromise);
    }
  }

  private async settleScheduledPause(itemId: string) {
    const pending = this.scheduledPauses.get(itemId);
    if (!pending) return;
    this.scheduledPauses.delete(itemId);
    await pending;
  }

  private processAllQueues() {
    if (this.shutDown) return;
    for (const queue of this.queues.values()) {
      if (!queue.isRunning) continue;
      if (isQueueScheduleActive(queue)) this.processQueue(queue.id);
      else if (queue.scheduleEnabled) this.pauseQueueForSchedule(queue);
    }
  }

  processQueue(queueId: string) {
    const queue = this.queues.get(queueId);
    if (!queue || !queue.isRunning || !isQueueScheduleActive(queue) || !Array.isArray(queue.itemIds)) return;
    const activeCount = queue.itemIds.filter((id) => this.tasks.has(id)).length;
    const globalActiveCount = this.tasks.size;
    let freeSlots = Math.max(
      0,
      Math.min(queue.maxConcurrent - activeCount, this.settings.maxActiveDownloads - globalActiveCount)
    );
    if (freeSlots <= 0) return;
    for (const id of queue.itemIds) {
      if (freeSlots <= 0) break;
      if (!isQueueItemId(id)) continue;
      const item = this.items.get(id);
      if (!item) continue;
      if (item.status === "queued" || item.status === "added") {
        this.startItem(item);
        freeSlots--;
      }
    }
  }

  async pause(id: string) {
    await this.settleScheduledPause(id);
    const task = this.tasks.get(id);
    const item = this.items.get(id);
    if (task) {
      await task.pause();
      this.tasks.delete(id);
    } else if (item && (item.status === "queued" || item.status === "added")) {
      item.status = "paused";
    }
    if (item) await this.persist("updated", `Paused download ${item.fileName}`);
    else await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async resume(id: string, historySummary?: string) {
    await this.settleScheduledPause(id);
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === "completed") return;
    if (item.status === "cancelled" && (item.transferMode === "ssh-distributed" || item.sourceSecretStoredInVault)) {
      throw new Error("This protected download was cancelled permanently; add it again to resume safely.");
    }
    item.status = "queued";
    await this.persist("updated", historySummary ?? `Resumed download ${item.fileName}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async retry(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === "cancelled" && (item.transferMode === "ssh-distributed" || item.sourceSecretStoredInVault)) {
      throw new Error("This protected download was cancelled permanently; add it again to retry safely.");
    }
    item.error = null;
    if (item.transferMode !== "ssh-distributed") item.parts = [];
    item.downloadedSize = 0;
    await this.resume(id, `Retried download ${item.fileName}`);
  }

  async cancel(id: string) {
    await this.settleScheduledPause(id);
    const task = this.tasks.get(id);
    const item = this.items.get(id);
    if (task) {
      await task.cancel(false);
      this.tasks.delete(id);
    }
    const protectedSource = Boolean(item?.transferMode === "ssh-distributed" || item?.sourceSecretStoredInVault);
    if (item) item.status = "cancelled";
    if (item) await this.persist("updated", `Cancelled download ${item.fileName}`);
    else await this.persist();
    if (item && protectedSource) {
      // Protected cancellation is terminal.  The durable cancelled record is
      // written first; vault cleanup can be retried by startup GC if the
      // process is interrupted, while no in-memory secret remains resumable.
      this.itemHeaders.delete(id);
      this.itemSourceUrls.delete(id);
      this.distributedSources.delete(id);
      try {
        await this.credentialVault.removeDownloadSource(id);
      } catch {
        item.error = "The cancelled download source remains in the operating-system vault and will be retried safely.";
        await this.persist().catch(() => {});
      }
    }
    this.scheduleNotify();
    this.processAllQueues();
  }

  async remove(id: string, deleteFile: boolean) {
    await this.settleScheduledPause(id);
    const removedItem = this.items.get(id);
    const task = this.tasks.get(id);
    if (task) {
      await task.cancel(deleteFile);
      this.tasks.delete(id);
    } else if (deleteFile) {
      const item = this.items.get(id);
      if (item) await fsp.rm(path.join(item.folder, item.fileName), { force: true });
    }
    const protectedSource = Boolean(removedItem?.transferMode === "ssh-distributed" || removedItem?.sourceSecretStoredInVault);
    if (protectedSource && removedItem) {
      // Leave a durable terminal tombstone before touching the vault.  If the
      // process dies after the secret is removed but before the final delete
      // save, startup can still see this marker and retry cleanup safely.
      removedItem.status = "cancelled";
      removedItem.error = null;
      await this.persist("updated", `Marked download ${removedItem.fileName} for protected-source cleanup`);
      try {
        await this.credentialVault.removeDownloadSource(id);
      } catch {
        removedItem.error = "The protected download source could not be removed from the operating-system vault.";
        await this.persist().catch(() => {});
        throw new Error("The protected download source could not be removed safely");
      }
    }
    this.items.delete(id);
    this.itemHeaders.delete(id);
    this.itemOrder = this.itemOrder.filter((x) => x !== id);
    for (const queue of this.queues.values()) {
      queue.itemIds = queue.itemIds.filter((x) => x !== id);
    }
    await this.persist(
      "deleted",
      removedItem
        ? `Deleted download ${removedItem.fileName}${deleteFile ? " and its file" : " from the list"}`
        : "Deleted a download record"
    );
    this.itemSourceUrls.delete(id);
    this.distributedSources.delete(id);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async openFile(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    await shell.openPath(path.join(item.folder, item.fileName));
  }

  async openFolder(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    shell.showItemInFolder(path.join(item.folder, item.fileName));
  }

  // ---- settings ---------------------------------------------------------------

  getSettings(): AppSettings {
    return this.settings;
  }

  getScheduleRules(): ScheduledSettingsRecord[] {
    return cloneScheduleRules(this.scheduleRules);
  }

  async setScheduleRules(value: unknown): Promise<ScheduledSettingsRecord[]> {
    const nextRules = validateManagedScheduleRules(value);
    const previousRules = cloneScheduleRules(this.scheduleRules);
    const previousSerialized = JSON.stringify(previousRules);
    if (JSON.stringify(nextRules) === previousSerialized) return this.getScheduleRules();
    this.scheduleRules = cloneScheduleRules(nextRules);
    try {
      await this.persist("settings-changed", "Changed scheduled settings");
    } catch (error) {
      this.scheduleRules = previousRules;
      await this.saveState().catch(() => undefined);
      throw error;
    }
    this.emit("scheduleChanged", this.getScheduleRules());
    this.scheduleNotify();
    return this.getScheduleRules();
  }

  getPresentationSettings(): PresentationSettings {
    return presentationSettingsFromAppSettings(this.settings);
  }

  async setPresentationSettings(
    partial: PresentationPatch,
    resetKeys: readonly (typeof PRESENTATION_SETTING_KEYS)[number][] = [],
  ): Promise<PresentationSettings> {
    const validated = validatePresentationPatch(partial);
    const validatedResetKeys = validatePresentationResetKeys(resetKeys);
    if (validatedResetKeys.some((key) => Object.prototype.hasOwnProperty.call(validated, key))) {
      throw new Error("A presentation setting cannot be changed and reset in the same mutation");
    }
    await this.setSettings(validated, validatedResetKeys);
    return this.getPresentationSettings();
  }

  getSchoolModeCredentialMetadata() {
    return { ...this.settings.schoolModeCredential };
  }

  async setSchoolModeCredentialState(state: ResetCredentialState): Promise<PresentationSettings> {
    if (state !== "unavailable" && state !== "unconfigured" && state !== "configured") {
      throw new Error("Invalid School mode reset credential state");
    }
    if (this.settings.schoolModeCredential.state === state) return this.getPresentationSettings();
    const previousSettings = this.settings;
    this.settings = {
      ...this.settings,
      schoolModeCredential: { ...this.settings.schoolModeCredential, state },
    };
    try {
      await this.persist("settings-changed", "Updated School mode reset credential metadata");
    } catch (error) {
      this.settings = previousSettings;
      await this.saveState().catch(() => undefined);
      throw error;
    }
    this.emit("presentationChanged", this.getPresentationSettings());
    this.scheduleNotify();
    return this.getPresentationSettings();
  }

  async disableSchoolModeAfterCredentialVerification(): Promise<PresentationSettings> {
    if (!this.settings.schoolModeEnabled) return this.getPresentationSettings();
    await this.setSettingsInternal({ schoolModeEnabled: false }, [], true);
    return this.getPresentationSettings();
  }

  async setSettings(partial: SettingsPatch, resetKeysInput: readonly SettingKey[] = []): Promise<AppSettings> {
    return this.setSettingsInternal(partial, resetKeysInput, false);
  }

  private async setSettingsInternal(
    partial: SettingsPatch,
    resetKeysInput: readonly SettingKey[] = [],
    allowVerifiedSchoolModeDisable = false,
  ): Promise<AppSettings> {
    const validated = validateSettingsPatch(partial, { allowManagedSshHosts: true });
    const resetKeys = validateSettingResetKeys(resetKeysInput);
    if (resetKeys.some((key) => Object.prototype.hasOwnProperty.call(validated, key))) {
      throw new Error("A setting cannot be changed and reset in the same mutation");
    }
    if (Object.keys(validated).length === 0 && resetKeys.length === 0) return this.settings;

    const previousSettings = this.settings;
    const previousDisplayName = previousSettings.displayName;
    const displayNameChanged = Object.prototype.hasOwnProperty.call(validated, "displayName") &&
      validated.displayName !== previousDisplayName;
    const displayNameReset = resetKeys.includes("displayName");
    const displayNameMutation = displayNameChanged || displayNameReset;
    const presentationChanged = PRESENTATION_SETTING_KEYS.some((key) =>
      Object.prototype.hasOwnProperty.call(validated, key) || resetKeys.includes(key)
    );
    const provenance = { ...this.settings.settingProvenance };
    const nextSettings = { ...this.settings, ...validated } as AppSettings;
    for (const key of SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(validated, key)) provenance[key] = "persisted";
    }
    for (const key of resetKeys) {
      (nextSettings as unknown as Record<SettingKey, AppSettings[SettingKey]>)[key] = this.compiledSettings[key];
      provenance[key] = "compiled-in";
    }
    if (previousSettings.schoolModeEnabled && !nextSettings.schoolModeEnabled && !allowVerifiedSchoolModeDisable) {
      if (previousSettings.schoolModeCredential.state !== "configured") {
        throw new Error("School mode cannot be turned off because its locally verified reset credential is unavailable.");
      }
      throw new Error("School mode can only be turned off after verifying its reset credential.");
    }
    this.settings = {
      ...nextSettings,
      settingsVersion: this.settings.settingsVersion,
      settingProvenance: provenance,
    };
    this.globalSpeedLimiter.setLimit(this.settings.globalSpeedLimitBytes);
    if ((validated.startOnSystemStartup !== undefined || resetKeys.includes("startOnSystemStartup")) && process.platform !== "linux") {
      this.writeLoginItemSettings(this.settings.startOnSystemStartup);
    }
    if (displayNameMutation) {
      try {
        // Persist the new canonical state first, then require a dedicated
        // redacted audit commit before this IPC call can report success.
        await this.saveState();
        const action = this.settings.displayName === this.compiledSettings.displayName
          ? "display-name-reset"
          : "display-name-changed";
        await this.history.appendDisplayNameMutation(previousDisplayName, this.settings.displayName, action);
        // Keep the existing broad settings revision as a best-effort context
        // record, but never let it replace the required display-name commit.
        await this.recordHistory("settings-changed", "Changed application settings");
      } catch (error) {
        this.settings = previousSettings;
        this.globalSpeedLimiter.setLimit(previousSettings.globalSpeedLimitBytes);
        if ((validated.startOnSystemStartup !== undefined || resetKeys.includes("startOnSystemStartup")) && process.platform !== "linux") {
          this.writeLoginItemSettings(previousSettings.startOnSystemStartup);
        }
        await this.saveState().catch(() => undefined);
        throw error;
      }
    } else {
      try {
        await this.persist("settings-changed", "Changed application settings");
      } catch (error) {
        this.settings = previousSettings;
        this.globalSpeedLimiter.setLimit(previousSettings.globalSpeedLimitBytes);
        if ((validated.startOnSystemStartup !== undefined || resetKeys.includes("startOnSystemStartup")) && process.platform !== "linux") {
          this.writeLoginItemSettings(previousSettings.startOnSystemStartup);
        }
        await this.saveState().catch(() => undefined);
        throw error;
      }
    }
    if (presentationChanged) this.emit("presentationChanged", this.getPresentationSettings());
    this.scheduleNotify();
    this.processAllQueues();
    return this.settings;
  }

  /**
   * Replace the SSH host inventory only after a main-process scan/provision
   * operation has produced the new canonical values. Renderer settings patches
   * are rejected at the IPC boundary and cannot author host pins or trust.
   */
  async setManagedSshHosts(hosts: readonly unknown[]): Promise<AppSettings> {
    if (!isSshHostConfigs(hosts)) throw new Error("Invalid managed SSH host inventory");
    const validated = { sshHosts: cloneSshHostConfigs(hosts) } satisfies SettingsPatch;
    const provenance = { ...this.settings.settingProvenance, sshHosts: "persisted" as const };
    this.settings = { ...this.settings, sshHosts: validated.sshHosts, settingProvenance: provenance };
    await this.persist("settings-changed", "Updated managed SSH host inventory");
    this.scheduleNotify();
    this.processAllQueues();
    return this.settings;
  }

  async getHistoryView(filter: unknown = undefined): Promise<HistoryView> {
    const normalized = normalizeHistoryFilter(filter);
    const request = historyFilterRequest(normalized);
    const available = await this.history.isAvailable();
    if (!available) {
      return {
        schemaVersion: 1,
        available: false,
        revisions: [],
        actionCounts: {},
        totalRevisions: 0,
        matchingRevisions: 0,
        request,
        emptyReason: "Local history is unavailable; no revision data was exposed.",
      };
    }

    const allRevisions = await this.history.listRevisions();
    const revisions = await this.history.listRevisions(normalized);
    // Keep the action vocabulary visible while one action is selected. Counts
    // follow the other active filters, but intentionally omit the action
    // predicate so a selected chip cannot disappear when its result is empty.
    const actionCounts = await this.history.actionCounts({ ...normalized, actions: undefined });
    return {
      schemaVersion: 1,
      available: true,
      revisions,
      actionCounts,
      totalRevisions: allRevisions.length,
      matchingRevisions: revisions.length,
      request,
      prunedRevisions: await this.history.prunedCount(),
      emptyReason: revisions.length > 0
        ? null
        : allRevisions.length === 0
          ? "No revisions are recorded yet."
          : "No revisions match the active filters.",
    };
  }

  async getHistoryDiff(revisionId: unknown): Promise<HistoryDiff> {
    return this.history.getDiff(normalizeHistoryRevisionId(revisionId));
  }

  async labelHistoryRevision(revisionId: unknown, label: unknown): Promise<HistoryRevision | null> {
    return this.history.setLabel(normalizeHistoryRevisionId(revisionId), normalizeHistoryLabel(label));
  }

  async pruneHistory(request: unknown): Promise<HistoryPruneResult> {
    return this.history.prune(normalizeHistoryPruneRequest(request).keep);
  }

  /**
   * Restore a validated state snapshot into the live manager and append the
   * restore action. A restore never rewrites its source revision. Active
   * transfers are refused because replacing their state would strand work.
   */
  async restoreHistoryRevision(revisionId: unknown): Promise<HistoryRevision> {
    const id = normalizeHistoryRevisionId(revisionId);
    if (this.tasks.size > 0) throw new Error("Pause or finish active downloads before restoring history");
    const snapshot = await this.history.readSnapshot(id);
    if (snapshot === null) throw new Error("History revision has no restorable state snapshot");
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      throw new Error("History revision state is not valid JSON");
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.items) || !Array.isArray(parsed.queues)) {
      throw new Error("History revision state has an invalid shape");
    }
    if (parsed.items.length > 10_000 || parsed.queues.length > MAX_QUEUE_ITEM_IDS) {
      throw new Error("History revision state exceeds the supported record limit");
    }
    const restoredItems: DownloadItem[] = [];
    const seenItemIds = new Set<string>();
    for (const candidate of parsed.items) {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.id.length > 256 ||
        typeof candidate.url !== "string" || candidate.url.length > 32_768 || typeof candidate.fileName !== "string" || candidate.fileName.length > 512 ||
        typeof candidate.folder !== "string" || candidate.folder.length > 32_000 ||
        !isDownloadCategory(candidate.category) ||
        !["added", "queued", "downloading", "paused", "completed", "error", "cancelled"].includes(candidate.status as string)) {
        throw new Error("History revision contains an invalid download record");
      }
      if (seenItemIds.has(candidate.id)) throw new Error("History revision contains duplicate download ids");
      seenItemIds.add(candidate.id);
      const status = candidate.status as DownloadStatus;
      const item: DownloadItem = {
        id: candidate.id,
        url: redactUrl(candidate.url),
        fileName: sanitizeFileName(candidate.fileName),
        folder: candidate.folder.slice(0, 32_000),
        category: candidate.category,
        // Restored state is always dormant. In particular, a tampered
        // `added` record must not be picked up by a running queue.
        status: status === "added" || status === "queued" || status === "downloading" ? "paused" : status,
        totalSize: candidate.totalSize === null ? null : typeof candidate.totalSize === "number" && Number.isFinite(candidate.totalSize) && candidate.totalSize >= 0 ? candidate.totalSize : null,
        downloadedSize: typeof candidate.downloadedSize === "number" && Number.isFinite(candidate.downloadedSize) && candidate.downloadedSize >= 0 ? candidate.downloadedSize : 0,
        speed: 0,
        eta: candidate.eta === null ? null : typeof candidate.eta === "number" && Number.isFinite(candidate.eta) && candidate.eta >= 0 ? candidate.eta : null,
        resumeSupport: candidate.resumeSupport === true,
        queueId: candidate.queueId === null || typeof candidate.queueId !== "string" || candidate.queueId.length > MAX_QUEUE_ID_LENGTH ? null : candidate.queueId,
        dateAdded: typeof candidate.dateAdded === "number" && Number.isFinite(candidate.dateAdded) && candidate.dateAdded >= 0 ? candidate.dateAdded : Date.now(),
        dateCompleted: candidate.dateCompleted === null || typeof candidate.dateCompleted === "number" && Number.isFinite(candidate.dateCompleted) && candidate.dateCompleted >= 0 ? candidate.dateCompleted : null,
        error: candidate.error === null || typeof candidate.error === "string" ? (candidate.error === null ? null : redactErrorMessage(candidate.error, candidate.url, candidate.url)) : null,
        ...(typeof candidate.transferNotice === "string" ? { transferNotice: candidate.transferNotice.slice(0, 4_096) } : {}),
        // Never restore vault-backed source metadata or SSH assignments from
        // an untrusted snapshot. The public URL remains resumable only after
        // the user explicitly adds the source again.
        sourceSecretStoredInVault: false,
        parts: [],
        connections: typeof candidate.connections === "number" && Number.isSafeInteger(candidate.connections) && candidate.connections > 0 && candidate.connections <= 64 ? candidate.connections : 1,
        transferMode: "local",
      };
      restoredItems.push(item);
    }
    const restoredQueues: DownloadQueue[] = [];
    const seenQueueIds = new Set<string>();
    for (const candidate of parsed.queues) {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0 ||
        candidate.id.length > MAX_QUEUE_ID_LENGTH || typeof candidate.name !== "string" || candidate.name.length === 0 || candidate.name.length > MAX_QUEUE_NAME_LENGTH ||
        !Array.isArray(candidate.itemIds) || candidate.itemIds.length > MAX_QUEUE_ITEM_IDS) {
        throw new Error("History revision contains an invalid queue record");
      }
      if (seenQueueIds.has(candidate.id)) throw new Error("History revision contains duplicate queue ids");
      seenQueueIds.add(candidate.id);
      const queueItemIds = candidate.itemIds.filter((itemId): itemId is string => isQueueItemId(itemId) && seenItemIds.has(itemId));
      restoredQueues.push({
        id: candidate.id,
        name: candidate.name.slice(0, MAX_QUEUE_NAME_LENGTH),
        maxConcurrent: typeof candidate.maxConcurrent === "number" && Number.isSafeInteger(candidate.maxConcurrent) && candidate.maxConcurrent > 0 && candidate.maxConcurrent <= 64 ? candidate.maxConcurrent : 3,
        // Restored transfers are dormant; a tampered running flag must not
        // make the queue start work while the restore is being committed.
        isRunning: false,
        itemIds: queueItemIds,
        scheduleEnabled: candidate.scheduleEnabled === true,
        startAt: typeof candidate.startAt === "string" && candidate.startAt.length <= 16 ? candidate.startAt : null,
        endAt: typeof candidate.endAt === "string" && candidate.endAt.length <= 16 ? candidate.endAt : null,
      });
    }
    const defaultSaveFolder = this.settings?.defaultSaveFolder ?? path.join(process.env.USERPROFILE || process.env.HOME || this.userDataPath, "Downloads");
    const migratedSettings = migrateSettings(parsed.settings, defaultSaveFolder);
    // History access is not a substitute for the shared School-mode
    // credential. Preserve the live mode/name/verifier metadata across a
    // restore so an old snapshot cannot silently disable or rename it.
    const restoredSettings = {
      ...migratedSettings,
      schoolModeEnabled: this.settings.schoolModeEnabled,
      schoolModeName: this.settings.schoolModeName,
      schoolModeCredential: { ...this.settings.schoolModeCredential },
    };
    const restoredRules = validateManagedScheduleRules(parsed.scheduleRules ?? []);
    const previous = {
      items: this.items,
      itemOrder: this.itemOrder,
      queues: this.queues,
      settings: this.settings,
      scheduleRules: this.scheduleRules,
      globalSpeedLimiter: this.globalSpeedLimiter,
      itemHeaders: this.itemHeaders,
      itemSourceUrls: this.itemSourceUrls,
      distributedSources: this.distributedSources,
    };
    const nextItems = new Map(restoredItems.map((item) => [item.id, item] as const));
    // Do not copy existing private maps by item ID: a modified snapshot could
    // otherwise adopt a live vault-backed source and redirect it elsewhere.
    const nextHeaders = new Map<string, Record<string, string>>();
    const nextSourceUrls = new Map<string, string>();
    const nextDistributedSources = new Map<string, DistributedSourceSecret>();
    const displayNameChanged = previous.settings.displayName !== restoredSettings.displayName;
    this.items = nextItems;
    this.itemOrder = restoredItems.map((item) => item.id);
    this.queues = new Map(restoredQueues.map((queue) => [queue.id, queue] as const));
    this.settings = restoredSettings;
    this.scheduleRules = restoredRules;
    this.itemHeaders = nextHeaders;
    this.itemSourceUrls = nextSourceUrls;
    this.distributedSources = nextDistributedSources;
    this.globalSpeedLimiter = new SpeedLimiter(this.settings.globalSpeedLimitBytes);
    try {
      await this.saveState();
      const canonicalSnapshot = JSON.stringify(this.getState(), null, 2);
      const revision = await this.history.appendSnapshot(canonicalSnapshot, "restored", `Restored revision ${id.slice(0, 8)}`, true);
      if (!revision) throw new Error("History restore did not create an audit revision");
      if (displayNameChanged) {
        await this.history.appendDisplayNameMutation(previous.settings.displayName, restoredSettings.displayName, "display-name-changed");
      }
      this.emit("presentationChanged", this.getPresentationSettings());
      this.scheduleNotify();
      this.processAllQueues();
      return revision;
    } catch (error) {
      this.items = previous.items;
      this.itemOrder = previous.itemOrder;
      this.queues = previous.queues;
      this.settings = previous.settings;
      this.scheduleRules = previous.scheduleRules;
      this.globalSpeedLimiter = previous.globalSpeedLimiter;
      this.itemHeaders = previous.itemHeaders;
      this.itemSourceUrls = previous.itemSourceUrls;
      this.distributedSources = previous.distributedSources;
      await this.saveState().catch(() => undefined);
      throw error;
    }
  }

  async exportHistory(format: ExportFormat, filter: unknown = undefined): Promise<ExportResult> {
    const normalized = normalizeHistoryFilter(filter);
    if (!(await this.history.isAvailable())) throw new Error("Local history is unavailable");
    return this.history.exportRevisions(format, normalized);
  }

  // ---- queues ---------------------------------------------------------------

  async createQueue(partial: Partial<DownloadQueue>): Promise<DownloadQueue> {
    assertQueueCreatePayload(partial);
    const queue: DownloadQueue = {
      id: partial.id || crypto.randomUUID(),
      name: partial.name || "New Queue",
      maxConcurrent: partial.maxConcurrent ?? 3,
      isRunning: partial.isRunning ?? true,
      itemIds: partial.itemIds ?? [],
      scheduleEnabled: partial.scheduleEnabled ?? false,
      startAt: partial.startAt ?? null,
      endAt: partial.endAt ?? null,
    };
    this.queues.set(queue.id, queue);
    await this.persist("created", `Created queue ${queue.name}`);
    this.scheduleNotify();
    this.processAllQueues();
    return queue;
  }

  async updateQueue(queue: DownloadQueue) {
    this.queues.set(queue.id, queue);
    await this.persist("updated", `Updated queue ${queue.name}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async deleteQueue(id: string) {
    if (id === DEFAULT_QUEUE_ID) return;
    const queue = this.queues.get(id);
    if (queue) {
      const fallback = this.queues.get(DEFAULT_QUEUE_ID);
      for (const itemId of queue.itemIds) {
        const item = this.items.get(itemId);
        if (item) item.queueId = DEFAULT_QUEUE_ID;
        fallback?.itemIds.push(itemId);
      }
    }
    this.queues.delete(id);
    await this.persist("deleted", `Deleted queue ${queue?.name ?? id}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async startQueue(id: string) {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.isRunning = true;
    await this.persist("updated", `Started queue ${queue.name}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async stopQueue(id: string) {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.isRunning = false;
    for (const itemId of queue.itemIds) {
      await this.settleScheduledPause(itemId);
      const task = this.tasks.get(itemId);
      if (task) {
        await task.pause();
        this.tasks.delete(itemId);
      }
    }
    await this.persist("updated", `Stopped queue ${queue.name}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  // ---- lifecycle ---------------------------------------------------------------

  async shutdown() {
    if (this.shutDown) return;
    this.shutDown = true;
    this.scheduleClock.stop();
    const scheduledPausePromises = Array.from(this.scheduledPauses.values());
    await Promise.all(scheduledPausePromises);
    this.scheduledPauses.clear();
    const pausePromises = Array.from(this.tasks.entries()).map(async ([id, task]) => {
      await task.pause();
      this.tasks.delete(id);
    });
    await Promise.all(pausePromises);
    await this.drainPendingOperations();
    await this.persist();
    await this.history.flush();
    this.itemSourceUrls.clear();
  }
}
