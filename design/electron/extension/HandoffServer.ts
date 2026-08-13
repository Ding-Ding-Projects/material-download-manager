import http from "node:http";
import path from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isValidDefaultSaveFolder } from "../../shared/settings";
import type {
  AddDownloadRequest,
  AppSettings,
  BrowserHandoffDecision,
  BrowserHandoffDecisionState,
  BrowserHandoffStart,
} from "../../shared/types";

export const HANDOFF_PROTOCOL_VERSION = 3;
export const HANDOFF_HOST = "127.0.0.1";
export const HANDOFF_PORT = 43771;
export const HANDOFF_PATH = "/v1/downloads";
export const STATUS_PATH = "/v1/status";
export const CHALLENGE_PATH = "/v2/challenge";
export const HANDOFF_DECISION_PATH = "/v2/handoffs";
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
const HANDOFF_DECISION_TTL_MS = 10 * 60_000;
const HANDOFF_DECISION_TOMBSTONE_TTL_MS = 10 * 60_000;
const AUTH_NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const AUTH_PROOF_PATTERN = /^[a-f0-9]{64}$/u;
const HANDOFF_ID_PATTERN = /^[a-f0-9]{64}$/u;
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
  /** Opens the desktop-owned Start download decision window. */
  presentPendingHandoff?: (handoff: BrowserHandoffStart) => Promise<boolean> | boolean;
  port?: number;
  logger?: (message: string) => void;
}

