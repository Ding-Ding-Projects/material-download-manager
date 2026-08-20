import {
  HANDOFF_PROTOCOL_VERSION,
  DOWNLOAD_CLAIMS_KEY,
  LAST_RESULT_KEY,
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  canDisableSchoolMode,
  sanitizeSettings,
  statusEndpoint,
} from "./shared/settings.js";
import {
  AUTH_PROOF_PATTERN,
  challengeProofInput,
  createHandoffEnvelope,
  decisionEndpoint,
  deriveDownloadFileName,
  handoffDecisionProofInput,
  handoffDecisionResponseProofInput,
  handoffRollbackProofInput,
  handoffRequestProofInput,
  handoffResponseProofInput,
  normalizeDownloadUrl,
  rollbackEndpoint,
  validateIncomingMessage,
} from "./shared/handoff.js";
import { localize, setActivePersonalVocabulary } from "./shared/localization.js";
import {
  PERSONAL_VOCABULARY_STORAGE_KEY,
  clearPersonalVocabulary,
  importPersonalVocabulary,
  readPersonalVocabulary,
} from "./shared/personal-vocabulary.js";
import { HANDOFF_CAPABILITY } from "./shared/pairing.js";
import { createCredentialAbstraction } from "./shared/credential.js";
import { appendDisplayNameMutation } from "./shared/mutation-journal.js";
import { createNarrator } from "./shared/narrator.js";
import { createChromeTtsAdapter } from "./shared/chrome-tts.js";
import { createAuthenticatorStore } from "./shared/authenticator-store.js";
import {
  LOGO_STORAGE_KEY,
  createActionIconImageData,
  logoDisplayDescriptor,
  rehydrateLogoRecord,
} from "./shared/logo.js";
import { createOllamaSuite, OllamaError, validateOllamaMessage } from "./shared/ollama.js";

const MENU_ID = "send-to-material-download-manager";
const STATUS_TIMEOUT_MS = 1_500;
const HANDOFF_TIMEOUT_MS = 35_000;
const MAX_STATUS_BODY = 4_096;
const MAX_DOWNLOAD_CLAIMS = 64;
const HANDOFF_CAPABILITY_KEY = "handoffCapability";
const AUTOMATIC_HANDOFF_ALARM = "material-download-manager-pending-handoff";
const PENDING_HANDOFF_POLL_DELAY_MS = 1_000;
const PENDING_HANDOFF_ALARM_PERIOD_MINUTES = 0.5;
const SUCCESS_CODES = new Set([
  "handoff-success",
  "handoff-pending",
  "automatic-awaiting-decision",
  "automatic-kept-in-browser",
  "connection-success",
  "settings-saved",
  "settings-imported",
]);
const RESULT_NARRATION_KEYS = Object.freeze({
  "handoff-success": "handoffSuccess",
  "handoff-pending": "handoffPending",
  "automatic-awaiting-decision": "automaticAwaitingDecision",
  "automatic-kept-in-browser": "automaticKeptInBrowser",
  "handoff-cleanup-warning": "handoffCleanupWarning",
  "automatic-pause-failed": "automaticPauseFailed",
  "automatic-capacity-full": "automaticCapacityFull",
  "automatic-resumed-failed": "automaticResumedFailed",
  "automatic-resume-failed": "automaticResumeFailed",
  "automatic-cancel-failed-resumed": "automaticCancelFailedResumed",
  "automatic-cancel-failed-original-gone": "automaticCancelFailedOriginalGone",
  "automatic-cancel-failed-already-running": "automaticCancelFailedAlreadyRunning",
  "automatic-cancel-recovery-failed": "automaticCancelRecoveryFailed",
  "automatic-original-gone": "automaticOriginalGone",
  "automatic-original-already-running": "automaticOriginalAlreadyRunning",
  "automatic-ownership-mismatch": "automaticOwnershipMismatch",
  "automatic-restart-resume-failed": "automaticRestartResumeFailed",
  "handoff-disabled": "handoffDisabled",
  "handoff-unpaired": "handoffUnpaired",
  "handoff-failed": "handoffFailed",
  "connection-success": "connectionSuccess",
  "connection-disabled": "connectionDisabled",
  "connection-unpaired": "connectionUnpaired",
  "connection-failed": "connectionFailed",
  "settings-saved": "settingsSaved",
  "settings-imported": "settingsImported",
  "settings-exported": "settingsExported",
  "school-mode-reset-unavailable": "schoolModeCredentialUnavailable",
  "display-name-history-unavailable": "displayNameHistoryUnavailable",
  "settings-save-failed": "settingsSaveFailed",
});
const RESULT_NARRATION_CATEGORIES = Object.freeze({
  "handoff-cleanup-warning": "warning",
  "automatic-original-gone": "warning",
  "automatic-original-already-running": "warning",
  "automatic-ownership-mismatch": "warning",
  "handoff-disabled": "info",
  "connection-disabled": "info",
  "handoff-unpaired": "warning",
  "connection-unpaired": "warning",
});
let contextMenuRefresh = Promise.resolve();
let downloadClaimMutation = Promise.resolve();
let logoMutation = Promise.resolve();
let initializationPromise = null;
// A warm worker can make a capture decision without a second storage round
// trip. The cache is deliberately empty on cold start, so a disabled setting
// is never guessed as enabled before its persisted value is read.
let cachedSettings = null;
const automaticDownloadsInFlight = new Set();
const automaticDecisionTimers = new Map();
const chromeTts = createChromeTtsAdapter(chrome.tts);
const narrator = createNarrator({
  tts: chromeTts,
  isReducedMotion: () => false,
  isScreenReaderActive: () => false,
});
const authenticatorStore = createAuthenticatorStore({ local: chrome.storage.local });
const ollamaSuite = createOllamaSuite({ local: chrome.storage.local });
let narratorSettingsGeneration = 0;

function result(code, detail = null) {
  return { ok: SUCCESS_CODES.has(code), code, detail, at: new Date().toISOString() };
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = sanitizeSettings(stored[SETTINGS_KEY]);
  cachedSettings = settings;
  return settings;
}

