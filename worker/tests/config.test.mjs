import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import ssh2 from "ssh2";

import { loadWorkerConfig, parseAllowedClientKeys } from "../dist/config.js";

const { utils } = ssh2;

test("configuration creates one persistent Ed25519 host key and loads only public client keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdm-worker-config-"));
  const client = utils.generateKeyPairSync("ed25519");
  const env = {
    MDM_WORKER_ALLOWED_KEYS: client.public,
    MDM_WORKER_PORT: "2222",
    MDM_WORKER_MAX_CONNECTIONS: "8",
    MDM_WORKER_MAX_FETCHES: "2",
  };
  try {
    const first = await loadWorkerConfig(env, directory);
    const firstRaw = await readFile(join(directory, "host-ed25519"));
    const second = await loadWorkerConfig(env, directory);
    const secondRaw = await readFile(join(directory, "host-ed25519"));
    assert.deepEqual(first.hostKey, firstRaw);
    assert.deepEqual(second.hostKey, firstRaw);
    assert.deepEqual(secondRaw, firstRaw);
    assert.equal(first.allowedClientKeys.length, 1);
    assert.equal(first.allowedClientKeys[0].type, "ssh-ed25519");
    if (process.platform !== "win32") {
      assert.equal((await stat(join(directory, "host-ed25519"))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private, malformed, non-Ed25519, empty, and oversized allowlists fail closed", () => {
  const ed25519 = utils.generateKeyPairSync("ed25519");
  const rsa = utils.generateKeyPairSync("rsa", { bits: 2048 });
  assert.throws(() => parseAllowedClientKeys(""), /1 to 32/u);
  assert.throws(() => parseAllowedClientKeys(ed25519.private), /Only valid Ed25519 public keys/u);
  assert.throws(() => parseAllowedClientKeys(rsa.public), /Only valid Ed25519 public keys/u);
  assert.throws(() => parseAllowedClientKeys("not-a-key"), /Only valid Ed25519 public keys/u);
  assert.throws(() => parseAllowedClientKeys(Array.from({ length: 33 }, () => ed25519.public).join("\n")), /1 to 32/u);
});

test("numeric resource and timeout settings remain bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdm-worker-config-"));
  const client = utils.generateKeyPairSync("ed25519");
  try {
    await assert.rejects(
      loadWorkerConfig({ MDM_WORKER_ALLOWED_KEYS: client.public, MDM_WORKER_MAX_FETCHES: "33" }, directory),
      /between 1 and 32/u,
    );
    await assert.rejects(
      loadWorkerConfig({ MDM_WORKER_ALLOWED_KEYS: client.public, MDM_WORKER_AUTH_TIMEOUT_MS: "999" }, directory),
      /between 1000 and 60000/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
