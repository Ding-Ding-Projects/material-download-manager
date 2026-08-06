import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { URL } from "node:url";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { DownloadItem, PartInfo } from "../../shared/types";
import { SpeedLimiter } from "./SpeedLimiter";
import { headersForTarget } from "./downloadMetadata";

const USER_AGENT = "Mozilla/5.0 (compatible; MaterialDownloadManager/0.1)";
const MIN_PART_SIZE_FLOOR = 512 * 1024; // never split into pieces smaller than 512KB
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_RETRIES = 3;

export interface DownloadTaskOptions {
  maxConnections: number;
  minPartSize: number;
  headers?: Record<string, string>;
  speedLimiters: SpeedLimiter[]; // e.g. [globalLimiter, perDownloadLimiter]
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxRedirects?: number;
  maxRetries?: number;
}

export interface DownloadTaskEvents {
  progress: () => void;
  completed: () => void;
  error: (message: string) => void;
  paused: () => void;
}

/**
 * Manages the actual byte transfer for a single DownloadItem: probing part
 * layout, opening the destination file, running N concurrent ranged HTTP
 * connections that each write directly into their byte-range of the file,
 * and tracking speed/progress. This is a pragmatic TypeScript port of the
 * segmented-download behavior found in
 * downloader/core/.../part/HttpPartDownloader.kt — parts are pre-split by
 * size up-front rather than dynamically stolen from slower parts, which
 * keeps the implementation tractable while preserving multi-connection
 * resumable downloads.
 */
export class DownloadTask extends EventEmitter {
  readonly item: DownloadItem;
  private options: DownloadTaskOptions;
  private fileHandle: fsp.FileHandle | null = null;
  private activeRequests = new Set<ClientRequest>();
  private stopped = false;
  private destroyed = false;
  private progressTimer: NodeJS.Timeout | null = null;
  private lastDownloadedSize = 0;
  private lastSampleTime = Date.now();
  private activePartCount = 0;
  private finishedPartsCount = 0;
  private fatalError: string | null = null;

  constructor(item: DownloadItem, options: DownloadTaskOptions) {
    super();
    this.item = item;
    this.options = options;
  }

  get filePath() {
    return path.join(this.item.folder, this.item.fileName);
  }

  private get partsFilePath() {
    return this.filePath + ".mdmparts.json";
  }

  private ensurePartsLayout() {
    if (this.item.parts.length > 0) return;
    const total = this.item.totalSize;
    if (this.item.resumeSupport && total && total > 0) {
      const maxConns = Math.max(1, this.options.maxConnections);
      const minPart = Math.max(this.options.minPartSize, MIN_PART_SIZE_FLOOR);
      const partsCount = Math.max(1, Math.min(maxConns, Math.floor(total / minPart) || 1));
      const size = Math.floor(total / partsCount);
      const parts: PartInfo[] = [];
      for (let i = 0; i < partsCount; i++) {
        const from = i * size;
        const to = i === partsCount - 1 ? total - 1 : from + size - 1;
        parts.push({ id: i + 1, from, to, current: from, status: "idle" });
      }
      this.item.parts = parts;
    } else {
      // unknown size or server doesn't support ranges: single streamed part
      this.item.parts = [{ id: 1, from: 0, to: total ? total - 1 : null, current: 0, status: "idle" }];
    }
    this.item.connections = this.item.parts.length;
  }

  private async openFile() {
    await fsp.mkdir(this.item.folder, { recursive: true });
    const exists = fs.existsSync(this.filePath);
    this.fileHandle = await fsp.open(this.filePath, exists ? "r+" : "w");
    if (!exists && this.item.totalSize) {
      // preallocate so concurrent positional writes never race on file growth
      await this.fileHandle.truncate(this.item.totalSize);
    }
  }

  private async loadPersistedParts() {
    try {
      const raw = await fsp.readFile(this.partsFilePath, "utf-8");
      const parts: PartInfo[] = JSON.parse(raw);
      if (Array.isArray(parts) && parts.length > 0) {
        this.item.parts = parts;
        this.item.connections = parts.length;
      }
    } catch {
      // no persisted state, that's fine
    }
  }

