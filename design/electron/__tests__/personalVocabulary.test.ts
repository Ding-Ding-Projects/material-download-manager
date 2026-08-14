import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PERSONAL_VOCABULARY_MAX_BYTES,
  PERSONAL_VOCABULARY_MAX_ENTRIES,
  PERSONAL_VOCABULARY_MAX_KEY_LENGTH,
  PERSONAL_VOCABULARY_MAX_VALUE_LENGTH,
  applyPersonalVocabularyText,
  createPersonalVocabularyRuntime,
  isPersonalVocabularyRuntime,
  parsePersonalVocabularyPayload,
} from "../../shared/personalVocabulary";
import { createDefaultSettings } from "../../shared/settings";
import { HistoryStore } from "../history/HistoryStore";
import { DownloadManager } from "../download/DownloadManager";
import { PersonalVocabularyStore } from "../personalVocabulary/PersonalVocabularyStore";
import { StateStore, defaultQueues } from "../download/persistence";

const SOURCE_SENTINEL = "pv-test-source-sentinel";
const TARGET_SENTINEL = "pv-test-target-sentinel";
const SOURCE_FILE_SENTINEL = "pv-test-source-file-sentinel.json";

function payload(replacements: Record<string, string> = { [SOURCE_SENTINEL]: TARGET_SENTINEL }): string {
  return JSON.stringify({ schemaVersion: 1, replacements });
}

function assertNoPrivateVocabularyLeak(serialized: string): void {
  assert.doesNotMatch(serialized, new RegExp(SOURCE_SENTINEL, "u"));
  assert.doesNotMatch(serialized, new RegExp(TARGET_SENTINEL, "u"));
  assert.doesNotMatch(serialized, new RegExp(SOURCE_FILE_SENTINEL, "u"));
  assert.doesNotMatch(serialized, /personal-vocabulary-cache\.json/u);
}

async function withTemporaryUserData<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-personal-vocabulary-"));
  try {
    return await operation(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("personal vocabulary accepts only the versioned bounded generic payload", () => {
  assert.deepEqual(parsePersonalVocabularyPayload(payload()), [{ from: SOURCE_SENTINEL, to: TARGET_SENTINEL }]);
  assert.deepEqual(parsePersonalVocabularyPayload(payload({})), []);

  assert.throws(() => parsePersonalVocabularyPayload("{"), /personal vocabulary JSON/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":1,"schemaVersion":1,"replacements":{}}'), /duplicate/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":1,"replacements":{"x":"y","x":"z"}}'), /duplicate/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":2,"replacements":{}}'), /unsupported schema/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":1,"replacements":{},"extra":true}'), /unsupported fields/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":1,"replacements":{"__proto__":"x"}}'), /unsafe/i);
  assert.throws(() => parsePersonalVocabularyPayload('{"schemaVersion":1,"replacements":{"x":1}}'), /invalid replacement value/i);
  assert.throws(() => parsePersonalVocabularyPayload(payload({ ["x".repeat(PERSONAL_VOCABULARY_MAX_KEY_LENGTH + 1)]: "ok" })), /invalid replacement key/i);
  assert.throws(() => parsePersonalVocabularyPayload(payload({ x: "y".repeat(PERSONAL_VOCABULARY_MAX_VALUE_LENGTH + 1) })), /invalid replacement value/i);
  assert.throws(
    () => parsePersonalVocabularyPayload(payload(Object.fromEntries(
      Array.from({ length: PERSONAL_VOCABULARY_MAX_ENTRIES + 1 }, (_, index) => [`entry-${index}`, "ok"]),
    ))),
    /too many replacements/i,
  );
  assert.throws(
    () => parsePersonalVocabularyPayload('{"schemaVersion":1,"replacements":{"one":{"two":{"three":{"four":"five"}}}}}'),
    /maximum nesting depth/i,
  );
  assert.throws(
    () => parsePersonalVocabularyPayload(payload({ x: "y".repeat(PERSONAL_VOCABULARY_MAX_BYTES) })),
    /maximum file size|invalid replacement value/i,
  );
});

