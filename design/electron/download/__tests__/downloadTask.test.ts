import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { startTestServer } from "./testServer";
import { probeUrl, sanitizeFileName } from "../HttpProbe";
import { DownloadTask } from "../DownloadTask";
import { SpeedLimiter } from "../SpeedLimiter";
import { detectCategory } from "../categories";
import { splitStoredDownload, withStoredHeaders } from "../downloadMetadata";
import { isQueueScheduleActive, QueueScheduleClock } from "../queueSchedule";
import type { DownloadItem } from "../../../shared/types";

function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "mdm-test-"));
}

function makeItem(overrides: Partial<DownloadItem>): DownloadItem {
  return {
    id: crypto.randomUUID(),
    url: "",
    fileName: "file.bin",
    folder: "",
    category: "other",
    status: "added",
    totalSize: null,
    downloadedSize: 0,
    speed: 0,
    eta: null,
    resumeSupport: false,
    queueId: null,
    dateAdded: Date.now(),
    dateCompleted: null,
    error: null,
    parts: [],
    connections: 1,
    ...overrides,
  };
}

function hash(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("probeUrl reports size + resume support + suggested filename", async () => {
  const srv = await startTestServer(1024 * 1024);
  try {
    const info = await probeUrl(srv.url);
    assert.equal(info.contentLength, srv.buffer.length);
    assert.equal(info.resumeSupport, true);
    assert.equal(info.suggestedFileName, "file.bin");
  } finally {
    await srv.close();
  }
});

test("custom headers survive persistence and reach probe plus transfer requests", async () => {
  const srv = await startTestServer(128 * 1024, {
    requiredHeader: { name: "x-download-token", value: "token-without-logging" },
  });
  const folder = await tmpDir();
  try {
    const headers = { "X-Download-Token": "token-without-logging" };
    const item = makeItem({
      url: srv.url,
      folder,
      totalSize: srv.buffer.length,
      resumeSupport: false,
    });
    const persisted = withStoredHeaders(item, headers);
    const restored = splitStoredDownload(persisted);
    assert.deepEqual(restored.headers, headers);
    assert.equal("headers" in restored.item, false);

    const info = await probeUrl(srv.url, headers);
    assert.equal(info.contentLength, srv.buffer.length);
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      headers: restored.headers,
      speedLimiters: [new SpeedLimiter(0)],
    });
    await task.start();
    assert.equal(item.status, "completed");
    assert.ok(srv.requestHeaders.length >= 2, "expected HEAD and GET requests");
    assert.ok(
      srv.requestHeaders.every((request) => request["x-download-token"] === "token-without-logging"),
      "custom header must reach every request without being printed"
    );
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("cross-origin redirects strip credentials but preserve ordinary headers", async () => {
  const destination = await startTestServer(128 * 1024);
  const redirect = await startTestServer(128 * 1024, { redirectLocation: destination.url });
  const folder = await tmpDir();
  const headers = {
    Authorization: "Bearer should-not-leave-origin",
    Cookie: "session=should-not-leave-origin",
    "X-Trace-Id": "trace-is-safe",
  };
  try {
    const info = await probeUrl(redirect.redirectUrl, headers);
    assert.equal(info.contentLength, destination.buffer.length);

    const item = makeItem({
      url: redirect.redirectUrl,
      folder,
      totalSize: destination.buffer.length,
      resumeSupport: false,
    });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      headers,
      maxRetries: 0,
      speedLimiters: [new SpeedLimiter(0)],
    });
    await task.start();
    assert.equal(item.status, "completed");

    assert.ok(destination.requestHeaders.length >= 2, "expected probe and transfer requests at the destination");
    for (const request of destination.requestHeaders) {
      assert.equal(request.authorization, undefined);
      assert.equal(request.cookie, undefined);
      assert.equal(request["x-trace-id"], "trace-is-safe");
    }
  } finally {
    await redirect.close();
    await destination.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("filename suggestions cannot escape the selected folder", () => {
  const safe = sanitizeFileName("..\\..\\CON.txt");
  assert.equal(safe.includes("\\"), false);
  assert.equal(safe.includes("/"), false);
  assert.notEqual(safe.toUpperCase(), "CON.TXT");
  assert.equal(sanitizeFileName("   "), "download");
});

test("multi-connection segmented download reconstructs the exact file", async () => {
  const size = 3 * 1024 * 1024 + 777; // uneven size to exercise the last-part remainder
  const srv = await startTestServer(size);
  const folder = await tmpDir();
  try {
    const item = makeItem({
      url: srv.url,
      folder,
      totalSize: size,
      resumeSupport: true,
    });
    const task = new DownloadTask(item, {
      maxConnections: 4,
      minPartSize: 256 * 1024,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let completed = false;
    task.on("completed", () => (completed = true));
    let errorMsg: string | null = null;
    task.on("error", (m) => (errorMsg = m));
    await task.start();

    assert.equal(errorMsg, null);
    assert.equal(completed, true);
    assert.equal(item.status, "completed");
    assert.ok(item.parts.length > 1, "expected multiple parts to have been used");

    const written = await fsp.readFile(path.join(folder, "file.bin"));
    assert.equal(written.length, srv.buffer.length);
    assert.equal(hash(written), hash(srv.buffer));
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("pause then resume continues from saved progress and yields an identical file", async () => {
  const size = 4 * 1024 * 1024;
  const srv = await startTestServer(size);
  const folder = await tmpDir();
  try {
    const item = makeItem({
      url: srv.url,
      folder,
      totalSize: size,
      resumeSupport: true,
    });
    const taskOpts = {
      maxConnections: 3,
      minPartSize: 256 * 1024,
      speedLimiters: [new SpeedLimiter(1.5 * 1024 * 1024)], // throttle so we can pause mid-flight
    };

    const task1 = new DownloadTask(item, taskOpts);
    const startPromise = task1.start();
    // let it get partway through, then pause
    await new Promise((r) => setTimeout(r, 400));
    await task1.pause();
    await startPromise.catch(() => {});

    assert.equal(item.status, "paused");
    const progressAfterPause = item.parts.reduce((s, p) => s + Math.max(0, p.current - p.from), 0);
    assert.ok(progressAfterPause > 0, "expected some bytes to have been downloaded before pause");
    assert.ok(progressAfterPause < size, "expected download to not have finished before pause");

    // Resume: same item (parts carry saved progress), fresh task/http connections
    const task2 = new DownloadTask(item, { ...taskOpts, speedLimiters: [new SpeedLimiter(0)] });
    let completed = false;
    task2.on("completed", () => (completed = true));
    await task2.start();

    assert.equal(completed, true);
    assert.equal(item.status, "completed");
    const written = await fsp.readFile(path.join(folder, "file.bin"));
    assert.equal(written.length, srv.buffer.length);
    assert.equal(hash(written), hash(srv.buffer));
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("non-resumable server falls back to a single streamed connection", async () => {
  const size = 512 * 1024;
  const srv = await startTestServer(size, { supportRanges: false });
  const folder = await tmpDir();
  try {
    const item = makeItem({
      url: srv.url,
      folder,
      totalSize: size,
      resumeSupport: false,
    });
    const task = new DownloadTask(item, {
      maxConnections: 8,
      minPartSize: 256 * 1024,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let completed = false;
    task.on("completed", () => (completed = true));
    await task.start();

    assert.equal(completed, true);
    assert.equal(item.parts.length, 1, "non-resumable downloads must use exactly one connection");
    const written = await fsp.readFile(path.join(folder, "file.bin"));
    assert.equal(hash(written), hash(srv.buffer));
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("ranged downloads reject a server that ignores the Range header", async () => {
  const size = 512 * 1024;
  const srv = await startTestServer(size, { supportRanges: true, ignoreRange: true });
  const folder = await tmpDir();
  try {
    const item = makeItem({
      url: srv.url,
      folder,
      totalSize: size,
      resumeSupport: true,
    });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 512 * 1024,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let errorMsg: string | null = null;
    task.on("error", (message) => (errorMsg = message));
    await task.start();

    assert.equal(item.status, "error");
    assert.match(errorMsg ?? "", /ranged response/i);
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("transfer follows redirects and fails honestly at the redirect limit", async () => {
  const srv = await startTestServer(128 * 1024, { redirectHops: 2 });
  const folder = await tmpDir();
  try {
    const item = makeItem({
      url: srv.redirectUrl,
      folder,
      totalSize: srv.buffer.length,
      resumeSupport: false,
    });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      maxRedirects: 1,
      maxRetries: 0,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let errorMsg: string | null = null;
    task.on("error", (message) => (errorMsg = message));
    await task.start();
    assert.equal(item.status, "error");
    assert.equal(errorMsg, "Too many redirects during download");
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("connection timeout stops a server that never sends response headers", async () => {
  const srv = await startTestServer(16 * 1024, { responseDelayMs: 80 });
  const folder = await tmpDir();
  try {
    const item = makeItem({ url: srv.url, folder, totalSize: srv.buffer.length });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      connectionTimeoutMs: 20,
      requestTimeoutMs: 200,
      idleTimeoutMs: 200,
      maxRetries: 0,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let errorMsg: string | null = null;
    task.on("error", (message) => (errorMsg = message));
    await task.start();
    assert.equal(item.status, "error");
    assert.equal(errorMsg, "Download connection timed out");
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("idle timeout stops a transfer that pauses between body chunks", async () => {
  const srv = await startTestServer(16 * 1024, { bodyChunkDelayMs: 80 });
  const folder = await tmpDir();
  try {
    const item = makeItem({ url: srv.url, folder, totalSize: srv.buffer.length });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      connectionTimeoutMs: 200,
      requestTimeoutMs: 500,
      idleTimeoutMs: 20,
      maxRetries: 0,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let errorMsg: string | null = null;
    task.on("error", (message) => (errorMsg = message));
    await task.start();
    assert.equal(item.status, "error");
    assert.equal(errorMsg, "Download idle timeout");
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("request timeout bounds a slow body even when the socket is otherwise active", async () => {
  const srv = await startTestServer(16 * 1024, { bodyChunkDelayMs: 80 });
  const folder = await tmpDir();
  try {
    const item = makeItem({ url: srv.url, folder, totalSize: srv.buffer.length });
    const task = new DownloadTask(item, {
      maxConnections: 1,
      minPartSize: 256 * 1024,
      connectionTimeoutMs: 200,
      requestTimeoutMs: 20,
      idleTimeoutMs: 200,
      maxRetries: 0,
      speedLimiters: [new SpeedLimiter(0)],
    });
    let errorMsg: string | null = null;
    task.on("error", (message) => (errorMsg = message));
    await task.start();
    assert.equal(item.status, "error");
    assert.equal(errorMsg, "Download request timed out");
  } finally {
    await srv.close();
    await fsp.rm(folder, { recursive: true, force: true });
  }
});

test("queue schedules handle ordinary and overnight windows", () => {
  const queue = {
    id: "q",
    name: "Scheduled",
    maxConcurrent: 1,
    isRunning: true,
    itemIds: [] as string[],
    scheduleEnabled: true,
    startAt: "22:00",
    endAt: "02:00",
  };
  assert.equal(isQueueScheduleActive(queue, new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(isQueueScheduleActive(queue, new Date(2026, 0, 1, 1, 0)), true);
  assert.equal(isQueueScheduleActive(queue, new Date(2026, 0, 1, 12, 0)), false);
});

test("queue schedule clock stops cleanly and does not tick after shutdown", async () => {
  let ticks = 0;
  const clock = new QueueScheduleClock(() => ticks++, 5);
  clock.start();
  assert.equal(clock.isRunning, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  clock.tickNow();
  clock.stop();
  const ticksAtStop = ticks;
  assert.equal(clock.isRunning, false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ticks, ticksAtStop);
});

test("category detection maps common extensions", () => {
  assert.equal(detectCategory("movie.mp4"), "video");
  assert.equal(detectCategory("song.mp3"), "music");
  assert.equal(detectCategory("setup.exe"), "apps");
  assert.equal(detectCategory("archive.zip"), "compressed");
  assert.equal(detectCategory("photo.png"), "image");
  assert.equal(detectCategory("report.pdf"), "document");
  assert.equal(detectCategory("mystery.xyz"), "other");
});

test("SpeedLimiter throttles throughput close to the configured cap", async () => {
  const limiter = new SpeedLimiter(100 * 1024); // 100 KB/s
  const start = Date.now();
  let remaining = 300 * 1024; // should take ~3s
  while (remaining > 0) {
    const granted = await limiter.acquire(Math.min(remaining, 32 * 1024));
    remaining -= granted;
  }
  const elapsed = (Date.now() - start) / 1000;
  assert.ok(elapsed > 1.5, `expected throttling to take a noticeable amount of time, took ${elapsed}s`);
});
