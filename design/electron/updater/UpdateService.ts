import { EventEmitter } from "node:events";

export const UPDATE_STARTUP_DELAY_MS = 15_000;
export const UPDATE_BACKGROUND_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const UPDATE_CHECK_TIMEOUT_MS = 30_000;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1_000;

const MAX_STARTUP_DELAY_MS = 60_000;
const MIN_BACKGROUND_INTERVAL_MS = 60_000;
const MAX_BACKGROUND_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CHECK_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export type UpdateState =
  | { status: "current"; version: string; checkedAt: number }
  | { status: "available"; version: string | null; checkedAt: number }
  | { status: "downloading"; version: string | null; checkedAt: number; percent: number }
  | { status: "ready"; version: string | null; checkedAt: number }
  | { status: "failed"; version: string | null; checkedAt: number; message: string }
  | { status: "offline"; version: string | null; checkedAt: number; message: string };

export interface UpdateInfoLike {
  version?: unknown;
}

export interface UpdateCheckResultLike {
  updateInfo?: UpdateInfoLike;
}

export interface UpdateProgressLike {
  percent?: unknown;
}

export interface UpdaterAdapter {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): UpdateCheckResultLike | null | Promise<UpdateCheckResultLike | null> | void;
  /** Optional: Electron's built-in Squirrel updater downloads automatically. */
  downloadUpdate?: () => Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
}

export interface UpdateServiceOptions {
  adapter: UpdaterAdapter;
  currentVersion: string;
  isPackaged: boolean;
  supportedPlatform?: boolean;
  feedUrl?: string;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
  startupDelayMs?: number;
  backgroundIntervalMs?: number;
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
  logger?: (message: string) => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

function boundedDelay(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function updateVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function networkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return [
    "offline",
    "network",
    "enotfound",
    "eai_again",
    "econnrefused",
    "etimedout",
    "timeout",
    "internet",
    "err_internet",
    "err_network",
    "fetch failed",
    "socket hang up",
  ].some((fragment) => normalized.includes(fragment));
}

function timeoutError(): Error {
  return new Error("Update operation timed out");
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(timeoutError());
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Accept only a public HTTPS feed URL. Credentials in URLs and query strings
 * are rejected so an update secret cannot accidentally enter process state or
 * renderer-facing diagnostics.
 */
export function normalizeUpdateFeedUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readUpdateFeedUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment.MDM_UPDATE_FEED_URL?.trim();
  return value || undefined;
}

/**
 * Main-process update coordinator for Squirrel.Windows. It never installs an
 * update during active work: download is backgrounded, while installation is
 * exposed as an explicit `quitAndInstall` action for a later UI/IPC surface.
 */
export class UpdateService extends EventEmitter {
  private readonly adapter: UpdaterAdapter;
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly supportedPlatform: boolean;
  private readonly feedUrl: string | null;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelSchedule: (handle: TimerHandle) => void;
  private readonly startupDelayMs: number;
  private readonly backgroundIntervalMs: number;
  private readonly checkTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly logger: (message: string) => void;
  private state: UpdateState;
  private timer: TimerHandle | null = null;
  private started = false;
  private stopped = false;
  private checkInFlight: Promise<unknown> | null = null;
  private downloadInFlight = false;
  private availableVersion: string | null = null;

  private readonly handleUpdateAvailable = (info?: UpdateInfoLike) => {
    const version = updateVersion(info?.version);
    this.availableVersion = version;
    this.setState({ status: "available", version });
    void this.downloadAvailableUpdate();
  };

  private readonly handleUpdateNotAvailable = () => {
    if (this.downloadInFlight || this.state.status === "ready") return;
    this.setState({ status: "current", version: this.currentVersion });
  };

  private readonly handleDownloadProgress = (progress: UpdateProgressLike) => {
    const version = this.availableVersion;
    if (!version || (this.state.status !== "downloading" && this.state.status !== "available")) return;
    const percent = typeof progress?.percent === "number" && Number.isFinite(progress.percent)
      ? Math.min(100, Math.max(0, progress.percent))
      : 0;
    this.setState({ status: "downloading", version, percent });
  };

