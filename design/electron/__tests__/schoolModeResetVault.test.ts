import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHOOL_MODE_RESET_PASSWORD_MIN_LENGTH,
  SchoolModeResetVault,
  type SchoolModeResetVaultAdapter,
} from "../schoolMode/SchoolModeResetVault";

class MemorySchoolModeResetAdapter implements SchoolModeResetVaultAdapter {
  value: Uint8Array | null = null;

  async read(): Promise<Uint8Array | null> {
    return this.value ? new Uint8Array(this.value) : null;
  }

  async write(value: Uint8Array): Promise<void> {
    this.value = new Uint8Array(value);
  }

  async remove(): Promise<void> {
    this.value = null;
  }
}

test("School mode reset vault stores only a verifier and supports replacement", async () => {
  const adapter = new MemorySchoolModeResetAdapter();
  const vault = new SchoolModeResetVault(adapter);
  const first = "correct horse battery staple";
  const second = "another correct battery staple";

  assert.equal(await vault.state(), "unconfigured");
  await vault.configure(first);
  assert.equal(await vault.state(), "configured");
  assert.equal(await vault.verify(first), true);
  assert.equal(await vault.verify("wrong credential value"), false);
  await vault.replace(first, second);
  assert.equal(await vault.verify(first), false);
  assert.equal(await vault.verify(second), true);

  assert.ok(adapter.value);
  const stored = new TextDecoder().decode(adapter.value!);
  const record = JSON.parse(stored) as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["salt", "verifier", "version"]);
  assert.equal(stored.includes(first), false);
  assert.equal(stored.includes(second), false);
});

test("School mode reset vault rejects weak, duplicate, and mismatched credentials", async () => {
  const adapter = new MemorySchoolModeResetAdapter();
  const vault = new SchoolModeResetVault(adapter);
  await assert.rejects(
    () => vault.configure("x".repeat(SCHOOL_MODE_RESET_PASSWORD_MIN_LENGTH - 1)),
    /between/,
  );
  await vault.configure("a secure School mode credential");
  await assert.rejects(() => vault.configure("another secure credential"), /already configured/);
  await assert.rejects(() => vault.replace("wrong current credential", "new secure credential"), /did not match/);
});

test("School mode reset vault fails closed on corrupt bytes and removes the record", async () => {
  const adapter = new MemorySchoolModeResetAdapter();
  adapter.value = new TextEncoder().encode("not-json");
  const vault = new SchoolModeResetVault(adapter);
  await assert.rejects(() => vault.state(), /corrupt/);
  await assert.rejects(() => vault.verify("a secure credential"), /corrupt/);

  adapter.value = null;
  await vault.configure("a secure credential");
  await vault.remove();
  assert.equal(await vault.state(), "unconfigured");
});
