import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  normalizeUpdateFeedUrl,
  readUpdateFeedUrl,
  UpdateService,
  type UpdateCheckResultLike,
  type UpdateInfoLike,
  type UpdaterAdapter,
} from "../updater/UpdateService";

class FakeUpdater extends EventEmitter implements UpdaterAdapter {
  feedUrl: string | null = null;
  checks = 0;
  downloads = 0;
  installs = 0;
  nextCheck: UpdateCheckResultLike | null = null;
  checkError: Error | null = null;
  downloadError: Error | null = null;

  setFeedURL(options: { url: string }) {
    this.feedUrl = options.url;
  }

  async checkForUpdates() {
    this.checks += 1;
    if (this.checkError) throw this.checkError;
    if (this.nextCheck?.updateInfo) this.emit("update-available", this.nextCheck.updateInfo);
    else this.emit("update-not-available");
    return this.nextCheck;
  }

  async downloadUpdate() {
    this.downloads += 1;
    if (this.downloadError) throw this.downloadError;
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded");
  }

  quitAndInstall() {
    this.installs += 1;
  }
}

function service(adapter: FakeUpdater, options: Partial<ConstructorParameters<typeof UpdateService>[0]> = {}) {
  return new UpdateService({
    adapter,
    currentVersion: "1.0.0",
    isPackaged: true,
    feedUrl: "https://updates.example.test/material-download-manager/",
    startupDelayMs: 0,
    backgroundIntervalMs: 60_000,
    checkTimeoutMs: 50,
    downloadTimeoutMs: 5_000,
    ...options,
  });
}

test("feed URLs require HTTPS and reject embedded credentials or query secrets", () => {
  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/feed/"), "https://updates.example.test/feed/");
  assert.equal(normalizeUpdateFeedUrl("http://updates.example.test/feed/"), null);
  assert.equal(normalizeUpdateFeedUrl("https://user:secret@updates.example.test/feed/"), null);
  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/feed/?token=secret"), null);
  assert.equal(readUpdateFeedUrl({ MDM_UPDATE_FEED_URL: " https://updates.example.test/feed/ " }), "https://updates.example.test/feed/");
});

test("packaged service checks once, downloads in the background, exposes ready, and installs only explicitly", async () => {
  const adapter = new FakeUpdater();
  adapter.nextCheck = { updateInfo: { version: "1.1.0" } satisfies UpdateInfoLike };
  const states: string[] = [];
  const updater = service(adapter);
  updater.onStateChanged((state) => states.push(state.status));

  assert.equal(updater.start().status, "current");
  const result = await updater.checkForUpdates();

  assert.equal(adapter.feedUrl, "https://updates.example.test/material-download-manager/");
  assert.equal(adapter.checks, 1);
  assert.equal(adapter.downloads, 1);
  assert.equal(result.status, "ready");
  assert.equal(updater.quitAndInstall(), true);
  assert.equal(adapter.installs, 1);
  assert.deepEqual(states, ["available", "downloading", "downloading", "ready"]);
  updater.stop();
});

test("missing feed configuration fails closed without calling the updater", async () => {
  const adapter = new FakeUpdater();
  const updater = service(adapter, { feedUrl: undefined });

  const state = updater.start();
  assert.equal(state.status, "failed");
  assert.match(state.message, /HTTPS update feed/);
  assert.equal(adapter.checks, 0);
  assert.equal((await updater.checkForUpdates()).status, "failed");
  updater.stop();
});

test("network failures become offline state and do not expose the raw error", async () => {
  const adapter = new FakeUpdater();
  adapter.checkError = new Error("ENOTFOUND https://updates.example.test/?token=secret");
  const updater = service(adapter);
  updater.start();

  const state = await updater.checkForUpdates();
  assert.equal(state.status, "offline");
  assert.doesNotMatch(state.message, /secret|updates\.example/);
  updater.stop();
});

test("startup and background scheduling are bounded and never overlap checks", async () => {
  const adapter = new FakeUpdater();
  const scheduled: { current?: () => void } = {};
  let resolveCheck!: (value: UpdateCheckResultLike | null) => void;
  adapter.checkForUpdates = () => {
    adapter.checks += 1;
    return new Promise<UpdateCheckResultLike | null>((resolve) => {
      resolveCheck = resolve;
    });
  };
  const updater = service(adapter, {
    schedule: (callback) => {
      scheduled.current = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: () => {},
  });
  updater.start();
  const startupCheck = scheduled.current;
  if (!startupCheck) throw new Error("startup check was not scheduled");
  startupCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.checks, 1);
  const backgroundCheck = scheduled.current;
  if (!backgroundCheck) throw new Error("background check was not scheduled");
  backgroundCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.checks, 1);
  resolveCheck(null);
  await new Promise((resolve) => setImmediate(resolve));
  updater.stop();
});
