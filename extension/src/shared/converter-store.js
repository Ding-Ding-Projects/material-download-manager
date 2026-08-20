/**
 * Redacted, paged local outcome store for the browser-extension converter.
 *
 * A browser File selection cannot safely survive an extension-page restart
 * without a separately proven persisted file-handle capability. Accordingly,
 * this store never accepts File, Blob, filename, source path, MIME claim, or
 * source content. Interrupted work is honestly marked needs-reselection.
 */

import {
  CONVERTER_SCHEMA_VERSION,
  ConverterError,
  makeConverterOutcome,
} from "./converter.js";

export const CONVERTER_QUEUE_INDEX_KEY = "converterQueueIndexV1";
export const CONVERTER_QUEUE_PAGE_PREFIX = "converterQueuePageV1.";
export const CONVERTER_QUEUE_PAGE_SIZE = 64;
export const CONVERTER_QUEUE_EXPORT_SCHEMA = "material-download-manager-extension-converter-outcomes";
export const CONVERTER_QUEUE_EXPORT_VERSION = 1;
export const CONVERTER_QUEUE_LOCK_NAME = "material-download-manager.extension.converter-queue.v1";

const RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "id",
  "adapterId",
  "phase",
  "inputBytes",
  "outputBytes",
  "code",
  "at",
  "attempt",
]);

const RECOVERABLE_PHASES = new Set(["queued", "processing", "paused"]);
const TRANSITIONS = Object.freeze({
  queued: new Set(["processing", "cancelled", "failed", "needs-reselection"]),
  processing: new Set(["paused", "converted", "cancelled", "failed", "needs-reselection"]),
  paused: new Set(["processing", "cancelled", "failed", "needs-reselection"]),
  "needs-reselection": new Set(["queued", "cancelled"]),
  failed: new Set(["queued", "cancelled"]),
  cancelled: new Set(["queued"]),
  skipped: new Set(["queued"]),
  converted: new Set(),
});

