import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRAME_LIMITS,
  FrameDecoder,
  FrameType,
  ProtocolError,
  encodeFrame,
  encodeJsonFrame,
  parseRangeRequest,
  toErrorFrame,
} from "../dist/protocol.js";

function validRequest(overrides = {}) {
  return {
    version: 1,
    type: "range-request",
    requestId: "request-1",
    pieceId: "piece-1",
    url: "https://downloads.example/file.bin",
    range: { start: 10, endExclusive: 20 },
    headers: { "user-agent": "mdm-test" },
    source: { length: 100, etag: '"v1"', lastModified: null },
    ...overrides,
  };
}

test("the five-byte frame header survives arbitrary fragmentation", () => {
  const encoded = encodeJsonFrame(FrameType.REQUEST, validRequest());
  const decoder = new FrameDecoder();
  const frames = [];
  for (const byte of encoded) frames.push(...decoder.push(Buffer.of(byte)));
  decoder.finish();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, FrameType.REQUEST);
  assert.deepEqual(parseRangeRequest(frames[0].payload), validRequest());
});

test("declared, buffered, and encoded frame limits fail closed", () => {
  const declared = Buffer.alloc(5);
  declared.writeUInt8(FrameType.REQUEST, 0);
  declared.writeUInt32BE(FRAME_LIMITS.metadata + 1, 1);
  assert.throws(() => new FrameDecoder().push(declared), (error) => error instanceof ProtocolError && error.code === "invalid-request");
  assert.throws(
    () => encodeFrame(FrameType.ERROR, Buffer.alloc(FRAME_LIMITS.error + 1)),
    (error) => error instanceof ProtocolError && error.code === "invalid-request",
  );
  assert.throws(
    () => encodeFrame(FrameType.DATA, Buffer.alloc(0)),
    (error) => error instanceof ProtocolError && error.code === "invalid-request",
  );
  const empty = Buffer.alloc(5);
  empty.writeUInt8(FrameType.DATA, 0);
  assert.throws(
    () => new FrameDecoder().push(empty),
    (error) => error instanceof ProtocolError && error.code === "invalid-request",
  );
  const decoder = new FrameDecoder();
  assert.throws(
    () => decoder.push(Buffer.alloc(FRAME_LIMITS.buffered + 1)),
    (error) => error instanceof ProtocolError && error.code === "invalid-request",
  );
});

test("truncated frames remain visible to the caller", () => {
  const encoded = encodeJsonFrame(FrameType.REQUEST, validRequest());
  const decoder = new FrameDecoder();
  decoder.push(encoded.subarray(0, encoded.length - 1));
  assert.equal(decoder.bufferedBytes, encoded.length - 1);
  assert.throws(() => decoder.finish(), (error) => error instanceof ProtocolError && error.code === "invalid-request");
});

test("request validation rejects hostile shapes and transport-controlled headers", () => {
  const cases = [
    { ...validRequest(), extra: true },
    validRequest({ version: 2 }),
    validRequest({ requestId: "../escape" }),
    validRequest({ url: "file:///tmp/source" }),
    validRequest({ url: "https://user:password@example.test/file" }),
    validRequest({ url: "https://example.test/file#fragment" }),
    validRequest({ range: { start: 20, endExclusive: 20 } }),
    validRequest({ range: { start: 99, endExclusive: 101 } }),
    validRequest({ source: { length: 100, etag: null, lastModified: null } }),
    validRequest({ source: { length: 100, etag: 'W/"weak"', lastModified: null } }),
    validRequest({ source: { length: 100, etag: "unquoted", lastModified: null } }),
    validRequest({ source: { length: 100, etag: null, lastModified: "yesterday" } }),
    validRequest({ source: { length: 100, etag: null, lastModified: "Invalid Date" } }),
    validRequest({ source: { length: 100, etag: null, lastModified: "Wed, 21 Oct 2015 07:28:00 GMT\u0007" } }),
    validRequest({ headers: { Range: "bytes=0-1" } }),
    validRequest({ headers: { range: "bytes=0-1" } }),
    validRequest({ headers: { authorization: "secret\r\ninjected: yes" } }),
  ];
  for (const request of cases) {
    assert.throws(
      () => parseRangeRequest(Buffer.from(JSON.stringify(request))),
      (error) => error instanceof ProtocolError && error.code === "invalid-request",
    );
  }
});

test("request JSON rejects malformed UTF-8 instead of accepting replacement characters", () => {
  const prefix = Buffer.from('{"version":1,"type":"range-request","requestId":"');
  const suffix = Buffer.from('","pieceId":"piece-1","url":"https://example.test/file","range":{"start":0,"endExclusive":1},"headers":{},"source":{"length":1,"etag":"\\"v1\\"","lastModified":null}}');
  assert.throws(
    () => parseRangeRequest(Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix])),
    (error) => error instanceof ProtocolError && error.code === "invalid-request",
  );
});

test("request validation accepts an exact Last-Modified identity", () => {
  const request = validRequest({ source: { length: 100, etag: null, lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" } });
  assert.deepEqual(parseRangeRequest(Buffer.from(JSON.stringify(request))), request);
});

test("unknown failures become bounded generic errors without reflected source data", () => {
  const secret = "token-that-must-not-escape";
  const frame = toErrorFrame(new Error(secret), { requestId: "request-1", pieceId: "piece-1" });
  assert.equal(frame.code, "internal-error");
  assert.equal(frame.message.includes(secret), false);
  assert.equal(Buffer.byteLength(JSON.stringify(frame)) < FRAME_LIMITS.error, true);
});
