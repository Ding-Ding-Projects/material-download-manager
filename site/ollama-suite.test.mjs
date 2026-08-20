import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const contractSource = await readFile(path.join(siteRoot, "data", "ollama-suite-contract.js"), "utf8");
const moduleSource = await readFile(path.join(siteRoot, "ollama-suite.js"), "utf8");
const context = { globalThis: {}, window: {}, URL };
vm.runInNewContext(contractSource, context, { filename: "ollama-suite-contract.js" });
const contract = context.window.OLLAMA_SUITE_CONTRACT;
const checks = [];

function run(label, assertion) {
  assertion();
  checks.push(label);
}

const catalog = {
  schemaVersion: 1,
  kind: "official-catalog-snapshot",
  sourceRevision: "catalog-revision-2026-08-12",
  refreshedAt: "2026-08-12T20:00:00.000Z",
  pageCount: 3,
  complete: true,
  models: [{
    tag: "example/model:latest",
    family: "example",
    description: "A verified local catalog fixture model.",
    sizeBytes: 1073741824,
    parameterCount: "1B",
    quantization: "Q4_K_M",
    capabilities: ["completion"]
  }]
};

const installed = {
  name: "example/model:latest",
  model: "example/model:latest",
  modified_at: "2026-08-12T20:00:00.000Z",
  size: 1073741824,
  digest: "a".repeat(64),
  details: { format: "gguf", family: "example", families: ["example"], parameter_size: "1B", quantization_level: "Q4_K_M" }
};

run("only the documented loopback endpoint is accepted", () => {
  for (const endpoint of ["http://127.0.0.1:11434", "http://localhost:11434/", "http://[::1]:11434"]) assert.equal(contract.isAllowedEndpoint(endpoint), true, endpoint);
  for (const endpoint of ["https://127.0.0.1:11434", "http://localhost:11435", "http://example.com:11434", "http://127.0.0.1:11434/api/tags", "http://user:pass@127.0.0.1:11434", "http://127.0.0.1:11434/?next=x"]) assert.equal(contract.isAllowedEndpoint(endpoint), false, endpoint);
});

run("installed and running responses reject malformed or duplicate local tags", () => {
  assert.equal(contract.normalizeTagsResponse({ models: [installed] })?.[0].name, installed.name);
  assert.equal(contract.normalizeRunningResponse({ models: [{ ...installed, size_vram: installed.size, context_length: 4096 }] })?.[0].size_vram, installed.size);
  assert.equal(contract.normalizeTagsResponse({ models: [installed, installed] }), null);
  assert.equal(contract.normalizeTagsResponse({ models: [{ ...installed, name: "../../unsafe" }] }), null);
  assert.equal(contract.normalizeTagsResponse({ models: [{ ...installed, extra: true }] }), null);
});

run("catalog snapshots fail closed until complete and bounded", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(contract.normalizeCatalogSnapshot(catalog))), catalog);
  const incomplete = structuredClone(catalog);
  incomplete.complete = false;
  assert.equal(contract.normalizeCatalogSnapshot(incomplete), null);
  const duplicate = structuredClone(catalog);
  duplicate.models.push(structuredClone(duplicate.models[0]));
  assert.equal(contract.normalizeCatalogSnapshot(duplicate), null);
  const unsafe = structuredClone(catalog);
  unsafe.models[0].tag = "https://remote.example/model";
  assert.equal(contract.normalizeCatalogSnapshot(unsafe), null);
});

run("catalog parser rejects duplicate JSON keys before application", () => {
  const valid = JSON.stringify(catalog);
  assert.equal(contract.parseCatalogSnapshot(valid).models.length, 1);
  const duplicateTopLevel = valid.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.throws(() => contract.parseCatalogSnapshot(duplicateTopLevel), /Duplicate JSON key/);
  const duplicateNested = valid.replace('"tag":"example/model:latest"', '"tag":"example/model:latest","tag":"different"');
  assert.throws(() => contract.parseCatalogSnapshot(duplicateNested), /Duplicate JSON key/);
});

run("local state preserves bounded cart, chats, profiles, cache, and history without unknown fields", () => {
  const state = {
    schemaVersion: 1,
    endpoint: "http://127.0.0.1:11434",
    runtime: { version: "0.12.0", refreshedAt: "2026-08-12T20:00:00.000Z", installed: [installed], running: [] },
    catalog,
    cart: [{ tag: installed.name, status: "queued", detail: "Waiting for a local pull.", updatedAt: "2026-08-12T20:00:00.000Z" }],
    chats: [{ id: "chat-1", title: "Local session", model: installed.name, systemPrompt: "", temperature: 0.7, contextLength: 4096, messages: [], updatedAt: "2026-08-12T20:00:00.000Z" }],
    profiles: [{ id: "profile-1", label: "Local health", kind: "health" }],
    history: [{ id: "event-1", action: "runtime-refreshed", detail: "Local state refreshed.", createdAt: "2026-08-12T20:00:00.000Z" }]
  };
  assert.equal(contract.normalizeLocalState(state)?.cart[0].status, "queued");
  const unexpected = structuredClone(state);
  unexpected.secret = "must not persist";
  assert.equal(contract.normalizeLocalState(unexpected), null);
  const shellProfile = structuredClone(state);
  shellProfile.profiles[0].kind = "shell";
  assert.equal(contract.normalizeLocalState(shellProfile), null);
});

