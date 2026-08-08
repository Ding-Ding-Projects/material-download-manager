/**
 * Versioned contracts shared by the main process and the managed SSH worker.
 * Keep this module runtime-neutral: it is compiled for both renderer-safe
 * shared code and Node's Electron main process.
 */

export const DISTRIBUTED_PROTOCOL_VERSION = 1 as const;
export const DISTRIBUTED_MANIFEST_VERSION = 1 as const;

export const DISTRIBUTED_FRAME_HEADER_BYTES = 5;
export const DISTRIBUTED_JSON_FRAME_MAX_BYTES = 64 * 1024;
export const DISTRIBUTED_ERROR_FRAME_MAX_BYTES = 8 * 1024;
export const DISTRIBUTED_DATA_FRAME_MAX_BYTES = 1024 * 1024;
export const DISTRIBUTED_MAX_HEADERS = 32;
export const DISTRIBUTED_MAX_HEADER_VALUE_LENGTH = 4_096;
export const DISTRIBUTED_MAX_HEADER_TOTAL_LENGTH = 32_768;
export const DISTRIBUTED_MAX_HOSTS = 16;
export const DISTRIBUTED_MAX_PIECES = 4_096;
export const DISTRIBUTED_MAX_ID_LENGTH = 128;
export const DISTRIBUTED_MAX_URL_LENGTH = 8_192;

export const DISTRIBUTED_FRAME_TYPES = Object.freeze({
  REQUEST: 1,
  META: 2,
  DATA: 3,
  END: 4,
  ERROR: 5,
} as const);

export type DistributedFrameType =
  (typeof DISTRIBUTED_FRAME_TYPES)[keyof typeof DISTRIBUTED_FRAME_TYPES];

export const DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE: Readonly<Record<DistributedFrameType, number>> =
  Object.freeze({
    [DISTRIBUTED_FRAME_TYPES.REQUEST]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
    [DISTRIBUTED_FRAME_TYPES.META]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
    [DISTRIBUTED_FRAME_TYPES.DATA]: DISTRIBUTED_DATA_FRAME_MAX_BYTES,
    [DISTRIBUTED_FRAME_TYPES.END]: DISTRIBUTED_JSON_FRAME_MAX_BYTES,
    [DISTRIBUTED_FRAME_TYPES.ERROR]: DISTRIBUTED_ERROR_FRAME_MAX_BYTES,
  });

/**
 * The worker owns Range, conditional range checks, transfer framing, and
 * content decoding. Only headers that are useful to a GET and safe to copy
 * into that controlled request are accepted here.
 */
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

const ALLOWED_REQUEST_HEADERS = new Set<string>(DISTRIBUTED_ALLOWED_REQUEST_HEADERS);
const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ERROR_CODES = new Set<DistributedRangeErrorCode>([
  "invalid-request",
  "source-unavailable",
  "source-changed",
  "range-rejected",
  "transfer-failed",
  "internal-error",
]);

export const DISTRIBUTED_ERROR_MESSAGES: Readonly<Record<DistributedRangeErrorCode, string>> = Object.freeze({
  "invalid-request": "The worker rejected the range request.",
  "source-unavailable": "The source is unavailable to the worker.",
  "source-changed": "The source identity changed during the transfer.",
  "range-rejected": "The source rejected the requested byte range.",
  "transfer-failed": "The worker could not complete the byte range.",
  "internal-error": "The worker could not process the range safely.",
});

type UnknownRecord = Record<string, unknown>;

export interface DistributedByteRange {
  start: number;
  endExclusive: number;
}

export interface SourceIdentity {
  length: number;
  etag: string | null;
  lastModified: string | null;
}

export interface DistributedDownloadSelection {
  mode: "ssh";
  hostIds?: string[];
  workerCount?: number;
  expectedSha256?: string;
}

export interface DistributedPiece extends DistributedByteRange {
  pieceId: string;
  index: number;
  length: number;
}

export type DistributedManifestPieceState = "pending" | "verified";

