import { EventEmitter } from "node:events";
import type { UpdateState } from "../../shared/types";

export type { UpdateState } from "../../shared/types";

export const UPDATE_STARTUP_DELAY_MS = 15_000;
export const UPDATE_BACKGROUND_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const UPDATE_CHECK_TIMEOUT_MS = 30_000;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1_000;

const MAX_STARTUP_DELAY_MS = 60_000;
const MIN_BACKGROUND_INTERVAL_MS = 60_000;
const MAX_BACKGROUND_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CHECK_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_UPDATE_FEED_URL =
  "https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest/download/";
const DEFAULT_RELEASE_NOTES_BASE_URL =
  "https://github.com/Ding-Ding-Projects/material-download-manager/releases/";

export interface UpdateInfoLike {
  version?: unknown;
  releaseNotesUrl?: unknown;
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
  releaseNotesBaseUrl?: string;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
  startupDelayMs?: number;
  backgroundIntervalMs?: number;
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
  canInstall?: () => boolean;
  logger?: (message: string) => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

interface CheckLease {
  id: number;
  promise: Promise<UpdateCheckResultLike | null | void>;
  resolve: (value: UpdateCheckResultLike | null | void) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
  timedOut: boolean;
  eventHandled: boolean;
}

interface DownloadLease {
  id: number;
  version: string | null;
  releaseNotesUrl: string | null;
  promise: Promise<unknown> | null;
  resolve?: () => void;
  reject?: (reason: unknown) => void;
  timeoutTimer: TimerHandle | null;
  settled: boolean;
  timedOut: boolean;
}

function boundedDelay(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value as number)));
}

function updateVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 128
    ? value.trim()
    : null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  return { core, prerelease: match[4] ? match[4].split(".") : [] };
}

function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: unknown, current: string): candidate is string {
  const version = updateVersion(candidate);
  const comparison = version ? compareVersions(version, current) : null;
  return comparison !== null && comparison > 0;
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
 * Accept only a public HTTPS feed URL. Credentials, queries, and fragments
 * are rejected so an update secret cannot enter process state or diagnostics.
 */
export function normalizeUpdateFeedUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeReleaseNotesUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeReleaseNotesBaseUrl(value: unknown): string | null {
  const normalized = normalizeReleaseNotesUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.search || url.hash) return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export function readUpdateFeedUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment.MDM_UPDATE_FEED_URL?.trim();
  return value || DEFAULT_UPDATE_FEED_URL;
}

export function readUpdateReleaseNotesBaseUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment.MDM_UPDATE_RELEASE_NOTES_BASE_URL?.trim();
  return value || undefined;
}