run("fit verdicts are evidence-backed and expose every conservative state", () => {
  const model = { tag: installed.name, sizeBytes: installed.size };
  assert.equal(contract.estimateFit(model, [{ ...installed, size_vram: installed.size, context_length: 4096 }], {}).verdict, "Runs well");
  assert.equal(contract.estimateFit(model, [], { deviceMemoryGiB: 8, quotaBytes: 20 * 1024 ** 3, usageBytes: 0 }).verdict, "Runs with limits");
  assert.equal(contract.estimateFit({ ...model, sizeBytes: 20 * 1024 ** 3 }, [], { deviceMemoryGiB: 8 }).verdict, "Unlikely");
  assert.equal(contract.estimateFit(model, [], {}).verdict, "Unknown");
});

run("redaction removes common credentials and local paths from persisted/exportable text", () => {
  const redacted = contract.redactText("Bearer abcdefghijklmnopqrstuvwxyz C:\\Users\\person\\secret.txt sk_abcdefghijklmnop");
  assert.doesNotMatch(redacted, /abcdefghijklmnopqrstuvwxyz|Users\\person|sk_abcdefghijklmnop/);
  assert.match(redacted, /redacted/);
});

run("browser module carries only allowlisted local API routes and no process launcher", () => {
  for (const route of ["/api/version", "/api/tags", "/api/ps", "/api/show", "/api/pull", "/api/delete", "/api/copy", "/api/chat"]) assert.match(moduleSource, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(moduleSource, /if \(!allowed\.has\(path\)\) throw new Error\("The browser-only suite rejected an unregistered local API route\."\)/);
  assert.doesNotMatch(moduleSource, /\b(?:child_process|execFile|spawn|PowerShell|cmd\.exe)\b/);
  assert.match(moduleSource, /Attachments remain disabled/);
  assert.match(moduleSource, /static Pages site cannot start Ollama/);
  assert.match(moduleSource, /const timeoutMs = options\.timeout === 0 \? null : \(options\.timeout \?\? RUNTIME_TIMEOUT_MS\);/);
  assert.match(moduleSource, /const timeout = timeoutMs === null \? null : window\.setTimeout\(\(\) => controller\.abort\(\), timeoutMs\);/);
  assert.match(moduleSource, /if \(timeout !== null\) window\.clearTimeout\(timeout\);/);
  assert.match(moduleSource, /window\.MDM_SITE_USER_TEXT\?\.render/);
  assert.match(moduleSource, /mdm-site-user-text-change/);
  assert.doesNotMatch(moduleSource, /PERSONAL_VOCABULARY\.json|personalVocabularyCache|vocabularyMappings/);
});

run("negative regression fixtures actually remove key safeguards", () => {
  const withoutRouteAllowlist = moduleSource.replace('if (!allowed.has(path)) throw new Error("The browser-only suite rejected an unregistered local API route.");', "");
  assert.notEqual(withoutRouteAllowlist, moduleSource);
  assert.doesNotMatch(withoutRouteAllowlist, /browser-only suite rejected an unregistered local API route/);
  const withoutAttachmentGate = moduleSource.replace("attachmentInput.disabled = !attachmentAllowed(chat);", "attachmentInput.disabled = false;");
  assert.notEqual(withoutAttachmentGate, moduleSource);
  assert.doesNotMatch(withoutAttachmentGate, /attachmentInput\.disabled = !attachmentAllowed\(chat\);/);
  const withoutCatalogComplete = contractSource.replace('value.complete !== true', 'value.complete !== false');
  assert.notEqual(withoutCatalogComplete, contractSource);
  assert.match(withoutCatalogComplete, /value\.complete !== false/);
  const withoutStreamTimeoutOptOut = moduleSource.replace('const timeoutMs = options.timeout === 0 ? null : (options.timeout ?? RUNTIME_TIMEOUT_MS);', 'const timeoutMs = options.timeout ?? RUNTIME_TIMEOUT_MS;');
  assert.notEqual(withoutStreamTimeoutOptOut, moduleSource);
  assert.doesNotMatch(withoutStreamTimeoutOptOut, /options\.timeout === 0 \? null/);
  const withoutUserTextHook = moduleSource.replace('const renderer = window.MDM_SITE_USER_TEXT?.render;', 'const renderer = null;');
  assert.notEqual(withoutUserTextHook, moduleSource);
  assert.doesNotMatch(withoutUserTextHook, /MDM_SITE_USER_TEXT\?\.render/);
});

console.log(`OLLAMA SUITE TEST RESULT: PASS (${checks.length} checks)`);
