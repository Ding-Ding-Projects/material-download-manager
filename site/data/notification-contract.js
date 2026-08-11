(function (global) {
  "use strict";

  const TONES = Object.freeze(["info", "success", "progress", "warning", "error"]);
  const FILTERS = Object.freeze(["all", "active", "dismissed", "errors"]);
  const MAX_PATTERN_LENGTH = 2048;
  const MAX_INPUT_LENGTH = 20000;

  function normalizeFlags(value) {
    return String(value || "g")
      .replace(/[^gimsuy]/g, "")
      .split("")
      .filter((flag, index, flags) => flags.indexOf(flag) === index)
      .join("") || "g";
  }

  function regexSafetyError(pattern, flags) {
    const source = String(pattern ?? "");
    const normalizedFlags = String(flags ?? "");
    if (source.length > MAX_PATTERN_LENGTH) return `Pattern is limited to ${MAX_PATTERN_LENGTH.toLocaleString()} characters.`;
    if (!/^[gimsuy]*$/.test(normalizedFlags)) return "Supported flags are g, i, m, s, u, and y.";
    if (new Set(normalizedFlags.split("")).size !== normalizedFlags.length) return "Each flag can appear only once.";
    // Reject the common exponential forms before the synchronous engine sees them.
    // This is intentionally conservative: a local search must stay responsive even
    // when a pattern came from pasted text rather than the guided builder.
    const quantified = "(?:[+*]|\\{\\d+(?:,\\d*)?\\})";
    if (new RegExp(`\\((?:[^()\\\\]|\\\\.)*\\|(?:[^()\\\\]|\\\\.)*\\)\\s*${quantified}`).test(source)
      || new RegExp(`\\((?:[^()\\\\]|\\\\.)*${quantified}(?:[^()\\\\]|\\\\.)*\\)\\s*${quantified}`).test(source)
      || new RegExp(`\\((?:[^()\\\\]|\\\\.)*(?:\\.\\*|\\.\\+)(?:[^()\\\\]|\\\\.)*\\)\\s*${quantified}`).test(source)
      || /(?:[+*]|\{\d+(?:,\d*)?\})\s*(?:[+*]|\{\d+(?:,\d*)?\})/.test(source)) {
      return "Nested or ambiguous quantifiers are rejected before evaluation.";
    }
    try { new RegExp(source, normalizedFlags); } catch (error) { return error instanceof Error ? error.message : "Invalid regular expression."; }
    return null;
  }

  function normalizeText(value, fallback, maxLength) {
    const normalized = String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "")
      .trim()
      .slice(0, maxLength);
    return normalized || fallback;
  }

  function normalizeTone(value) {
    return TONES.includes(value) ? value : "info";
  }

  function normalizeRecord(record, index) {
    if (!record || typeof record !== "object") return null;
    const candidateDate = new Date(record.createdAt);
    const createdAt = Number.isNaN(candidateDate.valueOf()) ? new Date(0).toISOString() : candidateDate.toISOString();
    const id = typeof record.id === "string" && /^[a-zA-Z0-9._:-]{1,80}$/.test(record.id) ? record.id : `legacy-${index}`;
    return {
      id,
      tone: normalizeTone(record.tone),
      title: normalizeText(record.title, "Notification", 160),
      message: normalizeText(record.message, "", 600),
      createdAt,
      dismissed: record.dismissed === true
    };
  }

  function normalizeRecords(records, limit = 100) {
    if (!Array.isArray(records)) return [];
    const seen = new Set();
    return records.map((record, index) => normalizeRecord(record, index)).filter((record) => {
      if (!record || seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    }).slice(-limit);
  }

  function filterRecords(records, view, matcher) {
    const filter = FILTERS.includes(view?.filter) ? view.filter : "all";
    return normalizeRecords(records).filter((record) => {
      if (filter === "active" && record.dismissed) return false;
      if (filter === "dismissed" && !record.dismissed) return false;
      if (filter === "errors" && !["warning", "error"].includes(record.tone)) return false;
      return typeof matcher === "function" ? matcher(record) : true;
    });
  }

  function buildExport(records, view, exportedAt) {
    return {
      schemaVersion: 1,
      exportedAt: exportedAt || new Date().toISOString(),
      filter: FILTERS.includes(view?.filter) ? view.filter : "all",
      query: String(view?.query || "").slice(0, 256),
      mode: view?.mode === "regex" ? "regex" : "text",
      pattern: String(view?.pattern || view?.query || "").slice(0, MAX_PATTERN_LENGTH),
      flags: normalizeFlags(view?.flags),
      records: normalizeRecords(records)
    };
  }

  global.MDM_SITE_NOTIFICATION_CONTRACT = Object.freeze({
    tones: TONES,
    filters: FILTERS,
    maxPatternLength: MAX_PATTERN_LENGTH,
    maxInputLength: MAX_INPUT_LENGTH,
    normalizeText,
    normalizeTone,
    normalizeFlags,
    regexSafetyError,
    normalizeRecord,
    normalizeRecords,
    filterRecords,
    buildExport
  });
})(typeof window === "object" ? window : globalThis);
