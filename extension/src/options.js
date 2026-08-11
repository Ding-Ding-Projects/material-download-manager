import {
  DEFAULT_SETTINGS,
  makeSettingsExport,
  parseSettingsExport,
  sanitizeSettings,
  validateEndpoint,
} from "./shared/settings.js";
import { appendRegexFragment, evaluateRegex, validateRegex } from "./shared/regex.js";
import { localize } from "./shared/localization.js";

let settings = sanitizeSettings(DEFAULT_SETTINGS);
let activeTab = "connection";
const REQUIRED_SEARCHABLE_SETTING_IDS = Object.freeze([
  "handoff-endpoint",
  "auto-capture-downloads",
  "manager-display-name",
  "language-mode",
  "funny-level-en",
  "funny-level-yue",
]);

const elements = {
  managerName: document.querySelector("#manager-name"),
  form: document.querySelector("#settings-form"),
  search: document.querySelector("#settings-search"),
  searchSummary: document.querySelector("#search-summary"),
  regexToggle: document.querySelector("#regex-toggle"),
  regexBuilder: document.querySelector("#regex-builder"),
  regexPattern: document.querySelector("#regex-pattern"),
  regexFlags: document.querySelector("#regex-flags"),
  regexSample: document.querySelector("#regex-sample"),
  regexFeedback: document.querySelector("#regex-feedback"),
  regexMatches: document.querySelector("#regex-matches"),
  regexMode: document.querySelector("#regex-mode"),
  regexApply: document.querySelector("#regex-apply"),
  regexCopy: document.querySelector("#regex-copy"),
  regexExport: document.querySelector("#regex-export"),
  endpoint: document.querySelector("#handoff-endpoint"),
  endpointError: document.querySelector("#endpoint-error"),
  recoveryCard: document.querySelector(".recovery-card"),
  useDefaultEndpoint: document.querySelector("#use-default-endpoint"),
  testConnection: document.querySelector("#test-connection"),
  connectionStatus: document.querySelector("#connection-status"),
  autoCaptureDownloads: document.querySelector("#auto-capture-downloads"),
  managerDisplayName: document.querySelector("#manager-display-name"),
  languageMode: document.querySelector("#language-mode"),
  funnyEn: document.querySelector("#funny-level-en"),
  funnyEnOutput: document.querySelector("#funny-level-en-output"),
  funnyYue: document.querySelector("#funny-level-yue"),
  funnyYueOutput: document.querySelector("#funny-level-yue-output"),
  resetManagerName: document.querySelector("#reset-manager-name"),
  saveSettings: document.querySelector("#save-settings"),
  dirtyState: document.querySelector("#dirty-state"),
  exportSettings: document.querySelector("#export-settings"),
  importSettings: document.querySelector("#import-settings"),
  importFile: document.querySelector("#import-file"),
  resetSettings: document.querySelector("#reset-settings"),
  toast: document.querySelector("#toast"),
};

for (const id of REQUIRED_SEARCHABLE_SETTING_IDS) {
  const control = document.getElementById(id);
  const card = control?.closest(".setting-card[data-search]");
  if (!control || !card) throw new Error(`Searchable extension setting is missing from the settings inventory: ${id}`);
}

function localizePage() {
  document.documentElement.lang = settings.languageMode === "yue" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-l10n]").forEach((element) => {
    element.textContent = localize(element.dataset.l10n, settings);
  });
  document.querySelectorAll("[data-l10n-aria]").forEach((element) => {
    element.setAttribute("aria-label", localize(element.dataset.l10nAria, settings));
  });
  elements.managerName.textContent = settings.managerName;
  elements.funnyEnOutput.value = String(settings.funnyLevelEn);
  elements.funnyEnOutput.textContent = String(settings.funnyLevelEn);
  elements.funnyYueOutput.value = String(settings.funnyLevelYue);
  elements.funnyYueOutput.textContent = String(settings.funnyLevelYue);
  elements.dirtyState.textContent = "";
}

function fillForm() {
  elements.endpoint.value = settings.handoffEndpoint;
  elements.autoCaptureDownloads.checked = settings.autoCaptureDownloads;
  elements.managerDisplayName.value = settings.managerName;
  elements.languageMode.value = settings.languageMode;
  elements.funnyEn.value = String(settings.funnyLevelEn);
  elements.funnyYue.value = String(settings.funnyLevelYue);
  localizePage();
  updateConnectionState();
}

function collectFormSettings() {
  return sanitizeSettings({
    ...settings,
    handoffEndpoint: elements.endpoint.value,
    autoCaptureDownloads: elements.autoCaptureDownloads.checked,
    managerName: elements.managerDisplayName.value,
    languageMode: elements.languageMode.value,
    funnyLevelEn: Number(elements.funnyEn.value),
    funnyLevelYue: Number(elements.funnyYue.value),
  });
}

