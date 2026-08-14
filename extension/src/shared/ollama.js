/**
 * Local-only Ollama suite for the Manifest V3 service worker.
 *
 * Every network request is derived from the documented loopback API root.  The
 * renderer never receives a fetch capability and no method accepts a URL, shell
 * command, executable path, environment value, or a cloud endpoint.
 */

import { ALLOWED_LOOPBACK_HOSTS } from "./settings.js";

export const OLLAMA_STATE_KEY = "ollamaSuite";
export const OLLAMA_SUITE_SCHEMA = "material-download-manager.extension.ollama";
export const OLLAMA_SUITE_VERSION = 1;
export const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
export const MAX_OLLAMA_RESPONSE_BYTES = 1_048_576;
export const MAX_OLLAMA_STREAM_EVENTS = 4_096;
export const MAX_OLLAMA_MODELS = 512;
export const MAX_OLLAMA_CART_ITEMS = 64;
export const MAX_OLLAMA_SESSIONS = 24;
export const MAX_OLLAMA_MESSAGES_PER_SESSION = 96;
export const MAX_OLLAMA_MESSAGE_CHARS = 16_384;
export const MAX_OLLAMA_SYSTEM_PROMPT_CHARS = 8_192;
export const MAX_OLLAMA_TITLE_CHARS = 120;
export const MAX_OLLAMA_STATE_BYTES = 2_000_000;
export const MAX_OLLAMA_ATTACHMENTS = 3;
export const MAX_OLLAMA_ATTACHMENT_BYTES = 1_048_576;
export const MAX_OLLAMA_PARALLEL_PULLS = 3;

