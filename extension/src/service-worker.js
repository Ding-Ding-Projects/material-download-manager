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
  deriveDownloadFileName,
  handoffRequestProofInput,
  handoffResponseProofInput,
  normalizeDownloadUrl,
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

const MENU_ID = "send-to-material-download-manager";
const STATUS_TIMEOUT_MS = 1_500;
const HANDOFF_TIMEOUT_MS = 35_000;
const MAX_STATUS_BODY = 4_096;
const MAX_DOWNLOAD_CLAIMS = 64;
const HANDOFF_CAPABILITY_KEY = "handoffCapability";
const SUCCESS_CODES = new Set(["handoff-success", "connection-success", "settings-saved", "settings-imported"]);
const RESULT_NARRATION_KEYS = Object.freeze({
  "handoff-success": "handoffSuccess",
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
let initializationPromise = null;
const automaticDownloadsInFlight = new Set();
const chromeTts = createChromeTtsAdapter(chrome.tts);
const narrator = createNarrator({
  tts: chromeTts,
  isReducedMotion: () => false,
  isScreenReaderActive: () => false,
});
const authenticatorStore = createAuthenticatorStore({ local: chrome.storage.local });
let narratorSettingsGeneration = 0;

function result(code, detail = null) {
  return { ok: SUCCESS_CODES.has(code), code, detail, at: new Date().toISOString() };
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
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
  await refreshContextMenu(settings);
  return settings;
}

function isHandoffCapability(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

async function readHandoffCapability() {
  const stored = await chrome.storage.local.get(HANDOFF_CAPABILITY_KEY);
  if (isHandoffCapability(HANDOFF_CAPABILITY)) {
    if (stored[HANDOFF_CAPABILITY_KEY] !== HANDOFF_CAPABILITY) {
      await chrome.storage.local.set({ [HANDOFF_CAPABILITY_KEY]: HANDOFF_CAPABILITY });
    }
    return HANDOFF_CAPABILITY;
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
    if (rawClaim.phase !== "intent" && rawClaim.phase !== "paused" && rawClaim.phase !== "accepted") continue;
    if (typeof rawClaim.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(rawClaim.fingerprint)) continue;
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

function setDownloadClaim(id, phase, fingerprint) {
  return mutateDownloadClaims((claims) => {
    const key = String(id);
    if (!claims[key] || claims[key].fingerprint !== fingerprint) throw new Error("Automatic download ownership claim changed unexpectedly.");
    claims[key] = { phase, fingerprint };
  });
}

function clearDownloadClaim(id) {
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

async function finishAcceptedDownload(id, acceptedResult, fingerprint) {
  const item = await findDownload(id);
  if (!item || item.state !== "in_progress" || item.paused !== true || !(await matchesOwnedDownload(item, fingerprint))) {
    await clearDownloadClaim(id);
    return result("automatic-ownership-mismatch");
  }
  try {
    await chrome.downloads.cancel(id);
  } catch {
    const recovery = await resumeOwnedDownload(id, fingerprint);
    if (recovery === "resumed") return result("automatic-cancel-failed-resumed");
    if (recovery === "gone") return result("automatic-cancel-failed-original-gone");
    if (recovery === "already-running") return result("automatic-cancel-failed-already-running");
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
    && item.exists !== false
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
    const settings = await readSettings();
    if (!isEligibleAutomaticDownload(item, settings)) return;
    const url = automaticDownloadUrl(item);
    fingerprint = await fingerprintDownload(item);
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
    }, settings);
    if (handoffResult.code === "handoff-success") {
      await setDownloadClaim(item.id, "accepted", fingerprint);
      const finalResult = await finishAcceptedDownload(item.id, handoffResult, fingerprint);
      await recordResult(finalResult);
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

async function handoffUrl(message, settings) {
  if (!settings.handoffEndpoint) return result("handoff-disabled");
  const capability = await readHandoffCapability();
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
    if (responseBody.accepted !== true || typeof responseBody.downloadId !== "string" || typeof responseBody.proof !== "string" || !AUTH_PROOF_PATTERN.test(responseBody.proof)) {
      return result("handoff-failed", "The manager did not confirm that the URL was queued.");
    }
    const expectedResponseProof = await hmacHex(capability, handoffResponseProofInput(body.authNonce, responseBody.downloadId));
    if (responseBody.proof !== expectedResponseProof) {
      return result("handoff-failed", "The loopback response did not prove the app-installed capability.");
    }
    return result("handoff-success");
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
      await recoverAutomaticDownloads();
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[PERSONAL_VOCABULARY_STORAGE_KEY]) {
    void refreshPersonalVocabulary()
      .then(readSettings)
      .then(refreshContextMenu)
      .catch(() => setActivePersonalVocabulary(null));
  }
  if (!changes[SETTINGS_KEY]) return;
  const settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
  // Revalidate every narrator-affecting setting change, including School mode,
  // language, funny levels, sound, and reduced-motion state. This prevents an
  // in-flight event from speaking with stale language or tone after a change.
  narratorSettingsGeneration += 1;
  narrator.cancel();
  void refreshContextMenu(settings);
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
  const message = validateIncomingMessage(rawMessage);
  if (!message) {
    sendResponse({ ok: false, error: "Invalid extension message." });
    return false;
  }

  void (async () => {
    if (message.type === "GET_STATE") {
      const personalVocabulary = await refreshPersonalVocabulary();
      sendResponse({ ok: true, settings: await readSettings(), lastResult: await readLastResult(), personalVocabulary: { status: personalVocabulary.status } });
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
  })().catch(() => {
    sendResponse({ ok: false, error: "The extension worker could not complete the request." });
  });
  return true;
});

void initializeSafely();
