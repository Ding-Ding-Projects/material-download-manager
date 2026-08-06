import { useMemo, useState } from "react";
import {
  defaultTabSearchQuery,
  searchTabs,
  type TabSearchQuery,
  type TabSearchScope,
  type TabState,
} from "@shared/tabModel";
import RegexBuilder from "./RegexBuilder";
import type { RegexBuilderState } from "@shared/regex";
import "../styles/tabs.css";

interface TabStripProps {
  state: TabState;
  onChange: (state: TabState) => void;
  onActivate: (tabId: string) => void;
}

const SEARCHES: Array<{ scope: TabSearchScope; label: string }> = [
  { scope: "strip", label: "Current tab strip" },
  { scope: "group", label: "Current tab group" },
  { scope: "groups", label: "Tab groups" },
  { scope: "master", label: "All tabs" },
];

export default function TabStrip({ state, onChange, onActivate }: TabStripProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [queries, setQueries] = useState<Record<TabSearchScope, TabSearchQuery>>({
    strip: defaultTabSearchQuery(),
    group: defaultTabSearchQuery(),
    groups: defaultTabSearchQuery(),
    master: defaultTabSearchQuery(),
  });
  const visibleTabs = useMemo(() => state.tabs, [state.tabs]);

  function setQuery(scope: TabSearchScope, patch: Partial<TabSearchQuery>) {
    setQueries((current) => ({ ...current, [scope]: { ...current[scope], ...patch } }));
  }

  return (
    <div className="tab-strip-shell">
      <div className="tab-strip" role="tablist" aria-label="Open tabs">
        {visibleTabs.filter((tab) => tab.pinned).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === state.activeTabId}
            className={`app-tab pinned${tab.id === state.activeTabId ? " active" : ""}`}
            title={tab.title || tab.label}
            onClick={() => onActivate(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onChange({ ...state, tabs: state.tabs.map((item) => (item.id === tab.id ? { ...item, pinned: false } : item)) });
            }}
          >
            <span className="app-tab-label">{tab.label}</span>
          </button>
        ))}
        {visibleTabs.filter((tab) => !tab.pinned).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === state.activeTabId}
            className={`app-tab${tab.id === state.activeTabId ? " active" : ""}`}
            title={tab.title || tab.label}
            onClick={() => onActivate(tab.id)}
          >
            <span className="app-tab-label">{tab.label}</span>
          </button>
        ))}
        <button type="button" className={`tab-search-toggle${searchOpen ? " active" : ""}`} onClick={() => setSearchOpen((open) => !open)} aria-expanded={searchOpen}>
          Search tabs
        </button>
      </div>

      {searchOpen && (
        <div className="tab-search-panel" aria-label="Tab discovery searches">
          {SEARCHES.map(({ scope, label }) => (
            <TabSearchControl
              key={scope}
              label={label}
              scope={scope}
              query={queries[scope]}
              state={state}
              onQuery={(patch) => setQuery(scope, patch)}
              onActivate={onActivate}
            />
          ))}
        </div>
      )}
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
}: {
  label: string;
  scope: TabSearchScope;
  query: TabSearchQuery;
  state: TabState;
  onQuery: (patch: Partial<TabSearchQuery>) => void;
  onActivate: (tabId: string) => void;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const results = useMemo(() => searchTabs(state, scope, query), [query, scope, state]);
  const builderValue: RegexBuilderState = { mode: query.mode, pattern: query.pattern, flags: query.flags, sample: "" };

  return (
    <div className="tab-search-control">
      <label>
        <span>{label}</span>
        <div className="tab-search-input-row">
          <input
            className="input"
            value={query.pattern}
            placeholder="Search visible tab labels"
            onChange={(event) => onQuery({ pattern: event.target.value })}
            aria-label={`${label} search`}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBuilderOpen((open) => !open)} aria-expanded={builderOpen}>
            Regex
          </button>
        </div>
      </label>
      {builderOpen && (
        <RegexBuilder
          value={builderValue}
          onChange={(next) => onQuery({ mode: next.mode, pattern: next.pattern, flags: next.flags })}
          title={`${label} regex builder`}
        />
      )}
      {results.length > 0 && (
        <ul className="tab-search-results">
          {results.slice(0, 8).map((result) => (
            <li key={result.tab?.id ?? result.group?.id}>
              {result.tab ? (
                <button type="button" onClick={() => onActivate(result.tab!.id)}>
                  {result.tab.label} · {result.group?.name ?? "Ungrouped"} · {result.tab.pinned ? "Pinned" : "Tab"}
                </button>
              ) : (
                <span>{result.group?.name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
