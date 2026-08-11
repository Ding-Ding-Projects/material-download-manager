(function (global) {
  "use strict";

  const TONES = Object.freeze(["info", "success", "progress", "warning", "error"]);
  const FILTERS = Object.freeze(["all", "active", "dismissed", "errors"]);

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
    return records.map(normalizeRecord).filter((record) => {
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
      records: normalizeRecords(records)
    };
  }

  global.MDM_SITE_NOTIFICATION_CONTRACT = Object.freeze({
    tones: TONES,
    filters: FILTERS,
    normalizeText,
    normalizeTone,
    normalizeRecord,
    normalizeRecords,
    filterRecords,
    buildExport
  });
})(typeof window === "object" ? window : globalThis);
