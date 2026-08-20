(function (global) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_MODELS = 5000;
  const MAX_CART_ITEMS = 5000;
  const MAX_CHATS = 8;
  const MAX_MESSAGES_PER_CHAT = 60;
  const MAX_MESSAGE_LENGTH = 12000;
  const MAX_HISTORY = 250;
  const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
  const PROFILE_KINDS = new Set(["health", "inventory", "chat-readiness", "model-inspect"]);
  const FIT_VERDICTS = ["Runs well", "Runs with limits", "Unlikely", "Unknown"];
  const CART_STATUSES = new Set(["queued", "pulling", "pulled", "skipped", "cancelled", "failed"]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
  }

  function safeText(value, limit = 256) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
    return normalized && normalized.length <= limit ? normalized : null;
  }

  function finiteNonNegative(value) {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }

  function isAllowedEndpoint(value) {
    if (typeof value !== "string" || value.length > 160) return false;
    try {
      const endpoint = new URL(value);
      return endpoint.protocol === "http:"
        && LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase())
        && endpoint.port === "11434"
        && (endpoint.pathname === "/" || endpoint.pathname === "")
        && !endpoint.username
        && !endpoint.password
        && !endpoint.search
        && !endpoint.hash;
    } catch (_error) {
      return false;
    }
  }

  function normalizeEndpoint(value) {
    return isAllowedEndpoint(value) ? new URL(value).origin : null;
  }

  function isSafeModelName(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= 192
      && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
      && !value.includes("..")
      && !value.includes("://")
      && !value.startsWith("-");
  }

  function normalizeDetails(value) {
    if (value === undefined) return {};
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["format", "family", "families", "parameter_size", "quantization_level", "parent_model"])) return null;
    const result = {};
    for (const key of ["format", "family", "parameter_size", "quantization_level", "parent_model"]) {
      if (value[key] === undefined) continue;
      const normalized = safeText(value[key], 120);
      if (normalized === null) return null;
      result[key] = normalized;
    }
    if (value.families !== undefined) {
      if (!Array.isArray(value.families) || value.families.length > 24) return null;
      result.families = value.families.map((item) => safeText(item, 120));
      if (result.families.some((item) => item === null)) return null;
    }
    return result;
  }

  function normalizeInstalledModel(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["name", "model", "modified_at", "size", "digest", "details", "expires_at", "size_vram", "context_length"])) return null;
    if (value.name !== undefined && !isSafeModelName(value.name)) return null;
    if (value.model !== undefined && !isSafeModelName(value.model)) return null;
    if (value.name !== undefined && value.model !== undefined && value.name !== value.model) return null;
    const name = value.name || value.model || null;
    const size = finiteNonNegative(value.size);
    if (!name || size === null) return null;
    const details = normalizeDetails(value.details);
    if (details === null) return null;
    const result = { name, size, details };
    if (isSafeModelName(value.model)) result.model = value.model;
    if (value.digest !== undefined) {
      const digest = safeText(value.digest, 160);
      if (!digest || !/^[a-f0-9]{32,160}$/i.test(digest)) return null;
      result.digest = digest;
    }
    for (const key of ["modified_at", "expires_at"]) {
      if (value[key] === undefined) continue;
      const timestamp = safeText(value[key], 80);
      if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
      result[key] = timestamp;
    }
    for (const key of ["size_vram", "context_length"]) {
      if (value[key] === undefined) continue;
      const number = finiteNonNegative(value[key]);
      if (number === null) return null;
      result[key] = number;
    }
    return result;
  }

  function normalizeModelList(value, maximum = MAX_MODELS) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["models"]) || !Array.isArray(value.models) || value.models.length > maximum) return null;
    const models = value.models.map(normalizeInstalledModel);
    if (models.some((model) => model === null)) return null;
    const names = new Set(models.map((model) => model.name));
    return names.size === models.length ? models : null;
  }

  function normalizeTagsResponse(value) {
    return normalizeModelList(value);
  }

  function normalizeRunningResponse(value) {
    return normalizeModelList(value);
  }

  function normalizeRuntimeCache(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["version", "refreshedAt", "installed", "running"])) return null;
    const version = safeText(value.version, 80);
    const refreshedAt = safeText(value.refreshedAt, 80);
    const installed = normalizeModelList({ models: value.installed });
    const running = normalizeModelList({ models: value.running });
    if (!version || !refreshedAt || Number.isNaN(Date.parse(refreshedAt)) || !installed || !running) return null;
    return { version, refreshedAt, installed, running };
  }

  function normalizeCatalogModel(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["tag", "family", "description", "sizeBytes", "parameterCount", "quantization", "capabilities"])) return null;
    const tag = isSafeModelName(value.tag) ? value.tag : null;
    const family = safeText(value.family, 120);
    const description = safeText(value.description, 600);
    const sizeBytes = finiteNonNegative(value.sizeBytes);
    if (!tag || !family || !description || sizeBytes === null || sizeBytes === 0) return null;
    const result = { tag, family, description, sizeBytes };
    if (value.parameterCount !== undefined) {
      const parameterCount = safeText(value.parameterCount, 80);
      if (!parameterCount) return null;
      result.parameterCount = parameterCount;
    }
    if (value.quantization !== undefined) {
      const quantization = safeText(value.quantization, 80);
      if (!quantization) return null;
      result.quantization = quantization;
    }
    if (value.capabilities !== undefined) {
      if (!Array.isArray(value.capabilities) || value.capabilities.length > 20) return null;
      result.capabilities = value.capabilities.map((item) => safeText(item, 80));
      if (result.capabilities.some((item) => item === null)) return null;
    }
    return result;
  }

  function normalizeCatalogSnapshot(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["schemaVersion", "kind", "sourceRevision", "refreshedAt", "pageCount", "complete", "models"])) return null;
    if (value.schemaVersion !== SCHEMA_VERSION || value.kind !== "official-catalog-snapshot" || value.complete !== true) return null;
    const sourceRevision = safeText(value.sourceRevision, 160);
    const refreshedAt = safeText(value.refreshedAt, 80);
    const pageCount = finiteNonNegative(value.pageCount);
    if (!sourceRevision || !refreshedAt || Number.isNaN(Date.parse(refreshedAt)) || pageCount === null || pageCount < 1 || pageCount > 10000 || !Array.isArray(value.models) || value.models.length > MAX_MODELS) return null;
    const models = value.models.map(normalizeCatalogModel);
    if (models.some((model) => model === null)) return null;
    const tags = new Set(models.map((model) => model.tag));
    if (tags.size !== models.length) return null;
    return { schemaVersion: SCHEMA_VERSION, kind: "official-catalog-snapshot", sourceRevision, refreshedAt, pageCount, complete: true, models };
  }

  function parseJsonWithoutDuplicateKeys(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CATALOG_BYTES) throw new Error("The JSON payload is empty or exceeds the 2 MiB local limit.");
    JSON.parse(raw);
    let cursor = 0;
    function whitespace() { while (/\s/.test(raw[cursor] || "")) cursor += 1; }
    function string() {
      if (raw[cursor] !== "\"") throw new Error("Malformed JSON string.");
      const start = cursor;
      cursor += 1;
      while (cursor < raw.length) {
        if (raw[cursor] === "\\") { cursor += 2; continue; }
        if (raw[cursor] === "\"") { cursor += 1; return JSON.parse(raw.slice(start, cursor)); }
        cursor += 1;
      }
      throw new Error("Unterminated JSON string.");
    }
    function primitive() {
      while (cursor < raw.length && !/[\s,\]}]/.test(raw[cursor])) cursor += 1;
    }
    function value() {
      whitespace();
      if (raw[cursor] === "{") return object();
      if (raw[cursor] === "[") return array();
      if (raw[cursor] === "\"") { string(); return; }
      primitive();
    }
    function object() {
      cursor += 1;
      whitespace();
      const keys = new Set();
      if (raw[cursor] === "}") { cursor += 1; return; }
      while (cursor < raw.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (raw[cursor] !== ":") throw new Error("Malformed JSON object.");
        cursor += 1;
        value();
        whitespace();
        if (raw[cursor] === "}") { cursor += 1; return; }
        if (raw[cursor] !== ",") throw new Error("Malformed JSON object.");
        cursor += 1;
      }
      throw new Error("Unterminated JSON object.");
    }
    function array() {
      cursor += 1;
      whitespace();
      if (raw[cursor] === "]") { cursor += 1; return; }
      while (cursor < raw.length) {
        value();
        whitespace();
        if (raw[cursor] === "]") { cursor += 1; return; }
        if (raw[cursor] !== ",") throw new Error("Malformed JSON array.");
        cursor += 1;
      }
      throw new Error("Unterminated JSON array.");
    }
    value();
    whitespace();
    if (cursor !== raw.length) throw new Error("Unexpected data after JSON payload.");
    return JSON.parse(raw);
  }

  function parseCatalogSnapshot(raw) {
    const parsed = parseJsonWithoutDuplicateKeys(raw);
    const snapshot = normalizeCatalogSnapshot(parsed);
    if (!snapshot) throw new Error("The catalog snapshot must be a complete, version 1 official-catalog-snapshot with bounded model records.");
    return snapshot;
  }

  function redactText(value) {
    return String(value ?? "")
      .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b/g, "[redacted credential]")
      .replace(/\b(?:Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "Bearer [redacted]")
      .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"']+/g, "[redacted local path]")
      .slice(0, MAX_MESSAGE_LENGTH);
  }

  function normalizeChatMessage(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["role", "content", "createdAt"])) return null;
    if (!["system", "user", "assistant"].includes(value.role)) return null;
    const content = safeText(redactText(value.content), MAX_MESSAGE_LENGTH);
    const createdAt = safeText(value.createdAt, 80);
    if (!content || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
    return { role: value.role, content, createdAt };
  }

  function normalizeChat(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "title", "model", "systemPrompt", "temperature", "contextLength", "messages", "updatedAt"])) return null;
    const id = safeText(value.id, 80);
    const title = safeText(value.title, 120);
    const model = isSafeModelName(value.model) ? value.model : null;
    const systemPrompt = safeText(redactText(value.systemPrompt), MAX_MESSAGE_LENGTH) || "";
    const temperature = Number(value.temperature);
    const contextLength = finiteNonNegative(value.contextLength);
    const updatedAt = safeText(value.updatedAt, 80);
    if (!id || !title || !model || !Number.isFinite(temperature) || temperature < 0 || temperature > 2 || contextLength === null || contextLength < 128 || contextLength > 131072 || !updatedAt || Number.isNaN(Date.parse(updatedAt)) || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES_PER_CHAT) return null;
    const messages = value.messages.map(normalizeChatMessage);
    if (messages.some((message) => message === null)) return null;
    return { id, title, model, systemPrompt, temperature, contextLength, messages, updatedAt };
  }

  function normalizeProfile(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "label", "kind", "model"])) return null;
    const id = safeText(value.id, 80);
    const label = safeText(value.label, 120);
    const model = value.model === undefined ? undefined : isSafeModelName(value.model) ? value.model : null;
    if (!id || !label || !PROFILE_KINDS.has(value.kind) || model === null) return null;
    return model ? { id, label, kind: value.kind, model } : { id, label, kind: value.kind };
  }

  function normalizeHistoryRecord(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "action", "detail", "createdAt"])) return null;
    const id = safeText(value.id, 80);
    const action = safeText(value.action, 80);
    const detail = safeText(redactText(value.detail), 400);
    const createdAt = safeText(value.createdAt, 80);
    if (!id || !action || !detail || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
    return { id, action, detail, createdAt };
  }

  function normalizeCartItem(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["tag", "status", "detail", "updatedAt"])) return null;
    const tag = isSafeModelName(value.tag) ? value.tag : null;
    const detail = safeText(redactText(value.detail), 240);
    const updatedAt = safeText(value.updatedAt, 80);
    if (!tag || !CART_STATUSES.has(value.status) || !detail || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
    return { tag, status: value.status, detail, updatedAt };
  }

  function normalizeLocalState(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["schemaVersion", "endpoint", "runtime", "catalog", "cart", "chats", "profiles", "history"])) return null;
    if (value.schemaVersion !== SCHEMA_VERSION || !isAllowedEndpoint(value.endpoint) || !Array.isArray(value.cart) || value.cart.length > MAX_CART_ITEMS || !Array.isArray(value.chats) || value.chats.length > MAX_CHATS || !Array.isArray(value.profiles) || value.profiles.length > 40 || !Array.isArray(value.history) || value.history.length > MAX_HISTORY) return null;
    const runtime = value.runtime === null || value.runtime === undefined ? null : normalizeRuntimeCache(value.runtime);
    if (value.runtime && !runtime) return null;
    const catalog = value.catalog === null || value.catalog === undefined ? null : normalizeCatalogSnapshot(value.catalog);
    if (value.catalog && !catalog) return null;
    const cart = value.cart.map(normalizeCartItem);
    const chats = value.chats.map(normalizeChat);
    const profiles = value.profiles.map(normalizeProfile);
    const history = value.history.map(normalizeHistoryRecord);
    if (cart.some((item) => item === null) || chats.some((item) => item === null) || profiles.some((item) => item === null) || history.some((item) => item === null)) return null;
    if (new Set(cart.map((item) => item?.tag)).size !== cart.length || new Set(chats.map((chat) => chat.id)).size !== chats.length || new Set(profiles.map((profile) => profile.id)).size !== profiles.length || new Set(history.map((record) => record.id)).size !== history.length) return null;
    return { schemaVersion: SCHEMA_VERSION, endpoint: normalizeEndpoint(value.endpoint), runtime, catalog, cart, chats, profiles, history };
  }

  function estimateFit(model, runningModels, browserEvidence = {}) {
    const sizeBytes = finiteNonNegative(model?.sizeBytes ?? model?.size);
    const running = Array.isArray(runningModels) ? runningModels.find((item) => item?.name === (model?.tag || model?.name)) : null;
    const deviceMemoryGiB = Number(browserEvidence.deviceMemoryGiB);
    const quotaBytes = Number(browserEvidence.quotaBytes);
    const usageBytes = Number(browserEvidence.usageBytes);
    const evidence = [];
    if (sizeBytes === null || sizeBytes === 0) return { verdict: "Unknown", evidence: ["Model blob size is unavailable."], assumptions: ["No fit estimate is made without a verified size."] };
    evidence.push(`Model blob: ${sizeBytes} bytes.`);
    if (running) {
      const vram = finiteNonNegative(running.size_vram);
      if (vram !== null && vram >= sizeBytes * 0.9) return { verdict: "Runs well", evidence: [...evidence, `The local API reports this tag running with ${vram} bytes in VRAM.`], assumptions: ["Observed load is evidence, not a throughput promise."] };
      return { verdict: "Runs with limits", evidence: [...evidence, "The local API reports this tag currently running."], assumptions: ["The browser cannot inspect GPU driver support or benchmark throughput."] };
    }
    if (Number.isFinite(quotaBytes) && Number.isFinite(usageBytes) && quotaBytes >= usageBytes) {
      const available = quotaBytes - usageBytes;
      evidence.push(`Browser storage estimate: ${available} bytes available.`);
      if (available < sizeBytes) return { verdict: "Unlikely", evidence, assumptions: ["This is browser quota evidence, not the host's exact free disk."] };
    }
    if (Number.isFinite(deviceMemoryGiB) && deviceMemoryGiB > 0) {
      const memoryBytes = deviceMemoryGiB * 1024 ** 3;
      evidence.push(`Browser-reported device memory: ${deviceMemoryGiB} GiB.`);
      if (sizeBytes > memoryBytes * 0.8) return { verdict: "Unlikely", evidence, assumptions: ["Browser memory is coarse and does not expose available RAM or VRAM."] };
      if (sizeBytes <= memoryBytes * 0.25) return { verdict: "Runs with limits", evidence, assumptions: ["A coarse browser memory report supports only a conservative estimate; GPU and driver evidence are unavailable."] };
    }
    return { verdict: "Unknown", evidence, assumptions: ["Browser-only mediation cannot read exact free disk, GPU model, usable VRAM, or driver/backend support."] };
  }

  global.OLLAMA_SUITE_CONTRACT = {
    schemaVersion: SCHEMA_VERSION,
    maxModels: MAX_MODELS,
    maxCatalogBytes: MAX_CATALOG_BYTES,
    maxChats: MAX_CHATS,
    maxMessagesPerChat: MAX_MESSAGES_PER_CHAT,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    maxHistory: MAX_HISTORY,
    fitVerdicts: FIT_VERDICTS,
    isAllowedEndpoint,
    normalizeEndpoint,
    isSafeModelName,
    normalizeTagsResponse,
    normalizeRunningResponse,
    normalizeRuntimeCache,
    normalizeCatalogSnapshot,
    parseJsonWithoutDuplicateKeys,
    parseCatalogSnapshot,
    normalizeLocalState,
    normalizeProfile,
    normalizeCartItem,
    redactText,
    estimateFit
  };
})(typeof window === "object" ? window : globalThis);
