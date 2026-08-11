import assert from "node:assert/strict";
import test from "node:test";

import {
  ExtensionCapabilityVault,
  type ExtensionCapabilityAdapter,
} from "../extension/ExtensionCapabilityVault";

class MemoryCapabilityAdapter implements ExtensionCapabilityAdapter {
  value: string | null = null;

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
  }
}

test("extension handoff capability rotates in the credential vault without entering settings", async () => {
  const adapter = new MemoryCapabilityAdapter();
  const vault = new ExtensionCapabilityVault(adapter);
  assert.equal(await vault.load(), null);

  const first = await vault.rotate();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(await vault.load(), first);

  const second = await vault.rotate();
  assert.match(second, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(second, first);
  assert.equal(await vault.load(), second);

  adapter.value = "invalid";
  await assert.rejects(() => vault.load(), /invalid/u);
});
