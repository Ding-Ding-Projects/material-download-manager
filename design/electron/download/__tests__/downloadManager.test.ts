import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertQueueCreatePayload, DownloadManager } from "../DownloadManager";
import type { DownloadQueue } from "../../../shared/types";
import { startTestServer } from "./testServer";
import { HistoryStore } from "../../history/HistoryStore";

/** Windows can release a just-completed Git child a moment after its promise resolves. */
async function removeTestRoot(root: string): Promise<void> {
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

test("queue creation rejects malformed item IDs before persistence and processQueue fails closed", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-queue-validation-test-"));
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  const manager = new DownloadManager(root);
  try {
    await manager.init();
    const initialQueueIds = manager.getState().queues.map((queue) => queue.id);

    await assert.rejects(
      manager.createQueue({ name: "String item IDs", itemIds: "not-an-array" as unknown as string[] }),
      /queue item IDs/i
    );
    await assert.rejects(
      manager.createQueue({ name: "Invalid item ID", itemIds: [123 as unknown as string] }),
      /queue item IDs/i
    );
    assert.deepEqual(manager.getState().queues.map((queue) => queue.id), initialQueueIds);

    const internals = manager as unknown as { queues: Map<string, DownloadQueue> };
    internals.queues.set("legacy-malformed", {
      id: "legacy-malformed",
      name: "Legacy malformed",
      maxConcurrent: 1,
      isRunning: true,
      itemIds: "not-an-array" as unknown as string[],
      scheduleEnabled: false,
      startAt: null,
      endAt: null,
    });
    assert.doesNotThrow(() => manager.processQueue("legacy-malformed"));
    internals.queues.delete("legacy-malformed");

    assert.doesNotThrow(() => assertQueueCreatePayload({ name: "Valid queue", itemIds: [] }));
    const validQueue = await manager.createQueue({ name: "Valid queue", itemIds: [] });
    assert.equal(validQueue.name, "Valid queue");
    assert.deepEqual(validQueue.itemIds, []);
  } finally {
    await manager.shutdown();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("one global active-download cap is shared across multiple queues", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-manager-test-"));
  const firstServer = await startTestServer(64 * 1024, { bodyChunkDelayMs: 300 });
  const secondServer = await startTestServer(64 * 1024, { bodyChunkDelayMs: 150 });
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  const manager = new DownloadManager(root);
  try {
    await manager.init();
    await manager.setSettings({
      maxActiveDownloads: 1,
      maxConnectionsPerDownload: 1,
      minConnectionPartSize: 256 * 1024,
    });
    const firstQueue = await manager.createQueue({ name: "First", maxConcurrent: 1 });
    const secondQueue = await manager.createQueue({ name: "Second", maxConcurrent: 1 });
    const firstId = await manager.addDownload({
      url: firstServer.url,
      folder: path.join(root, "first"),
      fileName: "first.bin",
      queueId: firstQueue.id,
      startImmediately: false,
    });
    const secondId = await manager.addDownload({
      url: secondServer.url,
      folder: path.join(root, "second"),
      fileName: "second.bin",
      queueId: secondQueue.id,
      startImmediately: false,
    });

    const bothCompleted = new Promise<void>((resolve) => {
      let completedCount = 0;
      manager.on("itemCompleted", () => {
        completedCount++;
        if (completedCount === 2) resolve();
      });
    });
    await manager.resume(firstId);
    assert.equal(manager.getState().items.find((item) => item.id === firstId)?.status, "downloading");
    await manager.resume(secondId);
    let state = manager.getState();
    assert.equal(state.items.find((item) => item.id === firstId)?.status, "downloading");
    assert.equal(state.items.find((item) => item.id === secondId)?.status, "queued");

    await bothCompleted;
    for (let i = 0; i < 100 && secondServer.requestHeaders.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    state = manager.getState();
    assert.ok(secondServer.requestHeaders.length > 0, "the second queue should start after the first frees the global slot");
    assert.notEqual(state.items.find((item) => item.id === secondId)?.status, "queued");
  } finally {
    await manager.shutdown();
    await firstServer.close();
    await secondServer.close();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("manager reloads persisted custom headers without exposing them in state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-header-manager-test-"));
  const server = await startTestServer(32 * 1024, {
    requiredHeader: { name: "x-persisted-token", value: "persisted-secret" },
  });
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const firstManager = new DownloadManager(root);
    await firstManager.init();
    const id = await firstManager.addDownload({
      url: server.url,
      folder: path.join(root, "download"),
      fileName: "file.bin",
      startImmediately: false,
      headers: { "X-Persisted-Token": "persisted-secret" },
    });
    await firstManager.shutdown();

    const secondManager = new DownloadManager(root);
    await secondManager.init();
    const restored = secondManager.getState().items.find((item) => item.id === id);
    assert.ok(restored);
    assert.equal("headers" in restored, false, "renderer-facing state must not expose persisted headers");
    const completed = new Promise<void>((resolve) => secondManager.once("itemCompleted", () => resolve()));
    await secondManager.resume(id);
    await completed;
    assert.ok(server.requestHeaders.length >= 2, "expected persisted probe and transfer requests");
    assert.ok(
      server.requestHeaders.every((request) => request["x-persisted-token"] === "persisted-secret"),
      "persisted custom header must reach the transfer request"
    );
    await secondManager.shutdown();
  } finally {
    await server.close();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("credentialed source URLs remain usable while state and history keep only redacted diagnostics", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-manager-url-redaction-test-"));
  const server = await startTestServer(32 * 1024);
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  const manager = new DownloadManager(root);
  let initialized = false;
  try {
    await manager.init();
    initialized = true;
    const sourceUrl =
      server.url.replace("://", "://download-user:download-password@") +
      "?access_token=query-secret#fragment-secret";
    const id = await manager.addDownload({
      url: sourceUrl,
      folder: path.join(root, "download"),
      fileName: "credentialed.bin",
      startImmediately: false,
    });
    const added = manager.getState().items.find((item) => item.id === id);
    assert.ok(added);
    assert.equal(added.url.includes("download-password"), false);
    assert.match(added.url, /\[REDACTED\]@127\.0\.0\.1/);
    assert.match(added.url, /access_token=\[REDACTED\]#\[REDACTED\]/);

    const completed = new Promise<void>((resolve) => {
      manager.once("itemCompleted", (item) => {
        if (item.id === id) resolve();
      });
    });
    await manager.resume(id);
    await completed;
    assert.equal(manager.getState().items.find((item) => item.id === id)?.status, "completed");
    assert.ok(server.requestHeaders.length >= 2, "the private source URL should still drive probe and transfer requests");

    await manager.shutdown();
    initialized = false;
    const stateJson = await fsp.readFile(path.join(root, "state.json"), "utf8");
    const historySnapshot = await new HistoryStore(root).readSnapshot();
    for (const secret of ["download-user", "download-password", "query-secret", "fragment-secret"]) {
      assert.equal(stateJson.includes(secret), false, `state must not include ${secret}`);
      assert.equal(historySnapshot?.includes(secret), false, `history must not include ${secret}`);
    }
    assert.match(stateJson, /\[REDACTED\]@127\.0\.0\.1/);
    assert.match(historySnapshot ?? "", /access_token=\[REDACTED\]#\[REDACTED\]/);
  } finally {
    if (initialized) await manager.shutdown();
    await server.close();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("malformed credential URLs stay redacted in item errors, persisted state and history", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-manager-malformed-url-test-"));
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  const manager = new DownloadManager(root);
  let initialized = false;
  try {
    await manager.init();
    initialized = true;
    const malformedUrl =
      "https://malformed-user:malformed-password@example.com:not-a-port/download?signature=malformed-token#malformed-fragment";
    const id = await manager.addDownload({
      url: malformedUrl,
      folder: path.join(root, "download"),
      fileName: "malformed.bin",
      startImmediately: false,
    });
    const item = manager.getState().items.find((candidate) => candidate.id === id);
    assert.ok(item);
    assert.match(item.url, /\[REDACTED\]@example\.com:not-a-port/);
    assert.match(item.error ?? "", /Invalid URL/);
    for (const secret of ["malformed-user", "malformed-password", "malformed-token", "malformed-fragment"]) {
      assert.equal(item.url.includes(secret), false, `item URL must not include ${secret}`);
      assert.equal(item.error?.includes(secret), false, `item error must not include ${secret}`);
    }

    await manager.shutdown();
    initialized = false;
    const stateJson = await fsp.readFile(path.join(root, "state.json"), "utf8");
    const historySnapshot = await new HistoryStore(root).readSnapshot();
    for (const secret of ["malformed-user", "malformed-password", "malformed-token", "malformed-fragment"]) {
      assert.equal(stateJson.includes(secret), false, `state must not include ${secret}`);
      assert.equal(historySnapshot?.includes(secret), false, `history must not include ${secret}`);
    }
    assert.match(stateJson, /Invalid URL/);
    assert.match(historySnapshot ?? "", /example\.com:not-a-port/);
  } finally {
    if (initialized) await manager.shutdown();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("manual resume waits for an in-flight schedule pause", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-schedule-race-test-"));
  const server = await startTestServer(512 * 1024, { bodyChunkDelayMs: 500 });
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const manager = new DownloadManager(root);
    await manager.init();
    await manager.setSettings({ maxConnectionsPerDownload: 1, maxActiveDownloads: 1 });
    const queue = await manager.createQueue({ name: "Scheduled", maxConcurrent: 1 });
    const id = await manager.addDownload({
      url: server.url,
      folder: path.join(root, "download"),
      fileName: "file.bin",
      queueId: queue.id,
      startImmediately: false,
    });
    await manager.resume(id);
    for (let i = 0; i < 100 && server.requestHeaders.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const internals = manager as unknown as {
      tasks: Map<string, { pause: () => Promise<void> }>;
      scheduledPauses: Map<string, Promise<void>>;
    };
    const task = internals.tasks.get(id);
    assert.ok(task, "the item should be active before the schedule closes");
    const realPause = task.pause.bind(task);
    let releasePause!: () => void;
    const pauseGate = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    task.pause = async () => {
      await pauseGate;
      await realPause();
    };

    await manager.updateQueue({
      ...queue,
      scheduleEnabled: true,
      startAt: "not-a-time",
      endAt: null,
    });
    assert.ok(internals.scheduledPauses.has(id), "the schedule should have started pausing the active task");

    let resumeFinished = false;
    const resumePromise = manager.resume(id).then(() => {
      resumeFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(resumeFinished, false, "resume must wait for the automatic pause to settle");

    releasePause();
    await resumePromise;
    const status = manager.getState().items.find((item) => item.id === id)?.status;
    assert.ok(status === "queued" || status === "downloading", `unexpected resumed status: ${status}`);
    await manager.shutdown();
  } finally {
    await server.close();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});

test("manager records download creation and deletion in local history", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-manager-history-test-"));
  const server = await startTestServer(8 * 1024);
  const previousUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const manager = new DownloadManager(root);
    await manager.init();
    const id = await manager.addDownload({
      url: server.url,
      folder: path.join(root, "download"),
      fileName: "history.bin",
      startImmediately: false,
    });
    await manager.remove(id, false);
    await manager.shutdown();

    const revisions = await new HistoryStore(root).listRevisions();
    assert.ok(revisions.some((revision) => revision.action === "created" && /history\.bin/.test(revision.summary)));
    assert.ok(revisions.some((revision) => revision.action === "deleted" && /history\.bin/.test(revision.summary)));
  } finally {
    await server.close();
    await removeTestRoot(root);
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
});
