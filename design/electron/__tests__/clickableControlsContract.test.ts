import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(__dirname, "../../../src/components");

async function source(name: string): Promise<string> {
  return readFile(path.join(sourceRoot, name), "utf8");
}

test("sidebar owns one keyboard activation path and protects its chevron", async () => {
  const sidebar = await source("Sidebar.tsx");
  const bridge = await source("RendererAccessibilityBridge.tsx");
  assert.match(sidebar, /onKeyDown=\{\(event\) =>/u);
  assert.match(sidebar, /event\.key !== "Enter" && event\.key !== " "/u);
  assert.match(sidebar, /closest\("\.sidebar-chevron-btn"\)/u);
  assert.match(sidebar, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/u);
  assert.doesNotMatch(bridge, /sidebarItem\.click\(\)/u);
});

test("tab group search results are actionable and preserve persisted collapse state", async () => {
  const tabs = await source("TabStrip.tsx");
  assert.match(tabs, /onActivateGroup: \(groupId: string\) => void/u);
  assert.match(tabs, /onClick=\{\(\) => onActivateGroup\(result\.group!\.id\)\}/u);
  assert.match(tabs, /aria-label=\{copy\.text\(`Open group \$\{result\.group\.name\}`/u);
  assert.match(tabs, /temporarilyRevealedGroupId/u);
  assert.match(tabs, /group\.collapsed && group\.id !== temporarilyRevealedGroupId/u);
  assert.doesNotMatch(tabs, /candidate\.id === groupId \? \{ \.\.\.candidate, collapsed: false \}/u);
});

test("updater exposes honest available and downloading states", async () => {
  const updater = await source("UpdaterBanner.tsx");
  assert.match(updater, /state\.status === "available"/u);
  assert.match(updater, /Preparing update/u);
  assert.match(updater, /state\.status === "downloading"/u);
  assert.match(updater, /role="progressbar"/u);
  assert.match(updater, /Number\.isFinite\(state\.percent\)/u);
  assert.doesNotMatch(updater, /Checking for updates…[\s\S]{0,120}updater-progress/u);
});

test("toolbar menus have real actions, local search, regex builders, and keyboard semantics", async () => {
  const toolbar = await source("Toolbar.tsx");
  assert.match(toolbar, /role="menu"/u);
  assert.match(toolbar, /role="menuitem"/u);
  assert.match(toolbar, /toolbar-menu-search-input/u);
  assert.match(toolbar, /ToolbarMenu/u);
  assert.match(toolbar, /createDefaultRegexBuilderState/u);
  assert.match(toolbar, /RegexBuilder/u);
  assert.match(toolbar, /event\.key === "ArrowDown"/u);
  assert.match(toolbar, /event\.key === "Enter"/u);
  assert.match(toolbar, /onClose\(!\["add-url", "queues", "settings"\]/u);
  for (const actionId of ["add-url", "queues", "start-queue", "stop-queue", "stop-all", "progress", "settings", "check-updates"]) {
    assert.match(toolbar, new RegExp(`id: "${actionId}"`, "u"), `missing toolbar action ${actionId}`);
  }
  assert.match(toolbar, /action\.onSelect\(\)/u);
  assert.doesNotMatch(toolbar, /<u>\{/u);
});
