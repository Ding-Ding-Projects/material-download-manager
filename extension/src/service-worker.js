import {
  HANDOFF_PROTOCOL_VERSION,
  LAST_RESULT_KEY,
  SETTINGS_KEY,
  sanitizeSettings,
  statusEndpoint,
} from "./shared/settings.js";
import { createHandoffEnvelope, validateIncomingMessage } from "./shared/handoff.js";
import { localize } from "./shared/localization.js";

const MENU_ID = "send-to-material-download-manager";
const REQUEST_TIMEOUT_MS = 1_500;
const MAX_STATUS_BODY = 4_096;
const SUCCESS_CODES = new Set(["handoff-success", "connection-success", "settings-saved", "settings-imported"]);
let contextMenuRefresh = Promise.resolve();

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

async function recordResult(value) {
  await chrome.storage.local.set({ [LAST_RESULT_KEY]: value });
  try {
    await chrome.action.setBadgeText({ text: value.ok ? "" : "!" });
    if (!value.ok) await chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
  } catch {
    // Badge APIs are not required for the handoff contract; the popup remains the recovery surface.
  }
}

async function saveSettings(patch) {
  const current = await readSettings();
  const settings = sanitizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await refreshContextMenu(settings);
  return settings;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      return result("connection-failed", "The status response did not advertise protocol 1.");
    }
    return result("connection-success");
  } catch (error) {
    return result("connection-failed", error instanceof Error && error.name === "AbortError" ? "Timed out after 1500 ms." : "The loopback endpoint could not be reached.");
  }
}

async function handoffUrl(message, settings) {
  if (!settings.handoffEndpoint) return result("handoff-disabled");
  let body;
  try {
    body = createHandoffEnvelope(message.url, {
      title: message.title,
      selectionText: message.selectionText,
    });
  } catch {
    return result("handoff-failed", "The URL or metadata failed local validation.");
  }

  try {
    const response = await fetchWithTimeout(settings.handoffEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return result("handoff-failed", `HTTP ${response.status}`);
    return result("handoff-success");
  } catch (error) {
    return result("handoff-failed", error instanceof Error && error.name === "AbortError" ? "Timed out after 1500 ms." : "The loopback endpoint could not be reached.");
  }
}

function refreshContextMenu(settings) {
  contextMenuRefresh = contextMenuRefresh.catch(() => {}).then(async () => {
    const effectiveSettings = settings ?? await readSettings();
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: MENU_ID,
      title: `${localize("sendUrl", effectiveSettings)} · ${effectiveSettings.managerName}`,
      contexts: ["page", "link"],
    });
  });
  return contextMenuRefresh;
}

async function initialize() {
  const settings = await readSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await refreshContextMenu(settings);
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) void refreshContextMenu(sanitizeSettings(changes[SETTINGS_KEY].newValue));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const message = validateIncomingMessage({
    type: "HANDOFF_URL",
    url: info.linkUrl || info.pageUrl,
    title: tab?.title,
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
      sendResponse({ ok: true, settings: await readSettings(), lastResult: await readLastResult() });
      return;
    }
    if (message.type === "SAVE_SETTINGS") {
      const settings = await saveSettings(message.settings);
      const saved = result("settings-saved");
      await recordResult(saved);
      sendResponse({ ok: true, settings, result: saved });
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