function markDirty() {
  elements.dirtyState.textContent = localize("settingsUnsaved", settings);
}

function showToast(text) {
  elements.toast.textContent = text;
}

function resultMessage(value) {
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
  }[value?.code] ?? "handoffFailed";
  return localize(key, settings, { detail: value?.detail ?? "" });
}

function updateConnectionState(value = null) {
  elements.recoveryCard.hidden = Boolean(settings.handoffEndpoint);
  if (value) {
    elements.connectionStatus.textContent = resultMessage(value);
  } else if (!settings.handoffEndpoint) {
    elements.connectionStatus.textContent = localize("connectionDisabled", settings);
  } else {
    elements.connectionStatus.textContent = localize("readyBody", settings);
  }
}

function applyTab(nextTab) {
  activeTab = nextTab;
  document.querySelectorAll("[role=tab]").forEach((tab) => {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[role=tabpanel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== activeTab;
  });
}

function activateAdjacentTab(direction) {
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.tab === activeTab);
  const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  applyTab(next.dataset.tab);
  next.focus();
}

function refreshSearch() {
  const query = elements.search.value.trim();
  const cards = [...document.querySelectorAll(".setting-card[data-search]")];
  let predicate = () => true;
  if (query && elements.regexMode.checked) {
    const validation = validateRegex(elements.regexPattern.value, elements.regexFlags.value);
    if (!validation.valid) {
      elements.searchSummary.textContent = `${localize("regexInvalid", settings)} ${validation.error}`;
      cards.forEach((card) => { card.hidden = true; });
      return;
    }
    predicate = (value) => {
      const evaluation = evaluateRegex(elements.regexPattern.value, elements.regexFlags.value, value);
      return evaluation.valid && evaluation.matches.length > 0;
    };
  } else if (query) {
    const normalized = query.toLocaleLowerCase();
    predicate = (value) => value.toLocaleLowerCase().includes(normalized);
  }

  const matches = [];
  cards.forEach((card) => {
    const value = `${card.dataset.search} ${card.textContent} ${settings.managerName} ${settings.handoffEndpoint}`;
    const isMatch = predicate(value);
    card.hidden = !isMatch;
    if (isMatch && query) matches.push(card);
  });

  if (!query) {
    elements.searchSummary.textContent = "";
    return;
  }
  if (matches.length === 0) {
    elements.searchSummary.textContent = localize("searchNoMatches", settings);
    return;
  }
  const panelLabel = (card) => {
    const panel = card.closest("[role=tabpanel]");
    return panel ? document.querySelector(`[aria-controls="${panel.id}"]`)?.textContent?.trim() ?? panel.dataset.panel : "";
  };
  const tabs = [...new Set(matches.map(panelLabel).filter(Boolean))];
  const activePanelLabel = document.querySelector(`[aria-controls="panel-${activeTab}"]`)?.textContent?.trim();
  const otherTabs = tabs.filter((label) => label !== activePanelLabel);
  const tabNote = otherTabs.length ? ` ${localize("searchOtherTabs", settings, { tabs: otherTabs.join(", ") })}` : "";
  elements.searchSummary.textContent = `${localize("searchMatchCount", settings, { count: matches.length })}${tabNote}`;
}

function evaluateRegexBuilder() {
  const evaluation = evaluateRegex(elements.regexPattern.value, elements.regexFlags.value, elements.regexSample.value);
  elements.regexMatches.replaceChildren();
  if (!evaluation.valid) {
    elements.regexFeedback.textContent = `${localize("regexInvalid", settings)} ${evaluation.error}`;
    refreshSearch();
    return evaluation;
  }
  elements.regexFeedback.textContent = evaluation.matches.length
    ? localize("regexMatches", settings, { count: evaluation.matches.length })
    : localize("regexNoMatches", settings);
  evaluation.matches.forEach((match) => {
    const item = document.createElement("li");
    const captures = match.captures.length ? ` · captures: ${match.captures.map((capture) => capture ?? "∅").join(", ")}` : "";
    item.textContent = `“${match.text}” at ${match.index}${captures}`;
    elements.regexMatches.append(item);
  });
  refreshSearch();
  return evaluation;
}

async function persistSettings(messageKey = "settingsSaved") {
  const endpoint = validateEndpoint(elements.endpoint.value);
  elements.endpointError.textContent = endpoint.valid ? "" : endpoint.error;
  if (!endpoint.valid) return false;
  settings = collectFormSettings();
  try {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    if (!response?.ok) throw new Error("worker");
    settings = sanitizeSettings(response.settings);
    fillForm();
    refreshSearch();
    showToast(localize(messageKey, settings));
    return true;
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
    return false;
  }
}

