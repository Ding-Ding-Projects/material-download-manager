export const DISPLAY_NAME_MUTATION_JOURNAL_KEY = "displayNameMutationJournal";
export const DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA = "material-download-manager-display-name-journal";
export const DISPLAY_NAME_MUTATION_JOURNAL_VERSION = 1;
export const MAX_DISPLAY_NAME_MUTATIONS = 256;

let journalMutationQueue = Promise.resolve();

const JOURNAL_ACTIONS = new Set([
  "display-name-created",
  "display-name-changed",
  "display-name-reset",
  "authenticator-created",
  "authenticator-removed",
]);
const JOURNAL_SOURCES = new Set(["extension-settings", "extension-authenticator"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function validateEntry(value) {
  return isRecord(value)
    && value.schema === DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA
    && value.version === DISPLAY_NAME_MUTATION_JOURNAL_VERSION
    && typeof value.id === "string"
    && /^[a-f0-9]{64}$/u.test(value.id)
    && JOURNAL_ACTIONS.has(value.action)
    && isIsoTimestamp(value.at)
    && JOURNAL_SOURCES.has(value.source)
    && value.redacted === true
    && isSha256(value.beforeHash)
    && isSha256(value.afterHash);
}

function assertStorage(storage) {
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") {
    const error = new Error("The local display-name journal is unavailable.");
    error.code = "display-name-history-unavailable";
    throw error;
  }
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") {
    const error = new Error("The local display-name journal cannot hash metadata.");
    error.code = "display-name-history-unavailable";
    throw error;
  }
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeStoredJournal(rawValue) {
  if (rawValue === undefined) return [];
  if (!Array.isArray(rawValue) || rawValue.length > MAX_DISPLAY_NAME_MUTATIONS) {
    const error = new Error("The local display-name journal is malformed or exceeds its safety limit.");
    error.code = "display-name-history-unavailable";
    throw error;
  }
  if (!rawValue.every(validateEntry)) {
    const error = new Error("The local display-name journal contains an invalid entry.");
    error.code = "display-name-history-unavailable";
    throw error;
  }
  return rawValue.map((entry) => ({ ...entry }));
}

export async function readDisplayNameMutationJournal(storage) {
  assertStorage(storage);
  const stored = await storage.get(DISPLAY_NAME_MUTATION_JOURNAL_KEY);
  return normalizeStoredJournal(stored?.[DISPLAY_NAME_MUTATION_JOURNAL_KEY]);
}

export function displayNameMutationAction(before, after, shippedName) {
  if (after === shippedName) return "display-name-reset";
  if (before === shippedName) return "display-name-created";
  return "display-name-changed";
}

async function appendDisplayNameMutationNow(storage, { before, after, shippedName, at = new Date().toISOString() }) {
  assertStorage(storage);
  if (!isIsoTimestamp(at)) {
    const error = new Error("The display-name journal timestamp is invalid.");
    error.code = "display-name-history-unavailable";
    throw error;
  }
  const entries = await readDisplayNameMutationJournal(storage);
  if (entries.length >= MAX_DISPLAY_NAME_MUTATIONS) {
    const error = new Error("The local display-name journal reached its retention limit.");
    error.code = "display-name-history-unavailable";
    throw error;
  }

  const beforeHash = await sha256Hex(before);
  const afterHash = await sha256Hex(after);
  const action = displayNameMutationAction(before, after, shippedName);
  const id = await sha256Hex(`${entries.length}\n${at}\n${action}\n${beforeHash}\n${afterHash}`);
  const entry = Object.freeze({
    schema: DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA,
    version: DISPLAY_NAME_MUTATION_JOURNAL_VERSION,
    id,
    action,
    at,
    source: "extension-settings",
    redacted: true,
    beforeHash,
    afterHash,
  });
  await storage.set({
    [DISPLAY_NAME_MUTATION_JOURNAL_KEY]: [...entries, entry],
  });
  return entry;
}

export function appendDisplayNameMutation(storage, details) {
  journalMutationQueue = journalMutationQueue
    .catch(() => {})
    .then(() => appendDisplayNameMutationNow(storage, details));
  return journalMutationQueue;
}

/** Record authenticator add/remove metadata without persisting its secret or labels. */
export function appendAuthenticatorMutation(storage, { action, id, at = new Date().toISOString() }) {
  if (!JOURNAL_ACTIONS.has(action) || !/^authenticator-[a-z]+$/u.test(action) || typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(id) || !isIsoTimestamp(at)) {
    const error = new Error("The authenticator mutation journal metadata is invalid.");
    error.code = "display-name-history-unavailable";
    return Promise.reject(error);
  }
  journalMutationQueue = journalMutationQueue
    .catch(() => {})
    .then(async () => {
      const entries = await readDisplayNameMutationJournal(storage);
      if (entries.length >= MAX_DISPLAY_NAME_MUTATIONS) {
        const error = new Error("The local display-name journal reached its retention limit.");
        error.code = "display-name-history-unavailable";
        throw error;
      }
      const before = action === "authenticator-created" ? "absent" : "present";
      const after = action === "authenticator-created" ? "present" : "absent";
      const [beforeHash, afterHash] = await Promise.all([sha256Hex(`${action}\n${id}\n${before}`), sha256Hex(`${action}\n${id}\n${after}`)]);
      const entry = Object.freeze({
        schema: DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA,
        version: DISPLAY_NAME_MUTATION_JOURNAL_VERSION,
        id: await sha256Hex(`${entries.length}\n${at}\n${action}\n${beforeHash}\n${afterHash}`),
        action,
        at,
        source: "extension-authenticator",
        redacted: true,
        beforeHash,
        afterHash,
      });
      await storage.set({ [DISPLAY_NAME_MUTATION_JOURNAL_KEY]: [...entries, entry] });
      return entry;
    });
  return journalMutationQueue;
}
