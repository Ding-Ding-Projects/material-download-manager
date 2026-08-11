import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SETTINGS,
  DEFAULT_SCHOOL_MODE_NAME,
  DEFAULT_HANDOFF_ENDPOINT,
  NARRATOR_LANGUAGE_MODES,
  NARRATOR_SOUND_MODES,
  HANDOFF_PATH,
  HANDOFF_PROTOCOL_VERSION,
  makeSettingsExport,
  parseSettingsExport,
  sanitizeSettings,
  presentationSettings,
  canDisableSchoolMode,
  statusEndpoint,
  validateEndpoint,
} from "../src/shared/settings.js";
import {
  createHandoffEnvelope,
  challengeProofInput,
  deriveDownloadFileName,
  handoffRequestProofInput,
  handoffResponseProofInput,
  normalizeDownloadUrl,
  normalizeFileName,
  validateIncomingMessage,
} from "../src/shared/handoff.js";
import { appendRegexFragment, evaluateRegex, validateRegex } from "../src/shared/regex.js";
import { decorateMessage, hasLocalizationKey, localize, narrationParts } from "../src/shared/localization.js";
import { RESET_CREDENTIAL_STATES, createCredentialAbstraction } from "../src/shared/credential.js";
import {
  DISPLAY_NAME_MUTATION_JOURNAL_KEY,
  DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA,
  appendDisplayNameMutation,
  readDisplayNameMutationJournal,
} from "../src/shared/mutation-journal.js";
import { createNarrator, NARRATOR_COOLDOWN_MS, NARRATOR_DEBOUNCE_MS } from "../src/shared/narrator.js";
import { createChromeTtsAdapter } from "../src/shared/chrome-tts.js";
import {
  AUTHENTICATOR_SCHEMA_VERSION,
  buildTotpUri,
  createTotpMetadata,
  createTotpRegistrationModel,
  generateTotpCode,
  isTotpMetadata,
  normalizeTotpRegistration,
  parseTotpUri,
  verifyTotpCode,
} from "../src/shared/totp.js";
import { createQrMatrix, qrMatrixToSvg, qrPayloadCapacity } from "../src/shared/qr.js";
import {
  AUTHENTICATOR_METADATA_KEY,
  AUTHENTICATOR_SECRETS_KEY,
  createAuthenticatorStore,
} from "../src/shared/authenticator-store.js";
import { appendAuthenticatorMutation } from "../src/shared/mutation-journal.js";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => readFile(join(extensionRoot, relativePath), "utf8");
let nextHarnessId = 0;
const TEST_CAPABILITY = "a".repeat(43);

function handoffProof(input) {
  return createHmac("sha256", TEST_CAPABILITY).update(input, "utf8").digest("hex");
}

function challengeBody(url) {
  const nonce = new URL(String(url)).searchParams.get("nonce");
  assert.match(nonce ?? "", /^[a-f0-9]{64}$/u);
  return {
    protocol: HANDOFF_PROTOCOL_VERSION,
    nonce,
    proof: handoffProof(challengeProofInput(nonce)),
  };
}

class FakeEvent {
  listeners = [];
  addListener(listener) { this.listeners.push(listener); }
  dispatch(...args) { this.listeners.forEach((listener) => listener(...args)); }
}

async function waitFor(predicate, message, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function createChromeHarness({ initialStorage = {}, initialDownloads = [] } = {}) {
  nextHarnessId += 1;
  const storage = new Map(Object.entries(initialStorage));
  const items = new Map(initialDownloads.map((item) => [item.id, { ...item }]));
  const operations = [];
  const failures = {
    pause: new Set(),
    resume: new Set(),
    cancel: new Set(),
    erase: new Set(),
  };
  const runtime = {
    id: `extension-test-${nextHarnessId}`,
    onInstalled: new FakeEvent(),
    onStartup: new FakeEvent(),
    onMessage: new FakeEvent(),
  };
  const contextMenus = {
    onClicked: new FakeEvent(),
    created: [],
    async removeAll() { contextMenus.created.length = 0; },
    async create(menu) { contextMenus.created.push(menu); return menu.id; },
  };
  const downloads = {
    onCreated: new FakeEvent(),
    async search(query) {
      operations.push(["search", query.id]);
      const item = items.get(query.id);
      return item ? [{ ...item }] : [];
    },
    async pause(id) {
      operations.push(["pause", id]);
      if (failures.pause.has(id)) throw new Error("pause failed");
      const item = items.get(id);
      if (item) item.paused = true;
    },
    async resume(id) {
      operations.push(["resume", id]);
      if (failures.resume.has(id)) throw new Error("resume failed");
      const item = items.get(id);
      if (item) item.paused = false;
    },
    async cancel(id) {
      operations.push(["cancel", id]);
      if (failures.cancel.has(id)) throw new Error("cancel failed");
      const item = items.get(id);
      if (item) {
        item.paused = false;
        item.state = "interrupted";
      }
    },
    async erase(query) {
      operations.push(["erase", query.id]);
      if (failures.erase.has(query.id)) throw new Error("erase failed");
      items.delete(query.id);
      return [query.id];
    },
  };
  const chromeMock = {
    runtime,
    contextMenus,
    downloads,
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: storage.get(key) };
          if (Array.isArray(key)) return Object.fromEntries(key.map((name) => [name, storage.get(name)]));
          return Object.fromEntries(storage);
        },
        async set(values) { Object.entries(values).forEach(([key, value]) => storage.set(key, value)); },
      },
      onChanged: new FakeEvent(),
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
  };
  return { chromeMock, contextMenus, downloads, failures, items, operations, runtime, storage };
}

function downloadFingerprint(url, startTime) {
  return createHash("sha256").update(`${url}\n${startTime}`, "utf8").digest("hex");
}

function base32Encode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = new TextEncoder().encode(value);
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