async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok) throw new Error("worker");
    settings = sanitizeSettings(response?.settings ?? DEFAULT_SETTINGS);
    fillForm();
    updateConnectionState(response?.lastResult);
    refreshSearch();
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
    fillForm();
  }
}

document.querySelectorAll("[role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => applyTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); activateAdjacentTab(1); }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); activateAdjacentTab(-1); }
    if (event.key === "Home") { event.preventDefault(); applyTab("connection"); document.querySelector("#tab-connection").focus(); }
    if (event.key === "End") { event.preventDefault(); applyTab("help"); document.querySelector("#tab-help").focus(); }
  });
});

elements.regexToggle.addEventListener("click", () => {
  const open = elements.regexBuilder.hidden;
  elements.regexBuilder.hidden = !open;
  elements.regexToggle.setAttribute("aria-expanded", String(open));
  if (open) elements.regexPattern.focus();
});

document.querySelectorAll("[data-fragment]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.regexPattern.value = appendRegexFragment(elements.regexPattern.value, button.dataset.fragment);
    elements.regexPattern.focus();
    evaluateRegexBuilder();
  });
});

[elements.regexPattern, elements.regexFlags, elements.regexSample].forEach((input) => input.addEventListener("input", evaluateRegexBuilder));
elements.regexMode.addEventListener("change", () => {
  if (elements.regexMode.checked) elements.regexPattern.value = elements.search.value;
  refreshSearch();
});
elements.search.addEventListener("input", () => {
  if (elements.regexMode.checked) elements.regexPattern.value = elements.search.value;
  refreshSearch();
});
elements.regexApply.addEventListener("click", () => {
  const evaluation = validateRegex(elements.regexPattern.value, elements.regexFlags.value);
  if (!evaluation.valid) { evaluateRegexBuilder(); return; }
  elements.search.value = elements.regexPattern.value;
  elements.regexMode.checked = true;
  refreshSearch();
});
elements.regexCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`/${elements.regexPattern.value}/${elements.regexFlags.value}`);
    showToast(localize("regexPatternCopied", settings));
  } catch {
    showToast(localize("copyFailed", settings));
  }
});
elements.regexExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ pattern: elements.regexPattern.value, flags: elements.regexFlags.value }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-download-manager-regex.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

elements.endpoint.addEventListener("input", () => {
  const validation = validateEndpoint(elements.endpoint.value);
  elements.endpointError.textContent = validation.valid ? "" : validation.error;
  markDirty();
});
elements.useDefaultEndpoint.addEventListener("click", () => {
  elements.endpoint.value = DEFAULT_SETTINGS.handoffEndpoint;
  elements.endpointError.textContent = "";
  settings = collectFormSettings();
  updateConnectionState();
  markDirty();
});
[elements.autoCaptureDownloads, elements.managerDisplayName, elements.languageMode, elements.funnyEn, elements.funnyYue].forEach((input) => {
  input.addEventListener("input", () => {
    settings = collectFormSettings();
    localizePage();
    markDirty();
    updateConnectionState();
    refreshSearch();
  });
});
elements.resetManagerName.addEventListener("click", () => {
  elements.managerDisplayName.value = DEFAULT_SETTINGS.managerName;
  settings = collectFormSettings();
  localizePage();
  markDirty();
});
elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await persistSettings();
});
elements.testConnection.addEventListener("click", async () => {
  const saved = await persistSettings();
  if (!saved) return;
  if (!settings.handoffEndpoint) {
    updateConnectionState({ code: "connection-disabled" });
    return;
  }
  elements.testConnection.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_HANDOFF" });
    if (!response?.ok) throw new Error("worker");
    updateConnectionState(response.result);
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
  } finally {
    elements.testConnection.disabled = false;
  }
});

elements.exportSettings.addEventListener("click", () => {
  settings = collectFormSettings();
  const blob = new Blob([JSON.stringify(makeSettingsExport(settings), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-download-manager-extension-settings.json";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(localize("settingsExported", settings));
});
elements.importSettings.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = parseSettingsExport(JSON.parse(await file.text()));
    settings = parsed;
    fillForm();
    const saved = await persistSettings("settingsImported");
    if (saved) showToast(localize("settingsImported", settings));
  } catch (error) {
    showToast(error instanceof Error ? error.message : localize("handoffFailed", settings));
  } finally {
    elements.importFile.value = "";
  }
});
elements.resetSettings.addEventListener("click", async () => {
  settings = sanitizeSettings(DEFAULT_SETTINGS);
  fillForm();
  await persistSettings("settingsReset");
});

await loadState();
