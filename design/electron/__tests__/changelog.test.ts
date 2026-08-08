import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  CHANGELOG_REPOSITORY_URL,
  ChangelogStore,
  createChangelogIpcHandlers,
  DEFAULT_CHANGELOG_ENTRIES,
  isChangelogView,
} from "../history/ChangelogStore";

const store = new ChangelogStore(DEFAULT_CHANGELOG_ENTRIES, CHANGELOG_REPOSITORY_URL);

test("embeds every published stable release with a full source commit", async () => {
  assert.equal(DEFAULT_CHANGELOG_ENTRIES.length, 43);
  assert.equal(DEFAULT_CHANGELOG_ENTRIES[0].id, "v0.1.44");
  assert.equal(DEFAULT_CHANGELOG_ENTRIES.at(-1)?.id, "v0.1.2");
  const view = await store.getView();
  assert.equal(view.totalEntries, 43);
  assert.equal(view.matchingEntries, 43);
  assert.ok(view.entries.every((entry) => entry.commitSha.length === 40));
  assert.ok(view.entries.every((entry) => entry.commitUrl === CHANGELOG_REPOSITORY_URL + "/commit/" + entry.commitSha));
  const repositoryRoot = path.resolve(process.cwd(), "..");
  for (const entry of view.entries) {
    assert.doesNotThrow(
      () => execFileSync("git", ["cat-file", "-e", `${entry.commitSha}^{commit}`], { cwd: repositoryRoot, stdio: "ignore" }),
      `missing changelog commit ${entry.commitSha} for ${entry.id}`,
    );
  }
  assert.ok(isChangelogView(view));
});

test("search and ISO date filters compose", async () => {
  const view = await store.getView({
    search: "Siu Mai",
    regex: false,
    flags: "",
    dateFrom: "2026-08-07",
    dateTo: "2026-08-07",
  });
  assert.equal(view.matchingEntries, 9);
  assert.ok(view.entries.every((entry) => entry.title.includes("Siu Mai")));

  const regexView = await store.getView({ search: "\\bv0\\.1\\.(2|3)\\b", regex: true, flags: "i", dateFrom: null, dateTo: null });
  assert.deepEqual(regexView.entries.map((entry) => entry.version), ["0.1.3", "0.1.2"]);

  const caseSensitive = await store.getView({ search: "siu mai", regex: true, flags: "", dateFrom: null, dateTo: null });
  const caseInsensitive = await store.getView({ search: "siu mai", regex: true, flags: "i", dateFrom: null, dateTo: null });
  assert.equal(caseSensitive.matchingEntries, 0, "explicit empty flags must remain case-sensitive");
  assert.equal(caseInsensitive.matchingEntries, 9);
});

test("invalid dates and patterns fail closed", async () => {
  await assert.rejects(() => store.getView({ dateFrom: "2026-02-30" }), /Invalid changelog start date/);
  await assert.rejects(() => store.getView({ dateFrom: "2026-08-08", dateTo: "2026-08-07" }), /must not be after/);
  await assert.rejects(() => store.getView({ search: "(", regex: true, flags: "g" }), /regular expression/);
});

test("changelog regex worker errors remain errors for views and exports", async () => {
  const failedEvaluator = async (_pattern: string, _flags: string, samples: readonly string[]) => samples.map((sample) => ({
    error: "Regular expression evaluation timed out.",
    matches: [],
    truncated: true,
    normalizedSample: sample,
  }));
  const failedStore = new ChangelogStore(DEFAULT_CHANGELOG_ENTRIES, CHANGELOG_REPOSITORY_URL, failedEvaluator);
  const request = { search: "Siu Mai", regex: true, flags: "i", dateFrom: null, dateTo: null };
  await assert.rejects(() => failedStore.getView(request), /Changelog regular expression evaluation failed:.*timed out/);
  await assert.rejects(() => failedStore.exportView("markdown", request), /Changelog regular expression evaluation failed:.*timed out/);
});

test("IPC adapter returns validated filtered views and exports without network access", async () => {
  const handlers = createChangelogIpcHandlers(store);
  const view = await handlers.getView({ search: "v0.1.26" });
  assert.equal(view.matchingEntries, 1);
  assert.equal(view.entries[0].commitSha, "17cb95cd363b6935b9e9f6343825de51df2524d1");
  const exported = await handlers.exportView({ search: "v0.1.26" }, "markdown");
  assert.equal(exported.metadata.recordCount, 1);
  assert.match(exported.content, /17cb95cd363b6935b9e9f6343825de51df2524d1/);
  assert.match(exported.content, /https:\/\/github\.com\/Ding-Ding-Projects\/material-download-manager\/commit\//);
});
