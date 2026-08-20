import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OLLAMA_ENDPOINT,
  OLLAMA_STATE_KEY,
  computeHardwareFit,
  createOllamaSuite,
  createRedactedChatExport,
  validateOllamaEndpoint,
  validateOllamaMessage,
} from "../src/shared/ollama.js";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function createLocal(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) {
      if (typeof key === "string") return { [key]: values.get(key) };
      if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, values.get(item)]));
      return Object.fromEntries(values);
    },
    async set(next) { Object.entries(next).forEach(([key, value]) => values.set(key, structuredClone(value))); },
  };
}

function jsonResponse(value, type = "application/json") {
  const body = type === "application/x-ndjson" ? value : JSON.stringify(value);
  return new Response(body, { status: 200, headers: { "content-type": type } });
}

function createLocalApi({ chat = true, pull = true } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    requests.push({ path: parsed.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : null, credentials: init.credentials, redirect: init.redirect });
    if (parsed.pathname === "/api/version") return jsonResponse({ version: "0.9.1" });
    if (parsed.pathname === "/api/ps") return jsonResponse({ models: [{ name: "tiny:latest" }] });
    if (parsed.pathname === "/api/tags") return jsonResponse({
      models: [{
        name: "tiny:latest",
        digest: "sha256:abcdef0123456789",
        size: 200_000_000,
        modified_at: "2026-08-12T20:00:00.123456Z",
        details: { family: "tiny", families: ["tiny"], parameter_size: "1B", quantization_level: "Q4" },
      }],
    });
    if (parsed.pathname === "/api/show") return jsonResponse({
      capabilities: ["completion", "vision"],
      details: { family: "tiny", parameter_size: "1B", quantization_level: "Q4" },
      model_info: { "general.parameter_count": 1_000_000_000, "tiny.context_length": 4096 },
    });
    if (parsed.pathname === "/api/pull" && pull) {
      return jsonResponse(`${JSON.stringify({ status: "pulling manifest", total: 100, completed: 40 })}\n${JSON.stringify({ status: "success", total: 100, completed: 100 })}\n`, "application/x-ndjson");
    }
    if (parsed.pathname === "/api/chat" && chat) {
      return jsonResponse(`${JSON.stringify({ message: { content: "Hello " }, done: false })}\n${JSON.stringify({ message: { content: "local world." }, done: true })}\n`, "application/x-ndjson");
    }
    if (parsed.pathname === "/api/delete" || parsed.pathname === "/api/copy") return jsonResponse({});
    return new Response("missing", { status: 404, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, requests };
}

function idFactory(prefix) {
  return `${prefix}_abcdefghijklmnop`;
}

test("Ollama endpoint and MV3 message boundaries reject remote, path, shell, and unbounded input", () => {
  assert.deepEqual(validateOllamaEndpoint(DEFAULT_OLLAMA_ENDPOINT), { valid: true, value: DEFAULT_OLLAMA_ENDPOINT, error: null });
  for (const value of [
    "http://192.168.50.1:11434",
    "https://127.0.0.1:11434",
    "http://127.0.0.1:11434/api/tags",
    "http://user:pass@127.0.0.1:11434",
    "http://localhost:8080",
    "file:///tmp/ollama",
  ]) assert.equal(validateOllamaEndpoint(value).valid, false, value);
  assert.equal(validateOllamaMessage({ type: "GET_OLLAMA_STATE", command: "cmd /c whoami" }), null);
  assert.equal(validateOllamaMessage({ type: "ADD_OLLAMA_PULL", model: "tiny:latest;whoami" }), null);
  assert.equal(validateOllamaMessage({ type: "CREATE_OLLAMA_CHAT", model: "tiny:latest", systemPrompt: "x", executable: "C:\\anything.exe" }), null);
  assert.equal(validateOllamaMessage({ type: "SEND_OLLAMA_CHAT", id: "chat_abcdefghijklmnop", prompt: "hello", options: { temperature: 9, numCtx: 4096 }, attachments: [] }), null);
  assert.deepEqual(validateOllamaMessage({ type: "SAVE_OLLAMA_CONFIG", config: { endpoint: DEFAULT_OLLAMA_ENDPOINT, pullParallelism: 1 } }), {
    type: "SAVE_OLLAMA_CONFIG",
    config: { endpoint: DEFAULT_OLLAMA_ENDPOINT, pullParallelism: 1 },
  });
});

test("local runtime refresh uses only documented loopback paths and records installed versus running state", async () => {
  const local = createLocal();
  const api = createLocalApi();
  const suite = createOllamaSuite({ local, fetchImpl: api.fetchImpl, idFactory, now: () => new Date("2026-08-12T20:00:00.000Z") });
  const refreshed = await suite.refresh();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.state.runtime.status, "healthy");
  assert.equal(refreshed.state.runtime.version, "0.9.1");
  assert.equal(refreshed.state.installed.length, 1);
  assert.equal(refreshed.state.installed[0].running, true);
  assert.equal(refreshed.state.catalog.complete, false);
  assert.equal(refreshed.state.catalog.pageCount, 0);
  assert.match(refreshed.state.catalog.reason, /browser extension/i);
  assert.deepEqual(api.requests.map((request) => request.path), ["/api/version", "/api/ps", "/api/tags"]);
  assert.ok(api.requests.every((request) => request.credentials === "omit" && request.redirect === "error"));
  assert.equal(local.values.has(OLLAMA_STATE_KEY), true);
});

