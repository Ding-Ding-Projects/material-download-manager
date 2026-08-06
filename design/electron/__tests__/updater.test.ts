import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  isNewerVersion,
  normalizeReleaseNotesUrl,
  normalizeUpdateFeedUrl,
  readUpdateFeedUrl,
  UpdateService,
  type UpdateCheckResultLike,
  type UpdateInfoLike,
  type UpdaterAdapter,
} from "../updater/UpdateService";
import { isUpdateState } from "../../shared/types";

class FakeUpdater extends EventEmitter implements UpdaterAdapter {
  feedUrl: string | null = null;
  checks = 0;
  downloads = 0;
  installs = 0;
  nextCheck: UpdateCheckResultLike | null = null;
  checkError: Error | null = null;
  downloadError: Error | null = null;
  downloadPromise: Promise<unknown> | null = null;

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

  downloadUpdate() {
    this.downloads += 1;
    if (this.downloadError) return Promise.reject(this.downloadError);
    if (this.downloadPromise) return this.downloadPromise;
    this.emit("download-progress", { percent: 42 });
    this.emit("update-downloaded", {}, null, this.nextCheck?.updateInfo?.version);
    return Promise.resolve();
  }

  quitAndInstall() {
    this.installs += 1;
  }
}

class NativeSquirrelUpdater extends EventEmitter implements UpdaterAdapter {
  feedUrl: string | null = null;
  checks = 0;

  setFeedURL(options: { url: string }) {
    this.feedUrl = options.url;
  }

  checkForUpdates() {
    this.checks += 1;
    // Native Squirrel owns the download and supplies the version only when
    // its update-downloaded event arrives.
    this.emit("update-available");
  }

  quitAndInstall() {}
}

function service(adapter: UpdaterAdapter, options: Partial<ConstructorParameters<typeof UpdateService>[0]> = {}) {
  return new UpdateService({
    adapter,
    currentVersion: "1.0.0",
    isPackaged: true,
    feedUrl: "https://updates.example.test/material-download-manager/",
    releaseNotesBaseUrl: "https://updates.example.test/releases/",
    startupDelayMs: 0,
    backgroundIntervalMs: 60_000,
    checkTimeoutMs: 1_000,
    downloadTimeoutMs: 1_000,
    canInstall: () => true,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => {},
    ...options,
  });
}

async function tick() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("feed and release-note URLs require HTTPS and reject embedded credentials", () => {
  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/feed/"), "https://updates.example.test/feed/");
  assert.equal(normalizeUpdateFeedUrl("http://updates.example.test/feed/"), null);
  assert.equal(normalizeUpdateFeedUrl("https://user:secret@updates.example.test/feed/"), null);
  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/feed/?token=secret"), null);
  assert.equal(normalizeUpdateFeedUrl("https://updates.example.test/feed/#secret"), null);
  assert.equal(normalizeReleaseNotesUrl("https://updates.example.test/releases/1.1.0"), "https://updates.example.test/releases/1.1.0");
  assert.equal(normalizeReleaseNotesUrl("http://updates.example.test/releases/1.1.0"), null);
  assert.equal(normalizeReleaseNotesUrl("https://updates.example.test/releases/1.1.0?token=secret"), null);
  assert.equal(readUpdateFeedUrl({ MDM_UPDATE_FEED_URL: " https://updates.example.test/feed/ " }), "https://updates.example.test/feed/");
});

