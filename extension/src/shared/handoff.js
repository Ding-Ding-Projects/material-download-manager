import { HANDOFF_DECISION_PATH, HANDOFF_PROTOCOL_VERSION } from "./settings.js";
import { normalizeTotpRegistration, parseTotpUri } from "./totp.js";
import { MAX_PERSONAL_VOCABULARY_BYTES } from "./personal-vocabulary.js";
import { LOGO_RECORD_KEYS, LOGO_VARIANT_SIZES } from "./logo.js";

export const HANDOFF_SOURCE = "material-download-manager-extension";
export const MAX_URL_LENGTH = 8192;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SELECTION_LENGTH = 2048;
export const MAX_FILE_NAME_LENGTH = 512;
export const AUTH_NONCE_PATTERN = /^[a-f0-9]{64}$/u;
export const AUTH_PROOF_PATTERN = /^[a-f0-9]{64}$/u;

function isBoundedPersonalVocabularyText(value) {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength <= MAX_PERSONAL_VOCABULARY_BYTES;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value;
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedLogoRecord(value) {
  if (!isRecord(value) || !hasExactKeys(value, LOGO_RECORD_KEYS) || !isRecord(value.variants)) return null;
  const variantNames = Object.keys(value.variants);
  const expectedNames = LOGO_VARIANT_SIZES.map(String);
  if (variantNames.length !== expectedNames.length || variantNames.some((name) => !expectedNames.includes(name))) return null;
  if (Object.values(value.variants).some((item) => typeof item !== "string" || item.length === 0 || item.length > 350_000)) return null;
  if (value.sourceDataUrl !== null && (typeof value.sourceDataUrl !== "string" || value.sourceDataUrl.length === 0 || value.sourceDataUrl.length > 2_800_000)) return null;
  if (typeof value.kind !== "string" || typeof value.fit !== "string" || typeof value.background !== "string") return null;
  return value;
}

function normalizeAuthenticatorInput(value) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["uri", "issuer", "account", "secret", "algorithm", "digits", "period"])) return null;
  if (typeof value.uri === "string") {
    if (value.uri.length > 8192) return null;
    try {
      parseTotpUri(value.uri);
    } catch {
      return null;
    }
    return { uri: value.uri };
  }
  const issuer = boundedText(value.issuer, 128);
  const account = boundedText(value.account, 128);
  const secret = boundedText(value.secret, 512);
  if (issuer === null || account === null || secret === null || typeof issuer !== "string" || typeof account !== "string" || typeof secret !== "string") return null;
  if (value.algorithm !== undefined && !["SHA1", "SHA256", "SHA512"].includes(value.algorithm)) return null;
  if (value.digits !== undefined && value.digits !== 6 && value.digits !== 8) return null;
  if (value.period !== undefined && (!Number.isSafeInteger(value.period) || value.period < 1 || value.period > 86400)) return null;
  try {
    return normalizeTotpRegistration({ issuer, account, secret, ...(value.algorithm === undefined ? {} : { algorithm: value.algorithm }), ...(value.digits === undefined ? {} : { digits: value.digits }), ...(value.period === undefined ? {} : { period: value.period }) });
  } catch {
    return null;
  }
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

export function handoffDecisionProofInput(handoffId) {
  if (typeof handoffId !== "string" || !/^[a-f0-9]{64}$/u.test(handoffId)) {
    throw new Error("Invalid browser handoff identifier");
  }
  return `decision\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}`;
}

export function handoffDecisionResponseProofInput(handoffId, state, downloadId) {
  if (
    typeof handoffId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(handoffId) ||
    !["pending", "accepted", "rejected", "expired"].includes(state) ||
    (downloadId !== null && (typeof downloadId !== "string" || downloadId.length === 0 || downloadId.length > 128))
  ) {
    throw new Error("Invalid browser handoff decision");
  }
  return `decision-response\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}\n${state}\n${downloadId ?? ""}`;
}

export function handoffRollbackProofInput(handoffId, downloadId) {
  if (
    typeof handoffId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(handoffId) ||
    typeof downloadId !== "string" ||
    downloadId.length === 0 ||
    downloadId.length > 128
  ) {
    throw new Error("Invalid browser handoff rollback");
  }
  return `rollback\n${HANDOFF_PROTOCOL_VERSION}\n${handoffId}\n${downloadId}`;
}

export function decisionEndpoint(handoffEndpoint, handoffId) {
  try {
    if (typeof handoffId !== "string" || !/^[a-f0-9]{64}$/u.test(handoffId)) return null;
    const endpoint = new URL(handoffEndpoint);
    endpoint.pathname = `${HANDOFF_DECISION_PATH}/${handoffId}`;
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint;
  } catch {
    return null;
  }
}

export function rollbackEndpoint(handoffEndpoint, handoffId) {
  const endpoint = decisionEndpoint(handoffEndpoint, handoffId);
  if (!endpoint) return null;
  endpoint.pathname = `${HANDOFF_DECISION_PATH}/${handoffId}/rollback`;
  return endpoint;
}

export function validateIncomingMessage(value) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "GET_STATE") return { type: value.type };
  if (value.type === "TEST_HANDOFF") return { type: value.type };
  if (value.type === "TEST_NARRATION") return { type: value.type };
  if (["GET_AUTHENTICATOR_STATE", "CANCEL_AUTHENTICATOR", "EXPORT_AUTHENTICATOR_METADATA", "GET_PERSONAL_VOCABULARY_STATE", "CLEAR_PERSONAL_VOCABULARY"].includes(value.type)) {
    return hasOnlyKeys(value, ["type"]) ? { type: value.type } : null;
  }
  if (value.type === "IMPORT_PERSONAL_VOCABULARY") {
    return isBoundedPersonalVocabularyText(value.text) && hasOnlyKeys(value, ["type", "text"])
      ? { type: value.type, text: value.text }
      : null;
  }
  if (["GET_AUTHENTICATOR_STATE", "CANCEL_AUTHENTICATOR", "EXPORT_AUTHENTICATOR_METADATA", "GET_LOGO", "CLEAR_LOGO"].includes(value.type)) {
    return hasOnlyKeys(value, ["type"]) ? { type: value.type } : null;
  }
  if (value.type === "SAVE_LOGO" && hasOnlyKeys(value, ["type", "logo"]) && isRecord(value.logo)) {
    // Exact top-level and variant boundaries limit the worker channel before
    // the image decoder and canonical renderer inspect bytes.
    const logo = boundedLogoRecord(value.logo);
    return logo ? { type: value.type, logo } : null;
  }
  if (value.type === "PREPARE_AUTHENTICATOR") {
    const input = normalizeAuthenticatorInput(value.input);
    return input ? { type: value.type, input } : null;
  }
  if (["GET_AUTHENTICATOR_CODE", "REMOVE_AUTHENTICATOR"].includes(value.type)) {
    return typeof value.id === "string" && /^[A-Za-z0-9_-]{8,128}$/u.test(value.id) && hasOnlyKeys(value, ["type", "id"])
      ? { type: value.type, id: value.id }
      : null;
  }
  if (value.type === "CONFIRM_AUTHENTICATOR") {
    const input = normalizeAuthenticatorInput(value.input);
    return typeof value.code === "string" && /^(?:\d{6}|\d{8})$/u.test(value.code) && hasOnlyKeys(value, ["type", "input", "code"]) && input
      ? { type: value.type, input, code: value.code }
      : null;
  }
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