test("MV3 manifest declares the intended entrypoints and minimized permissions", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/service-worker.js");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.equal(manifest.options_page, "src/options.html");
  assert.deepEqual(manifest.permissions, ["activeTab", "contextMenus", "downloads", "storage", "tts"]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*", "http://localhost/*"]);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.permissions.includes("downloads"), true);
  assert.equal(manifest.permissions.includes("tts"), true);
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
  assert.match(worker, /chrome\.downloads\.onCreated\.addListener/);
  assert.match(worker, /chrome\.downloads\.pause/);
  assert.match(worker, /chrome\.downloads\.resume/);
  assert.match(worker, /chrome\.downloads\.cancel/);
  assert.match(worker, /chrome\.downloads\.erase/);
  assert.match(worker, /createNarrator/);
  assert.match(worker, /createChromeTtsAdapter/);
  assert.match(worker, /narrateResult/);
  assert.match(worker, /TEST_NARRATION/);
  assert.match(worker, /createAuthenticatorStore/);
  for (const message of ["GET_AUTHENTICATOR_STATE", "PREPARE_AUTHENTICATOR", "CONFIRM_AUTHENTICATOR", "GET_AUTHENTICATOR_CODE", "REMOVE_AUTHENTICATOR", "EXPORT_AUTHENTICATOR_METADATA"]) assert.match(worker, new RegExp(message));
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
  assert.match(options, /id="auto-capture-downloads"/);
  assert.match(options, /id="auto-capture-downloads"[^>]+aria-describedby="auto-capture-downloads-help"/);
  assert.match(options, /id="auto-capture-downloads-help"/);
  assert.match(options, /id="narrator-enabled"/);
  assert.match(options, /id="narrator-language"/);
  assert.match(options, /id="narrator-sound-mode"/);
  assert.match(options, /id="narrator-quiet-mode"/);
  assert.match(options, /id="narrator-respect-reduced-motion"/);
  assert.match(options, /id="test-narration"/);
  assert.match(options, /id="tab-authenticator"/);
  assert.match(options, /id="panel-authenticator"/);
  for (const id of ["authenticator-uri", "authenticator-issuer", "authenticator-account", "authenticator-secret", "authenticator-algorithm", "authenticator-digits", "authenticator-period", "authenticator-prepare", "authenticator-pairing-code", "authenticator-confirm", "authenticator-list-search", "authenticator-list-regex-toggle", "authenticator-export", "authenticator-remove-card", "authenticator-remove-key-one", "authenticator-remove-key-two", "authenticator-remove-slider", "authenticator-remove-confirm", "authenticator-remove-cancel"]) assert.match(options, new RegExp(`id="${id}"`));
  assert.match(options, /id="authenticator-qr"/);
  assert.match(options, /data-authenticator-fragment="literal"/);
  assert.match(await read("src/options.js"), /PREPARE_AUTHENTICATOR/);
  assert.match(await read("src/options.js"), /GET_AUTHENTICATOR_CODE/);
  assert.match(await read("src/options.js"), /createQrMatrix/);
  const optionsScript = await read("src/options.js");
  assert.match(optionsScript, /authenticatorRemoveConfirm\.disabled/);
  assert.match(optionsScript, /event\.key === "Escape"/);
  assert.match(optionsScript, /REMOVE_AUTHENTICATOR/);
  assert.match(optionsScript, /void loadAuthenticatorState\(\)/);
  assert.match(optionsScript, /await loadState\(\);/);
  assert.match(await read("src/options.js"), /REQUIRED_SEARCHABLE_SETTING_IDS[\s\S]*"auto-capture-downloads"/);
  assert.match(options, /role="tab"/);
  assert.match(options, /id="import-file" type="file"/);
  assert.doesNotMatch(worker, /console\.(log|info|debug|error)\(/);
});

test("service worker runtime boundary stores settings and reports disabled handoff", async () => {
  const storage = new Map();
  const runtime = { id: "extension-test", onInstalled: new FakeEvent(), onStartup: new FakeEvent(), onMessage: new FakeEvent() };
  const contextMenus = { onClicked: new FakeEvent(), created: [], removeAll: async () => { contextMenus.created.length = 0; }, create: async (menu) => { contextMenus.created.push(menu); return menu.id; } };
  const downloads = {
    onCreated: new FakeEvent(),
    async search() { return []; },
    async pause() {},
    async resume() {},
    async cancel() {},
    async erase() {},
  };
  const chromeMock = {
    runtime,
    contextMenus,
    downloads,
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
  storage.set("handoffCapability", TEST_CAPABILITY);
  let receivedBody = null;
  let managerAccepted = true;
  let responseProofValid = true;
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
      response.end(JSON.stringify({ protocol: HANDOFF_PROTOCOL_VERSION, acceptingUrls: true }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/v2/challenge?")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(challengeBody(`http://127.0.0.1${request.url}`)));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/downloads") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const expectedRequestProof = handoffProof(handoffRequestProofInput(receivedBody, receivedBody.authNonce));
        if (receivedBody.authProof !== expectedRequestProof) {
          response.writeHead(403, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ protocol: HANDOFF_PROTOCOL_VERSION, accepted: false }));
          return;
        }
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          protocol: HANDOFF_PROTOCOL_VERSION,
          accepted: managerAccepted,
          downloadId: "extension-test-id",
          ...(managerAccepted ? {
            proof: responseProofValid
              ? handoffProof(handoffResponseProofInput(receivedBody.authNonce, "extension-test-id"))
              : "0".repeat(64),
          } : {}),
        }));
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
    assert.equal(initial.settings.autoCaptureDownloads, true);
    const optedOut = await send({ type: "SAVE_SETTINGS", settings: { autoCaptureDownloads: false } });
    assert.equal(optedOut.settings.autoCaptureDownloads, false);
    const persistedOptOut = await send({ type: "GET_STATE" });
    assert.equal(persistedOptOut.settings.autoCaptureDownloads, false);
    const cleared = await send({ type: "SAVE_SETTINGS", settings: { handoffEndpoint: "" } });
    assert.equal(cleared.settings.handoffEndpoint, "");
    const disabled = await send({ type: "HANDOFF_URL", url: "https://example.test/file.zip" });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.result.code, "handoff-disabled");
    const saved = await send({ type: "SAVE_SETTINGS", settings: { managerName: "Test manager", funnyLevelEn: 4 } });
    assert.equal(saved.settings.managerName, "Test manager");
    assert.equal(saved.settings.funnyLevelEn, 4);
    const journal = storage.get(DISPLAY_NAME_MUTATION_JOURNAL_KEY);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].redacted, true);
    assert.doesNotMatch(JSON.stringify(journal), /Test manager|Material Download Manager/i);
    const schoolEnabled = await send({ type: "SAVE_SETTINGS", settings: { schoolModeEnabled: true, schoolModeName: "Quiet study", showEmojis: true } });
    assert.equal(schoolEnabled.settings.schoolModeEnabled, true);
    assert.equal(schoolEnabled.settings.schoolModeName, "Quiet study");
    assert.doesNotMatch(JSON.stringify(Object.fromEntries(storage)), /password|passphrase|pin|secret|otp|token/i);
    const schoolReset = await send({ type: "SAVE_SETTINGS", settings: { schoolModeEnabled: false } });
    assert.equal(schoolReset.ok, false);
    assert.equal(schoolReset.result.code, "school-mode-reset-unavailable");
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
    assert.equal(receivedBody.protocol, HANDOFF_PROTOCOL_VERSION);
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
    responseProofValid = false;
    const impersonated = await send({ type: "HANDOFF_URL", url: "https://example.test/forged-response.zip" });
    assert.equal(impersonated.result.code, "handoff-failed");
    responseProofValid = true;
    managerAccepted = false;
    const unconfirmed = await send({ type: "HANDOFF_URL", url: "https://example.test/file.zip" });
    assert.equal(unconfirmed.result.code, "handoff-failed");
    const authenticatorInput = { issuer: "Example", account: "runtime", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 };
    const preparedAuthenticator = await send({ type: "PREPARE_AUTHENTICATOR", input: authenticatorInput });
    assert.equal(preparedAuthenticator.ok, true);
    assert.equal(preparedAuthenticator.result.kind, "totp");
    const pairingCode = await generateTotpCode(authenticatorInput, Date.now());
    const confirmedAuthenticator = await send({ type: "CONFIRM_AUTHENTICATOR", input: authenticatorInput, code: pairingCode });
    assert.equal(confirmedAuthenticator.ok, true);
    const authenticatorState = await send({ type: "GET_AUTHENTICATOR_STATE" });
    assert.equal(authenticatorState.ok, true);
    assert.equal(authenticatorState.result.metadata.length, 1);
    const metadata = authenticatorState.result.metadata[0];
    assert.equal(metadata.secretOmitted, true);
    const authenticatorCode = await send({ type: "GET_AUTHENTICATOR_CODE", id: metadata.id });
    assert.equal(authenticatorCode.ok, true);
    assert.equal(authenticatorCode.result.ok, true);
    assert.equal(typeof authenticatorCode.result.nextCode, "string");
    const metadataExport = await send({ type: "EXPORT_AUTHENTICATOR_METADATA" });
    assert.equal(metadataExport.ok, true);
    assert.doesNotMatch(JSON.stringify(metadataExport), /JBSWY3DPEHPK3PXP|otpauth:/iu);
    const removedAuthenticator = await send({ type: "REMOVE_AUTHENTICATOR", id: metadata.id });
    assert.equal(removedAuthenticator.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test("automatic download capture is fail-safe, privacy-minimal, and coalesces duplicate events", async () => {
  const settings = sanitizeSettings({
    autoCaptureDownloads: true,
    handoffEndpoint: "http://127.0.0.1:47821/v1/downloads",
  });
  const harness = createChromeHarness({ initialStorage: { settings, handoffCapability: TEST_CAPABILITY } });
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const posts = [];
  let managerMode = "accepted";
  globalThis.chrome = harness.chromeMock;
  globalThis.fetch = async (url, options = {}) => {
    if (managerMode === "offline") throw new TypeError("loopback endpoint offline");
    if (options.method === "GET" && new URL(String(url)).pathname === "/v2/challenge") {
      return new Response(JSON.stringify(challengeBody(url)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (options.method !== "POST") throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`);
    const body = JSON.parse(options.body);
    posts.push({ url: String(url), options, body });
    assert.equal(body.authProof, handoffProof(handoffRequestProofInput(body, body.authNonce)));
    const downloadId = "automatic-capture-test";
    return new Response(JSON.stringify({
      protocol: HANDOFF_PROTOCOL_VERSION,
      accepted: managerMode === "accepted",
      downloadId,
      ...(managerMode === "accepted" ? { proof: handoffProof(handoffResponseProofInput(body.authNonce, downloadId)) } : {}),
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  };

  const claimsDoNotContain = (id) => !Object.prototype.hasOwnProperty.call(
    harness.storage.get("automaticDownloadClaims") ?? {},
    String(id),
  );
  const dispatchDownload = (item) => {
    harness.items.set(item.id, { ...item });
    harness.downloads.onCreated.dispatch({ ...item });
  };
  const baseDownload = (id, overrides = {}) => ({
    id,
    url: `https://example.test/download-${id}.zip`,
    finalUrl: `https://example.test/download-${id}.zip`,
    state: "in_progress",
    paused: false,
    exists: true,
    incognito: false,
    startTime: `2026-08-11T04:00:${String(id % 60).padStart(2, "0")}.000Z`,
    ...overrides,
  });

  try {
    await import(`../src/service-worker.js?automatic-capture-test=${nextHarnessId}`);
    await waitFor(
      () => harness.downloads.onCreated.listeners.length === 1 && harness.contextMenus.created.length === 1,
      "service worker initialization did not register automatic download capture",
    );

    dispatchDownload(baseDownload(101, {
      url: "https://example.test/releases/report%20final.zip",
      finalUrl: "https://example.test/releases/report%20final.zip",
      filename: "C:\\Users\\Example\\Downloads\\private-local-name.zip",
      referrer: "https://private.example.test/account",
      cookies: [{ name: "session", value: "must-not-leak" }],
      requestHeaders: [{ name: "Authorization", value: "must-not-leak" }],
    }));
    await waitFor(
      () => harness.storage.get("lastResult")?.code === "handoff-success" && claimsDoNotContain(101),
      "accepted automatic download did not finish",
    );
    assert.deepEqual(
      harness.operations.filter(([, id]) => id === 101),
      [["pause", 101], ["search", 101], ["cancel", 101], ["erase", 101]],
    );
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, settings.handoffEndpoint);
    assert.deepEqual(Object.keys(posts[0].body).sort(), ["authNonce", "authProof", "fileName", "protocol", "requestedAt", "source", "url"]);
    assert.equal(posts[0].body.url, "https://example.test/releases/report%20final.zip");
    assert.equal(posts[0].body.fileName, "report final.zip");
    assert.equal(posts[0].body.protocol, HANDOFF_PROTOCOL_VERSION);
    assert.equal(posts[0].body.source, "material-download-manager-extension");
    assert.doesNotMatch(JSON.stringify(posts[0].body), new RegExp(TEST_CAPABILITY));
    assert.match(posts[0].body.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(JSON.stringify(posts[0].body), /private-local-name|private\.example|session|Authorization|must-not-leak/);
    assert.equal(harness.operations.some(([operation, id]) => operation === "resume" && id === 101), false);

    harness.operations.length = 0;
    posts.length = 0;
    managerMode = "rejected";
    dispatchDownload(baseDownload(102));
    await waitFor(
      () => harness.operations.some(([operation, id]) => operation === "resume" && id === 102)
        && harness.storage.get("lastResult")?.code === "automatic-resumed-failed"
        && claimsDoNotContain(102),
      "manager rejection did not resume the original browser download",
    );
    assert.deepEqual(
      harness.operations.filter(([, id]) => id === 102),
      [["pause", 102], ["search", 102], ["resume", 102]],
    );
    assert.equal(posts.length, 1);
    assert.equal(harness.operations.some(([operation]) => operation === "cancel" || operation === "erase"), false);

    harness.operations.length = 0;
    posts.length = 0;
    managerMode = "offline";
    dispatchDownload(baseDownload(103));
    await waitFor(
      () => harness.operations.some(([operation, id]) => operation === "resume" && id === 103)
        && claimsDoNotContain(103),
      "offline endpoint did not resume the original browser download",
    );
    assert.deepEqual(
      harness.operations.filter(([, id]) => id === 103),
      [["pause", 103], ["search", 103], ["resume", 103]],
    );
    assert.equal(posts.length, 0);
    assert.equal(harness.operations.some(([operation]) => operation === "cancel" || operation === "erase"), false);

    harness.operations.length = 0;
    posts.length = 0;
    managerMode = "accepted";
    harness.failures.pause.add(104);
    dispatchDownload(baseDownload(104));
    await waitFor(
      () => harness.storage.get("lastResult")?.code === "automatic-pause-failed",
      "pause failure did not report that the browser download was left untouched",
    );
    assert.deepEqual(harness.operations.filter(([, id]) => id === 104), [["pause", 104], ["search", 104]]);
    assert.equal(posts.length, 0);
    assert.equal(claimsDoNotContain(104), true);

    harness.operations.length = 0;
    posts.length = 0;
    for (const item of [
      baseDownload(105, { incognito: true }),
      baseDownload(106, { paused: true }),
      baseDownload(107, { state: "complete" }),
      baseDownload(108, { byExtensionId: harness.runtime.id }),
      baseDownload(109, { url: "file:///C:/private.zip", finalUrl: "file:///C:/private.zip" }),
    ]) dispatchDownload(item);
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(harness.operations, []);
    assert.deepEqual(posts, []);

    harness.storage.set("settings", { ...settings, autoCaptureDownloads: false });
    dispatchDownload(baseDownload(110));
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(harness.operations, []);
    assert.deepEqual(posts, []);

    harness.storage.set("settings", settings);
    dispatchDownload(baseDownload(111));
    harness.downloads.onCreated.dispatch(baseDownload(111));
    await waitFor(
      () => harness.storage.get("lastResult")?.code === "handoff-success" && claimsDoNotContain(111),
      "coalesced automatic download did not finish",
    );
    assert.deepEqual(
      harness.operations.filter(([, id]) => id === 111),
      [["pause", 111], ["search", 111], ["cancel", 111], ["erase", 111]],
    );
    assert.equal(posts.length, 1);

    harness.operations.length = 0;
    posts.length = 0;
    harness.storage.set("automaticDownloadClaims", Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [String(10_000 + index), { phase: "intent", fingerprint: "a".repeat(64) }]),
    ));
    dispatchDownload(baseDownload(113));
    await waitFor(
      () => harness.storage.get("lastResult")?.code === "automatic-capacity-full",
      "full ownership table did not leave the next browser download untouched",
    );
    assert.deepEqual(harness.operations, []);
    assert.deepEqual(posts, []);
    assert.equal(Object.keys(harness.storage.get("automaticDownloadClaims")).length, 64);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("automatic download claims recover only their exact persisted IDs after worker restart", async () => {
  const settings = sanitizeSettings({
    autoCaptureDownloads: true,
    handoffEndpoint: "http://127.0.0.1:47821/v1/downloads",
  });
  const startTimes = Object.fromEntries([501, 502, 504, 505, 999].map((id) => [id, `2026-08-11T04:10:${id % 60}.000Z`]));
  const urls = Object.fromEntries([501, 502, 504, 505, 999].map((id) => [id, `https://example.test/${id}.zip`]));
  const harness = createChromeHarness({
    initialStorage: {
      settings,
      automaticDownloadClaims: {
        "501": { phase: "paused", fingerprint: downloadFingerprint(urls[501], startTimes[501]) },
        "502": { phase: "accepted", fingerprint: downloadFingerprint(urls[502], startTimes[502]) },
        "503": { phase: "unknown" },
        "504": { phase: "intent", fingerprint: downloadFingerprint(urls[504], startTimes[504]) },
        "505": { phase: "accepted", fingerprint: "b".repeat(64) },
      },
    },
    initialDownloads: [
      { id: 501, url: urls[501], startTime: startTimes[501], state: "in_progress", paused: true, exists: true },
      { id: 502, url: urls[502], startTime: startTimes[502], state: "in_progress", paused: true, exists: true },
      { id: 504, url: urls[504], startTime: startTimes[504], state: "complete", paused: false, exists: true },
      { id: 505, url: urls[505], startTime: startTimes[505], state: "in_progress", paused: true, exists: true },
      { id: 999, url: urls[999], startTime: startTimes[999], state: "in_progress", paused: true, exists: true },
    ],
  });
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  let postCount = 0;
  globalThis.chrome = harness.chromeMock;
  globalThis.fetch = async () => {
    postCount += 1;
    throw new Error("restart recovery must not repost accepted claims");
  };
  try {
    await import(`../src/service-worker.js?restart-recovery-test=${nextHarnessId}`);
    await waitFor(
      () => Object.keys(harness.storage.get("automaticDownloadClaims") ?? {}).length === 0,
      "persisted automatic download claims were not cleared after recovery",
    );
    assert.deepEqual(
      harness.operations.filter(([operation]) => operation === "search"),
      [["search", 501], ["search", 502], ["search", 504], ["search", 505]],
    );
    assert.deepEqual(harness.operations.filter(([operation]) => operation === "resume"), [["resume", 501]]);
    assert.deepEqual(harness.operations.filter(([operation]) => operation === "cancel"), [["cancel", 502]]);
    assert.deepEqual(harness.operations.filter(([operation]) => operation === "erase"), [["erase", 502]]);
    assert.equal(harness.operations.some(([, id]) => id === 503 || id === 999), false);
    assert.equal(harness.operations.some(([operation, id]) => id === 505 && (operation === "cancel" || operation === "resume")), false);
    assert.equal(harness.items.get(505)?.paused, true);
    assert.equal(harness.items.get(999)?.paused, true);
    assert.equal(postCount, 0);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
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
  assert.deepEqual(validateIncomingMessage({ type: "TEST_NARRATION", detail: "ignored" }), { type: "TEST_NARRATION" });
});

test("handoff envelope normalizes safe URLs and records the protocol source", () => {
  assert.equal(normalizeDownloadUrl("file:///C:/secret.txt"), null);
  assert.equal(normalizeDownloadUrl("https://user:pass@example.test/file"), null);
  assert.equal(deriveDownloadFileName("https://example.test/releases/My%20File.zip?token=not-a-file-name"), "My File.zip");
  assert.equal(deriveDownloadFileName("https://example.test/releases/folder%2Fescape.zip"), undefined);
  assert.equal(deriveDownloadFileName("https://example.test/releases/%E0%A4%A"), undefined);
  assert.equal(normalizeFileName("archive.zip"), "archive.zip");
  for (const fileName of ["../archive.zip", "folder/archive.zip", "folder\\archive.zip", "C:archive.zip", "..", "x\u0000.zip", "x".repeat(513)]) {
    assert.equal(normalizeFileName(fileName), null, fileName);
  }
  const envelope = createHandoffEnvelope("https://example.test/file.zip", {
    title: "File",
    selectionText: "Selected text",
    fileName: "File.zip",
  });
  assert.deepEqual(
    { protocol: envelope.protocol, source: envelope.source, url: envelope.url, title: envelope.title, selectionText: envelope.selectionText, fileName: envelope.fileName },
    { protocol: HANDOFF_PROTOCOL_VERSION, source: "material-download-manager-extension", url: "https://example.test/file.zip", title: "File", selectionText: "Selected text", fileName: "File.zip" },
  );
  assert.throws(() => createHandoffEnvelope("https://example.test/file.zip", { selectionText: "x".repeat(2049) }), /metadata is too large/);
  assert.throws(() => createHandoffEnvelope("https://example.test/file.zip", { fileName: "folder/file.zip" }), /metadata is too large/);
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
    autoCaptureDownloads: false,
    handoffEndpoint: "http://127.0.0.1:47821/v1/downloads",
  });
  assert.equal(safe.managerName, "Local <manager>");
  assert.equal(safe.languageMode, "bilingual");
  assert.equal(safe.funnyLevelEn, 5);
  assert.equal(safe.funnyLevelYue, 2);
  assert.equal(safe.autoCaptureDownloads, false);
  assert.equal(safe.handoffEndpoint, "http://127.0.0.1:47821/v1/downloads");
  assert.equal(sanitizeSettings({ handoffEndpoint: "http://example.com:47821/v1/downloads" }).handoffEndpoint, "");
  const exported = makeSettingsExport(safe);
  assert.equal(exported.schema, "material-download-manager-extension-settings");
  assert.doesNotMatch(JSON.stringify(exported), /capability|handoffCapability/u);
  assert.equal(exported.settings.autoCaptureDownloads, false);
  assert.deepEqual(parseSettingsExport(exported), safe);
  assert.throws(() => parseSettingsExport({ schema: "other", version: 1, settings: {} }));
  assert.throws(() => parseSettingsExport({ schema: "material-download-manager-extension-settings", version: 1, settings: { handoffEndpoint: "http://example.com:47821/v1/downloads" } }), /endpoint is invalid/);
  assert.equal(sanitizeSettings(DEFAULT_SETTINGS).managerName, DEFAULT_SETTINGS.managerName);
  assert.equal(DEFAULT_SETTINGS.autoCaptureDownloads, true);
  assert.equal(sanitizeSettings({}).autoCaptureDownloads, true);
  assert.equal(parseSettingsExport(makeSettingsExport({ ...DEFAULT_SETTINGS, autoCaptureDownloads: false })).autoCaptureDownloads, false);
  assert.equal(sanitizeSettings({}).handoffEndpoint, DEFAULT_HANDOFF_ENDPOINT);
});

test("School mode and emoji settings persist without credential material", () => {
  const safe = sanitizeSettings({
    schoolModeEnabled: true,
    schoolModeName: "  Quiet study  ",
    schoolModeCredentialState: "not-a-real-state",
    showEmojis: true,
    languageMode: "bilingual",
    funnyLevelEn: 5,
    funnyLevelYue: 5,
  });
  assert.equal(safe.schoolModeEnabled, true);
  assert.equal(safe.schoolModeName, "Quiet study");
  assert.equal(safe.schoolModeCredentialState, RESET_CREDENTIAL_STATES.UNAVAILABLE);
  assert.equal(safe.showEmojis, true);
  const presentation = presentationSettings(safe);
  assert.equal(presentation.languageMode, "en");
  assert.equal(presentation.funnyLevelEn, 1);
  assert.equal(presentation.funnyLevelYue, 1);
  assert.equal(presentation.showEmojis, false);
  assert.equal(localize("handoffSuccess", safe), localize("handoffSuccess", { ...DEFAULT_SETTINGS, languageMode: "en", funnyLevelEn: 1 }));
  assert.doesNotMatch(localize("handoffSuccess", safe), / · /u);
  assert.equal(decorateMessage("Saved", { ...safe, schoolModeEnabled: false, showEmojis: true }, "✅"), "✅ Saved");
  assert.equal(decorateMessage("Saved", safe, "✅"), "Saved");
  assert.equal(canDisableSchoolMode(safe, { ...safe, schoolModeEnabled: false }), false);
  assert.equal(canDisableSchoolMode(safe, { ...safe, schoolModeEnabled: false, schoolModeCredentialState: RESET_CREDENTIAL_STATES.CONFIGURED }), true);
  const exported = makeSettingsExport(safe);
  assert.equal(exported.settings.schoolModeName, "Quiet study");
  assert.equal(exported.settings.showEmojis, true);
  assert.doesNotMatch(JSON.stringify(exported), /password|passphrase|pin|secret|otp|token/i);
  assert.equal(DEFAULT_SCHOOL_MODE_NAME, "School mode");
});

test("narrator settings are opt-in, bounded, and exportable without secrets", () => {
  const safe = sanitizeSettings({
    narratorEnabled: true,
    narratorLanguage: "both",
    narratorSoundMode: "reduced",
    narratorQuietMode: true,
    narratorRespectReducedMotion: false,
    narratorReducedMotionActive: true,
  });
  assert.equal(DEFAULT_SETTINGS.narratorEnabled, false);
  assert.equal(safe.narratorEnabled, true);
  assert.equal(safe.narratorLanguage, "both");
  assert.equal(safe.narratorSoundMode, "reduced");
  assert.equal(safe.narratorQuietMode, true);
  assert.equal(safe.narratorRespectReducedMotion, false);
  assert.equal(safe.narratorReducedMotionActive, true);
  assert.equal(sanitizeSettings({ narratorLanguage: "mandarin" }).narratorLanguage, "en");
  assert.equal(sanitizeSettings({ narratorSoundMode: "loud" }).narratorSoundMode, "normal");
  assert.deepEqual([...NARRATOR_LANGUAGE_MODES].sort(), ["both", "en", "yue"]);
  assert.deepEqual([...NARRATOR_SOUND_MODES].sort(), ["muted", "normal", "reduced"]);
  const exported = makeSettingsExport(safe);
  assert.equal(Object.prototype.hasOwnProperty.call(exported.settings, "narratorReducedMotionActive"), false);
  assert.equal(parseSettingsExport(exported).narratorReducedMotionActive, false);
  assert.doesNotMatch(JSON.stringify(exported), /password|passphrase|pin|secret|otp|token/i);
  const school = presentationSettings({ ...safe, schoolModeEnabled: true, languageMode: "bilingual", funnyLevelEn: 5, funnyLevelYue: 5 });
  assert.equal(school.narratorEnabled, true);
  assert.equal(school.narratorLanguage, "both");
  assert.equal(school.funnyLevelEn, 1);
  assert.equal(school.showEmojis, false);
});

test("authenticator message boundary is strict and secret-bearing only for explicit registration calls", () => {
  assert.deepEqual(validateIncomingMessage({ type: "GET_AUTHENTICATOR_STATE" }), { type: "GET_AUTHENTICATOR_STATE" });
  const input = { issuer: "Example", account: "alice", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 };
  assert.deepEqual(validateIncomingMessage({ type: "PREPARE_AUTHENTICATOR", input }), { type: "PREPARE_AUTHENTICATOR", input });
  assert.deepEqual(validateIncomingMessage({ type: "CONFIRM_AUTHENTICATOR", input, code: "602287" }), { type: "CONFIRM_AUTHENTICATOR", input, code: "602287" });
  assert.equal(validateIncomingMessage({ type: "CONFIRM_AUTHENTICATOR", input, code: "602287", extra: true }), null);
  assert.equal(validateIncomingMessage({ type: "PREPARE_AUTHENTICATOR", input: { ...input, secret: "bad!" } }), null);
  assert.equal(validateIncomingMessage({ type: "GET_AUTHENTICATOR_CODE", id: "bad id" }), null);
  assert.deepEqual(validateIncomingMessage({ type: "REMOVE_AUTHENTICATOR", id: "authenticator-test-001" }), { type: "REMOVE_AUTHENTICATOR", id: "authenticator-test-001" });
});

test("extension authenticator mirrors RFC 6238 vectors and compact URI defaults", async () => {
  const vectors = [
    { algorithm: "SHA1", secret: base32Encode("12345678901234567890"), digits: 8, expected: ["94287082", "07081804", "14050471", "89005924", "69279037"] },
    { algorithm: "SHA256", secret: base32Encode("12345678901234567890123456789012"), digits: 8, expected: ["46119246", "68084774", "67062674", "91819424", "90698825"] },
    { algorithm: "SHA512", secret: base32Encode("1234567890123456789012345678901234567890123456789012345678901234"), digits: 8, expected: ["90693936", "25091201", "99943326", "93441116", "38618901"] },
  ];
  const timestamps = [59_000, 1_111_111_109_000, 1_111_111_111_000, 1_234_567_890_000, 2_000_000_000_000];
  for (const vector of vectors) {
    const registration = { issuer: "RFC", account: vector.algorithm, secret: vector.secret, algorithm: vector.algorithm, digits: vector.digits, period: 30 };
    for (let index = 0; index < timestamps.length; index += 1) {
      assert.equal(await generateTotpCode(registration, timestamps[index]), vector.expected[index]);
      assert.equal(await verifyTotpCode(registration, vector.expected[index], timestamps[index], 1), true);
    }
  }
  const defaults = normalizeTotpRegistration({ issuer: "Material Download Manager", account: "alice", secret: "JBSWY3DPEHPK3PXP" });
  const uri = buildTotpUri(defaults);
  assert.doesNotMatch(uri, /algorithm=|digits=|period=|issuer=/u);
  assert.deepEqual(parseTotpUri(uri), defaults);
  const nonDefault = { ...defaults, algorithm: "SHA512", digits: 8, period: 45 };
  assert.deepEqual(parseTotpUri(buildTotpUri(nonDefault)), nonDefault);
});

test("extension authenticator QR matrix is local, bounded, and shaped for the shipped issuer", () => {
  const model = createTotpRegistrationModel({ issuer: "Material Download Manager", account: "alice", secret: "JBSWY3DPEHPK3PXP" });
  const payloadBytes = new TextEncoder().encode(model.otpauthUri).length;
  assert.ok(payloadBytes <= qrPayloadCapacity());
  const matrix = createQrMatrix(model.otpauthUri);
  assert.equal(matrix.length, 37);
  assert.equal(matrix.every((row) => row.length === 37 && row.every((value) => value === 0 || value === 1)), true);
  assert.equal(matrix[29][8], 1, "QR dark module uses the standards coordinate");
  const svg = qrMatrixToSvg(matrix, "One-time authenticator pairing QR");
  assert.match(svg, /role="img"/u);
  assert.match(svg, /shape-rendering="crispEdges"/u);
  assert.doesNotMatch(svg, /otpauth:|<image/iu);
});

test("authenticator store keeps metadata and browser-local secrets separate across worker recreation", async () => {
  const values = new Map();
  const local = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  };
  const timestamp = 1_700_000_000_000;
  const input = { issuer: "Example", account: "alice", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 };
  const first = createAuthenticatorStore({ local, now: () => timestamp, idFactory: () => "authenticator-test-001" });
  const model = await first.prepare(input);
  assert.equal(model.kind, "totp");
  const code = await generateTotpCode(input, timestamp);
  const confirmed = await first.confirm({ issuer: model.issuer, account: model.account, secret: model.secret, algorithm: model.algorithm, digits: model.digits, period: model.period }, code, timestamp);
  assert.equal(confirmed.ok, true);
  assert.equal(isTotpMetadata(confirmed.metadata), true);
  assert.equal(Object.prototype.hasOwnProperty.call(values.get(AUTHENTICATOR_METADATA_KEY)[0], "secret"), false);
  assert.equal(values.get(AUTHENTICATOR_SECRETS_KEY)[confirmed.metadata.id], input.secret);
  const second = createAuthenticatorStore({ local, now: () => timestamp, idFactory: () => "unused-id-000" });
  const state = await second.state();
  assert.equal(state.metadata.length, 1);
  const current = await second.getCode(confirmed.metadata.id, timestamp);
  assert.equal(current.ok, true);
  assert.equal(current.code, code);
  assert.equal(typeof current.nextCode, "string");
  assert.equal(current.remainingSeconds >= 1 && current.remainingSeconds <= 30, true);
  const removed = await second.remove(confirmed.metadata.id);
  assert.equal(removed.ok, true);
  assert.deepEqual(await second.state(), { metadata: [] });
  assert.deepEqual(values.get(AUTHENTICATOR_SECRETS_KEY), {});

  const uriValues = new Map();
  const uriLocal = {
    async get(key) { return { [key]: uriValues.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => uriValues.set(key, value)); },
  };
  const uriStore = createAuthenticatorStore({ local: uriLocal, now: () => timestamp, idFactory: () => "authenticator-uri-001" });
  const uri = buildTotpUri(input);
  const uriCode = await generateTotpCode(input, timestamp);
  const uriConfirmed = await uriStore.confirm({ uri }, uriCode, timestamp);
  assert.equal(uriConfirmed.ok, true, "URI-bearing confirmation uses the same normalized registration path");
});

test("authenticator store fails closed on corrupt or oversized browser-local records and clears pending input", async () => {
  const values = new Map();
  const local = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  };
  const corrupt = createAuthenticatorStore({ local, idFactory: () => "authenticator-test-002" });
  values.set(AUTHENTICATOR_METADATA_KEY, [{ schemaVersion: AUTHENTICATOR_SCHEMA_VERSION, id: "bad", issuer: "x", account: "y", algorithm: "SHA1", digits: 6, period: 30, secretOmitted: false }]);
  await assert.rejects(() => corrupt.state(), /corrupt|safety limit/iu);
  values.delete(AUTHENTICATOR_METADATA_KEY);
  values.set(AUTHENTICATOR_SECRETS_KEY, Object.fromEntries(Array.from({ length: 65 }, (_item, index) => [`secret-${index.toString().padStart(2, "0")}`, "JBSWY3DPEHPK3PXP"])));
  values.set(AUTHENTICATOR_METADATA_KEY, [createTotpMetadata("authenticator-test-005", { issuer: "Example", account: "x", secret: "JBSWY3DPEHPK3PXP" })]);
  await assert.rejects(() => corrupt.getCode("authenticator-test-005", Date.now()), /corrupt|safety limit/iu);
  values.clear();
  const pendingStore = createAuthenticatorStore({ local, now: () => 1_700_000_000_000, idFactory: () => "authenticator-test-003" });
  const model = await pendingStore.prepare({ issuer: "Example", account: "bob", secret: "JBSWY3DPEHPK3PXP" });
  await pendingStore.cancelPending();
  const code = await generateTotpCode(model, 1_700_000_000_000);
  const confirmed = await pendingStore.confirm(model, code, 1_700_000_000_000);
  assert.equal(confirmed.ok, true, "confirmation carries the in-memory model so worker suspension does not lose it");
});

test("authenticator storage reconciliation removes orphan secrets and rolls back failed journal writes", async () => {
  const values = new Map();
  const local = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  };
  const timestamp = 1_700_000_000_000;
  const input = { issuer: "Example", account: "reconcile", secret: "JBSWY3DPEHPK3PXP" };
  const metadata = createTotpMetadata("authenticator-valid-001", input);
  values.set(AUTHENTICATOR_METADATA_KEY, [metadata]);
  values.set(AUTHENTICATOR_SECRETS_KEY, {
    [metadata.id]: input.secret,
    "authenticator-orphan-001": input.secret,
  });
  const reconciler = createAuthenticatorStore({ local, now: () => timestamp, idFactory: () => "authenticator-valid-001" });
  assert.deepEqual((await reconciler.state()).metadata, [metadata]);
  assert.deepEqual(values.get(AUTHENTICATOR_SECRETS_KEY), { [metadata.id]: input.secret });

  const duplicateCode = await generateTotpCode(input, timestamp);
  const duplicate = await reconciler.confirm(input, duplicateCode, timestamp);
  assert.deepEqual(duplicate, { ok: false, code: "authenticator-id-collision" });
  assert.equal(values.get(AUTHENTICATOR_METADATA_KEY).length, 1);

  const failedValues = new Map();
  let failJournalWrite = true;
  const flaky = {
    async get(key) { return { [key]: failedValues.get(key) }; },
    async set(entries) {
      if (failJournalWrite && Object.prototype.hasOwnProperty.call(entries, DISPLAY_NAME_MUTATION_JOURNAL_KEY)) {
        failJournalWrite = false;
        throw new Error("journal storage unavailable");
      }
      Object.entries(entries).forEach(([key, value]) => failedValues.set(key, value));
    },
  };
  const failing = createAuthenticatorStore({ local: flaky, now: () => timestamp, idFactory: () => "authenticator-failed-001" });
  const failingInput = { ...input, account: "failed" };
  const failingCode = await generateTotpCode(failingInput, timestamp);
  await assert.rejects(() => failing.confirm(failingInput, failingCode, timestamp), /journal storage unavailable/iu);
  assert.deepEqual(await failing.state(), { metadata: [] });
  assert.deepEqual(failedValues.get(AUTHENTICATOR_SECRETS_KEY), {});
});