export interface DistributedManifestPiece extends DistributedPiece {
  state: DistributedManifestPieceState;
  verifiedByteLength: number | null;
  sha256: string | null;
  verifiedAt: number | null;
}

export interface DistributedManifest {
  version: typeof DISTRIBUTED_MANIFEST_VERSION;
  downloadId: string;
  source: SourceIdentity;
  selection: DistributedDownloadSelection;
  createdAt: number;
  updatedAt: number;
  pieces: DistributedManifestPiece[];
}

export interface DistributedRangeRequestV1 {
  version: typeof DISTRIBUTED_PROTOCOL_VERSION;
  type: "range-request";
  /** Unique live assignment/lease identifier; never reused after reassignment. */
  requestId: string;
  pieceId: string;
  url: string;
  range: DistributedByteRange;
  headers: Record<string, string>;
  source: SourceIdentity;
}

export interface DistributedRangeMetaV1 {
  version: typeof DISTRIBUTED_PROTOCOL_VERSION;
  type: "meta";
  requestId: string;
  pieceId: string;
  range: DistributedByteRange;
  source: SourceIdentity;
}

export interface DistributedRangeEndV1 {
  version: typeof DISTRIBUTED_PROTOCOL_VERSION;
  type: "end";
  requestId: string;
  pieceId: string;
  range: DistributedByteRange;
  byteLength: number;
  sha256: string;
}

export type DistributedRangeErrorCode =
  | "invalid-request"
  | "source-unavailable"
  | "source-changed"
  | "range-rejected"
  | "transfer-failed"
  | "internal-error";

export interface DistributedRangeErrorV1 {
  version: typeof DISTRIBUTED_PROTOCOL_VERSION;
  type: "error";
  /** Both are null only when the request failed before its identifiers parsed. */
  requestId: string | null;
  pieceId: string | null;
  code: DistributedRangeErrorCode;
  message: string;
  retryable: boolean;
}

export type DistributedWorkerRequestV1 = DistributedRangeRequestV1;
export type DistributedWorkerResponseV1 =
  | DistributedRangeMetaV1
  | DistributedRangeEndV1
  | DistributedRangeErrorV1;

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasExactKeys(record: UnknownRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const keys = ownKeys as string[];
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => hasOwn(record, key)) && keys.every((key) => allowed.has(key));
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function hasNoControlCharacters(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/u.test(value);
}

export function isDistributedId(value: unknown): value is string {
  return typeof value === "string" && value.length <= DISTRIBUTED_MAX_ID_LENGTH && ID_PATTERN.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isDistributedSourceUrl(value: unknown): value is string {
  if (!isBoundedString(value, 1, DISTRIBUTED_MAX_URL_LENGTH)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function isDistributedByteRange(value: unknown, sourceLength?: number): value is DistributedByteRange {
  if (!isRecord(value) || !hasExactKeys(value, ["start", "endExclusive"])) return false;
  if (!isSafeInteger(value.start) || !isSafeInteger(value.endExclusive, 1)) return false;
  if (value.endExclusive <= value.start) return false;
  return sourceLength === undefined || value.endExclusive <= sourceLength;
}

export function isSourceIdentity(value: unknown): value is SourceIdentity {
  if (!isRecord(value) || !hasExactKeys(value, ["length", "etag", "lastModified"])) return false;
  if (!isSafeInteger(value.length, 1)) return false;
  const etagValid =
    value.etag === null ||
    (isBoundedString(value.etag, 2, 1_024) && /^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value.etag));
  const lastModifiedValid =
    value.lastModified === null ||
    (isBoundedString(value.lastModified, 1, 128) &&
      hasNoControlCharacters(value.lastModified) &&
      Number.isFinite(Date.parse(value.lastModified)) &&
      new Date(Date.parse(value.lastModified)).toUTCString() === value.lastModified);
  return etagValid && lastModifiedValid && (value.etag !== null || value.lastModified !== null);
}

/** Canonicalizes an HTTP date while preserving the strong ETag as an opaque token. */
export function canonicalizeSourceIdentity(value: unknown): SourceIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, ["length", "etag", "lastModified"])) return null;
  if (!isSafeInteger(value.length, 1)) return null;
  if (
    value.etag !== null &&
    !(isBoundedString(value.etag, 2, 1_024) && /^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value.etag))
  ) {
    return null;
  }
  let lastModified: string | null = null;
  if (value.lastModified !== null) {
    if (!isBoundedString(value.lastModified, 1, 128) || !hasNoControlCharacters(value.lastModified)) return null;
    const parsed = Date.parse(value.lastModified);
    if (!Number.isFinite(parsed)) return null;
    lastModified = new Date(parsed).toUTCString();
  }
  const identity: SourceIdentity = { length: value.length, etag: value.etag, lastModified };
  return identity.etag === null && identity.lastModified === null ? null : identity;
}

