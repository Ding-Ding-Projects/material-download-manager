import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  isScheduledSettingsRecordActive,
  resolveScheduledSettings,
  selectScheduledSettingsRecords,
  validateScheduledSettingsRecord,
  validateScheduledSettingsRecords,
  type ScheduledSettingsRecord,
} from "../../shared/scheduledSettings";
import { DownloadManager } from "../download/DownloadManager";
import { StateStore } from "../download/persistence";
import { HistoryStore } from "../history/HistoryStore";

function localRecord(overrides: Partial<ScheduledSettingsRecord> = {}): ScheduledSettingsRecord {
  return {
    schemaVersion: 1,
    id: "schedule-1",
    label: "Work hours",
    enabled: true,
    priority: 1,
    startDate: null,
    endDate: null,
    startTime: "09:00",
    endTime: "17:00",
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    timezone: "UTC",
    source: { kind: "local", settings: { theme: "light" } },
    ...overrides,
  };
}

test("scheduled records validate bounded dates, times, weekdays, and secret-free source metadata", () => {
  const valid = validateScheduledSettingsRecord(localRecord());
  assert.equal(valid.source.kind, "local");
  assert.throws(() => validateScheduledSettingsRecord({ ...valid, startTime: "25:00" }), /time/i);
  assert.throws(() => validateScheduledSettingsRecord({ ...valid, weekdays: [] }), /weekday/i);
  assert.throws(() => validateScheduledSettingsRecord({ ...valid, source: { kind: "home-assistant", baseUrl: "https://ha.example", entityId: "input_boolean.work", settings: {}, accessToken: "secret" } }), /source/i);
  assert.throws(() => validateScheduledSettingsRecord({ ...valid, source: { kind: "api", url: "https://user:password@example.com/schedule" } }), /URL/i);
  assert.deepEqual(validateScheduledSettingsRecords([valid]), [valid]);
});

test("schedule matching honors timezone, inclusive boundaries, and cross-midnight weekdays", () => {
  const weekday = localRecord({ startTime: "09:00", endTime: "17:00" });
  assert.equal(isScheduledSettingsRecordActive(weekday, new Date("2026-08-10T09:00:00.000Z")), true);
  assert.equal(isScheduledSettingsRecordActive(weekday, new Date("2026-08-10T17:00:00.000Z")), true);
  assert.equal(isScheduledSettingsRecordActive(weekday, new Date("2026-08-10T17:01:00.000Z")), false);

  const overnight = localRecord({ startTime: "23:00", endTime: "01:00", weekdays: ["monday"] });
  assert.equal(isScheduledSettingsRecordActive(overnight, new Date("2026-08-10T23:30:00.000Z")), true);
  assert.equal(isScheduledSettingsRecordActive(overnight, new Date("2026-08-11T00:30:00.000Z")), true);
  assert.equal(isScheduledSettingsRecordActive(overnight, new Date("2026-08-11T02:00:00.000Z")), false);
});

test("schedule precedence is deterministic and applies only the winning local source", () => {
  const now = new Date("2026-08-10T10:00:00.000Z");
  const low = localRecord({ id: "schedule-low", priority: 1, source: { kind: "local", settings: { theme: "light", density: "compact" } } });
  const high = localRecord({ id: "schedule-high", priority: 9, source: { kind: "local", settings: { theme: "dark" } } });
  const ordered = selectScheduledSettingsRecords([low, high], now);
  assert.deepEqual(ordered.map((record) => record.id), ["schedule-high", "schedule-low"]);
  assert.deepEqual(resolveScheduledSettings({ theme: "system", density: "comfortable" }, [low, high], now), { theme: "dark", density: "compact" });
});

test("StateStore round-trips schedule records and malformed records fail safe to an empty list", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-scheduled-persistence-"));
  try {
    const store = new StateStore(root);
    const initial = await store.load("C:/Downloads/material");
    await store.save({ ...initial, scheduleRules: [localRecord()] });
    const loaded = await store.load("C:/Downloads/material");
    assert.equal(loaded.scheduleRules?.[0]?.id, "schedule-1");

    await fsp.writeFile(path.join(root, "state.json"), JSON.stringify({ settings: initial.settings, scheduleRules: [{ nope: true }] }), "utf8");
    const recovered = await store.load("C:/Downloads/material");
    assert.deepEqual(recovered.scheduleRules, []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("DownloadManager persists schedules, records a redacted history snapshot, and rejects unsafe external metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-scheduled-manager-"));
  const manager = new DownloadManager(root, () => {});
  try {
    await manager.init();
    const saved = await manager.setScheduleRules([localRecord()]);
    assert.equal(saved.length, 1);
    assert.equal(manager.getState().scheduleRules?.[0]?.label, "Work hours");
    const persisted = JSON.parse(await fsp.readFile(path.join(root, "state.json"), "utf8")) as { scheduleRules?: ScheduledSettingsRecord[] };
    assert.equal(persisted.scheduleRules?.[0]?.id, "schedule-1");
    const history = new HistoryStore(root);
    const snapshot = await history.readSnapshot();
    assert.match(snapshot ?? "", /scheduleRules/);
    assert.equal(snapshot?.includes("accessToken"), false);
    await assert.rejects(() => manager.setScheduleRules([localRecord({ source: { kind: "api", url: "http://10.0.0.1/schedule", allowLoopbackHttp: true } })]), /URL/i);
  } finally {
    await manager.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