test("authenticator mutation journal is redacted and timestamp-bounded", async () => {
  const values = new Map();
  const storage = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  };
  const entry = await appendAuthenticatorMutation(storage, { action: "authenticator-created", id: "authenticator-test-004", at: "2026-08-11T14:00:00.000Z" });
  assert.equal(entry.redacted, true);
  assert.equal(entry.source, "extension-authenticator");
  assert.doesNotMatch(JSON.stringify(values), /authenticator-test-004/u);
  await assert.rejects(() => appendAuthenticatorMutation(storage, { action: "authenticator-removed", id: "authenticator-test-004", at: "not-a-date" }), /metadata is invalid/iu);
});

test("narration parts keep language order and funny-level styling separate", () => {
  const parts = narrationParts("handoffSuccess", { ...DEFAULT_SETTINGS, funnyLevelEn: 1, funnyLevelYue: 5 });
  assert.match(parts.en, /The URL was accepted/);
  assert.match(parts.yue, /本機程式/);
  assert.notEqual(parts.en, narrationParts("handoffSuccess", { ...DEFAULT_SETTINGS, funnyLevelEn: 5 }).en);
  assert.notEqual(parts.yue, narrationParts("handoffSuccess", { ...DEFAULT_SETTINGS, funnyLevelYue: 1 }).yue);
});

function createFakeClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();
  const setTimeoutFake = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { at: current + Number(delay), callback });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  const advance = (milliseconds) => {
    current += milliseconds;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at > current) continue;
        timers.delete(id);
        timer.callback();
        progressed = true;
      }
    }
  };
  return { now: () => current, setTimeoutFake, clearTimeoutFake, advance };
}

function narratorSettings(overrides = {}) {
  return sanitizeSettings({ ...DEFAULT_SETTINGS, narratorEnabled: true, ...overrides });
}

test("narrator serializes Both language speech, debounces, and uses final callbacks", () => {
  const clock = createFakeClock();
  const spoken = [];
  const tts = {
    speak(text, options, done) { spoken.push({ text, options, done }); },
    stop() {},
    isAvailable: () => true,
  };
  const narrator = createNarrator({
    tts,
    now: clock.now,
    setTimeout: clock.setTimeoutFake,
    clearTimeout: clock.clearTimeoutFake,
    isReducedMotion: () => false,
    isScreenReaderActive: () => false,
  });
  const settings = narratorSettings({ narratorLanguage: "both", funnyLevelEn: 1, funnyLevelYue: 5 });
  assert.equal(narrator.narrateKey("handoffSuccess", settings, {}, { category: "success" }).accepted, true);
  clock.advance(NARRATOR_DEBOUNCE_MS - 1);
  assert.equal(spoken.length, 0);
  clock.advance(1);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /The URL was accepted/);
  assert.equal(spoken[0].options.lang, "en-US");
  assert.equal(spoken[0].options.enqueue, false);
  assert.equal(spoken[0].options.rate, 0.94);
  spoken[0].done();
  assert.equal(spoken.length, 2);
  assert.match(spoken[1].text, /本機程式/);
  assert.equal(spoken[1].options.lang, "zh-HK");
  assert.equal(spoken[1].options.rate, 1.08);
  spoken[1].done();
  assert.equal(narrator.snapshot().active, false);
});