const OLLAMA_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/u;
const OLLAMA_ID_PATTERN = /^[A-Za-z0-9_-]{12,96}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const SAFE_MODEL_CAPABILITIES = new Set(["completion", "tools", "vision", "thinking"]);
const SAFE_ATTACHMENT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SAFE_RUNTIME_STATUSES = new Set(["unknown", "healthy", "missing", "unhealthy", "offline"]);
const SAFE_PULL_STATUSES = new Set(["queued", "pulling", "pulled", "skipped", "cancelled", "failed", "interrupted"]);
const SAFE_CHAT_STATUSES = new Set(["complete", "streaming", "cancelled", "failed"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nowIso(now) {
  const value = now();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function boundedText(value, maxLength, { required = false, trim = true } = {}) {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = trim ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim() : value;
  return required && !normalized ? null : normalized;
}

function safeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

function safeIso(value) {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function stableId(prefix = "ollama") {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const body = [...bytes].map((value) => value.toString(36).padStart(2, "0")).join("").slice(0, 36);
  return `${prefix}_${body}`;
}

export function validateOllamaEndpoint(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw || raw.length > 256) return { valid: false, value: "", error: "Use the documented local Ollama endpoint on port 11434." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, value: "", error: "Use http://127.0.0.1:11434 or http://localhost:11434." };
  }
  if (url.protocol !== "http:" || !ALLOWED_LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return { valid: false, value: "", error: "Only plain HTTP on 127.0.0.1 or localhost is allowed." };
  }
  if (url.port !== "11434") return { valid: false, value: "", error: "The documented local Ollama API port is 11434." };
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return { valid: false, value: "", error: "Credentials, paths, query strings, and fragments are not allowed." };
  }
  return { valid: true, value: `http://${url.hostname.toLowerCase()}:11434`, error: null };
}

export function normalizeOllamaModelName(value) {
  const normalized = boundedText(value, 255, { required: true, trim: true });
  return normalized && OLLAMA_TAG_PATTERN.test(normalized) ? normalized : null;
}

function normalizeModelDetails(value) {
  const source = isRecord(value) ? value : {};
  const family = boundedText(source.family, 128);
  // Accept both the documented API shape and the normalized persisted shape.
  // The raw `model_info` record is never retained in extension storage.
  const parameterSize = boundedText(source.parameter_size ?? source.parameterSize, 128);
  const quantizationLevel = boundedText(source.quantization_level ?? source.quantizationLevel, 128);
  const families = Array.isArray(source.families)
    ? [...new Set(source.families.map((item) => boundedText(item, 128, { required: true })).filter(Boolean))].slice(0, 32)
    : [];
  return { family, families, parameterSize, quantizationLevel };
}

function normalizeModel(value, runningNames = null) {
  if (!isRecord(value)) return null;
  const name = normalizeOllamaModelName(value.name ?? value.model);
  if (!name) return null;
  const size = safeNumber(value.size, { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true });
  const digest = typeof value.digest === "string" && /^[A-Za-z0-9:_-]{8,256}$/u.test(value.digest) ? value.digest : null;
  const modifiedAt = safeIso(value.modified_at ?? value.modifiedAt) ?? null;
  const parameterCount = value.parameterCount === null || value.parameterCount === undefined
    ? null
    : safeNumber(value.parameterCount, { min: 1, integer: true });
  const contextWindow = value.contextWindow === null || value.contextWindow === undefined
    ? null
    : safeNumber(value.contextWindow, { min: 1, max: 1_000_000, integer: true });
  if ((value.parameterCount !== null && value.parameterCount !== undefined && parameterCount === null)
    || (value.contextWindow !== null && value.contextWindow !== undefined && contextWindow === null)) return null;
  const rawCapabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const capabilities = [...new Set(rawCapabilities.filter((item) => typeof item === "string" && SAFE_MODEL_CAPABILITIES.has(item)))].sort();
  return {
    name,
    size,
    digest,
    modifiedAt,
    details: normalizeModelDetails(value.details),
    parameterCount,
    contextWindow,
    capabilities,
    // `/api/tags` and `/api/ps` derive this field on refresh. Persisted state
    // retains the last verified value so a service-worker restart does not
    // erase the visible running-state evidence before the next refresh.
    running: runningNames instanceof Set ? runningNames.has(name) : value.running === true,
  };
}

function normalizeRuntime(value) {
  if (!isRecord(value) || !SAFE_RUNTIME_STATUSES.has(value.status)) return null;
  const checkedAt = value.checkedAt === null ? null : safeIso(value.checkedAt);
  if (value.checkedAt !== null && !checkedAt) return null;
  const version = value.version === null ? null : boundedText(value.version, 128, { required: true });
  const detail = value.detail === null ? null : boundedText(value.detail, 240, { required: true });
  if ((value.version !== null && !version) || (value.detail !== null && !detail)) return null;
  return { status: value.status, checkedAt, version, detail };
}

function normalizeCartItem(value) {
  if (!isRecord(value) || !OLLAMA_ID_PATTERN.test(value.id ?? "")) return null;
  const model = normalizeOllamaModelName(value.model);
  const status = SAFE_PULL_STATUSES.has(value.status) ? value.status : null;
  const createdAt = safeIso(value.createdAt);
  const updatedAt = safeIso(value.updatedAt);
  if (!model || !status || !createdAt || !updatedAt) return null;
  const total = value.total === null ? null : safeNumber(value.total, { min: 0, integer: true });
  const completed = value.completed === null ? null : safeNumber(value.completed, { min: 0, integer: true });
  if ((value.total !== null && total === null) || (value.completed !== null && completed === null) || (total !== null && completed !== null && completed > total)) return null;
  const detail = value.detail === null ? null : boundedText(value.detail, 240, { required: true });
  if (value.detail !== null && !detail) return null;
  return { id: value.id, model, status, createdAt, updatedAt, total, completed, detail };
}

function normalizeMessage(value) {
  if (!isRecord(value) || !["user", "assistant", "system"].includes(value.role) || !SAFE_CHAT_STATUSES.has(value.status)) return null;
  const content = boundedText(value.content, MAX_OLLAMA_MESSAGE_CHARS, { required: false, trim: false });
  const at = safeIso(value.at);
  if (content === null || !at) return null;
  return { role: value.role, content, status: value.status, at };
}

function normalizeSession(value) {
  if (!isRecord(value) || !OLLAMA_ID_PATTERN.test(value.id ?? "")) return null;
  const model = normalizeOllamaModelName(value.model);
  const title = boundedText(value.title, MAX_OLLAMA_TITLE_CHARS, { required: true });
  const systemPrompt = boundedText(value.systemPrompt, MAX_OLLAMA_SYSTEM_PROMPT_CHARS, { required: false, trim: false });
  const createdAt = safeIso(value.createdAt);
  const updatedAt = safeIso(value.updatedAt);
  if (!model || !title || systemPrompt === null || !createdAt || !updatedAt || !Array.isArray(value.messages) || value.messages.length > MAX_OLLAMA_MESSAGES_PER_SESSION) return null;
  const messages = value.messages.map(normalizeMessage);
  if (messages.some((item) => item === null)) return null;
  return { id: value.id, model, title, systemPrompt, createdAt, updatedAt, messages };
}

function stateByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertStateWithinStorageBudget(state) {
  if (stateByteLength(state) > MAX_OLLAMA_STATE_BYTES) {
    throw new OllamaError("ollama-storage-full", "Local chat and pull history reached the extension storage safety budget. Export or remove a chat before adding more content.");
  }
}

function defaultState(now = () => new Date()) {
  return {
    schema: OLLAMA_SUITE_SCHEMA,
    version: OLLAMA_SUITE_VERSION,
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    pullParallelism: 1,
    runtime: { status: "unknown", checkedAt: null, version: null, detail: null },
    installed: [],
    catalog: {
      source: "local-api-installed-tags-only",
      refreshedAt: null,
      verifiedEndpoint: null,
      pageCount: 0,
      revision: null,
      complete: false,
      reason: "A browser extension cannot enumerate the official remote catalog without adding a remote source, so only verified local tags are shown.",
    },
    hardware: {
      source: "browser-boundary",
      observedAt: null,
      ramBytes: null,
      gpu: null,
      vramBytes: null,
      driver: null,
      freeDiskBytes: null,
      reason: "The browser extension has no trusted local hardware or free-disk inspector.",
    },
    cart: [],
    sessions: [],
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  };
}

function normalizeState(value) {
  if (!isRecord(value) || value.schema !== OLLAMA_SUITE_SCHEMA || value.version !== OLLAMA_SUITE_VERSION) return null;
  const endpoint = validateOllamaEndpoint(value.endpoint);
  const pullParallelism = safeNumber(value.pullParallelism, { min: 1, max: MAX_OLLAMA_PARALLEL_PULLS, integer: true });
  const runtime = normalizeRuntime(value.runtime);
  if (!endpoint.valid || !pullParallelism || !runtime || !Array.isArray(value.installed) || value.installed.length > MAX_OLLAMA_MODELS || !Array.isArray(value.cart) || value.cart.length > MAX_OLLAMA_CART_ITEMS || !Array.isArray(value.sessions) || value.sessions.length > MAX_OLLAMA_SESSIONS) return null;
  if (!isRecord(value.catalog) || value.catalog.source !== "local-api-installed-tags-only" || typeof value.catalog.complete !== "boolean" || value.catalog.complete !== false) return null;
  const refreshedAt = value.catalog.refreshedAt === null ? null : safeIso(value.catalog.refreshedAt);
  const verifiedEndpoint = value.catalog.verifiedEndpoint === null
    ? null
    : validateOllamaEndpoint(value.catalog.verifiedEndpoint);
  const revision = value.catalog.revision === null ? null : boundedText(value.catalog.revision, 256, { required: true });
  const pageCount = safeNumber(value.catalog.pageCount, { min: 0, max: 1, integer: true });
  const catalogReason = boundedText(value.catalog.reason, 512, { required: true });
  if ((value.catalog.refreshedAt !== null && !refreshedAt) || (value.catalog.verifiedEndpoint !== null && !verifiedEndpoint?.valid) || (value.catalog.revision !== null && !revision) || pageCount === null || !catalogReason) return null;
  if (!isRecord(value.hardware) || value.hardware.source !== "browser-boundary") return null;
  const observedAt = value.hardware.observedAt === null ? null : safeIso(value.hardware.observedAt);
  const hardwareReason = boundedText(value.hardware.reason, 512, { required: true });
  if ((value.hardware.observedAt !== null && !observedAt) || !hardwareReason) return null;
  const installed = value.installed.map((item) => normalizeModel(item));
  const cart = value.cart.map(normalizeCartItem);
  const sessions = value.sessions.map(normalizeSession);
  if (installed.some((item) => item === null) || cart.some((item) => item === null) || sessions.some((item) => item === null)) return null;
  if (new Set(installed.map((item) => item.name)).size !== installed.length || new Set(cart.map((item) => item.id)).size !== cart.length || new Set(sessions.map((item) => item.id)).size !== sessions.length) return null;
  const createdAt = safeIso(value.createdAt);
  const updatedAt = safeIso(value.updatedAt);
  if (!createdAt || !updatedAt) return null;
  const normalized = {
    schema: OLLAMA_SUITE_SCHEMA,
    version: OLLAMA_SUITE_VERSION,
    endpoint: endpoint.value,
    pullParallelism,
    runtime,
    installed,
    catalog: { source: value.catalog.source, refreshedAt, verifiedEndpoint: verifiedEndpoint?.value ?? null, pageCount, revision, complete: false, reason: catalogReason },
    hardware: { source: "browser-boundary", observedAt, ramBytes: null, gpu: null, vramBytes: null, driver: null, freeDiskBytes: null, reason: hardwareReason },
    cart,
    sessions,
    createdAt,
    updatedAt,
  };
  try { assertStateWithinStorageBudget(normalized); } catch { return null; }
  return normalized;
}

function sanitizeError(error, fallback = "The local Ollama request did not complete.") {
  if (error instanceof OllamaError) return error;
  if (error?.name === "AbortError") return new OllamaError("ollama-request-timeout", "The local Ollama request timed out.");
  return new OllamaError("ollama-request-failed", fallback);
}

export class OllamaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
  }
}

