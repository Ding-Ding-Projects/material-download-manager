import test from "node:test";
import assert from "node:assert/strict";
import { validateSettingResetKeys, validateSettingsPatch } from "../../shared/settings";

const validRule = {
  id: "documents",
  name: "Document names",
  pattern: "\\.pdf$",
  flags: "i",
  category: "document",
} as const;

test("settings IPC validation rejects unknown and non-finite values", () => {
  assert.deepEqual(validateSettingsPatch({ maxActiveDownloads: 4, theme: "light" }), { maxActiveDownloads: 4, theme: "light" });
  assert.throws(() => validateSettingsPatch({ unknownSetting: true }), /Invalid setting key/);
  assert.throws(() => validateSettingsPatch({ maxActiveDownloads: Number.NaN }), /Invalid value for setting/);
  assert.throws(() => validateSettingsPatch({ uiFontSize: 200 }), /Invalid value for setting/);
  assert.throws(() => validateSettingsPatch({ settingsVersion: 3 }), /Invalid setting key/);
  assert.throws(() => validateSettingsPatch({ settingProvenance: {} }), /Invalid setting key/);
});

test("setting reset keys are bounded, unique, and allowlisted", () => {
  assert.deepEqual(validateSettingResetKeys(["theme", "autoOrganizeRules"]), ["theme", "autoOrganizeRules"]);
  assert.throws(() => validateSettingResetKeys("theme"), /Invalid setting reset keys/);
  assert.throws(() => validateSettingResetKeys(["theme", "theme"]), /Invalid setting reset keys/);
  assert.throws(() => validateSettingResetKeys(["settingProvenance"]), /Invalid setting reset keys/);
  assert.throws(() => validateSettingResetKeys(["unknown"]), /Invalid setting reset keys/);
});

test("settings validation accepts bounded auto-organize rules and rejects ambiguous state", () => {
  assert.deepEqual(validateSettingsPatch({ autoOrganizeEnabled: false, autoOrganizeRules: [validRule] }), {
    autoOrganizeEnabled: false,
    autoOrganizeRules: [validRule],
  });
  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [validRule, { ...validRule }] }),
    /Invalid value for setting: autoOrganizeRules/
  );
  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [{ ...validRule, id: "image", category: "image" }] }),
    /Invalid value for setting: autoOrganizeRules/
  );
  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [{ ...validRule, name: "   " }] }),
    /Invalid value for setting: autoOrganizeRules/
  );
  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [{ ...validRule, flags: "ui" }] }),
    /Invalid value for setting: autoOrganizeRules/
  );
});

test("settings validation accepts only absolute Windows default folders", () => {
  for (const invalidFolder of ["", " ", "Downloads", ".\\Downloads", "C:Downloads", "/tmp/Downloads", "C:\\Downloads "]) {
    assert.throws(
      () => validateSettingsPatch({ defaultSaveFolder: invalidFolder }),
      /Invalid value for setting: defaultSaveFolder/
    );
  }

  assert.deepEqual(validateSettingsPatch({ defaultSaveFolder: "C:\\Downloads" }), {
    defaultSaveFolder: "C:\\Downloads",
  });
  assert.deepEqual(validateSettingsPatch({ defaultSaveFolder: "\\\\server\\share\\Downloads" }), {
    defaultSaveFolder: "\\\\server\\share\\Downloads",
  });
});

test("auto-organize rules reject reserved and unknown keys and return canonical clones", () => {
  for (const reservedId of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.throws(
      () => validateSettingsPatch({ autoOrganizeRules: [{ ...validRule, id: reservedId }] }),
      /Invalid value for setting: autoOrganizeRules/
    );
  }

  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [{ ...validRule, unknown: true }] }),
    /Invalid value for setting: autoOrganizeRules/
  );

  const cyclicRule: Record<string, unknown> = { ...validRule, id: "cyclic-rule" };
  cyclicRule.self = cyclicRule;
  assert.throws(
    () => validateSettingsPatch({ autoOrganizeRules: [cyclicRule] }),
    /Invalid value for setting: autoOrganizeRules/
  );

  const sourceRule = {
    id: "canonical-rule",
    name: "Canonical rule",
    pattern: "\\.pdf$",
    flags: "i",
    category: "document" as const,
  };
  const patch = validateSettingsPatch({ autoOrganizeRules: [sourceRule] });
  const clonedRule = patch.autoOrganizeRules?.[0];
  assert.ok(clonedRule);
  assert.notStrictEqual(clonedRule, sourceRule);
  assert.deepEqual(clonedRule, sourceRule);
  assert.deepEqual(Reflect.ownKeys(clonedRule), ["id", "name", "pattern", "flags", "category"]);

  sourceRule.pattern = "changed-after-validation";
  assert.equal(clonedRule.pattern, "\\.pdf$");
});
