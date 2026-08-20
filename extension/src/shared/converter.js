/**
 * Local browser-extension converter primitives.
 *
 * This module deliberately knows nothing about Chrome runtime messages, native
 * executables, PATH, a loopback service, or a cloud converter.  The only
 * enabled adapters are implemented here with browser-core byte APIs and are
 * safe to run entirely in an options page.
 */

export const CONVERTER_SCHEMA_VERSION = 1;
export const CONVERTER_PACKAGE_PROOF = "extension/src/shared/converter.js";
export const CONVERTER_RUNTIME_CAPABILITY = "browser-core";

export const CONVERTER_REQUIRED_CATEGORIES = Object.freeze([
  "documents-pdf",
  "images",
  "audio",
  "video",
  "archives",
  "structured-data-spreadsheets",
  "code-text",
  "binary-encodings",
]);

export const CONVERTER_LIMITS = Object.freeze({
  signatureBytes: 4 * 1024,
  // Hex expands each input byte to two output bytes. Keeping this at 6 MiB
  // means every bundled adapter remains inside the shared 12 MiB output cap.
  inputBytes: 6 * 1024 * 1024,
  outputBytes: 12 * 1024 * 1024,
  chunkBytes: 64 * 1024,
  catalogQueryChars: 256,
  adapterIdChars: 96,
});

export const CONVERTER_OUTCOME_CODES = Object.freeze([
  "queued",
  "processing",
  "paused",
  "converted",
  "cancelled",
  "failed",
  "skipped",
  "needs-reselection",
  "unsupported-source",
  "adapter-unavailable",
  "validation-failed",
]);

const OUTCOME_CODES_BY_PHASE = Object.freeze({
  queued: new Set(["queued"]),
  processing: new Set(["processing"]),
  paused: new Set(["paused"]),
  converted: new Set(["converted"]),
  cancelled: new Set(["cancelled"]),
  failed: new Set(["failed", "unsupported-source", "adapter-unavailable", "validation-failed"]),
  skipped: new Set(["skipped"]),
  "needs-reselection": new Set(["needs-reselection"]),
});

const CONVERTER_OUTCOME_KEYS = Object.freeze([
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

const CATEGORY_DEFINITIONS = Object.freeze([
  {
    id: "documents-pdf",
    label: "Documents/PDF",
    description: "Inspect and transform documents only when an offline parser and post-write validator are packaged.",
  },
  {
    id: "images",
    label: "Images",
    description: "Image transcodes require a packaged, resource-bounded decoder and encoder.",
  },
  {
    id: "audio",
    label: "Audio",
    description: "Audio transcodes require a packaged offline codec and output validator.",
  },
  {
    id: "video",
    label: "Video",
    description: "Video transcodes require a packaged offline codec and output validator.",
  },
  {
    id: "archives",
    label: "Archives",
    description: "Archive changes require a packaged parser, encoder, and traversal-safe validator.",
  },
  {
    id: "structured-data-spreadsheets",
    label: "Structured Data/Spreadsheets",
    description: "Structured data conversion requires a packaged bounded parser and serializer.",
  },
  {
    id: "code-text",
    label: "Code/Text",
    description: "Encoding-sensitive text conversion requires a packaged parser and explicit loss disclosure.",
  },
  {
    id: "binary-encodings",
    label: "Binary Encodings",
    description: "Small lossless byte encodings are implemented locally in the extension bundle.",
  },
]);

const UNAVAILABLE_ADAPTERS = Object.freeze([
  unavailableAdapter("documents.pdf.tools", "documents-pdf", "PDF inspect, split, merge, extract, reorder, rotate, and metadata tools", "No bundled offline PDF parser, writer, and post-write page/metadata validator are packaged in this extension."),
  unavailableAdapter("images.transcode", "images", "Image transcode", "No bundled offline image transcoder is packaged in this extension."),
  unavailableAdapter("audio.transcode", "audio", "Audio transcode", "No bundled offline audio codec is packaged in this extension."),
  unavailableAdapter("video.transcode", "video", "Video transcode", "No bundled offline video codec is packaged in this extension."),
  unavailableAdapter("archives.transform", "archives", "Archive create and extract", "No bundled archive parser, encoder, or traversal-safe validator is packaged in this extension."),
  unavailableAdapter("structured-data.convert", "structured-data-spreadsheets", "Structured data and spreadsheet conversion", "No bundled bounded structured-data or spreadsheet adapter is packaged in this extension."),
  unavailableAdapter("code-text.convert", "code-text", "Encoding-safe text conversion", "No bundled encoding-safe text parser and serializer is packaged in this extension."),
]);

const ENABLED_ADAPTERS = Object.freeze([
  bundledAdapter({
    id: "binary.base64.encode",
    label: "Bytes to Base64 text",
    target: { mime: "text/plain", extension: "base64.txt", encoding: "US-ASCII" },
    sourceKinds: ["any-binary"],
    lossiness: "lossless",
    direction: "encode-base64",
  }),
  bundledAdapter({
    id: "binary.hex.encode",
    label: "Bytes to hexadecimal text",
    target: { mime: "text/plain", extension: "hex.txt", encoding: "US-ASCII" },
    sourceKinds: ["any-binary"],
    lossiness: "lossless",
    direction: "encode-hex",
  }),
  bundledAdapter({
    id: "binary.base64.decode",
    label: "Base64 text to bytes",
    target: { mime: "application/octet-stream", extension: "bin" },
    sourceKinds: ["utf8-text", "base64-text"],
    lossiness: "lossless",
    direction: "decode-base64",
  }),
  bundledAdapter({
    id: "binary.hex.decode",
    label: "Hexadecimal text to bytes",
    target: { mime: "application/octet-stream", extension: "bin" },
    sourceKinds: ["utf8-text", "hex-text"],
    lossiness: "lossless",
    direction: "decode-hex",
  }),
]);

const ADAPTERS = Object.freeze([...UNAVAILABLE_ADAPTERS, ...ENABLED_ADAPTERS]);
const ADAPTERS_BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Map([...BASE64_ALPHABET].map((character, index) => [character, index]));
const HEX_LOOKUP = new Map([..."0123456789abcdef"].map((character, index) => [character, index]));

export class ConverterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConverterError";
    this.code = code;
  }
}

