import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SETTINGS,
  DEFAULT_HANDOFF_ENDPOINT,
  HANDOFF_PATH,
  makeSettingsExport,
  parseSettingsExport,
  sanitizeSettings,
  statusEndpoint,
  validateEndpoint,
} from "../src/shared/settings.js";
import { createHandoffEnvelope, normalizeDownloadUrl, validateIncomingMessage } from "../src/shared/handoff.js";
import { appendRegexFragment, evaluateRegex, validateRegex } from "../src/shared/regex.js";
import { hasLocalizationKey, localize } from "../src/shared/localization.js";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFile(join(extensionRoot, relativePath), "utf8");

test("MV3 manifest declares the intended entrypoints and minimized permissions", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/service-worker.js");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.equal(manifest.options_page, "src/options.html");
  assert.deepEqual(manifest.permissions, ["activeTab", "contextMenus", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*", "http://localhost/*"]);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.permissions.includes("downloads"), false);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  await import("node:fs/promises").then(({ access }) => Promise.all([
    access(join(extensionRoot, manifest.background.service_worker)),
    access(join(extensionRoot, manifest.action.default_popup)),
    access(join(extensionRoot, manifest.options_page)),
  ]));
});

test("service worker, popup, options, and runtime message boundary are wired", async () => {
  const worker = await read("src/service-worker.js");
  const popup = await read("src/popup.html");
  const options = await read("src/options.html");
  assert.match(worker, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(worker, /chrome\.contextMenus\.create/);
  assert.match(worker, /chrome\.contextMenus\.onClicked\.addListener/);
  assert.match(worker, /chrome\.runtime\.onMessage\.addListener/);
  assert.match(worker, /validateIncomingMessage/);
  assert.match(worker, /HANDOFF_URL/);
  assert.match(worker, /sendResponse/);
  assert.match(worker, /return true/);
  assert.match(worker, /AbortController/);
  assert.match(worker, /redirect: "error"/);
  assert.match(worker, /credentials: "omit"/);
  assert.match(popup, /<script type="module" src="popup\.js"><\/script>/);
  assert.match(popup, /<label for="url"/);
  assert.match(popup, /id="send-button"/);
  assert.match(options, /<script type="module" src="options\.js"><\/script>/);
  assert.match(options, /id="settings-search"/);
  assert.match(options, /id="regex-toggle"/);
  assert.match(options, /id="use-default-endpoint"/);
  assert.match(options, /role="tab"/);
  assert.match(options, /id="import-file" type="file"/);
  assert.doesNotMatch(worker, /console\.(log|info|debug|error)\(/);
});

test("service worker runtime boundary stores settings and reports disabled handoff", async () => {
  class FakeEvent {
    listeners = [];
    addListener(listener) { this.listeners.push(listener); }
  }

  const storage = new Map();
  const runtime = { id: "extension-test", onInstalled: new FakeEvent(), onStartup: new FakeEvent(), onMessage: new FakeEvent() };
  const contextMenus = { onClicked: new FakeEvent(), created: [], removeAll: async () => { contextMenus.created.length = 0; }, create: async (menu) => { contextMenus.created.push(menu); return menu.id; } };
  const chromeMock = {
    runtime,
    contextMenus,
    storage: {
      local: {
        async get(key) { return { [key]: storage.get(key) }; },
        async set(values) { Object.entries(values).forEach(([key, value]) => storage.set(key, value)); },
      },
      onChanged: new FakeEvent(),
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
  };
  const previousChrome = globalThis.chrome;
  globalThis.chrome = chromeMock;
  let receivedBody = null;
  let managerAccepted = true;
  let managerPending = false;
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/v1/status") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ protocol: 1, acceptingUrls: true }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/downloads") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ protocol: 1, accepted: managerAccepted, pending: managerPending, downloadId: "extension-test-id" }));
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await import(`../src/service-worker.js?runtime-test=${Date.now()}`);
    const listener = runtime.onMessage.listeners[0];
    assert.equal(typeof listener, "function");
    const send = (message, sender = { id: runtime.id }) => new Promise((resolve) => {
      const keepChannelOpen = listener(message, sender, resolve);
      if (message.type !== "GET_STATE") assert.equal(keepChannelOpen, true);
    });
    const initial = await send({ type: "GET_STATE" });
    assert.equal(initial.ok, true);
    assert.equal(initial.settings.handoffEndpoint, DEFAULT_HANDOFF_ENDPOINT);
    const cleared = await send({ type: "SAVE_SETTINGS", settings: { handoffEndpoint: "" } });
    assert.equal(cleared.settings.handoffEndpoint, "");
    const disabled = await send({ type: "HANDOFF_URL", url: "https://example.test/file.zip" });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.result.code, "handoff-disabled");
    const saved = await send({ type: "SAVE_SETTINGS", settings: { managerName: "Test manager", funnyLevelEn: 4 } });
    assert.equal(saved.settings.managerName, "Test manager");
    assert.equal(saved.settings.funnyLevelEn, 4);
    assert.equal(contextMenus.created.length, 1);
    assert.match(contextMenus.created[0].title, /Test manager/);
    assert.deepEqual(contextMenus.created[0].contexts, ["page", "link", "selection"]);
    const contextMenuListener = contextMenus.onClicked.listeners[0];
    assert.equal(typeof contextMenuListener, "function");
    const port = server.address().port;
    const configured = await send({ type: "SAVE_SETTINGS", settings: { handoffEndpoint: `http://127.0.0.1:${port}/v1/downloads` } });
    assert.equal(configured.settings.handoffEndpoint, `http://127.0.0.1:${port}/v1/downloads`);
    const connection = await send({ type: "TEST_HANDOFF" });
    assert.equal(connection.result.code, "connection-success");
    const handedOff = await send({ type: "HANDOFF_URL", url: "https://example.test/file.zip", title: "Example" });
    assert.equal(handedOff.result.code, "handoff-success");
    assert.equal(receivedBody.protocol, 1);
    assert.equal(receivedBody.source, "material-download-manager-extension");
    assert.equal(receivedBody.url, "https://example.test/file.zip");
    assert.equal(receivedBody.title, "Example");
    receivedBody = null;
    contextMenuListener({
      menuItemId: contextMenus.created[0].id,
      pageUrl: "https://example.test/selection-page",
      selectionText: "Selected text from the page",
    }, { title: "Selection page" });
    for (let attempt = 0; attempt < 20 && receivedBody === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.ok(receivedBody, "selection context-menu handoff did not reach the manager");
    assert.equal(receivedBody.url, "https://example.test/selection-page");
    assert.equal(receivedBody.title, "Selection page");
    assert.equal(receivedBody.selectionText, "Selected text from the page");
    receivedBody = null;
    contextMenuListener({
      menuItemId: contextMenus.created[0].id,
      linkUrl: "https://example.test/linked-file.zip",
      pageUrl: "https://example.test/page-that-contains-link",
    }, { title: "Link page" });
    for (let attempt = 0; attempt < 20 && receivedBody === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.ok(receivedBody, "link context-menu handoff did not reach the manager");
    assert.equal(receivedBody.url, "https://example.test/linked-file.zip");
    managerPending = true;
    const pending = await send({ type: "HANDOFF_URL", url: "https://example.test/slow-file.zip" });
    assert.equal(pending.result.code, "handoff-pending");
    assert.equal(pending.result.ok, true);
    managerPending = false;
    managerAccepted = false;
    const unconfirmed = await send({ type: "HANDOFF_URL", url: "https://example.test/file.zip" });
    assert.equal(unconfirmed.result.code, "handoff-failed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test("all extension JavaScript entrypoints pass Node syntax parsing", async () => {
  const { readdir } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const sourceDirectory = join(extensionRoot, "src");
  const pending = [sourceDirectory];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name.endsWith(".js")) files.push(path);
    }
  }
  for (const file of files) await run(process.execPath, ["--check", file]);
  assert.ok(files.length >= 6);
});

