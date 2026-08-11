import { DEFAULT_SETTINGS, sanitizeSettings } from "./shared/settings.js";
import { normalizeDownloadUrl } from "./shared/handoff.js";
import { localize } from "./shared/localization.js";

let settings = sanitizeSettings(DEFAULT_SETTINGS);

const elements = {
  managerName: document.querySelector("#manager-name"),
  statusMessage: document.querySelector("#status-message"),
  recoveryMessage: document.querySelector("#recovery-message"),
  url: document.querySelector("#url"),
  urlError: document.querySelector("#url-error"),
  sendButton: document.querySelector("#send-button"),
  handoffForm: document.querySelector("#handoff-form"),
  optionsButton: document.querySelector("#options-button"),
};

function applyLanguage() {
  document.querySelectorAll("[data-l10n]").forEach((element) => {
    element.textContent = localize(element.dataset.l10n, settings);
  });
  elements.managerName.textContent = settings.managerName;
  elements.recoveryMessage.textContent = settings.handoffEndpoint
    ? localize("readyBody", settings)
    : localize("optionsRecovery", settings);
}

function resultMessage(value) {
  if (!value?.code) return localize("statusReady", settings);
  const known = ["handoffSuccess", "handoffCleanupWarning", "automaticPauseFailed", "automaticCapacityFull", "automaticResumedFailed", "automaticResumeFailed", "automaticCancelFailedResumed", "automaticCancelFailedOriginalGone", "automaticCancelFailedAlreadyRunning", "automaticCancelRecoveryFailed", "automaticOriginalGone", "automaticOriginalAlreadyRunning", "automaticOwnershipMismatch", "automaticRestartResumeFailed", "handoffDisabled", "handoffUnpaired", "handoffFailed", "connectionSuccess", "connectionDisabled", "connectionUnpaired", "connectionFailed", "settingsSaved", "settingsImported", "settingsExported"];
  const key = {
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
  }[value.code];
  return localize(known.includes(key) ? key : "handoffFailed", settings, { detail: value.detail ?? "" });
}

function renderState(state) {
  settings = sanitizeSettings(state?.settings ?? DEFAULT_SETTINGS);
  applyLanguage();
  elements.statusMessage.textContent = resultMessage(state?.lastResult);
  elements.statusMessage.classList.toggle("is-error", state?.lastResult?.ok === false);
  elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
}

async function getState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok) throw new Error("worker");
    return response;
  } catch {
    elements.statusMessage.textContent = localize("serviceWorkerUnavailable", settings);
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
    elements.statusMessage.textContent = resultMessage(response.result);
    elements.statusMessage.classList.toggle("is-error", response.result?.ok === false);
  } catch {
    elements.statusMessage.textContent = localize("serviceWorkerUnavailable", settings);
    elements.statusMessage.classList.add("is-error");
  } finally {
    elements.sendButton.disabled = !settings.handoffEndpoint || !normalizeDownloadUrl(elements.url.value);
  }
});

elements.optionsButton.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

const state = await getState();
await loadActiveTabUrl();
if (state) renderState(state);
else applyLanguage();
