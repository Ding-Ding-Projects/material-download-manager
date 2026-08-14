import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateOllamaFit,
  createEmptyOllamaSuiteState,
  createOllamaMetadataExport,
  normalizeOllamaEndpoint,
  normalizeOllamaSuiteState,
  parseOllamaMetadataExport,
  parseOllamaPsPayload,
  parseOllamaShowPayload,
  parseOllamaTagsPayload,
  parseOllamaVersionPayload,
} from "../../shared/ollama";
import { OllamaSuiteStore } from "../ollama/OllamaSuiteStore";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function ndjson(values: unknown[]): Response {
  return new Response(`${values.map((value) => JSON.stringify(value)).join("\n")}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

async function waitFor(assertion: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("Ollama endpoint validation remains loopback-only and credential-free", () => {
  assert.equal(normalizeOllamaEndpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaEndpoint("http://localhost:11434"), "http://localhost:11434");
  assert.throws(() => normalizeOllamaEndpoint("https://ollama.example.test"), /loopback/u);
  assert.throws(() => normalizeOllamaEndpoint("http://127.0.0.1:11434/api"), /path/u);
  assert.throws(() => normalizeOllamaEndpoint("http://user:secret@127.0.0.1:11434"), /credential-free/u);
  assert.throws(() => normalizeOllamaEndpoint("http://127.0.0.1:11434?x=1"), /query/u);
});

test("documented local API parsers preserve tags, running models, details, and evidence", () => {
  const tags = parseOllamaTagsPayload({ models: [{ name: "tinyllama:latest", digest: "sha256:test", size: 2_048, details: { family: "llama", parameter_size: "1.1B", quantization_level: "Q4_K_M" } }] }, "provider-1", "2026-08-12T00:00:00.000Z");
  const running = parseOllamaPsPayload({ models: [{ name: "tinyllama:latest", digest: "sha256:test", size: 2_048, size_vram: 1_024, context_length: 4096 }] }, "provider-1", "2026-08-12T00:00:00.000Z");
  const details = parseOllamaShowPayload({ capabilities: ["completion", "vision"], parameters: "temperature 0.7", details: { family: "llama", quantization_level: "Q4_K_M" }, model_info: { "llama.context_length": 4096 } }, "provider-1", "tinyllama:latest", "2026-08-12T00:00:00.000Z");
  assert.equal(parseOllamaVersionPayload({ version: "0.12.6" }), "0.12.6");
  assert.equal(tags[0].details.parameterSize, "1.1B");
  assert.equal(running[0].sizeVramBytes, 1_024);
  assert.deepEqual(details.capabilities, ["completion", "vision"]);
  assert.equal(details.contextLength, 4096);
  const fit = calculateOllamaFit(tags[0], details, { checkedAt: "2026-08-12T00:00:00.000Z", totalRamBytes: 64 * 1024 ** 3, freeRamBytes: 32 * 1024 ** 3, freeDiskBytes: 64 * 1024 ** 3, architecture: "win32-x64", gpu: { name: "Test GPU", vramBytes: 24 * 1024 ** 3, driver: "1.0", backend: "detected" }, diagnostic: null });
  assert.equal(fit.verdict, "runs-well");
  assert.equal(fit.contextLength, 4096);
});

test("complete local Ollama service uses documented local routes, streams pulls/chats, and keeps the catalog boundary fail-closed", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ollama-suite-"));
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: URL | string | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/api/version")) return json({ version: "0.12.6" });
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "tinyllama:latest", digest: "sha256:test", size: 2_048, details: { family: "llama", parameter_size: "1.1B", quantization_level: "Q4_K_M" } }] });
    if (url.endsWith("/api/ps")) return json({ models: [] });
    if (url.endsWith("/api/show")) return json({ capabilities: ["completion", "vision"], parameters: "temperature 0.7", details: { family: "llama", quantization_level: "Q4_K_M" }, model_info: { "llama.context_length": 4096 } });
    if (url.endsWith("/api/pull")) return ndjson([{ status: "pulling manifest", total: 100, completed: 20 }, { status: "success", total: 100, completed: 100, done: true }]);
    if (url.endsWith("/api/chat")) return ndjson([{ message: { role: "assistant", content: "Local " } }, { message: { role: "assistant", content: "streamed " } }, { message: { role: "assistant", content: "answer" }, done: true }]);
    if (url.endsWith("/api/delete") || url.endsWith("/api/copy")) return json({});
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;
  try {
    const store = new OllamaSuiteStore(root);
    await store.init();
    const providerState = await store.addProvider({ name: "Local", endpoint: "http://127.0.0.1:11434" });
    const providerId = providerState.providers[0].id;
    const refreshed = await store.refreshProvider(providerId);
    assert.equal(refreshed.providers[0].probe.state, "healthy");
    assert.equal(refreshed.providers[0].probe.runtimeVersion, "0.12.6");
    assert.equal(refreshed.installedModels.length, 1);
    assert.equal(refreshed.runningModels.length, 0);
    const detailed = await store.refreshModelDetails(providerId, "tinyllama:latest");
    assert.equal(detailed.modelDetails[0].capabilities.includes("vision"), true);

    const beforeCatalogCheck = requested.length;
    const catalog = await store.refreshCatalogCapability();
    assert.equal(catalog.catalog.availability, "unavailable-by-policy");
    assert.equal(catalog.catalog.complete, false);
    assert.equal(requested.length, beforeCatalogCheck, "catalog capability check must not invent a network route");

    await store.startPullBatch({ providerId, models: ["tinyllama:latest"], parallelism: 2 });
    await waitFor(() => store.getState().pullBatches[0]?.state === "completed", "bounded local pull batch completion");
    assert.equal(store.getState().pullBatches[0].items[0].state, "pulled");

    const chatState = await store.createChatSession({ providerId, model: "tinyllama:latest", name: "Local test", systemPrompt: "", temperature: 0.7, numCtx: 4096, keepAlive: "5m" });
    const chatId = chatState.chats[0].id;
    await store.sendChat({ sessionId: chatId, content: "Hello", attachments: [{ name: "image.png", mimeType: "image/png", dataBase64: "aGVsbG8=" }] });
    await waitFor(() => store.getState().chats[0]?.state === "ready", "local chat stream completion");
    const messages = store.getState().chats[0].messages;
    assert.equal(messages[messages.length - 1]?.content, "Local streamed answer", "rapid stream chunks are buffered rather than dropped between durable progress updates");
    const exportResult = store.exportChat(chatId, "json");
    assert.match(exportResult.content, /attachments/u);
    assert.equal(exportResult.content.includes("aGVsbG8="), false, "ordinary exports omit attachment bytes");

    const metadata = store.metadataEnvelope();
    assert.deepEqual(metadata.omissions, ["credentials", "chat-history", "attachments", "harness-snapshots", "official-catalog"]);
    assert.equal(JSON.stringify(metadata).includes("aGVsbG8="), false);
    assert.deepEqual(parseOllamaMetadataExport(metadata).chats, []);
    assert.equal(requested.some((url) => /^https:\/\//u.test(url)), false, "only the saved loopback provider may be contacted");
    assert.equal(requested.some((url) => url.includes("/api/version")), true);
    assert.equal(requested.some((url) => url.includes("/api/ps")), true);
    assert.equal(requested.some((url) => url.includes("/api/show")), true);
    assert.equal(requested.some((url) => url.includes("/api/pull")), true);
    assert.equal(requested.some((url) => url.includes("/api/chat")), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("metadata migration and imports refuse a remotely claimed official catalog", () => {
  const legacy = { schemaVersion: 1, providers: [], installedModels: [], updatedAt: null };
  assert.equal(normalizeOllamaSuiteState(legacy).schemaVersion, 2);
  const metadata = createOllamaMetadataExport(createEmptyOllamaSuiteState());
  assert.throws(() => parseOllamaMetadataExport({ ...metadata, state: { ...metadata.state, catalog: { availability: "available", complete: true } } }), /catalog/u);
});
