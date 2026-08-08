import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DownloadItem, SshHostConfig } from "../../../shared/types";
import type { DistributedRangeRequestV1, SourceIdentity } from "../../../shared/distributedProtocol";
import {
  DistributedDownloadTask,
  type DistributedRangeFetcher,
} from "../distributed/DistributedDownloadTask";

const sourceIdentity: SourceIdentity = { length: 64, etag: '"stable"', lastModified: null };
const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-");
const BAD_HOST_ID = "11111111-1111-4111-8111-111111111111";
const GOOD_HOST_ID = "22222222-2222-4222-8222-222222222222";

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function host(id: string, endpoint = `${id.slice(0, 8)}.example.test`): SshHostConfig {
  return {
    id,
    name: id,
    host: endpoint,
    sshPort: 22,
    username: "docker",
    hostKeySha256: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    bootstrapAuthMode: "system-agent",
    workerPort: 2222,
    workerHostKeySha256: "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    enabled: true,
    trustedForSourceSecrets: false,
    provisionedAt: 1,
  };
}

function item(folder: string, id: string): DownloadItem {
  return {
    id,
    url: "https://downloads.example.test/file.bin",
    fileName: "file.bin",
    folder,
    category: "other",
    status: "added",
    totalSize: sourceIdentity.length,
    downloadedSize: 0,
    speed: 0,
    eta: null,
    resumeSupport: true,
    queueId: null,
    dateAdded: Date.now(),
    dateCompleted: null,
    error: null,
    parts: [],
    connections: 2,
    transferMode: "ssh-distributed",
    sshHostIds: ["bad", "good"],
    sshSourceIdentity: sourceIdentity,
    sshExpectedSha256: digest(bytes),
  };
}

function fetcherFor(
  calls: Array<{ host: string; request: DistributedRangeRequestV1 }>,
  implementation: (host: SshHostConfig, request: DistributedRangeRequestV1) => Buffer,
): DistributedRangeFetcher {
  return {
    async fetchRange(hostConfig, request, sink) {
      calls.push({ host: hostConfig.id, request });
      const value = implementation(hostConfig, request);
      await sink(value);
      return { byteLength: value.byteLength, sha256: digest(value) };
    },
  };
}

test("distributed scheduler retries an ordinary one-host failure up to the third bounded attempt", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-retry-"));
  try {
    const calls: Array<{ host: string; request: DistributedRangeRequestV1 }> = [];
    let failures = 0;
    const fetcher: DistributedRangeFetcher = {
      async fetchRange(hostConfig, request, sink) {
        calls.push({ host: hostConfig.id, request });
        if (failures < 2) {
          failures += 1;
          throw new Error("temporary transport failure");
        }
        const value = bytes.subarray(request.range.start, request.range.endExclusive);
        await sink(value);
        return { byteLength: value.byteLength, sha256: digest(value) };
      },
    };
    const retryItem = item(root, "retry");
    retryItem.sshHostIds = [BAD_HOST_ID];
    retryItem.connections = 1;
    const download = new DistributedDownloadTask(retryItem, {
      workRoot: root,
      source: { url: "https://downloads.example.test/file.bin", headers: {} },
      sourceIdentity,
      selection: { mode: "ssh", hostIds: [BAD_HOST_ID], expectedSha256: digest(bytes) },
      hosts: [host(BAD_HOST_ID)],
      rangeFetcher: fetcher,
      identityVerifier: { verifyUnchanged: async () => {} },
    });
    await download.start();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.host), [BAD_HOST_ID, BAD_HOST_ID, BAD_HOST_ID]);
    assert.equal(download.item.status, "completed");
    assert.deepEqual(await fsp.readFile(path.join(root, "file.bin")), bytes);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("a trusted whole-hash mismatch invalidates verified pieces so retry fetches again", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-distributed-hash-"));
  try {
    const calls: Array<{ host: string; request: DistributedRangeRequestV1 }> = [];
    let poisoned = true;
    const fetcher = fetcherFor(calls, (_host, request) => {
      const correct = bytes.subarray(request.range.start, request.range.endExclusive);
      return poisoned ? Buffer.alloc(correct.byteLength, 0x5a) : correct;
    });
    const download = new DistributedDownloadTask(item(root, "hash"), {
      workRoot: root,
      source: { url: "https://downloads.example.test/file.bin", headers: {} },
      sourceIdentity,
      selection: { mode: "ssh", hostIds: [BAD_HOST_ID, GOOD_HOST_ID], expectedSha256: digest(bytes) },
      hosts: [host(BAD_HOST_ID), host(GOOD_HOST_ID)],
      rangeFetcher: fetcher,
      identityVerifier: { verifyUnchanged: async () => {} },
    });
    await assert.rejects(download.start(), /trusted expected SHA-256/u);
    poisoned = false;
    await download.start();
    assert.equal(calls.length, 4);
    assert.deepEqual(await fsp.readFile(path.join(root, "file.bin")), bytes);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
