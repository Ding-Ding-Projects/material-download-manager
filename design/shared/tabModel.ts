import { evaluateRegex } from "./regex";

export interface TabRecord {
  id: string;
  label: string;
  title?: string;
  windowId: string;
  workspaceId: string;
  stripId: string;
  groupId: string | null;
  pinned: boolean;
  dirty: boolean;
}

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  tabIds: string[];
}

export interface TabState {
  tabs: TabRecord[];
  groups: TabGroup[];
  activeTabId: string | null;
  activeStripId: string;
  activeGroupId: string | null;
}

export type TabSearchScope = "strip" | "group" | "groups" | "master";

export interface TabSearchQuery {
  mode: "text" | "regex";
  pattern: string;
  flags: string;
}

export interface TabSearchResult {
  tab: TabRecord | null;
  group: TabGroup | null;
  location: Pick<TabRecord, "windowId" | "workspaceId" | "stripId"> | null;
  matchedText: string;
}

export interface BulkCloseResult {
  state: TabState;
  closedIds: string[];
  skippedPinnedIds: string[];
  skippedDirtyIds: string[];
}

export function defaultTabSearchQuery(): TabSearchQuery {
  return { mode: "text", pattern: "", flags: "g" };
}

function groupFor(state: TabState, tab: TabRecord): TabGroup | null {
  return tab.groupId ? state.groups.find((group) => group.id === tab.groupId) ?? null : null;
}

function queryMatches(query: TabSearchQuery, text: string): { matched: boolean; matchedText: string } {
  if (!query.pattern) return { matched: false, matchedText: "" };
  if (query.mode === "text") {
    const index = text.toLocaleLowerCase().indexOf(query.pattern.toLocaleLowerCase());
    return index >= 0 ? { matched: true, matchedText: text.slice(index, index + query.pattern.length) } : { matched: false, matchedText: "" };
  }
  const evaluated = evaluateRegex(query.pattern, query.flags, text);
  const match = evaluated.matches[0];
  return evaluated.error || !match ? { matched: false, matchedText: "" } : { matched: true, matchedText: match.text };
}

export function searchTabs(state: TabState, scope: TabSearchScope, query: TabSearchQuery): TabSearchResult[] {
  if (!query.pattern) return [];
  if (scope === "groups") {
    return state.groups.flatMap((group) => {
      const match = queryMatches(query, `${group.name} ${group.id}`);
      return match.matched
        ? [{ tab: null, group, location: null, matchedText: match.matchedText }]
        : [];
    });
  }

  return state.tabs.flatMap((tab) => {
    if (scope === "strip" && tab.stripId !== state.activeStripId) return [];
    if (scope === "group" && tab.groupId !== state.activeGroupId) return [];
    const match = queryMatches(query, `${tab.label} ${tab.title ?? ""}`);
    return match.matched
      ? [{ tab, group: groupFor(state, tab), location: tab, matchedText: match.matchedText }]
      : [];
  });
}

export function setTabPinned(state: TabState, tabId: string, pinned: boolean): TabState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, pinned } : tab)) };
}

export function reorderTab(state: TabState, tabId: string, targetIndex: number): TabState {
  const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (currentIndex < 0) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(currentIndex, 1);
  tabs.splice(Math.max(0, Math.min(targetIndex, tabs.length)), 0, tab);
  return { ...state, tabs };
}

export function createTabGroup(state: TabState, input?: Partial<Pick<TabGroup, "name" | "color">>): { state: TabState; group: TabGroup } {
  const group: TabGroup = {
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input?.name?.trim() || `Group ${state.groups.length + 1}`,
    color: input?.color || "#7c5cff",
    collapsed: false,
    tabIds: [],
  };
  return { state: { ...state, groups: [...state.groups, group] }, group };
}

export function moveTabToGroup(state: TabState, tabId: string, groupId: string | null): TabState {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) return state;
  const groups = state.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== tabId) }));
  if (groupId) {
    const target = groups.find((group) => group.id === groupId);
    if (!target) return state;
    target.tabIds.push(tabId);
  }
  return { ...state, tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, groupId } : item)), groups };
}

export function setGroupCollapsed(state: TabState, groupId: string, collapsed: boolean): TabState {
  return { ...state, groups: state.groups.map((group) => (group.id === groupId ? { ...group, collapsed } : group)) };
}

export function closeTabsBySearch(
  state: TabState,
  scope: TabSearchScope,
  query: TabSearchQuery,
  inverse: boolean,
  includePinned = false
): BulkCloseResult {
  const candidates = state.tabs.filter((tab) => (scope === "strip" ? tab.stripId === state.activeStripId : scope === "group" ? tab.groupId === state.activeGroupId : true));
  const matches = new Set(searchTabs(state, scope, query).flatMap((result) => (result.tab ? [result.tab.id] : [])));
  const closedIds: string[] = [];
  const skippedPinnedIds: string[] = [];
  const skippedDirtyIds: string[] = [];

  for (const tab of candidates) {
    const shouldClose = inverse ? !matches.has(tab.id) : matches.has(tab.id);
    if (!shouldClose) continue;
    if (tab.pinned && !includePinned) {
      skippedPinnedIds.push(tab.id);
      continue;
    }
    if (tab.dirty) {
      skippedDirtyIds.push(tab.id);
      continue;
    }
    closedIds.push(tab.id);
  }

  const remaining = state.tabs.filter((tab) => !closedIds.includes(tab.id));
  const groups = state.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => !closedIds.includes(id)) }));
  return {
    state: {
      ...state,
      tabs: remaining,
      groups,
      activeTabId: closedIds.includes(state.activeTabId ?? "") ? remaining[0]?.id ?? null : state.activeTabId,
    },
    closedIds,
    skippedPinnedIds,
    skippedDirtyIds,
  };
}