test("narrator replaces pending events, enforces cooldown, and ignores late generations", () => {
  const clock = createFakeClock();
  const spoken = [];
  let stopCount = 0;
  const tts = {
    speak(text, options, done) { spoken.push({ text, options, done }); },
    stop() { stopCount += 1; },
    isAvailable: () => true,
  };
  const narrator = createNarrator({ tts, now: clock.now, setTimeout: clock.setTimeoutFake, clearTimeout: clock.clearTimeoutFake, isReducedMotion: () => false, isScreenReaderActive: () => false });
  const settings = narratorSettings({ narratorLanguage: "en" });
  assert.equal(narrator.narrateText("old", settings, { category: "general" }).accepted, true);
  const replacement = narrator.narrateText("new", settings, { category: "general" });
  assert.equal(replacement.replaced, true);
  clock.advance(NARRATOR_DEBOUNCE_MS);
  assert.deepEqual(spoken.map((item) => item.text), ["new"]);
  spoken[0].done();
  assert.equal(narrator.narrateText("too soon", settings, { category: "general" }).accepted, true);
  clock.advance(NARRATOR_DEBOUNCE_MS);
  assert.equal(spoken.length, 1);
  clock.advance(NARRATOR_COOLDOWN_MS);
  assert.equal(spoken.length, 2);
  const lateDone = spoken[1].done;
  narrator.cancel();
  assert.equal(stopCount, 1);
  assert.equal(narrator.narrateText("fresh", settings, { category: "success" }).accepted, true);
  clock.advance(NARRATOR_DEBOUNCE_MS);
  assert.equal(spoken.length, 3);
  lateDone();
  assert.equal(narrator.snapshot().active, true);

  const errorClock = createFakeClock();
  const errorSpoken = [];
  const errorNarrator = createNarrator({
    tts: { speak(text, options, done) { errorSpoken.push({ text, done }); }, stop() {}, isAvailable: () => true },
    now: errorClock.now,
    setTimeout: errorClock.setTimeoutFake,
    clearTimeout: errorClock.clearTimeoutFake,
    isReducedMotion: () => false,
    isScreenReaderActive: () => false,
  });
  assert.equal(errorNarrator.narrateText("first error", settings, { category: "error" }).accepted, true);
  errorClock.advance(NARRATOR_DEBOUNCE_MS);
  errorSpoken[0].done();
  assert.equal(errorNarrator.narrateText("second error", settings, { category: "error" }).accepted, true);
  errorClock.advance(NARRATOR_DEBOUNCE_MS);
  assert.equal(errorSpoken.length, 2);
  const priority = createNarrator({
    tts: { speak() {}, stop() {}, isAvailable: () => true },
    now: errorClock.now,
    setTimeout: errorClock.setTimeoutFake,
    clearTimeout: errorClock.clearTimeoutFake,
    isReducedMotion: () => false,
    isScreenReaderActive: () => false,
  });
  assert.equal(priority.narrateText("error", settings, { category: "error" }).accepted, true);
  assert.equal(priority.narrateText("info", settings, { category: "info" }).accepted, true);
  assert.deepEqual(priority.snapshot().pending.categories, ["error", "info"]);

  const pendingCancelClock = createFakeClock();
  const pendingSpoken = [];
  const pendingCancel = createNarrator({
    tts: { speak(text, options, done) { pendingSpoken.push(text); }, stop() {}, isAvailable: () => true },
    now: pendingCancelClock.now,
    setTimeout: pendingCancelClock.setTimeoutFake,
    clearTimeout: pendingCancelClock.clearTimeoutFake,
    isReducedMotion: () => false,
    isScreenReaderActive: () => false,
  });
  pendingCancel.narrateText("stale settings event", settings, { category: "success" });
  pendingCancel.cancel();
  pendingCancelClock.advance(NARRATOR_DEBOUNCE_MS + NARRATOR_COOLDOWN_MS);
  assert.deepEqual(pendingSpoken, []);
});

