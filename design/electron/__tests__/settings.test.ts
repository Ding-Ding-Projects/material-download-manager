import test from "node:test";
import assert from "node:assert/strict";
import { validateSettingsPatch } from "../../shared/settings";

test("settings IPC validation rejects unknown and non-finite values", () => {
  assert.deepEqual(validateSettingsPatch({ maxActiveDownloads: 4, theme: "light" }), { maxActiveDownloads: 4, theme: "light" });
  assert.throws(() => validateSettingsPatch({ unknownSetting: true }), /Invalid setting key/);
  assert.throws(() => validateSettingsPatch({ maxActiveDownloads: Number.NaN }), /Invalid value for setting/);
  assert.throws(() => validateSettingsPatch({ uiFontSize: 200 }), /Invalid value for setting/);
});