async function readBoundedText(response, maximumBytes = MAX_OLLAMA_RESPONSE_BYTES) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new OllamaError("ollama-response-too-large", "The local response exceeded the safety limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new OllamaError("ollama-response-too-large", "The local response exceeded the safety limit.");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.byteLength; });
  return new TextDecoder().decode(joined);
}

async function readNdjson(response, onEvent, { signal } = {}) {
  if (!response.body?.getReader) {
    const text = await readBoundedText(response);
    const lines = text.split(/\r?\n/u).filter(Boolean);
    if (lines.length > MAX_OLLAMA_STREAM_EVENTS) throw new OllamaError("ollama-stream-too-large", "The local stream emitted too many events.");
    for (const line of lines) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { throw new OllamaError("ollama-stream-invalid", "The local stream contained invalid JSON."); }
      await onEvent(parsed);
    }
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let bytes = 0;
  let events = 0;
  const abortReader = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener?.("abort", abortReader, { once: true });
  if (signal?.aborted) abortReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_OLLAMA_RESPONSE_BYTES) throw new OllamaError("ollama-response-too-large", "The local stream exceeded the safety limit.");
      buffered += decoder.decode(item.value, { stream: true });
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        events += 1;
        if (events > MAX_OLLAMA_STREAM_EVENTS) throw new OllamaError("ollama-stream-too-large", "The local stream emitted too many events.");
        let parsed;
        try { parsed = JSON.parse(line); } catch { throw new OllamaError("ollama-stream-invalid", "The local stream contained invalid JSON."); }
        await onEvent(parsed);
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) {
      events += 1;
      if (events > MAX_OLLAMA_STREAM_EVENTS) throw new OllamaError("ollama-stream-too-large", "The local stream emitted too many events.");
      let parsed;
      try { parsed = JSON.parse(buffered); } catch { throw new OllamaError("ollama-stream-invalid", "The local stream contained invalid JSON."); }
      await onEvent(parsed);
    }
  } finally {
    signal?.removeEventListener?.("abort", abortReader);
    reader.releaseLock?.();
  }
}

function modelForFit(model) {
  return isRecord(model) ? {
    size: safeNumber(model.size, { min: 1, integer: true }),
    parameterCount: safeNumber(model.parameterCount, { min: 1, integer: true }),
    quantizationLevel: boundedText(model.details?.quantizationLevel ?? model.quantizationLevel, 128),
    contextWindow: safeNumber(model.contextWindow, { min: 1, max: 1_000_000, integer: true }),
  } : null;
}

/** A deterministic evaluator for evidence supplied by a trusted host integration. */
export function computeHardwareFit(model, evidence) {
  const candidate = modelForFit(model);
  const source = isRecord(evidence) ? evidence : {};
  const ramBytes = safeNumber(source.ramBytes, { min: 1, integer: true });
  const vramBytes = safeNumber(source.vramBytes, { min: 1, integer: true });
  const freeDiskBytes = safeNumber(source.freeDiskBytes, { min: 1, integer: true });
  const driverSupported = source.driverSupported === true || source.driverSupported === false ? source.driverSupported : null;
  const contextOverheadBytes = safeNumber(source.contextOverheadBytes, { min: 0, integer: true });
  const reasons = [];
  if (!candidate?.size) reasons.push("Exact model blob size is unavailable.");
  if (!candidate?.parameterCount) reasons.push("Exact published parameter-count metadata is unavailable.");
  if (!candidate?.quantizationLevel) reasons.push("Published quantization metadata is unavailable.");
  if (!candidate?.contextWindow || contextOverheadBytes === null) reasons.push("Context-window overhead is unavailable.");
  if (!ramBytes) reasons.push("System RAM evidence is unavailable.");
  if (!vramBytes) reasons.push("Usable GPU VRAM evidence is unavailable.");
  if (driverSupported === null) reasons.push("GPU driver/backend evidence is unavailable.");
  if (!freeDiskBytes) reasons.push("Free destination disk evidence is unavailable.");
  if (reasons.length) return { verdict: "Unknown", reasons, assumptions: [] };
  const runtimeNeed = candidate.size + contextOverheadBytes;
  const diskNeed = Math.ceil(candidate.size * 1.15);
  if (driverSupported === false || freeDiskBytes < candidate.size || ramBytes < candidate.size * 0.5 || vramBytes < candidate.size * 0.2) {
    return { verdict: "Unlikely", reasons: ["Available disk, RAM, VRAM, or backend support is below the conservative minimum."], assumptions: [`Runtime estimate ${runtimeNeed} bytes; disk estimate ${diskNeed} bytes.`] };
  }
  if (freeDiskBytes < diskNeed || ramBytes < runtimeNeed || vramBytes < runtimeNeed * 0.45) {
    return { verdict: "Runs with limits", reasons: ["The model may run only with reduced context, slower execution, or constrained concurrency."], assumptions: [`Runtime estimate ${runtimeNeed} bytes; disk estimate ${diskNeed} bytes.`] };
  }
  return { verdict: "Runs well", reasons: ["All supplied evidence clears the conservative model, context, disk, RAM, VRAM, and backend thresholds."], assumptions: [`Runtime estimate ${runtimeNeed} bytes; disk estimate ${diskNeed} bytes.`] };
}