  private readonly handleUpdateDownloaded = (...args: unknown[]) => {
    const releaseName = updateVersion(args[2]);
    const version = releaseName ?? this.availableVersion;
    this.availableVersion = version;
    this.setState({ status: "ready", version });
  };

  private readonly handleError = (error: unknown) => {
    if (networkFailure(error)) this.offline();
    else this.fail("The update operation failed.");
  };

  constructor(options: UpdateServiceOptions) {
    super();
    this.adapter = options.adapter;
    this.currentVersion = options.currentVersion;
    this.isPackaged = options.isPackaged;
    this.supportedPlatform = options.supportedPlatform ?? true;
    this.feedUrl = normalizeUpdateFeedUrl(options.feedUrl);
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle));
    this.startupDelayMs = boundedDelay(options.startupDelayMs, UPDATE_STARTUP_DELAY_MS, 0, MAX_STARTUP_DELAY_MS);
    this.backgroundIntervalMs = boundedDelay(
      options.backgroundIntervalMs,
      UPDATE_BACKGROUND_INTERVAL_MS,
      MIN_BACKGROUND_INTERVAL_MS,
      MAX_BACKGROUND_INTERVAL_MS
    );
    this.checkTimeoutMs = boundedDelay(options.checkTimeoutMs, UPDATE_CHECK_TIMEOUT_MS, 1_000, MAX_CHECK_TIMEOUT_MS);
    this.downloadTimeoutMs = boundedDelay(
      options.downloadTimeoutMs,
      UPDATE_DOWNLOAD_TIMEOUT_MS,
      5_000,
      MAX_DOWNLOAD_TIMEOUT_MS
    );
    this.logger = options.logger ?? (() => {});
    this.state = { status: "current", version: this.currentVersion, checkedAt: 0 };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  onStateChanged(listener: (state: UpdateState) => void): () => void {
    this.on("state-changed", listener);
    return () => this.removeListener("state-changed", listener);
  }

  start(): UpdateState {
    if (this.started) return this.getState();
    this.started = true;
    this.stopped = false;
    this.attachListeners();

    if (!this.isPackaged) {
      this.fail("Automatic updates are disabled for development builds.");
      return this.getState();
    }
    if (!this.supportedPlatform) {
      this.fail("Automatic updates are supported only on Windows Squirrel builds.");
      return this.getState();
    }
    if (!this.feedUrl) {
      this.fail("No public HTTPS update feed is configured.");
      return this.getState();
    }

    try {
      this.adapter.setFeedURL({ url: this.feedUrl });
    } catch {
      this.fail("The update feed could not be configured.");
      return this.getState();
    }

    this.scheduleNext(this.startupDelayMs);
    return this.getState();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.cancelSchedule(this.timer);
      this.timer = null;
    }
    this.detachListeners();
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (this.stopped || !this.started) return this.getState();
    if (!this.isPackaged || !this.supportedPlatform || !this.feedUrl) return this.getState();
    if (this.checkInFlight || this.downloadInFlight || this.state.status === "ready") return this.getState();

    let operation: Promise<UpdateCheckResultLike | null | void>;
    try {
      operation = Promise.resolve(this.adapter.checkForUpdates());
    } catch {
      this.fail("The update check could not start.");
      return this.getState();
    }
    this.checkInFlight = operation;
    void operation.then(
      () => this.clearCheck(operation),
      () => this.clearCheck(operation)
    );