function unavailableAdapter(id, category, label, unavailableReason) {
  return {
    id,
    category,
    label,
    sourceKinds: ["unavailable"],
    target: null,
    lossiness: "not-available",
    availability: {
      bundled: false,
      offline: false,
      packageProof: null,
      runtimeCapability: "not-bundled",
      unavailableReason,
    },
    limits: null,
    sandbox: "not-available",
    direction: "unavailable",
  };
}

function bundledAdapter({ id, label, target, sourceKinds, lossiness, direction }) {
  return {
    id,
    category: "binary-encodings",
    label,
    sourceKinds,
    target,
    lossiness,
    availability: {
      bundled: true,
      offline: true,
      packageProof: CONVERTER_PACKAGE_PROOF,
      runtimeCapability: CONVERTER_RUNTIME_CAPABILITY,
      unavailableReason: null,
    },
    limits: {
      inputBytes: CONVERTER_LIMITS.inputBytes,
      outputBytes: CONVERTER_LIMITS.outputBytes,
      chunkBytes: CONVERTER_LIMITS.chunkBytes,
    },
    sandbox: "options-page-local-only",
    direction,
  };
}

function cloneCatalogValue(value) {
  if (Array.isArray(value)) return value.map(cloneCatalogValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneCatalogValue(child)]));
}

function adapterRuntimeSupported(runtime = globalThis) {
  return Boolean(
    runtime
    && typeof runtime.Blob === "function"
    && typeof runtime.TextEncoder === "function"
    && typeof runtime.TextDecoder === "function"
    && typeof runtime.Uint8Array === "function",
  );
}

function isKnownCategory(category) {
  return CONVERTER_REQUIRED_CATEGORIES.includes(category);
}

function adapterManifestProblems(adapter, runtime) {
  const problems = [];
  if (!adapter || typeof adapter !== "object") return ["The adapter definition is missing."];
  if (typeof adapter.id !== "string" || !/^[a-z0-9][a-z0-9.-]{1,95}$/u.test(adapter.id)) problems.push("The adapter identifier is invalid.");
  if (!isKnownCategory(adapter.category)) problems.push("The adapter category is not part of the required catalog.");
  const availability = adapter.availability;
  if (!availability || typeof availability !== "object") return [...problems, "The adapter availability record is missing."];
  if (availability.bundled !== true) problems.push(availability.unavailableReason || "This adapter is not bundled in the extension package.");
  if (availability.offline !== true) problems.push(availability.unavailableReason || "This adapter is not available offline.");
  if (availability.packageProof !== CONVERTER_PACKAGE_PROOF) problems.push("The adapter has no matching packaged-artifact proof.");
  if (availability.runtimeCapability !== CONVERTER_RUNTIME_CAPABILITY) problems.push(availability.unavailableReason || "This adapter requires an unsupported runtime capability.");
  if (!adapterRuntimeSupported(runtime)) problems.push("This browser does not expose the bounded Blob and text APIs required by this adapter.");
  if (!adapter.target || typeof adapter.target.mime !== "string" || typeof adapter.target.extension !== "string") problems.push("The adapter target metadata is incomplete.");
  if (!Array.isArray(adapter.sourceKinds) || adapter.sourceKinds.length === 0) problems.push("The adapter source compatibility metadata is incomplete.");
  if (!adapter.limits || adapter.limits.inputBytes !== CONVERTER_LIMITS.inputBytes || adapter.limits.outputBytes !== CONVERTER_LIMITS.outputBytes || adapter.limits.chunkBytes !== CONVERTER_LIMITS.chunkBytes) problems.push("The adapter resource limits are not the bundled limits.");
  if (adapter.sandbox !== "options-page-local-only") problems.push("The adapter does not declare the local options-page sandbox boundary.");
  return problems;
}

