import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface ContractSources {
  shared: string;
  store: string;
  panel: string;
  documentation: string;
}

function requireExact(source: string, boundary: string, label: string): void {
  if (!source.includes(boundary)) throw new Error(`Ollama contract missing ${label}`);
}

/**
 * A hand-written fail-closed inventory.  It does not discover existing
 * features; each required boundary is named here so deleting it turns red.
 */
function assertOllamaSuiteContract(sources: ContractSources): void {
  requireExact(sources.shared, 'OLLAMA_CATALOG_POLICY_REASON', "local-only catalog policy");
  requireExact(sources.shared, 'return { availability: "unavailable-by-policy", checkedAt: null', "fail-closed catalog state");
  requireExact(sources.shared, 'OllamaFitVerdict', "conservative fit verdict schema");
  requireExact(sources.shared, 'OllamaPullBatch', "durable bounded pull schema");
  requireExact(sources.shared, 'OllamaChatAttachment', "capability-gated local attachment schema");
  requireExact(sources.shared, 'OllamaHarnessSnapshot', "harness rollback snapshot schema");
  for (const route of ["/api/version", "/api/tags", "/api/ps", "/api/show", "/api/pull", "/api/delete", "/api/copy", "/api/generate", "/api/chat"]) {
    requireExact(sources.store, `"${route}"`, `documented local API route ${route}`);
  }
  requireExact(sources.store, 'this.request(provider, "/api/chat", "POST"', "documented local chat request");
  requireExact(sources.store, "shell: false", "shell-free harness launch");
  requireExact(sources.store, "restoreHarnessSnapshot(snapshot.id, true", "automatic failed-launch rollback");
  requireExact(sources.store, "refreshCatalogCapability", "explicit catalog boundary refresh");
  requireExact(sources.panel, "Local Model Store", "guided Model Store surface");
  requireExact(sources.panel, 'id="ollama-known-tags"', "guided local tag picker");
  requireExact(sources.panel, "RegexBuilder", "anchored Model Store regex builder");
  requireExact(sources.panel, "Disabled until Refresh details verifies vision capability", "capability-gated attachment disclosure");
  requireExact(sources.panel, "Restore snapshot", "visible harness restore action");
  requireExact(sources.documentation, "## Official catalog boundary", "documented catalog conflict");
  requireExact(sources.documentation, "negative regression", "documented negative Chut");
  if (/https:\/\/ollama\.com\/api/iu.test(sources.store) || /Authorization\s*:/u.test(sources.store)) {
    throw new Error("Ollama contract permits a remote or credentialed catalog route");
  }
}

test("Ollama completeness inventory fails closed when each protected boundary is removed", async () => {
  const designRoot = path.resolve(__dirname, "../../..");
  const repositoryRoot = path.resolve(designRoot, "..");
  const sources: ContractSources = {
    shared: await fsp.readFile(path.join(designRoot, "shared", "ollama.ts"), "utf8"),
    store: await fsp.readFile(path.join(designRoot, "electron", "ollama", "OllamaSuiteStore.ts"), "utf8"),
    panel: await fsp.readFile(path.join(designRoot, "src", "components", "OllamaSuitePanel.tsx"), "utf8"),
    documentation: await fsp.readFile(path.join(repositoryRoot, "docs", "features", "product", "ollama-suite-manager.md"), "utf8"),
  };
  assert.doesNotThrow(() => assertOllamaSuiteContract(sources));
  assert.throws(() => assertOllamaSuiteContract({ ...sources, store: sources.store.replace('this.request(provider, "/api/chat", "POST"', 'this.request(provider, "/api/chat-removed", "POST"') }), /local chat request/u);
  assert.throws(() => assertOllamaSuiteContract({ ...sources, store: sources.store.replace("shell: false", "shell: true") }), /shell-free/u);
  assert.throws(() => assertOllamaSuiteContract({ ...sources, shared: sources.shared.replace('return { availability: "unavailable-by-policy", checkedAt: null', 'return { availability: "available", checkedAt: null') }), /catalog state/u);
  assert.throws(() => assertOllamaSuiteContract({ ...sources, panel: sources.panel.replace('id="ollama-known-tags"', 'id="removed-known-tags"') }), /tag picker/u);
  assert.throws(() => assertOllamaSuiteContract({ ...sources, documentation: sources.documentation.replace("## Official catalog boundary", "## Catalog note") }), /catalog conflict/u);
  assert.throws(() => assertOllamaSuiteContract({ ...sources, documentation: sources.documentation.replace("negative regression", "regression note") }), /negative Chut/u);
});