test("handoff message boundary accepts only bounded download messages", () => {
  const message = validateIncomingMessage({
    type: "HANDOFF_URL",
    url: "https://example.test/archive.zip",
    title: "Example",
    selectionText: "A small selection",
  });
  assert.equal(message.type, "HANDOFF_URL");
  assert.equal(message.url, "https://example.test/archive.zip");
  assert.equal(message.selectionText, "A small selection");
  assert.equal(validateIncomingMessage({ type: "HANDOFF_URL", url: "javascript:alert(1)" }), null);
  assert.equal(validateIncomingMessage({ type: "HANDOFF_URL", url: "https://user:pass@example.test/file" }), null);
  assert.equal(validateIncomingMessage({ type: "HANDOFF_URL", url: "https://example.test/file", title: "x".repeat(513) }), null);
  assert.equal(validateIncomingMessage({ type: "HANDOFF_URL", url: "https://example.test/file", selectionText: "x".repeat(2049) }), null);
  assert.equal(validateIncomingMessage({ type: "UNKNOWN", url: "https://example.test/file" }), null);
  assert.deepEqual(validateIncomingMessage({ type: "GET_STATE" }), { type: "GET_STATE" });
});

test("handoff envelope normalizes safe URLs and records the protocol source", () => {
  assert.equal(normalizeDownloadUrl("file:///C:/secret.txt"), null);
  assert.equal(normalizeDownloadUrl("https://user:pass@example.test/file"), null);
  const envelope = createHandoffEnvelope("https://example.test/file.zip", { title: "File", selectionText: "Selected text" });
  assert.deepEqual(
    { protocol: envelope.protocol, source: envelope.source, url: envelope.url, title: envelope.title, selectionText: envelope.selectionText },
    { protocol: 1, source: "material-download-manager-extension", url: "https://example.test/file.zip", title: "File", selectionText: "Selected text" },
  );
  assert.throws(() => createHandoffEnvelope("https://example.test/file.zip", { selectionText: "x".repeat(2049) }), /metadata is too large/);
  assert.match(envelope.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("endpoint validation is loopback-only and uses the documented path", () => {
  assert.equal(HANDOFF_PATH, "/v1/downloads");
  assert.deepEqual(validateEndpoint(""), { valid: true, value: "", error: null });
  assert.equal(validateEndpoint("http://127.0.0.1:47821/v1/downloads").valid, true);
  assert.equal(validateEndpoint("http://localhost:47821/v1/downloads").valid, true);
  assert.equal(statusEndpoint("http://127.0.0.1:47821/v1/downloads"), "http://127.0.0.1:47821/v1/status");
  for (const value of [
    "https://127.0.0.1:47821/v1/downloads",
    "http://192.168.1.10:47821/v1/downloads",
    "http://127.0.0.1/v1/downloads",
    "http://127.0.0.1:47821/other",
    "http://user:pass@127.0.0.1:47821/v1/downloads",
    "http://127.0.0.1:47821/v1/downloads?x=1",
  ]) {
    assert.equal(validateEndpoint(value).valid, false, value);
  }
});

test("settings are bounded, persistable, and exportable without arbitrary endpoints", () => {
  const safe = sanitizeSettings({
    managerName: "  Local <manager>  ",
    languageMode: "bilingual",
    funnyLevelEn: 5,
    funnyLevelYue: 0,
    handoffEndpoint: "http://127.0.0.1:47821/v1/downloads",
  });
  assert.equal(safe.managerName, "Local <manager>");
  assert.equal(safe.languageMode, "bilingual");
  assert.equal(safe.funnyLevelEn, 5);
  assert.equal(safe.funnyLevelYue, 2);
  assert.equal(safe.handoffEndpoint, "http://127.0.0.1:47821/v1/downloads");
  assert.equal(sanitizeSettings({ handoffEndpoint: "http://example.com:47821/v1/downloads" }).handoffEndpoint, "");
  const exported = makeSettingsExport(safe);
  assert.equal(exported.schema, "material-download-manager-extension-settings");
  assert.deepEqual(parseSettingsExport(exported), safe);
  assert.throws(() => parseSettingsExport({ schema: "other", version: 1, settings: {} }));
  assert.throws(() => parseSettingsExport({ schema: "material-download-manager-extension-settings", version: 1, settings: { handoffEndpoint: "http://example.com:47821/v1/downloads" } }), /endpoint is invalid/);
  assert.equal(sanitizeSettings(DEFAULT_SETTINGS).managerName, DEFAULT_SETTINGS.managerName);
  assert.equal(sanitizeSettings({}).handoffEndpoint, DEFAULT_HANDOFF_ENDPOINT);
});

test("regex builder evaluates captures with bounded safety checks", () => {
  assert.equal(validateRegex("download", "gi").valid, true);
  const evaluation = evaluateRegex("(download)\\.(\\w+)", "gi", "download.zip and download.tar");
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.matches.length, 2);
  assert.deepEqual(evaluation.matches[0].captures, ["download", "zip"]);
  assert.equal(validateRegex("(a+)+", "g").valid, false);
  assert.equal(validateRegex("x".repeat(257), "g").valid, false);
  assert.equal(appendRegexFragment("^", "characterClass"), "^[a-z]");
});

test("language modes and independent funny levels are wired to rendered copy", () => {
  const english = [];
  const cantonese = [];
  for (let level = 1; level <= 5; level += 1) {
    english.push(localize("handoffSuccess", { ...DEFAULT_SETTINGS, languageMode: "en", funnyLevelEn: level }));
    cantonese.push(localize("handoffSuccess", { ...DEFAULT_SETTINGS, languageMode: "yue", funnyLevelYue: level }));
  }
  assert.equal(new Set(english).size, 5);
  assert.equal(new Set(cantonese).size, 5);
  const bilingual = localize("handoffSuccess", { ...DEFAULT_SETTINGS, languageMode: "bilingual", funnyLevelEn: 1, funnyLevelYue: 5 });
  assert.match(bilingual, / · /);
  assert.match(bilingual, /The URL was accepted/);
});

test("popup and options localization markers all resolve to known copy", async () => {
  const html = `${await read("src/popup.html")}\n${await read("src/options.html")}`;
  const markers = [...html.matchAll(/data-l10n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(markers.length > 30);
  markers.forEach((key) => assert.equal(hasLocalizationKey(key), true, key));
});

test("user-facing source contains no remote asset or tracking dependency", async () => {
  for (const path of [
    "src/popup.html",
    "src/popup.css",
    "src/popup.js",
    "src/options.html",
    "src/options.css",
    "src/options.js",
    "src/service-worker.js",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /<script[^>]+src=["']https?:/i, path);
    assert.doesNotMatch(source, /<link[^>]+href=["']https?:/i, path);
    assert.doesNotMatch(source, /google-analytics|plausible\.io|segment\.com/i, path);
  }
});
