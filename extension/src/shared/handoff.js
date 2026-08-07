import { HANDOFF_PROTOCOL_VERSION } from "./settings.js";

export const HANDOFF_SOURCE = "material-download-manager-extension";
export const MAX_URL_LENGTH = 8192;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SELECTION_LENGTH = 2048;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value;
}

export function normalizeDownloadUrl(rawValue) {
  if (typeof rawValue !== "string" || rawValue.length === 0 || rawValue.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  return url.toString();
}

export function createHandoffEnvelope(rawUrl, metadata = {}) {
  const url = normalizeDownloadUrl(rawUrl);
  if (!url) throw new Error("Only credential-free http or https URLs can be handed off.");
  const title = boundedText(metadata.title, MAX_TITLE_LENGTH);
  const selectionText = boundedText(metadata.selectionText, MAX_SELECTION_LENGTH);
  if (title === null || selectionText === null) throw new Error("Handoff metadata is too large or not text.");

  const envelope = {
    protocol: HANDOFF_PROTOCOL_VERSION,
    source: HANDOFF_SOURCE,
    url,
    requestedAt: new Date().toISOString(),
  };
  if (title) envelope.title = title;
  if (selectionText) envelope.selectionText = selectionText;
  return envelope;
}

export function validateIncomingMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "GET_STATE") return { type: value.type };
  if (value.type === "TEST_HANDOFF") return { type: value.type };
  if (value.type === "SAVE_SETTINGS" && isRecord(value.settings)) {
    return { type: value.type, settings: value.settings };
  }
  if (value.type === "HANDOFF_URL") {
    const url = normalizeDownloadUrl(value.url);
    const title = boundedText(value.title, MAX_TITLE_LENGTH);
    const selectionText = boundedText(value.selectionText, MAX_SELECTION_LENGTH);
    if (!url || title === null || selectionText === null) return null;
    return { type: value.type, url, title, selectionText };
  }
  return null;
}