function redactedText(value) {
  return String(value ?? "")
    // Header forms, credential-like keys, and common token assignments are
    // withheld even when users paste them as prose in a local chat.
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*bearer\s+[^\s,;]+/giu, "[redacted authorization]")
    .replace(/\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/giu, "[redacted cookie]")
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|credential|session|cookie)\b\s*[:=]\s*[^\s,;]+/giu, "[redacted secret]")
    .replace(/\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/giu, "[redacted secret]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu, "[redacted token]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[redacted token]")
    .replace(/(?:[A-Za-z]:\\|\\\\[^\\/]+\\[^\\/]+\\|\/(?:Users|home|private|var|etc|tmp)\/)[^\s"']+/giu, "[redacted local path]")
    .replace(/(?:^|\s)[A-Za-z_][A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key|credential|session|cookie)=[^\s]+/gimu, " [redacted environment]");
}

export function createRedactedChatExport(session) {
  const safe = normalizeSession(session);
  if (!safe) throw new OllamaError("ollama-chat-not-found", "The selected local chat is unavailable.");
  return {
    schema: "material-download-manager.extension.ollama-chat-export",
    version: 1,
    redaction: "Potential secrets, credentials, local paths, environment values, and attachments are omitted or redacted.",
    attachmentsOmitted: true,
    session: {
      id: safe.id,
      model: safe.model,
      title: redactedText(safe.title),
      createdAt: safe.createdAt,
      updatedAt: safe.updatedAt,
      systemPrompt: redactedText(safe.systemPrompt),
      messages: safe.messages.map((message) => ({ role: message.role, status: message.status, at: message.at, content: redactedText(message.content) })),
    },
  };
}

function normalizedChatOptions(value) {
  if (value === undefined) return { temperature: 0.7, numCtx: 4096 };
  if (!isRecord(value) || !hasOnlyKeys(value, ["temperature", "numCtx"])) return null;
  const temperature = value.temperature === undefined ? 0.7 : safeNumber(value.temperature, { min: 0, max: 2 });
  const numCtx = value.numCtx === undefined ? 4096 : safeNumber(value.numCtx, { min: 256, max: 65_536, integer: true });
  return temperature === null || numCtx === null ? null : { temperature, numCtx };
}

function normalizeAttachment(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["mime", "data"]) || !SAFE_ATTACHMENT_MIME_TYPES.has(value.mime) || typeof value.data !== "string") return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value.data) || value.data.length > Math.ceil(MAX_OLLAMA_ATTACHMENT_BYTES / 3) * 4) return null;
  const decodedBytes = Math.floor((value.data.length * 3) / 4) - (value.data.endsWith("==") ? 2 : value.data.endsWith("=") ? 1 : 0);
  if (!(decodedBytes > 0 && decodedBytes <= MAX_OLLAMA_ATTACHMENT_BYTES)) return null;
  let bytes;
  try {
    const binary = atob(value.data);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  const matchesPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const matchesJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const matchesWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const matchesMime = (value.mime === "image/png" && matchesPng)
    || (value.mime === "image/jpeg" && matchesJpeg)
    || (value.mime === "image/webp" && matchesWebp);
  return matchesMime ? { mime: value.mime, data: value.data } : null;
}

export function validateOllamaMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (["GET_OLLAMA_STATE", "REFRESH_OLLAMA", "RUN_OLLAMA_PULL_QUEUE", "GET_OLLAMA_HARNESS_BOUNDARY"].includes(value.type)) {
    return hasOnlyKeys(value, ["type"]) ? { type: value.type } : null;
  }
  if (value.type === "SAVE_OLLAMA_CONFIG") {
    if (!isRecord(value.config) || !hasOnlyKeys(value.config, ["endpoint", "pullParallelism"])) return null;
    const endpoint = validateOllamaEndpoint(value.config.endpoint);
    const pullParallelism = safeNumber(value.config.pullParallelism, { min: 1, max: MAX_OLLAMA_PARALLEL_PULLS, integer: true });
    return endpoint.valid && pullParallelism ? { type: value.type, config: { endpoint: endpoint.value, pullParallelism } } : null;
  }
  if (["INSPECT_OLLAMA_MODEL", "ADD_OLLAMA_PULL", "DELETE_OLLAMA_MODEL"].includes(value.type)) {
    const model = normalizeOllamaModelName(value.model);
    return model && hasOnlyKeys(value, ["type", "model"]) ? { type: value.type, model } : null;
  }
  if (["CANCEL_OLLAMA_PULL", "RETRY_OLLAMA_PULL", "STOP_OLLAMA_CHAT", "RETRY_OLLAMA_CHAT", "DELETE_OLLAMA_CHAT", "EXPORT_OLLAMA_CHAT"].includes(value.type)) {
    return typeof value.id === "string" && OLLAMA_ID_PATTERN.test(value.id) && hasOnlyKeys(value, ["type", "id"])
      ? { type: value.type, id: value.id }
      : null;
  }
  if (value.type === "COPY_OLLAMA_MODEL") {
    const source = normalizeOllamaModelName(value.source);
    const destination = normalizeOllamaModelName(value.destination);
    return source && destination && source !== destination && hasOnlyKeys(value, ["type", "source", "destination"])
      ? { type: value.type, source, destination }
      : null;
  }
  if (value.type === "CREATE_OLLAMA_CHAT") {
    const model = normalizeOllamaModelName(value.model);
    const systemPrompt = boundedText(value.systemPrompt, MAX_OLLAMA_SYSTEM_PROMPT_CHARS, { required: false, trim: false });
    return model && systemPrompt !== null && hasOnlyKeys(value, ["type", "model", "systemPrompt"])
      ? { type: value.type, model, systemPrompt }
      : null;
  }
  if (value.type === "RENAME_OLLAMA_CHAT") {
    const title = boundedText(value.title, MAX_OLLAMA_TITLE_CHARS, { required: true });
    return typeof value.id === "string" && OLLAMA_ID_PATTERN.test(value.id) && title && hasOnlyKeys(value, ["type", "id", "title"])
      ? { type: value.type, id: value.id, title }
      : null;
  }
  if (value.type === "SEND_OLLAMA_CHAT") {
    const id = typeof value.id === "string" && OLLAMA_ID_PATTERN.test(value.id) ? value.id : null;
    const prompt = boundedText(value.prompt, MAX_OLLAMA_MESSAGE_CHARS, { required: true, trim: false });
    const options = normalizedChatOptions(value.options);
    const attachments = Array.isArray(value.attachments) && value.attachments.length <= MAX_OLLAMA_ATTACHMENTS
      ? value.attachments.map(normalizeAttachment)
      : null;
    return id && prompt && options && attachments && attachments.every(Boolean) && hasOnlyKeys(value, ["type", "id", "prompt", "options", "attachments"])
      ? { type: value.type, id, prompt, options, attachments }
      : null;
  }
  return null;
}

