import test from "node:test";
import assert from "node:assert/strict";
import type { PresentationSettings, ResetCredentialState, SchoolModeCredentialMetadata } from "../../shared/types";
import { SchoolModeCredentialService, type SchoolModeCredentialHost } from "../schoolMode/SchoolModeCredentialService";
import { SchoolModeResetVault, type SchoolModeResetVaultAdapter } from "../schoolMode/SchoolModeResetVault";

class MemoryAdapter implements SchoolModeResetVaultAdapter {
  value: Uint8Array | null = null;
  async read() { return this.value ? new Uint8Array(this.value) : null; }
  async write(value: Uint8Array) { this.value = new Uint8Array(value); }
  async remove() { this.value = null; }
}

class FakeHost implements SchoolModeCredentialHost {
  metadata: SchoolModeCredentialMetadata = { schemaVersion: 1, provider: "os-credential-vault", state: "unconfigured" };
  schoolModeEnabled = true;
  changes: ResetCredentialState[] = [];
  failNextStateUpdate = false;

  getSchoolModeCredentialMetadata() { return { ...this.metadata }; }
  async setSchoolModeCredentialState(state: ResetCredentialState): Promise<PresentationSettings> {
    if (this.failNextStateUpdate) {
      this.failNextStateUpdate = false;
      throw new Error("settings metadata write failed");
    }
    this.metadata = { ...this.metadata, state };
    this.changes.push(state);
    return this.presentation();
  }
  async disableSchoolModeAfterCredentialVerification(): Promise<PresentationSettings> {
    this.schoolModeEnabled = false;
    return this.presentation();
  }
  presentation(): PresentationSettings {
    return {
      languageMode: "english",
      funnyLevelEnglish: 1,
      funnyLevelCantonese: 3,
      schoolModeEnabled: this.schoolModeEnabled,
      schoolModeName: "School mode",
      showEmojis: false,
      schoolModeCredential: { ...this.metadata },
    };
  }
}

test("School mode credential service serializes setup, disable verification, change, and reset", async () => {
  const host = new FakeHost();
  const service = new SchoolModeCredentialService(new SchoolModeResetVault(new MemoryAdapter()), host);
  const setupResult = await service.setup("first secure credential", "first secure credential");
  assert.equal(host.metadata.state, "configured");
  assert.equal(JSON.stringify(setupResult).includes("first secure credential"), false);
  await assert.rejects(() => service.disable("wrong secure credential"), /did not match/);
  await service.disable("first secure credential");
  assert.equal(host.schoolModeEnabled, false);
  await service.change("first secure credential", "second secure credential", "second secure credential");
  await service.reset("second secure credential");
  assert.equal(host.metadata.state, "unconfigured");
  assert.deepEqual(host.changes, ["configured", "configured", "unconfigured"]);
});

test("School mode credential service reconciles a deleted profile without inheriting the old vault record", async () => {
  const host = new FakeHost();
  const vault = new SchoolModeResetVault(new MemoryAdapter());
  const service = new SchoolModeCredentialService(vault, host);
  await service.setup("old secure credential", "old secure credential");
  host.metadata = { ...host.metadata, state: "unavailable" };
  await service.synchronize(false);
  assert.equal(host.metadata.state, "unconfigured");
  assert.equal(await vault.state(), "unconfigured");
});

test("School mode credential service reconciles a stale unconfigured metadata record", async () => {
  const host = new FakeHost();
  const vault = new SchoolModeResetVault(new MemoryAdapter());
  const service = new SchoolModeCredentialService(vault, host);
  await service.setup("interrupted setup credential", "interrupted setup credential");
  host.metadata = { ...host.metadata, state: "unconfigured" };
  await service.synchronize(true);
  assert.equal(host.metadata.state, "configured");
  assert.equal(await vault.verify("interrupted setup credential"), true);
});

test("School mode credential service serializes re-entry and rolls back reset on metadata failure", async () => {
  const host = new FakeHost();
  const vault = new SchoolModeResetVault(new MemoryAdapter());
  const service = new SchoolModeCredentialService(vault, host);
  const results = await Promise.allSettled([
    service.setup("serial credential one", "serial credential one"),
    service.setup("serial credential two", "serial credential two"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(host.metadata.state, "configured");

  host.failNextStateUpdate = true;
  await assert.rejects(
    () => service.reset("serial credential one"),
    /settings metadata write failed/,
  );
  assert.equal(host.metadata.state, "configured");
  assert.equal(await vault.verify("serial credential one"), true);
});

test("School mode credential service stays fail-closed when a configured verifier disappears", async () => {
  const host = new FakeHost();
  const adapter = new MemoryAdapter();
  const vault = new SchoolModeResetVault(adapter);
  const service = new SchoolModeCredentialService(vault, host);
  await service.setup("secure credential value", "secure credential value");
  adapter.value = null;
  await service.synchronize(true);
  assert.equal(host.metadata.state, "unavailable");
  await assert.rejects(() => service.disable("secure credential value"), /unavailable/);
});
