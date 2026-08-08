import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import ts from "typescript";

import * as worker from "../dist/protocol.js";

const sharedPath = process.env.MDM_SHARED_PROTOCOL_PATH
  ? resolve(process.env.MDM_SHARED_PROTOCOL_PATH)
  : resolve(import.meta.dirname, "../../design/shared/distributedProtocol.ts");

test("the self-contained worker protocol cannot drift from the desktop shared contract", async (context) => {
  if (!existsSync(sharedPath)) {
    context.skip("The shared protocol lane has not been integrated into this isolated checkout yet.");
    return;
  }
  const source = readFileSync(sharedPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    fileName: sharedPath,
  }).outputText;
  const shared = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  for (const name of [
    "DISTRIBUTED_PROTOCOL_VERSION",
    "DISTRIBUTED_FRAME_HEADER_BYTES",
    "DISTRIBUTED_JSON_FRAME_MAX_BYTES",
    "DISTRIBUTED_ERROR_FRAME_MAX_BYTES",
    "DISTRIBUTED_DATA_FRAME_MAX_BYTES",
    "DISTRIBUTED_MAX_HEADERS",
    "DISTRIBUTED_MAX_HEADER_VALUE_LENGTH",
    "DISTRIBUTED_MAX_HEADER_TOTAL_LENGTH",
    "DISTRIBUTED_MAX_ID_LENGTH",
    "DISTRIBUTED_MAX_URL_LENGTH",
    "DISTRIBUTED_FRAME_TYPES",
    "DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE",
    "DISTRIBUTED_ALLOWED_REQUEST_HEADERS",
    "DISTRIBUTED_ERROR_MESSAGES",
  ]) assert.deepEqual(worker[name], shared[name], name);

  const request = worker.parseRangeRequest(Buffer.from(JSON.stringify({
    version: 1,
    type: "range-request",
    requestId: "lease-1",
    pieceId: "piece-1",
    url: "https://downloads.example/file.bin",
    range: { start: 0, endExclusive: 10 },
    headers: { authorization: "Bearer live-only" },
    source: { length: 10, etag: '"v1"', lastModified: null },
  })));
  assert.equal(shared.isDistributedRangeRequestV1(request), true);
  assert.equal(shared.isDistributedRangeMetaV1({
    version: 1,
    type: "meta",
    requestId: request.requestId,
    pieceId: request.pieceId,
    range: request.range,
    source: request.source,
  }), true);
  assert.equal(shared.isDistributedRangeEndV1({
    version: 1,
    type: "end",
    requestId: request.requestId,
    pieceId: request.pieceId,
    range: request.range,
    byteLength: 10,
    sha256: "0".repeat(64),
  }), true);
  for (const code of Object.keys(worker.DISTRIBUTED_ERROR_MESSAGES)) {
    assert.equal(shared.isDistributedRangeErrorV1(worker.toErrorFrame(
      new worker.ProtocolError(code, false),
      request,
    )), true, code);
  }
  assert.equal(shared.isDistributedRangeErrorV1(worker.toErrorFrame(new Error("upstream secret"))), true);

  const candidates = [
    { ...request, source: { length: 10, etag: null, lastModified: "Invalid Date" } },
    { ...request, source: { length: 10, etag: null, lastModified: "Wed, 21 Oct 2015 07:28:00 GMT\u0007" } },
    { ...request, source: { length: 10, etag: 'W/"weak"', lastModified: null } },
    { ...request, headers: { range: "bytes=0-9" } },
    { ...request, unexpected: true },
  ];
  for (const candidate of candidates) {
    let workerAccepted = true;
    try {
      worker.parseRangeRequest(Buffer.from(JSON.stringify(candidate)));
    } catch {
      workerAccepted = false;
    }
    assert.equal(workerAccepted, shared.isDistributedRangeRequestV1(candidate), JSON.stringify(candidate));
  }
});
