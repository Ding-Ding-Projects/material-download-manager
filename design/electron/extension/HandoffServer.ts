import http from "node:http";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AddDownloadRequest, AppSettings } from "../../shared/types";

export const HANDOFF_PROTOCOL_VERSION = 2;
export const HANDOFF_HOST = "127.0.0.1";
export const HANDOFF_PORT = 43771;
export const HANDOFF_PATH = "/v1/downloads";
export const STATUS_PATH = "/v1/status";
export const CHALLENGE_PATH = "/v2/challenge";
export const HANDOFF_SOURCE = "material-download-manager-extension";
export const MAX_HANDOFF_BODY_BYTES = 16 * 1024;
export const MAX_URL_LENGTH = 8_192;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SELECTION_LENGTH = 2_048;
export const MAX_HANDOFF_FILE_NAME_LENGTH = 512;
export const MAX_ACTIVE_HANDOFFS = 8;
export const MAX_HANDOFF_REQUESTS_PER_MINUTE = 60;
const CHALLENGE_TTL_MS = 30_000;
const MAX_OUTSTANDING_CHALLENGES = 64;
const AUTH_NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const AUTH_PROOF_PATTERN = /^[a-f0-9]{64}$/u;
const CHROMIUM_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/u;

export interface HandoffManager {
  getSettings(): AppSettings;
  addBrowserHandoff(request: AddDownloadRequest): Promise<string>;
  rollbackBrowserHandoff(downloadId: string): Promise<void>;
}

interface HandoffEnvelope {
  protocol: typeof HANDOFF_PROTOCOL_VERSION;
  source: typeof HANDOFF_SOURCE;
  url: string;
  requestedAt?: string;
  title?: string;
  selectionText?: string;
  fileName?: string;
  authNonce: string;
  authProof: string;
}

interface HandoffServerOptions {
  manager: HandoffManager;
  loadCapability: () => Promise<string | null>;
  port?: number;
  logger?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedOptionalString(value: unknown, maxLength: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`Invalid ${field}`);
  return value;
}

export function normalizeHandoffUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new Error("Invalid handoff URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid handoff URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Handoff URLs cannot contain credentials");
  }
  return url.toString();
}

export function normalizeOptionalHandoffFileName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_HANDOFF_FILE_NAME_LENGTH ||
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.basename(value) !== value ||
    path.win32.basename(value) !== value
  ) {
    throw new Error("Invalid handoff file name");
  }
  return value;
}

function allowedRequestOrigin(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CHROMIUM_EXTENSION_ORIGIN.test(value)) {
    throw Object.assign(new Error("Chromium extension origin required"), { statusCode: 403 });
  }
  return value;
}

export function parseHandoffEnvelope(value: unknown): HandoffEnvelope {
  if (!isRecord(value)) throw new Error("Invalid handoff envelope");
  if (value.protocol !== HANDOFF_PROTOCOL_VERSION || value.source !== HANDOFF_SOURCE) {
    throw new Error("Unsupported handoff protocol");
  }
  const url = normalizeHandoffUrl(value.url);
  const requestedAt = boundedOptionalString(value.requestedAt, 64, "requested timestamp");
  const title = boundedOptionalString(value.title, MAX_TITLE_LENGTH, "title");
  const selectionText = boundedOptionalString(value.selectionText, MAX_SELECTION_LENGTH, "selection text");
  const fileName = normalizeOptionalHandoffFileName(value.fileName);
  if (typeof value.authNonce !== "string" || !AUTH_NONCE_PATTERN.test(value.authNonce)) {
    throw new Error("Invalid handoff authentication nonce");
  }
  if (typeof value.authProof !== "string" || !AUTH_PROOF_PATTERN.test(value.authProof)) {
    throw new Error("Invalid handoff authentication proof");
  }
  return {
    protocol: HANDOFF_PROTOCOL_VERSION,
    source: HANDOFF_SOURCE,
    url,
    requestedAt,
    title,
    selectionText,
    fileName,
    authNonce: value.authNonce,
    authProof: value.authProof,
  };
}

export function challengeProofInput(nonce: string): string {
  return `challenge\n${HANDOFF_PROTOCOL_VERSION}\n${nonce}`;
}