function pageKey(page) {
  return `${CONVERTER_QUEUE_PAGE_PREFIX}${page}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowIso(now) {
  const value = now();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new ConverterError("queue-invalid", "The converter queue clock returned an invalid timestamp.");
  }
  return value;
}

function defaultIndex() {
  return {
    schemaVersion: CONVERTER_SCHEMA_VERSION,
    pageSize: CONVERTER_QUEUE_PAGE_SIZE,
    pageCount: 1,
    tailCount: 0,
    nextSequence: 1,
  };
}

function validateIndex(value) {
  if (value === undefined) return defaultIndex();
  if (!isRecord(value)) throw new ConverterError("queue-corrupt", "The converter queue index is malformed; no outcome was changed.");
  const keys = Object.keys(value).sort();
  const expected = Object.keys(defaultIndex()).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new ConverterError("queue-corrupt", "The converter queue index contains unsupported fields; no outcome was changed.");
  if (value.schemaVersion !== CONVERTER_SCHEMA_VERSION || value.pageSize !== CONVERTER_QUEUE_PAGE_SIZE) throw new ConverterError("queue-corrupt", "The converter queue index version is unsupported; no outcome was changed.");
  for (const field of ["pageCount", "tailCount", "nextSequence"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1 && field !== "tailCount") throw new ConverterError("queue-corrupt", "The converter queue index has an invalid counter; no outcome was changed.");
  }
  if (value.tailCount < 0 || value.tailCount > CONVERTER_QUEUE_PAGE_SIZE) throw new ConverterError("queue-corrupt", "The converter queue tail count is invalid; no outcome was changed.");
  return { ...value };
}

function validateStoredRecord(value) {
  if (!isRecord(value)) throw new ConverterError("queue-corrupt", "A converter outcome record is malformed; no outcome was changed.");
  const keys = Object.keys(value).sort();
  const expected = [...RECORD_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new ConverterError("queue-corrupt", "A converter outcome record contains unsupported fields; no outcome was changed.");
  return makeConverterOutcome(value);
}

function validatePage(value, expectedCount = -1) {
  if (value === undefined) {
    if (expectedCount === 0) return [];
    throw new ConverterError("queue-corrupt", "A converter queue page is missing; no outcome was changed.");
  }
  if (!Array.isArray(value) || value.length > CONVERTER_QUEUE_PAGE_SIZE) throw new ConverterError("queue-corrupt", "A converter queue page is malformed; no outcome was changed.");
  if (expectedCount >= 0 && value.length !== expectedCount) throw new ConverterError("queue-corrupt", "The converter queue index and its tail page disagree; no outcome was changed.");
  return value.map(validateStoredRecord);
}

function recordId(sequence) {
  return `converter-${sequence.toString(36).padStart(8, "0")}`;
}

function copyRecord(record) {
  return Object.freeze({ ...record });
}

function assertStorage(local) {
  if (!local || typeof local.get !== "function" || typeof local.set !== "function") {
    throw new ConverterError("queue-storage-unavailable", "The browser-local converter outcome store is unavailable.");
  }
}

/**
 * Paged queue metadata with no configured total-record cap. Only one page is
 * read or written at a time; platform storage quotas remain an honest runtime
 * boundary and surface as a storage error instead of silent loss.
 */
export function createConverterQueueStore({
  local,
  now = () => new Date().toISOString(),
  idFactory = recordId,
  lockManager = globalThis.navigator?.locks,
} = {}) {
  assertStorage(local);
  let mutation = Promise.resolve();

  async function withCrossContextLock(operation) {
    if (!lockManager || typeof lockManager.request !== "function") {
      throw new ConverterError("queue-lock-unavailable", "This browser does not expose the cross-context local lock required to persist converter queue mutations safely.");
    }
    return lockManager.request(CONVERTER_QUEUE_LOCK_NAME, { mode: "exclusive" }, operation);
  }

  const serialized = (operation) => {
    // The Promise chain handles same-page re-entry. navigator.locks handles
    // independent extension pages and workers that share chrome.storage.local.
    mutation = mutation.catch(() => {}).then(() => withCrossContextLock(operation));
    return mutation;
  };

  async function readIndex() {
    const stored = await local.get(CONVERTER_QUEUE_INDEX_KEY);
    return validateIndex(stored?.[CONVERTER_QUEUE_INDEX_KEY]);
  }

  async function readPage(index, page) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= index.pageCount) throw new ConverterError("queue-invalid", "The requested converter queue page is outside the persisted queue.");
    const stored = await local.get(pageKey(page));
    // Every completed page is exactly full. Accepting a shorter non-tail page
    // would silently turn truncation into missing conversion outcomes.
    const expectedCount = page === index.pageCount - 1 ? index.tailCount : CONVERTER_QUEUE_PAGE_SIZE;
    return validatePage(stored?.[pageKey(page)], expectedCount);
  }

  async function write(index, page, records) {
    await local.set({
      [CONVERTER_QUEUE_INDEX_KEY]: index,
      [pageKey(page)]: records.map((record) => ({ ...record })),
    });
  }

  async function locate(id) {
    const index = await readIndex();
    for (let page = 0; page < index.pageCount; page += 1) {
      const records = await readPage(index, page);
      const offset = records.findIndex((record) => record.id === id);
      if (offset >= 0) return { index, page, records, offset };
    }
    return null;
  }

  const listPage = async ({ cursor = 0 } = {}) => {
    const index = await readIndex();
    const page = Number(cursor);
    if (!Number.isSafeInteger(page) || page < 0) throw new ConverterError("queue-invalid", "The converter queue page cursor is invalid.");
    if (page >= index.pageCount) return Object.freeze({ records: Object.freeze([]), nextCursor: null, pageCount: index.pageCount });
    const records = await readPage(index, page);
    return Object.freeze({
      records: Object.freeze(records.map(copyRecord)),
      nextCursor: page + 1 < index.pageCount ? page + 1 : null,
      pageCount: index.pageCount,
    });
  };

  return Object.freeze({
    async enqueue({ adapterId, inputBytes } = {}) {
      return serialized(async () => {
        const index = await readIndex();
        let page = index.pageCount - 1;
        let records = await readPage(index, page);
        if (records.length === CONVERTER_QUEUE_PAGE_SIZE) {
          page += 1;
          index.pageCount += 1;
          index.tailCount = 0;
          records = [];
        }
        const id = String(idFactory(index.nextSequence));
        const record = makeConverterOutcome({
          id,
          adapterId,
          phase: "queued",
          inputBytes,
          outputBytes: null,
          // A raw file is intentionally not persisted. If the page goes away,
          // recovery changes this queued record to needs-reselection before any
          // retry is offered.
          code: "queued",
          at: nowIso(now),
          attempt: 1,
        });
        records.push(record);
        index.tailCount = records.length;
        index.nextSequence += 1;
        await write(index, page, records);
        return copyRecord(record);
      });
    },

    async get(id) {
      const found = await locate(String(id));
      return found ? copyRecord(found.records[found.offset]) : null;
    },

    listPage,

    async transition(id, { phase, code, outputBytes = null, attempt = null } = {}) {
      return serialized(async () => {
        const found = await locate(String(id));
        if (!found) throw new ConverterError("queue-not-found", "The selected converter queue record no longer exists.");
        const current = found.records[found.offset];
        const nextPhase = String(phase ?? "");
        if (!TRANSITIONS[current.phase]?.has(nextPhase)) throw new ConverterError("queue-transition-invalid", "That converter queue state transition is not allowed.");
        const nextAttempt = attempt === null ? (nextPhase === "queued" ? current.attempt + 1 : current.attempt) : attempt;
        const next = makeConverterOutcome({
          id: current.id,
          adapterId: current.adapterId,
          phase: nextPhase,
          inputBytes: current.inputBytes,
          outputBytes,
          code,
          at: nowIso(now),
          attempt: nextAttempt,
        });
        found.records[found.offset] = next;
        await write(found.index, found.page, found.records);
        return copyRecord(next);
      });
    },

    /**
     * Scan a bounded number of metadata pages after startup. It never claims a
     * raw browser File was restored: any in-flight item becomes
     * needs-reselection and retains its adapter/byte-count outcome history.
     */
    async recoverInterrupted({ cursor = 0, maxPages = 1 } = {}) {
      return serialized(async () => {
        const index = await readIndex();
        let page = Number(cursor);
        const limit = Math.max(1, Math.min(64, Number(maxPages) || 1));
        if (!Number.isSafeInteger(page) || page < 0) throw new ConverterError("queue-invalid", "The converter recovery cursor is invalid.");
        let changed = 0;
        let scanned = 0;
        while (page < index.pageCount && scanned < limit) {
          const records = await readPage(index, page);
          const restored = records.map((record) => {
            if (!RECOVERABLE_PHASES.has(record.phase)) return record;
            changed += 1;
            return makeConverterOutcome({
              id: record.id,
              adapterId: record.adapterId,
              phase: "needs-reselection",
              inputBytes: record.inputBytes,
              outputBytes: null,
              code: "needs-reselection",
              at: nowIso(now),
              attempt: record.attempt,
            });
          });
          if (restored.some((record, indexInPage) => record !== records[indexInPage])) await write(index, page, restored);
          page += 1;
          scanned += 1;
        }
        return Object.freeze({
          changed,
          scannedPages: scanned,
          nextCursor: page < index.pageCount ? page : null,
          done: page >= index.pageCount,
        });
      });
    },

    async exportPage({ cursor = 0 } = {}) {
      const page = await listPage({ cursor });
      return Object.freeze({
        schema: CONVERTER_QUEUE_EXPORT_SCHEMA,
        version: CONVERTER_QUEUE_EXPORT_VERSION,
        sourceFileMetadataOmitted: true,
        records: page.records,
        nextCursor: page.nextCursor,
      });
    },
  });
}

/**
 * Useful for a privacy Chut: a persisted record must contain exactly the
 * neutral outcome fields and cannot carry hidden file metadata.
 */
export function isRedactedConverterOutcome(value) {
  try {
    const record = validateStoredRecord(value);
    return Object.keys(record).every((key) => RECORD_KEYS.includes(key));
  } catch {
    return false;
  }
}
