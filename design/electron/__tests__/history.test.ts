import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { promisify } from "node:util";
import { HistoryStore } from "../history/HistoryStore";
import { normalizeHistoryFilter, normalizeHistoryLabel, normalizeHistoryPruneRequest, normalizeHistoryRevisionId } from "../../shared/history";

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
  assert.equal(normalizeHistoryRevisionId("abcdef1"), "abcdef1");
  assert.equal(normalizeHistoryLabel("Useful state"), "Useful state");
  assert.equal(normalizeHistoryLabel("   "), null);
  assert.deepEqual(normalizeHistoryPruneRequest({ keep: 3 }), { keep: 3 });
  assert.throws(() => normalizeHistoryRevisionId("HEAD"), /revision id/);
  assert.throws(() => normalizeHistoryLabel(" bad"), /history label/);
  assert.throws(() => normalizeHistoryPruneRequest({ keep: 0 }), /retention/);
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

test("display-name mutations append a redacted hash record without the user name", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-display-name-history-"));
  try {
    const history = new HistoryStore(root);
    const privateName = "A private local title";
    const revision = await history.appendDisplayNameMutation(
      "Material Download Manager",
      privateName,
      "display-name-changed",
    );
    assert.equal(revision.action, "display-name-changed");
    const record = await fsp.readFile(path.join(root, "local-history", "display-name.json"), "utf8");
    assert.match(record, /"kind": "display-name"/);
    assert.match(record, /"previousSha256": "[0-9a-f]{64}"/);
    assert.match(record, /"nextSha256": "[0-9a-f]{64}"/);
    assert.equal(record.includes(privateName), false);
    assert.equal((await history.listRevisions()).length, 1);

    const reset = await history.appendDisplayNameMutation(privateName, "Material Download Manager", "display-name-reset");
    assert.equal(reset.action, "display-name-reset");
    assert.deepEqual((await history.listRevisions()).map((item) => item.action), ["display-name-reset", "display-name-changed"]);
    assert.deepEqual(
      (await execFileAsync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: history.repositoryPath, windowsHide: true })).stdout.trim().split(/\r?\n/),
      ["display-name.json"],
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("history labels are sidecar metadata and relabeling appends an audit revision", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-labels-"));
  try {
    const history = new HistoryStore(root);
    const first = await history.appendSnapshot("{\"value\":1}", "created", "Created one");
    const second = await history.appendSnapshot("{\"value\":2}", "updated", "Updated two");
    assert.ok(first);
    assert.ok(second);
    const labelRevision = await history.setLabel(first!.id, "Keep this one");
    assert.equal(labelRevision?.action, "labeled");
    const visible = await history.listRevisions();
    assert.equal(visible.find((revision) => revision.id === first!.id)?.label, "Keep this one");
    assert.ok(visible.some((revision) => revision.action === "labeled"));
    const labelsRecord = await fsp.readFile(path.join(root, "local-history", "labels.json"), "utf8");
    assert.match(labelsRecord, /Keep this one/);
    const clearRevision = await history.setLabel(first!.id, null);
    assert.equal(clearRevision?.action, "labeled");
    assert.equal((await history.listRevisions()).find((revision) => revision.id === first!.id)?.label, undefined);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("retention tombstones old state revisions without rewriting audit history", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-prune-"));
  try {
    const history = new HistoryStore(root);
    const revisions = [];
    for (let index = 0; index < 5; index += 1) {
      revisions.push(await history.appendSnapshot(JSON.stringify({ value: index }), index === 0 ? "created" : "updated", `State ${index}`));
    }
    assert.ok(revisions.every(Boolean));
    const labelAudit = await history.setLabel(revisions[0]!.id, "Old but useful");
    assert.ok(labelAudit);
    const displayNameAudit = await history.appendDisplayNameMutation("Material Download Manager", "A local title", "display-name-changed");
    assert.ok(displayNameAudit);
    const beforeCount = Number((await execFileAsync("git", ["rev-list", "--count", "HEAD"], { cwd: history.repositoryPath, windowsHide: true })).stdout.trim());
    const result = await history.prune(2);
    assert.equal(result.prunedRevisionIds.length, 3);
    assert.equal(result.auditRevision?.action, "pruned");
    const afterCount = Number((await execFileAsync("git", ["rev-list", "--count", "HEAD"], { cwd: history.repositoryPath, windowsHide: true })).stdout.trim());
    assert.equal(afterCount, beforeCount + 1);
    const visible = await history.listRevisions();
    assert.equal(visible.filter((revision) => revision.action === "created" || revision.action === "updated").length, 2);
    assert.ok(visible.some((revision) => revision.action === "labeled"));
    assert.ok(visible.some((revision) => revision.action === "pruned"));
    assert.ok(visible.some((revision) => revision.action === "display-name-changed"));
    const all = await history.listRevisions({}, { includePruned: true });
    for (const id of result.prunedRevisionIds) assert.ok(all.some((revision) => revision.id === id));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("revision diff redacts sensitive fields before renderer delivery", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-diff-redaction-"));
  try {
    const history = new HistoryStore(root);
    await history.appendSnapshot("{\"token\":\"not-secret-yet\",\"mysteryPath\":\"/Users/alice/My Documents/file.txt\",\"defaultSaveFolder\":\"C:\\\\Users\\\\cntow\\\\Downloads\\\\MaterialDownloadManager\",\"displayName\":\"Private display name\",\"url\":\"https://example.test/file\"}", "created", "Created safe state");
    const updated = await history.appendSnapshot("{\"mysteryToken\":\"new-secret-value\",\"mysteryPath\":\"/Users/alice/My Documents/next.txt\",\"token\":\"top-secret-value\",\"x-api-key\":\"header-secret\",\"defaultSaveFolder\":\"C:\\\\Users\\\\cntow\\\\Downloads\\\\MaterialDownloadManager\",\"displayName\":\"Private display name\",\"url\":\"https://user:password@example.test/file?token=top-secret-value\"}", "updated", "Updated state");
    assert.ok(updated);
    const diff = await history.getDiff(updated!.id);
    assert.equal(diff.redacted, true);
    assert.equal(diff.hasChanges, true);
    for (const secret of ["top-secret-value", "new-secret-value", "header-secret", "password@example.test", "/Users/alice", "Documents/next.txt"]) {
      assert.equal(diff.patch.includes(secret), false, `diff leaked ${secret}`);
    }
    assert.equal(diff.patch.includes("C:\\\\Users\\\\cntow"), false);
    assert.equal(diff.patch.includes("defaultSaveFolder\\\":\\\"C:\\\\Users"), false);
    assert.equal(diff.patch.includes("/Users/"), false);
    assert.equal(diff.patch.includes("Private display name"), false);
    assert.equal(diff.patch.includes("displayName\\\":\\\"Private"), false);
    assert.equal(diff.patch.includes("LOCAL_PATH_REDACTED"), true);
    assert.match(diff.patch, /redacted sensitive history field|\[REDACTED\]/i);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
