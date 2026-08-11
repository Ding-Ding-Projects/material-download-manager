import test from "node:test";
import assert from "node:assert/strict";
import { HistoryAccessVault, HISTORY_ACCESS_PASSWORD_MIN_LENGTH, type HistoryAccessVaultAdapter } from "../history/HistoryAccessVault";

class MemoryHistoryAccessAdapter implements HistoryAccessVaultAdapter {
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

test("history access stores only a verifier and unlocks with the matching password", async () => {
  const adapter = new MemoryHistoryAccessAdapter();
  const vault = new HistoryAccessVault(adapter);
  const password = "correct horse battery staple";

  assert.equal(await vault.isConfigured(), false);
  await vault.configure(password);
  assert.equal(await vault.isConfigured(), true);
  assert.equal(await vault.verify(password), true);
  assert.equal(await vault.verify("wrong history password"), false);
  assert.ok(adapter.value);
  const stored = new TextDecoder().decode(adapter.value!);
  const record = JSON.parse(stored) as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["salt", "verifier", "version"]);
  assert.equal(stored.includes(password), false);
});

test("history access rejects weak passwords and duplicate setup", async () => {
  const adapter = new MemoryHistoryAccessAdapter();
  const vault = new HistoryAccessVault(adapter);
  await assert.rejects(() => vault.configure("x".repeat(HISTORY_ACCESS_PASSWORD_MIN_LENGTH - 1)), /between/);
  await vault.configure("a secure history password");
  await assert.rejects(() => vault.configure("another secure password"), /already configured/);
  await assert.rejects(() => vault.verify("short"), /between/);
});

test("history access fails closed on corrupt vault bytes", async () => {
  const adapter = new MemoryHistoryAccessAdapter();
  adapter.value = new TextEncoder().encode("not-json");
  const vault = new HistoryAccessVault(adapter);
  await assert.rejects(() => vault.isConfigured(), /corrupt/);
  await assert.rejects(() => vault.verify("a secure history password"), /corrupt/);
});
