import { TextDecoder } from "node:util";

export const DISTRIBUTED_PROTOCOL_VERSION = 1 as const;
export const DISTRIBUTED_FRAME_HEADER_BYTES = 5 as const;
export const DISTRIBUTED_JSON_FRAME_MAX_BYTES = 64 * 1024;
export const DISTRIBUTED_ERROR_FRAME_MAX_BYTES = 8 * 1024;
export const DISTRIBUTED_DATA_FRAME_MAX_BYTES = 1024 * 1024;
export const DISTRIBUTED_MAX_HEADERS = 32;
export const DISTRIBUTED_MAX_HEADER_VALUE_LENGTH = 4_096;
export const DISTRIBUTED_MAX_HEADER_TOTAL_LENGTH = 32_768;
export const DISTRIBUTED_MAX_ID_LENGTH = 128;
export const DISTRIBUTED_MAX_URL_LENGTH = 8_192;
export const PROTOCOL_VERSION = DISTRIBUTED_PROTOCOL_VERSION;

export const FRAME_LIMITS = Object.freeze({
  metadata: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
  data: DISTRIBUTED_DATA_FRAME_MAX_BYTES,
  error: DISTRIBUTED_ERROR_FRAME_MAX_BYTES,
  buffered: DISTRIBUTED_DATA_FRAME_MAX_BYTES + DISTRIBUTED_FRAME_HEADER_BYTES,
});

export enum FrameType {
  REQUEST = 1,
  META = 2,
  DATA = 3,
  END = 4,
  ERROR = 5,
}

export const DISTRIBUTED_FRAME_TYPES = Object.freeze({
  REQUEST: FrameType.REQUEST,
  META: FrameType.META,
  DATA: FrameType.DATA,
  END: FrameType.END,
  ERROR: FrameType.ERROR,
});

export const DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE: Readonly<Record<FrameType, number>> = Object.freeze({
  [FrameType.REQUEST]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
  [FrameType.META]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
  [FrameType.DATA]: DISTRIBUTED_DATA_FRAME_MAX_BYTES,
  [FrameType.END]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
  [FrameType.ERROR]: DISTRIBUTED_ERROR_FRAME_MAX_BYTES,
});

export interface SourceIdentity {
  length: number;
  etag: string | null;
  lastModified: string | null;
}

export interface RangeRequest {
  version: 1;
  type: "range-request";
  requestId: string;
  pieceId: string;
  url: string;
  range: {
    start: number;
    endExclusive: number;
  };
  headers: Record<string, string>;
  source: SourceIdentity;
}

export interface MetaFrame {
  version: 1;
  type: "meta";
  requestId: string;
  pieceId: string;
  range: { start: number; endExclusive: number };
  source: SourceIdentity;
}

export interface EndFrame {
  version: 1;
  type: "end";
  requestId: string;
  pieceId: string;
  range: { start: number; endExclusive: number };
  byteLength: number;
  sha256: string;
}

export interface ErrorFrame {
  version: 1;
  type: "error";
  requestId: string | null;
  pieceId: string | null;
  code: WorkerErrorCode;
  message: string;
  retryable: boolean;
}

export type WorkerErrorCode =
  | "invalid-request"
  | "source-unavailable"
  | "source-changed"
  | "range-rejected"
  | "transfer-failed"
  | "internal-error";

export const DISTRIBUTED_ERROR_MESSAGES: Readonly<Record<WorkerErrorCode, string>> = Object.freeze({
  "invalid-request": "The worker rejected the range request.",
  "source-unavailable": "The source is unavailable to the worker.",
  "source-changed": "The source identity changed during the transfer.",
  "range-rejected": "The source rejected the requested byte range.",
  "transfer-failed": "The worker could not complete the byte range.",
  "internal-error": "The worker could not process the range safely.",
});
export const ERROR_MESSAGES = DISTRIBUTED_ERROR_MESSAGES;