    try {
      const result = await withTimeout(operation, this.checkTimeoutMs);
      if (this.state.status === "current" || this.state.status === "failed" || this.state.status === "offline") {
        const info = result?.updateInfo;
        if (info) this.handleUpdateAvailable(info);
        else this.setState({ status: "current", version: this.currentVersion });
      }
    } catch (error) {
      if (this.state.status !== "failed" && this.state.status !== "offline") {
        if (networkFailure(error)) this.offline();
        else this.fail("The update check failed.");
      }
    }
    return this.getState();
  }

  async downloadAvailableUpdate(): Promise<boolean> {
    if (this.stopped || !this.started || !this.isPackaged || !this.feedUrl || this.downloadInFlight) return false;
    const version = this.availableVersion ?? (this.state.status === "available" ? this.state.version : null);
    if (!version && this.state.status !== "available") return false;

    this.downloadInFlight = true;
    this.setState({ status: "downloading", version, percent: 0 });
    if (!this.adapter.downloadUpdate) {
      // Electron's built-in Squirrel autoUpdater starts this download as part
      // of checkForUpdates(). Its progress and completion events finish the
      // state transition; there is no second download call to make here.
      this.downloadInFlight = false;
      return false;
    }
    try {
      await withTimeout(Promise.resolve(this.adapter.downloadUpdate()), this.downloadTimeoutMs);
      if (this.state.status === "downloading") this.setState({ status: "ready", version });
      return this.state.status === "ready";
    } catch (error) {
      if (this.state.status !== "ready") {
        if (networkFailure(error)) this.offline();
        else this.fail("The update download failed.");
      }
      return false;
    } finally {
      this.downloadInFlight = false;
    }
  }

  quitAndInstall(): boolean {
    if (this.state.status !== "ready") return false;
    try {
      this.adapter.quitAndInstall();
      return true;
    } catch {
      this.fail("The ready update could not be installed.");
      return false;
    }
  }

  private clearCheck(operation: Promise<unknown>) {
    if (this.checkInFlight === operation) this.checkInFlight = null;
  }

  private setState(next: { status: "current" | "available" | "downloading" | "ready"; version: string | null; percent?: number }) {
    const checkedAt = this.now();
    switch (next.status) {
      case "current":
        this.state = { status: "current", version: next.version ?? this.currentVersion, checkedAt };
        break;
      case "available":
        this.state = { status: "available", version: next.version, checkedAt };
        break;
      case "downloading":
        this.state = { status: "downloading", version: next.version, percent: next.percent ?? 0, checkedAt };
        break;
      case "ready":
        this.state = { status: "ready", version: next.version, checkedAt };
        break;
    }
    this.emit("state-changed", this.getState());
  }

  private fail(message: string) {
    this.logger("Updater failed: " + message);
    this.state = { status: "failed", version: this.state.version, checkedAt: this.now(), message };
    this.emit("state-changed", this.getState());
  }

  private offline() {
    const message = "The update feed is unreachable; the current installation was left unchanged.";
    this.logger("Updater offline");
    this.state = { status: "offline", version: this.state.version, checkedAt: this.now(), message };
    this.emit("state-changed", this.getState());
  }

  private attachListeners() {
    this.adapter.on("update-available", this.handleUpdateAvailable);
    this.adapter.on("update-not-available", this.handleUpdateNotAvailable);
    this.adapter.on("download-progress", this.handleDownloadProgress);
    this.adapter.on("update-downloaded", this.handleUpdateDownloaded);
    this.adapter.on("error", this.handleError);
  }

  private detachListeners() {
    this.adapter.removeListener("update-available", this.handleUpdateAvailable);
    this.adapter.removeListener("update-not-available", this.handleUpdateNotAvailable);
    this.adapter.removeListener("download-progress", this.handleDownloadProgress);
    this.adapter.removeListener("update-downloaded", this.handleUpdateDownloaded);
    this.adapter.removeListener("error", this.handleError);
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped || !this.started || !this.feedUrl) return;
    if (this.timer) this.cancelSchedule(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.runScheduledCheck();
    }, delayMs);
  }

  private async runScheduledCheck() {
    if (this.stopped) return;
    if (this.checkInFlight || this.downloadInFlight || this.state.status === "ready") {
      this.scheduleNext(this.backgroundIntervalMs);
      return;
    }
    await this.checkForUpdates();
    this.scheduleNext(this.backgroundIntervalMs);
  }
}