function releaseNotesUrlFor(version: string, candidate: unknown, baseUrl: string): string {
  const direct = normalizeReleaseNotesUrl(candidate);
  if (direct) return direct;
  const base = normalizeReleaseNotesBaseUrl(baseUrl) ?? DEFAULT_RELEASE_NOTES_BASE_URL;
  const url = new URL(base);
  const releaseVersion = version.startsWith("v") ? version : `v${version}`;
  url.pathname = `${url.pathname}tag/${encodeURIComponent(releaseVersion)}`;
  return url.toString();
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

/**
 * Main-process update coordinator for Squirrel.Windows. It stages downloads
 * in the background and exposes installation only through an explicit action.
 * Operation leases stay busy until the adapter settles, even after a caller
 * timeout, so recovery cannot start overlapping checks or downloads.
 */
export class UpdateService extends EventEmitter {
  private readonly adapter: UpdaterAdapter;
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly supportedPlatform: boolean;
  private readonly feedUrl: string | null;
  private readonly releaseNotesBaseUrl: string;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly cancelSchedule: (handle: TimerHandle) => void;
  private readonly startupDelayMs: number;
  private readonly backgroundIntervalMs: number;
  private readonly checkTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly canInstall: () => boolean;
  private readonly logger: (message: string) => void;
  private state: UpdateState;
  private timer: TimerHandle | null = null;
  private started = false;
  private stopped = false;
  private operationId = 0;
  private checkInFlight: CheckLease | null = null;
  private downloadInFlight: DownloadLease | null = null;
  private availableVersion: string | null = null;
  private availableReleaseNotesUrl: string | null = null;

  private readonly handleUpdateAvailable = (info?: UpdateInfoLike) => {
    const lease = this.checkInFlight;
    if (!lease || this.state.status === "ready") return;
    if (lease.timedOut) {
      this.settleCheck(lease);
      return;
    }
    lease.eventHandled = true;

    const version = updateVersion(info?.version);
    if (version && !isNewerVersion(version, this.currentVersion)) {
      this.availableVersion = null;
      this.availableReleaseNotesUrl = null;
      this.setCurrent();
      this.settleCheck(lease);
      return;
    }

    this.availableVersion = version;
    this.availableReleaseNotesUrl = normalizeReleaseNotesUrl(info?.releaseNotesUrl);
    this.setAvailable(version, this.availableReleaseNotesUrl);
    this.settleCheck(lease);
    void this.downloadAvailableUpdate();
  };

  private readonly handleUpdateNotAvailable = () => {
    const lease = this.checkInFlight;
    if (!lease) return;
    if (lease.timedOut) {
      this.settleCheck(lease);
      return;
    }
    lease.eventHandled = true;
    if (this.state.status !== "ready" && !this.downloadInFlight) this.setCurrent();
    this.settleCheck(lease);
  };

  private readonly handleDownloadProgress = (progress: UpdateProgressLike) => {
    const lease = this.downloadInFlight;
    if (!lease || lease.timedOut || this.state.status === "ready") return;
    const percent =
      typeof progress?.percent === "number" && Number.isFinite(progress.percent)
        ? Math.min(100, Math.max(0, progress.percent))
        : 0;
    this.setDownloading(lease.version, lease.releaseNotesUrl, percent);
  };

  private readonly handleUpdateDownloaded = (...args: unknown[]) => {
    const lease = this.downloadInFlight;
    if (!lease) return;
    if (lease.timedOut || this.state.status === "ready") {
      this.settleDownload(lease);
      return;
    }

    const releaseName = updateVersion(args[2]);
    const version = releaseName ?? lease.version ?? this.availableVersion;
    if (!version || !isNewerVersion(version, this.currentVersion)) {
      this.settleDownload(lease);
      this.fail("The update did not provide a newer verified version.");
      return;
    }

    this.availableVersion = version;
    this.setReady(version, lease.releaseNotesUrl ?? this.availableReleaseNotesUrl);
    this.settleDownload(lease);
  };

  private readonly handleError = (error: unknown) => {
    if (this.state.status === "ready") return;
    const download = this.downloadInFlight;
    if (download) {
      if (download.timedOut) {
        this.settleDownload(download);
        return;
      }
      this.settleDownload(download);
      if (networkFailure(error)) this.offline();
      else this.fail("The update download failed.");
      return;
    }

    const check = this.checkInFlight;
    if (!check) return;
    if (check.timedOut) {
      this.settleCheck(check);
      return;
    }
    check.eventHandled = true;
    this.settleCheck(check, error);
    if (networkFailure(error)) this.offline();
    else this.fail("The update check failed.");
  };

  private readonly handleNativeDownloadTimeout = (lease: DownloadLease) => {
    if (this.downloadInFlight !== lease || lease.settled) return;

    // Native Squirrel exposes no download promise to await. Publish the
    // truthful failure while this lease is still held, then release it so a
    // subsequent check cannot begin until the timeout boundary is complete.
    lease.timedOut = true;
    if (!this.isReady() && !this.isFailure()) this.offline();
    this.settleDownload(lease);
  };

  constructor(options: UpdateServiceOptions) {
    super();
    this.adapter = options.adapter;
    this.currentVersion = updateVersion(options.currentVersion) ?? "0.0.0";
    this.isPackaged = options.isPackaged;
    this.supportedPlatform = options.supportedPlatform ?? true;
    this.feedUrl = normalizeUpdateFeedUrl(options.feedUrl);
    this.releaseNotesBaseUrl =
      normalizeReleaseNotesBaseUrl(options.releaseNotesBaseUrl) ?? DEFAULT_RELEASE_NOTES_BASE_URL;
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
      1_000,
      MAX_DOWNLOAD_TIMEOUT_MS
    );
    this.canInstall = options.canInstall ?? (() => false);
    this.logger = options.logger ?? (() => {});
    this.state = {
      status: "current",
      version: this.currentVersion,
      releaseNotesUrl: null,
      checkedAt: 0,
    };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  getReleaseNotesUrl(): string | null {
    return this.state.status === "ready" ? this.state.releaseNotesUrl : null;
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
    if (this.checkInFlight) this.checkInFlight.timedOut = true;
    if (this.downloadInFlight) {
      this.downloadInFlight.timedOut = true;
      if (this.downloadInFlight.timeoutTimer !== null) this.settleDownload(this.downloadInFlight);
    }
    this.detachListeners();
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (this.stopped || !this.started) return this.getState();
    if (!this.isPackaged || !this.supportedPlatform || !this.feedUrl) return this.getState();
    if (this.checkInFlight || this.downloadInFlight || ["available", "downloading", "ready"].includes(this.state.status)) {
      return this.getState();
    }

    const lease = this.beginCheck();
    try {
      const result = await withTimeout(lease.promise, this.checkTimeoutMs);
      if (lease.timedOut || this.stopped) return this.getState();
      if (!lease.eventHandled) {
        if (result && result.updateInfo) this.handleUpdateAvailable(result.updateInfo);
        else if (this.state.status !== "ready" && !this.downloadInFlight) this.setCurrent();
      }
      this.settleCheck(lease, undefined, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Update operation timed out") {
        lease.timedOut = true;
      } else {
        this.settleCheck(lease, error);
      }
      if (!this.isReady() && !this.downloadInFlight && !this.isFailure()) {
        if (networkFailure(error)) this.offline();
        else this.fail("The update check failed.");
      }
    }
    return this.getState();
  }

  async downloadAvailableUpdate(): Promise<boolean> {
    if (this.stopped || !this.started || !this.isPackaged || !this.feedUrl || this.downloadInFlight) return false;
    if (this.state.status !== "available" && this.state.status !== "downloading") return false;

    const version = this.availableVersion ?? this.state.version;
    const releaseNotesUrl = this.availableReleaseNotesUrl ?? this.state.releaseNotesUrl;
    if (version && !isNewerVersion(version, this.currentVersion)) {
      this.setCurrent();
      return false;
    }

    if (!this.adapter.downloadUpdate) {
      const lease: DownloadLease = {
        id: ++this.operationId,
        version,
        releaseNotesUrl,
        promise: null,
        timeoutTimer: null,
        settled: false,
        timedOut: false,
      };
      this.downloadInFlight = lease;
      // Electron's native Squirrel updater owns the actual download. Its
      // update-downloaded or error event closes this lease, while this timer
      // bounds the event-only path when neither event arrives.
      lease.timeoutTimer = setTimeout(() => this.handleNativeDownloadTimeout(lease), this.downloadTimeoutMs);
      this.setDownloading(version, releaseNotesUrl, 0);
      return false;
    }

    if (!version || !isNewerVersion(version, this.currentVersion)) {
      this.fail("The update feed did not provide a newer verified version.");
      return false;
    }

    let rawOperation: Promise<unknown>;
    try {
      rawOperation = Promise.resolve(this.adapter.downloadUpdate());
    } catch {
      this.fail("The update download could not start.");
      return false;
    }

    const lease: DownloadLease = {
      id: ++this.operationId,
      version,
      releaseNotesUrl,
      promise: rawOperation,
      timeoutTimer: null,
      settled: false,
      timedOut: false,
    };
    this.downloadInFlight = lease;
    this.setDownloading(version, releaseNotesUrl, 0);
    void rawOperation.then(
      () => {
        if (this.downloadInFlight !== lease) return;
        if (!lease.timedOut && !this.isReady()) this.setReady(version, releaseNotesUrl);
        this.settleDownload(lease);
      },
      (error: unknown) => {
        if (this.downloadInFlight !== lease) return;
        if (!lease.timedOut && !this.isReady()) {
          if (networkFailure(error)) this.offline();
          else this.fail("The update download failed.");
        }
        this.settleDownload(lease);
      }
    );

    try {
      await withTimeout(rawOperation, this.downloadTimeoutMs);
      return this.isReady();
    } catch (error) {
      if (this.downloadInFlight === lease && error instanceof Error && error.message === "Update operation timed out") {
        lease.timedOut = true;
      }
      if (!this.isReady() && !this.isFailure()) {
        if (networkFailure(error)) this.offline();
        else this.fail("The update download failed.");
      }
      return false;
    }
  }

  quitAndInstall(): boolean {
    if (this.state.status !== "ready" || !this.canInstall()) return false;
    try {
      this.adapter.quitAndInstall();
      return true;
    } catch {
      this.fail("The ready update could not be installed.");
      return false;
    }
  }

  private beginCheck(): CheckLease {
    let resolve!: CheckLease["resolve"];
    let reject!: CheckLease["reject"];
    const lease: CheckLease = {
      id: ++this.operationId,
      promise: new Promise<UpdateCheckResultLike | null | void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      }),
      resolve: () => {},
      reject: () => {},
      settled: false,
      timedOut: false,
      eventHandled: false,
    };
    lease.resolve = resolve;
    lease.reject = reject;
    this.checkInFlight = lease;

    let result: UpdateCheckResultLike | null | Promise<UpdateCheckResultLike | null> | void;
    try {
      result = this.adapter.checkForUpdates();
    } catch (error) {
      this.settleCheck(lease, error);
      return lease;
    }

    if (isPromiseLike<UpdateCheckResultLike | null>(result)) {
      void Promise.resolve(result).then(
        (value) => {
          if (!lease.eventHandled && !lease.timedOut && value?.updateInfo) this.handleUpdateAvailable(value.updateInfo);
          if (!lease.eventHandled && !lease.timedOut && !this.downloadInFlight && this.state.status !== "ready") {
            this.setCurrent();
          }
          this.settleCheck(lease, undefined, value);
        },
        (error: unknown) => this.settleCheck(lease, error)
      );
    } else if (result !== undefined) {
      if (!lease.eventHandled && result?.updateInfo) this.handleUpdateAvailable(result.updateInfo);
      if (!lease.eventHandled && !this.downloadInFlight && this.state.status !== "ready") this.setCurrent();
      this.settleCheck(lease, undefined, result);
    }
    return lease;
  }

  private settleCheck(lease: CheckLease, error?: unknown, value?: UpdateCheckResultLike | null | void) {
    if (lease.settled) return;
    lease.settled = true;
    if (this.checkInFlight === lease) this.checkInFlight = null;
    if (error !== undefined) lease.reject(error);
    else lease.resolve(value);
  }

  private settleDownload(lease: DownloadLease) {
    if (lease.settled) return;
    if (lease.timeoutTimer !== null) {
      clearTimeout(lease.timeoutTimer);
      lease.timeoutTimer = null;
    }
    lease.settled = true;
    if (this.downloadInFlight === lease) this.downloadInFlight = null;
    lease.resolve?.();
  }

  private setCurrent() {
    if (this.state.status === "ready") return;
    this.state = {
      status: "current",
      version: this.currentVersion,
      releaseNotesUrl: null,
      checkedAt: this.now(),
    };
    this.emit("state-changed", this.getState());
  }

  private isReady() {
    return this.state.status === "ready";
  }

  private isFailure() {
    return this.state.status === "failed" || this.state.status === "offline";
  }

  private setAvailable(version: string | null, releaseNotesUrl: string | null) {
    if (this.state.status === "ready") return;
    this.state = {
      status: "available",
      version,
      releaseNotesUrl,
      checkedAt: this.now(),
    };
    this.emit("state-changed", this.getState());
  }

  private setDownloading(version: string | null, releaseNotesUrl: string | null, percent: number) {
    if (this.state.status === "ready") return;
    this.state = {
      status: "downloading",
      version,
      releaseNotesUrl,
      percent,
      checkedAt: this.now(),
    };
    this.emit("state-changed", this.getState());
  }

  private setReady(version: string, candidateReleaseNotesUrl: string | null) {
    if (this.state.status === "ready") return;
    const releaseNotesUrl = releaseNotesUrlFor(version, candidateReleaseNotesUrl, this.releaseNotesBaseUrl);
    this.state = {
      status: "ready",
      version,
      releaseNotesUrl,
      checkedAt: this.now(),
    };
    this.emit("state-changed", this.getState());
  }

  private fail(message: string) {
    if (this.state.status === "ready") return;
    this.logger("Updater failed: " + message);
    this.state = {
      status: "failed",
      version: this.state.version,
      releaseNotesUrl: this.state.releaseNotesUrl,
      checkedAt: this.now(),
      message,
    };
    this.emit("state-changed", this.getState());
  }

  private offline() {
    if (this.state.status === "ready") return;
    const message = "The update feed is unreachable; the current installation was left unchanged.";
    this.logger("Updater offline");
    this.state = {
      status: "offline",
      version: this.state.version,
      releaseNotesUrl: this.state.releaseNotesUrl,
      checkedAt: this.now(),
      message,
    };
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
    if (
      this.checkInFlight ||
      this.downloadInFlight ||
      ["available", "downloading", "ready"].includes(this.state.status)
    ) {
      this.scheduleNext(this.backgroundIntervalMs);
      return;
    }
    await this.checkForUpdates();
    this.scheduleNext(this.backgroundIntervalMs);
  }
}