export function handoffRequestProofInput(envelope: Omit<HandoffEnvelope, "authProof">): string {
  return [
    "request",
    String(HANDOFF_PROTOCOL_VERSION),
    envelope.authNonce,
    envelope.url,
    envelope.requestedAt ?? "",
    envelope.fileName ?? "",
    envelope.title ?? "",
    envelope.selectionText ?? "",
  ].join("\n");
}

export function handoffResponseProofInput(nonce: string, downloadId: string): string {
  return `response\n${HANDOFF_PROTOCOL_VERSION}\n${nonce}\n${downloadId}`;
}

function capabilityProof(capability: string, input: string): string {
  return createHmac("sha256", capability).update(input, "utf8").digest("hex");
}

function proofMatches(expected: string, actual: string): boolean {
  if (!AUTH_PROOF_PATTERN.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = address?.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function suggestedFileName(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    const candidate = decodeURIComponent(path.posix.basename(url.pathname));
    return normalizeOptionalHandoffFileName(candidate) ?? "download";
  } catch {
    // URL validation has already happened; the fallback is still safer than
    // allowing a malformed pathname to become a filesystem name.
  }
  return "download";
}

function writeJson(response: http.ServerResponse, statusCode: number, value: Record<string, unknown>): boolean {
  if (response.destroyed || response.writableEnded) return false;
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
  return true;
}

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HANDOFF_BODY_BYTES) {
    throw Object.assign(new Error("Handoff body is too large"), { statusCode: 413 });
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error & { statusCode?: number }) => {
      if (settled) return;
      settled = true;
      request.pause();
      reject(error);
    };
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_HANDOFF_BODY_BYTES) {
        fail(Object.assign(new Error("Handoff body is too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", (error) => fail(error));
    request.on("aborted", () => fail(new Error("Handoff request was aborted")));
  });
}

export class HandoffServer {
  private server: http.Server | null = null;
  private listening = false;
  private readonly challenges = new Map<string, number>();
  private readonly recentRequestTimes: number[] = [];
  private activeHandoffs = 0;

  constructor(private readonly options: HandoffServerOptions) {}

  get isListening() {
    return this.listening;
  }

