import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isDistributedManifest } from "../../../shared/distributedProtocol";
import {
  DistributedManifestStore,
  createDistributedManifest,
  markDistributedPieceVerified,
} from "../distributed/DistributedManifestStore";
import { planDistributedRanges } from "../distributed/DistributedRangePlanner";

const createdAt = Date.parse("2026-08-07T12:00:00.000Z");
const source = Object.freeze({
  length: 10,
  etag: '"release-v1"',
  lastModified: "Thu, 07 Aug 2025 12:00:00 GMT",
});

function createManifest() {
  return createDistributedManifest({
    downloadId: "download-1",
    source,
    selection: { mode: "ssh", hostIds: ["worker-a", "worker-b"] },
    pieces: planDistributedRanges({ totalSize: source.length, selectedHostCount: 2, targetPieceBytes: 100 }),
    now: createdAt,
  });
}

test("manifest store atomically round-trips exact state and verified piece metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-manifest-"));
  try {
    const store = new DistributedManifestStore(root, "download-1");
    const initial = createManifest();
    assert.equal(isDistributedManifest(initial), true);
    await store.save(initial);
    assert.deepEqual(await store.load(), initial);

    const verifiedAt = createdAt + 1_000;
    const verified = markDistributedPieceVerified(initial, "piece-0001", "a".repeat(64), verifiedAt);
    assert.throws(
      () => markDistributedPieceVerified(verified, "piece-0001", "f".repeat(64), verifiedAt + 1),
      /different digest/i
    );
    assert.throws(
      () => markDistributedPieceVerified(verified, "piece-0002", "c".repeat(64), verifiedAt - 1),
      /latest manifest update/i
    );
    await store.save(verified);
    const loaded = await store.load();
    assert.deepEqual(loaded, verified);
    assert.deepEqual(loaded?.pieces[0], {
      ...initial.pieces[0],
      state: "verified",
      verifiedByteLength: initial.pieces[0].length,
      sha256: "a".repeat(64),
      verifiedAt,
    });

    const files = await fsp.readdir(store.workDirectory);
    assert.deepEqual(files.filter((name) => name.endsWith(".tmp")), []);
    const serialized = await fsp.readFile(store.manifestPath, "utf8");
    assert.equal(serialized.includes("https://"), false, "manifests must not persist source URLs or query secrets");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("manifest store serializes concurrent unique-temp saves and leaves no temporary files", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-concurrent-"));
  try {
    const firstStore = new DistributedManifestStore(root, "download-1");
    const secondStore = new DistributedManifestStore(root, "download-1");
    const initial = createManifest();
    const first = markDistributedPieceVerified(initial, "piece-0001", "b".repeat(64), createdAt + 1);
    const second = markDistributedPieceVerified(first, "piece-0002", "c".repeat(64), createdAt + 2);

    await Promise.all([firstStore.save(first), secondStore.save(second)]);
    assert.deepEqual(await firstStore.load(), second);
    assert.deepEqual(
      (await fsp.readdir(firstStore.workDirectory)).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("manifest store rejects malformed JSON, unknown keys, and forged verified metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-corruption-"));
  try {
    const store = new DistributedManifestStore(root, "download-1");
    const manifest = createManifest();
    await store.save(manifest);

    await fsp.writeFile(store.manifestPath, "{not-json", "utf8");
    await assert.rejects(store.load(), /invalid JSON/i);

    await fsp.writeFile(store.manifestPath, JSON.stringify({ ...manifest, unexpected: true }), "utf8");
    await assert.rejects(store.load(), /exact version-1 schema/i);

    const corrupted = {
      ...manifest,
      pieces: manifest.pieces.map((piece, index) => index === 0
        ? { ...piece, state: "verified", verifiedByteLength: 1, sha256: "d".repeat(64), verifiedAt: createdAt + 1 }
        : piece),
    };
    await fsp.writeFile(store.manifestPath, JSON.stringify(corrupted), "utf8");
    await assert.rejects(store.load(), /exact version-1 schema/i);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("manifest paths are derived only from bounded identifiers below the managed root", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-paths-"));
  try {
    const store = new DistributedManifestStore(root, "download-1");
    const piecePath = store.piecePath("piece-0001");
    assert.equal(path.relative(root, piecePath).startsWith(".."), false);
    assert.equal(path.basename(piecePath), "piece-0001.part");
    assert.throws(() => store.piecePath("../escape"), /pieceId/i);
    assert.throws(() => new DistributedManifestStore(root, "../escape"), /downloadId/i);
    assert.throws(() => new DistributedManifestStore("relative/root", "download-1"), /absolute local path/i);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