async function readLastResult() {
  const stored = await chrome.storage.local.get(LAST_RESULT_KEY);
  return stored[LAST_RESULT_KEY] ?? null;
}

async function refreshPersonalVocabulary() {
  const state = await readPersonalVocabulary(chrome.storage.local);
  setActivePersonalVocabulary(state.replacements);
  return state;
}

async function readLogoRecord() {
  const stored = await chrome.storage.local.get(LOGO_STORAGE_KEY);
  if (!Object.prototype.hasOwnProperty.call(stored, LOGO_STORAGE_KEY)) return { logo: null, cacheState: "default" };
  try {
    // Rehydrate from the source and controls every time. Derived cache PNGs
    // are not authoritative pixels and cannot impersonate another source.
    return { logo: await rehydrateLogoRecord(stored[LOGO_STORAGE_KEY]), cacheState: "loaded" };
  } catch {
    // A corrupt cache never partially applies. Remove only this local logo
    // key, then fall back to the shipped mark without exposing image data.
    try { await chrome.storage.local.remove?.(LOGO_STORAGE_KEY); } catch { /* A later retry retains the same fail-closed fallback. */ }
    return { logo: null, cacheState: "corrupt-reset" };
  }
}

async function applyLogoToAction(logo) {
  if (typeof chrome.action?.setIcon !== "function") throw new Error("The browser action icon API is unavailable.");
  await chrome.action.setIcon({ imageData: await createActionIconImageData(logo) });
}

async function refreshActionLogo() {
  const [settings, state] = await Promise.all([readSettings(), readLogoRecord()]);
  try {
    await applyLogoToAction(settings.schoolModeEnabled ? null : state.logo);
    return { updated: true, cacheState: state.cacheState };
  } catch {
    return { updated: false, cacheState: state.cacheState };
  }
}

function mutateLogo(mutator) {
  logoMutation = logoMutation.catch(() => {}).then(mutator);
  return logoMutation;
}

async function saveLogo(candidate) {
  return mutateLogo(async () => {
    const settings = await readSettings();
    if (settings.schoolModeEnabled) {
      const error = new Error("School mode hides custom logo controls.");
      error.code = "logo-school-mode-hidden";
      throw error;
    }
    let logo;
    try {
      logo = await rehydrateLogoRecord(candidate);
    } catch {
      const error = new Error("The logo record failed local validation.");
      error.code = "logo-invalid-record";
      throw error;
    }
    try {
      await chrome.storage.local.set({ [LOGO_STORAGE_KEY]: logo });
    } catch {
      const failure = new Error("The logo could not be saved locally.");
      failure.code = "logo-storage-failed";
      throw failure;
    }
    const action = await refreshActionLogo();
    return { logo, actionUpdated: action.updated, cacheState: action.cacheState };
  });
}

async function clearLogo() {
  return mutateLogo(async () => {
    const settings = await readSettings();
    if (settings.schoolModeEnabled) {
      const error = new Error("School mode hides custom logo controls.");
      error.code = "logo-school-mode-hidden";
      throw error;
    }
    try {
      await chrome.storage.local.remove(LOGO_STORAGE_KEY);
    } catch {
      const failure = new Error("The logo cache could not be cleared.");
      failure.code = "logo-storage-failed";
      throw failure;
    }
    const action = await refreshActionLogo();
    return { logo: null, actionUpdated: action.updated, cacheState: action.cacheState };
  });
}

async function narrateResult(value) {
  const key = RESULT_NARRATION_KEYS[value?.code];
  if (!key) return;
  const generation = narratorSettingsGeneration;
  try {
    await chromeTts.refreshVoices();
    const settings = await readSettings();
    // A storage change can cancel the queue while this event is waiting on
    // voice discovery or storage. Do not enqueue a stale language, tone, or
    // School-mode presentation after that cancellation.
    if (generation !== narratorSettingsGeneration) return;
    const category = RESULT_NARRATION_CATEGORIES[value?.code]
      ?? (value?.ok === false ? "error" : "success");
    const name = key === "schoolModeCredentialUnavailable" ? settings.schoolModeName : settings.managerName;
    narrator.narrateKey(key, settings, { name }, { category });
  } catch {
    // Narration is advisory and never blocks storage, handoff, or recovery.
  }
}

async function recordResult(value) {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: value });
  try {
    await chrome.action.setBadgeText({ text: value.ok ? "" : "!" });
    if (!value.ok) await chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
  } catch {
    // Badge APIs are not required for the handoff contract; the popup remains the recovery surface.
  }
  // Speech is advisory: never hold the handoff or settings result open on a
  // browser voice engine that is slow or unavailable.
  void narrateResult(value);
}