export interface DecodedFrame {
  type: FrameType;
  payload: Buffer;
}

export class ProtocolError extends Error {
  readonly code: WorkerErrorCode;
  readonly retryable: boolean;

  constructor(code: WorkerErrorCode, retryable = false) {
    super(ERROR_MESSAGES[code]);
    this.name = "ProtocolError";
    this.code = code;
    this.retryable = retryable;
  }
}

function limitFor(type: FrameType): number {
  switch (type) {
    case FrameType.DATA:
      return FRAME_LIMITS.data;
    case FrameType.ERROR:
      return FRAME_LIMITS.error;
    case FrameType.REQUEST:
    case FrameType.META:
    case FrameType.END:
      return FRAME_LIMITS.metadata;
    default:
      return 0;
  }
}

export function encodeFrame(type: FrameType, payload: Buffer): Buffer {
  const limit = limitFor(type);
  if (limit === 0 || payload.byteLength === 0 || payload.byteLength > limit) {
    throw new ProtocolError("invalid-request");
  }
  const header = Buffer.allocUnsafe(DISTRIBUTED_FRAME_HEADER_BYTES);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.byteLength, 1);
  return Buffer.concat([header, payload], header.byteLength + payload.byteLength);
}

export function encodeJsonFrame(type: Exclude<FrameType, FrameType.DATA>, value: unknown): Buffer {
  return encodeFrame(type, Buffer.from(JSON.stringify(value), "utf8"));
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  get bufferedBytes(): number {
    return this.#buffer.byteLength;
  }

  push(chunk: Buffer): DecodedFrame[] {
    if (chunk.byteLength === 0) return [];
    if (this.#buffer.byteLength + chunk.byteLength > FRAME_LIMITS.buffered) {
      throw new ProtocolError("invalid-request");
    }
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames: DecodedFrame[] = [];
    while (this.#buffer.byteLength >= DISTRIBUTED_FRAME_HEADER_BYTES) {
      const rawType = this.#buffer.readUInt8(0);
      if (rawType < FrameType.REQUEST || rawType > FrameType.ERROR) {
        throw new ProtocolError("invalid-request");
      }
      const type = rawType as FrameType;
      const length = this.#buffer.readUInt32BE(1);
      if (length === 0 || length > limitFor(type)) {
        throw new ProtocolError("invalid-request");
      }
      if (this.#buffer.byteLength < DISTRIBUTED_FRAME_HEADER_BYTES + length) break;
      frames.push({
        type,
        payload: this.#buffer.subarray(DISTRIBUTED_FRAME_HEADER_BYTES, DISTRIBUTED_FRAME_HEADER_BYTES + length),
      });
      this.#buffer = this.#buffer.subarray(DISTRIBUTED_FRAME_HEADER_BYTES + length);
    }
    return frames;
  }

  finish(): void {
    if (this.#buffer.byteLength !== 0) {
      throw new ProtocolError("invalid-request");
    }
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;
export const DISTRIBUTED_ALLOWED_REQUEST_HEADERS = Object.freeze([
  "accept",
  "accept-language",
  "authorization",
  "cache-control",
  "cookie",
  "dnt",
  "origin",
  "pragma",
  "referer",
  "user-agent",
  "x-api-key",
  "x-auth-token",
  "x-requested-with",
] as const);
const ALLOWED_HEADERS = new Set<string>(DISTRIBUTED_ALLOWED_REQUEST_HEADERS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

function boundedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > DISTRIBUTED_MAX_HEADERS) {
    throw new ProtocolError("invalid-request");
  }
  let total = 0;
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (!HEADER_NAME.test(rawName) || rawName !== rawName.toLowerCase() || !ALLOWED_HEADERS.has(rawName)) {
      throw new ProtocolError("invalid-request");
    }
    if (typeof rawValue !== "string" || rawValue.length > DISTRIBUTED_MAX_HEADER_VALUE_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(rawValue)) {
      throw new ProtocolError("invalid-request");
    }
    total += rawName.length + rawValue.length;
    if (total > DISTRIBUTED_MAX_HEADER_TOTAL_LENGTH) {
      throw new ProtocolError("invalid-request");
    }
    result[rawName] = rawValue;
  }
  return result;
}

export function parseRangeRequest(payload: Buffer): RangeRequest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
  } catch {
    throw new ProtocolError("invalid-request");
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "type", "requestId", "pieceId", "url", "range", "headers", "source"])) {
    throw new ProtocolError("invalid-request");
  }
  let sourceUrl: string | undefined;
  if (typeof value.url === "string" && value.url.length > 0 && value.url.length <= DISTRIBUTED_MAX_URL_LENGTH) {
    try {
      const parsedUrl = new URL(value.url);
      if ((parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
          && Boolean(parsedUrl.hostname) && !parsedUrl.username && !parsedUrl.password && !parsedUrl.hash) {
        sourceUrl = value.url;
      }
    } catch {
      sourceUrl = undefined;
    }
  }
  if (value.version !== PROTOCOL_VERSION || value.type !== "range-request"
      || typeof value.requestId !== "string" || !ID_PATTERN.test(value.requestId)
      || typeof value.pieceId !== "string" || !ID_PATTERN.test(value.pieceId)
      || sourceUrl === undefined) {
    throw new ProtocolError("invalid-request");
  }
  if (!isRecord(value.range) || !hasOnlyKeys(value.range, ["start", "endExclusive"])
      || !boundedInteger(value.range.start) || !boundedInteger(value.range.endExclusive)
      || value.range.endExclusive <= value.range.start) {
    throw new ProtocolError("invalid-request");
  }
  if (!isRecord(value.source) || !hasOnlyKeys(value.source, ["length", "etag", "lastModified"])
      || !boundedInteger(value.source.length) || value.source.length === 0
      || value.range.endExclusive > value.source.length) {
    throw new ProtocolError("invalid-request");
  }
  const etag = value.source.etag;
  const lastModified = value.source.lastModified;
  if (etag !== null && (typeof etag !== "string" || etag.length > 1024
      || !/^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(etag))) {
    throw new ProtocolError("invalid-request");
  }
  const parsedLastModified = typeof lastModified === "string" ? Date.parse(lastModified) : Number.NaN;
  if (lastModified !== null && (typeof lastModified !== "string" || lastModified.length === 0
      || lastModified.length > 128 || /[\u0000-\u001f\u007f]/u.test(lastModified)
      || !Number.isFinite(parsedLastModified)
      || new Date(parsedLastModified).toUTCString() !== lastModified)) {
    throw new ProtocolError("invalid-request");
  }
  if (etag === null && lastModified === null) {
    throw new ProtocolError("invalid-request");
  }
  const source: SourceIdentity = {
    length: value.source.length,
    etag: typeof etag === "string" ? etag : null,
    lastModified: typeof lastModified === "string" ? lastModified : null,
  };
  return {
    version: PROTOCOL_VERSION,
    type: "range-request",
    requestId: value.requestId,
    pieceId: value.pieceId,
    url: sourceUrl,
    range: { start: value.range.start, endExclusive: value.range.endExclusive },
    headers: validateHeaders(value.headers),
    source,
  };
}

export function toErrorFrame(error: unknown, request?: Pick<RangeRequest, "requestId" | "pieceId">): ErrorFrame {
  const known = !request
    ? new ProtocolError("invalid-request")
    : error instanceof ProtocolError
    ? error
    : new ProtocolError("internal-error", true);
  const frame: ErrorFrame = {
    version: PROTOCOL_VERSION,
    type: "error",
    requestId: request?.requestId ?? null,
    pieceId: request?.pieceId ?? null,
    code: known.code,
    message: ERROR_MESSAGES[known.code],
    retryable: known.retryable,
  };
  return frame;
}
