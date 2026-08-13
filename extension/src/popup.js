import { DEFAULT_SETTINGS, SETTINGS_KEY, sanitizeSettings } from "./shared/settings.js";
import { normalizeDownloadUrl } from "./shared/handoff.js";
import { decorateMessage, localize, setActivePersonalVocabulary } from "./shared/localization.js";
import { PERSONAL_VOCABULARY_STORAGE_KEY, readPersonalVocabulary } from "./shared/personal-vocabulary.js";

let settings = sanitizeSettings(DEFAULT_SETTINGS);
let lastResult = null;

async function refreshPersonalVocabulary() {
  try {
    const state = await readPersonalVocabulary(chrome.storage.local);
    setActivePersonalVocabulary(state.replacements);
  } catch {
    setActivePersonalVocabulary(null);
  }
}

const elements = {
  managerName: document.querySelector("#manager-name"),
  popupTitle: document.querySelector("#popup-title"),
  statusMessage: document.querySelector("#status-message"),
  recoveryMessage: document.querySelector("#recovery-message"),
  url: document.querySelector("#url"),
  urlError: document.querySelector("#url-error"),
  sendButton: document.querySelector("#send-button"),
  handoffForm: document.querySelector("#handoff-form"),
  optionsButton: document.querySelector("#options-button"),
};

function applyLanguage() {
  document.documentElement.lang = !settings.schoolModeEnabled && settings.languageMode === "yue" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-l10n]").forEach((element) => {
    element.textContent = localize(element.dataset.l10n, settings);
  });
  document.querySelectorAll("[data-school-hidden]").forEach((element) => {
    element.hidden = settings.schoolModeEnabled;
  });
  elements.managerName.textContent = settings.managerName;
  elements.popupTitle.textContent = localize("popupTitle", settings, { name: settings.managerName });
  document.title = elements.popupTitle.textContent;
  elements.recoveryMessage.textContent = settings.handoffEndpoint
    ? localize("readyBody", settings)
    : localize("optionsRecovery", settings);
}

function resultMessage(value) {
  if (!value?.code) return localize("statusReady", settings);
  const known = ["handoffSuccess", "handoffPending", "automaticAwaitingDecision", "automaticKeptInBrowser", "handoffCleanupWarning", "automaticPauseFailed", "automaticCapacityFull", "automaticResumedFailed", "automaticResumeFailed", "automaticCancelFailedResumed", "automaticCancelFailedOriginalGone", "automaticCancelFailedAlreadyRunning", "automaticCancelRecoveryFailed", "automaticOriginalGone", "automaticOriginalAlreadyRunning", "automaticOwnershipMismatch", "automaticRestartResumeFailed", "handoffDisabled", "handoffUnpaired", "handoffFailed", "connectionSuccess", "connectionDisabled", "connectionUnpaired", "connectionFailed", "settingsSaved", "settingsImported", "settingsExported", "schoolModeCredentialUnavailable", "displayNameHistoryUnavailable", "settingsSaveFailed"];
  const key = {
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
  }[value.code];
  return localize(known.includes(key) ? key : "handoffFailed", settings, { detail: value.detail ?? "", name: settings.schoolModeName });
}

async function renderState(state) {
  settings = sanitizeSettings(state?.settings ?? DEFAULT_SETTINGS);
  lastResult = state?.lastResult ?? null;
  await refreshPersonalVocabulary();
  applyLanguage();
  renderStatus();
  elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
}

function renderStatus() {
  elements.statusMessage.textContent = decorateMessage(resultMessage(lastResult), settings, lastResult?.ok === false ? "⚠️" : "✅");
  elements.statusMessage.classList.toggle("is-error", lastResult?.ok === false);
}

async function getState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok) throw new Error("worker");
    return response;
  } catch {
    elements.statusMessage.textContent = decorateMessage(localize("serviceWorkerUnavailable", settings), settings, "⚠️");
    elements.statusMessage.classList.add("is-error");
    elements.sendButton.disabled = true;
    return null;
  }
}

async function loadActiveTabUrl() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (tab?.url && normalizeDownloadUrl(tab.url)) elements.url.value = tab.url;
  } catch {
    // The URL field remains editable; activeTab can be unavailable on a browser-owned page.
  }
}

elements.url.addEventListener("input", () => {
  elements.urlError.textContent = "";
  elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
});

elements.handoffForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeDownloadUrl(elements.url.value);
  if (!url) {
    elements.urlError.textContent = localize("invalidUrl", settings);
    return;
  }
  elements.sendButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "HANDOFF_URL", url });
    if (!response?.ok) throw new Error("worker");
    lastResult = response.result ?? null;
    renderStatus();
  } catch {
    elements.statusMessage.textContent = decorateMessage(localize("serviceWorkerUnavailable", settings), settings, "⚠️");
    elements.statusMessage.classList.add("is-error");
  } finally {
    elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
  }
});

elements.optionsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes[SETTINGS_KEY] && !changes[PERSONAL_VOCABULARY_STORAGE_KEY])) return;
  void (async () => {
    if (changes[SETTINGS_KEY]) settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
    if (changes[PERSONAL_VOCABULARY_STORAGE_KEY]) await refreshPersonalVocabulary();
    applyLanguage();
    renderStatus();
    elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
  })();
});

const state = await getState();
await loadActiveTabUrl();
if (state) await renderState(state);
else {
  await refreshPersonalVocabulary();
  applyLanguage();
}