test("hardware fit is evidence-backed and unknown when a browser cannot observe the required facts", () => {
  const model = { size: 100, parameterCount: 1_000_000_000, details: { parameterSize: "1B", quantizationLevel: "Q4" }, contextWindow: 2048 };
  assert.equal(computeHardwareFit(model, {}).verdict, "Unknown");
  assert.equal(computeHardwareFit(model, { ramBytes: 40, vramBytes: 10, freeDiskBytes: 90, driverSupported: false, contextOverheadBytes: 10 }).verdict, "Unlikely");
  assert.equal(computeHardwareFit(model, { ramBytes: 105, vramBytes: 55, freeDiskBytes: 110, driverSupported: true, contextOverheadBytes: 10 }).verdict, "Runs with limits");
  assert.equal(computeHardwareFit(model, { ramBytes: 500, vramBytes: 500, freeDiskBytes: 500, driverSupported: true, contextOverheadBytes: 10 }).verdict, "Runs well");
});

test("pull cart persists bounded partial progress, reports success only on a success event, and keeps payment semantics absent", async () => {
  const local = createLocal();
  const api = createLocalApi();
  const suite = createOllamaSuite({ local, fetchImpl: api.fetchImpl, idFactory, now: () => new Date("2026-08-12T20:00:00.000Z") });
  const queued = await suite.enqueuePull("tiny:latest");
  assert.equal(queued.ok, true);
  await suite.runPullQueue();
  const state = await suite.state();
  assert.equal(state.state.cart.length, 1);
  assert.equal(state.state.cart[0].status, "pulled");
  assert.equal(state.state.cart[0].completed, 100);
  const pullRequest = api.requests.find((request) => request.path === "/api/pull");
  assert.deepEqual(pullRequest.body, { model: "tiny:latest", stream: true });
  assert.doesNotMatch(JSON.stringify(state.state), /(?:price|payment|checkout|subscription|entitlement)/iu);
});

test("chat streams locally, requires verified image capability, and excludes attachment bytes from stored history and export", async () => {
  const local = createLocal();
  const api = createLocalApi();
  const suite = createOllamaSuite({ local, fetchImpl: api.fetchImpl, idFactory, now: () => new Date("2026-08-12T20:00:00.000Z") });
  await suite.refresh();
  const inspected = await suite.inspect("tiny:latest");
  assert.equal(inspected.ok, true);
  const created = await suite.createChat("tiny:latest", "GITHUB_TOKEN=local-secret Authorization: Bearer bearer-secret /private/path C:\\private");
  const png = "iVBORw0KGgo=";
  const sent = await suite.sendChat(created.session.id, "hello", { temperature: 0.7, numCtx: 4096 }, [{ mime: "image/png", data: png }]);
  assert.equal(sent.ok, true);
  const state = await suite.state();
  const session = state.state.sessions[0];
  assert.equal(session.messages.at(-1).content, "Hello local world.");
  assert.doesNotMatch(JSON.stringify(session), new RegExp(png));
  const exported = await suite.exportChat(session.id);
  assert.equal(exported.ok, true);
  assert.equal(exported.export.attachmentsOmitted, true);
  assert.match(JSON.stringify(exported.export), /\[redacted secret\]/u);
  assert.match(JSON.stringify(exported.export), /\[redacted local path\]/u);
  assert.match(JSON.stringify(exported.export), /\[redacted authorization\]/u);
  const chatRequest = api.requests.find((request) => request.path === "/api/chat");
  assert.deepEqual(chatRequest.body.messages.at(-1).images, [png]);
  await assert.rejects(
    () => suite.sendChat(created.session.id, "not an image", { temperature: 0.7, numCtx: 4096 }, [{ mime: "image/png", data: "SGVsbG8=" }]),
    { code: "ollama-chat-invalid" },
  );
});

test("negative regression guard fails when an asserted suite boundary or exact inventory anchor disappears", async () => {
  const source = await readFile(join(extensionRoot, "src/shared/ollama.js"), "utf8");
  const assertContract = (candidate) => {
    for (const anchor of [
      "export function validateOllamaEndpoint(",
      "export function validateOllamaMessage(",
      "export function computeHardwareFit(",
      "source: \"local-api-installed-tags-only\"",
      "complete: false",
      "launchable: false",
      "credentials: \"omit\"",
      "redirect: \"error\"",
    ]) assert.match(candidate, new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(candidate, /from\s+["']node:child_process["']/u);
    assert.doesNotMatch(candidate, /\.exec\s*\(/u);
  };
  assertContract(source);
  assert.throws(() => assertContract(source.replace("export function validateOllamaEndpoint(", "export function endpointRemoved(")));
  assert.throws(() => assertContract(source.replace("source: \"local-api-installed-tags-only\"", "source: \"curated\"")));
});

test("options surface exposes a real Ollama tab, independent regex builder, pull cart, local chat, and destructive confirmation", async () => {
  const options = await readFile(join(extensionRoot, "src/options.html"), "utf8");
  const script = await readFile(join(extensionRoot, "src/options.js"), "utf8");
  for (const id of [
    "tab-ollama", "panel-ollama", "ollama-endpoint", "ollama-model-search", "ollama-model-regex-toggle",
    "ollama-pull-tag", "ollama-add-pull", "ollama-cart-list", "ollama-chat-model", "ollama-chat-prompt",
    "ollama-attachment", "ollama-run-preflight", "ollama-delete-card", "ollama-delete-key-one", "ollama-delete-key-two", "ollama-delete-slider",
  ]) assert.match(options, new RegExp(`id="${id}"`));
  for (const exactHandler of ["GET_OLLAMA_STATE", "REFRESH_OLLAMA", "ADD_OLLAMA_PULL", "SEND_OLLAMA_CHAT", "GET_OLLAMA_HARNESS_BOUNDARY"]) assert.match(script, new RegExp(exactHandler));
  assert.match(options, /ollama-attachment[^>]+disabled/u);
  assert.match(script, /ollamaDeleteConfirm\.disabled/u);
});
