import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  closeTab,
  createTab,
  createTabGroup,
  defaultTabSearchQuery,
  moveTabToGroup,
  reorderTab,
  renameTabGroup,
  searchTabs,
  setActiveTab,
  setGroupCollapsed,
  setTabPinned,
  type TabGroup,
  type TabRecord,
  type TabSearchQuery,
  type TabSearchResult,
  type TabSearchScope,
  type TabState,
} from "@shared/tabModel";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "../i18n/ui";
import { useUiCopy } from "../i18n/useUiCopy";
import RegexBuilder from "./RegexBuilder";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import "../styles/tabs.css";

interface TabStripProps {
  state: TabState;
  onChange: (state: TabState) => void;
  onActivate: (tabId: string) => void;
}

type ContextMenuState = { tabId: string; x: number; y: number } | null;

const MAX_VISIBLE_TABS = 6;

function tabButtonId(tabId: string): string {
  return `app-tab-${tabId}`;
}

export default function TabStrip({ state, onChange, onActivate }: TabStripProps) {
  const settings = useAppStore((current) => current.settings);
  const copy = useUiCopy(settings);
  const [searchOpen, setSearchOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [groupPickerTabId, setGroupPickerTabId] = useState<string | null>(null);
  const [groupSearchQuery, setGroupSearchQuery] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const [newGroupName, setNewGroupName] = useState("");
  const [temporarilyRevealedGroupId, setTemporarilyRevealedGroupId] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<TabSearchScope, TabSearchQuery>>({
    strip: defaultTabSearchQuery(),
    group: defaultTabSearchQuery(),
    groups: defaultTabSearchQuery(),
    master: defaultTabSearchQuery(),
  });
  const stripRef = useRef<HTMLDivElement>(null);

  const collapsedGroupIds = useMemo(
    () => new Set(state.groups.filter((group) => group.collapsed && group.id !== temporarilyRevealedGroupId).map((group) => group.id)),
    [state.groups, temporarilyRevealedGroupId]
  );
  const pinnedTabs = useMemo(() => state.tabs.filter((tab) => tab.pinned), [state.tabs]);
  const ordinaryTabs = useMemo(
    () => state.tabs.filter((tab) => !tab.pinned && (!tab.groupId || !collapsedGroupIds.has(tab.groupId))),
    [collapsedGroupIds, state.tabs]
  );
  const visibleOrdinaryTabs = ordinaryTabs.slice(0, Math.max(0, MAX_VISIBLE_TABS - pinnedTabs.length));
  const overflowTabs = [...ordinaryTabs.slice(visibleOrdinaryTabs.length), ...state.tabs.filter((tab) => tab.groupId && collapsedGroupIds.has(tab.groupId))];
  const displayedTabs = [...pinnedTabs, ...visibleOrdinaryTabs];
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const contextTab = contextMenu
    ? state.tabs.find((candidate) => candidate.id === contextMenu.tabId) ?? null
    : null;

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (stripRef.current && event.target instanceof Node && !stripRef.current.contains(event.target)) {
        setContextMenu(null);
        setOverflowOpen(false);
        setGroupPickerTabId(null);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  function setQuery(scope: TabSearchScope, patch: Partial<TabSearchQuery>) {
    setQueries((current) => ({ ...current, [scope]: { ...current[scope], ...patch } }));
  }

  function focusTab(tabId: string) {
    window.requestAnimationFrame(() => document.getElementById(tabButtonId(tabId))?.focus());
  }

  function activate(tabId: string) {
    const targetGroupId = state.tabs.find((tab) => tab.id === tabId)?.groupId ?? null;
    const targetGroup = targetGroupId ? state.groups.find((group) => group.id === targetGroupId) : null;
    const shouldReveal = Boolean(targetGroup?.collapsed);
    setTemporarilyRevealedGroupId(shouldReveal ? targetGroupId : null);
    onChange(setActiveTab(state, tabId));
    onActivate(tabId);
    setOverflowOpen(false);
    if (tabId === "settings" || tabId === "queues") return;
    window.requestAnimationFrame(() => {
      (document.getElementById(tabButtonId(tabId))
        ?? (targetGroupId ? document.getElementById(`tab-group-toggle-${targetGroupId}`) : null))?.focus();
    });
  }

  function activateGroup(groupId: string) {
    const group = state.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setTemporarilyRevealedGroupId(group.collapsed ? groupId : null);
    const revealedState: TabState = { ...state, activeGroupId: groupId };
    const firstTab = state.tabs.find((tab) => tab.groupId === groupId);
    if (firstTab) {
      onChange(setActiveTab(revealedState, firstTab.id));
      onActivate(firstTab.id);
      if (firstTab.id === "settings" || firstTab.id === "queues") {
        return;
      }
      window.requestAnimationFrame(() => {
        const target = document.getElementById(tabButtonId(firstTab.id));
        (target ?? document.getElementById(`tab-group-toggle-${groupId}`))?.focus();
      });
    } else {
      onChange(revealedState);
      window.requestAnimationFrame(() => document.getElementById(`tab-group-toggle-${groupId}`)?.focus());
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tabId: string) {
    const tabs = state.tabs.filter((tab) => !tab.groupId || !collapsedGroupIds.has(tab.groupId));
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    activate(next.id);
  }

  function openContextMenu(event: React.MouseEvent, tab: TabRecord) {
    event.preventDefault();
    setOverflowOpen(false);
    setGroupPickerTabId(null);
    setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
  }

  function updateTab(tabId: string, action: (current: TabState) => TabState) {
    onChange(action(state));
    setContextMenu(null);
  }

  function moveTab(tab: TabRecord, direction: -1 | 1) {
    const samePinned = state.tabs.filter((candidate) => candidate.pinned === tab.pinned);
    const currentIndex = samePinned.findIndex((candidate) => candidate.id === tab.id);
    const target = samePinned[currentIndex + direction];
    if (!target) return;
    const targetIndex = state.tabs.findIndex((candidate) => candidate.id === target.id);
    updateTab(tab.id, (current) => reorderTab(current, tab.id, targetIndex));
    focusTab(tab.id);
  }

  function createGroup() {
    const result = createTabGroup(state, { name: newGroupName || undefined });
    onChange(result.state);
    setNewGroupName("");
    setGroupPickerTabId(null);
  }

  function addTab() {
    const result = createTab(state);
    onChange(result.state);
    onActivate(result.tab.id);
    focusTab(result.tab.id);
  }

  function moveIntoGroup(groupId: string | null) {
    if (!groupPickerTabId) return;
    onChange(moveTabToGroup(state, groupPickerTabId, groupId));
    setGroupPickerTabId(null);
    setGroupSearchQuery(createDefaultRegexBuilderState());
  }

  const groupsById = useMemo(() => new Map(state.groups.map((group) => [group.id, group])), [state.groups]);
  const groupedTabs = useMemo(() => {
    const grouped = new Map<string, TabRecord[]>();
    for (const tab of visibleOrdinaryTabs) {
      if (!tab.groupId || !groupsById.has(tab.groupId)) continue;
      grouped.set(tab.groupId, [...(grouped.get(tab.groupId) ?? []), tab]);
    }
    return grouped;
  }, [groupsById, visibleOrdinaryTabs]);
  const ungroupedTabs = visibleOrdinaryTabs.filter((tab) => !tab.groupId || !groupsById.has(tab.groupId));
  const groupFilterSamples = useMemo(() => state.groups.map((group) => `${group.name} ${group.tabIds.length}`), [state.groups]);

  return (
    <div className="tab-strip-shell" ref={stripRef}>
      <div
        className="tab-strip"
        role="tablist"
        aria-orientation="horizontal"
        aria-label={copy.text("Open tabs", "開啟中嘅分頁")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setContextMenu(null);
            setOverflowOpen(false);
            setGroupPickerTabId(null);
          }
        }}
      >
        <div className="tab-strip-pinned" aria-label={copy.text("Pinned tabs", "已釘選分頁")}>
          {pinnedTabs.map((tab) => <TabButton key={tab.id} tab={tab} state={state} onActivate={activate} onKeyDown={handleTabKeyDown} onContextMenu={openContextMenu} />)}
        </div>
        {state.groups.map((group) => {
          const groupExpanded = !group.collapsed || temporarilyRevealedGroupId === group.id;
          return <div className="tab-group" key={group.id} data-collapsed={group.collapsed && temporarilyRevealedGroupId !== group.id ? "true" : "false"}>
            <div className="tab-group-header">
              <button
                  type="button"
                  className="tab-group-toggle"
                  id={`tab-group-toggle-${group.id}`}
                  aria-expanded={groupExpanded}
                  aria-controls={`tab-group-${group.id}`}
                  onClick={() => {
                    setTemporarilyRevealedGroupId(null);
                    onChange(setGroupCollapsed(state, group.id, groupExpanded));
                  }}
                >
                  <span className="tab-group-color" style={{ backgroundColor: group.color }} aria-hidden="true" />
                  <span>{group.name}</span>
                  <small>{group.tabIds.length}</small>
              </button>
              <button
                type="button"
                className="tab-group-action"
                aria-label={copy.text(`Rename ${group.name}`, `重新命名 ${group.name}`)}
                title={copy.text("Rename group", "重新命名群組")}
                onClick={() => {
                  const nextName = window.prompt(copy.groupName, group.name);
                  if (nextName) onChange(renameTabGroup(state, group.id, nextName));
                }}
              >
                ✎
              </button>
            </div>
            <div className="tab-group-tabs" id={`tab-group-${group.id}`}>
              {(groupedTabs.get(group.id) ?? []).map((tab) => <TabButton key={tab.id} tab={tab} state={state} onActivate={activate} onKeyDown={handleTabKeyDown} onContextMenu={openContextMenu} />)}
            </div>
          </div>
        })}
        {ungroupedTabs.length > 0 && (
          <div className="tab-group tab-group-ungrouped">
            <div className="tab-group-tabs" aria-label={copy.text("Ungrouped tabs", "未分組分頁")}>
              {ungroupedTabs.map((tab) => <TabButton key={tab.id} tab={tab} state={state} onActivate={activate} onKeyDown={handleTabKeyDown} onContextMenu={openContextMenu} />)}
            </div>
          </div>
        )}
        {overflowTabs.length > 0 && (
          <div className="tab-overflow-anchor">
            <button type="button" className={`tab-search-toggle${overflowOpen ? " active" : ""}`} aria-expanded={overflowOpen} onClick={() => setOverflowOpen((open) => !open)}>
              {copy.moreTabs} ({overflowTabs.length})
            </button>
            {overflowOpen && (
              <div className="tab-overflow-menu" role="menu" aria-label={copy.moreTabs}>
                {overflowTabs.map((tab) => (
                  <button type="button" role="menuitem" key={tab.id} onClick={() => activate(tab.id)}>
                    <strong>{tab.label}</strong>
                    <small>{groupsById.get(tab.groupId ?? "")?.name ?? copy.text("Ungrouped", "未分組")}{tab.pinned ? ` · ${copy.text("Pinned", "已釘選")}` : ""}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className={`tab-search-toggle${searchOpen ? " active" : ""}`} onClick={() => setSearchOpen((open) => !open)} aria-expanded={searchOpen}>
          {copy.tabSearch}
        </button>
        <button type="button" className="tab-search-toggle" onClick={() => setGroupPickerTabId("__new__")}>
          {copy.newGroup}
        </button>
        <button type="button" className="tab-search-toggle tab-new-button" onClick={addTab} aria-label={copy.text("New tab", "新分頁")} title={copy.text("New tab", "新分頁")}>+</button>
      </div>

      {contextMenu && contextTab && (
        <TabContextMenu
          key={contextMenu.tabId}
          state={state}
          tab={contextTab}
          copy={copy}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPin={() => updateTab(contextMenu.tabId, (current) => setTabPinned(current, contextMenu.tabId, !state.tabs.find((tab) => tab.id === contextMenu.tabId)?.pinned))}
          onMove={(direction) => {
            const tab = state.tabs.find((candidate) => candidate.id === contextMenu.tabId);
            if (tab) moveTab(tab, direction);
          }}
          onMoveIntoGroup={() => {
            setGroupPickerTabId(contextMenu.tabId);
            setContextMenu(null);
          }}
          onCloseTab={() => updateTab(contextMenu.tabId, (current) => closeTab(current, contextMenu.tabId))}
        />
      )}

      {groupPickerTabId && (
        <div className="tab-group-picker" role="dialog" aria-label={copy.moveIntoGroup}>
          <div className="tab-group-picker-header">
            <strong>{groupPickerTabId === "__new__" ? copy.newGroup : copy.moveIntoGroup}</strong>
            <button type="button" className="notification-dismiss" onClick={() => setGroupPickerTabId(null)} aria-label={copy.close}>×</button>
          </div>
          <RegexFilterControl
            label={copy.text("Search groups", "搜尋群組")}
            query={groupSearchQuery}
            onQuery={setGroupSearchQuery}
            samples={groupFilterSamples}
            copy={copy}
            autoFocus
          >
            {({ matchIndexes, pending, error }) => groupPickerTabId === "__new__" ? (
              <div className="tab-group-create">
                <input className="input" value={newGroupName} placeholder={copy.groupName} aria-label={copy.groupName} onChange={(event) => setNewGroupName(event.target.value)} />
                <button type="button" className="btn btn-primary btn-sm" onClick={createGroup}>{copy.text("Create", "建立")}</button>
              </div>
            ) : (
              <div className="tab-group-picker-list" role="listbox" aria-label={copy.text("Available tab groups", "可用分頁群組")}>
                {!pending && !error && state.groups.map((group, index) => matchIndexes.has(index) ? (
                  <button type="button" role="option" key={group.id} onClick={() => moveIntoGroup(group.id)}>
                    <span className="tab-group-color" style={{ backgroundColor: group.color }} aria-hidden="true" />
                    <span>{group.name}</span>
                    <small>{group.tabIds.length}</small>
                  </button>
                ) : null)}
                {!pending && !error && groupSearchQuery.pattern && matchIndexes.size === 0 && (
                  <span className="tab-context-empty" role="status">{copy.text("No matching groups.", "搵唔到相符群組。")}</span>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroupPickerTabId("__new__")}>{copy.newGroup}</button>
              </div>
            )}
          </RegexFilterControl>
        </div>
      )}

      {searchOpen && (
        <div className="tab-search-panel" aria-label={copy.text("Tab discovery searches", "分頁探索搜尋")}>
          {([
            { scope: "strip" as const, label: copy.text("Current tab strip", "目前分頁列") },
            { scope: "group" as const, label: copy.text("Current tab group", "目前分頁群組") },
            { scope: "groups" as const, label: copy.text("Tab groups", "分頁群組") },
            { scope: "master" as const, label: copy.text("All tabs", "全部分頁") },
          ]).map(({ scope, label }) => (
          <TabSearchControl key={scope} label={label} scope={scope} query={queries[scope]} state={state} onQuery={(patch) => setQuery(scope, patch)} onActivate={activate} onActivateGroup={activateGroup} copy={copy} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  tab,
  state,
  onActivate,
  onKeyDown,
  onContextMenu,
}: {
  tab: TabRecord;
  state: TabState;
  onActivate: (tabId: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, tabId: string) => void;
  onContextMenu: (event: React.MouseEvent, tab: TabRecord) => void;
}) {
  const active = tab.id === state.activeTabId;
  return (
    <button
      id={tabButtonId(tab.id)}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`tabpanel-${tab.id}`}
      tabIndex={active ? 0 : -1}
      className={`app-tab${tab.pinned ? " pinned" : ""}${active ? " active" : ""}`}
      title={tab.title || tab.label}
      onClick={() => onActivate(tab.id)}
      onKeyDown={(event) => onKeyDown(event, tab.id)}
      onContextMenu={(event) => onContextMenu(event, tab)}
    >
      <span className="app-tab-label">{tab.label}</span>
      {tab.dirty && <span className="app-tab-dirty" title="Unsaved work" aria-label="Unsaved work">●</span>}
    </button>
  );
}

function TabContextMenu({
  state,
  tab,
  copy,
  x,
  y,
  onClose,
  onPin,
  onMove,
  onMoveIntoGroup,
  onCloseTab,
}: {
  state: TabState;
  tab: TabRecord;
  copy: ReturnType<typeof getUiCopy>;
  x: number;
  y: number;
  onClose: () => void;
  onPin: () => void;
  onMove: (direction: -1 | 1) => void;
  onMoveIntoGroup: () => void;
  onCloseTab: () => void;
}) {
  const [query, setQuery] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const items = useMemo(() => [
    { id: "pin", label: tab.pinned ? copy.text("Unpin tab", "取消釘選分頁") : copy.text("Pin tab", "釘選分頁"), action: onPin },
    { id: "left", label: copy.text("Move tab left", "分頁向左移"), action: () => onMove(-1) },
    { id: "right", label: copy.text("Move tab right", "分頁向右移"), action: () => onMove(1) },
    { id: "group", label: copy.moveIntoGroup, action: onMoveIntoGroup },
    { id: "close", label: copy.text("Close tab", "關閉分頁"), action: onCloseTab },
  ], [copy, onCloseTab, onMove, onMoveIntoGroup, onPin, tab.pinned]);
  const samples = useMemo(() => items.map((item) => item.label), [items]);
  return (
    <div
      className="tab-context-menu"
      role="menu"
      aria-label={copy.text("Tab actions", "分頁操作")}
      style={{ left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <RegexFilterControl
        label={copy.text("Search tab actions", "搜尋分頁操作")}
        query={query}
        onQuery={setQuery}
        samples={samples}
        copy={copy}
        autoFocus
      >
        {({ matchIndexes, pending, error }) => (
          <div className="tab-context-items">
            {!pending && !error && items.map((item, index) => matchIndexes.has(index) ? (
              <button type="button" role="menuitem" key={item.id} onClick={item.action}>{item.label}</button>
            ) : null)}
            {!pending && !error && query.pattern && matchIndexes.size === 0 && (
              <span className="tab-context-empty" role="status">{copy.text("No matching actions.", "搵唔到相符操作。")}</span>
            )}
          </div>
        )}
      </RegexFilterControl>
      <small>{state.groups.find((group) => group.id === tab.groupId)?.name ?? copy.text("Ungrouped", "未分組")}</small>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{copy.close}</button>
    </div>
  );
}

interface RegexFilterResult {
  matchIndexes: ReadonlySet<number>;
  pending: boolean;
  error: string | null;
}

function RegexFilterControl({
  label,
  query,
  onQuery,
  samples,
  copy,
  autoFocus = false,
  children,
}: {
  label: string;
  query: RegexBuilderState;
  onQuery: (query: RegexBuilderState) => void;
  samples: readonly string[];
  copy: ReturnType<typeof getUiCopy>;
  autoFocus?: boolean;
  children: (result: RegexFilterResult) => React.ReactNode;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSample, setBuilderSample] = useState<string | null>(null);
  const builderId = useId();
  const builderButtonRef = useRef<HTMLButtonElement>(null);
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    samples,
    query.mode === "regex" && query.pattern.length > 0,
  );
  const error = query.mode === "regex" && !regexBatch.pending && regexBatch.error
    ? localizedRegexEvaluationError(regexBatch.error, copy.text)
    : null;
  const matchIndexes = useMemo(() => {
    if (!query.pattern) return new Set(samples.map((_, index) => index));
    if (query.mode === "text") {
      const needle = query.pattern.toLocaleLowerCase();
      return new Set(samples.flatMap((sample, index) => sample.toLocaleLowerCase().includes(needle) ? [index] : []));
    }
    if (!regexBatch.evaluations) return new Set<number>();
    return new Set(regexBatch.evaluations.flatMap((evaluation, index) => !evaluation.error && evaluation.matches.length > 0 ? [index] : []));
  }, [query.mode, query.pattern, regexBatch.evaluations, samples]);
  const builderValue: RegexBuilderState = {
    mode: query.mode,
    pattern: query.pattern,
    flags: query.flags,
    sample: builderSample ?? samples.join("\n"),
  };

  function closeBuilder() {
    setBuilderOpen(false);
    window.requestAnimationFrame(() => builderButtonRef.current?.focus({ preventScroll: true }));
  }

  return (
    <div
      className="tab-filter-control"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !builderOpen) return;
        event.preventDefault();
        event.stopPropagation();
        closeBuilder();
      }}
    >
      <div className="tab-search-input-row">
        <input
          className="input"
          type="search"
          autoFocus={autoFocus}
          value={query.pattern}
          placeholder={label}
          aria-label={label}
          aria-busy={regexBatch.pending || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${builderId}-error` : regexBatch.pending ? `${builderId}-pending` : undefined}
          onChange={(event) => onQuery({ ...query, pattern: event.target.value })}
        />
        <button
          ref={builderButtonRef}
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => builderOpen ? closeBuilder() : setBuilderOpen(true)}
          aria-expanded={builderOpen}
          aria-controls={builderId}
          aria-label={`${label} ${copy.text("regex builder", "正則建立器")}`}
        >
          {copy.text("Regex", "正則")}
        </button>
      </div>
      {builderOpen && (
        <div id={builderId}>
          <RegexBuilder
            value={builderValue}
            onChange={(next) => {
              if (next.sample !== builderValue.sample) setBuilderSample(next.sample);
              onQuery({ ...query, mode: next.mode, pattern: next.pattern, flags: next.flags });
            }}
            title={`${label} ${copy.text("regex builder", "正則建立器")}`}
            text={copy.text}
          />
        </div>
      )}
      {error && <p id={`${builderId}-error`} className="field-error" role="alert">{error}</p>}
      {!error && regexBatch.pending && <p id={`${builderId}-pending`} className="setting-helper" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>}
      {children({ matchIndexes, pending: regexBatch.pending, error })}
    </div>
  );
}

function TabSearchControl({
  label,
  scope,
  query,
  state,
  onQuery,
  onActivate,
  onActivateGroup,
  copy,
}: {
  label: string;
  scope: TabSearchScope;
  query: TabSearchQuery;
  state: TabState;
  onQuery: (patch: Partial<TabSearchQuery>) => void;
  onActivate: (tabId: string) => void;
  onActivateGroup: (groupId: string) => void;
  copy: ReturnType<typeof getUiCopy>;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSample, setBuilderSample] = useState<string | null>(null);
  const builderId = useId();
  const builderButtonRef = useRef<HTMLButtonElement>(null);
  const regexCandidates = useMemo<Array<{ tab: TabRecord | null; group: TabGroup | null; text: string }>>(() => {
    if (scope === "groups") {
      return state.groups.map((group) => ({ tab: null, group, text: `${group.name} ${group.id}` }));
    }
    return state.tabs
      .filter((tab) => scope !== "strip" || tab.stripId === state.activeStripId)
      .filter((tab) => scope !== "group" || tab.groupId === state.activeGroupId)
      .map((tab) => ({
        tab,
        group: tab.groupId ? state.groups.find((group) => group.id === tab.groupId) ?? null : null,
        text: `${tab.label} ${tab.title ?? ""}`,
      }));
  }, [scope, state]);
  const regexSamples = useMemo(() => regexCandidates.map((candidate) => candidate.text), [regexCandidates]);
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    regexSamples,
    query.mode === "regex" && query.pattern.length > 0,
  );
  const queryError = query.mode === "regex" && !regexBatch.pending && regexBatch.error
    ? localizedRegexEvaluationError(regexBatch.error, copy.text)
    : null;
  const results = useMemo<TabSearchResult[]>(() => {
    if (query.mode !== "regex") return searchTabs(state, scope, query);
    if (!query.pattern || !regexBatch.evaluations) return [];
    return regexCandidates.flatMap((candidate, index) => {
      const match = regexBatch.evaluations?.[index]?.matches[0];
      if (!match) return [];
      return [{
        tab: candidate.tab,
        group: candidate.group,
        location: candidate.tab,
        matchedText: match.text,
      }];
    });
  }, [query, regexBatch.evaluations, regexCandidates, scope, state]);
  const defaultBuilderSample = regexSamples.join("\n");
  const builderValue: RegexBuilderState = {
    mode: query.mode,
    pattern: query.pattern,
    flags: query.flags,
    sample: builderSample ?? defaultBuilderSample,
  };

  function closeBuilder() {
    setBuilderOpen(false);
    window.requestAnimationFrame(() => builderButtonRef.current?.focus({ preventScroll: true }));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !builderOpen) return;
    event.preventDefault();
    event.stopPropagation();
    closeBuilder();
  }

  return (
    <div className="tab-search-control" onKeyDown={handleKeyDown}>
      <div>
        <span className="tab-search-label">{label}</span>
        <div className="tab-search-input-row">
          <input
            className="input"
            type="search"
            value={query.pattern}
            placeholder={copy.text("Search visible tab labels", "搜尋分頁標籤")}
            onChange={(event) => onQuery({ pattern: event.target.value })}
            aria-label={`${label} search`}
            aria-busy={regexBatch.pending || undefined}
            aria-invalid={queryError ? true : undefined}
            aria-describedby={queryError ? `${builderId}-error` : regexBatch.pending ? `${builderId}-pending` : undefined}
          />
          <button
            ref={builderButtonRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => builderOpen ? closeBuilder() : setBuilderOpen(true)}
            aria-expanded={builderOpen}
            aria-controls={builderId}
            aria-label={`${label} ${copy.text("regex builder", "正則建立器")}`}
          >
            {copy.text("Regex", "正則")}
          </button>
        </div>
      </div>
      {builderOpen && <div id={builderId}><RegexBuilder value={builderValue} onChange={(next) => {
        if (next.sample !== builderValue.sample) setBuilderSample(next.sample);
        onQuery({ mode: next.mode, pattern: next.pattern, flags: next.flags });
      }} title={`${label} ${copy.text("regex builder", "正則建立器")}`} text={copy.text} /></div>}
      {queryError && <p id={`${builderId}-error`} className="field-error" role="alert">{queryError}</p>}
      {!queryError && regexBatch.pending && <p id={`${builderId}-pending`} className="setting-helper" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>}
      {!regexBatch.pending && !queryError && results.length > 0 && (
        <ul className="tab-search-results" aria-live="polite">
          {results.slice(0, 8).map((result) => (
            <li key={result.tab?.id ?? result.group?.id}>
              {result.tab ? (
                <button type="button" onClick={() => onActivate(result.tab!.id)}>
                  {result.tab.label} · {result.group?.name ?? copy.text("Ungrouped", "未分組")} · {result.tab.pinned ? copy.text("Pinned", "已釘選") : copy.text("Tab", "分頁")} · {result.location?.windowId}/{result.location?.workspaceId}/{result.location?.stripId}
                </button>
              ) : result.group ? (
                <button
                  type="button"
                  onClick={() => onActivateGroup(result.group!.id)}
                  aria-controls={`tab-group-${result.group.id}`}
                  aria-label={copy.text(`Open group ${result.group.name}`, `開啟群組 ${result.group.name}`)}
                >
                  {result.group.name} · {copy.text("Group", "群組")} · {result.group.tabIds.length}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!regexBatch.pending && !queryError && query.pattern.length > 0 && results.length === 0 && (
        <p className="tab-search-empty" role="status">
          {copy.text(`No ${label.toLocaleLowerCase()} results match.`, `冇相符嘅${label}結果。`)}
        </p>
      )}
    </div>
  );
}
