import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { HistoryStore } from "../history/HistoryStore";

test("records append-only local Git revisions and restores as a new action", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-"));
  const history = new HistoryStore(root);
  const first = await history.appendSnapshot("{\"value\":1}", "created", "Created a record");
  const unchanged = await history.appendSnapshot("{\"value\":1}", "updated", "No actual change");
  const second = await history.appendSnapshot("{\"value\":2}", "updated", "Updated the record");

  assert.ok(first);
  assert.equal(unchanged, null);
  assert.ok(second);
  assert.equal(await history.readSnapshot(first!.id), "{\"value\":1}");

  const restored = await history.restore(first!.id);
  assert.ok(restored);
  assert.equal(restored?.action, "restored");
  assert.equal(await history.readSnapshot(), "{\"value\":1}");

  const revisions = await history.listRevisions();
  assert.equal(revisions.length, 3);
  assert.equal((await history.listRevisions({ actions: ["updated"] })).length, 1);
  assert.equal((await history.listRevisions({ text: "created" })).length, 1);
  assert.match(await history.diff(second!.id), /value/);
});

test("history filters support bounded local regex and export", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-filter-"));
  const history = new HistoryStore(root);
  await history.appendSnapshot("{\"value\":\"alpha\"}", "created", "Created alpha");
  await history.appendSnapshot("{\"value\":\"beta\"}", "updated", "Updated beta");
  assert.equal((await history.listRevisions({ text: "^updated", regex: true, flags: "i" })).length, 1);
  const exported = await history.exportRevisions("jsonl");
  assert.match(exported.content, /action/);
});