function parseVersion(value) {
  if (!isRecord(value) || typeof value.version !== "string" || value.version.length > 128) throw new OllamaError("ollama-version-invalid", "The local version response was malformed.");
  return value.version;
}

function parseTags(value, runningNames) {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > MAX_OLLAMA_MODELS) throw new OllamaError("ollama-tags-invalid", "The local model list was malformed or exceeded its safety limit.");
  const models = value.models.map((item) => normalizeModel(item, runningNames));
  if (models.some((item) => item === null) || new Set(models.map((item) => item.name)).size !== models.length) throw new OllamaError("ollama-tags-invalid", "The local model list contained an invalid or duplicate tag.");
  return models.sort((left, right) => left.name.localeCompare(right.name));
}

function parseRunningNames(value) {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > MAX_OLLAMA_MODELS) throw new OllamaError("ollama-running-invalid", "The local running-model response was malformed.");
  const names = value.models.map((item) => normalizeOllamaModelName(item?.name ?? item?.model));
  if (names.some((item) => !item)) throw new OllamaError("ollama-running-invalid", "The local running-model response contained an invalid tag.");
  return new Set(names);
}

function parseShow(value) {
  if (!isRecord(value) || !Array.isArray(value.capabilities) || value.capabilities.length > 32) throw new OllamaError("ollama-show-invalid", "The local model capability response was malformed.");
  if (value.capabilities.some((item) => typeof item !== "string" || !SAFE_MODEL_CAPABILITIES.has(item))) throw new OllamaError("ollama-show-invalid", "The local model capability response contained unsupported values.");
  const modelInfo = isRecord(value.model_info) ? value.model_info : {};
  if (Object.keys(modelInfo).length > 4_096) throw new OllamaError("ollama-show-invalid", "The local model metadata exceeded the safety limit.");
  const parameterCount = modelInfo["general.parameter_count"] === undefined
    ? null
    : safeNumber(modelInfo["general.parameter_count"], { min: 1, integer: true });
  if (modelInfo["general.parameter_count"] !== undefined && parameterCount === null) throw new OllamaError("ollama-show-invalid", "The local model parameter metadata was invalid.");
  const contextCandidates = Object.entries(modelInfo)
    .filter(([key]) => key === "context_length" || key.endsWith(".context_length"))
    .map(([, candidate]) => safeNumber(candidate, { min: 1, max: 1_000_000, integer: true }));
  if (contextCandidates.some((candidate) => candidate === null)) throw new OllamaError("ollama-show-invalid", "The local model context metadata was invalid.");
  const uniqueContexts = [...new Set(contextCandidates)];
  return {
    capabilities: [...new Set(value.capabilities)].sort(),
    details: normalizeModelDetails(value.details),
    parameterCount,
    contextWindow: uniqueContexts.length === 1 ? uniqueContexts[0] : null,
  };
}

function safeOllamaErrorDetail(error) {
  if (error instanceof OllamaError) return error.message;
  return "The local Ollama runtime could not be reached.";
}

/**
 * The single privileged owner of extension-to-Ollama traffic.  The injected
 * `fetchImpl` and clock make every parsing, queue, cancellation, and recovery
 * boundary directly testable without an Ollama installation.
 */