test("personal vocabulary replacement is literal, single-pass, bounded, and suppressed by School mode", () => {
  const runtime = createPersonalVocabularyRuntime("loaded", [
    { from: "source", to: "target" },
    { from: "source phrase", to: "long target" },
    { from: "target", to: "must not cascade" },
  ]);
  assert.equal(isPersonalVocabularyRuntime(runtime), true);
  assert.equal(applyPersonalVocabularyText("source phrase and source", runtime), "long target and target");
  assert.equal(applyPersonalVocabularyText("source phrase and source", runtime, { suppressed: true }), "source phrase and source");
  assert.equal(applyPersonalVocabularyText("source", createPersonalVocabularyRuntime("invalid")), "source");
  assert.equal(applyPersonalVocabularyText("source", { ...runtime, status: { ...runtime.status, entryCount: 99 } }), "source");
});

test("private cache survives reload, rejects invalid replacement without source metadata, and clear purges it", async () => {
  await withTemporaryUserData(async (root) => {
    const sourcePath = path.join(root, SOURCE_FILE_SENTINEL);
    const invalidSourcePath = path.join(root, "pv-test-invalid-source-file.json");
    await fsp.writeFile(sourcePath, payload(), "utf8");
    await fsp.writeFile(invalidSourcePath, '{"schemaVersion":1,"replacements":{"x":1}}', "utf8");

    const store = new PersonalVocabularyStore(root);
    await store.init();
    assert.deepEqual(await store.getRuntime(), createPersonalVocabularyRuntime());

    const loaded = await store.replaceFromFile(sourcePath);
    assert.equal(loaded.status.state, "loaded");
    assert.equal(loaded.status.entryCount, 1);
    assert.deepEqual(Object.keys(loaded.status).sort(), ["entryCount", "schemaVersion", "state"]);
    assert.equal(JSON.stringify(loaded).includes(SOURCE_FILE_SENTINEL), false, "IPC runtime never exposes the selected source file name");
    assert.equal(JSON.stringify(loaded).includes(sourcePath), false, "IPC runtime never exposes the selected source path");

    const cachePath = path.join(root, "personal-vocabulary-cache.json");
    const cacheText = await fsp.readFile(cachePath, "utf8");
    assert.match(cacheText, new RegExp(SOURCE_SENTINEL, "u"), "only the private local cache retains approved replacements");
    assert.equal(cacheText.includes(SOURCE_FILE_SENTINEL), false, "cache never retains selected source-file metadata");

    const invalid = await store.replaceFromFile(invalidSourcePath);
    assert.equal(invalid.status.state, "invalid");
    assert.deepEqual(invalid.replacements, loaded.replacements, "a rejected candidate cannot partially replace the prior valid cache");
    assert.equal(JSON.stringify(invalid).includes("pv-test-invalid-source-file.json"), false);

    const reloadedStore = new PersonalVocabularyStore(root);
    await reloadedStore.init();
    const reloaded = await reloadedStore.getRuntime();
    assert.equal(reloaded.status.state, "loaded");
    assert.deepEqual(reloaded.replacements, loaded.replacements);

    await reloadedStore.clear();
    await assert.rejects(fsp.stat(cachePath), /ENOENT/);
    assert.deepEqual(await reloadedStore.getRuntime(), createPersonalVocabularyRuntime());
  });
});

test("corrupt private cache fails closed before renderer load", async () => {
  await withTemporaryUserData(async (root) => {
    const cachePath = path.join(root, "personal-vocabulary-cache.json");
    await fsp.writeFile(cachePath, '{"schemaVersion":1,"replacements":{"x":1}}', "utf8");
    const store = new PersonalVocabularyStore(root);
    await store.init();
    const runtime = await store.getRuntime();
    assert.equal(runtime.status.state, "invalid");
    assert.deepEqual(runtime.replacements, []);
  });
});

