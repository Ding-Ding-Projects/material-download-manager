import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_QUEUE_ID } from "@shared/types";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "../i18n/ui";
import { useUiCopy } from "../i18n/useUiCopy";
import {
  LinkAddIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  GridIcon,
  ProgressIcon,
} from "./icons";
import RegexBuilder from "./RegexBuilder";
import { getSearchValidationError } from "../hooks/useFilteredItems";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";

type ToolbarMenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

interface ToolbarProps {
  searchEvaluationError?: string | null;
  searchEvaluationPending?: boolean;
}

function ToolbarMenu({
  menu,
  open,
  onClose,
  copy,
}: {
  menu: { id: string; label: string; actions: ToolbarMenuAction[] };
  open: boolean;
  onClose: (restoreFocus?: boolean) => void;
  copy: ReturnType<typeof getUiCopy>;
}) {
  const [query, setQuery] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [builderOpen, setBuilderOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const regexToggleRef = useRef<HTMLButtonElement>(null);
  const actionSamples = useMemo(() => menu.actions.map((action) => action.label), [menu.actions]);
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    actionSamples,
    query.mode === "regex" && query.pattern.length > 0,
    true,
  );
  const filteredActions = useMemo(() => {
    if (!query.pattern) return menu.actions;
    if (query.mode === "text") {
      const needle = query.pattern.toLocaleLowerCase();
      return menu.actions.filter((action) => action.label.toLocaleLowerCase().includes(needle));
    }
    if (!regexBatch.evaluations) return [];
    return menu.actions.filter((_, index) => regexBatch.evaluations?.[index]?.matches.length);
  }, [menu.actions, query.mode, query.pattern, regexBatch.evaluations]);
  const searchError = query.mode === "regex" && regexBatch.error
    ? localizedRegexEvaluationError(regexBatch.error, copy.text)
    : null;

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (open) return;
    setQuery(createDefaultRegexBuilderState());
    setBuilderOpen(false);
    setSampleText("");
  }, [open]);

  function updateQuery(next: RegexBuilderState) {
    setQuery(next);
    setSampleText(next.sample);
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const menuItems = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (event.key === "Escape") {
      event.preventDefault();
      if (builderOpen) {
        setBuilderOpen(false);
        event.stopPropagation();
        window.requestAnimationFrame(() => regexToggleRef.current?.focus());
        return;
      }
      if (query.pattern) {
        setQuery(createDefaultRegexBuilderState());
        setSampleText("");
        event.stopPropagation();
        searchRef.current?.focus();
        return;
      }
      onClose();
      return;
    }
    if (!(event.target instanceof HTMLButtonElement) || event.target.getAttribute("role") !== "menuitem") return;
    if (!menuItems.length) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "ArrowDown" ? (currentIndex < 0 ? 0 : (currentIndex + 1) % menuItems.length)
      : event.key === "ArrowUp" ? (currentIndex < 0 ? menuItems.length - 1 : (currentIndex - 1 + menuItems.length) % menuItems.length)
        : event.key === "Home" ? 0
          : event.key === "End" ? menuItems.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    menuItems[nextIndex]?.focus();
  }

  return open ? (
    <div
      ref={panelRef}
      id={`toolbar-menu-${menu.id}`}
      className="toolbar-menu-panel"
      role="menu"
      aria-label={menu.label}
      onKeyDown={handleMenuKeyDown}
    >
      <div className="toolbar-menu-search">
        <input
          ref={searchRef}
          className="toolbar-menu-search-input"
          type="search"
          value={query.pattern}
          placeholder={copy.text("Search this menu", "搜尋呢個選單")}
          aria-label={copy.text(`${menu.label} menu search`, `${menu.label}選單搜尋`)}
          onChange={(event) => setQuery((current) => ({ ...current, pattern: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.click();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              panelRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              const menuItems = panelRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)");
              menuItems?.[menuItems.length - 1]?.focus();
              return;
            }
            if (event.key === "Escape" && !builderOpen && !query.pattern) {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button
          ref={regexToggleRef}
          type="button"
          className="toolbar-menu-regex-toggle"
          aria-expanded={builderOpen}
          aria-controls={`toolbar-menu-regex-${menu.id}`}
          onClick={() => {
            if (!builderOpen && !sampleText) setSampleText(actionSamples.join("\n"));
            setBuilderOpen((current) => !current);
          }}
        >
          {copy.text("Regex", "正則")}
        </button>
      </div>
      {builderOpen && (
        <div id={`toolbar-menu-regex-${menu.id}`} className="toolbar-menu-regex" role="dialog" aria-label={copy.text(`${menu.label} menu regex builder`, `${menu.label}選單正則建立器`)}>
          <RegexBuilder
            value={{ ...query, sample: sampleText }}
            onChange={updateQuery}
            title={copy.text(`${menu.label} menu regex builder`, `${menu.label}選單正則建立器`)}
            text={copy.text}
          />
        </div>
      )}
      {searchError && <p className="field-error" role="alert">{searchError}</p>}
      {!searchError && regexBatch.pending && <p className="setting-helper" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>}
      {!regexBatch.pending && !searchError && filteredActions.length === 0 && <p className="toolbar-menu-empty" role="status">{copy.text("No menu actions match.", "冇相符嘅選單操作。")}</p>}
      {filteredActions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="toolbar-menu-action"
          disabled={action.disabled}
          title={action.disabled ? copy.text("Unavailable until a download is active.", "要有下載進行中先可以用。") : undefined}
          onClick={() => {
            if (action.disabled) return;
            action.onSelect();
            onClose(!["add-url", "queues", "settings"].includes(action.id));
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  ) : null;
}

export default function Toolbar({ searchEvaluationError = null, searchEvaluationPending = false }: ToolbarProps) {
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
  const settings = useAppStore((s) => s.settings);
  const copy = useUiCopy(settings);
  const [regexOpen, setRegexOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const regexToggleRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeQueueId = filter.kind === "queue" ? filter.queueId : DEFAULT_QUEUE_ID;
  const activeQueue = queues.find((q) => q.id === activeQueueId);
  const activeQueueName = activeQueue?.name ?? "Default Queue";
  const progressItem = items.find((item) => ["downloading", "queued", "paused", "added"].includes(item.status)) ?? items[0] ?? null;
  const regexState: RegexBuilderState = {
    mode: searchMode,
    pattern: searchText,
    flags: searchFlags,
    sample: sampleText,
  };
  const rawSearchError = getSearchValidationError(searchText, searchMode, searchFlags)
    ?? (searchEvaluationPending ? null : searchEvaluationError);
  const searchError = rawSearchError ? localizedRegexEvaluationError(rawSearchError, copy.text) : null;
  const searchStatusId = searchError
    ? "toolbar-search-error"
    : searchEvaluationPending
      ? "toolbar-search-pending"
      : undefined;

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

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".toolbar-menu")) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", closeOnOutsidePointer, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer, true);
    };
  }, [openMenu]);

  const toolbarMenus: Array<{ id: string; label: string; actions: ToolbarMenuAction[] }> = [
    {
      id: "file",
      label: copy.text("File", "檔案"),
      actions: [
        { id: "add-url", label: copy.text("Add URL", "新增網址"), onSelect: () => openAddDownload() },
        { id: "queues", label: copy.text("Open Queues", "開啟佇列"), onSelect: openQueues },
      ],
    },
    {
      id: "tasks",
      label: copy.text("Tasks", "工作"),
      actions: [
        { id: "start-queue", label: copy.text(`Start ${activeQueueName}`, `開始${activeQueueName}`), onSelect: () => void startQueue(activeQueueId) },
        { id: "stop-queue", label: copy.text(`Stop ${activeQueueName}`, `停止${activeQueueName}`), onSelect: () => void stopQueue(activeQueueId) },
        { id: "stop-all", label: copy.text("Stop All", "全部停止"), onSelect: stopAllActive },
      ],
    },
    {
      id: "tools",
      label: copy.text("Tools", "工具"),
      actions: [
        {
          id: "progress",
          label: copy.text("Progress Window", "進度視窗"),
          onSelect: () => progressItem && void window.api.openProgressWindow(progressItem.id),
          disabled: !progressItem,
        },
        { id: "settings", label: copy.settings, onSelect: openSettings },
      ],
    },
    {
      id: "help",
      label: copy.text("Help", "幫助"),
      actions: [
        { id: "check-updates", label: copy.text("Check for updates", "檢查更新"), onSelect: () => void window.api.checkForUpdates() },
      ],
    },
  ];

  function closeMenu(restoreFocus = true) {
    const closingMenu = openMenu;
    setOpenMenu(null);
    if (restoreFocus && closingMenu) window.requestAnimationFrame(() => menuTriggerRefs.current[closingMenu]?.focus());
  }

  return (
    <div className="toolbar-wrap">
      <div className="menu-row">
        <div className="menu-items">
          {toolbarMenus.map((menu) => (
            <div className="toolbar-menu" key={menu.id}>
              <button
                ref={(element) => { menuTriggerRefs.current[menu.id] = element; }}
                type="button"
                className="menu-item"
                id={`toolbar-menu-trigger-${menu.id}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.id}
                aria-controls={`toolbar-menu-${menu.id}`}
                onClick={() => openMenu === menu.id ? closeMenu() : setOpenMenu(menu.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpenMenu(menu.id);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeMenu();
                  }
                }}
              >
                {menu.label}
              </button>
              <ToolbarMenu menu={menu} open={openMenu === menu.id} onClose={closeMenu} copy={copy} />
            </div>
          ))}
        </div>
        <div className="search-builder-anchor">
          <div className="search-box">
            <SearchIcon size={15} className="search-icon" />
            <input
              className="search-input"
              type="text"
              placeholder={copy.searchDownloads}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              aria-label={copy.searchDownloads}
              aria-invalid={searchError !== null}
              aria-describedby={searchStatusId}
              aria-busy={searchEvaluationPending || undefined}
            />
            <button
              ref={regexToggleRef}
              type="button"
              className={`search-builder-toggle${regexOpen ? " active" : ""}`}
              onClick={toggleRegexBuilder}
              aria-expanded={regexOpen}
              aria-controls="toolbar-search-regex-panel"
              title={copy.text("Open the search regex builder", "開啟搜尋正則表達式工具")}
            >
              Regex
            </button>
          </div>
          {searchError && (
            <p id="toolbar-search-error" className="field-error search-builder-error" role="alert">
              {searchError}
            </p>
          )}
          {!searchError && searchEvaluationPending && (
            <p id="toolbar-search-pending" className="search-builder-error" role="status">
              {copy.text("Evaluating safely…", "安全評估緊…")}
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

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => progressItem && void window.api.openProgressWindow(progressItem.id)}
          disabled={!progressItem}
          title={progressItem ? "Open the separate download progress window" : "Add a download before opening progress"}
        >
          <ProgressIcon size={18} />
          <span>Progress Window</span>
        </button>
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