  private async persistParts() {
    try {
      await fsp.writeFile(this.partsFilePath, JSON.stringify(this.item.parts));
    } catch {
      /* best effort */
    }
  }

  private startProgressTimer() {
    this.lastDownloadedSize = this.currentDownloadedSize();
    this.lastSampleTime = Date.now();
    this.progressTimer = setInterval(() => {
      const now = Date.now();
      const downloaded = this.currentDownloadedSize();
      const elapsed = (now - this.lastSampleTime) / 1000;
      const delta = downloaded - this.lastDownloadedSize;
      this.item.speed = elapsed > 0 ? Math.max(0, delta / elapsed) : 0;
      this.item.downloadedSize = downloaded;
      if (this.item.totalSize && this.item.speed > 0) {
        this.item.eta = Math.max(0, (this.item.totalSize - downloaded) / this.item.speed);
      } else {
        this.item.eta = null;
      }
      this.lastDownloadedSize = downloaded;
      this.lastSampleTime = now;
      this.persistParts();
      this.emit("progress");
    }, 800);
  }

  private stopProgressTimer() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private currentDownloadedSize(): number {
    return this.item.parts.reduce((sum, p) => sum + Math.max(0, p.current - p.from), 0);
  }

  async start() {
    this.stopped = false;
    this.destroyed = false;
    this.fatalError = null;
    await this.loadPersistedParts();
    this.ensurePartsLayout();
    await this.openFile();
    this.item.status = "downloading";
    this.startProgressTimer();

    this.finishedPartsCount = this.item.parts.filter((p) => p.status === "completed").length;
    const pending = this.item.parts.filter((p) => p.status !== "completed");

    if (pending.length === 0) {
      await this.finish();
      return;
    }

    this.activePartCount = pending.length;
    await Promise.all(pending.map((part) => this.downloadPart(part)));

    if (this.stopped || this.destroyed) return;
    if (this.fatalError) {
      this.item.status = "error";
      this.item.error = this.fatalError;
      this.stopProgressTimer();
      await this.closeFileHandle();
      this.emit("error", this.fatalError);
      return;
    }
    await this.finish();
  }

  private async finish() {
    this.stopProgressTimer();
    this.item.downloadedSize = this.currentDownloadedSize();
    this.item.speed = 0;
    this.item.eta = 0;
    this.item.status = "completed";
    this.item.dateCompleted = Date.now();
    await this.closeFileHandle();
    await fsp.rm(this.partsFilePath, { force: true });
    this.emit("completed");
  }

  private async closeFileHandle() {
    const handle = this.fileHandle;
    this.fileHandle = null;
    await handle?.close().catch(() => {});
  }

