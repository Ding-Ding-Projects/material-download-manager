import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings, SETTINGS_SCHEMA_VERSION } from "../../../shared/settings";
import { migrateSettings, StateStore } from "../persistence";

test("default settings are versioned and mark every value as compiled-in", () => {
  const settings = createDefaultSettings("C:/Downloads/MaterialDownloadManager");

  assert.equal(settings.settingsVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(settings.languageMode, "english");
  assert.equal(settings.funnyLevelEnglish, 1);
  assert.equal(settings.funnyLevelCantonese, 3);
  assert.equal(settings.density, "comfortable");
  assert.equal(settings.accentSeedColor, "#7c5cff");
  assert.equal(settings.uiFontFamily, "segoe-ui");
  assert.equal(settings.uiFontSize, 13);
  assert.equal(settings.uiFontWeight, 400);
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
  assert.equal(migrated.settingProvenance.theme, "persisted");
  assert.equal(migrated.settingProvenance.languageMode, "compiled-in");
  assert.equal(migrated.settingProvenance.funnyLevelEnglish, "persisted");
  assert.equal(migrated.settingProvenance.uiFontSize, "compiled-in");
  assert.equal(migrated.settingProvenance.accentSeedColor, "persisted");
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
      settingProvenance: {
        ...initial.settingProvenance,
        languageMode: "persisted" as const,
        funnyLevelEnglish: "persisted" as const,
        density: "persisted" as const,
        accentSeedColor: "persisted" as const,
        uiFontSize: "persisted" as const,
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
    assert.equal(loaded.settings.settingProvenance.languageMode, "persisted");
    assert.equal(loaded.settings.settingProvenance.uiFontSize, "persisted");
  } finally {
    await fsp.rm(userDataPath, { recursive: true, force: true });
  }
});
