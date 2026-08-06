import { useEffect, useRef, useState } from "react";
import { DEFAULT_QUEUE_ID } from "@shared/types";
import type { RegexBuilderState } from "@shared/regex";
import { useAppStore } from "../store/useAppStore";
import {
  LinkAddIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  GridIcon,
} from "./icons";
import RegexBuilder from "./RegexBuilder";
import { getSearchValidationError } from "../hooks/useFilteredItems";

const MENU_ITEMS = ["File", "Tasks", "Tools", "Help"];

export default function Toolbar() {
  const filter = useAppStore((s) => s.filter);
  const queues = useAppStore((s) => s.queues);
  const items = useAppStore((s) => s.items);
  const searchText = useAppStore((s) => s.searchText);
  const searchMode = useAppStore((s) => s.searchMode);
  const searchFlags = useAppStore((s) => s.searchFlags);
  const setSearchText = useAppStore((s) => s.setSearchText);
  const setSearchMode = useAppStore((s) => s.setSearchMode);
  const setSearchFlags = useAppStore((s) => s.setSearchFlags);
  const openAddDownload = useAppStore((s) => s.openAddDownload);
  const openQueues = useAppStore((s) => s.openQueues);
  const openSettings = useAppStore((s) => s.openSettings);
  const startQueue = useAppStore((s) => s.startQueue);
  const stopQueue = useAppStore((s) => s.stopQueue);
  const stopAllActive = useAppStore((s) => s.stopAllActive);
  const [regexOpen, setRegexOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const regexToggleRef = useRef<HTMLButtonElement>(null);

  const activeQueueId = filter.kind === "queue" ? filter.queueId : DEFAULT_QUEUE_ID;
  const activeQueue = queues.find((q) => q.id === activeQueueId);
  const activeQueueName = activeQueue?.name ?? "Default Queue";
  const regexState: RegexBuilderState = {
    mode: searchMode,
    pattern: searchText,
    flags: searchFlags,
    sample: sampleText,
  };
  const searchError = getSearchValidationError(searchText, searchMode, searchFlags);

  useEffect(() => {
    if (!regexOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setRegexOpen(false);
      regexToggleRef.current?.focus();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [regexOpen]);

  function toggleRegexBuilder() {
    if (!regexOpen && !sampleText) {
      setSampleText(items.map((item) => `${item.fileName}\n${item.url}`).join("\n"));
    }
    setRegexOpen((open) => !open);
  }

  function updateRegexSearch(next: RegexBuilderState) {
    setSearchText(next.pattern);
    setSearchMode(next.mode);
    setSearchFlags(next.flags);
    setSampleText(next.sample);
  }

  return (
    <div className="toolbar-wrap">
      <div className="menu-row">
        <div className="menu-items">
          {MENU_ITEMS.map((label) => (
            <span key={label} className="menu-item">
              <u>{label[0]}</u>
              {label.slice(1)}
            </span>
          ))}
        </div>
        <div className="search-builder-anchor">
          <div className="search-box">
            <SearchIcon size={15} className="search-icon" />
            <input
              className="search-input"
              type="text"
              placeholder="Search downloads"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              aria-label="Search downloads"
              aria-invalid={searchError !== null}
              aria-describedby={searchError ? "toolbar-search-error" : undefined}
            />
            <button
              ref={regexToggleRef}
              type="button"
              className={`search-builder-toggle${regexOpen ? " active" : ""}`}
              onClick={toggleRegexBuilder}
              aria-expanded={regexOpen}
              aria-controls="toolbar-search-regex-panel"
              title="Open the search regex builder"
            >
              Regex
            </button>
          </div>
          {searchError && (
            <p id="toolbar-search-error" className="field-error search-builder-error" role="alert">
              {searchError}
            </p>
          )}
          {regexOpen && (
            <div
              id="toolbar-search-regex-panel"
              className="search-builder-popover"
              role="dialog"
              aria-label="Download search builder"
            >
              <RegexBuilder value={regexState} onChange={updateRegexSearch} title="Download search builder" />
            </div>
          )}
        </div>
      </div>

      <div className="toolbar">
        <button
          type="button"
          className="add-url-btn"
          onClick={() => openAddDownload()}
          title="Add a new download URL"
        >
          <LinkAddIcon size={16} />
          <span>Add URL</span>
          <span className="add-url-btn-accent">
            <LinkAddIcon size={14} />
          </span>
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => void startQueue(activeQueueId)}
          title={`Start ${activeQueueName}`}
        >
          <PlayIcon size={18} />
          <span>Start Queue</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => void stopQueue(activeQueueId)}
          title={`Stop ${activeQueueName}`}
        >
          <StopIcon size={18} />
          <span>Stop Queue</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => stopAllActive()}
          title="Pause every active download"
        >
          <StopIcon size={18} />
          <span>Stop All</span>
        </button>

        <div className="toolbar-divider" />

        <button type="button" className="toolbar-btn" onClick={() => openQueues()}>
          <GridIcon size={18} />
          <span>Open Queues</span>
        </button>
        <button type="button" className="toolbar-btn" onClick={() => openSettings()}>
          <SettingsIcon size={18} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