async function saveSettings(patch) {
  const current = await readSettings();
  const settings = sanitizeSettings({ ...current, ...patch });
  if (!canDisableSchoolMode(current, settings)) {
    const error = new Error("The School mode reset credential is unavailable.");
    error.code = "school-mode-reset-unavailable";
    throw error;
  }
  const credential = createCredentialAbstraction(current.schoolModeCredentialState);
  if (current.schoolModeEnabled && !settings.schoolModeEnabled && !credential.available) {
    const error = new Error("The School mode reset credential is unavailable.");
    error.code = "school-mode-reset-unavailable";
    throw error;
  }
  if (current.managerName !== settings.managerName) {
    await appendDisplayNameMutation(chrome.storage.local, {
      before: current.managerName,
      after: settings.managerName,
      shippedName: DEFAULT_SETTINGS.managerName,
    });
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  cachedSettings = settings;
  await refreshContextMenu(settings);
  return settings;
}

function isHandoffCapability(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

/**
 * Automatic interception accepts only an app-prepared source tree.  The
 * published ZIP intentionally has an empty pairing module, so it must never
 * pause a Chrome download and then discover that it cannot hand it off.
 */
function preparedHandoffCapability() {
  return isHandoffCapability(HANDOFF_CAPABILITY) ? HANDOFF_CAPABILITY : null;
}

async function readHandoffCapability() {
  const stored = await chrome.storage.local.get(HANDOFF_CAPABILITY_KEY);
  const preparedCapability = preparedHandoffCapability();
  if (preparedCapability) {
    if (stored[HANDOFF_CAPABILITY_KEY] !== HANDOFF_CAPABILITY) {
      await chrome.storage.local.set({ [HANDOFF_CAPABILITY_KEY]: HANDOFF_CAPABILITY });
    }
    return preparedCapability;
  }
  return isHandoffCapability(stored[HANDOFF_CAPABILITY_KEY]) ? stored[HANDOFF_CAPABILITY_KEY] : null;
}

function randomAuthNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(capability, input) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(capability),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function challengeEndpoint(handoffEndpoint, nonce) {
  try {
    const endpoint = new URL(handoffEndpoint);
    endpoint.pathname = "/v2/challenge";
    endpoint.search = "";
    endpoint.hash = "";
    endpoint.searchParams.set("nonce", nonce);
    return endpoint.toString();
  } catch {
    return null;
  }
}

async function readDownloadClaims() {
  const stored = await chrome.storage.local.get(DOWNLOAD_CLAIMS_KEY);
  const source = stored[DOWNLOAD_CLAIMS_KEY];
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const entries = Object.entries(source);
  if (entries.length > MAX_DOWNLOAD_CLAIMS) throw new Error("Automatic download claim storage exceeds its safety limit.");
  const claims = {};
  for (const [rawId, rawClaim] of entries) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 0 || !rawClaim || typeof rawClaim !== "object") continue;
    if (rawClaim.phase !== "intent" && rawClaim.phase !== "paused" && rawClaim.phase !== "pending" && rawClaim.phase !== "accepted") continue;
    if (typeof rawClaim.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(rawClaim.fingerprint)) continue;
    if (rawClaim.phase === "pending") {
      if (
        typeof rawClaim.handoffId !== "string" ||
        !/^[a-f0-9]{64}$/u.test(rawClaim.handoffId) ||
        !Number.isSafeInteger(rawClaim.expiresAt) ||
        rawClaim.expiresAt <= 0
      ) continue;
      claims[String(id)] = {
        phase: "pending",
        fingerprint: rawClaim.fingerprint,
        handoffId: rawClaim.handoffId,
        expiresAt: rawClaim.expiresAt,
      };
      continue;
    }
    claims[String(id)] = { phase: rawClaim.phase, fingerprint: rawClaim.fingerprint };
  }
  return claims;
}

function mutateDownloadClaims(mutator) {
  downloadClaimMutation = downloadClaimMutation.catch(() => {}).then(async () => {
    const claims = await readDownloadClaims();
    const mutationResult = mutator(claims);
    if (Object.keys(claims).length > MAX_DOWNLOAD_CLAIMS) throw new Error("Automatic download claim capacity was exceeded.");
    await chrome.storage.local.set({ [DOWNLOAD_CLAIMS_KEY]: claims });
    return mutationResult;
  });
  return downloadClaimMutation;
}

function reserveDownloadClaim(id, fingerprint) {
  return mutateDownloadClaims((claims) => {
    const key = String(id);
    if (claims[key] || Object.keys(claims).length >= MAX_DOWNLOAD_CLAIMS) return false;
    claims[key] = { phase: "intent", fingerprint };
    return true;
  });
}

function setDownloadClaim(id, phase, fingerprint, pending = null) {
  return mutateDownloadClaims((claims) => {
    const key = String(id);
    if (!claims[key] || claims[key].fingerprint !== fingerprint) throw new Error("Automatic download ownership claim changed unexpectedly.");
    if (phase === "pending") {
      if (!pending || typeof pending.handoffId !== "string" || !/^[a-f0-9]{64}$/u.test(pending.handoffId) || !Number.isSafeInteger(pending.expiresAt)) {
        throw new Error("Pending browser handoff metadata was invalid.");
      }
      claims[key] = { phase, fingerprint, handoffId: pending.handoffId, expiresAt: pending.expiresAt };
      return;
    }
    claims[key] = { phase, fingerprint };
  });
}

function clearDownloadClaim(id) {
  const timer = automaticDecisionTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    automaticDecisionTimers.delete(id);
  }
  return mutateDownloadClaims((claims) => { delete claims[String(id)]; });
}

async function findDownload(id) {
  const matches = await chrome.downloads.search({ id });
  return Array.isArray(matches) ? matches.find((item) => item?.id === id) ?? null : null;
}

function downloadIdentityMaterial(item) {
  const url = normalizeDownloadUrl(item?.url);
  const startTime = typeof item?.startTime === "string" && item.startTime.length > 0 && item.startTime.length <= 64
    ? item.startTime
    : null;
  return url && startTime ? `${url}\n${startTime}` : null;
}

async function fingerprintDownload(item) {
  const material = downloadIdentityMaterial(item);
  if (!material) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function matchesOwnedDownload(item, fingerprint) {
  return Boolean(item) && await fingerprintDownload(item) === fingerprint;
}

async function resumeOwnedDownload(id, fingerprint) {
  try {
    const item = await findDownload(id);
    if (!item || item.state !== "in_progress") {
      await clearDownloadClaim(id);
      return "gone";
    }
    if (!(await matchesOwnedDownload(item, fingerprint))) {
      await clearDownloadClaim(id);
      return "mismatch";
    }
    if (item.paused !== true) {
      await clearDownloadClaim(id);
      return "already-running";
    }
    await chrome.downloads.resume(id);
    await clearDownloadClaim(id);
    return "resumed";
  } catch {
    return "failed";
  }
}

function recoveryResultCode(recovery, resumedCode) {
  if (recovery === "resumed") return resumedCode;
  if (recovery === "gone") return "automatic-original-gone";
  if (recovery === "already-running") return "automatic-original-already-running";
  if (recovery === "mismatch") return "automatic-ownership-mismatch";
  return "automatic-resume-failed";
}

function schedulePendingDecisionPoll(id, delayMs = PENDING_HANDOFF_POLL_DELAY_MS) {
  const previous = automaticDecisionTimers.get(id);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    automaticDecisionTimers.delete(id);
    void pollPendingBrowserHandoff(id);
  }, Math.max(0, delayMs));
  automaticDecisionTimers.set(id, timer);
}