test("narrator fails closed for quiet, muted, reduced-motion, screen-reader, and unavailable states", () => {
  const clock = createFakeClock();
  const tts = { speak() {}, stop() {}, isAvailable: () => true };
  const make = (settings, overrides = {}) => createNarrator({
    tts,
    now: clock.now,
    setTimeout: clock.setTimeoutFake,
    clearTimeout: clock.clearTimeoutFake,
    isReducedMotion: () => overrides.reducedMotion === true,
    isScreenReaderActive: () => overrides.screenReader === true,
  }).narrateText("event", settings, { category: "info" });
  assert.equal(make({ ...DEFAULT_SETTINGS }).accepted, false);
  assert.equal(make(narratorSettings({ narratorQuietMode: true })).reason, "quiet");
  assert.equal(make(narratorSettings({ narratorSoundMode: "muted" })).reason, "muted");
  assert.equal(make(narratorSettings(), { reducedMotion: true }).reason, "reduced-motion");
  assert.equal(make(narratorSettings({ narratorReducedMotionActive: true })).reason, "reduced-motion");
  assert.equal(make(narratorSettings(), { screenReader: true }).reason, "screen-reader");
  const unavailable = createNarrator({ tts: { speak() {}, isAvailable: () => false } });
  assert.equal(unavailable.narrateText("event", narratorSettings(), { category: "info" }).reason, "unsupported");
});

