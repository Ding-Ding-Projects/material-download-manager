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
import { DEFAULT_QUEUE_ID } from "../../shared/types";
import { StateStore } from "./persistence";
import { detectCategory } from "./categories";
import { probeUrl as httpProbeUrl, sanitizeFileName } from "./HttpProbe";
import { DownloadTask } from "./DownloadTask";
import { SpeedLimiter } from "./SpeedLimiter";
import {
  cloneRequestHeaders,
  splitStoredDownload,
  type StoredDownloadItem,
  withStoredHeaders,
} from "./downloadMetadata";
import { isQueueScheduleActive, QueueScheduleClock } from "./queueSchedule";

export class DownloadManager extends EventEmitter {
  private store: StateStore;
  private items: Map<string, DownloadItem> = new Map();
  private queues: Map<string, DownloadQueue> = new Map();
  private settings!: AppSettings;
  private tasks: Map<string, DownloadTask> = new Map();
  private itemHeaders: Map<string, Record<string, string>> = new Map();
  private globalSpeedLimiter!: SpeedLimiter;
  private notifyScheduled = false;
  private shutDown = false;
  private itemOrder: string[] = [];
  private scheduledPauses: Set<string> = new Set();
  private scheduleClock = new QueueScheduleClock(() => this.processAllQueues());

  constructor(private userDataPath: string) {
    super();
    this.store = new StateStore(userDataPath);
  }

  get isShutDown() {
    return this.shutDown;
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
    for (const storedItem of state.items as StoredDownloadItem[]) {
      const { item, headers } = splitStoredDownload(storedItem);
      if (headers) this.itemHeaders.set(item.id, headers);
      item.fileName = sanitizeFileName(item.fileName);
      this.items.set(item.id, item);
      this.itemOrder.push(item.id);
    }
    await fsp.mkdir(this.settings.defaultSaveFolder, { recursive: true }).catch(() => {});
    this.scheduleClock.start();
    this.processAllQueues();
  }

  // ---- state / persistence -------------------------------------------------

