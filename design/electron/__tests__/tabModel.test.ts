import test from "node:test";
import assert from "node:assert/strict";
import {
  closeTabsBySearch,
  moveTabToGroup,
  searchTabs,
  type TabState,
} from "../../shared/tabModel";

const state: TabState = {
  activeTabId: "one",
  activeStripId: "main",
  activeGroupId: "downloads",
  groups: [{ id: "downloads", name: "Downloads", color: "#7c5cff", collapsed: false, tabIds: ["one", "two"] }],
  tabs: [
    { id: "one", label: "Downloads", title: "All downloads", windowId: "w1", workspaceId: "p1", stripId: "main", groupId: "downloads", pinned: true, dirty: false },
    { id: "two", label: "Settings", title: "Preferences", windowId: "w1", workspaceId: "p1", stripId: "main", groupId: "downloads", pinned: false, dirty: false },
    { id: "three", label: "Docs", title: "Documentation", windowId: "w1", workspaceId: "p1", stripId: "other", groupId: null, pinned: false, dirty: true },
  ],
};

test("searches tabs by independent strip, group, and master scopes", () => {
  assert.deepEqual(searchTabs(state, "strip", { mode: "text", pattern: "down", flags: "g" }).map((result) => result.tab?.id), ["one"]);
  assert.deepEqual(searchTabs(state, "group", { mode: "text", pattern: "settings", flags: "g" }).map((result) => result.tab?.id), ["two"]);
  assert.deepEqual(searchTabs(state, "master", { mode: "regex", pattern: "^Docs", flags: "g" }).map((result) => result.tab?.id), ["three"]);
  assert.equal(searchTabs(state, "groups", { mode: "text", pattern: "download", flags: "g" })[0].group?.id, "downloads");
});

test("moving a tab keeps group membership bidirectional", () => {
  const withGroup = { ...state, groups: [...state.groups, { id: "other", name: "Other", color: "#fff", collapsed: true, tabIds: [] }] };
  const moved = moveTabToGroup(withGroup, "two", "other");
  assert.equal(moved.tabs.find((tab) => tab.id === "two")?.groupId, "other");
  assert.deepEqual(moved.groups.find((group) => group.id === "downloads")?.tabIds, ["one"]);
  assert.deepEqual(moved.groups.find((group) => group.id === "other")?.tabIds, ["two"]);
});

test("bulk close previews protected pinned and dirty tabs", () => {
  const result = closeTabsBySearch(state, "master", { mode: "text", pattern: "", flags: "g" }, true);
  assert.deepEqual(result.closedIds, ["two"]);
  assert.deepEqual(result.skippedPinnedIds, ["one"]);
  assert.deepEqual(result.skippedDirtyIds, ["three"]);
  assert.deepEqual(result.state.tabs.map((tab) => tab.id), ["one", "three"]);
});
