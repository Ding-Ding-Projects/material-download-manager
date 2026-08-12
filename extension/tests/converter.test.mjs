import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONVERTER_LIMITS,
  CONVERTER_REQUIRED_CATEGORIES,
  ConverterError,
  converterCatalog,
  converterExportBoundary,
  convertLocalFile,
  filterConverterCatalog,
  getAdapter,
  makeConverterOutcome,
  outcomeFromConverterError,
  resolveAdapterAvailability,
  sniffFileType,
} from "../src/shared/converter.js";
import {
  CONVERTER_QUEUE_INDEX_KEY,
  CONVERTER_QUEUE_PAGE_PREFIX,
  CONVERTER_QUEUE_PAGE_SIZE,
  createConverterQueueStore,
  isRedactedConverterOutcome,
} from "../src/shared/converter-store.js";

function bytes(value) {
  return new TextEncoder().encode(value);
}

function chunkedFile(content, { name = "selected.bin", type = "application/octet-stream" } = {}) {
  const source = content instanceof Uint8Array ? content.slice() : new Uint8Array(content);
  const slices = [];
  let rootReadCount = 0;
  return {
    name,
    type,
    size: source.byteLength,
    slices,
    get rootReadCount() { return rootReadCount; },
    async arrayBuffer() {
      rootReadCount += 1;
      throw new Error("whole-file reads are forbidden in this fixture");
    },
    slice(start = 0, end = source.byteLength) {
      slices.push([start, end]);
      const part = source.slice(start, end);
      return {
        size: part.byteLength,
        async arrayBuffer() {
          return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
        },
      };
    },
  };
}

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) {
      if (typeof key === "string") return { [key]: values.get(key) };
      if (Array.isArray(key)) return Object.fromEntries(key.map((entry) => [entry, values.get(entry)]));
      return Object.fromEntries(values);
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value));
    },
  };
}

function createLockManager() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      return previous.then(async () => {
        try {
          return await callback({ name: _name, mode: _options?.mode });
        } finally {
          release();
        }
      });
    },
  };
}

test("converter catalog exposes every required category and only derives enabled state from bundled proof", () => {
  const catalog = converterCatalog();
  assert.deepEqual(catalog.map((category) => category.id), CONVERTER_REQUIRED_CATEGORIES);
  for (const category of catalog) assert.ok(category.adapters.length > 0, `${category.id} must stay visible even when unavailable`);

  const binary = catalog.find((category) => category.id === "binary-encodings");
  assert.equal(binary.adapters.filter((adapter) => adapter.availability.enabled).length, 4);
  for (const category of catalog.filter((entry) => entry.id !== "binary-encodings")) {
    assert.equal(category.adapters.every((adapter) => adapter.availability.enabled === false), true);
    assert.equal(category.adapters.every((adapter) => adapter.availability.reasons[0]?.length > 0), true);
  }

  const forged = {
    ...getAdapter("binary.base64.encode"),
    enabled: true,
    availability: {
      ...getAdapter("binary.base64.encode").availability,
      bundled: false,
      enabled: true,
    },
  };
  const resolved = resolveAdapterAvailability(forged);
  assert.equal(resolved.enabled, false);
  assert.match(resolved.reasons.join(" "), /bundled/i);
});

test("catalog filtering preserves adapter records and lets the UI supply an isolated regex predicate", () => {
  const catalog = converterCatalog();
  const plain = filterConverterCatalog(catalog, { query: "hex" });
  assert.deepEqual(plain.map((category) => category.id), ["binary-encodings"]);
  assert.equal(plain[0].adapters.length, 2);
  const predicate = (value) => /PDF/u.test(value);
  const regex = filterConverterCatalog(catalog, { predicate });
  assert.deepEqual(regex.map((category) => category.id), ["documents-pdf"]);
});

test("bounded signature inspection ignores filename and MIME claims", async () => {
  const disguisedPdf = chunkedFile(bytes("%PDF-1.7\nnot-an-image"), { name: "photo.jpg", type: "image/jpeg" });
  const detected = await sniffFileType(disguisedPdf);
  assert.equal(detected.kind, "pdf");
  assert.equal(detected.category, "documents-pdf");
  assert.equal(detected.mime, "application/pdf");
  assert.equal(disguisedPdf.rootReadCount, 0);
  assert.equal(disguisedPdf.slices.every(([start, end]) => start === 0 && end - start <= CONVERTER_LIMITS.signatureBytes), true);
});