export function isDistributedRequestHeaders(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > DISTRIBUTED_MAX_HEADERS) return false;
  let totalLength = 0;
  const normalizedNames = new Set<string>();
  for (const [name, headerValue] of entries) {
    const normalizedName = name.toLowerCase();
    if (name !== normalizedName || !ALLOWED_REQUEST_HEADERS.has(normalizedName)) return false;
    if (normalizedNames.has(normalizedName)) return false;
    if (!isBoundedString(headerValue, 0, DISTRIBUTED_MAX_HEADER_VALUE_LENGTH)) return false;
    if (!hasNoControlCharacters(headerValue)) return false;
    normalizedNames.add(normalizedName);
    totalLength += normalizedName.length + headerValue.length;
    if (totalLength > DISTRIBUTED_MAX_HEADER_TOTAL_LENGTH) return false;
  }
  return true;
}

export function isDistributedDownloadSelection(value: unknown): value is DistributedDownloadSelection {
  if (!isRecord(value) || !hasExactKeys(value, ["mode"], ["hostIds", "workerCount", "expectedSha256"])) {
    return false;
  }
  if (value.mode !== "ssh") return false;
  const hasHostIds = hasOwn(value, "hostIds");
  const hasWorkerCount = hasOwn(value, "workerCount");
  if (hasHostIds === hasWorkerCount) return false;
  if (hasHostIds) {
    if (!Array.isArray(value.hostIds) || value.hostIds.length < 1 || value.hostIds.length > DISTRIBUTED_MAX_HOSTS) {
      return false;
    }
    if (!value.hostIds.every(isDistributedId) || new Set(value.hostIds).size !== value.hostIds.length) return false;
  }
  if (hasWorkerCount && (!isSafeInteger(value.workerCount, 1) || value.workerCount > DISTRIBUTED_MAX_HOSTS)) {
    return false;
  }
  if (hasOwn(value, "expectedSha256") && !isSha256(value.expectedSha256)) {
    return false;
  }
  return true;
}

export function isDistributedPiece(value: unknown): value is DistributedPiece {
  if (!isRecord(value) || !hasExactKeys(value, ["pieceId", "index", "start", "endExclusive", "length"])) {
    return false;
  }
  if (!isDistributedId(value.pieceId) || !isSafeInteger(value.index) || value.index >= DISTRIBUTED_MAX_PIECES) {
    return false;
  }
  if (!isSafeInteger(value.start) || !isSafeInteger(value.endExclusive, 1) || value.endExclusive <= value.start) {
    return false;
  }
  return isSafeInteger(value.length, 1) && value.length === value.endExclusive - value.start;
}

export function isDistributedManifestPiece(value: unknown): value is DistributedManifestPiece {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "pieceId",
      "index",
      "start",
      "endExclusive",
      "length",
      "state",
      "verifiedByteLength",
      "sha256",
      "verifiedAt",
    ])
  ) {
    return false;
  }
  if (!isDistributedPiece({
    pieceId: value.pieceId,
    index: value.index,
    start: value.start,
    endExclusive: value.endExclusive,
    length: value.length,
  })) {
    return false;
  }
  if (value.state === "pending") {
    return value.verifiedByteLength === null && value.sha256 === null && value.verifiedAt === null;
  }
  return (
    value.state === "verified" &&
    value.verifiedByteLength === value.length &&
    isSha256(value.sha256) &&
    isSafeInteger(value.verifiedAt, 1)
  );
}

