import assert from "node:assert/strict";
import test from "node:test";
import {
  DISTRIBUTED_DATA_FRAME_MAX_BYTES,
  DISTRIBUTED_ERROR_MESSAGES,
  DISTRIBUTED_FRAME_HEADER_BYTES,
  DISTRIBUTED_FRAME_TYPES,
  DISTRIBUTED_PROTOCOL_VERSION,
  type DistributedRangeEndV1,
  type DistributedRangeMetaV1,
  type DistributedRangeRequestV1,
  canonicalizeSourceIdentity,
  isDistributedDownloadSelection,
  isDistributedRangeErrorV1,
  isDistributedRangeRequestV1,
  isSourceIdentity,
} from "../../../shared/distributedProtocol";
import {
  DistributedFrameDecoder,
  DistributedProtocolError,
  WorkerResponseOrderValidator,
  encodeDistributedDataFrame,
  encodeDistributedJsonFrame,
} from "../distributed/WorkerProtocol";

const source = Object.freeze({ length: 10, etag: '"v1"', lastModified: null });
const range = Object.freeze({ start: 0, endExclusive: 10 });
const request: DistributedRangeRequestV1 = Object.freeze({
  version: DISTRIBUTED_PROTOCOL_VERSION,
  type: "range-request",
  requestId: "request-1",
  pieceId: "piece-0001",
  url: "https://downloads.example.test/file.bin?build=1",
  range,
  headers: Object.freeze({ accept: "application/octet-stream", authorization: "Bearer example" }),
  source,
});
const meta: DistributedRangeMetaV1 = Object.freeze({
  version: DISTRIBUTED_PROTOCOL_VERSION,
  type: "meta",
  requestId: request.requestId,
  pieceId: request.pieceId,
  range,
  source,
});
const end: DistributedRangeEndV1 = Object.freeze({
  version: DISTRIBUTED_PROTOCOL_VERSION,
  type: "end",
  requestId: request.requestId,
  pieceId: request.pieceId,
  range,
  byteLength: 10,
  sha256: "a".repeat(64),
});

function rawFrame(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(DISTRIBUTED_FRAME_HEADER_BYTES);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.byteLength, 1);
  return Buffer.concat([header, payload]);
}

test("version-1 request and selection validators enforce exact keys and bounded identities", () => {
  assert.equal(isDistributedRangeRequestV1(request), true);
  assert.equal(isDistributedRangeRequestV1({ ...request, extra: true }), false);
  assert.equal(isDistributedRangeRequestV1({ ...request, range: { ...range, extra: 1 } }), false);
  assert.equal(isDistributedRangeRequestV1({ ...request, headers: { range: "bytes=0-9" } }), false);
  assert.equal(isDistributedRangeRequestV1({ ...request, headers: { Authorization: "Bearer example" } }), false);
  assert.equal(isDistributedRangeRequestV1({ ...request, source: { length: 10, etag: null, lastModified: null } }), false);
  assert.equal(isDistributedRangeRequestV1({ ...request, source: { ...source, unexpected: "no" } }), false);

  assert.equal(isDistributedDownloadSelection({ mode: "ssh", hostIds: ["alpha", "beta"] }), true);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", workerCount: 4, expectedSha256: "b".repeat(64) }), true);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", hostIds: ["alpha", "alpha"] }), false);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", hostIds: ["alpha"], workerCount: 1 }), false);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", workerCount: 17 }), false);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", workerCount: 1, expectedSha256: null }), false);
  assert.equal(isDistributedDownloadSelection({ mode: "ssh", workerCount: 1, expectedSha256: "B".repeat(64) }), false);
});

test("source identities require strong ETags or canonical HTTP dates", () => {
  assert.equal(isSourceIdentity({ length: 10, etag: '"strong"', lastModified: null }), true);
  assert.equal(isSourceIdentity({ length: 10, etag: 'W/"weak"', lastModified: null }), false);
  assert.equal(isSourceIdentity({ length: 10, etag: null, lastModified: "not-a-date" }), false);
  assert.equal(isSourceIdentity({ length: 10, etag: null, lastModified: "August 7, 2025" }), false);
  assert.deepEqual(
    canonicalizeSourceIdentity({ length: 10, etag: null, lastModified: "August 7, 2025 12:00:00 GMT" }),
    { length: 10, etag: null, lastModified: "Thu, 07 Aug 2025 12:00:00 GMT" }
  );
});

test("ERROR accepts only paired identifiers and canonical generic messages", () => {
  assert.equal(isDistributedRangeErrorV1({
    version: 1,
    type: "error",
    requestId: null,
    pieceId: null,
    code: "invalid-request",
    message: DISTRIBUTED_ERROR_MESSAGES["invalid-request"],
    retryable: false,
  }), true);
  assert.equal(isDistributedRangeErrorV1({
    version: 1,
    type: "error",
    requestId: null,
    pieceId: null,
    code: "internal-error",
    message: DISTRIBUTED_ERROR_MESSAGES["internal-error"],
    retryable: false,
  }), false);
  assert.equal(isDistributedRangeErrorV1({
    version: 1,
    type: "error",
    requestId: request.requestId,
    pieceId: null,
    code: "transfer-failed",
    message: DISTRIBUTED_ERROR_MESSAGES["transfer-failed"],
    retryable: true,
  }), false);
  assert.equal(isDistributedRangeErrorV1({
    version: 1,
    type: "error",
    requestId: request.requestId,
    pieceId: request.pieceId,
    code: "transfer-failed",
    message: "connect ECONNREFUSED 10.0.0.1:8080",
    retryable: true,
  }), false);
});

