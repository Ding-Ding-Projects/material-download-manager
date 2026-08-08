import path from "node:path";
import { Worker } from "node:worker_threads";
import type { AutoOrganizeRule, DownloadCategory } from "../../shared/types";
import { AUTO_ORGANIZE_FOLDERS } from "../../shared/types";
import { detectCategory, resolveCategory } from "../../shared/categories";

export { detectCategory, resolveCategory } from "../../shared/categories";

const CATEGORY_REGEX_TIMEOUT_MS = 1_000;
const CATEGORY_WORKER_STARTUP_TIMEOUT_MS = 10_000;

interface CategoryWorkerResponse {
  type: "ready" | "result";
  id?: number;
  category?: DownloadCategory | null;
}

interface PendingCategoryResolution {
  fallback: DownloadCategory;
  resolve: (category: DownloadCategory) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerReadiness {
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

class CategoryRegexWorkerClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, PendingCategoryResolution>();
  private readonly readiness = new Map<Worker, WorkerReadiness>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, "categoryRegexWorker.js"));
    this.worker = worker;
    worker.on("message", (message: CategoryWorkerResponse) => {
      if (message.type === "ready") {
        const readiness = this.readiness.get(worker);
        if (readiness) {
          clearTimeout(readiness.timer);
          readiness.resolve(true);
          this.readiness.delete(worker);
        }
        return;
      }
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message.category ?? pending.fallback);
    });
    worker.on("error", () => this.failWorker(worker));
    worker.on("exit", () => this.failWorker(worker));
    worker.unref();
    let markReady!: (ready: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      markReady = resolve;
    });
    const timer = setTimeout(() => this.failWorker(worker), CATEGORY_WORKER_STARTUP_TIMEOUT_MS);
    this.readiness.set(worker, { promise, resolve: markReady, timer });
    return worker;
  }

  private failWorker(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = null;
    void worker.terminate().catch(() => undefined);
    const readiness = this.readiness.get(worker);
    if (readiness) {
      clearTimeout(readiness.timer);
      readiness.resolve(false);
      this.readiness.delete(worker);
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.resolve(request.fallback);
    }
  }

  resolve(
    fileName: string,
    url: string,
    rules: readonly AutoOrganizeRule[],
    timeoutMs = CATEGORY_REGEX_TIMEOUT_MS
  ): Promise<DownloadCategory> {
    const fallback = detectCategory(fileName);
    if (rules.length === 0 || timeoutMs <= 0) return Promise.resolve(fallback);
    const worker = this.ensureWorker();
    const readiness = this.readiness.get(worker)?.promise ?? Promise.resolve(true);
    return readiness.then((ready) => new Promise<DownloadCategory>((resolve) => {
      if (!ready || this.worker !== worker) {
        resolve(fallback);
        return;
      }
      const id = ++this.nextId;
      const timer = setTimeout(() => this.failWorker(worker), Math.max(0, timeoutMs));
      this.pending.set(id, { fallback, resolve, timer });
      try {
        worker.postMessage({ id, fileName, url, rules: rules.map((rule) => ({ ...rule })) });
      } catch {
        this.failWorker(worker);
      }
    }));
  }
}

const categoryRegexWorker = new CategoryRegexWorkerClient();

/**
 * Evaluate user-authored categorization expressions off the Electron event
 * loop. A timed-out or failed worker is terminated and falls back to the
 * built-in extension mapping, so a hostile expression cannot block adding a
 * download or keep a poisoned worker alive for the next request.
 */
export function resolveCategoryIsolated(
  fileName: string,
  url: string,
  rules: readonly AutoOrganizeRule[],
  timeoutMs = CATEGORY_REGEX_TIMEOUT_MS
): Promise<DownloadCategory> {
  return categoryRegexWorker.resolve(fileName, url, rules, timeoutMs);
}

/** The on-disk folder name a category organizes into. */
export function categoryFolderName(category: DownloadCategory): string {
  return AUTO_ORGANIZE_FOLDERS[category] ?? AUTO_ORGANIZE_FOLDERS.other;
}

function normalizeFolderPath(value: string): string {
  const resolved = path.resolve(value.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Decide the destination folder for a new download. Auto-organize routes into
 * a category subfolder only when the caller left the folder empty or chose
 * exactly the default save folder; an explicit different folder is always
 * honored as-is.
 */
export function resolveDownloadFolder(
  requestedFolder: string,
  defaultSaveFolder: string,
  category: DownloadCategory,
  autoOrganizeEnabled: boolean
): string {
  const base = requestedFolder || defaultSaveFolder;
  if (!path.isAbsolute(base) && !path.win32.isAbsolute(base)) {
    throw new Error("Download folder must be an absolute path");
  }
  const usesDefaultFolder = !requestedFolder || normalizeFolderPath(requestedFolder) === normalizeFolderPath(defaultSaveFolder);
  if (!autoOrganizeEnabled) return base;
  if (!usesDefaultFolder) {
    return requestedFolder;
  }
  return path.join(defaultSaveFolder, categoryFolderName(category));
}