export function isDistributedManifest(value: unknown): value is DistributedManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "downloadId",
      "source",
      "selection",
      "createdAt",
      "updatedAt",
      "pieces",
    ])
  ) {
    return false;
  }
  if (value.version !== DISTRIBUTED_MANIFEST_VERSION || !isDistributedId(value.downloadId)) return false;
  if (!isSourceIdentity(value.source)) return false;
  if (!isDistributedDownloadSelection(value.selection)) return false;
  if (!isSafeInteger(value.createdAt, 1) || !isSafeInteger(value.updatedAt, value.createdAt)) return false;
  if (!Array.isArray(value.pieces) || value.pieces.length < 1 || value.pieces.length > DISTRIBUTED_MAX_PIECES) {
    return false;
  }
  const pieceIds = new Set<string>();
  let expectedStart = 0;
  for (const [index, piece] of value.pieces.entries()) {
    if (!isDistributedManifestPiece(piece)) return false;
    if (piece.index !== index || piece.start !== expectedStart || pieceIds.has(piece.pieceId)) return false;
    if (piece.verifiedAt !== null && piece.verifiedAt > value.updatedAt) return false;
    pieceIds.add(piece.pieceId);
    expectedStart = piece.endExclusive;
  }
  return expectedStart === value.source.length;
}

export function isDistributedRangeRequestV1(value: unknown): value is DistributedRangeRequestV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "type", "requestId", "pieceId", "url", "range", "headers", "source"])
  ) {
    return false;
  }
  return (
    value.version === DISTRIBUTED_PROTOCOL_VERSION &&
    value.type === "range-request" &&
    isDistributedId(value.requestId) &&
    isDistributedId(value.pieceId) &&
    isDistributedSourceUrl(value.url) &&
    isSourceIdentity(value.source) &&
    isDistributedByteRange(value.range, value.source.length) &&
    isDistributedRequestHeaders(value.headers)
  );
}

export const isDistributedWorkerRequestV1 = isDistributedRangeRequestV1;

export function isDistributedRangeMetaV1(value: unknown): value is DistributedRangeMetaV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "type", "requestId", "pieceId", "range", "source"])) {
    return false;
  }
  return (
    value.version === DISTRIBUTED_PROTOCOL_VERSION &&
    value.type === "meta" &&
    isDistributedId(value.requestId) &&
    isDistributedId(value.pieceId) &&
    isSourceIdentity(value.source) &&
    isDistributedByteRange(value.range, value.source.length)
  );
}

export function isDistributedRangeEndV1(value: unknown): value is DistributedRangeEndV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "type", "requestId", "pieceId", "range", "byteLength", "sha256"])
  ) {
    return false;
  }
  return (
    value.version === DISTRIBUTED_PROTOCOL_VERSION &&
    value.type === "end" &&
    isDistributedId(value.requestId) &&
    isDistributedId(value.pieceId) &&
    isDistributedByteRange(value.range) &&
    isSafeInteger(value.byteLength, 1) &&
    value.byteLength === value.range.endExclusive - value.range.start &&
    isSha256(value.sha256)
  );
}

export function isDistributedRangeErrorV1(value: unknown): value is DistributedRangeErrorV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "type", "requestId", "pieceId", "code", "message", "retryable"])
  ) {
    return false;
  }
  return (
    value.version === DISTRIBUTED_PROTOCOL_VERSION &&
    value.type === "error" &&
    ((value.requestId === null && value.pieceId === null) ||
      (isDistributedId(value.requestId) && isDistributedId(value.pieceId))) &&
    typeof value.code === "string" &&
    ERROR_CODES.has(value.code as DistributedRangeErrorCode) &&
    (value.requestId !== null || value.code === "invalid-request") &&
    value.message === DISTRIBUTED_ERROR_MESSAGES[value.code as DistributedRangeErrorCode] &&
    typeof value.retryable === "boolean"
  );
}