test("type inspection fails closed when a slice does not match its requested bound", async () => {
  const truncatedSlice = {
    size: 8,
    slice() {
      return { size: 1, async arrayBuffer() { return new Uint8Array([0]).buffer; } };
    },
  };
  await assert.rejects(
    () => sniffFileType(truncatedSlice),
    (error) => error instanceof ConverterError && error.code === "source-invalid",
  );
});

test("bundled Base64 and hexadecimal adapters use slices only and validate lossless round trips", async () => {
  const payload = bytes("Local bytes: \u0000\u0001 tea-time payload \ud83e\udd5f");
  const source = chunkedFile(payload);
  const progress = [];
  const base64 = await convertLocalFile({
    file: source,
    adapterId: "binary.base64.encode",
    onProgress: (event) => progress.push(event),
  });
  assert.equal(base64.code, "converted");
  assert.equal(base64.validation.ok, true);
  assert.equal(await base64.output.text(), Buffer.from(payload).toString("base64"));
  assert.equal(source.rootReadCount, 0);
  assert.equal(source.slices.every(([start, end]) => end - start <= CONVERTER_LIMITS.chunkBytes), true);
  assert.equal(progress.at(-1).ratio, 1);

  const decoded = await convertLocalFile({
    file: chunkedFile(bytes(await base64.output.text()), { name: "payload.base64.txt", type: "text/plain" }),
    adapterId: "binary.base64.decode",
  });
  assert.deepEqual(new Uint8Array(await decoded.output.arrayBuffer()), payload);

  const hex = await convertLocalFile({ file: chunkedFile(payload), adapterId: "binary.hex.encode" });
  assert.equal(await hex.output.text(), Buffer.from(payload).toString("hex"));
  const hexDecoded = await convertLocalFile({ file: chunkedFile(bytes(await hex.output.text())), adapterId: "binary.hex.decode" });
  assert.deepEqual(new Uint8Array(await hexDecoded.output.arrayBuffer()), payload);
});

test("conversion cancellation and malformed textual input fail before an output is offered", async () => {
  const large = chunkedFile(new Uint8Array(CONVERTER_LIMITS.chunkBytes * 2).fill(0x61));
  let cancel = false;
  await assert.rejects(
    () => convertLocalFile({
      file: large,
      adapterId: "binary.hex.encode",
      signal: () => cancel,
      onProgress: ({ completedBytes }) => { if (completedBytes >= CONVERTER_LIMITS.chunkBytes) cancel = true; },
    }),
    (error) => error instanceof ConverterError && error.code === "cancelled",
  );
  assert.equal(outcomeFromConverterError(new ConverterError("cancelled", "test")), "cancelled");
  await assert.rejects(
    () => convertLocalFile({ file: chunkedFile(bytes("not-base64%%%")), adapterId: "binary.base64.decode" }),
    (error) => error instanceof ConverterError && error.code === "source-invalid",
  );
});

test("converter export boundary never invents a native editor route", () => {
  const missing = converterExportBoundary({ downloadsApi: null, urlApi: null });
  assert.equal(missing.browserDownload.enabled, false);
  assert.equal(missing.openInEditor.enabled, false);
  assert.match(missing.openInEditor.reason, /native integration/i);
  const available = converterExportBoundary({ downloadsApi: { download() {} }, urlApi: { createObjectURL() {} } });
  assert.equal(available.browserDownload.enabled, true);
  assert.equal(available.openInEditor.enabled, false);
});

test("paged queue persists only redacted outcomes and recovers in-flight records as needs-reselection", async () => {
  const local = createLocalStorage();
  const lockManager = createLockManager();
  const store = createConverterQueueStore({
    local,
    now: () => "2026-08-12T20:00:00.000Z",
    lockManager,
  });
  const first = await store.enqueue({ adapterId: "binary.base64.encode", inputBytes: 12 });
  assert.equal(first.phase, "queued");
  assert.equal(first.code, "queued");
  const processing = await store.transition(first.id, { phase: "processing", code: "processing" });
  assert.equal(processing.phase, "processing");
  const recovered = await store.recoverInterrupted({ maxPages: 1 });
  assert.deepEqual(recovered, { changed: 1, scannedPages: 1, nextCursor: null, done: true });
  const afterRecovery = await store.get(first.id);
  assert.equal(afterRecovery.phase, "needs-reselection");
  assert.equal(afterRecovery.code, "needs-reselection");
  assert.equal(isRedactedConverterOutcome(afterRecovery), true);
  assert.equal(isRedactedConverterOutcome({ ...afterRecovery, sourceName: "private-file.bin" }), false);

  for (let index = 0; index < CONVERTER_QUEUE_PAGE_SIZE; index += 1) {
    await store.enqueue({ adapterId: "binary.hex.encode", inputBytes: index });
  }
  const firstPage = await store.listPage({ cursor: 0 });
  assert.equal(firstPage.records.length, CONVERTER_QUEUE_PAGE_SIZE);
  assert.equal(firstPage.nextCursor, 1);
  const secondPage = await store.listPage({ cursor: firstPage.nextCursor });
  assert.equal(secondPage.records.length, 1);
  const exportPage = await store.exportPage({ cursor: 0 });
  assert.equal(exportPage.sourceFileMetadataOmitted, true);
  assert.equal(JSON.stringify(exportPage).includes("private-file.bin"), false);
  assert.equal(local.values.get(CONVERTER_QUEUE_INDEX_KEY).pageCount, 2);
});