async function readPendingHandoffDecision(settings, claim) {
  const capability = await readHandoffCapability();
  if (!capability) throw new Error("The app-prepared handoff capability is unavailable.");
  const endpoint = decisionEndpoint(settings.handoffEndpoint, claim.handoffId);
  if (!endpoint) throw new Error("The browser handoff decision endpoint is invalid.");
  endpoint.searchParams.set("proof", await hmacHex(capability, handoffDecisionProofInput(claim.handoffId)));
  const response = await fetchWithTimeout(endpoint.toString(), { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`The Start download decision returned HTTP ${response.status}.`);
  const text = await readLimitedText(response);
  if (!text) throw new Error("The Start download decision response was empty or too large.");
  const body = JSON.parse(text);
  if (
    body?.protocol !== HANDOFF_PROTOCOL_VERSION ||
    body?.handoffId !== claim.handoffId ||
    !["pending", "accepted", "rejected", "expired"].includes(body?.state) ||
    (body?.downloadId !== null && (typeof body?.downloadId !== "string" || body.downloadId.length === 0 || body.downloadId.length > 128)) ||
    (body?.state === "accepted" && typeof body?.downloadId !== "string") ||
    !Number.isSafeInteger(body?.expiresAt) ||
    typeof body?.proof !== "string" ||
    !AUTH_PROOF_PATTERN.test(body.proof)
  ) {
    throw new Error("The Start download decision response was invalid.");
  }
  const expectedProof = await hmacHex(
    capability,
    handoffDecisionResponseProofInput(claim.handoffId, body.state, body.downloadId),
  );
  if (body.proof !== expectedProof) throw new Error("The Start download decision response could not prove the app-installed capability.");
  return body;
}

async function rollbackAcceptedBrowserHandoff(settings, claim, downloadId) {
  try {
    const capability = await readHandoffCapability();
    if (!capability) return false;
    const endpoint = rollbackEndpoint(settings.handoffEndpoint, claim.handoffId);
    if (!endpoint) return false;
    const proof = await hmacHex(capability, handoffRollbackProofInput(claim.handoffId, downloadId));
    const response = await fetchWithTimeout(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ downloadId, proof }),
    });
    if (!response.ok) return false;
    const text = await readLimitedText(response);
    if (!text) return false;
    const body = JSON.parse(text);
    if (
      body?.protocol !== HANDOFF_PROTOCOL_VERSION ||
      body?.handoffId !== claim.handoffId ||
      body?.state !== "rejected" ||
      body?.downloadId !== null ||
      !Number.isSafeInteger(body?.expiresAt) ||
      typeof body?.proof !== "string" ||
      !AUTH_PROOF_PATTERN.test(body.proof)
    ) {
      return false;
    }
    const expectedProof = await hmacHex(
      capability,
      handoffDecisionResponseProofInput(claim.handoffId, body.state, body.downloadId),
    );
    return body.proof === expectedProof;
  } catch {
    return false;
  }
}

async function pollPendingBrowserHandoff(id) {
  if (automaticDownloadsInFlight.has(id)) return;
  automaticDownloadsInFlight.add(id);
  try {
    const claim = (await readDownloadClaims())[String(id)];
    if (!claim || claim.phase !== "pending") return;

    const item = await findDownload(id);
    if (!item || item.state !== "in_progress") {
      await clearDownloadClaim(id);
      return;
    }
    if (!(await matchesOwnedDownload(item, claim.fingerprint))) {
      await clearDownloadClaim(id);
      await recordResult(result("automatic-ownership-mismatch"));
      return;
    }
    if (item.paused !== true) {
      await clearDownloadClaim(id);
      await recordResult(result("automatic-original-already-running"));
      return;
    }

    if (claim.expiresAt <= Date.now()) {
      const recovery = await resumeOwnedDownload(id, claim.fingerprint);
      await recordResult(result(recoveryResultCode(recovery, "automatic-kept-in-browser")));
      return;
    }

    const settings = await readSettings();
    const decision = await readPendingHandoffDecision(settings, claim);
    if (decision.state === "pending") {
      schedulePendingDecisionPoll(id, Math.min(PENDING_HANDOFF_POLL_DELAY_MS, Math.max(0, claim.expiresAt - Date.now())));
      return;
    }
    if (decision.state === "accepted") {
      const handoffResult = await finishAcceptedDownload(id, result("handoff-success"), claim.fingerprint, {
        settings,
        claim,
        downloadId: decision.downloadId,
      });
      await recordResult(handoffResult);
      if (handoffResult.code === "automatic-cancel-recovery-failed") schedulePendingDecisionPoll(id);
      return;
    }
    const recovery = await resumeOwnedDownload(id, claim.fingerprint);
    await recordResult(result(recoveryResultCode(recovery, "automatic-kept-in-browser")));
  } catch {
    const claim = (await readDownloadClaims().catch(() => ({})))[String(id)];
    if (claim?.phase === "pending" && claim.expiresAt <= Date.now()) {
      const recovery = await resumeOwnedDownload(id, claim.fingerprint);
      await recordResult(result(recoveryResultCode(recovery, "automatic-kept-in-browser")));
      return;
    }
    if (claim?.phase === "pending") schedulePendingDecisionPoll(id);
  } finally {
    automaticDownloadsInFlight.delete(id);
  }
}