  async start(): Promise<boolean> {
    if (this.server) return this.listening;
    const port = this.options.port ?? HANDOFF_PORT;
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    server.headersTimeout = 5_000;
    server.requestTimeout = 40_000;
    server.keepAliveTimeout = 5_000;
    server.maxRequestsPerSocket = 20;
    this.server = server;
    return await new Promise<boolean>((resolve) => {
      const onError = (error: Error) => {
        this.options.logger?.(`Extension handoff endpoint unavailable: ${error.message}`);
        if (!this.listening) {
          this.server = null;
          this.listening = false;
          resolve(false);
        }
      };
      server.on("error", onError);
      server.listen(port, HANDOFF_HOST, () => {
        this.listening = true;
        resolve(true);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listening = false;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private admitRequest(response: http.ServerResponse, isHandoff: boolean): boolean {
    const now = Date.now();
    while (this.recentRequestTimes.length > 0 && this.recentRequestTimes[0] <= now - 60_000) {
      this.recentRequestTimes.shift();
    }
    if (this.recentRequestTimes.length >= MAX_HANDOFF_REQUESTS_PER_MINUTE || (isHandoff && this.activeHandoffs >= MAX_ACTIVE_HANDOFFS)) {
      response.setHeader("Retry-After", "1");
      writeJson(response, 429, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: false, error: "The loopback handoff endpoint is busy." });
      return false;
    }
    this.recentRequestTimes.push(now);
    if (isHandoff) this.activeHandoffs += 1;
    return true;
  }

  private pruneChallenges(now = Date.now()): void {
    for (const [nonce, expiresAt] of this.challenges) {
      if (expiresAt <= now) this.challenges.delete(nonce);
    }
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      writeJson(response, 403, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Loopback access only" });
      return;
    }
    let requestOrigin: string | undefined;
    try {
      requestOrigin = allowedRequestOrigin(request.headers.origin);
    } catch (error) {
      writeJson(response, 403, {
        protocol: HANDOFF_PROTOCOL_VERSION,
        accepted: false,
        error: error instanceof Error ? error.message : "Chromium extension origin required",
      });
      return;
    }
    if (requestOrigin) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, accept");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://${HANDOFF_HOST}`);
    if (request.method === "GET" && requestUrl.pathname === STATUS_PATH) {
      writeJson(response, 200, { protocol: HANDOFF_PROTOCOL_VERSION, acceptingUrls: this.listening });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === CHALLENGE_PATH) {
      if (!this.admitRequest(response, false)) return;
      const nonce = requestUrl.searchParams.get("nonce") ?? "";
      if (!AUTH_NONCE_PATTERN.test(nonce)) {
        writeJson(response, 400, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Invalid authentication nonce" });
        return;
      }
      this.pruneChallenges();
      if (this.challenges.size >= MAX_OUTSTANDING_CHALLENGES) {
        response.setHeader("Retry-After", "1");
        writeJson(response, 429, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Too many outstanding authentication challenges" });
        return;
      }
      const capability = await this.options.loadCapability().catch(() => null);
      if (!capability) {
        writeJson(response, 503, { protocol: HANDOFF_PROTOCOL_VERSION, error: "The browser extension has not been prepared by the app." });
        return;
      }
      this.challenges.set(nonce, Date.now() + CHALLENGE_TTL_MS);
      writeJson(response, 200, { protocol: HANDOFF_PROTOCOL_VERSION, nonce, proof: capabilityProof(capability, challengeProofInput(nonce)) });
      return;
    }
    if (request.method !== "POST" || requestUrl.pathname !== HANDOFF_PATH) {
      writeJson(response, 404, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Not found" });
      return;
    }
    if (!this.admitRequest(response, true)) return;
    const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      writeJson(response, 415, { protocol: HANDOFF_PROTOCOL_VERSION, error: "application/json is required" });
      this.activeHandoffs -= 1;
      return;
    }
    try {
      const envelope = parseHandoffEnvelope(JSON.parse((await readBody(request)).toString("utf8")));
      this.pruneChallenges();
      const challengeExpiry = this.challenges.get(envelope.authNonce);
      this.challenges.delete(envelope.authNonce);
      const capability = await this.options.loadCapability().catch(() => null);
      const proofEnvelope = { ...envelope };
      delete (proofEnvelope as Partial<HandoffEnvelope>).authProof;
      if (!challengeExpiry || challengeExpiry <= Date.now() || !capability ||
          !proofMatches(capabilityProof(capability, handoffRequestProofInput(proofEnvelope as Omit<HandoffEnvelope, "authProof">)), envelope.authProof)) {
        writeJson(response, 403, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: false, error: "Handoff authentication failed" });
        return;
      }
      const requestToAdd: AddDownloadRequest = {
        url: envelope.url,
        folder: this.options.manager.getSettings().defaultSaveFolder,
        fileName: envelope.fileName ?? suggestedFileName(envelope.url),
        queueId: null,
        startImmediately: true,
      };
      try {
        let clientDisconnected = response.destroyed;
        response.once("close", () => {
          if (!response.writableFinished) clientDisconnected = true;
        });
        const downloadId = await this.options.manager.addBrowserHandoff(requestToAdd);
        if (clientDisconnected || response.destroyed) {
          await this.options.manager.rollbackBrowserHandoff(downloadId).catch((error) => {
            this.options.logger?.(`Extension handoff rollback failed after client disconnect: ${error instanceof Error ? error.message : "unknown failure"}`);
          });
          return;
        }
        const delivered = writeJson(response, 202, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          accepted: true,
          downloadId,
          proof: capabilityProof(capability, handoffResponseProofInput(envelope.authNonce, downloadId)),
        });
        if (!delivered) {
          await this.options.manager.rollbackBrowserHandoff(downloadId).catch((error) => {
            this.options.logger?.(`Extension handoff rollback failed after response delivery failure: ${error instanceof Error ? error.message : "unknown failure"}`);
          });
        }
      } catch (error) {
        this.options.logger?.(`Extension handoff could not be queued: ${error instanceof Error ? error.message : "unknown failure"}`);
        writeJson(response, 500, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          accepted: false,
          error: "The download could not be queued.",
        });
      }
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400;
      writeJson(response, statusCode, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: false, error: error instanceof Error ? error.message : "Invalid handoff" });
    } finally {
      this.activeHandoffs = Math.max(0, this.activeHandoffs - 1);
    }
  }
}
