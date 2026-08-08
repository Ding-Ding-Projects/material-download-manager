import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { promisify } from "node:util";
import { HistoryStore } from "../history/HistoryStore";
import { normalizeHistoryFilter } from "../../shared/history";

const execFileAsync = promisify(execFile);

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
  const repeatedRestore = await history.restore(restored!.id);
  assert.ok(repeatedRestore);

  const revisions = await history.listRevisions();
  assert.equal(revisions.length, 4);
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

test("history regex worker errors remain errors for views and exports", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-regex-error-"));
  const failedEvaluator = async (_pattern: string, _flags: string, samples: readonly string[]) => samples.map((sample) => ({
    error: "Regular expression evaluation timed out.",
    matches: [],
    truncated: true,
    normalizedSample: sample,
  }));
  const history = new HistoryStore(root, failedEvaluator);
  await history.appendSnapshot("{\"value\":1}", "created", "Created a searchable record");
  const filter = { text: "created", regex: true, flags: "i" } as const;
  await assert.rejects(() => history.listRevisions(filter), /History regular expression evaluation failed:.*timed out/);
  await assert.rejects(() => history.exportRevisions("jsonl", filter), /History regular expression evaluation failed:.*timed out/);
});

test("history filter normalization bounds the renderer boundary", () => {
  assert.deepEqual(
    normalizeHistoryFilter({
      from: 100,
      to: 200,
      actions: ["updated", "updated"],
      text: "^updated",
      regex: true,
      flags: "gi",
    }),
    { from: 100, to: 200, actions: ["updated"], text: "^updated", regex: true, flags: "gi" },
  );
  assert.throws(() => normalizeHistoryFilter({ from: 200, to: 100 }), /must not be after/);
  assert.throws(() => normalizeHistoryFilter({ text: "(", regex: true, flags: "g" }), /regular expression/);
  assert.throws(() => normalizeHistoryFilter({ actions: ["not-real"] }), /history actions/);
});

test("local history isolates hooks and unrelated staged files", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-isolation-"));
  const history = new HistoryStore(root);
  await history.appendSnapshot("{\"value\":1}", "created", "Created the isolated record");

  const marker = path.join(root, "hook-ran.txt");
  const hookPath = path.join(history.repositoryPath, ".git", "hooks", "pre-commit");
  await fsp.writeFile(hookPath, `#!/bin/sh\nprintf invoked > "${marker.replace(/\\/g, "/")}"\n`, { encoding: "utf8", mode: 0o755 });
  await fsp.writeFile(path.join(history.repositoryPath, ".git", "hooks", "post-commit"), `#!/bin/sh\nprintf post > "${marker.replace(/\\/g, "/")}"\n`, { encoding: "utf8", mode: 0o755 });
  const unrelated = path.join(history.repositoryPath, "unrelated.txt");
  await fsp.writeFile(unrelated, "must not enter the snapshot history\n", "utf8");
  await execFileAsync("git", ["add", "--", "unrelated.txt"], { cwd: history.repositoryPath, windowsHide: true });

  await history.appendSnapshot("{\"value\":2}", "updated", "Updated without letting the hook run");
  const tree = (await execFileAsync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: history.repositoryPath, windowsHide: true })).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  assert.deepEqual(tree, ["snapshot.json"]);
  await assert.rejects(fsp.access(marker));
  assert.equal((await execFileAsync("git", ["status", "--short"], { cwd: history.repositoryPath, windowsHide: true })).stdout.trim(), "A  unrelated.txt");
});