async function finishAcceptedDownload(id, acceptedResult, fingerprint, rollback = null) {
  const item = await findDownload(id);
  if (!item || item.state !== "in_progress" || item.paused !== true || !(await matchesOwnedDownload(item, fingerprint))) {
    await clearDownloadClaim(id);
    return result("automatic-ownership-mismatch");
  }
  try {
    await chrome.downloads.cancel(id);
  } catch {
    if (!rollback || !(await rollbackAcceptedBrowserHandoff(rollback.settings, rollback.claim, rollback.downloadId))) {
      // Keep Chrome paused if the desktop transfer cannot be removed. Resuming
      // it before a verified rollback would create two simultaneous copies.
      return result("automatic-cancel-recovery-failed");
    }
    const recovery = await resumeOwnedDownload(id, fingerprint);
    if (recovery === "resumed") return result("automatic-kept-in-browser");
    if (recovery === "gone") return result("automatic-cancel-failed-original-gone");
    if (recovery === "already-running") return result("automatic-kept-in-browser");
    if (recovery === "mismatch") return result("automatic-ownership-mismatch");
    return result("automatic-cancel-recovery-failed");
  }

  let eraseFailed = false;
  try {
    await chrome.downloads.erase({ id });
  } catch {
    eraseFailed = true;
  }
  await clearDownloadClaim(id);
  return eraseFailed
    ? result("handoff-cleanup-warning")
    : acceptedResult;
}

function automaticDownloadUrl(item) {
  return normalizeDownloadUrl(item?.finalUrl || item?.url);
}

function isEligibleAutomaticDownload(item, settings) {
  return settings.autoCaptureDownloads === true
    && Boolean(settings.handoffEndpoint)
    && Number.isInteger(item?.id)
    && item.id >= 0
    && item.incognito !== true
    // Chrome can report exists:false before it has created the target file.
    // Capture is intentionally based on the in-progress download identity,
    // not on a file that does not exist yet.
    && item.paused !== true
    && item.state === "in_progress"
    && !item.byExtensionId
    && Boolean(automaticDownloadUrl(item))
    && Boolean(downloadIdentityMaterial(item));
}

async function captureAutomaticDownload(item) {
  if (!Number.isInteger(item?.id) || automaticDownloadsInFlight.has(item.id)) return;
  automaticDownloadsInFlight.add(item.id);
  let fingerprint = null;
  let claimReserved = false;
  let pauseCompleted = false;
  try {
    const cachedCaptureSettings = cachedSettings;
    if (cachedCaptureSettings && !isEligibleAutomaticDownload(item, cachedCaptureSettings)) return;
    // Do this before any storage or cryptographic work. The public ZIP has no
    // compiled pairing value, so its ordinary Chrome downloads remain entirely
    // untouched instead of producing a pause/resume blink with no Start window.
    const capability = preparedHandoffCapability();
    if (!capability) {
      const settings = cachedCaptureSettings ?? await readSettings();
      if (!isEligibleAutomaticDownload(item, settings)) return;
      await recordResult(result("handoff-unpaired"));
      return;
    }
    const fingerprintPromise = fingerprintDownload(item).catch(() => null);
    // Prefer the live cache after initialization. A cold worker still reads
    // persisted settings before it reserves or pauses anything, so turning
    // automatic capture off remains authoritative.
    const settings = cachedCaptureSettings ?? await readSettings();
    if (!isEligibleAutomaticDownload(item, settings)) return;
    const url = automaticDownloadUrl(item);
    fingerprint = await fingerprintPromise;
    if (!fingerprint) return;
    claimReserved = await reserveDownloadClaim(item.id, fingerprint);
    if (!claimReserved) {
      await recordResult(result("automatic-capacity-full"));
      return;
    }
    await chrome.downloads.pause(item.id);
    pauseCompleted = true;
    await setDownloadClaim(item.id, "paused", fingerprint);

    const handoffResult = await handoffUrl({
      url,
      fileName: deriveDownloadFileName(url),
    }, settings, capability);
    if (
      handoffResult.code === "handoff-pending" &&
      handoffResult.detail &&
      typeof handoffResult.detail.handoffId === "string" &&
      /^[a-f0-9]{64}$/u.test(handoffResult.detail.handoffId) &&
      Number.isSafeInteger(handoffResult.detail.expiresAt)
    ) {
      await setDownloadClaim(item.id, "pending", fingerprint, handoffResult.detail);
      schedulePendingDecisionPoll(item.id);
      await recordResult(result("automatic-awaiting-decision"));
      return;
    }

    const recovery = await resumeOwnedDownload(item.id, fingerprint);
    await recordResult(result(recoveryResultCode(recovery, "automatic-resumed-failed")));
  } catch {
    if (!claimReserved || !fingerprint) {
      await recordResult(result("automatic-pause-failed"));
      return;
    }
    const recovery = await resumeOwnedDownload(item.id, fingerprint);
    await recordResult(result(
      pauseCompleted
        ? recoveryResultCode(recovery, "automatic-resumed-failed")
        : (recovery === "resumed" || recovery === "already-running"
          ? "automatic-pause-failed"
          : recoveryResultCode(recovery, "automatic-pause-failed")),
    ));
  } finally {
    automaticDownloadsInFlight.delete(item.id);
  }
}