test("negative no-leak boundary fails when a private cache payload is deliberately injected and stays green for settings, state, and history", async () => {
  const deliberatelyLeaked = JSON.stringify({
    settings: {},
    personalVocabulary: {
      sourceFileName: SOURCE_FILE_SENTINEL,
      replacements: [{ from: SOURCE_SENTINEL, to: TARGET_SENTINEL }],
    },
  });
  assert.throws(() => assertNoPrivateVocabularyLeak(deliberatelyLeaked), /pv-test-source-sentinel|pv-test-target-sentinel|pv-test-source-file-sentinel/i);

  await withTemporaryUserData(async (root) => {
    const vocabularySource = path.join(root, SOURCE_FILE_SENTINEL);
    await fsp.writeFile(vocabularySource, payload(), "utf8");
    const vocabularyStore = new PersonalVocabularyStore(root);
    await vocabularyStore.init();
    const vocabularyRuntime = await vocabularyStore.replaceFromFile(vocabularySource);
    assert.equal(vocabularyRuntime.status.state, "loaded", "the test must begin with a real private cache to prove ordinary APIs omit it");

    const settings = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
    const stateStore = new StateStore(root);
    await stateStore.save({ items: [], queues: defaultQueues(), settings, scheduleRules: [] });
    const persistedState = await fsp.readFile(path.join(root, "state.json"), "utf8");
    assertNoPrivateVocabularyLeak(persistedState);

    const history = new HistoryStore(root);
    await history.appendSnapshot(persistedState, "created", "Created generic app state");
    const historySnapshot = await history.readSnapshot();
    assert.notEqual(historySnapshot, null);
    assertNoPrivateVocabularyLeak(historySnapshot ?? "");

    const previousUserProfile = process.env.USERPROFILE;
    process.env.USERPROFILE = root;
    const manager = new DownloadManager(root);
    try {
      await manager.init();
      assertNoPrivateVocabularyLeak(JSON.stringify(manager.getState()));
      assertNoPrivateVocabularyLeak(JSON.stringify(manager.getSettings()));
      const exportedHistory = await manager.exportHistory("json");
      assertNoPrivateVocabularyLeak(exportedHistory.content);
      const managerHistory = await new HistoryStore(root).readSnapshot();
      assertNoPrivateVocabularyLeak(managerHistory ?? "");
    } finally {
      await manager.shutdown();
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }

    const sourceRoot = path.resolve(__dirname, "../../..");
    const [managerSource, vocabularyStoreSource, mainSource, rendererStoreSource] = await Promise.all([
      fsp.readFile(path.join(sourceRoot, "electron", "download", "DownloadManager.ts"), "utf8"),
      fsp.readFile(path.join(sourceRoot, "electron", "personalVocabulary", "PersonalVocabularyStore.ts"), "utf8"),
      fsp.readFile(path.join(sourceRoot, "electron", "main.ts"), "utf8"),
      fsp.readFile(path.join(sourceRoot, "src", "store", "useAppStore.ts"), "utf8"),
    ]);
    assert.doesNotMatch(managerSource, /personalVocabulary|personal-vocabulary/iu, "download state and its history snapshot have no vocabulary field");
    assert.doesNotMatch(vocabularyStoreSource, /\bfetch\s*\(|https?:\/\/|console\./iu, "the private store has no network or logging path");
    assert.doesNotMatch(mainSource, /console\.(?:log|warn|error)\([^\n]*personalVocabulary/iu, "main-process diagnostics cannot serialize a vocabulary runtime");
    assert.match(rendererStoreSource, /if \(s\.settings\.schoolModeEnabled\) \{\s+personalVocabularyGeneration \+= 1;\s+clearPersonalVocabularyRendererMemory\(\);/u, "School mode must clear the volatile renderer mapping rather than merely hiding its controls");
    assert.match(rendererStoreSource, /setPersonalVocabularyRuntime: \(runtime\) => \{\s+if \(get\(\)\.settings\?\.schoolModeEnabled\) \{\s+const empty = createPersonalVocabularyRuntime\(\);/u, "direct renderer updates must also fail closed while School mode is active");
  });
});