test("narrator reschedules a newly queued error ahead of a progress cooldown", () => {
  const clock = createFakeClock();
  const spoken = [];
  const narrator = createNarrator({
    tts: { speak(text, options, done) { spoken.push({ text, done }); }, stop() {}, isAvailable: () => true },
    now: clock.now,
    setTimeout: clock.setTimeoutFake,
    clearTimeout: clock.clearTimeoutFake,
    isReducedMotion: () => false,
    isScreenReaderActive: () => false,
  });
  const settings = narratorSettings({ narratorLanguage: "en" });
  narrator.narrateText("progress one", settings, { category: "progress" });
  clock.advance(NARRATOR_DEBOUNCE_MS);
  spoken[0].done();
  narrator.narrateText("progress two", settings, { category: "progress" });
  narrator.narrateText("failure", settings, { category: "error" });
  clock.advance(NARRATOR_DEBOUNCE_MS);
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1].text, "failure");
});

test("Chrome TTS adapter waits for final events and never delegates queue ordering", () => {
  const calls = [];
  let completed = 0;
  const tts = {
    speak(text, options, callback) { calls.push({ text, options, callback }); },
    stop() {},
  };
  const adapter = createChromeTtsAdapter(tts, { assumePerCallEvents: true });
  assert.equal(adapter.isAvailable(), true);
  adapter.speak("hello", { lang: "en-US", enqueue: true }, () => { completed += 1; });
  assert.equal(completed, 0);
  assert.equal(calls[0].options.enqueue, false);
  assert.deepEqual(calls[0].options.requiredEventTypes, ["end", "interrupted", "cancelled", "error"]);
  calls[0].options.onEvent({ type: "start", isFinalEvent: false });
  assert.equal(completed, 0);
  calls[0].options.onEvent({ type: "provider-final", isFinalEvent: true });
  assert.equal(completed, 1);
  calls[0].options.onEvent({ type: "end", charIndex: 5, isFinalEvent: true });
  assert.equal(completed, 1);
  const unavailable = createChromeTtsAdapter({ speak() {} });
  assert.equal(unavailable.isAvailable(), false);

  const voiceCalls = [];
  const unavailableLanguages = [];
  const voiceAdapter = createChromeTtsAdapter({
    getVoices(callback) {
      callback([
        { voiceName: "Remote Cantonese", lang: "zh-HK", remote: true, eventTypes: ["end", "error"] },
        { voiceName: "Local English", lang: "en-US", remote: false, eventTypes: ["end", "interrupted", "cancelled", "error"] },
      ]);
    },
    speak(text, options) { voiceCalls.push({ text, options }); },
    stop() {},
  }, { onUnavailable: (language) => unavailableLanguages.push(language) });
  return voiceAdapter.refreshVoices().then(() => {
    assert.equal(voiceAdapter.supportsLanguage("yue"), false);
    assert.equal(voiceAdapter.supportsLanguage("en"), true);
    voiceAdapter.speak("廣東話", { language: "yue", lang: "zh-HK" }, () => {});
    assert.deepEqual(unavailableLanguages, ["yue"]);
    voiceAdapter.speak("English", { language: "en", lang: "en-US" }, () => {});
    assert.equal(voiceCalls[0].options.voiceName, "Local English");
    assert.equal(voiceCalls[0].options.onEvent instanceof Function, true);
    const brokenVoices = createChromeTtsAdapter({
      getVoices() { return Promise.reject(new Error("voice enumeration failed")); },
      speak() {},
      stop() {},
    });
    return brokenVoices.refreshVoices().then(() => {
      assert.equal(brokenVoices.supportsLanguage("yue"), false);
    });
  });
});

test("credential abstraction is explicit and fail-closed without storing a secret", async () => {
  const abstraction = createCredentialAbstraction(RESET_CREDENTIAL_STATES.UNAVAILABLE);
  assert.equal(abstraction.available, false);
  assert.equal(abstraction.supportsVerification, false);
  assert.deepEqual(await abstraction.verifyLocally(), { ok: false, code: "credential-unavailable" });
  assert.deepEqual(await abstraction.configure(), { ok: false, code: "credential-unavailable" });
  assert.deepEqual(await abstraction.clear(), { ok: false, code: "credential-unavailable" });
  assert.equal(createCredentialAbstraction(RESET_CREDENTIAL_STATES.CONFIGURED).available, false);
  assert.doesNotMatch(JSON.stringify(abstraction), /password|passphrase|pin|secret|otp|token/i);
});

