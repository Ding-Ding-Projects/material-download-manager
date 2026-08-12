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
  assert.match(sidebar, /const openQueues = useAppStore\(\(s\) => s\.openQueues\);/u);
  assert.match(sidebar, /label=\{copy\.queues\}[\s\S]{0,180}onSelect=\{openQueues\}/u);
  assert.match(sidebar, /\{children && \([\s\S]{0,220}className="sidebar-chevron-btn"/u);
  assert.doesNotMatch(sidebar, /finishedExpanded|unfinishedExpanded/u);
  assert.match(sidebar, /label=\{copy\.text\("Finished", "已完成"\)\}[\s\S]{0,220}expanded=\{false\}/u);
  assert.match(sidebar, /label=\{copy\.text\("Unfinished", "未完成"\)\}[\s\S]{0,220}expanded=\{false\}/u);
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

test("tab-strip add action opens the real download form instead of creating a duplicate fallback view", async () => {
  const tabs = await source("TabStrip.tsx");
  const addDialog = await source("AddDownloadDialog.tsx");
  const app = await readFile(path.resolve(__dirname, "../../../src/App.tsx"), "utf8");
  assert.match(tabs, /onAddDownload: \(\) => void/u);
  assert.match(tabs, /onClick=\{onAddDownload\}/u);
  assert.match(tabs, /aria-label=\{copy\.text\("Add download", "新增下載"\)\}/u);
  assert.doesNotMatch(tabs, /createTab\(/u);
  assert.match(app, /<TabStrip state=\{tabState\} onChange=\{setTabState\} onActivate=\{activateTab\} onAddDownload=\{openAddDownload\}/u);
  assert.match(addDialog, /typeof prefillUrl === "string" \? prefillUrl : ""/u);
});

test("download rows own keyboard actions and direct destructive wiring without capture-phase interception", async () => {
  const table = await source("DownloadTable.tsx");
  const bridge = await source("RendererAccessibilityBridge.tsx");
  const gate = await source("DestructiveActionGate.tsx");
  const app = await readFile(path.resolve(__dirname, "../../../src/App.tsx"), "utf8");
  assert.match(table, /data-download-row/u);
  assert.match(table, /data-download-id=\{item\.id\}/u);
  assert.match(table, /key !== "ContextMenu" && !\(event\.shiftKey && key === "F10"\)/u);
  assert.match(table, /className="row-actions-button"/u);
  assert.match(table, /ContextActionList/u);
  assert.match(table, /RegexBuilder/u);
  assert.match(table, /onRequestDestructiveAction: \(request: DestructiveActionRequest\) => void/u);
  assert.match(table, /onRequestDestructiveAction\(\{/u);
  assert.match(table, /returnFocusTarget: menu\.origin/u);
  assert.match(table, /returnFocusFallback: menu\.fallback/u);
  assert.match(table, /event\.target !== event\.currentTarget/u);
  assert.match(table, /closest\("\.table-scroll"\)\?\.querySelectorAll/u);
  assert.match(table, /closeMenu\(\{ restoreFocus: false \}\)/u);
  assert.match(table, /role="dialog"/u);
  assert.match(table, /menuItem=\{false\}/u);
  assert.doesNotMatch(table, /removeDownload\(/u);
  assert.doesNotMatch(bridge, /requestDestructiveAction\(/u);
  assert.doesNotMatch(bridge, /Remove from list/u);
  assert.doesNotMatch(bridge, /selectedIds/u);
  assert.match(bridge, /menu\.getAttribute\("role"\) === "dialog"/u);
  assert.match(bridge, /if \(menu\.getAttribute\("role"\) === "dialog"\) return/u);
  assert.match(app, /onRequestDestructiveAction=\{requestDestructiveAction\}/u);
  assert.match(app, /function requestDestructiveAction\(request: DestructiveActionRequest\)/u);
  assert.doesNotMatch(app, /DESTRUCTIVE_REQUEST_EVENT/u);
  assert.doesNotMatch(gate, /new CustomEvent\(/u);
  assert.match(gate, /returnFocusTarget\?: HTMLElement \| null/u);
  assert.match(gate, /returnFocusFallback\?: HTMLElement \| null/u);
  assert.match(gate, /authorizedRef\.current = true/u);
  assert.match(gate, /authorizedRef\.current \? fallback \?\? trigger : trigger \?\? fallback/u);
});

test("contextual dialog menus allow the local filter to consume Escape before they dismiss", async () => {
  const menu = await source("ContextMenu.tsx");
  assert.match(menu, /role\?: "menu" \| "dialog"/u);
  assert.match(menu, /if \(e\.key === "Escape" && !e\.defaultPrevented\) onClose\(\);/u);
  assert.match(menu, /window\.addEventListener\("keydown", handleKeyDown\);/u);
  assert.doesNotMatch(menu, /window\.addEventListener\("keydown", handleKeyDown, true\);/u);
  assert.match(menu, /new ResizeObserver\(reposition\)/u);
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
