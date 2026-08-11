import { HANDOFF_PROTOCOL_VERSION } from "./settings.js";

export const HANDOFF_SOURCE = "material-download-manager-extension";
export const MAX_URL_LENGTH = 8192;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SELECTION_LENGTH = 2048;
export const MAX_FILE_NAME_LENGTH = 512;
export const AUTH_NONCE_PATTERN = /^[a-f0-9]{64}$/u;
export const AUTH_PROOF_PATTERN = /^[a-f0-9]{64}$/u;

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
  url.hash = "";
  return url.toString();
}

export function normalizeFileName(rawValue) {
  if (rawValue === undefined || rawValue === null) return undefined;
  if (typeof rawValue !== "string" || rawValue.length === 0 || rawValue.length > MAX_FILE_NAME_LENGTH) return null;
  if (rawValue === "." || rawValue === ".." || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(rawValue) || /[. ]$/.test(rawValue)) return null;
  return rawValue;
}

export function deriveDownloadFileName(rawUrl) {
  const normalizedUrl = normalizeDownloadUrl(rawUrl);
  if (!normalizedUrl) return undefined;
  const encodedName = new URL(normalizedUrl).pathname.split("/").filter(Boolean).at(-1);
  if (!encodedName) return undefined;
  let decodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    return undefined;
  }
  const normalizedName = normalizeFileName(decodedName);
  return normalizedName || undefined;
}

export function createHandoffEnvelope(rawUrl, metadata = {}) {
  const url = normalizeDownloadUrl(rawUrl);
  if (!url) throw new Error("Only credential-free http or https URLs can be handed off.");
  const title = boundedText(metadata.title, MAX_TITLE_LENGTH);
  const selectionText = boundedText(metadata.selectionText, MAX_SELECTION_LENGTH);
  const fileName = normalizeFileName(metadata.fileName);
  if (title === null || selectionText === null || fileName === null) throw new Error("Handoff metadata is too large, unsafe, or not text.");

  const envelope = {
    protocol: HANDOFF_PROTOCOL_VERSION,
    source: HANDOFF_SOURCE,
    url,
    requestedAt: new Date().toISOString(),
  };
  if (title) envelope.title = title;
  if (selectionText) envelope.selectionText = selectionText;
  if (fileName) envelope.fileName = fileName;
  return envelope;
}

export function challengeProofInput(nonce) {
  if (typeof nonce !== "string" || !AUTH_NONCE_PATTERN.test(nonce)) throw new Error("Invalid authentication nonce");
  return `challenge\n${HANDOFF_PROTOCOL_VERSION}\n${nonce}`;
}

export function handoffRequestProofInput(envelope, nonce) {
  if (!isRecord(envelope) || typeof nonce !== "string" || !AUTH_NONCE_PATTERN.test(nonce)) {
    throw new Error("Invalid authenticated handoff envelope");
  }
  return [
    "request",
    String(HANDOFF_PROTOCOL_VERSION),
    nonce,
    envelope.url,
    envelope.requestedAt ?? "",
    envelope.fileName ?? "",
    envelope.title ?? "",
    envelope.selectionText ?? "",
  ].join("\n");
}

export function handoffResponseProofInput(nonce, downloadId) {
  if (typeof nonce !== "string" || !AUTH_NONCE_PATTERN.test(nonce) || typeof downloadId !== "string" || downloadId.length === 0 || downloadId.length > 128) {
    throw new Error("Invalid authenticated handoff response");
  }
  return `response\n${HANDOFF_PROTOCOL_VERSION}\n${nonce}\n${downloadId}`;
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
