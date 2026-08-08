import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings, SETTINGS_SCHEMA_VERSION } from "../../../shared/settings";
import { migrateSettings, StateStore } from "../persistence";

test("default settings are versioned and mark every value as compiled-in", () => {
  const settings = createDefaultSettings("C:/Downloads/MaterialDownloadManager");

  assert.equal(SETTINGS_SCHEMA_VERSION, 4);
  assert.equal(settings.settingsVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(settings.languageMode, "english");
  assert.equal(settings.funnyLevelEnglish, 1);
  assert.equal(settings.funnyLevelCantonese, 3);
  assert.equal(settings.density, "comfortable");
  assert.equal(settings.accentSeedColor, "#7c5cff");
  assert.equal(settings.uiFontFamily, "segoe-ui");
  assert.equal(settings.uiFontSize, 13);
  assert.equal(settings.uiFontWeight, 400);
  assert.equal(settings.autoOrganizeEnabled, true);
  assert.deepEqual(settings.autoOrganizeRules, []);
  assert.ok(Object.values(settings.settingProvenance).every((source) => source === "compiled-in"));
});

test("legacy settings migrate safely and preserve provenance per field", () => {
  const migrated = migrateSettings(
    {
      theme: "light",
      languageMode: "not-a-language",
      funnyLevelEnglish: 5,
      uiFontSize: 99,
      accentSeedColor: "#123456",
    },
    "C:/Downloads/MaterialDownloadManager"
  );

  assert.equal(migrated.settingsVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(migrated.theme, "light");
  assert.equal(migrated.languageMode, "english");
  assert.equal(migrated.funnyLevelEnglish, 5);
  assert.equal(migrated.uiFontSize, 13);
  assert.equal(migrated.accentSeedColor, "#123456");
  assert.equal(migrated.autoOrganizeEnabled, true);
  assert.deepEqual(migrated.autoOrganizeRules, []);
  assert.equal(migrated.settingProvenance.theme, "persisted");
  assert.equal(migrated.settingProvenance.languageMode, "compiled-in");
  assert.equal(migrated.settingProvenance.funnyLevelEnglish, "persisted");
  assert.equal(migrated.settingProvenance.uiFontSize, "compiled-in");
  assert.equal(migrated.settingProvenance.accentSeedColor, "persisted");
  assert.equal(migrated.settingProvenance.autoOrganizeEnabled, "compiled-in");
  assert.equal(migrated.settingProvenance.autoOrganizeRules, "compiled-in");
});

test("StateStore loads malformed settings without spreading invalid values", async () => {
  const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-settings-"));
  try {
    await fsp.writeFile(
      path.join(userDataPath, "state.json"),
      JSON.stringify({ settings: { density: "huge", funnyLevelCantonese: 0, uiFontWeight: 999 } })
    );

    const state = await new StateStore(userDataPath).load("C:/Downloads/MaterialDownloadManager");
    assert.equal(state.settings.density, "comfortable");
    assert.equal(state.settings.funnyLevelCantonese, 3);
    assert.equal(state.settings.uiFontWeight, 400);
    assert.equal(state.settings.settingsVersion, SETTINGS_SCHEMA_VERSION);
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});

test("settings round-trip keeps the new values and marks them persisted", async () => {
  const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-settings-roundtrip-"));
  try {
    const initial = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
    const settings = {
      ...initial,
      languageMode: "bilingual" as const,
      funnyLevelEnglish: 4 as const,
      density: "spacious" as const,
      accentSeedColor: "#112233" as const,
      uiFontSize: 16,
      autoOrganizeEnabled: false,
      autoOrganizeRules: [{
        id: "documents",
        name: "Document names",
        pattern: "\\.pdf$",
        flags: "i",
        category: "document" as const,
      }],
      settingProvenance: {
        ...initial.settingProvenance,
        languageMode: "persisted" as const,
        funnyLevelEnglish: "persisted" as const,
        density: "persisted" as const,
        accentSeedColor: "persisted" as const,
        uiFontSize: "persisted" as const,
        autoOrganizeEnabled: "persisted" as const,
        autoOrganizeRules: "persisted" as const,
      },
    };
    const store = new StateStore(userDataPath);
    await store.save({ items: [], queues: [], settings });
    const loaded = await store.load("C:/Downloads/MaterialDownloadManager");

    assert.equal(loaded.settings.languageMode, "bilingual");
    assert.equal(loaded.settings.funnyLevelEnglish, 4);
    assert.equal(loaded.settings.density, "spacious");
    assert.equal(loaded.settings.accentSeedColor, "#112233");
    assert.equal(loaded.settings.uiFontSize, 16);
    assert.equal(loaded.settings.autoOrganizeEnabled, false);
    assert.deepEqual(loaded.settings.autoOrganizeRules, settings.autoOrganizeRules);
    assert.equal(loaded.settings.settingProvenance.languageMode, "persisted");
    assert.equal(loaded.settings.settingProvenance.uiFontSize, "persisted");
    assert.equal(loaded.settings.settingProvenance.autoOrganizeEnabled, "persisted");
    assert.equal(loaded.settings.settingProvenance.autoOrganizeRules, "persisted");
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});

test("schema-v2 provenance remains truthful while new schema-v3 keys keep compiled defaults", () => {
  const defaults = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
  const migrated = migrateSettings(
    {
      ...defaults,
      settingsVersion: 2,
      theme: "light",
      languageMode: "bilingual",
      settingProvenance: {
        ...defaults.settingProvenance,
        theme: "compiled-in",
        languageMode: "persisted",
      },
    },
    "C:/Downloads/MaterialDownloadManager"
  );

  assert.equal(migrated.theme, defaults.theme, "a v2 compiled-in value must use the current compiled default");
  assert.equal(migrated.languageMode, "bilingual");
  assert.equal(migrated.settingProvenance.theme, "compiled-in");
  assert.equal(migrated.settingProvenance.languageMode, "persisted");
  assert.equal(migrated.settingProvenance.autoOrganizeEnabled, "compiled-in");
  assert.equal(migrated.settingProvenance.autoOrganizeRules, "compiled-in");
});

test("schema-v2 image rules migrate to General without losing order or provenance", () => {
  const migrated = migrateSettings(
    {
      settingsVersion: 2,
      autoOrganizeRules: [
        { id: "legacy-images", name: "Legacy images", pattern: "\\.(?:png|jpg)$", flags: "i", category: "image" },
        { id: "documents", name: "Documents", pattern: "\\.pdf$", flags: "i", category: "document" },
      ],
      settingProvenance: { autoOrganizeRules: "persisted" },
    },
    "C:/Downloads/MaterialDownloadManager"
  );

  assert.deepEqual(
    migrated.autoOrganizeRules.map((rule) => ({ id: rule.id, category: rule.category })),
    [
      { id: "legacy-images", category: "other" },
      { id: "documents", category: "document" },
    ]
  );
  assert.equal(migrated.settingProvenance.autoOrganizeRules, "persisted");
});

test("schema-v2 rules are canonicalized individually without erasing compatible neighbors", () => {
  const migrated = migrateSettings(
    {
      settingsVersion: 2,
      autoOrganizeRules: [
        { id: "blank-name", name: "", pattern: "blank", flags: "", category: "document" },
        { id: "__proto__", name: "Reserved", pattern: "reserved", flags: "", category: "apps" },
        { id: "duplicate", name: "First duplicate", pattern: "first", flags: "ui", category: "music" },
        { id: "duplicate", name: "Second duplicate", pattern: "second", flags: "", category: "video" },
        { id: "extra-key", name: "Extra key", pattern: "extra", flags: "i", category: "compressed", payload: "must be dropped" },
        { id: "x".repeat(65), name: "Long id", pattern: "long", flags: "", category: "other" },
        { id: "valid-neighbor", name: "Valid neighbor", pattern: "neighbor", flags: "", category: "document" },
      ],
      settingProvenance: { autoOrganizeRules: "persisted" },
    },
    "C:/Downloads/MaterialDownloadManager"
  );

  assert.deepEqual(
    migrated.autoOrganizeRules.map((rule) => ({ id: rule.id, name: rule.name, flags: rule.flags })),
    [
      { id: "blank-name", name: "Rule 1", flags: "" },
      { id: "legacy-rule-2", name: "Reserved", flags: "" },
      { id: "duplicate", name: "First duplicate", flags: "iu" },
      { id: "legacy-rule-4", name: "Second duplicate", flags: "" },
      { id: "extra-key", name: "Extra key", flags: "i" },
      { id: "legacy-rule-6", name: "Long id", flags: "" },
      { id: "valid-neighbor", name: "Valid neighbor", flags: "" },
    ]
  );
  assert.ok(migrated.autoOrganizeRules.every((rule) => Reflect.ownKeys(rule).sort().join("|") === "category|flags|id|name|pattern"));
  assert.equal(migrated.settingProvenance.autoOrganizeRules, "persisted");
});

test("untouched compiled-in provenance survives an exact StateStore round-trip", async () => {
  const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-settings-provenance-roundtrip-"));
  try {
    const initial = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
    const store = new StateStore(userDataPath);
    await store.save({ items: [], queues: [], settings: initial });

    const loaded = await store.load("C:/Downloads/MaterialDownloadManager");
    assert.deepEqual(loaded.settings.settingProvenance, initial.settingProvenance);
    assert.ok(Object.values(loaded.settings.settingProvenance).every((source) => source === "compiled-in"));
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});

test("migration rejects a stored relative default folder without changing its provenance", () => {
  const compiledInFolder = "C:/Downloads/MaterialDownloadManager";
  const migrated = migrateSettings(
    {
      defaultSaveFolder: "Downloads",
      settingProvenance: { defaultSaveFolder: "persisted" },
    },
    compiledInFolder
  );

  assert.equal(migrated.defaultSaveFolder, compiledInFolder);
  assert.equal(migrated.settingProvenance.defaultSaveFolder, "compiled-in");
});

test("StateStore serializes concurrent saves without corrupting the atomic file", async () => {
  const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-concurrent-saves-"));
  try {
    const stores = [new StateStore(userDataPath), new StateStore(userDataPath)];
    const initial = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
    const states = Array.from({ length: 32 }, (_, index) => ({
      items: [],
      queues: [],
      settings: { ...initial, defaultSaveFolder: `C:/Downloads/run-${index}` },
    }));

    await Promise.all(states.map((state, index) => stores[index % stores.length].save(state)));

    const saved = JSON.parse(await fsp.readFile(path.join(userDataPath, "state.json"), "utf8")) as {
      settings: { defaultSaveFolder: string };
    };
    assert.equal(saved.settings.defaultSaveFolder, "C:/Downloads/run-31");
    const temporaryFiles = (await fsp.readdir(userDataPath)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(temporaryFiles, []);
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});

test("StateStore removes a failed temporary write and recovers on the next save", async () => {
  const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-save-recovery-"));
  const statePath = path.join(userDataPath, "state.json");
  try {
    const store = new StateStore(userDataPath);
    const initial = createDefaultSettings("C:/Downloads/MaterialDownloadManager");
    await fsp.mkdir(statePath);

    await assert.rejects(
      store.save({ items: [], queues: [], settings: initial }),
      /EEXIST|EISDIR|EPERM|directory/i
    );
    assert.deepEqual(
      (await fsp.readdir(userDataPath)).filter((name) => name.endsWith(".tmp")),
      []
    );

    await fsp.rm(statePath, { recursive: true, force: true });
    await store.save({
      items: [],
      queues: [],
      settings: { ...initial, defaultSaveFolder: "C:/Downloads/recovered" },
    });
    const recovered = JSON.parse(await fsp.readFile(statePath, "utf8")) as {
      settings: { defaultSaveFolder: string };
    };
    assert.equal(recovered.settings.defaultSaveFolder, "C:/Downloads/recovered");
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});