test("display-name mutation journal stores only redacted append-only metadata", async () => {
  const values = new Map();
  const storage = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); },
  };
  const created = await appendDisplayNameMutation(storage, {
    before: DEFAULT_SETTINGS.managerName,
    after: "First display name",
    shippedName: DEFAULT_SETTINGS.managerName,
    at: "2026-08-11T14:00:00.000Z",
  });
  const reset = await appendDisplayNameMutation(storage, {
    before: "First display name",
    after: DEFAULT_SETTINGS.managerName,
    shippedName: DEFAULT_SETTINGS.managerName,
    at: "2026-08-11T14:00:01.000Z",
  });
  assert.equal(created.action, "display-name-created");
  assert.equal(reset.action, "display-name-reset");
  const entries = await readDisplayNameMutationJournal(storage);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].schema, DISPLAY_NAME_MUTATION_JOURNAL_SCHEMA);
  assert.equal(entries[0].redacted, true);
  assert.equal(entries[0].beforeHash.length, 64);
  assert.equal(entries[0].afterHash.length, 64);
  assert.doesNotMatch(JSON.stringify(values.get(DISPLAY_NAME_MUTATION_JOURNAL_KEY)), /First display name|Material Download Manager/i);
  const concurrentValues = new Map();
  const concurrentStorage = {
    async get(key) { return { [key]: concurrentValues.get(key) }; },
    async set(entries) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      Object.entries(entries).forEach(([key, value]) => concurrentValues.set(key, value));
    },
  };
  await Promise.all([
    appendDisplayNameMutation(concurrentStorage, { before: "one", after: "two", shippedName: DEFAULT_SETTINGS.managerName, at: "2026-08-11T14:00:02.000Z" }),
    appendDisplayNameMutation(concurrentStorage, { before: "two", after: "three", shippedName: DEFAULT_SETTINGS.managerName, at: "2026-08-11T14:00:03.000Z" }),
  ]);
  assert.equal((await readDisplayNameMutationJournal(concurrentStorage)).length, 2);
  values.set(DISPLAY_NAME_MUTATION_JOURNAL_KEY, [{ schema: "not-a-journal" }]);
  await assert.rejects(
    () => appendDisplayNameMutation(storage, {
      before: "one",
      after: "two",
      shippedName: DEFAULT_SETTINGS.managerName,
    }),
    (error) => error?.code === "display-name-history-unavailable",
  );
  values.delete(DISPLAY_NAME_MUTATION_JOURNAL_KEY);
  await assert.rejects(
    () => appendDisplayNameMutation({ get: async () => ({ [DISPLAY_NAME_MUTATION_JOURNAL_KEY]: [] }) }, {
      before: "one",
      after: "two",
      shippedName: DEFAULT_SETTINGS.managerName,
    }),
    (error) => error?.code === "display-name-history-unavailable",
  );
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

test("School mode, emoji controls, live settings refresh, and redacted journal wiring are present", async () => {
  const options = await read("src/options.html");
  const optionsScript = await read("src/options.js");
  const popupScript = await read("src/popup.js");
  const worker = await read("src/service-worker.js");
  assert.match(options, /id="school-mode"/);
  assert.match(options, /id="school-mode-name"/);
  assert.match(options, /id="show-emojis"/);
  assert.match(options, /data-school-hidden/);
  assert.match(optionsScript, /chrome\.storage\.onChanged\.addListener/);
  assert.match(optionsScript, /displayNameHistoryRecorded/);
  assert.match(popupScript, /document\.documentElement\.lang/);
  assert.match(popupScript, /chrome\.storage\.onChanged\.addListener/);
  assert.match(popupScript, /school-mode-reset-unavailable/);
  assert.match(worker, /appendDisplayNameMutation/);
  assert.match(worker, /school-mode-reset-unavailable/);
  assert.match(localize("schoolModeLabel", { ...DEFAULT_SETTINGS, schoolModeName: "Quiet study" }, { name: "Quiet study" }), /Quiet study/);
  assert.match(localize("popupTitle", { ...DEFAULT_SETTINGS, managerName: "Renamed manager" }, { name: "Renamed manager" }), /Renamed manager/);
  assert.match(localize("schoolModeCredentialStatus", DEFAULT_SETTINGS), /No credential material is stored/);
});

test("narrator controls and service-worker event wiring are localized and searchable", async () => {
  const options = await read("src/options.html");
  const optionsScript = await read("src/options.js");
  const popup = await read("src/popup.html");
  const popupScript = await read("src/popup.js");
  const worker = await read("src/service-worker.js");
  const narrator = await read("src/shared/narrator.js");
  const adapter = await read("src/shared/chrome-tts.js");
  for (const id of ["narrator-enabled", "narrator-language", "narrator-sound-mode", "narrator-quiet-mode", "narrator-respect-reduced-motion", "test-narration"]) {
    assert.match(options, new RegExp(`id="${id}"`), id);
  }
  assert.match(options, /data-school-hidden[^>]+data-search="narrator/);
  assert.match(options, /<section class="setting-card export-card" data-school-hidden/);
  assert.match(popup, /data-school-hidden[^>]+data-l10n="settingsDisclosure"/);
  assert.match(popupScript, /document\.querySelectorAll\("\[data-school-hidden\]"\)/);
  assert.match(optionsScript, /REQUIRED_SEARCHABLE_SETTING_IDS[\s\S]*"narrator-enabled"/);
  assert.match(optionsScript, /TEST_NARRATION/);
  assert.match(worker, /RESULT_NARRATION_KEYS/);
  assert.match(worker, /narratorSettingsGeneration/);
  assert.match(worker, /generation !== narratorSettingsGeneration/);
  assert.match(worker, /void narrateResult\(value\)/);
  const narrateResultBlock = worker.match(/async function narrateResult[\s\S]*?\r?\n\}\r?\n\r?\nasync function recordResult/iu)?.[0] ?? "";
  assert.doesNotMatch(narrateResultBlock, /value\.detail|selectionText|fileName|capability/iu);
  assert.match(adapter, /requiredEventTypes/);
  assert.match(narrator, /NARRATOR_DEBOUNCE_MS/);
  assert.match(narrator, /NARRATOR_COOLDOWN_MS/);
  assert.match(adapter, /enqueue: false/);
  for (const key of ["narratorHeading", "narratorHelp", "narratorProvenance", "narratorLanguageBoth", "narratorSoundReduced", "narratorTestButton", "narratorUnavailable"]) {
    assert.equal(hasLocalizationKey(key), true, key);
  }
  assert.match(localize("narratorHelp", { ...DEFAULT_SETTINGS, languageMode: "en" }), /serialized|debounced|rate-limited/);
  assert.match(localize("narratorHelp", { ...DEFAULT_SETTINGS, languageMode: "yue" }), /語音事件/);
});

test("popup and options localization markers all resolve to known copy", async () => {
  const html = `${await read("src/popup.html")}\n${await read("src/options.html")}`;
  const markers = [...html.matchAll(/data-l10n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(markers.length > 30);
  markers.forEach((key) => assert.equal(hasLocalizationKey(key), true, key));

  const typedOutcomeKeys = [
    "handoffUnpaired",
    "automaticPauseFailed",
    "automaticCapacityFull",
    "automaticResumedFailed",
    "automaticResumeFailed",
    "automaticCancelFailedResumed",
    "automaticCancelFailedOriginalGone",
    "automaticCancelFailedAlreadyRunning",
    "automaticCancelRecoveryFailed",
    "automaticOriginalGone",
    "automaticOriginalAlreadyRunning",
    "automaticOwnershipMismatch",
    "automaticRestartResumeFailed",
    "connectionUnpaired",
  ];
  for (const key of typedOutcomeKeys) {
    assert.equal(hasLocalizationKey(key), true, key);
    for (let level = 1; level <= 5; level += 1) {
      assert.ok(localize(key, { ...DEFAULT_SETTINGS, languageMode: "en", funnyLevelEn: level }).length > 20, `${key} en ${level}`);
      assert.ok(localize(key, { ...DEFAULT_SETTINGS, languageMode: "yue", funnyLevelYue: level }).length > 10, `${key} yue ${level}`);
    }
    assert.match(localize(key, { ...DEFAULT_SETTINGS, languageMode: "bilingual" }), / · /u, `${key} bilingual`);
  }
  assert.match(localize("automaticCancelFailedResumed", DEFAULT_SETTINGS), /duplicate|two files/u);
  assert.doesNotMatch(localize("automaticOwnershipMismatch", DEFAULT_SETTINGS), /accepted the URL/u);
  assert.match(localize("handoffUnpaired", DEFAULT_SETTINGS), /Prepare .*extension/u);
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
    "src/shared/pairing.js",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /<script[^>]+src=["']https?:/i, path);
    assert.doesNotMatch(source, /<link[^>]+href=["']https?:/i, path);
    assert.doesNotMatch(source, /google-analytics|plausible\.io|segment\.com/i, path);
  }
});