test("decoder accepts a request fragmented across every byte boundary", () => {
  const encoded = encodeDistributedJsonFrame(DISTRIBUTED_FRAME_TYPES.REQUEST, request);
  const decoder = new DistributedFrameDecoder();
  const frames = [];
  for (const byte of encoded) {
    frames.push(...decoder.push(Uint8Array.of(byte)));
  }
  assert.equal(frames.length, 1);
  assert.equal(frames[0].frameType, DISTRIBUTED_FRAME_TYPES.REQUEST);
  assert.deepEqual(frames[0].payload, request);
  assert.equal(decoder.bufferedByteLength, 0);
});

test("decoder separates coalesced META, DATA, and END frames", () => {
  const encoded = Buffer.concat([
    encodeDistributedJsonFrame(DISTRIBUTED_FRAME_TYPES.META, meta),
    encodeDistributedDataFrame(Buffer.from("0123456789", "ascii")),
    encodeDistributedJsonFrame(DISTRIBUTED_FRAME_TYPES.END, end),
  ]);
  const frames = new DistributedFrameDecoder().push(encoded);
  assert.deepEqual(frames.map((frame) => frame.frameType), [
    DISTRIBUTED_FRAME_TYPES.META,
    DISTRIBUTED_FRAME_TYPES.DATA,
    DISTRIBUTED_FRAME_TYPES.END,
  ]);
  assert.equal(frames[1].frameType === DISTRIBUTED_FRAME_TYPES.DATA && frames[1].payload.toString("ascii"), "0123456789");
});

test("decoder rejects an oversized declaration from the header before buffering a payload", () => {
  const header = Buffer.alloc(DISTRIBUTED_FRAME_HEADER_BYTES);
  header.writeUInt8(DISTRIBUTED_FRAME_TYPES.DATA, 0);
  header.writeUInt32BE(DISTRIBUTED_DATA_FRAME_MAX_BYTES + 1, 1);
  const decoder = new DistributedFrameDecoder();
  assert.throws(
    () => decoder.push(header),
    (error: unknown) => error instanceof DistributedProtocolError && error.code === "frame-too-large"
  );
  assert.equal(decoder.bufferedByteLength, DISTRIBUTED_FRAME_HEADER_BYTES);
});

test("decoder rejects invalid UTF-8, unknown JSON keys, and unknown frame types", () => {
  assert.throws(
    () => new DistributedFrameDecoder().push(rawFrame(DISTRIBUTED_FRAME_TYPES.META, Buffer.from([0xc3, 0x28]))),
    (error: unknown) => error instanceof DistributedProtocolError && error.code === "invalid-utf8"
  );
  assert.throws(
    () => new DistributedFrameDecoder().push(rawFrame(
      DISTRIBUTED_FRAME_TYPES.META,
      Buffer.from(JSON.stringify({ ...meta, surprise: true }), "utf8")
    )),
    (error: unknown) => error instanceof DistributedProtocolError && error.code === "invalid-payload"
  );
  assert.throws(
    () => new DistributedFrameDecoder().push(rawFrame(99, Buffer.from("x"))),
    (error: unknown) => error instanceof DistributedProtocolError && error.code === "unknown-frame-type"
  );
});

test("response-order validator accepts META then DATA then END and rejects every shortcut", () => {
  const validator = new WorkerResponseOrderValidator(request);
  assert.throws(
    () => validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.DATA, payload: Buffer.from("x") }),
    /first worker response/i
  );
  assert.equal(validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.META, payload: meta }), "streaming");
  assert.equal(validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.DATA, payload: Buffer.from("012") }), "streaming");
  assert.equal(validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.DATA, payload: Buffer.from("3456789") }), "streaming");
  assert.equal(validator.receivedByteLength, 10);
  assert.equal(validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.END, payload: end }), "completed");
  assert.throws(
    () => validator.accept({ frameType: DISTRIBUTED_FRAME_TYPES.END, payload: end }),
    /cannot accept another frame/i
  );

  const duplicateMeta = new WorkerResponseOrderValidator(request);
  duplicateMeta.accept({ frameType: DISTRIBUTED_FRAME_TYPES.META, payload: meta });
  assert.throws(
    () => duplicateMeta.accept({ frameType: DISTRIBUTED_FRAME_TYPES.META, payload: meta }),
    /META may appear only once/i
  );

  const short = new WorkerResponseOrderValidator(request);
  short.accept({ frameType: DISTRIBUTED_FRAME_TYPES.META, payload: meta });
  short.accept({ frameType: DISTRIBUTED_FRAME_TYPES.DATA, payload: Buffer.from("short") });
  assert.throws(
    () => short.accept({ frameType: DISTRIBUTED_FRAME_TYPES.END, payload: end }),
    /10 were required/i
  );
});
