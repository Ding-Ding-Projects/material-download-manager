import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createOllamaMetadataExport,
  createEmptyOllamaSuiteState,
  normalizeOllamaEndpoint,
  parseOllamaMetadataExport,
  parseOllamaTagsPayload,
} from "../../shared/ollama";
import { OllamaSuiteStore } from "../ollama/OllamaSuiteStore";

test("Ollama endpoint validation stays loopback-only and credential-free", () => {
  assert.equal(normalizeOllamaEndpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaEndpoint("http://localhost:11434"), "http://localhost:11434");
  assert.throws(() => normalizeOllamaEndpoint("https://ollama.example.test"), /loopback/u);
  assert.throws(() => normalizeOllamaEndpoint("http://127.0.0.1:11434/api"), /path/u);
  assert.throws(() => normalizeOllamaEndpoint("http://user:secret@127.0.0.1:11434"), /credential-free/u);
  assert.throws(() => normalizeOllamaEndpoint("http://@127.0.0.1:11434"), /credentials/u);
  assert.throws(() => normalizeOllamaEndpoint("http://127.0.0.1:11434?"), /query/u);
  assert.throws(() => normalizeOllamaEndpoint("http://127.0.0.1:11434#"), /query/u);
});

test("Ollama tags parser preserves verified local metadata and bounds payloads", () => {
  const models = parseOllamaTagsPayload({ models: [{ name: "llama3.2:latest", digest: "sha256:abc", size: 1234, details: { family: "llama", parameter_size: "3B", quantization_level: "Q4_K_M" } }] }, "provider-1", "2026-08-12T00:00:00.000Z");
  assert.equal(models.length, 1);
  assert.deepEqual({ ...models[0], id: undefined }, {
    id: undefined,
    providerId: "provider-1",
    name: "llama3.2:latest",
    digest: "sha256:abc",
    sizeBytes: 1234,
    modifiedAt: null,
    details: { format: null, family: "llama", parameterSize: "3B", quantizationLevel: "Q4_K_M" },
    observedAt: "2026-08-12T00:00:00.000Z",
    source: "ollama-local-api",
  });
  assert.match(models[0].id, /^ollama-model-provider-1-/u);
  assert.throws(() => parseOllamaTagsPayload({ models: [{ name: "" }] }, "provider-1"), /no valid name/u);
});

test("Ollama suite store refreshes only the local API and exports metadata without credentials", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-ollama-suite-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string | Request) => {
    assert.equal(String(input), "http://127.0.0.1:11434/api/tags");
    return new Response(JSON.stringify({ models: [{ name: "tinyllama:latest", digest: "sha256:test", size: 2_048 }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const store = new OllamaSuiteStore(root);
    await store.init();
    const added = await store.addProvider({ name: "Local", endpoint: "http://127.0.0.1:11434" });
    const refreshed = await store.refreshProvider(added.providers[0].id);
    assert.equal(refreshed.completeInstalledInventory, true);
    assert.equal(refreshed.modelCount, 1);
    const exported = store.metadataEnvelope();
    assert.deepEqual(exported.omissions, ["credentials", "cloud-catalog", "chat-history"]);
    assert.equal(JSON.stringify(exported).includes("secret"), false);
    assert.deepEqual(parseOllamaMetadataExport(exported).installedModels[0].name, "tinyllama:latest");
    const onDisk = JSON.parse(await fsp.readFile(path.join(root, "ollama-suite.json"), "utf8")) as Record<string, unknown>;
    assert.equal(JSON.stringify(onDisk).includes("apiKey"), false);
    await store.removeProvider(added.providers[0].id);
    assert.equal(store.getState().providers.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("Ollama metadata export rejects malformed or credential-bearing envelopes", () => {
  const state = createEmptyOllamaSuiteState();
  const valid = createOllamaMetadataExport(state);
  assert.deepEqual(parseOllamaMetadataExport(valid), state);
  assert.throws(() => parseOllamaMetadataExport({ ...valid, omissions: ["cloud-catalog"] }), /supported Ollama metadata/u);
});
