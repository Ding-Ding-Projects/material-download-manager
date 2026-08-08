import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CHANGELOG_IPC_CHANNELS, ChangelogStore, createChangelogIpcHandlers, isChangelogView } from "../history/ChangelogStore";
import { HistoryStore } from "../history/HistoryStore";
import { exportRecords, type ExportFormat } from "../../shared/export";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

test("local history serializes concurrent state writes and keeps the repository remote-free", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-concurrency-"));
  try {
    const history = new HistoryStore(root);
    const revisions = await Promise.all(
      Array.from({ length: 8 }, (_, index) => history.appendState(
        { items: [{ id: `item-${index}` }], settings: { uiFontSize: 10 + index } },
        "updated",
        `Updated record ${index}`,
      )),
    );
    assert.equal(revisions.filter(Boolean).length, 8);
    assert.equal((await history.listRevisions()).length, 8);
    const config = await fsp.readFile(path.join(root, "local-history", ".git", "config"), "utf8");
    assert.equal(/\[remote /i.test(config), false);
    assert.equal(await history.readSnapshot(revisions[7]!.id), JSON.stringify({
      items: [{ id: "item-7" }],
      settings: { uiFontSize: 17 },
    }, null, 2));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("restore, undo, and discard are append-only audit points", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-append-only-"));
  try {
    const history = new HistoryStore(root);
    const first = await history.appendSnapshot("{\"value\":1}", "created", "Created a record");
    const second = await history.appendSnapshot("{\"value\":2}", "updated", "Updated a record");
    const discarded = await history.discard("{\"value\":3}", "Discarded unsaved draft");
    const restored = await history.restore(first!.id);
    const undone = await history.undo(second!.id);

    assert.ok(first && second && discarded && restored && undone);
    assert.equal(await history.readSnapshot(discarded.id), "{\"value\":3}");
    assert.equal(await history.readSnapshot(restored.id), "{\"value\":1}");
    assert.equal(await history.readSnapshot(undone.id), "{\"value\":2}");
    assert.deepEqual((await history.listRevisions()).map((revision) => revision.action), [
      "undone",
      "restored",
      "discarded",
      "updated",
      "created",
    ]);
    assert.deepEqual(await history.actionCounts(), { undone: 1, restored: 1, discarded: 1, updated: 1, created: 1 });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("history rejects oversized snapshots and revision argument injection", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mdm-history-security-"));
  try {
    const history = new HistoryStore(root);
    await assert.rejects(
      history.appendSnapshot("x".repeat(8 * 1024 * 1024 + 1), "created", "Too large"),
      /exceeds/i,
    );
    await assert.rejects(history.readSnapshot("--output=/tmp/secret"), /Invalid history revision/i);
    await assert.rejects(history.restore("HEAD~1"), /Invalid history revision/i);
    await assert.rejects(history.diff("HEAD^"), /Invalid history revision/i);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("every export result carries encoding, schema, record count, and round-trip facts", () => {
  const formats: ExportFormat[] = [
    "json", "jsonl", "yaml", "toml", "xml", "csv", "tsv", "markdown", "html", "sql",
    "javascript", "typescript", "python", "go", "rust", "json-schema", "protobuf",
  ];
  for (const format of formats) {
    const result = exportRecords([{ id: 1, name: "A&B", nested: { ok: true } }], format);
    assert.equal(result.metadata.schema, "material-download-manager.export", format);
    assert.equal(result.metadata.schemaVersion, 1, format);
    assert.equal(result.metadata.format, format, format);
    assert.equal(result.metadata.encoding, "UTF-8", format);
    assert.equal(result.metadata.lineEnding, "LF", format);
    assert.equal(result.metadata.recordCount, 1, format);
    assert.deepEqual(result.roundTrip, result.metadata.roundTrip, format);
    assert.ok(result.content.length > 0, format);
  }
});

test("export warnings distinguish lossless JSON from lossy and schema-only formats", () => {
  const json = exportRecords([{ id: 1, nested: { ok: true } }], "json");
  assert.equal(json.roundTrip.lossless, true);
  assert.equal(json.roundTrip.canRoundTrip, true);
  assert.deepEqual(json.warnings, []);

  const csv = exportRecords([{ id: 1, nested: { ok: true } }], "csv");
  assert.equal(csv.roundTrip.lossless, false);
  assert.ok(csv.warnings.some((warning) => /not fully round-trip safe/i.test(warning)));
  assert.ok(csv.warnings.some((warning) => /JSON/i.test(warning)));

  const html = exportRecords([{ id: 1 }], "html");
  assert.equal(html.roundTrip.status, "lossy");
  assert.equal(html.roundTrip.canRoundTrip, false);
  assert.ok(html.warnings.some((warning) => /presentation-only/i.test(warning)));

  const schema = exportRecords([{ id: 1 }], "json-schema");
  assert.equal(schema.roundTrip.status, "not-a-data-export");
  assert.equal(schema.roundTrip.canRoundTrip, false);
  assert.ok(schema.warnings.some((warning) => /cannot round-trip/i.test(warning)));
});

test("language exports do not rewrite string values while converting booleans", () => {
  const python = exportRecords([{ text: "true false null", flag: true, empty: null }], "python");
  assert.match(python.content, /"true false null"/);
  assert.match(python.content, /"flag": True/);
  assert.match(python.content, /"empty": None/);
});

test("changelog view data validates commit links, filters entries, and stays IPC-serializable", async () => {
  assert.deepEqual(CHANGELOG_IPC_CHANNELS, {
    GET_VIEW: "changelog:getView",
    EXPORT_VIEW: "changelog:exportView",
  });
  const store = new ChangelogStore([
    {
      id: "v0.2.0-downloads",
      version: "0.2.0",
      releaseDate: "2026-08-06",
      title: "Download foundations",
      changes: [{ category: "Added", text: "Added bounded transfer history." }],
      commitSha: COMMIT_A,
    },
    {
      id: "v0.1.0-security",
      version: "0.1.0",
      releaseDate: "2026-08-01",
      title: "Security baseline",
      changes: [{ category: "Security", text: "Redacted credential-bearing URLs." }],
      commitSha: COMMIT_B,
    },
  ], "https://github.com/Ding-Ding-Projects/material-download-manager");
  const handlers = createChangelogIpcHandlers(store);
  const view = await handlers.getView({ search: "security", regex: false, flags: "" });
  assert.equal(view.totalEntries, 2);
  assert.equal(view.matchingEntries, 1);
  assert.equal(isChangelogView(view), true);
  assert.equal(view.entries[0].commitUrl, `https://github.com/Ding-Ding-Projects/material-download-manager/commit/${COMMIT_B}`);
  assert.equal(JSON.parse(JSON.stringify(view)).entries[0].commitSha, COMMIT_B);

  const dated = await handlers.getView({ dateFrom: "2026-08-05", dateTo: "2026-08-06" });
  assert.deepEqual(dated.entries.map((entry) => entry.id), ["v0.2.0-downloads"]);
  const exported = await handlers.exportView({ search: "bounded" }, "json");
  assert.equal(exported.metadata.recordCount, 1);
  assert.match(exported.content, new RegExp(COMMIT_A));
});

test("changelog rejects missing commit identity, unsafe repository URLs, and invalid regex requests", async () => {
  assert.throws(() => new ChangelogStore([{
    id: "missing-sha",
    version: "0.2.0",
    releaseDate: "2026-08-06",
    title: "Missing proof",
    changes: [{ category: "Changed", text: "No commit attached." }],
    commitSha: "not-a-sha",
  }], "https://github.com/Ding-Ding-Projects/material-download-manager"), /commit SHA/i);
  assert.throws(() => new ChangelogStore([], "https://github.com/owner/repo?token=secret"), /credential-free/i);
  const store = new ChangelogStore([], "https://github.com/owner/repo");
  await assert.rejects(() => store.getView({ search: "(", regex: true, flags: "g" }), /regular expression/i);
  await assert.rejects(() => store.getView({ dateFrom: "2026-02-30" }), /start date/i);
});