export function createOllamaSuite({ local, fetchImpl = fetch, now = () => new Date(), idFactory = stableId } = {}) {
  if (!local?.get || !local?.set) throw new Error("A chrome.storage.local-compatible store is required.");
  let mutation = Promise.resolve();
  let pullRunner = null;
  const pullControllers = new Map();
  const chatControllers = new Map();

  async function readState() {
    const stored = await local.get(OLLAMA_STATE_KEY);
    if (stored[OLLAMA_STATE_KEY] === undefined) return defaultState(now);
    const state = normalizeState(stored[OLLAMA_STATE_KEY]);
    if (!state) throw new OllamaError("ollama-storage-corrupt", "The local Ollama record is malformed. No changes were made.");
    return state;
  }

  function mutate(mutator) {
    mutation = mutation.catch(() => {}).then(async () => {
      const state = await readState();
      const value = await mutator(state);
      state.updatedAt = nowIso(now);
      assertStateWithinStorageBudget(state);
      await local.set({ [OLLAMA_STATE_KEY]: state });
      return value;
    });
    return mutation;
  }

  function endpointFor(state, path) {
    if (!path.startsWith("/api/")) throw new OllamaError("ollama-path-invalid", "The local operation is not on an allowed Ollama API path.");
    const url = new URL(state.endpoint);
    url.pathname = path;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function request(state, path, { method = "GET", body, signal, stream = false, timeoutMs = 12_000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const relayAbort = () => controller.abort();
    signal?.addEventListener?.("abort", relayAbort, { once: true });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", relayAbort);
    };
    try {
      const response = await fetchImpl(endpointFor(state, path), {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      if (!response?.ok) throw new OllamaError("ollama-http-error", `The local Ollama API returned HTTP ${response?.status ?? "unknown"}.`);
      const contentType = response.headers?.get?.("content-type") ?? "";
      const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json" && mediaType !== "application/x-ndjson") throw new OllamaError("ollama-content-type", "The local Ollama API did not return JSON.");
      if (stream) return { response, signal: controller.signal, close };
      const text = await readBoundedText(response);
      try {
        return JSON.parse(text);
      } catch {
        throw new OllamaError("ollama-json-invalid", "The local Ollama API returned malformed JSON.");
      }
    } catch (error) {
      close();
      throw sanitizeError(error);
    } finally {
      if (!stream) close();
    }
  }

  async function setRuntimeFailure(error) {
    const detail = safeOllamaErrorDetail(error);
    return mutate((state) => {
      const status = error?.code === "ollama-request-timeout"
        ? "offline"
        : ["ollama-http-error", "ollama-content-type", "ollama-stream-invalid", "ollama-tags-invalid", "ollama-running-invalid", "ollama-show-invalid"].includes(error?.code)
          ? "unhealthy"
          : "missing";
      state.runtime = { status, checkedAt: nowIso(now), version: null, detail };
      return { ok: false, code: error?.code ?? "ollama-request-failed", detail, state };
    });
  }

  async function refresh() {
    let state;
    try { state = await readState(); } catch (error) { throw sanitizeError(error); }
    try {
      const versionBody = await request(state, "/api/version");
      const psBody = await request(state, "/api/ps");
      const tagsBody = await request(state, "/api/tags");
      const version = parseVersion(versionBody);
      const runningNames = parseRunningNames(psBody);
      const models = parseTags(tagsBody, runningNames);
      return mutate((next) => {
        const existingCapabilities = new Map(next.installed.map((item) => [item.name, item.capabilities]));
        next.installed = models.map((model) => ({ ...model, capabilities: existingCapabilities.get(model.name) ?? [] }));
        next.runtime = { status: "healthy", checkedAt: nowIso(now), version, detail: null };
        next.catalog.refreshedAt = nowIso(now);
        next.catalog.verifiedEndpoint = next.endpoint;
        next.catalog.pageCount = 0;
        next.catalog.revision = `local-tags:${version}:${next.catalog.refreshedAt}`;
        return { ok: true, code: "ollama-refresh-complete", state: next };
      });
    } catch (error) {
      return setRuntimeFailure(sanitizeError(error));
    }
  }

  async function configure(config) {
    const endpoint = validateOllamaEndpoint(config?.endpoint);
    const pullParallelism = safeNumber(config?.pullParallelism, { min: 1, max: MAX_OLLAMA_PARALLEL_PULLS, integer: true });
    if (!endpoint.valid || !pullParallelism) throw new OllamaError("ollama-config-invalid", endpoint.error ?? "The pull parallelism is invalid.");
    return mutate((state) => {
      state.endpoint = endpoint.value;
      state.pullParallelism = pullParallelism;
      state.runtime = { status: "unknown", checkedAt: null, version: null, detail: null };
      if (state.catalog.verifiedEndpoint && state.catalog.verifiedEndpoint !== endpoint.value) {
        state.catalog.reason = "The saved installed-model list belongs to a different local endpoint. Refresh before acting on it.";
      }
      return { ok: true, code: "ollama-config-saved", state };
    });
  }

  async function inspect(model) {
    const normalized = normalizeOllamaModelName(model);
    if (!normalized) throw new OllamaError("ollama-model-invalid", "Choose a verified local model tag.");
    const state = await readState();
    if (!state.installed.some((item) => item.name === normalized)) throw new OllamaError("ollama-model-uninstalled", "Choose an installed model before inspecting it.");
    try {
      const payload = parseShow(await request(state, "/api/show", { method: "POST", body: { model: normalized } }));
      return mutate((next) => {
        const current = next.installed.find((item) => item.name === normalized);
        if (!current) throw new OllamaError("ollama-model-uninstalled", "The model changed while it was being inspected.");
        current.capabilities = payload.capabilities;
        current.details = { ...current.details, ...payload.details };
        current.parameterCount = payload.parameterCount;
        current.contextWindow = payload.contextWindow;
        return { ok: true, code: "ollama-model-inspected", model: current, state: next };
      });
    } catch (error) {
      return setRuntimeFailure(sanitizeError(error));
    }
  }

  async function updateCart(id, apply) {
    return mutate((state) => {
      const item = state.cart.find((candidate) => candidate.id === id);
      if (!item) throw new OllamaError("ollama-pull-not-found", "The selected pull no longer exists.");
      apply(item, state);
      item.updatedAt = nowIso(now);
      return { ...item };
    });
  }

  async function enqueuePull(model) {
    const normalized = normalizeOllamaModelName(model);
    if (!normalized) throw new OllamaError("ollama-model-invalid", "Enter an exact local model tag without shell syntax.");
    const id = idFactory("pull");
    if (!OLLAMA_ID_PATTERN.test(id)) throw new OllamaError("ollama-id-invalid", "The local pull identifier was invalid.");
    const item = await mutate((state) => {
      if (state.cart.length >= MAX_OLLAMA_CART_ITEMS) throw new OllamaError("ollama-cart-full", "The local pull cart is full. Remove a completed item first.");
      if (state.cart.some((entry) => entry.model === normalized && ["queued", "pulling"].includes(entry.status))) throw new OllamaError("ollama-pull-duplicate", "That model is already queued or pulling locally.");
      const timestamp = nowIso(now);
      const next = { id, model: normalized, status: "queued", createdAt: timestamp, updatedAt: timestamp, total: null, completed: null, detail: null };
      state.cart.push(next);
      return next;
    });
    void runPullQueue();
    return { ok: true, code: "ollama-pull-queued", item };
  }

  async function executePull(item) {
    const controller = new AbortController();
    pullControllers.set(item.id, controller);
    let sawSuccess = false;
    try {
      await updateCart(item.id, (entry) => { entry.status = "pulling"; entry.detail = "Local pull is in progress."; });
      const state = await readState();
      const stream = await request(state, "/api/pull", { method: "POST", body: { model: item.model, stream: true }, signal: controller.signal, stream: true, timeoutMs: 600_000 });
      try {
        await readNdjson(stream.response, async (event) => {
          if (!isRecord(event) || typeof event.status !== "string" || event.status.length > 240) throw new OllamaError("ollama-pull-invalid", "The local pull stream was malformed.");
          const total = event.total === undefined ? null : safeNumber(event.total, { min: 0, integer: true });
          const completed = event.completed === undefined ? null : safeNumber(event.completed, { min: 0, integer: true });
          if ((event.total !== undefined && total === null) || (event.completed !== undefined && completed === null) || (total !== null && completed !== null && completed > total)) throw new OllamaError("ollama-pull-invalid", "The local pull progress was invalid.");
          if (/^success$/iu.test(event.status) || /^successfully/iu.test(event.status)) sawSuccess = true;
          await updateCart(item.id, (entry) => {
            entry.total = total;
            entry.completed = completed;
            entry.detail = event.status;
          });
        }, { signal: stream.signal });
      } finally {
        stream.close();
      }
      if (!sawSuccess) throw new OllamaError("ollama-pull-incomplete", "The local pull stream ended without a success record.");
      await updateCart(item.id, (entry) => { entry.status = "pulled"; entry.detail = "The local API reported a completed pull."; });
    } catch (error) {
      const safe = sanitizeError(error, "The local pull did not complete.");
      const cancelled = controller.signal.aborted;
      await updateCart(item.id, (entry) => {
        entry.status = cancelled ? "cancelled" : "failed";
        entry.detail = cancelled ? "Cancelled locally." : safe.message;
      }).catch(() => {});
    } finally {
      pullControllers.delete(item.id);
    }
  }

  async function runPullQueue() {
    if (pullRunner) return pullRunner;
    pullRunner = (async () => {
      let processed = false;
      while (true) {
        const state = await readState();
        const candidates = state.cart
          .filter((item) => item.status === "queued")
          .slice(0, state.pullParallelism);
        if (!candidates.length) break;
        // A browser worker can be suspended between operations. Work only from
        // durable queue state, while honoring the explicitly configured cap.
        processed = true;
        await Promise.all(candidates.map((item) => executePull(item)));
      }
      if (processed) {
        try { await refresh(); } catch { /* Runtime state already records a truthful failure. */ }
      }
    })().finally(() => { pullRunner = null; });
    return pullRunner;
  }

  async function cancelPull(id) {
    if (!OLLAMA_ID_PATTERN.test(id)) throw new OllamaError("ollama-pull-not-found", "The selected pull is invalid.");
    const controller = pullControllers.get(id);
    controller?.abort();
    const item = await updateCart(id, (entry) => {
      if (entry.status === "pulled" || entry.status === "skipped") throw new OllamaError("ollama-pull-final", "Completed pulls are retained as honest history and cannot be cancelled.");
      entry.status = "cancelled";
      entry.detail = "Cancelled locally.";
    });
    return { ok: true, code: "ollama-pull-cancelled", item };
  }

  async function retryPull(id) {
    const item = await updateCart(id, (entry) => {
      if (!["failed", "cancelled", "interrupted"].includes(entry.status)) throw new OllamaError("ollama-pull-not-retryable", "Only a failed, cancelled, or interrupted pull can be retried.");
      entry.status = "queued";
      entry.total = null;
      entry.completed = null;
      entry.detail = "Queued for a local retry.";
    });
    void runPullQueue();
    return { ok: true, code: "ollama-pull-requeued", item };
  }

  async function reconcilePulls() {
    return mutate((state) => {
      state.cart.forEach((item) => {
        if (item.status === "pulling") {
          item.status = "interrupted";
          item.detail = "The extension worker restarted before the pull could be verified. Refresh to reconcile local state.";
          item.updatedAt = nowIso(now);
        }
      });
      return { ok: true, code: "ollama-pull-reconciled", state };
    });
  }

  async function deleteModel(model) {
    const normalized = normalizeOllamaModelName(model);
    if (!normalized) throw new OllamaError("ollama-model-invalid", "Choose an installed model before removing it.");
    const state = await readState();
    if (!state.installed.some((item) => item.name === normalized)) throw new OllamaError("ollama-model-uninstalled", "The selected model is not installed locally.");
    try {
      await request(state, "/api/delete", { method: "DELETE", body: { model: normalized } });
      await refresh();
      return { ok: true, code: "ollama-model-deleted" };
    } catch (error) {
      return setRuntimeFailure(sanitizeError(error));
    }
  }

  async function copyModel(source, destination) {
    const from = normalizeOllamaModelName(source);
    const to = normalizeOllamaModelName(destination);
    if (!from || !to || from === to) throw new OllamaError("ollama-copy-invalid", "Choose a verified source tag and a different destination tag.");
    const state = await readState();
    if (!state.installed.some((item) => item.name === from)) throw new OllamaError("ollama-model-uninstalled", "Choose an installed source model before copying it.");
    try {
      await request(state, "/api/copy", { method: "POST", body: { source: from, destination: to } });
      await refresh();
      return { ok: true, code: "ollama-model-copied" };
    } catch (error) {
      return setRuntimeFailure(sanitizeError(error));
    }
  }

  async function createChat(model, systemPrompt) {
    const normalized = normalizeOllamaModelName(model);
    const prompt = boundedText(systemPrompt, MAX_OLLAMA_SYSTEM_PROMPT_CHARS, { required: false, trim: false });
    if (!normalized || prompt === null) throw new OllamaError("ollama-chat-invalid", "Choose an installed model and a bounded system prompt.");
    const id = idFactory("chat");
    if (!OLLAMA_ID_PATTERN.test(id)) throw new OllamaError("ollama-id-invalid", "The local chat identifier was invalid.");
    return mutate((state) => {
      if (!state.installed.some((item) => item.name === normalized)) throw new OllamaError("ollama-model-uninstalled", "Choose an installed model before starting a chat.");
      if (state.sessions.length >= MAX_OLLAMA_SESSIONS) throw new OllamaError("ollama-chat-full", "The local chat history is full. Export or remove a chat first.");
      const timestamp = nowIso(now);
      const session = { id, model: normalized, title: `${normalized} chat`, systemPrompt: prompt, createdAt: timestamp, updatedAt: timestamp, messages: [] };
      state.sessions.unshift(session);
      return { ok: true, code: "ollama-chat-created", session, state };
    });
  }

  async function updateSession(id, apply) {
    return mutate((state) => {
      const session = state.sessions.find((candidate) => candidate.id === id);
      if (!session) throw new OllamaError("ollama-chat-not-found", "The selected local chat is unavailable.");
      apply(session, state);
      session.updatedAt = nowIso(now);
      return session;
    });
  }

  async function sendChat(id, prompt, options, attachments = []) {
    if (!OLLAMA_ID_PATTERN.test(id)) throw new OllamaError("ollama-chat-not-found", "The selected local chat is unavailable.");
    const input = boundedText(prompt, MAX_OLLAMA_MESSAGE_CHARS, { required: true, trim: false });
    const safeOptions = normalizedChatOptions(options);
    const safeAttachments = Array.isArray(attachments) && attachments.length <= MAX_OLLAMA_ATTACHMENTS ? attachments.map(normalizeAttachment) : null;
    if (!input || !safeOptions || !safeAttachments || safeAttachments.some((item) => !item)) throw new OllamaError("ollama-chat-invalid", "The chat request exceeded a local safety boundary.");
    if (chatControllers.has(id)) throw new OllamaError("ollama-chat-in-progress", "This local chat is already streaming. Stop it or wait for the response before sending another message.");
    const controller = new AbortController();
    chatControllers.set(id, controller);
    let assistantIndex = -1;
    try {
      const session = await updateSession(id, (current) => {
        if (current.messages.length + 2 > MAX_OLLAMA_MESSAGES_PER_SESSION) throw new OllamaError("ollama-chat-history-full", "The local chat reached its history limit. Export or start a new chat.");
        current.messages.push({ role: "user", content: input, status: "complete", at: nowIso(now) });
        assistantIndex = current.messages.length;
        current.messages.push({ role: "assistant", content: "", status: "streaming", at: nowIso(now) });
      });
      const state = await readState();
      const model = state.installed.find((item) => item.name === session.model);
      if (!model) throw new OllamaError("ollama-model-uninstalled", "The selected model is no longer installed locally.");
      if (safeAttachments.length && !model.capabilities.includes("vision")) throw new OllamaError("ollama-attachment-unsupported", "This model has no verified vision capability. Inspect a compatible installed model first.");
      const messages = [];
      if (session.systemPrompt) messages.push({ role: "system", content: session.systemPrompt });
      session.messages.filter((message) => message.role !== "assistant" || message.status === "complete").forEach((message) => messages.push({ role: message.role, content: message.content }));
      const last = messages.at(-1);
      if (safeAttachments.length && last?.role === "user") last.images = safeAttachments.map((attachment) => attachment.data);
      const stream = await request(state, "/api/chat", { method: "POST", body: { model: session.model, messages, stream: true, options: { temperature: safeOptions.temperature, num_ctx: safeOptions.numCtx } }, signal: controller.signal, stream: true, timeoutMs: 600_000 });
      let sawDone = false;
      try {
        await readNdjson(stream.response, async (event) => {
          if (!isRecord(event) || (event.done !== undefined && typeof event.done !== "boolean") || (event.message !== undefined && !isRecord(event.message))) throw new OllamaError("ollama-chat-stream-invalid", "The local chat stream was malformed.");
          const addition = event.message?.content === undefined ? "" : boundedText(event.message.content, MAX_OLLAMA_MESSAGE_CHARS, { required: false, trim: false });
          if (addition === null) throw new OllamaError("ollama-chat-stream-invalid", "The local chat response exceeded its safety limit.");
          if (event.done === true) sawDone = true;
          if (addition) {
            await updateSession(id, (current) => {
              const assistant = current.messages[assistantIndex];
              if (!assistant || assistant.role !== "assistant") throw new OllamaError("ollama-chat-state", "The local chat changed during streaming.");
              if (assistant.content.length + addition.length > MAX_OLLAMA_MESSAGE_CHARS) throw new OllamaError("ollama-chat-response-too-large", "The local chat response exceeded its safety limit.");
              assistant.content += addition;
            });
          }
        }, { signal: stream.signal });
      } finally {
        stream.close();
      }
      if (!sawDone) throw new OllamaError("ollama-chat-incomplete", "The local chat stream ended without a completion record.");
      await updateSession(id, (current) => { current.messages[assistantIndex].status = "complete"; });
      return { ok: true, code: "ollama-chat-complete", state: await readState() };
    } catch (error) {
      const safe = sanitizeError(error, "The local chat did not complete.");
      await updateSession(id, (current) => {
        const assistant = current.messages[assistantIndex];
        if (assistant?.role === "assistant" && assistant.status === "streaming") assistant.status = controller.signal.aborted ? "cancelled" : "failed";
      }).catch(() => {});
      return { ok: false, code: controller.signal.aborted ? "ollama-chat-cancelled" : safe.code, detail: safe.message, state: await readState().catch(() => null) };
    } finally {
      if (chatControllers.get(id) === controller) chatControllers.delete(id);
    }
  }

  async function stopChat(id) {
    const controller = chatControllers.get(id);
    if (!controller) throw new OllamaError("ollama-chat-not-streaming", "That local chat is not currently streaming.");
    controller.abort();
    return { ok: true, code: "ollama-chat-stop-requested" };
  }

  async function retryChat(id) {
    const state = await readState();
    const session = state.sessions.find((item) => item.id === id);
    const previous = session?.messages.filter((message) => message.role === "user").at(-1);
    if (!session || !previous) throw new OllamaError("ollama-chat-no-retry", "This local chat has no prior user message to retry.");
    return sendChat(id, previous.content, { temperature: 0.7, numCtx: 4096 }, []);
  }

  async function renameChat(id, title) {
    const safeTitle = boundedText(title, MAX_OLLAMA_TITLE_CHARS, { required: true });
    if (!safeTitle) throw new OllamaError("ollama-chat-title-invalid", "Enter a non-empty local chat title.");
    const session = await updateSession(id, (current) => { current.title = safeTitle; });
    return { ok: true, code: "ollama-chat-renamed", session };
  }

  async function deleteChat(id) {
    return mutate((state) => {
      const index = state.sessions.findIndex((item) => item.id === id);
      if (index < 0) throw new OllamaError("ollama-chat-not-found", "The selected local chat is unavailable.");
      state.sessions.splice(index, 1);
      return { ok: true, code: "ollama-chat-deleted", state };
    });
  }

  async function exportChat(id) {
    const state = await readState();
    const session = state.sessions.find((item) => item.id === id);
    return { ok: true, code: "ollama-chat-export", export: createRedactedChatExport(session) };
  }

  async function state() {
    return { ok: true, code: "ollama-state", state: await readState() };
  }

  function harnessBoundary() {
    return {
      ok: true,
      code: "ollama-browser-harness-boundary",
      profile: {
        id: "browser-local-api-diagnostic",
        name: "Browser local API diagnostic",
        launchable: false,
        preflight: "The extension can verify only the documented local Ollama API. Browser isolation cannot execute a local executable, shell command, or environment profile.",
        snapshot: "No executable or configuration mutation is attempted, so no launch snapshot exists.",
        restore: "No executable or configuration mutation is attempted, so there is nothing to restore.",
      },
    };
  }

  return {
    state,
    configure,
    refresh,
    inspect,
    enqueuePull,
    runPullQueue,
    cancelPull,
    retryPull,
    reconcilePulls,
    deleteModel,
    copyModel,
    createChat,
    sendChat,
    stopChat,
    retryChat,
    renameChat,
    deleteChat,
    exportChat,
    harnessBoundary,
  };
}