async function recoverAutomaticDownloads() {
  const claims = await readDownloadClaims();
  for (const [rawId, claim] of Object.entries(claims)) {
    const id = Number(rawId);
    if (claim.phase === "pending") {
      schedulePendingDecisionPoll(id, 0);
      continue;
    }
    if (automaticDownloadsInFlight.has(id)) continue;
    automaticDownloadsInFlight.add(id);
    try {
      if (claim.phase === "accepted") {
        await recordResult(await finishAcceptedDownload(id, result("handoff-success"), claim.fingerprint));
      } else {
        const recovery = await resumeOwnedDownload(id, claim.fingerprint);
        if (recovery !== "resumed") {
          await recordResult(result(
            recovery === "failed"
              ? "automatic-restart-resume-failed"
              : recoveryResultCode(recovery, "automatic-restart-resumed"),
          ));
        }
      }
    } finally {
      automaticDownloadsInFlight.delete(id);
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = STATUS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedText(response) {
  if (!response.body) {
    const text = await response.text();
    return text.length <= MAX_STATUS_BODY ? text : null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > MAX_STATUS_BODY) {
      await reader.cancel();
      return null;
    }
  }
  return text + decoder.decode();
}

async function authenticateEndpoint(settings, capability) {
  const nonce = randomAuthNonce();
  const endpoint = challengeEndpoint(settings.handoffEndpoint, nonce);
  if (!endpoint) throw new Error("The loopback challenge endpoint is invalid.");
  const response = await fetchWithTimeout(endpoint, { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`The loopback challenge returned HTTP ${response.status}.`);
  const text = await readLimitedText(response);
  if (!text) throw new Error("The loopback challenge response was empty or too large.");
  const body = JSON.parse(text);
  if (body?.protocol !== HANDOFF_PROTOCOL_VERSION || body?.nonce !== nonce || typeof body?.proof !== "string" || !AUTH_PROOF_PATTERN.test(body.proof)) {
    throw new Error("The loopback challenge response was invalid.");
  }
  const expectedProof = await hmacHex(capability, challengeProofInput(nonce));
  if (body.proof !== expectedProof) throw new Error("The loopback peer could not prove the app-installed capability.");
  return nonce;
}

async function checkConnection(settings) {
  const endpoint = statusEndpoint(settings.handoffEndpoint);
  if (!endpoint) return result("connection-disabled");
  try {
    const response = await fetchWithTimeout(endpoint, { method: "GET", headers: { Accept: "application/json" } });
    if (!response.ok) return result("connection-failed", `HTTP ${response.status}`);
    const body = await readLimitedText(response);
    if (!body) return result("connection-failed", "The status response was empty or too large.");
    const parsed = JSON.parse(body);
    if (parsed?.protocol !== HANDOFF_PROTOCOL_VERSION || parsed?.acceptingUrls !== true) {
      return result("connection-failed", `The status response did not advertise protocol ${HANDOFF_PROTOCOL_VERSION}.`);
    }
    const capability = await readHandoffCapability();
    if (!capability) return result("connection-unpaired");
    await authenticateEndpoint(settings, capability);
    return result("connection-success");
  } catch (error) {
    return result("connection-failed", error instanceof Error && error.name === "AbortError" ? "Timed out after 1500 ms." : "The loopback endpoint could not be reached.");
  }
}

async function handoffUrl(message, settings, preparedCapability = null) {
  if (!settings.handoffEndpoint) return result("handoff-disabled");
  const capability = preparedCapability ?? await readHandoffCapability();
  if (!capability) return result("handoff-unpaired");
  let body;
  try {
    body = createHandoffEnvelope(message.url, {
      title: message.title,
      selectionText: message.selectionText,
      fileName: message.fileName,
    });
  } catch {
    return result("handoff-failed", "The URL or metadata failed local validation.");
  }

  try {
    const authNonce = await authenticateEndpoint(settings, capability);
    body = {
      ...body,
      authNonce,
      authProof: await hmacHex(capability, handoffRequestProofInput(body, authNonce)),
    };
    const response = await fetchWithTimeout(settings.handoffEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    }, HANDOFF_TIMEOUT_MS);
    if (!response.ok) return result("handoff-failed", `HTTP ${response.status}`);
    const responseText = await readLimitedText(response);
    if (!responseText) return result("handoff-failed", "The manager returned an empty handoff response.");
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      return result("handoff-failed", "The manager returned an invalid handoff response.");
    }
    if (responseBody?.protocol !== HANDOFF_PROTOCOL_VERSION) {
      return result("handoff-failed", "The manager returned an unsupported handoff protocol.");
    }
    if (
      responseBody.accepted !== true ||
      responseBody.state !== "pending" ||
      typeof responseBody.handoffId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(responseBody.handoffId) ||
      !Number.isSafeInteger(responseBody.expiresAt) ||
      responseBody.expiresAt <= Date.now() ||
      typeof responseBody.proof !== "string" ||
      !AUTH_PROOF_PATTERN.test(responseBody.proof)
    ) {
      return result("handoff-failed", "The manager did not create a Start download decision.");
    }
    const expectedResponseProof = await hmacHex(capability, handoffResponseProofInput(body.authNonce, responseBody.handoffId));
    if (responseBody.proof !== expectedResponseProof) {
      return result("handoff-failed", "The loopback response did not prove the app-installed capability.");
    }
    return result("handoff-pending", { handoffId: responseBody.handoffId, expiresAt: responseBody.expiresAt });
  } catch (error) {
    return result("handoff-failed", error instanceof Error && error.name === "AbortError" ? `Timed out after ${HANDOFF_TIMEOUT_MS} ms.` : "The authenticated loopback endpoint could not be reached.");
  }
}

function refreshContextMenu(settings) {
  contextMenuRefresh = contextMenuRefresh.catch(() => {}).then(async () => {
    const effectiveSettings = settings ?? await readSettings();
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: MENU_ID,
      title: `${localize("sendUrl", effectiveSettings)} · ${effectiveSettings.managerName}`,
      contexts: ["page", "link", "selection"],
    });
  });
  return contextMenuRefresh;
}

function initialize() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const settings = await readSettings();
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      await refreshPersonalVocabulary();
      await refreshContextMenu(settings);
      try {
        await chrome.alarms.create(AUTOMATIC_HANDOFF_ALARM, { periodInMinutes: PENDING_HANDOFF_ALARM_PERIOD_MINUTES });
      } catch {
        // Timer polling still handles the normal path.  The next worker event
        // retries recovery if this browser does not expose alarms.
      }
      await refreshActionLogo();
      await recoverAutomaticDownloads();
      await ollamaSuite.reconcilePulls();
      void ollamaSuite.runPullQueue().catch(() => {});
    })();
  }
  return initializationPromise;
}