  private downloadPart(part: PartInfo): Promise<void> {
    return new Promise((resolve) => {
      let downloadResolved = false;
      const finishDownload = () => {
        if (downloadResolved) return;
        downloadResolved = true;
        resolve();
      };
      const failDownload = (message: string) => {
        part.status = "error";
        this.fatalError = message;
        finishDownload();
      };
      const attempt = (retriesLeft: number, redirectsLeft: number, targetUrl: string) => {
        if (this.stopped || this.destroyed) {
          finishDownload();
          return;
        }
        part.status = "connecting";
        let target: URL;
        try {
          target = new URL(targetUrl);
        } catch {
          failDownload("Invalid URL");
          return;
        }
        const client = target.protocol === "http:" ? http : https;
        const isRanged = this.item.parts.length > 1 || part.to !== null;
        const headers: Record<string, string> = {
          "User-Agent": USER_AGENT,
          ...headersForTarget(this.options.headers, this.item.url, target.toString()),
        };
        if (isRanged && this.item.resumeSupport) {
          headers.Range = part.to !== null ? `bytes=${part.current}-${part.to}` : `bytes=${part.current}-`;
        }

        let attemptSettled = false;
        let connectionTimer: NodeJS.Timeout | null = null;
        let requestTimer: NodeJS.Timeout | null = null;
        let req: ClientRequest;
        const clearTimers = () => {
          if (connectionTimer) clearTimeout(connectionTimer);
          if (requestTimer) clearTimeout(requestTimer);
          connectionTimer = null;
          requestTimer = null;
        };
        const settleAttempt = () => {
          if (attemptSettled) return false;
          attemptSettled = true;
          clearTimers();
          this.activeRequests.delete(req);
          return true;
        };
        const retry = (message: string, delayMs = 1000) => {
          if (!settleAttempt()) return;
          if (this.stopped || this.destroyed) {
            finishDownload();
            return;
          }
          if (retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1, redirectsLeft, target.toString()), delayMs);
          } else {
            failDownload(message);
          }
        };

        req = client.request(
          target,
          { method: "GET", headers },
          (res) => {
            if (connectionTimer) {
              clearTimeout(connectionTimer);
              connectionTimer = null;
            }
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume();
              if (redirectsLeft <= 0) {
                settleAttempt();
                failDownload("Too many redirects during download");
                return;
              }
              let nextUrl: string;
              try {
                nextUrl = new URL(res.headers.location, target).toString();
              } catch {
                settleAttempt();
                failDownload("Server returned an invalid redirect");
                return;
              }
              if (settleAttempt()) attempt(retriesLeft, redirectsLeft - 1, nextUrl);
              return;
            }
            this.handlePartResponse(
              res,
              part,
              req,
              resolve,
              retriesLeft,
              (nextRetries) => attempt(nextRetries, redirectsLeft, target.toString()),
              retry,
              settleAttempt
            );
          }
        );
        this.activeRequests.add(req);
        req.on("error", (err) => {
          if (!settleAttempt()) return;
          if (this.stopped || this.destroyed) {
            finishDownload();
            return;
          }
          if (retriesLeft > 0) {
            setTimeout(() => attempt(retriesLeft - 1, redirectsLeft, target.toString()), 1500);
          } else {
            failDownload(err.message);
          }
        });
        const connectionTimeoutMs = this.options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
        const requestTimeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        const idleTimeoutMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        connectionTimer = setTimeout(
          () => req.destroy(new Error("Download connection timed out")),
          connectionTimeoutMs
        );
        requestTimer = setTimeout(
          () => req.destroy(new Error("Download request timed out")),
          requestTimeoutMs
        );
        req.setTimeout(idleTimeoutMs, () => req.destroy(new Error("Download idle timeout")));
        req.end();
      };
      attempt(
        this.options.maxRetries ?? DEFAULT_RETRIES,
        this.options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
        this.item.url
      );
    });
  }

  private handlePartResponse(
    res: IncomingMessage,
    part: PartInfo,
    req: ClientRequest,
    resolve: () => void,
    retriesLeft: number,
    attempt: (retriesLeft: number) => void,
    retry: (message: string, delayMs?: number) => void,
    settleAttempt: () => boolean
  ) {
    const status = res.statusCode ?? 0;
    const expectsRange = this.item.resumeSupport && (this.item.parts.length > 1 || part.to !== null);
    const retryResponse = (message: string) => {
      res.resume();
      retry(message, 1000);
    };

    if ((expectsRange && status !== 206) || (!expectsRange && status !== 200 && status !== 206)) {
      retryResponse(expectsRange ? `Expected a ranged response, got ${status}` : `Unexpected server status ${status}`);
      return;
    }

    let expectedResponseBytes: number | null = null;
    if (expectsRange) {
      const header = res.headers["content-range"];
      const contentRange = Array.isArray(header) ? header[0] : header;
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange ?? "");
      const requestedStart = part.current;
      const rangeStart = match ? Number(match[1]) : NaN;
      const rangeEnd = match ? Number(match[2]) : NaN;
      const total = match && match[3] !== "*" ? Number(match[3]) : null;
      const requestedEnd = part.to;
      const validRange =
        !!match &&
        Number.isSafeInteger(rangeStart) &&
        Number.isSafeInteger(rangeEnd) &&
        rangeStart === requestedStart &&
        rangeEnd >= rangeStart &&
        (requestedEnd === null || rangeEnd <= requestedEnd) &&
        (total === null || (Number.isSafeInteger(total) && rangeEnd < total));
      if (!validRange) {
        retryResponse("Server returned an invalid Content-Range");
        return;
      }
      expectedResponseBytes = rangeEnd - rangeStart + 1;
      const declaredLengthHeader = res.headers["content-length"];
      const declaredLength = declaredLengthHeader ? Number(declaredLengthHeader) : null;
      if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== expectedResponseBytes) {
        retryResponse("Server Content-Length does not match Content-Range");
        return;
      }
      if (requestedEnd === null && total !== null) {
        this.item.totalSize = total;
        part.to = total - 1;
      }
    }

    part.status = "downloading";
    let writeChain: Promise<void> = Promise.resolve();
    let responseBytes = 0;
    let responseInvalid = false;
    let processingError: string | null = null;

    const limiters = this.options.speedLimiters;

    res.on("data", (chunk: Buffer) => {
      if (responseInvalid) return;
      if (expectedResponseBytes !== null && responseBytes + chunk.length > expectedResponseBytes) {
        responseInvalid = true;
        res.destroy(new Error("Server sent more bytes than its Content-Range"));
        return;
      }
      responseBytes += chunk.length;
      res.pause();
      writeChain = writeChain
        .then(async () => {
          let offset = 0;
          while (offset < chunk.length) {
            if (this.stopped || this.destroyed) return;
            const remaining = chunk.length - offset;
            let allowed = remaining;
            for (const limiter of limiters) {
              allowed = Math.min(allowed, await limiter.acquire(allowed));
            }
            const slice = chunk.subarray(offset, offset + allowed);
            if (this.fileHandle) {
              await this.fileHandle.write(slice, 0, slice.length, part.current);
            }
            part.current += slice.length;
            offset += allowed;
          }
        })
        .then(() => {
          if (!this.stopped && !this.destroyed) res.resume();
        })
        .catch((err) => {
          processingError = err instanceof Error ? err.message : String(err);
          res.resume();
        });
    });

    res.on("end", async () => {
      if (responseInvalid) {
        retryResponse("Server sent more bytes than its Content-Range");
        return;
      }
      await writeChain;
      if (processingError) {
        retryResponse(processingError);
        return;
      }
      if (!settleAttempt()) return;
      if (this.stopped || this.destroyed) {
        resolve();
        return;
      }
      if (part.to !== null && part.current <= part.to) {
        // server closed early; retry remaining range
        if (retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 1000);
          return;
        }
      }
      part.status = "completed";
      resolve();
    });

    res.on("error", async (err) => {
      await writeChain.catch(() => {});
      if (!settleAttempt()) return;
      if (this.stopped || this.destroyed) {
        resolve();
        return;
      }
      if (retriesLeft > 0) {
        setTimeout(() => attempt(retriesLeft - 1), 1500);
      } else {
        part.status = "error";
        this.fatalError = err.message;
        resolve();
      }
    });
  }

  async pause() {
    this.stopped = true;
    for (const req of this.activeRequests) req.destroy();
    this.activeRequests.clear();
    this.stopProgressTimer();
    this.item.status = "paused";
    this.item.speed = 0;
    for (const part of this.item.parts) if (part.status !== "completed") part.status = "idle";
    await this.persistParts();
    await this.closeFileHandle();
    this.emit("paused");
  }

  async cancel(deleteFile: boolean) {
    this.destroyed = true;
    for (const req of this.activeRequests) req.destroy();
    this.activeRequests.clear();
    this.stopProgressTimer();
    await this.closeFileHandle();
    await fsp.rm(this.partsFilePath, { force: true });
    if (deleteFile) {
      await fsp.rm(this.filePath, { force: true });
    }
  }
}
