import assert from "node:assert/strict";
import test from "node:test";
import { utils as sshUtils } from "ssh2";

import {
  CredentialVault,
  type CredentialVaultAdapter,
  sshHostKeyFingerprint,
} from "../distributed/CredentialVault";

const HOST_ID = "123e4567-e89b-42d3-a456-426614174000";

class MemoryCredentialAdapter implements CredentialVaultAdapter {
  readonly values = new Map<string, Uint8Array>();

  async read(account: string): Promise<Uint8Array | null> {
    const value = this.values.get(account);
    return value ? new Uint8Array(value) : null;
  }

  async write(account: string, value: Uint8Array): Promise<void> {
    this.values.set(account, new Uint8Array(value));
  }

  async remove(account: string): Promise<void> {
    this.values.delete(account);
  }
}

test("credential vault stores a validated Ed25519 key under an opaque host account", async () => {
  const adapter = new MemoryCredentialAdapter();
  const vault = new CredentialVault(adapter);
  const pair = sshUtils.generateKeyPairSync("ed25519");

  const stored = await vault.store(HOST_ID, "bootstrap", {
    privateKey: pair.private,
    passphrase: null,
  });
  assert.match(stored.publicKey, /^ssh-ed25519 [A-Za-z0-9+/=]+$/u);
  assert.deepEqual(Array.from(adapter.values.keys()), [`bootstrap:${HOST_ID}`]);

  const loaded = await vault.load(HOST_ID, "bootstrap");
  assert.equal(loaded?.privateKey, pair.private);
  assert.equal(loaded?.passphrase, null);
  assert.equal(loaded?.publicKey, stored.publicKey);
});

test("credential vault generates independent relay and worker-client keys and removes all host secrets", async () => {
  const adapter = new MemoryCredentialAdapter();
  const vault = new CredentialVault(adapter);

  const relay = await vault.generate(HOST_ID, "relay");
  const worker = await vault.generate(HOST_ID, "worker-client");
  assert.notEqual(relay.publicKey, worker.publicKey);
  assert.equal(adapter.values.size, 2);

  await vault.removeHost(HOST_ID);
  assert.equal(adapter.values.size, 0);
});

test("credential vault rejects non-Ed25519 and corrupt or mismatched records", async () => {
  const adapter = new MemoryCredentialAdapter();
  const vault = new CredentialVault(adapter);
  const rsa = sshUtils.generateKeyPairSync("rsa", { bits: 2048 });

  await assert.rejects(
    vault.store(HOST_ID, "bootstrap", { privateKey: rsa.private, passphrase: null }),
    /Ed25519/u,
  );

  adapter.values.set(`bootstrap:${HOST_ID}`, new TextEncoder().encode("not-json"));
  await assert.rejects(vault.load(HOST_ID, "bootstrap"), /corrupt/u);

  const pair = sshUtils.generateKeyPairSync("ed25519");
  adapter.values.set(
    `bootstrap:${HOST_ID}`,
    new TextEncoder().encode(JSON.stringify({
      version: 1,
      privateKey: pair.private,
      passphrase: null,
      publicKey: "ssh-ed25519 AAAA",
    })),
  );
  await assert.rejects(vault.load(HOST_ID, "bootstrap"), /does not match/u);
});

test("host-key fingerprint uses the OpenSSH SHA256 representation without padding", () => {
  assert.equal(
    sshHostKeyFingerprint(Buffer.from("host-key")),
    "SHA256:CfEOS9w3pHE4KlqjcQFwWyWMmyRvvPoehydyMhTxpzg",
  );
});

test("distributed source URLs and allowed headers round-trip only through the vault account", async () => {
  const adapter = new MemoryCredentialAdapter();
  const vault = new CredentialVault(adapter);
  await vault.storeDownloadSource(HOST_ID, {
    url: "https://downloads.example.test/archive.zip?short-lived=secret",
    headers: { authorization: "Bearer hidden" },
  });

  assert.deepEqual(await vault.loadDownloadSource(HOST_ID), {
    url: "https://downloads.example.test/archive.zip?short-lived=secret",
    headers: { authorization: "Bearer hidden" },
  });
  assert.deepEqual(Array.from(adapter.values.keys()), [`download-source:${HOST_ID}`]);

  await vault.removeDownloadSource(HOST_ID);
  assert.equal(await vault.loadDownloadSource(HOST_ID), null);
});

test("protected local source credentials and fragments round-trip only through the vault account", async () => {
  const adapter = new MemoryCredentialAdapter();
  const vault = new CredentialVault(adapter);
  const source = {
    url: "https://download-user:download-password@downloads.example.test/archive.zip?short-lived=secret#private-fragment",
    headers: {},
  };

  await vault.storeDownloadSource(HOST_ID, source);

  assert.deepEqual(await vault.loadDownloadSource(HOST_ID), source);
  assert.deepEqual(Array.from(adapter.values.keys()), [`download-source:${HOST_ID}`]);
});

test("protected source vault rejects malformed URLs", async () => {
  const vault = new CredentialVault(new MemoryCredentialAdapter());
  await assert.rejects(
    vault.storeDownloadSource(HOST_ID, {
      url: "https://download-user:download-password@example.test:not-a-port/archive.zip",
      headers: {},
    }),
    /Invalid distributed download source/u,
  );
});

test("distributed source vault rejects transport-controlled and unknown headers", async () => {
  const vault = new CredentialVault(new MemoryCredentialAdapter());
  await assert.rejects(
    vault.storeDownloadSource(HOST_ID, {
      url: "https://downloads.example.test/archive.zip",
      headers: { range: "bytes=0-10" },
    }),
    /Invalid distributed download source/u,
  );
});
