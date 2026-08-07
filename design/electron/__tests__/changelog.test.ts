import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANGELOG_REPOSITORY_URL,
  ChangelogStore,
  createChangelogIpcHandlers,
  DEFAULT_CHANGELOG_ENTRIES,
  isChangelogView,
} from "../history/ChangelogStore";

const store = new ChangelogStore(DEFAULT_CHANGELOG_ENTRIES, CHANGELOG_REPOSITORY_URL);

test("embeds every published stable release with a full source commit", () => {
  assert.equal(DEFAULT_CHANGELOG_ENTRIES.length, 27);
  assert.equal(DEFAULT_CHANGELOG_ENTRIES[0].id, "v0.1.28");
  assert.equal(DEFAULT_CHANGELOG_ENTRIES.at(-1)?.id, "v0.1.2");
  const view = store.getView();
  assert.equal(view.totalEntries, 27);
  assert.equal(view.matchingEntries, 27);
  assert.ok(view.entries.every((entry) => entry.commitSha.length === 40));
  assert.ok(view.entries.every((entry) => entry.commitUrl === CHANGELOG_REPOSITORY_URL + "/commit/" + entry.commitSha));
  assert.ok(isChangelogView(view));
});

test("search and ISO date filters compose", () => {
  const view = store.getView({
    search: "Siu Mai",
    regex: false,
    flags: "",
    dateFrom: "2026-08-07",
    dateTo: "2026-08-07",
  });
  assert.equal(view.matchingEntries, 9);
  assert.ok(view.entries.every((entry) => entry.title.includes("Siu Mai")));

  const regexView = store.getView({ search: "\\bv0\\.1\\.(2|3)\\b", regex: true, flags: "i", dateFrom: null, dateTo: null });
  assert.deepEqual(regexView.entries.map((entry) => entry.version), ["0.1.3", "0.1.2"]);
});

test("invalid dates and patterns fail closed", () => {
  assert.throws(() => store.getView({ dateFrom: "2026-02-30" }), /Invalid changelog start date/);
  assert.throws(() => store.getView({ dateFrom: "2026-08-08", dateTo: "2026-08-07" }), /must not be after/);
  assert.throws(() => store.getView({ search: "(", regex: true, flags: "g" }), /regular expression/);
});

test("IPC adapter returns validated filtered views and exports without network access", () => {
  const handlers = createChangelogIpcHandlers(store);
  const view = handlers.getView({ search: "v0.1.26" });
  assert.equal(view.matchingEntries, 1);
  assert.equal(view.entries[0].commitSha, "17cb95cd363b6935b9e9f6343825de51df2524d1");
  const exported = handlers.exportView({ search: "v0.1.26" }, "markdown");
  assert.equal(exported.metadata.recordCount, 1);
  assert.match(exported.content, /17cb95cd363b6935b9e9f6343825de51df2524d1/);
  assert.match(exported.content, /https:\/\/github\.com\/Ding-Ding-Projects\/material-download-manager\/commit\//);
});