test("outcome schema rejects source-identifying fields and corrupt queue indexes fail closed", async () => {
  const valid = makeConverterOutcome({
    id: "converter-00000001",
    adapterId: "binary.hex.encode",
    phase: "converted",
    inputBytes: 1,
    outputBytes: 2,
    code: "converted",
    at: "2026-08-12T20:00:00.000Z",
  });
  assert.equal(isRedactedConverterOutcome(valid), true);
  assert.throws(
    () => makeConverterOutcome({ ...valid, sourcePath: "C:\\secret.txt" }),
    (error) => error instanceof ConverterError && error.code === "outcome-invalid",
  );
  assert.throws(
    () => makeConverterOutcome({ ...valid, phase: "converted", code: "failed" }),
    (error) => error instanceof ConverterError && error.code === "outcome-invalid",
  );
  assert.throws(
    () => makeConverterOutcome({ ...valid, phase: "converted", outputBytes: null }),
    (error) => error instanceof ConverterError && error.code === "outcome-invalid",
  );
  assert.throws(
    () => makeConverterOutcome({ ...valid, phase: "queued", code: "queued", outputBytes: null, inputBytes: CONVERTER_LIMITS.inputBytes + 1 }),
    (error) => error instanceof ConverterError && error.code === "outcome-invalid",
  );
  const local = createLocalStorage({ [CONVERTER_QUEUE_INDEX_KEY]: { invalid: true } });
  const store = createConverterQueueStore({ local, lockManager: createLockManager() });
  await assert.rejects(() => store.enqueue({ adapterId: "binary.hex.encode", inputBytes: 1 }), /queue index/i);
  const unavailable = createConverterQueueStore({ local: createLocalStorage(), lockManager: createLockManager() });
  await assert.rejects(
    () => unavailable.enqueue({ adapterId: "documents.pdf.tools", inputBytes: 1 }),
    (error) => error instanceof ConverterError && error.code === "outcome-invalid",
  );

  const truncatedPageLocal = createLocalStorage({
    [CONVERTER_QUEUE_INDEX_KEY]: {
      schemaVersion: 1,
      pageSize: CONVERTER_QUEUE_PAGE_SIZE,
      pageCount: 2,
      tailCount: 1,
      nextSequence: 3,
    },
    [`${CONVERTER_QUEUE_PAGE_PREFIX}0`]: [valid],
    [`${CONVERTER_QUEUE_PAGE_PREFIX}1`]: [{ ...valid, id: "converter-00000002" }],
  });
  const truncated = createConverterQueueStore({ local: truncatedPageLocal, lockManager: createLockManager() });
  await assert.rejects(() => truncated.listPage({ cursor: 0 }), /queue (?:page|index)/i);
});

test("queue mutations use a cross-context lock so concurrent extension pages cannot overwrite an outcome", async () => {
  const local = createLocalStorage();
  const lockManager = createLockManager();
  const firstPage = createConverterQueueStore({ local, lockManager, now: () => "2026-08-12T20:00:01.000Z" });
  const secondPage = createConverterQueueStore({ local, lockManager, now: () => "2026-08-12T20:00:02.000Z" });
  const [first, second] = await Promise.all([
    firstPage.enqueue({ adapterId: "binary.base64.encode", inputBytes: 10 }),
    secondPage.enqueue({ adapterId: "binary.hex.encode", inputBytes: 20 }),
  ]);
  assert.notEqual(first.id, second.id);
  const page = await firstPage.listPage();
  assert.equal(page.records.length, 2);
  assert.deepEqual(page.records.map((record) => record.id).sort(), [first.id, second.id].sort());
});

test("queue mutation fails closed when the browser cannot provide a cross-context lock", async () => {
  const store = createConverterQueueStore({ local: createLocalStorage(), lockManager: null });
  await assert.rejects(
    () => store.enqueue({ adapterId: "binary.hex.encode", inputBytes: 1 }),
    (error) => error instanceof ConverterError && error.code === "queue-lock-unavailable",
  );
});
