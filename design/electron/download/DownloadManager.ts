import { EventEmitter } from "node:events";
import path from "node:path";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { app, shell } from "electron";
import type {
  AddDownloadRequest,
  AppSettings,
  DownloadItem,
  DownloadQueue,
  NewDownloadInfo,
  StateSnapshot,
} from "../../shared/types";
import type { ExportFormat, ExportResult } from "../../shared/export";
import { historyFilterRequest, normalizeHistoryFilter, type HistoryFilter, type HistoryView } from "../../shared/history";
import { DEFAULT_QUEUE_ID } from "../../shared/types";
import { StateStore } from "./persistence";
import { detectCategory } from "./categories";
import { probeUrl as httpProbeUrl, redactErrorMessage, redactUrl, sanitizeFileName } from "./HttpProbe";
import { DownloadTask } from "./DownloadTask";
import { SpeedLimiter } from "./SpeedLimiter";
import {
  cloneRequestHeaders,
  splitStoredDownload,
  type StoredDownloadItem,
  withStoredHeaders,
} from "./downloadMetadata";
import { isQueueScheduleActive, QueueScheduleClock } from "./queueSchedule";
import { HistoryStore, type HistoryAction } from "../history/HistoryStore";

const MAX_QUEUE_NAME_LENGTH = 512;
const MAX_QUEUE_ID_LENGTH = 256;
const MAX_QUEUE_ITEM_IDS = 10_000;

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
  private tasks: Map<string, DownloadTask> = new Map();
  private itemHeaders: Map<string, Record<string, string>> = new Map();
  /** Raw source URLs stay in memory only so active credentialed transfers work. */
  private itemSourceUrls: Map<string, string> = new Map();
  private globalSpeedLimiter!: SpeedLimiter;
  private notifyScheduled = false;
  private shutDown = false;
  private itemOrder: string[] = [];
  private scheduledPauses: Map<string, Promise<void>> = new Map();
  private pendingOperations = new Set<Promise<void>>();
  private scheduleClock = new QueueScheduleClock(() => this.processAllQueues());

  constructor(private userDataPath: string) {
    super();
    this.store = new StateStore(userDataPath);
    this.history = new HistoryStore(userDataPath);
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
    const defaultSaveFolder = path.join(
      process.env.USERPROFILE || process.env.HOME || this.userDataPath,
      "Downloads",
      "MaterialDownloadManager"
    );
    const state = await this.store.load(defaultSaveFolder);
    this.settings = state.settings;
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
      if (headers) this.itemHeaders.set(item.id, headers);
      const sourceUrl = item.url;
      item.url = redactUrl(sourceUrl);
      if (sourceUrl !== item.url) {
        this.itemSourceUrls.set(item.id, sourceUrl);
        stateNeedsUrlMigration = true;
      }
      this.sanitizeItem(item);
      item.fileName = sanitizeFileName(item.fileName);
      this.items.set(item.id, item);
      this.itemOrder.push(item.id);
    }
    await fsp.mkdir(this.settings.defaultSaveFolder, { recursive: true }).catch(() => {});
    if (stateNeedsUrlMigration) await this.persist();
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

  private async persist(action?: HistoryAction, summary?: string) {
    this.sanitizeItems();
    await this.store.save({
      items: Array.from(this.items.values()).map((item) =>
        withStoredHeaders(item, this.itemHeaders.get(item.id))
      ),
      queues: Array.from(this.queues.values()),
      settings: this.settings,
    });
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

  async addDownload(req: AddDownloadRequest): Promise<string> {
    const id = crypto.randomUUID();
    const folder = req.folder || this.settings.defaultSaveFolder;
    let fileName = sanitizeFileName(req.fileName || "download");
    fileName = await this.resolveNameCollision(folder, fileName);

    const item: DownloadItem = {
      id,
      url: redactUrl(req.url),
      fileName,
      folder,
      category: detectCategory(fileName),
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
    };

    this.itemSourceUrls.set(id, req.url);
    const headers = cloneRequestHeaders(req.headers);
    if (headers) this.itemHeaders.set(id, headers);

    try {
      const info = await httpProbeUrl(req.url, headers ?? {});
      item.totalSize = info.contentLength;
      item.resumeSupport = info.resumeSupport;
    } catch (e) {
      item.error = redactErrorMessage(e, req.url);
    }

    this.items.set(id, item);
    this.itemOrder.unshift(id);
    const queue = this.queues.get(item.queueId!) ?? this.queues.get(DEFAULT_QUEUE_ID)!;
    queue.itemIds.unshift(id);

    if (req.startImmediately) {
      item.status = "queued";
      this.processQueue(queue.id);
    }

    await this.persist("created", `Created download ${fileName}`);
    this.scheduleNotify();
    return id;
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

  private createTask(item: DownloadItem): DownloadTask {
    const task = new DownloadTask(this.taskItem(item), {
      maxConnections: this.settings.maxConnectionsPerDownload,
      minPartSize: this.settings.minConnectionPartSize,
      headers: this.itemHeaders.get(item.id),
      speedLimiters: [this.globalSpeedLimiter],
    });
    task.on("progress", () => this.scheduleNotify());
    task.on("completed", () => {
      this.trackOperation(
        (async () => {
          this.tasks.delete(item.id);
          await this.persist("updated", `Completed download ${item.fileName}`);
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
    const task = this.createTask(item);
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
    item.status = "queued";
    await this.persist("updated", historySummary ?? `Resumed download ${item.fileName}`);
    this.scheduleNotify();
    this.processAllQueues();
  }

  async retry(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.error = null;
    item.parts = [];
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
    if (item) item.status = "cancelled";
    if (item) await this.persist("updated", `Cancelled download ${item.fileName}`);
    else await this.persist();
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
    this.items.delete(id);
    this.itemHeaders.delete(id);
    this.itemSourceUrls.delete(id);
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

  async setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = { ...this.settings, ...partial };
    this.globalSpeedLimiter.setLimit(this.settings.globalSpeedLimitBytes);
    if (partial.startOnSystemStartup !== undefined && process.platform !== "linux") {
      app.setLoginItemSettings({ openAtLogin: partial.startOnSystemStartup });
    }
    await this.persist("settings-changed", "Changed application settings");
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
      emptyReason: revisions.length > 0
        ? null
        : allRevisions.length === 0
          ? "No revisions are recorded yet."
          : "No revisions match the active filters.",
    };
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
