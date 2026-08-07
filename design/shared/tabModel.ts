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

export const TAB_STATE_SCHEMA_VERSION = 1;

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

export function createDefaultTabState(): TabState {
  const groupId = "downloads-group";
  const tabs: TabRecord[] = [
    {
      id: "downloads",
      label: "Downloads",
      title: "All downloads",
      windowId: "main",
      workspaceId: "default",
      stripId: "main",
      groupId,
      pinned: true,
      dirty: false,
    },
    {
      id: "queues",
      label: "Queues",
      title: "Queue manager",
      windowId: "main",
      workspaceId: "default",
      stripId: "main",
      groupId,
      pinned: false,
      dirty: false,
    },
    {
      id: "settings",
      label: "Settings",
      title: "Application settings",
      windowId: "main",
      workspaceId: "default",
      stripId: "main",
      groupId,
      pinned: false,
      dirty: false,
    },
  ];
  return {
    tabs,
    groups: [{ id: groupId, name: "Downloads", color: "#7c5cff", collapsed: false, tabIds: tabs.map((tab) => tab.id) }],
    activeTabId: "downloads",
    activeStripId: "main",
    activeGroupId: groupId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string, maxLength = 160): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : fallback;
}

/**
 * Load renderer-owned tab state defensively. Tabs are convenience UI state,
 * so malformed local storage must fall back without affecting downloads or IPC.
 */
export function normalizeTabState(value: unknown): TabState {
  const fallback = createDefaultTabState();
  if (!isRecord(value) || !Array.isArray(value.tabs) || !Array.isArray(value.groups)) return fallback;

  const rawTabs = value.tabs.filter(isRecord);
  const ids = new Set<string>();
  const tabs = rawTabs.flatMap((raw, index): TabRecord[] => {
    const id = readString(raw.id, `tab-${index + 1}`, 96);
    if (ids.has(id)) return [];
    ids.add(id);
    const groupId = typeof raw.groupId === "string" ? raw.groupId : null;
    return [{
      id,
      label: readString(raw.label, id, 96),
      title: typeof raw.title === "string" ? raw.title.slice(0, 180) : undefined,
      windowId: readString(raw.windowId, "main", 96),
      workspaceId: readString(raw.workspaceId, "default", 96),
      stripId: readString(raw.stripId, "main", 96),
      groupId,
      pinned: raw.pinned === true,
      dirty: raw.dirty === true,
    }];
  });

  const groupIds = new Set<string>();
  const groups = value.groups.filter(isRecord).flatMap((raw, index): TabGroup[] => {
    const id = readString(raw.id, `group-${index + 1}`, 96);
    if (groupIds.has(id)) return [];
    groupIds.add(id);
    return [{
      id,
      name: readString(raw.name, `Group ${index + 1}`, 96),
      color: readString(raw.color, "#7c5cff", 32),
      collapsed: raw.collapsed === true,
      tabIds: [],
    }];
  });
  const validGroupIds = new Set(groups.map((group) => group.id));
  const normalizedTabs = tabs.map((tab) => ({
    ...tab,
    groupId: tab.groupId && validGroupIds.has(tab.groupId) ? tab.groupId : null,
  }));
  const normalizedGroups = groups.map((group) => ({
    ...group,
    tabIds: normalizedTabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id),
  }));
  const activeTabId = typeof value.activeTabId === "string" && normalizedTabs.some((tab) => tab.id === value.activeTabId)
    ? value.activeTabId
    : normalizedTabs[0]?.id ?? null;
  const activeGroupId = typeof value.activeGroupId === "string" && normalizedGroups.some((group) => group.id === value.activeGroupId)
    ? value.activeGroupId
    : normalizedTabs.find((tab) => tab.id === activeTabId)?.groupId ?? null;

  return {
    tabs: normalizedTabs,
    groups: normalizedGroups,
    activeTabId,
    activeStripId: readString(value.activeStripId, "main", 96),
    activeGroupId,
  };
}

export function setActiveTab(state: TabState, tabId: string): TabState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) return state;
  return { ...state, activeTabId: tab.id, activeStripId: tab.stripId, activeGroupId: tab.groupId };
}

export function renameTab(state: TabState, tabId: string, label: string, title?: string): TabState {
  const nextLabel = label.trim().slice(0, 96);
  if (!nextLabel) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, label: nextLabel, title: title?.trim().slice(0, 180) || tab.title } : tab),
  };
}

export function renameTabGroup(state: TabState, groupId: string, name: string): TabState {
  const nextName = name.trim().slice(0, 96);
  if (!nextName) return state;
  return { ...state, groups: state.groups.map((group) => group.id === groupId ? { ...group, name: nextName } : group) };
}

export function createTab(state: TabState, input?: Partial<Pick<TabRecord, "label" | "title" | "groupId" | "stripId">>): { state: TabState; tab: TabRecord } {
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const groupId = input?.groupId && state.groups.some((group) => group.id === input.groupId) ? input.groupId : state.activeGroupId;
  const tab: TabRecord = {
    id,
    label: input?.label?.trim().slice(0, 96) || `View ${state.tabs.length + 1}`,
    title: input?.title?.trim().slice(0, 180) || "Download view",
    windowId: "main",
    workspaceId: "default",
    stripId: input?.stripId || state.activeStripId,
    groupId,
    pinned: false,
    dirty: false,
  };
  return {
    tab,
    state: {
      ...state,
      tabs: [...state.tabs, tab],
      groups: state.groups.map((group) => group.id === groupId ? { ...group, tabIds: [...group.tabIds, tab.id] } : group),
      activeTabId: tab.id,
      activeGroupId: groupId,
    },
  };
}

export function closeTab(state: TabState, tabId: string): TabState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.dirty) return state;
  const remaining = state.tabs.filter((candidate) => candidate.id !== tabId);
  const nextActive = state.activeTabId === tabId ? remaining[Math.max(0, state.tabs.findIndex((candidate) => candidate.id === tabId) - 1)]?.id ?? remaining[0]?.id ?? null : state.activeTabId;
  return {
    ...state,
    tabs: remaining,
    groups: state.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== tabId) })),
    activeTabId: nextActive,
    activeGroupId: remaining.find((candidate) => candidate.id === nextActive)?.groupId ?? null,
  };
}

export function removeTabGroup(state: TabState, groupId: string): TabState {
  if (!state.groups.some((group) => group.id === groupId)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.groupId === groupId ? { ...tab, groupId: null } : tab),
    groups: state.groups.filter((group) => group.id !== groupId),
    activeGroupId: state.activeGroupId === groupId ? null : state.activeGroupId,
  };
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