  getState(): StateSnapshot {
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

  private async persist() {
    await this.store.save({
      items: Array.from(this.items.values()).map((item) =>
        withStoredHeaders(item, this.itemHeaders.get(item.id))
      ),
      queues: Array.from(this.queues.values()),
      settings: this.settings,
    });
  }

  // ---- probing / adding -----------------------------------------------------

  async probeUrl(url: string, headers: Record<string, string> = {}): Promise<NewDownloadInfo> {
    return httpProbeUrl(url, cloneRequestHeaders(headers) ?? {});
  }

  async addDownload(req: AddDownloadRequest): Promise<string> {
    const id = crypto.randomUUID();
    const folder = req.folder || this.settings.defaultSaveFolder;
    let fileName = sanitizeFileName(req.fileName || "download");
    fileName = await this.resolveNameCollision(folder, fileName);

    const item: DownloadItem = {
      id,
      url: req.url,
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

    const headers = cloneRequestHeaders(req.headers);
    if (headers) this.itemHeaders.set(id, headers);

    try {
      const info = await httpProbeUrl(req.url, headers ?? {});
      item.totalSize = info.contentLength;
      item.resumeSupport = info.resumeSupport;
    } catch (e) {
      item.error = e instanceof Error ? e.message : String(e);
    }

    this.items.set(id, item);
    this.itemOrder.unshift(id);
    const queue = this.queues.get(item.queueId!) ?? this.queues.get(DEFAULT_QUEUE_ID)!;
    queue.itemIds.unshift(id);

    if (req.startImmediately) {
      item.status = "queued";
      this.processQueue(queue.id);
    }

    await this.persist();
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
    const task = new DownloadTask(item, {
      maxConnections: this.settings.maxConnectionsPerDownload,
      minPartSize: this.settings.minConnectionPartSize,
      headers: this.itemHeaders.get(item.id),
      speedLimiters: [this.globalSpeedLimiter],
    });
    task.on("progress", () => this.scheduleNotify());
    task.on("completed", async () => {
      this.tasks.delete(item.id);
      await this.persist();
      this.scheduleNotify();
      this.emit("itemCompleted", item);
      this.processAllQueues();
    });
    task.on("error", async () => {
      this.tasks.delete(item.id);
      await this.persist();
      this.scheduleNotify();
      this.processAllQueues();
    });
    task.on("paused", async () => {
      if (!this.scheduledPauses.has(item.id)) {
        await this.persist();
        this.scheduleNotify();
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
    task.start().catch(async (e) => {
      item.status = "error";
      item.error = e instanceof Error ? e.message : String(e);
      this.tasks.delete(item.id);
      await this.persist();
      this.scheduleNotify();
      this.processAllQueues();
    });
  }

  private pauseQueueForSchedule(queue: DownloadQueue) {
    for (const itemId of queue.itemIds) {
      const task = this.tasks.get(itemId);
      const item = this.items.get(itemId);
      if (!task || !item || this.scheduledPauses.has(itemId)) continue;
      this.scheduledPauses.add(itemId);
      task
        .pause()
        .then(async () => {
          this.tasks.delete(itemId);
          this.scheduledPauses.delete(itemId);
          // Scheduled pauses are resumable when the next window opens, but a
          // real shutdown must persist the paused state it just established.
          if (!this.shutDown && item.status === "paused") item.status = "queued";
          await this.persist();
          this.scheduleNotify();
          this.processAllQueues();
        })
        .catch(() => {
          this.scheduledPauses.delete(itemId);
        });
    }
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
    if (!queue || !queue.isRunning || !isQueueScheduleActive(queue)) return;
    const activeCount = queue.itemIds.filter((id) => this.tasks.has(id)).length;
    const globalActiveCount = this.tasks.size;
    let freeSlots = Math.max(
      0,
      Math.min(queue.maxConcurrent - activeCount, this.settings.maxActiveDownloads - globalActiveCount)
    );
    if (freeSlots <= 0) return;
    for (const id of queue.itemIds) {
      if (freeSlots <= 0) break;
      const item = this.items.get(id);
      if (!item) continue;
      if (item.status === "queued" || item.status === "added") {
        this.startItem(item);
        freeSlots--;
      }
    }
  }

  async pause(id: string) {
    const task = this.tasks.get(id);
    const item = this.items.get(id);
    if (task) {
      await task.pause();
      this.tasks.delete(id);
    } else if (item && (item.status === "queued" || item.status === "added")) {
      item.status = "paused";
    }
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async resume(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === "completed") return;
    item.status = "queued";
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async retry(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    item.error = null;
    item.parts = [];
    item.downloadedSize = 0;
    await this.resume(id);
  }

  async cancel(id: string) {
    const task = this.tasks.get(id);
    const item = this.items.get(id);
    if (task) {
      await task.cancel(false);
      this.tasks.delete(id);
    }
    if (item) item.status = "cancelled";
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async remove(id: string, deleteFile: boolean) {
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
    this.itemOrder = this.itemOrder.filter((x) => x !== id);
    for (const queue of this.queues.values()) {
      queue.itemIds = queue.itemIds.filter((x) => x !== id);
    }
    await this.persist();
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
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
    return this.settings;
  }

  // ---- queues ---------------------------------------------------------------

  async createQueue(partial: Partial<DownloadQueue>): Promise<DownloadQueue> {
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
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
    return queue;
  }

  async updateQueue(queue: DownloadQueue) {
    this.queues.set(queue.id, queue);
    await this.persist();
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
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async startQueue(id: string) {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.isRunning = true;
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  async stopQueue(id: string) {
    const queue = this.queues.get(id);
    if (!queue) return;
    queue.isRunning = false;
    for (const itemId of queue.itemIds) {
      const task = this.tasks.get(itemId);
      if (task) {
        await task.pause();
        this.tasks.delete(itemId);
      }
    }
    await this.persist();
    this.scheduleNotify();
    this.processAllQueues();
  }

  // ---- lifecycle ---------------------------------------------------------------

  async shutdown() {
    if (this.shutDown) return;
    this.shutDown = true;
    this.scheduleClock.stop();
    this.scheduledPauses.clear();
    const pausePromises = Array.from(this.tasks.entries()).map(async ([id, task]) => {
      await task.pause();
      this.tasks.delete(id);
    });
    await Promise.all(pausePromises);
    await this.persist();
  }
}