interface PendingHandoff {
  start: BrowserHandoffStart;
  state: BrowserHandoffDecisionState;
  downloadId: string | null;
  resolving: boolean;
  terminalAt: number | null;
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

/** Authenticate an extension poll for a pending desktop decision. */
export function handoffDecisionProofInput(handoffId: string): string {
  return `decision\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}`;
}

/** Bind a decision response to both its opaque handoff id and exact outcome. */
export function handoffDecisionResponseProofInput(
  handoffId: string,
  state: BrowserHandoffDecisionState,
  downloadId: string | null,
): string {
  return `decision-response\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}\n${state}\n${downloadId ?? ""}`;
}

/** Authenticate a browser-requested rollback when Chrome cannot cancel its paused copy. */
export function handoffRollbackProofInput(handoffId: string, downloadId: string): string {
  return `rollback\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}\n${downloadId}`;
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

function isHandoffId(value: unknown): value is string {
  return typeof value === "string" && HANDOFF_ID_PATTERN.test(value);
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
  private readonly pendingHandoffs = new Map<string, PendingHandoff>();
  private readonly recentRequestTimes: number[] = [];
  private activeHandoffs = 0;

  constructor(private readonly options: HandoffServerOptions) {}

  get isListening() {
    return this.listening;
  }

  private decisionFor(record: PendingHandoff): BrowserHandoffDecision {
    return {
      id: record.start.id,
      state: record.state,
      downloadId: record.downloadId,
      expiresAt: record.start.expiresAt,
    };
  }

  private prunePendingHandoffs(now = Date.now()): void {
    for (const [id, record] of this.pendingHandoffs) {
      if (record.state === "pending" && !record.resolving && record.start.expiresAt <= now) {
        record.state = "expired";
        record.terminalAt = now;
      }
      if (record.terminalAt !== null && record.terminalAt <= now - HANDOFF_DECISION_TOMBSTONE_TTL_MS) {
        this.pendingHandoffs.delete(id);
      }
    }
  }

  private activePendingCount(): number {
    let count = 0;
    for (const record of this.pendingHandoffs.values()) {
      if (record.state === "pending") count += 1;
    }
    return count;
  }

  private createPendingHandoff(request: AddDownloadRequest): BrowserHandoffStart {
    this.prunePendingHandoffs();
    if (this.activePendingCount() >= MAX_ACTIVE_HANDOFFS) {
      throw Object.assign(new Error("Too many browser downloads are awaiting a desktop decision."), { statusCode: 429 });
    }
    const now = Date.now();
    const start: BrowserHandoffStart = {
      id: randomBytes(32).toString("hex"),
      url: request.url,
      fileName: request.fileName,
      folder: request.folder,
      connections: this.options.manager.getSettings().maxConnectionsPerDownload,
      createdAt: now,
      expiresAt: now + HANDOFF_DECISION_TTL_MS,
    };
    this.pendingHandoffs.set(start.id, {
      start,
      state: "pending",
      downloadId: null,
      resolving: false,
      terminalAt: null,
    });
    return start;
  }

  getBrowserHandoffStart(handoffId: string): BrowserHandoffStart | null {
    this.prunePendingHandoffs();
    const record = this.pendingHandoffs.get(handoffId);
    return record?.state === "pending" ? { ...record.start } : null;
  }

  getBrowserHandoffDecision(handoffId: string): BrowserHandoffDecision | null {
    this.prunePendingHandoffs();
    const record = this.pendingHandoffs.get(handoffId);
    return record ? this.decisionFor(record) : null;
  }

  async approveBrowserHandoff(
    handoffId: string,
    input: { fileName: string; folder: string },
  ): Promise<BrowserHandoffDecision> {
    this.prunePendingHandoffs();
    const record = this.pendingHandoffs.get(handoffId);
    if (!record || record.state !== "pending" || record.resolving) {
      throw new Error("This browser download is no longer waiting for a start decision.");
    }
    const fileName = normalizeOptionalHandoffFileName(input.fileName);
    if (!fileName || !isValidDefaultSaveFolder(input.folder)) {
      throw new Error("Choose a valid file name and an absolute save folder before starting the download.");
    }
    record.resolving = true;
    try {
      const downloadId = await this.options.manager.addBrowserHandoff({
        url: record.start.url,
        folder: input.folder,
        fileName,
        queueId: null,
        startImmediately: true,
      });
      record.state = "accepted";
      record.downloadId = downloadId;
      record.terminalAt = Date.now();
      return this.decisionFor(record);
    } finally {
      record.resolving = false;
    }
  }

  rejectBrowserHandoff(handoffId: string): BrowserHandoffDecision {
    this.prunePendingHandoffs();
    const record = this.pendingHandoffs.get(handoffId);
    if (!record) throw new Error("This browser download is no longer available.");
    if (record.state === "pending" && !record.resolving) {
      record.state = "rejected";
      record.downloadId = null;
      record.resolving = false;
      record.terminalAt = Date.now();
    }
    return this.decisionFor(record);
  }

  /**
   * Undo a just-created desktop transfer before Chrome resumes its own paused
   * item. The record remains accepted if removal cannot complete, so the
   * extension keeps the browser copy paused rather than allowing duplicates.
   */
  async rollbackBrowserHandoff(handoffId: string, downloadId: string): Promise<BrowserHandoffDecision> {
    this.prunePendingHandoffs();
    const record = this.pendingHandoffs.get(handoffId);
    if (!record || record.state !== "accepted" || record.resolving || record.downloadId !== downloadId) {
      throw Object.assign(new Error("This accepted browser handoff is no longer available for rollback."), { statusCode: 409 });
    }
    record.resolving = true;
    try {
      await this.options.manager.rollbackBrowserHandoff(downloadId);
      record.state = "rejected";
      record.downloadId = null;
      record.terminalAt = Date.now();
      return this.decisionFor(record);
    } finally {
      record.resolving = false;
    }
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
    if (
      request.method === "POST" &&
      requestUrl.pathname.startsWith(`${HANDOFF_DECISION_PATH}/`) &&
      requestUrl.pathname.endsWith("/rollback")
    ) {
      const prefix = `${HANDOFF_DECISION_PATH}/`;
      const encodedHandoffId = requestUrl.pathname.slice(prefix.length, -"/rollback".length);
      let handoffId = "";
      try {
        handoffId = decodeURIComponent(encodedHandoffId);
      } catch {
        writeJson(response, 400, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Invalid browser handoff id" });
        return;
      }
      const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!isHandoffId(handoffId) || encodedHandoffId.includes("/") || contentType !== "application/json") {
        writeJson(response, 400, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Invalid browser handoff rollback request" });
        return;
      }
      try {
        const body = JSON.parse((await readBody(request)).toString("utf8"));
        if (
          !isRecord(body) ||
          Object.keys(body).some((key) => key !== "downloadId" && key !== "proof") ||
          typeof body.downloadId !== "string" ||
          body.downloadId.length === 0 ||
          body.downloadId.length > 128 ||
          typeof body.proof !== "string" ||
          !AUTH_PROOF_PATTERN.test(body.proof)
        ) {
          writeJson(response, 400, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Invalid browser handoff rollback request" });
          return;
        }
        const capability = await this.options.loadCapability().catch(() => null);
        if (!capability || !proofMatches(capabilityProof(capability, handoffRollbackProofInput(handoffId, body.downloadId)), body.proof)) {
          writeJson(response, 403, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Handoff authentication failed" });
          return;
        }
        const decision = await this.rollbackBrowserHandoff(handoffId, body.downloadId);
        writeJson(response, 200, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          handoffId: decision.id,
          state: decision.state,
          downloadId: decision.downloadId,
          expiresAt: decision.expiresAt,
          proof: capabilityProof(
            capability,
            handoffDecisionResponseProofInput(decision.id, decision.state, decision.downloadId),
          ),
        });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : 400;
        writeJson(response, statusCode, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          error: error instanceof Error ? error.message : "Browser handoff rollback failed",
        });
      }
      return;
    }
    if (request.method === "GET" && requestUrl.pathname.startsWith(`${HANDOFF_DECISION_PATH}/`)) {
      let handoffId = "";
      try {
        handoffId = decodeURIComponent(requestUrl.pathname.slice(HANDOFF_DECISION_PATH.length + 1));
      } catch {
        writeJson(response, 400, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Invalid browser handoff id" });
        return;
      }
      const suppliedProof = requestUrl.searchParams.get("proof") ?? "";
      const capability = await this.options.loadCapability().catch(() => null);
      if (!isHandoffId(handoffId) || !capability || !proofMatches(capabilityProof(capability, handoffDecisionProofInput(handoffId)), suppliedProof)) {
        writeJson(response, 403, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: false, error: "Handoff authentication failed" });
        return;
      }
      const decision = this.getBrowserHandoffDecision(handoffId);
      if (!decision) {
        writeJson(response, 404, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: false, error: "Browser handoff not found" });
        return;
      }
      writeJson(response, 200, {
        protocol: HANDOFF_PROTOCOL_VERSION,
        handoffId: decision.id,
        state: decision.state,
        downloadId: decision.downloadId,
        expiresAt: decision.expiresAt,
        proof: capabilityProof(
          capability,
          handoffDecisionResponseProofInput(decision.id, decision.state, decision.downloadId),
        ),
      });
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
      const requestToStart: AddDownloadRequest = {
        url: envelope.url,
        folder: this.options.manager.getSettings().defaultSaveFolder,
        fileName: envelope.fileName ?? suggestedFileName(envelope.url),
        queueId: null,
        // The browser remains paused until the user chooses Start download in
        // the desktop-owned, always-on-top decision window.
        startImmediately: false,
      };
      let start: BrowserHandoffStart | null = null;
      let clientDisconnected = response.destroyed;
      response.once("close", () => {
        if (!response.writableFinished) clientDisconnected = true;
      });
      try {
        const pendingStart = this.createPendingHandoff(requestToStart);
        start = pendingStart;
        if (clientDisconnected || response.destroyed) {
          this.rejectBrowserHandoff(pendingStart.id);
          return;
        }
        const delivered = writeJson(response, 202, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          accepted: true,
          state: "pending",
          handoffId: pendingStart.id,
          expiresAt: pendingStart.expiresAt,
          proof: capabilityProof(capability, handoffResponseProofInput(envelope.authNonce, pendingStart.id)),
        });
        if (!delivered) {
          this.rejectBrowserHandoff(pendingStart.id);
          return;
        }
        // Do not hold the browser request open while a person reads the
        // decision. The extension can poll the pending id immediately; a
        // window-open failure simply becomes an authenticated rejection.
        const presented = await this.options.presentPendingHandoff?.(pendingStart) ?? false;
        if (!presented) this.rejectBrowserHandoff(pendingStart.id);
      } catch (error) {
        if (start) this.rejectBrowserHandoff(start.id);
        this.options.logger?.(`Extension handoff could not open a start decision: ${error instanceof Error ? error.message : "unknown failure"}`);
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
        writeJson(response, statusCode, {
          protocol: HANDOFF_PROTOCOL_VERSION,
          accepted: false,
          error: "The Start download decision could not be created.",
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