test("version comparison rejects equal, older, and malformed candidates", () => {
  assert.equal(isNewerVersion("1.1.0", "1.0.0"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0"), false);
  assert.equal(isNewerVersion("0.9.9", "1.0.0"), false);
  assert.equal(isNewerVersion("latest", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0-beta.2", "1.0.0-beta.10"), false);
});

test("packaged service stages a newer update, exposes exact release notes, and installs only explicitly", async () => {
  const adapter = new FakeUpdater();
  adapter.nextCheck = { updateInfo: { version: "1.1.0" } satisfies UpdateInfoLike };
  const states: string[] = [];
  const updater = service(adapter);
  updater.onStateChanged((state) => states.push(state.status));

  assert.equal(updater.start().status, "current");
  const result = await updater.checkForUpdates();
  await tick();

  assert.equal(adapter.feedUrl, "https://updates.example.test/material-download-manager/");
  assert.equal(adapter.checks, 1);
  assert.equal(adapter.downloads, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.version, "1.1.0");
  assert.equal(result.releaseNotesUrl, "https://updates.example.test/releases/tag/v1.1.0");
  assert.equal(isUpdateState(result), true);
  assert.equal(adapter.installs, 0);
  assert.equal(updater.quitAndInstall(), true);
  assert.equal(adapter.installs, 1);
  assert.deepEqual(states, ["available", "downloading", "ready"]);
  updater.stop();
});

test("older and equal update events are ignored without starting a download", async () => {
  for (const version of ["1.0.0", "0.9.9", "not-a-version"]) {
    const adapter = new FakeUpdater();
    adapter.nextCheck = { updateInfo: { version } };
    const updater = service(adapter);
    updater.start();
    const state = await updater.checkForUpdates();
    assert.equal(state.status, "current");
    assert.equal(adapter.downloads, 0);
    updater.stop();
  }
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

test("network failures become offline without exposing the raw error", async () => {
  const adapter = new FakeUpdater();
  adapter.checkError = new Error("ENOTFOUND https://updates.example.test/?token=secret");
  const updater = service(adapter);
  updater.start();

  const state = await updater.checkForUpdates();
  assert.equal(state.status, "offline");
  assert.doesNotMatch(state.message, /secret|updates\.example/);
  updater.stop();
});

test("check timeout keeps the adapter lease busy until its promise settles", async () => {
  const adapter = new FakeUpdater();
  let resolveCheck!: (value: UpdateCheckResultLike | null) => void;
  let blocked = true;
  adapter.checkForUpdates = () => {
    adapter.checks += 1;
    if (!blocked) {
      adapter.emit("update-not-available");
      return Promise.resolve(null);
    }
    return new Promise<UpdateCheckResultLike | null>((resolve) => {
      resolveCheck = resolve;
    });
  };
  const updater = service(adapter);
  updater.start();

  const state = await updater.checkForUpdates();
  assert.equal(state.status, "failed");
  assert.equal((await updater.checkForUpdates()).status, "failed");
  assert.equal(adapter.checks, 1);

  resolveCheck(null);
  blocked = false;
  await tick();
  assert.equal((await updater.checkForUpdates()).status, "current");
  assert.equal(adapter.checks, 2);
  updater.stop();
});

test("download timeout keeps the adapter lease busy and rejects a second download", async () => {
  const adapter = new FakeUpdater();
  let resolveDownload!: () => void;
  adapter.downloadPromise = new Promise<void>((resolve) => {
    resolveDownload = resolve;
  });
  adapter.nextCheck = { updateInfo: { version: "1.1.0" } };
  const updater = service(adapter);
  updater.start();

  await updater.checkForUpdates();
  await new Promise((resolve) => setTimeout(resolve, 1_050));
  assert.equal(updater.getState().status, "failed");
  assert.equal(adapter.downloads, 1);
  assert.equal((await updater.checkForUpdates()).status, "failed");
  assert.equal(adapter.checks, 1);

  resolveDownload();
  adapter.nextCheck = null;
  await tick();
  assert.equal((await updater.checkForUpdates()).status, "current");
  assert.equal(adapter.checks, 2);
  updater.stop();
});

test("a late updater error never overwrites ready", async () => {
  const adapter = new FakeUpdater();
  adapter.nextCheck = { updateInfo: { version: "1.1.0" } };
  const updater = service(adapter);
  updater.start();
  await updater.checkForUpdates();
  await tick();
  assert.equal(updater.getState().status, "ready");

  adapter.emit("error", new Error("late socket failure"));
  assert.equal(updater.getState().status, "ready");
  updater.stop();
});

test("native Squirrel waits for a verified downloaded version and blocks a second check", async () => {
  const adapter = new NativeSquirrelUpdater();
  const updater = service(adapter);
  updater.start();

  const downloading = await updater.checkForUpdates();
  assert.equal(downloading.status, "downloading");
  assert.equal(adapter.checks, 1);
  assert.equal((await updater.checkForUpdates()).status, "downloading");
  assert.equal(adapter.checks, 1);

  adapter.emit("update-downloaded", {}, null, "1.1.0");
  assert.equal(updater.getState().status, "ready");
  assert.equal(updater.getState().version, "1.1.0");
  adapter.emit("error", new Error("late native error"));
  assert.equal(updater.getState().status, "ready");
  updater.stop();
});

test("native Squirrel download timeout recovers for a later check without overlap", async () => {
  const adapter = new NativeSquirrelUpdater();
  const states: string[] = [];
  const updater = service(adapter, { downloadTimeoutMs: 1_000 });
  updater.onStateChanged((state) => states.push(state.status));
  updater.start();

  assert.equal((await updater.checkForUpdates()).status, "downloading");
  assert.equal(adapter.checks, 1);

  await new Promise((resolve) => setTimeout(resolve, 1_050));
  assert.equal(updater.getState().status, "offline");

  const recovered = await updater.checkForUpdates();
  assert.equal(recovered.status, "downloading");
  assert.equal(adapter.checks, 2);
  assert.deepEqual(states, ["available", "downloading", "offline", "available", "downloading"]);
  updater.stop();
});
