import assert from "node:assert/strict";
import test from "node:test";
import { effectiveNarratorSettings, NarratorQueue, buildNarrationSegments, type NarratorSpeechAdapter, type SpeechSegment } from "../../shared/narration";

const settings = {
  enabled: true,
  language: "both" as const,
  quietMode: false,
  funnyLevelEnglish: 3 as const,
  funnyLevelCantonese: 4 as const,
  assistiveTechnologyActive: false,
};

function request(category: "download-completion" | "download-error" | "manual", suffix: string) {
  return {
    english: `Download ${suffix} completed.`,
    cantonese: `下載${suffix}：完成。`,
    category,
  } as const;
}

test("narrator queue serializes both languages and replaces stale pending events", async () => {
  const spoken: SpeechSegment[] = [];
  const callbacks: Array<(error?: unknown) => void> = [];
  const adapter: NarratorSpeechAdapter = {
    speak(segment, done) {
      spoken.push(segment);
      callbacks.push(done);
    },
    cancel() {},
  };
  const queue = new NarratorQueue(adapter, { debounceMs: 1, cooldownMs: 30 });
  queue.setSettings(settings);
  queue.enqueue(request("download-completion", "one"));
  queue.enqueue(request("download-completion", "two"));
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /Download two completed/);
  assert.equal(spoken[0].language, "en-US");
  callbacks.shift()!();
  assert.equal(spoken.length, 2, "Cantonese follows English instead of overlapping it");
  assert.equal(spoken[1].language, "yue-HK");
  callbacks.shift()!();
  assert.equal(queue.getState().active, false);

  queue.enqueue(request("download-completion", "three"));
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(spoken.length, 2, "event cooldown suppresses a repeated category");
  queue.enqueue({ ...request("manual", "manual"), priority: "user" });
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(spoken.length, 3, "user test bypasses event cooldown and starts without overlapping");
  callbacks.shift()!();
  assert.equal(spoken.length, 4, "the second language follows the user test in order");
  callbacks.shift()!();
});

test("narrator queue respects quiet, screen-reader, reduced-motion, and disabled boundaries", () => {
  const lateCallback: { done?: (error?: unknown) => void } = {};
  const adapter: NarratorSpeechAdapter = {
    speak: (_segment, done) => { lateCallback.done = done; },
    cancel() {},
  };
  const queue = new NarratorQueue(adapter, { debounceMs: 0 });
  const event = request("download-error", "bad");
  queue.setSettings({ ...settings, enabled: false });
  assert.equal(queue.enqueue(event).reason, "disabled");
  queue.setSettings({ ...settings, quietMode: true });
  assert.equal(queue.enqueue(event).reason, "quiet");
  queue.setSettings({ ...settings, quietMode: false });
  queue.setSettings({ ...settings, assistiveTechnologyActive: true });
  assert.equal(queue.enqueue(event).reason, "screen-reader", "the explicit persisted assistive-technology switch suppresses automatic events");
  queue.setSettings(settings);
  queue.setEnvironment({ screenReaderActive: true, reducedMotion: false });
  assert.equal(queue.enqueue(event).reason, "screen-reader");
  queue.setEnvironment({ screenReaderActive: false, reducedMotion: true });
  assert.equal(queue.enqueue(event).reason, "reduced-motion");
  assert.equal(queue.enqueue({ ...event, category: "manual", priority: "user" }).accepted, true);
  queue.cancel();
  lateCallback.done?.();
  assert.equal(queue.getState().active, false, "a late speech callback cannot resurrect a cancelled queue");
});

test("screen-reader and reduced-motion transitions purge debounced events", async () => {
  let calls = 0;
  const queue = new NarratorQueue({
    speak: () => { calls += 1; },
    cancel() {},
  }, { debounceMs: 8 });
  queue.setSettings(settings);
  queue.enqueue(request("download-error", "pending"));
  queue.setEnvironment({ screenReaderActive: true, reducedMotion: false });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls, 0);
  queue.setEnvironment({ screenReaderActive: false, reducedMotion: true });
  queue.enqueue(request("download-error", "reduced"));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls, 0);
  queue.cancel();
});

test("narrator styling keeps facts while independent language levels change the voice", () => {
  const segments = buildNarrationSegments({ ...request("manual", "facts") }, settings);
  assert.equal(segments.length, 2);
  assert.match(segments[0].text, /Download facts completed/);
  assert.match(segments[1].text, /下載facts：完成/);
  assert.match(segments[0].text, /narrator is keeping up/);
  assert.match(segments[1].text, /朗讀文員/);
});

test("late speech callback after cancellation cannot advance a new generation", async () => {
  const callbackHolder: { done?: (error?: unknown) => void } = {};
  let calls = 0;
  const queue = new NarratorQueue({
    speak: (_segment, callback) => { calls += 1; callbackHolder.done = callback; },
    cancel() {},
  }, { debounceMs: 0, cooldownMs: 0 });
  queue.setSettings({ ...settings, language: "english" });
  queue.enqueue(request("download-error", "late"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  queue.cancel();
  callbackHolder.done?.();
  queue.enqueue({ ...request("manual", "fresh"), priority: "user" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 2, "the cancelled callback did not pump an extra segment");
  queue.cancel();
});

test("School mode disables narration and speech errors remain non-blocking", async () => {
  const school = effectiveNarratorSettings({
    narratorEnabled: true,
    narratorLanguage: "both",
    narratorQuietMode: false,
    narratorAssistiveTechnologyActive: false,
    funnyLevelEnglish: 5,
    funnyLevelCantonese: 5,
    schoolModeEnabled: true,
  });
  assert.equal(school.enabled, false);
  assert.equal(school.language, "english");
  assert.equal(school.funnyLevelEnglish, 1);
  let errors = 0;
  const queue = new NarratorQueue({
    speak: (_segment, done) => done(new Error("voice unavailable")),
    cancel() {},
  }, { debounceMs: 0 });
  queue.setSettings({ ...settings, language: "english" });
  queue.enqueue({ ...request("manual", "error"), priority: "user", onError: () => { errors += 1; } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(errors, 1);
  assert.equal(queue.getState().active, false);
});

test("speech adapter sync throws and delayed errors remain recoverable", async () => {
  const errors: string[] = [];
  let calls = 0;
  const queue = new NarratorQueue({
    speak: (_segment, done) => {
      calls += 1;
      if (calls === 1) throw new Error("sync speech failure");
      setTimeout(() => done(new Error("async speech failure")), 2);
    },
    cancel() {},
  }, { debounceMs: 0, cooldownMs: 0 });
  queue.setSettings({ ...settings, language: "english" });
  queue.enqueue({ ...request("manual", "sync"), priority: "user", onError: (error) => errors.push(String(error)) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.getState().active, false);
  queue.enqueue({ ...request("download-error", "async"), priority: "user", onError: (error) => errors.push(String(error)) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.getState().active, false);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /sync speech failure/);
  assert.match(errors[1], /async speech failure/);
});
