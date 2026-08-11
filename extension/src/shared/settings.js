import { RESET_CREDENTIAL_STATES, normalizeCredentialState } from "./credential.js";

export const SETTINGS_KEY = "settings";
export const LAST_RESULT_KEY = "lastResult";
export const DOWNLOAD_CLAIMS_KEY = "automaticDownloadClaims";
export const SETTINGS_EXPORT_SCHEMA = "material-download-manager-extension-settings";
export const SETTINGS_EXPORT_VERSION = 1;
export const HANDOFF_PROTOCOL_VERSION = 2;
export const HANDOFF_PATH = "/v1/downloads";
export const STATUS_PATH = "/v1/status";
export const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const DEFAULT_HANDOFF_ENDPOINT = "http://127.0.0.1:43771/v1/downloads";
export const DEFAULT_SCHOOL_MODE_NAME = "School mode";

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  managerName: "Material Download Manager",
  schoolModeEnabled: false,
  schoolModeName: DEFAULT_SCHOOL_MODE_NAME,
  schoolModeCredentialState: RESET_CREDENTIAL_STATES.UNAVAILABLE,
  showEmojis: false,
  languageMode: "en",
  funnyLevelEn: 2,
  funnyLevelYue: 2,
  autoCaptureDownloads: true,
  handoffEndpoint: DEFAULT_HANDOFF_ENDPOINT,
});

const LANGUAGE_MODES = new Set(["en", "yue", "bilingual"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampLevel(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) return fallback;
  return number;
}

export function sanitizeManagerName(value) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || DEFAULT_SETTINGS.managerName;
}

export function sanitizeSchoolModeName(value) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || DEFAULT_SCHOOL_MODE_NAME;
}

export function validateEndpoint(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return { valid: true, value: "", error: null };
  if (raw.length > 256) {
    return { valid: false, value: "", error: "The endpoint must be 256 characters or fewer." };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, value: "", error: "Use http://127.0.0.1:<port>/v1/downloads or http://localhost:<port>/v1/downloads." };
  }

  if (url.protocol !== "http:") {
    return { valid: false, value: "", error: "Only plain HTTP on the loopback computer is supported." };
  }
  if (!ALLOWED_LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return { valid: false, value: "", error: "The endpoint host must be 127.0.0.1 or localhost." };
  }
  if (!url.port || Number(url.port) < 1 || Number(url.port) > 65535) {
    return { valid: false, value: "", error: "Include an explicit port from 1 to 65535." };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { valid: false, value: "", error: "Credentials, query strings, and fragments are not allowed." };
  }
  if (url.pathname !== HANDOFF_PATH) {
    return { valid: false, value: "", error: `The path must be exactly ${HANDOFF_PATH}.` };
  }

  return {
    valid: true,
    value: `http://${url.hostname.toLowerCase()}:${url.port}${HANDOFF_PATH}`,
    error: null,
  };
}

export function statusEndpoint(endpoint) {
  const result = validateEndpoint(endpoint);
  if (!result.valid || !result.value) return "";
  return result.value.replace(HANDOFF_PATH, STATUS_PATH);
}

export function sanitizeSettings(value) {
  const source = isRecord(value) ? value : {};
  const endpointInput = Object.prototype.hasOwnProperty.call(source, "handoffEndpoint")
    ? source.handoffEndpoint
    : DEFAULT_SETTINGS.handoffEndpoint;
  const endpoint = validateEndpoint(endpointInput);
  return {
    schemaVersion: 1,
    managerName: sanitizeManagerName(source.managerName),
    schoolModeEnabled: typeof source.schoolModeEnabled === "boolean"
      ? source.schoolModeEnabled
      : DEFAULT_SETTINGS.schoolModeEnabled,
    schoolModeName: sanitizeSchoolModeName(source.schoolModeName),
    schoolModeCredentialState: normalizeCredentialState(source.schoolModeCredentialState),
    showEmojis: typeof source.showEmojis === "boolean"
      ? source.showEmojis
      : DEFAULT_SETTINGS.showEmojis,
    languageMode: LANGUAGE_MODES.has(source.languageMode) ? source.languageMode : DEFAULT_SETTINGS.languageMode,
    funnyLevelEn: clampLevel(source.funnyLevelEn, DEFAULT_SETTINGS.funnyLevelEn),
    funnyLevelYue: clampLevel(source.funnyLevelYue, DEFAULT_SETTINGS.funnyLevelYue),
    autoCaptureDownloads: typeof source.autoCaptureDownloads === "boolean"
      ? source.autoCaptureDownloads
      : DEFAULT_SETTINGS.autoCaptureDownloads,
    handoffEndpoint: endpoint.valid ? endpoint.value : "",
  };
}

export function presentationSettings(value) {
  const safe = sanitizeSettings(value);
  if (!safe.schoolModeEnabled) return safe;
  return {
    ...safe,
    languageMode: "en",
    funnyLevelEn: 1,
    funnyLevelYue: 1,
    showEmojis: false,
  };
}

export function canDisableSchoolMode(current, next) {
  const previous = sanitizeSettings(current);
  const candidate = sanitizeSettings(next);
  if (!previous.schoolModeEnabled || candidate.schoolModeEnabled) return true;
  return candidate.schoolModeCredentialState === RESET_CREDENTIAL_STATES.CONFIGURED;
}

export function makeSettingsExport(settings) {
  return {
    schema: SETTINGS_EXPORT_SCHEMA,
    version: SETTINGS_EXPORT_VERSION,
    settings: sanitizeSettings(settings),
  };
}

export function parseSettingsExport(value) {
  if (!isRecord(value) || value.schema !== SETTINGS_EXPORT_SCHEMA || value.version !== SETTINGS_EXPORT_VERSION) {
    throw new Error("This file is not a compatible Material Download Manager extension settings export.");
  }
  if (!isRecord(value.settings)) throw new Error("The exported settings value is missing.");
  const endpoint = validateEndpoint(value.settings.handoffEndpoint);
  if (!endpoint.valid) throw new Error(`The exported endpoint is invalid: ${endpoint.error}`);
  return sanitizeSettings(value.settings);
}