/**
 * Derive availability; never trust an `enabled` field supplied by a caller or
 * an adapter definition.  This is intentionally exported for negative tests.
 */
export function resolveAdapterAvailability(adapter, { runtime = globalThis } = {}) {
  const reasons = adapterManifestProblems(adapter, runtime);
  return Object.freeze({
    enabled: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

function publicAdapter(adapter, runtime) {
  const availability = resolveAdapterAvailability(adapter, { runtime });
  return Object.freeze({
    id: adapter.id,
    category: adapter.category,
    label: adapter.label,
    sourceKinds: Object.freeze([...adapter.sourceKinds]),
    target: cloneCatalogValue(adapter.target),
    lossiness: adapter.lossiness,
    limits: cloneCatalogValue(adapter.limits),
    sandbox: adapter.sandbox,
    availability: Object.freeze({
      bundled: adapter.availability.bundled === true,
      offline: adapter.availability.offline === true,
      packageProof: adapter.availability.packageProof ?? null,
      runtimeCapability: adapter.availability.runtimeCapability,
      unavailableReason: adapter.availability.unavailableReason ?? null,
      enabled: availability.enabled,
      reasons: availability.reasons,
    }),
  });
}

/**
 * Return every required category even if none of its adapters are currently
 * capable. Disabled records are visible rather than silently omitted.
 */
export function converterCatalog({ runtime = globalThis } = {}) {
  return CATEGORY_DEFINITIONS.map((category) => Object.freeze({
    ...category,
    adapters: Object.freeze(ADAPTERS.filter((adapter) => adapter.category === category.id).map((adapter) => publicAdapter(adapter, runtime))),
  }));
}

export function catalogSearchText(entry) {
  if (!entry || typeof entry !== "object") return "";
  const values = [entry.label, entry.description, entry.id, entry.category, entry.lossiness];
  if (entry.target) values.push(entry.target.mime, entry.target.extension, entry.target.encoding);
  if (entry.availability) values.push(entry.availability.unavailableReason, ...(entry.availability.reasons ?? []));
  return values.filter((value) => typeof value === "string").join(" ");
}

/**
 * The UI owns the regex engine. It passes a validated predicate so every
 * catalog/category search can keep its own anchored regex-builder state.
 */
export function filterConverterCatalog(catalog, { query = "", predicate = null } = {}) {
  const normalized = String(query ?? "").trim().slice(0, CONVERTER_LIMITS.catalogQueryChars).toLocaleLowerCase();
  const matches = typeof predicate === "function"
    ? predicate
    : (value) => !normalized || value.toLocaleLowerCase().includes(normalized);
  return (Array.isArray(catalog) ? catalog : []).map((category) => ({
    ...category,
    adapters: (category.adapters ?? []).filter((adapter) => matches(`${catalogSearchText(category)} ${catalogSearchText(adapter)}`)),
  })).filter((category) => category.adapters.length > 0);
}

export function getAdapter(adapterId) {
  const id = String(adapterId ?? "");
  const adapter = ADAPTERS_BY_ID.get(id);
  if (!adapter) throw new ConverterError("adapter-unknown", "The selected converter adapter is not registered.");
  return adapter;
}

function bytePrefixEquals(bytes, values) {
  return values.every((value, index) => bytes[index] === value);
}

function printableText(bytes) {
  if (bytes.length === 0) return { text: "", valid: true };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const controls = [...text].filter((character) => {
      const code = character.codePointAt(0);
      return code !== 9 && code !== 10 && code !== 13 && code < 32;
    }).length;
    return { text, valid: !text.includes("\u0000") && controls <= Math.max(1, Math.floor(text.length * 0.02)) };
  } catch {
    return { text: "", valid: false };
  }
}

function identifyBytes(bytes) {
  if (bytePrefixEquals(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf", category: "documents-pdf", mime: "application/pdf" };
  if (bytePrefixEquals(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png", category: "images", mime: "image/png" };
  if (bytePrefixEquals(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg", category: "images", mime: "image/jpeg" };
  if (bytePrefixEquals(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "gif", category: "images", mime: "image/gif" };
  if (bytePrefixEquals(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { kind: "webp", category: "images", mime: "image/webp" };
  if (bytePrefixEquals(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytePrefixEquals(bytes, [0x50, 0x4b, 0x05, 0x06]) || bytePrefixEquals(bytes, [0x50, 0x4b, 0x07, 0x08])) return { kind: "zip", category: "archives", mime: "application/zip" };
  if (bytePrefixEquals(bytes, [0x1f, 0x8b, 0x08])) return { kind: "gzip", category: "archives", mime: "application/gzip" };
  if (bytePrefixEquals(bytes, [0x66, 0x4c, 0x61, 0x43])) return { kind: "flac", category: "audio", mime: "audio/flac" };
  if (bytePrefixEquals(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE") return { kind: "wav", category: "audio", mime: "audio/wav" };
  if (bytePrefixEquals(bytes, [0x49, 0x44, 0x33])) return { kind: "mp3", category: "audio", mime: "audio/mpeg" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return { kind: "isobmff", category: "video", mime: "video/mp4" };

  const text = printableText(bytes);
  if (text.valid) {
    const compact = text.text.replace(/[\t\n\r ]/gu, "");
    if (compact.length > 0 && /^[0-9a-fA-F]+$/u.test(compact) && compact.length % 2 === 0) return { kind: "hex-text", category: "binary-encodings", mime: "text/plain" };
    if (compact.length > 0 && isStrictBase64(compact)) return { kind: "base64-text", category: "binary-encodings", mime: "text/plain" };
    return { kind: "utf8-text", category: "code-text", mime: "text/plain" };
  }
  return { kind: "unknown-binary", category: "binary-encodings", mime: "application/octet-stream" };
}

function boundedSize(value, label) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new ConverterError("source-invalid", `${label} does not expose a safe byte size.`);
  return size;
}

function assertBlobLike(value, runtime, label = "The source") {
  if (!runtime || typeof runtime.Blob !== "function" || !(value instanceof runtime.Blob)) {
    throw new ConverterError("source-invalid", `${label} must be a browser Blob or File selected in this extension page.`);
  }
  const size = boundedSize(value?.size, label);
  if (typeof value?.slice !== "function") throw new ConverterError("source-invalid", `${label} does not support bounded slices.`);
  return size;
}

async function readBoundedSlice(source, start, end, runtime) {
  // Invoke the native Blob implementation directly. A forged or overridden
  // `slice` method must not run before this bounded-read Chong Leung.
  const slice = runtime.Blob.prototype.slice.call(source, start, end);
  const expected = Math.max(0, end - start);
  // A native Blob's size constrains the allocation performed by arrayBuffer().
  // Reject a forged or oversized slice *before* reading it; accepting a
  // duck-typed object and checking only after arrayBuffer() would already have
  // paid the unbounded allocation we are trying to prevent.
  assertBlobLike(slice, runtime, "A selected source slice");
  if (slice.size !== expected) throw new ConverterError("source-invalid", "A source slice did not match the requested byte boundary.");
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== expected) throw new ConverterError("source-invalid", "A native source slice did not return its declared byte count.");
  return bytes;
}

export async function sniffFileType(file, { signatureBytes = CONVERTER_LIMITS.signatureBytes, runtime = globalThis } = {}) {
  const size = assertBlobLike(file, runtime, "The selected source");
  const limit = Math.min(CONVERTER_LIMITS.signatureBytes, Math.max(1, Number(signatureBytes) || CONVERTER_LIMITS.signatureBytes));
  const inspectedBytes = Math.min(size, limit);
  const prefix = await readBoundedSlice(file, 0, inspectedBytes, runtime);
  const identified = identifyBytes(prefix);
  return Object.freeze({
    ...identified,
    confidence: identified.kind === "unknown-binary" ? "unknown" : "signature",
    inspectedBytes,
    sourceBytes: size,
  });
}

async function* sourceChunks(source, {
  chunkBytes = CONVERTER_LIMITS.chunkBytes,
  maxBytes = CONVERTER_LIMITS.inputBytes,
  signal,
  onProgress,
  runtime = globalThis,
  waitForResume = null,
} = {}) {
  const size = assertBlobLike(source, runtime, "The selected source");
  const safeMaximum = Math.max(0, Number(maxBytes) || 0);
  if (size > safeMaximum) throw new ConverterError("source-too-large", `The selected source exceeds the ${safeMaximum}-byte local adapter limit.`);
  const chunkSize = Math.min(CONVERTER_LIMITS.chunkBytes, Math.max(1, Number(chunkBytes) || CONVERTER_LIMITS.chunkBytes));
  let offset = 0;
  reportProgress(onProgress, 0, size);
  while (offset < size) {
    throwIfCancelled(signal);
    // The options surface owns the pause promise.  Check before every bounded
    // slice so pausing never asks the browser to read another input chunk.
    if (typeof waitForResume === "function") await waitForResume();
    throwIfCancelled(signal);
    const next = Math.min(size, offset + chunkSize);
    const bytes = await readBoundedSlice(source, offset, next, runtime);
    offset += bytes.byteLength;
    reportProgress(onProgress, offset, size);
    yield bytes;
  }
  throwIfCancelled(signal);
}

function reportProgress(onProgress, completedBytes, totalBytes) {
  if (typeof onProgress !== "function") return;
  onProgress(Object.freeze({
    completedBytes,
    totalBytes,
    ratio: totalBytes === 0 ? 1 : Math.min(1, completedBytes / totalBytes),
  }));
}

function throwIfCancelled(signal) {
  if (signal?.aborted || (typeof signal === "function" && signal())) {
    throw new ConverterError("cancelled", "The local conversion was cancelled before writing a final output.");
  }
}

function outputCollector(runtime, mime) {
  const parts = [];
  let byteLength = 0;
  const encoder = new runtime.TextEncoder();
  const add = (value, bytes) => {
    const next = byteLength + bytes;
    if (next > CONVERTER_LIMITS.outputBytes) throw new ConverterError("output-too-large", `The converted output exceeds the ${CONVERTER_LIMITS.outputBytes}-byte local adapter limit.`);
    parts.push(value);
    byteLength = next;
  };
  return {
    appendBytes(bytes) {
      const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
      add(copy, copy.byteLength);
    },
    appendAscii(text) {
      if (!/^[\x00-\x7f]*$/u.test(text)) throw new ConverterError("output-invalid", "A binary-encoding adapter attempted to emit non-ASCII text.");
      add(text, encoder.encode(text).byteLength);
    },
    get byteLength() { return byteLength; },
    blob() { return new runtime.Blob(parts, { type: mime }); },
  };
}

function fnvDigest() {
  let hash = 0xcbf29ce484222325n;
  let byteLength = 0;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  return {
    update(bytes) {
      for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = (hash * prime) & mask;
      }
      byteLength += bytes.byteLength;
    },
    value() { return Object.freeze({ byteLength, fnv1a64: hash.toString(16).padStart(16, "0") }); },
  };
}

function equalDigest(left, right) {
  return left?.byteLength === right?.byteLength && left?.fnv1a64 === right?.fnv1a64;
}

function bytesToBase64(bytes) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >>> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
    output += second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

function bytesToHex(bytes) {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function isStrictBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  if (value.endsWith("==")) return (BASE64_LOOKUP.get(value[value.length - 3]) & 0x0f) === 0;
  if (value.endsWith("=")) return (BASE64_LOOKUP.get(value[value.length - 2]) & 0x03) === 0;
  return true;
}

function base64ToBytes(value) {
  if (!isStrictBase64(value)) throw new ConverterError("source-invalid", "The selected Base64 text is malformed.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let destination = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_LOOKUP.get(value[index]);
    const second = BASE64_LOOKUP.get(value[index + 1]);
    const third = value[index + 2] === "=" ? 0 : BASE64_LOOKUP.get(value[index + 2]);
    const fourth = value[index + 3] === "=" ? 0 : BASE64_LOOKUP.get(value[index + 3]);
    if ([first, second, third, fourth].some((part) => part === undefined)) throw new ConverterError("source-invalid", "The selected Base64 text contains an unsupported character.");
    output[destination++] = (first << 2) | (second >>> 4);
    if (destination < output.length) output[destination++] = ((second & 0x0f) << 4) | (third >>> 2);
    if (destination < output.length) output[destination++] = ((third & 0x03) << 6) | fourth;
  }
  return output;
}

function hexToBytes(value) {
  if (!/^[0-9a-fA-F]*$/u.test(value) || value.length % 2 !== 0) throw new ConverterError("source-invalid", "The selected hexadecimal text is malformed.");
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const high = HEX_LOOKUP.get(value[index].toLowerCase());
    const low = HEX_LOOKUP.get(value[index + 1].toLowerCase());
    if (high === undefined || low === undefined) throw new ConverterError("source-invalid", "The selected hexadecimal text contains an unsupported character.");
    output[index / 2] = (high << 4) | low;
  }
  return output;
}

async function encodeBinary(source, collector, encoding, options) {
  const digest = fnvDigest();
  let remainder = new Uint8Array(0);
  for await (const chunk of sourceChunks(source, options)) {
    digest.update(chunk);
    const joined = new Uint8Array(remainder.length + chunk.length);
    joined.set(remainder);
    joined.set(chunk, remainder.length);
    const completeLength = encoding === "base64" ? joined.length - (joined.length % 3) : joined.length;
    if (completeLength > 0) collector.appendAscii(encoding === "base64" ? bytesToBase64(joined.slice(0, completeLength)) : bytesToHex(joined.slice(0, completeLength)));
    remainder = joined.slice(completeLength);
  }
  if (remainder.length > 0) collector.appendAscii(encoding === "base64" ? bytesToBase64(remainder) : bytesToHex(remainder));
  return { sourceDigest: digest.value() };
}

async function decodeText(source, collector, encoding, runtime, options) {
  const textDecoder = new runtime.TextDecoder("utf-8", { fatal: true });
  const digest = fnvDigest();
  let remainder = "";
  let sawBase64Padding = false;

  const consume = (text, final = false) => {
    const compact = text.replace(/[\t\n\r ]/gu, "");
    if (encoding === "base64") {
      for (const character of compact) {
        if (!BASE64_LOOKUP.has(character) && character !== "=") throw new ConverterError("source-invalid", "The selected Base64 text contains an unsupported character.");
        if (sawBase64Padding && character !== "=") throw new ConverterError("source-invalid", "Base64 padding may appear only at the end of the selected text.");
        if (character === "=") sawBase64Padding = true;
      }
      remainder += compact;
      if (!final && !sawBase64Padding) {
        const completeLength = Math.max(0, remainder.length - 4) - (Math.max(0, remainder.length - 4) % 4);
        if (completeLength > 0) {
          const bytes = base64ToBytes(remainder.slice(0, completeLength));
          collector.appendBytes(bytes);
          digest.update(bytes);
          remainder = remainder.slice(completeLength);
        }
      }
      if (final) {
        if (!isStrictBase64(remainder)) throw new ConverterError("source-invalid", "The selected Base64 text is malformed.");
        if (remainder) {
          const bytes = base64ToBytes(remainder);
          collector.appendBytes(bytes);
          digest.update(bytes);
        }
      }
      return;
    }

    if (!/^[0-9a-fA-F]*$/u.test(compact)) throw new ConverterError("source-invalid", "The selected hexadecimal text contains an unsupported character.");
    remainder += compact;
    const completeLength = final ? remainder.length : remainder.length - (remainder.length % 2);
    if (completeLength > 0) {
      const bytes = hexToBytes(remainder.slice(0, completeLength));
      collector.appendBytes(bytes);
      digest.update(bytes);
      remainder = remainder.slice(completeLength);
    }
    if (final && remainder.length !== 0) throw new ConverterError("source-invalid", "Hexadecimal text needs a complete pair of characters for every byte.");
  };

  try {
    for await (const chunk of sourceChunks(source, options)) {
      throwIfCancelled(options.signal);
      consume(textDecoder.decode(chunk, { stream: true }));
    }
    consume(textDecoder.decode(), true);
  } catch (error) {
    if (error instanceof ConverterError) throw error;
    throw new ConverterError("source-invalid", "The selected text is not valid UTF-8 for this local adapter.");
  }
  return { decodedDigest: digest.value() };
}

async function digestBinary(source, options) {
  const digest = fnvDigest();
  for await (const chunk of sourceChunks(source, options)) digest.update(chunk);
  return digest.value();
}

async function digestDecodedText(source, encoding, runtime, options) {
  const collector = { appendBytes() {} };
  return (await decodeText(source, collector, encoding, runtime, options)).decodedDigest;
}

async function validateOutput(output, direction, expectedDigest, runtime, options) {
  try {
    assertBlobLike(output, runtime, "The local adapter output");
  } catch {
    throw new ConverterError("validation-failed", "The local adapter did not produce a readable output blob.");
  }
  if (typeof options.expectedMime === "string" && output.type !== options.expectedMime) throw new ConverterError("validation-failed", "The local adapter output MIME type did not match its registered target.");
  if (boundedSize(output.size, "The output") > CONVERTER_LIMITS.outputBytes) throw new ConverterError("validation-failed", "The output exceeded the adapter byte limit after conversion.");
  let observed;
  // Validation reopens the completed Blob through bounded slices. It must not
  // rewind the user-visible conversion progress indicator while doing so.
  const validationOptions = {
    signal: options.signal,
    chunkBytes: options.chunkBytes,
    maxBytes: CONVERTER_LIMITS.outputBytes,
    onProgress: null,
    waitForResume: options.waitForResume,
    runtime,
  };
  if (direction === "encode-base64") observed = await digestDecodedText(output, "base64", runtime, validationOptions);
  else if (direction === "encode-hex") observed = await digestDecodedText(output, "hex", runtime, validationOptions);
  else observed = await digestBinary(output, validationOptions);
  if (!equalDigest(expectedDigest, observed)) throw new ConverterError("validation-failed", "The post-write local round-trip validator did not match the selected source bytes.");
  return Object.freeze({ ok: true, digest: observed });
}

function adapterAcceptsSource(adapter, detected) {
  return adapter.sourceKinds.includes("any-binary") || adapter.sourceKinds.includes(detected.kind);
}

function sourceDescriptorFor(adapter, detected) {
  return Object.freeze({
    kind: detected.kind,
    category: detected.category,
    mime: detected.mime,
    compatible: adapterAcceptsSource(adapter, detected),
  });
}

/**
 * Convert a user-selected File/Blob locally. The caller owns the returned
 * Blob only in page memory; persistence helpers accept redacted outcomes, not
 * the File, Blob, filename, path, MIME claim, or source content.
 */
export async function convertLocalFile({
  file,
  adapterId,
  signal = null,
  onProgress = null,
  waitForResume = null,
  runtime = globalThis,
} = {}) {
  if (!adapterRuntimeSupported(runtime)) throw new ConverterError("runtime-unavailable", "This browser does not expose the bounded Blob and text APIs required for local conversion.");
  const adapter = getAdapter(adapterId);
  const availability = resolveAdapterAvailability(adapter, { runtime });
  if (!availability.enabled) throw new ConverterError("adapter-unavailable", availability.reasons[0] || "The selected adapter is unavailable.");
  const sourceBytes = assertBlobLike(file, runtime, "The selected source");
  if (sourceBytes > CONVERTER_LIMITS.inputBytes) throw new ConverterError("source-too-large", `The selected source exceeds the ${CONVERTER_LIMITS.inputBytes}-byte local adapter limit.`);
  const detected = await sniffFileType(file, { runtime });
  if (!adapterAcceptsSource(adapter, detected)) throw new ConverterError("unsupported-source", "The selected source type is not compatible with this local adapter.");
  const collector = outputCollector(runtime, adapter.target.mime);
  const options = { signal, onProgress, chunkBytes: adapter.limits.chunkBytes, waitForResume, runtime };
  let transformed;
  if (adapter.direction === "encode-base64") transformed = await encodeBinary(file, collector, "base64", options);
  else if (adapter.direction === "encode-hex") transformed = await encodeBinary(file, collector, "hex", options);
  else if (adapter.direction === "decode-base64") transformed = await decodeText(file, collector, "base64", runtime, options);
  else if (adapter.direction === "decode-hex") transformed = await decodeText(file, collector, "hex", runtime, options);
  else throw new ConverterError("adapter-unavailable", "The selected adapter does not have a local executable implementation.");
  throwIfCancelled(signal);
  const output = collector.blob();
  const expectedDigest = transformed.sourceDigest ?? transformed.decodedDigest;
  const validation = await validateOutput(output, adapter.direction, expectedDigest, runtime, {
    signal,
    chunkBytes: adapter.limits.chunkBytes,
    expectedMime: adapter.target.mime,
    waitForResume,
  });
  return Object.freeze({
    ok: true,
    code: "converted",
    adapter: publicAdapter(adapter, runtime),
    source: sourceDescriptorFor(adapter, detected),
    inputBytes: sourceBytes,
    outputBytes: output.size,
    output,
    validation,
    exportBoundary: converterExportBoundary(),
  });
}

/**
 * Describe the truthful export boundary without attempting to discover or
 * launch an editor. The options UI must feature-detect chrome.downloads at the
 * moment the user asks to export; no native-messaging or PATH route exists.
 */
export function converterExportBoundary({ downloadsApi = globalThis.chrome?.downloads, urlApi = globalThis.URL } = {}) {
  const browserDownloadEnabled = typeof downloadsApi?.download === "function" && typeof urlApi?.createObjectURL === "function";
  return Object.freeze({
    browserDownload: Object.freeze({
      enabled: browserDownloadEnabled,
      reason: browserDownloadEnabled
        ? null
        : "The browser download API is unavailable in this extension context, so a converted blob cannot be exported here.",
    }),
    openInEditor: Object.freeze({
      enabled: false,
      reason: "A browser extension cannot open a local editor without a bundled, user-authorized native integration.",
    }),
  });
}

/**
 * Create a redacted, persistable queue outcome. It intentionally rejects
 * source-identifying fields so no filename, path, Blob, File, MIME claim, or
 * content accidentally enters chrome.storage.local.
 */
export function makeConverterOutcome(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConverterError("outcome-invalid", "The converter queue outcome must be an object.");
  const unexpected = Object.keys(input).filter((key) => !CONVERTER_OUTCOME_KEYS.includes(key));
  if (unexpected.length > 0) throw new ConverterError("outcome-invalid", "The converter queue outcome contains unsupported fields.");
  const {
    schemaVersion = CONVERTER_SCHEMA_VERSION,
    id,
    adapterId,
    phase,
    inputBytes,
    outputBytes = null,
    code,
    at = new Date().toISOString(),
    attempt = 1,
  } = input;
  if (schemaVersion !== CONVERTER_SCHEMA_VERSION) throw new ConverterError("outcome-invalid", "The converter queue outcome schema version is unsupported.");
  const safeId = String(id ?? "");
  const safeAdapterId = String(adapterId ?? "");
  const safePhase = String(phase ?? "");
  const safeCode = String(code ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{7,95}$/u.test(safeId)) throw new ConverterError("outcome-invalid", "The converter queue record identifier is invalid.");
  if (!ADAPTERS_BY_ID.has(safeAdapterId)) throw new ConverterError("outcome-invalid", "The converter queue record references an unknown adapter.");
  if (!resolveAdapterAvailability(ADAPTERS_BY_ID.get(safeAdapterId)).enabled) throw new ConverterError("outcome-invalid", "The converter queue record references an unavailable adapter.");
  if (!["queued", "processing", "paused", "converted", "cancelled", "failed", "skipped", "needs-reselection"].includes(safePhase)) throw new ConverterError("outcome-invalid", "The converter queue phase is invalid.");
  if (!CONVERTER_OUTCOME_CODES.includes(safeCode)) throw new ConverterError("outcome-invalid", "The converter queue outcome code is invalid.");
  if (!OUTCOME_CODES_BY_PHASE[safePhase]?.has(safeCode)) throw new ConverterError("outcome-invalid", "The converter queue phase and outcome code do not agree.");
  const safeInputBytes = boundedSize(inputBytes, "The converter outcome input byte count");
  const safeOutputBytes = outputBytes === null ? null : boundedSize(outputBytes, "The converter outcome output byte count");
  if (safeInputBytes > CONVERTER_LIMITS.inputBytes) throw new ConverterError("outcome-invalid", "The converter queue input byte count exceeds the bundled adapter limit.");
  if (safeOutputBytes !== null && safeOutputBytes > CONVERTER_LIMITS.outputBytes) throw new ConverterError("outcome-invalid", "The converter queue output byte count exceeds the bundled adapter limit.");
  if (safePhase === "converted" && safeOutputBytes === null) throw new ConverterError("outcome-invalid", "A converted queue record requires a validated output byte count.");
  if (safePhase !== "converted" && safeOutputBytes !== null) throw new ConverterError("outcome-invalid", "Only a validated converted queue record may retain an output byte count.");
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1_000_000) throw new ConverterError("outcome-invalid", "The converter queue attempt number is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(String(at))) throw new ConverterError("outcome-invalid", "The converter outcome timestamp is invalid.");
  return Object.freeze({
    schemaVersion: CONVERTER_SCHEMA_VERSION,
    id: safeId,
    adapterId: safeAdapterId,
    phase: safePhase,
    inputBytes: safeInputBytes,
    outputBytes: safeOutputBytes,
    code: safeCode,
    at: String(at),
    attempt,
  });
}

export function outcomeFromConverterError(error) {
  const code = error instanceof ConverterError ? error.code : "failed";
  if (code === "cancelled") return "cancelled";
  if (code === "adapter-unavailable" || code === "runtime-unavailable") return "adapter-unavailable";
  if (code === "unsupported-source") return "unsupported-source";
  if (code === "validation-failed") return "validation-failed";
  return "failed";
}
