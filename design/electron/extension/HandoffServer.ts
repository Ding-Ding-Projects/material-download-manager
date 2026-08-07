import http from "node:http";
import path from "node:path";
import type { AddDownloadRequest, AppSettings } from "../../shared/types";

export const HANDOFF_PROTOCOL_VERSION = 1;
export const HANDOFF_HOST = "127.0.0.1";
export const HANDOFF_PORT = 43771;
export const HANDOFF_PATH = "/v1/downloads";
export const STATUS_PATH = "/v1/status";
export const HANDOFF_SOURCE = "material-download-manager-extension";
export const MAX_HANDOFF_BODY_BYTES = 16 * 1024;
export const MAX_URL_LENGTH = 8_192;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SELECTION_LENGTH = 2_048;

export interface HandoffManager {
  getSettings(): AppSettings;
  addDownload(request: AddDownloadRequest): Promise<string>;
}

interface HandoffEnvelope {
  protocol: typeof HANDOFF_PROTOCOL_VERSION;
  source: typeof HANDOFF_SOURCE;
  url: string;
  requestedAt?: string;
  title?: string;
  selectionText?: string;
}

interface HandoffServerOptions {
  manager: HandoffManager;
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

export function parseHandoffEnvelope(value: unknown): HandoffEnvelope {
  if (!isRecord(value)) throw new Error("Invalid handoff envelope");
  if (value.protocol !== HANDOFF_PROTOCOL_VERSION || value.source !== HANDOFF_SOURCE) {
    throw new Error("Unsupported handoff protocol");
  }
  const url = normalizeHandoffUrl(value.url);
  const requestedAt = boundedOptionalString(value.requestedAt, 64, "requested timestamp");
  const title = boundedOptionalString(value.title, MAX_TITLE_LENGTH, "title");
  const selectionText = boundedOptionalString(value.selectionText, MAX_SELECTION_LENGTH, "selection text");
  return { protocol: HANDOFF_PROTOCOL_VERSION, source: HANDOFF_SOURCE, url, requestedAt, title, selectionText };
}

function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = address?.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function suggestedFileName(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    const candidate = decodeURIComponent(path.posix.basename(url.pathname)).replace(/[\u0000-\u001f\u007f]/g, "");
    if (candidate && candidate !== "." && candidate !== ".." && candidate.length <= 512) return candidate;
  } catch {
    // URL validation has already happened; the fallback is still safer than
    // allowing a malformed pathname to become a filesystem name.
  }
  return "download";
}

function writeJson(response: http.ServerResponse, statusCode: number, value: Record<string, unknown>) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, accept",
  });
  response.end(body);
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

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      writeJson(response, 403, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Loopback access only" });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type, accept");
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, accept" });
      response.end();
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://${HANDOFF_HOST}`);
    if (request.method === "GET" && requestUrl.pathname === STATUS_PATH) {
      writeJson(response, 200, { protocol: HANDOFF_PROTOCOL_VERSION, acceptingUrls: this.listening });
      return;
    }
    if (request.method !== "POST" || requestUrl.pathname !== HANDOFF_PATH) {
      writeJson(response, 404, { protocol: HANDOFF_PROTOCOL_VERSION, error: "Not found" });
      return;
    }
    const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      writeJson(response, 415, { protocol: HANDOFF_PROTOCOL_VERSION, error: "application/json is required" });
      return;
    }
    try {
      const envelope = parseHandoffEnvelope(JSON.parse((await readBody(request)).toString("utf8")));
      const requestToAdd: AddDownloadRequest = {
        url: envelope.url,
        folder: this.options.manager.getSettings().defaultSaveFolder,
        fileName: suggestedFileName(envelope.url),
        queueId: null,
        startImmediately: true,
      };
      try {
        const downloadId = await this.options.manager.addDownload(requestToAdd);
        writeJson(response, 202, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: true, downloadId });
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
    }
  }
}