async function initializeSafely() {
  try {
    await initialize();
  } catch {
    initializationPromise = null;
    try {
      await recordResult(result("handoff-failed", "The extension worker could not initialize its local state."));
    } catch {
      // Storage may itself be unavailable. A later worker event retries initialization.
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initializeSafely();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeSafely();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name === AUTOMATIC_HANDOFF_ALARM) void recoverAutomaticDownloads().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[PERSONAL_VOCABULARY_STORAGE_KEY]) {
    void refreshPersonalVocabulary()
      .then(readSettings)
      .then(refreshContextMenu)
      .catch(() => setActivePersonalVocabulary(null));
  }
  if (changes[SETTINGS_KEY]) {
    const settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
    cachedSettings = settings;
    // Revalidate every narrator-affecting setting change, including School mode,
    // language, funny levels, sound, and reduced-motion state. This prevents an
    // in-flight event from speaking with stale language or tone after a change.
    narratorSettingsGeneration += 1;
    narrator.cancel();
    void refreshContextMenu(settings);
    void mutateLogo(refreshActionLogo);
  }
  if (changes[LOGO_STORAGE_KEY]) {
    void mutateLogo(refreshActionLogo);
  }
});

chrome.downloads.onCreated.addListener((item) => {
  void captureAutomaticDownload(item);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const message = validateIncomingMessage({
    type: "HANDOFF_URL",
    url: info.linkUrl || info.pageUrl,
    title: tab?.title,
    selectionText: info.selectionText,
  });
  if (!message) {
    void recordResult(result("handoff-failed", "The context-menu target was not a usable URL."));
    return;
  }
  void readSettings()
    .then((settings) => handoffUrl(message, settings))
    .then(recordResult)
    .catch(() => recordResult(result("handoff-failed", "The extension worker could not complete the handoff.")));
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Untrusted extension sender." });
    return false;
  }
  const message = validateIncomingMessage(rawMessage) ?? validateOllamaMessage(rawMessage);
  if (!message) {
    sendResponse({ ok: false, error: "Invalid extension message." });
    return false;
  }

  void (async () => {
    if (message.type === "GET_OLLAMA_STATE") {
      sendResponse(await ollamaSuite.state());
      return;
    }
    if (message.type === "REFRESH_OLLAMA") {
      sendResponse(await ollamaSuite.refresh());
      return;
    }
    if (message.type === "SAVE_OLLAMA_CONFIG") {
      sendResponse(await ollamaSuite.configure(message.config));
      return;
    }
    if (message.type === "INSPECT_OLLAMA_MODEL") {
      sendResponse(await ollamaSuite.inspect(message.model));
      return;
    }
    if (message.type === "ADD_OLLAMA_PULL") {
      sendResponse(await ollamaSuite.enqueuePull(message.model));
      return;
    }
    if (message.type === "RUN_OLLAMA_PULL_QUEUE") {
      void ollamaSuite.runPullQueue().catch(() => {});
      sendResponse({ ok: true, code: "ollama-pull-run-requested" });
      return;
    }
    if (message.type === "CANCEL_OLLAMA_PULL") {
      sendResponse(await ollamaSuite.cancelPull(message.id));
      return;
    }
    if (message.type === "RETRY_OLLAMA_PULL") {
      sendResponse(await ollamaSuite.retryPull(message.id));
      return;
    }
    if (message.type === "DELETE_OLLAMA_MODEL") {
      sendResponse(await ollamaSuite.deleteModel(message.model));
      return;
    }
    if (message.type === "COPY_OLLAMA_MODEL") {
      sendResponse(await ollamaSuite.copyModel(message.source, message.destination));
      return;
    }
    if (message.type === "CREATE_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.createChat(message.model, message.systemPrompt));
      return;
    }
    if (message.type === "SEND_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.sendChat(message.id, message.prompt, message.options, message.attachments));
      return;
    }
    if (message.type === "STOP_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.stopChat(message.id));
      return;
    }
    if (message.type === "RETRY_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.retryChat(message.id));
      return;
    }
    if (message.type === "RENAME_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.renameChat(message.id, message.title));
      return;
    }
    if (message.type === "DELETE_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.deleteChat(message.id));
      return;
    }
    if (message.type === "EXPORT_OLLAMA_CHAT") {
      sendResponse(await ollamaSuite.exportChat(message.id));
      return;
    }
    if (message.type === "GET_OLLAMA_HARNESS_BOUNDARY") {
      sendResponse(ollamaSuite.harnessBoundary());
      return;
    }
    if (message.type === "GET_STATE") {
      const [personalVocabulary, settings, logoState, lastResult] = await Promise.all([refreshPersonalVocabulary(), readSettings(), readLogoRecord(), readLastResult()]);
      const visibleLogo = settings.schoolModeEnabled ? null : logoState.logo;
      sendResponse({ ok: true, settings, lastResult, personalVocabulary: { status: personalVocabulary.status }, logo: logoDisplayDescriptor(visibleLogo), logoCacheState: logoState.cacheState, logoSchoolModeSuppressed: settings.schoolModeEnabled });
      return;
    }
    if (message.type === "GET_PERSONAL_VOCABULARY_STATE") {
      const personalVocabulary = await refreshPersonalVocabulary();
      sendResponse({ ok: true, result: { ok: personalVocabulary.status === "loaded", status: personalVocabulary.status } });
      return;
    }
    if (message.type === "IMPORT_PERSONAL_VOCABULARY") {
      try {
        const imported = await importPersonalVocabulary(chrome.storage.local, message.text);
        setActivePersonalVocabulary(imported.replacements);
        sendResponse({ ok: true, result: { ok: true, status: imported.status } });
      } catch (error) {
        sendResponse({ ok: false, result: { ok: false, status: "rejected", code: error?.code === "personal-vocabulary-too-large" ? "personal-vocabulary-too-large" : "personal-vocabulary-rejected" } });
      }
      return;
    }
    if (message.type === "CLEAR_PERSONAL_VOCABULARY") {
      await clearPersonalVocabulary(chrome.storage.local);
      setActivePersonalVocabulary(null);
      sendResponse({ ok: true, result: { ok: true, status: "empty" } });
      return;
    }
    if (message.type === "GET_LOGO") {
      const [settings, state] = await Promise.all([readSettings(), readLogoRecord()]);
      const visibleLogo = settings.schoolModeEnabled ? null : state.logo;
      sendResponse({ ok: true, logo: visibleLogo, display: logoDisplayDescriptor(visibleLogo), cacheState: state.cacheState, schoolModeSuppressed: settings.schoolModeEnabled });
      return;
    }
    if (message.type === "SAVE_LOGO") {
      try {
        const saved = await saveLogo(message.logo);
        sendResponse({ ok: true, logo: saved.logo, display: logoDisplayDescriptor(saved.logo), actionUpdated: saved.actionUpdated, cacheState: saved.cacheState });
      } catch (error) {
        const code = ["logo-storage-failed", "logo-school-mode-hidden"].includes(error?.code) ? error.code : "logo-invalid-record";
        sendResponse({ ok: false, result: { ok: false, code } });
      }
      return;
    }
    if (message.type === "CLEAR_LOGO") {
      try {
        const cleared = await clearLogo();
        sendResponse({ ok: true, logo: null, display: logoDisplayDescriptor(null), actionUpdated: cleared.actionUpdated, cacheState: cleared.cacheState });
      } catch (error) {
        sendResponse({ ok: false, result: { ok: false, code: error?.code === "logo-school-mode-hidden" ? "logo-school-mode-hidden" : "logo-storage-failed" } });
      }
      return;
    }
    if (message.type === "GET_AUTHENTICATOR_STATE") {
      try {
        sendResponse({ ok: true, result: await authenticatorStore.state() });
      } catch {
        sendResponse({ ok: false, result: { ok: false, code: "authenticator-storage-corrupt" } });
      }
      return;
    }
    if (message.type === "PREPARE_AUTHENTICATOR") {
      try {
        sendResponse({ ok: true, result: await authenticatorStore.prepare(message.input) });
      } catch {
        sendResponse({ ok: false, result: { ok: false, code: "authenticator-invalid-registration" } });
      }
      return;
    }
    if (message.type === "CANCEL_AUTHENTICATOR") {
      await authenticatorStore.cancelPending();
      sendResponse({ ok: true, result: { ok: true, code: "authenticator-pending-cleared" } });
      return;
    }
    if (message.type === "CONFIRM_AUTHENTICATOR") {
      try {
        const confirmation = await authenticatorStore.confirm(message.input, message.code);
        sendResponse({ ok: confirmation.ok, result: confirmation });
      } catch {
        sendResponse({ ok: false, result: { ok: false, code: "authenticator-storage-failed" } });
      }
      return;
    }
    if (message.type === "GET_AUTHENTICATOR_CODE") {
      try {
        const code = await authenticatorStore.getCode(message.id);
        sendResponse({ ok: code.ok, result: code });
      } catch (error) {
        const corrupt = /corrupt|safety limit/iu.test(String(error?.message ?? ""));
        sendResponse({ ok: false, result: { ok: false, code: corrupt ? "authenticator-storage-corrupt" : "authenticator-code-unavailable" } });
      }
      return;
    }
    if (message.type === "REMOVE_AUTHENTICATOR") {
      try {
        const removed = await authenticatorStore.remove(message.id);
        sendResponse({ ok: removed.ok, result: removed });
      } catch (error) {
        const corrupt = /corrupt|safety limit/iu.test(String(error?.message ?? ""));
        sendResponse({ ok: false, result: { ok: false, code: corrupt ? "authenticator-storage-corrupt" : "authenticator-storage-failed" } });
      }
      return;
    }
    if (message.type === "EXPORT_AUTHENTICATOR_METADATA") {
      try {
        sendResponse({ ok: true, result: { ok: true, code: "authenticator-metadata-export", records: await authenticatorStore.exportMetadata() } });
      } catch {
        sendResponse({ ok: false, result: { ok: false, code: "authenticator-storage-corrupt" } });
      }
      return;
    }
    if (message.type === "TEST_NARRATION") {
      const settings = await readSettings();
      await chromeTts.refreshVoices();
      const narratorLanguages = settings.schoolModeEnabled || settings.narratorLanguage === "en"
        ? ["en"]
        : settings.narratorLanguage === "yue" ? ["yue"] : ["en", "yue"];
      const hasVoice = chromeTts.isAvailable() && narratorLanguages.every((language) => chromeTts.supportsLanguage(language));
      const spoken = hasVoice
        ? narrator.narrateKey("narratorTest", settings, {}, { category: "info" })
        : { accepted: false, reason: "unsupported" };
      const testResult = spoken.accepted
        ? { ok: true, code: "narrator-test-queued", reason: null }
        : {
          ok: false,
          code: spoken.reason === "disabled"
            ? "narrator-disabled"
            : spoken.reason === "queue-full"
              ? "narrator-queue-full"
              : spoken.reason === "unsupported" ? "narrator-unavailable" : "narrator-suppressed",
          reason: spoken.reason,
        };
      sendResponse({ ok: testResult.ok, result: testResult, settings });
      return;
    }
    if (message.type === "SAVE_SETTINGS") {
      try {
        const settings = await saveSettings(message.settings);
        const saved = result("settings-saved");
        await recordResult(saved);
        sendResponse({ ok: true, settings, result: saved });
      } catch (error) {
        const failed = result(error?.code === "school-mode-reset-unavailable"
          ? "school-mode-reset-unavailable"
          : error?.code === "display-name-history-unavailable"
            ? "display-name-history-unavailable"
            : "settings-save-failed");
        try { await recordResult(failed); } catch { /* Keep the live settings unchanged if storage is failing. */ }
        sendResponse({ ok: false, error: failed.code, result: failed });
      }
      return;
    }
    const settings = await readSettings();
    const nextResult = message.type === "TEST_HANDOFF" ? await checkConnection(settings) : await handoffUrl(message, settings);
    await recordResult(nextResult);
    sendResponse({ ok: true, result: nextResult, settings });
  })().catch((error) => {
    const code = error instanceof OllamaError ? error.code : "extension-request-failed";
    const detail = error instanceof OllamaError ? error.message : "The extension worker could not complete the request.";
    sendResponse({ ok: false, code, detail });
  });
  return true;
});

void initializeSafely();
