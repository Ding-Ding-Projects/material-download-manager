import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { DownloadItem, DownloadStatus } from "@shared/types";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { useAppStore, type SortKey } from "../store/useAppStore";
import { CATEGORY_LABELS } from "../utils/category";
import { formatBytes, formatEta, formatRelativeTime, formatSpeed, percentOf } from "../utils/format";
import {
  CategoryIcon,
  CheckIcon,
  ClipboardIcon,
  DocumentIcon,
  FolderIcon,
  InfoIcon,
  PauseIcon,
  RefreshIcon,
  ResumeIcon,
  SortIcon,
  TrashIcon,
} from "./icons";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import { type DestructiveActionRequest } from "./DestructiveActionGate";
import { useUiCopy } from "../i18n/useUiCopy";
import RegexBuilder from "./RegexBuilder";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";

const STATUS_LABEL: Record<DownloadStatus, [english: string, cantonese: string]> = {
  added: ["Added", "已加入"],
  queued: ["Queued", "排隊中"],
  downloading: ["Downloading", "下載緊"],
  paused: ["Paused", "已暫停"],
  completed: ["Finished", "已完成"],
  error: ["Error", "錯誤"],
  cancelled: ["Cancelled", "已取消"],
};

interface ColumnDef {
  key: SortKey;
  label: string;
  className: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", className: "col-name" },
  { key: "size", label: "Size", className: "col-size" },
  { key: "status", label: "Status", className: "col-status" },
  { key: "speed", label: "Speed", className: "col-speed" },
  { key: "eta", label: "Time Left", className: "col-eta" },
  { key: "dateAdded", label: "Date Added", className: "col-date" },
];

type MenuState = {
  x: number;
  y: number;
  ids: string[];
  mode: "menu" | "confirmRemove";
  origin: HTMLElement;
  fallback: HTMLElement | null;
};

interface DownloadTableProps {
  filteredItems: DownloadItem[];
  regexError: string | null;
  regexPending: boolean;
  /**
   * The application owns the destructive gate.  Keeping this explicit callback
   * in the table's data flow avoids a global DOM listener that can be skipped
   * when markup or event propagation changes.
   */
  onRequestDestructiveAction: (request: DestructiveActionRequest) => void;
}

interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function statusLabel(status: DownloadStatus, copy: ReturnType<typeof getUiCopy>): string {
  const [english, cantonese] = STATUS_LABEL[status];
  return copy.text(english, cantonese);
}

/**
 * Every download context menu owns a real plain-text-first filter and a directly
 * anchored full regex builder. Keeping it beside the action list makes its query
 * unambiguous and ensures keyboard users can discover every row operation.
 */
function ContextActionList({
  label,
  actions,
  copy,
}: {
  label: string;
  actions: ContextAction[];
  copy: ReturnType<typeof getUiCopy>;
}) {
  const [query, setQuery] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [sample, setSample] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const builderButtonRef = useRef<HTMLButtonElement>(null);
  const builderId = useId();
  const samples = useMemo(() => actions.map((action) => action.label), [actions]);
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    samples,
    query.mode === "regex" && query.pattern.length > 0,
    true,
  );
  const error = query.mode === "regex" && regexBatch.error
    ? localizedRegexEvaluationError(regexBatch.error, copy.text)
    : null;
  const filteredActions = useMemo(() => {
    if (!query.pattern) return actions;
    if (query.mode === "text") {
      const needle = query.pattern.toLocaleLowerCase();
      return actions.filter((action) => action.label.toLocaleLowerCase().includes(needle));
    }
    if (!regexBatch.evaluations) return [];
    return actions.filter((_, index) => regexBatch.evaluations?.[index]?.matches.length);
  }, [actions, query.mode, query.pattern, regexBatch.evaluations]);

  useLayoutEffect(() => {
    // The menu opens from a keyboard event. Focus synchronously during layout so
    // the user can type immediately, rather than leaving a frame in which focus
    // remains on the originating row action.
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  function closeBuilder() {
    setBuilderOpen(false);
    window.requestAnimationFrame(() => builderButtonRef.current?.focus({ preventScroll: true }));
  }

  function firstVisibleAction(): HTMLButtonElement | null {
    return inputRef.current?.closest(".context-menu")?.querySelector<HTMLButtonElement>(".context-menu-item:not(:disabled)") ?? null;
  }

  return (
    <div className="context-menu-action-list">
      <div className="context-menu-search-row">
        <input
          ref={inputRef}
          className="input context-menu-search"
          type="search"
          value={query.pattern}
          placeholder={copy.text("Search this menu", "搜尋呢個選單")}
          aria-label={copy.text(`${label} search`, `${label}搜尋`)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${builderId}-error` : regexBatch.pending ? `${builderId}-pending` : undefined}
          onChange={(event) => setQuery((current) => ({ ...current, pattern: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              firstVisibleAction()?.click();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              firstVisibleAction()?.focus();
            } else if (event.key === "Escape" && query.pattern) {
              event.preventDefault();
              setQuery(createDefaultRegexBuilderState());
              setSample("");
            }
          }}
        />
        <button
          ref={builderButtonRef}
          type="button"
          className="btn btn-ghost btn-sm context-menu-regex-toggle"
          aria-label={copy.text(`Open ${label} regex builder`, `開啟${label}正則建立器`)}
          aria-expanded={builderOpen}
          aria-controls={builderId}
          onClick={() => {
            if (!builderOpen && !sample) setSample(samples.join("\n"));
            setBuilderOpen((open) => !open);
          }}
        >
          {copy.text("Regex", "正則")}
        </button>
      </div>
      {builderOpen && (
        <div id={builderId} className="context-menu-regex-builder" role="dialog" aria-label={copy.text(`${label} regex builder`, `${label}正則建立器`)}>
          <RegexBuilder
            value={{ ...query, sample }}
            onChange={(next) => {
              setSample(next.sample);
              setQuery({ mode: next.mode, pattern: next.pattern, flags: next.flags, sample: next.sample });
            }}
            title={copy.text(`${label} regex builder`, `${label}正則建立器`)}
            text={copy.text}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeBuilder}>{copy.close}</button>
        </div>
      )}
      {error && <p id={`${builderId}-error`} className="field-error context-menu-search-status" role="alert">{error}</p>}
      {!error && regexBatch.pending && <p id={`${builderId}-pending`} className="setting-helper context-menu-search-status" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>}
      {!error && !regexBatch.pending && filteredActions.length === 0 && <p className="context-menu-empty" role="status">{copy.text("No menu actions match.", "冇相符嘅選單操作。")}</p>}
      <div className="context-menu-actions">
        {!error && !regexBatch.pending && filteredActions.map((action) => (
          <ContextMenuItem
            key={action.id}
            icon={action.icon}
            label={action.label}
            danger={action.danger}
            disabled={action.disabled}
            menuItem={false}
            onClick={action.onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default function DownloadTable({ filteredItems, regexError, regexPending, onRequestDestructiveAction }: DownloadTableProps) {
  const settings = useAppStore((state) => state.settings);
  const copy = useUiCopy(settings);
  const sort = useAppStore((state) => state.sort);
  const setSort = useAppStore((state) => state.setSort);
  const selectedIds = useAppStore((state) => state.selectedIds);
  const selectOnly = useAppStore((state) => state.selectOnly);
  const toggleSelect = useAppStore((state) => state.toggleSelect);
  const selectMany = useAppStore((state) => state.selectMany);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const openFile = useAppStore((state) => state.openFile);
  const openFolder = useAppStore((state) => state.openFolder);
  const openDetails = useAppStore((state) => state.openDetails);
  const pauseDownload = useAppStore((state) => state.pauseDownload);
  const resumeDownload = useAppStore((state) => state.resumeDownload);
  const retryDownload = useAppStore((state) => state.retryDownload);
  const items = useAppStore((state) => state.items);
  const tableRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
  const menuItems = menu ? menu.ids.map((id) => items.find((item) => item.id === id)).filter(Boolean) as DownloadItem[] : [];
  const primary = menuItems[0] ?? null;

  function openMenu(item: DownloadItem, origin: HTMLElement, x: number, y: number) {
    const ids = selectedIds.has(item.id) && selectedIds.size > 1 ? [...selectedIds] : [item.id];
    if (!(selectedIds.has(item.id) && selectedIds.size > 1)) selectOnly(item.id);
    setMenu({ x, y, ids, mode: "menu", origin, fallback: tableRef.current });
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLTableRowElement>, item: DownloadItem) {
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    openMenu(item, event.currentTarget, event.clientX, event.clientY);
  }

  function handleRowActions(target: HTMLButtonElement, item: DownloadItem) {
    const rect = target.getBoundingClientRect();
    target.focus({ preventScroll: true });
    openMenu(item, target, rect.left + Math.min(rect.width, 12), rect.bottom + 4);
  }

  function handleKeyboardContextMenu(event: ReactKeyboardEvent<HTMLTableRowElement>, item: DownloadItem) {
    const key = event.key;
    if (key !== "ContextMenu" && !(event.shiftKey && key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.focus({ preventScroll: true });
    openMenu(item, event.currentTarget, rect.left + Math.min(rect.width, 24), rect.top + Math.min(rect.height, 24));
  }

  function closeMenu({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    const current = menu;
    setMenu(null);
    if (!restoreFocus || !current) return;
    const target = current.origin.isConnected ? current.origin : current.fallback;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }

  const actions: ContextAction[] = [];
  if (primary?.status === "downloading" || primary?.status === "queued") {
    actions.push({
      id: "pause",
      icon: <PauseIcon size={14} />,
      label: copy.text("Pause", "暫停"),
      onSelect: () => {
        menuItems.forEach((item) => void pauseDownload(item.id));
        closeMenu();
      },
    });
  }
  if (primary?.status === "paused" || primary?.status === "added") {
    actions.push({
      id: "resume",
      icon: <ResumeIcon size={14} />,
      label: copy.text("Resume", "繼續"),
      onSelect: () => {
        menuItems.forEach((item) => void resumeDownload(item.id));
        closeMenu();
      },
    });
  }
  if (primary?.status === "error") {
    actions.push({
      id: "retry",
      icon: <RefreshIcon size={14} />,
      label: copy.text("Retry", "重試"),
      onSelect: () => {
        menuItems.forEach((item) => void retryDownload(item.id));
        closeMenu();
      },
    });
  }
  if (primary) {
    actions.push(
      {
        id: "open-file",
        icon: <DocumentIcon size={14} />,
        label: copy.text("Open File", "開啟檔案"),
        disabled: primary.status !== "completed",
        onSelect: () => {
          void openFile(primary.id);
          closeMenu();
        },
      },
      {
        id: "open-folder",
        icon: <FolderIcon size={14} />,
        label: copy.text("Open Folder", "開啟資料夾"),
        onSelect: () => {
          void openFolder(primary.id);
          closeMenu();
        },
      },
      {
        id: "copy-link",
        icon: <ClipboardIcon size={14} />,
        label: copy.text("Copy Link", "複製連結"),
        onSelect: () => {
          void navigator.clipboard.writeText(menuItems.map((item) => item.url).join("\n"));
          closeMenu();
        },
      },
      {
        id: "details",
        icon: <InfoIcon size={14} />,
        label: copy.text("Details", "詳細資料"),
        onSelect: () => {
          openDetails(primary.id);
          closeMenu();
        },
      },
      {
        id: "open-progress",
        icon: <InfoIcon size={14} />,
        label: copy.text("Open Downloading window", "開啟下載中視窗"),
        onSelect: () => {
          // This only opens the monitor. The main-process download task keeps
          // running even if the user closes that window again.
          void window.api.openProgressWindow(primary.id);
          closeMenu();
        },
      },
      {
        id: "remove",
        icon: <TrashIcon size={14} />,
        label: copy.text("Remove", "移除"),
        danger: true,
        onSelect: () => setMenu((current) => current ? { ...current, mode: "confirmRemove" } : current),
      },
    );
  }

  const removalActions: ContextAction[] = menu ? [
    {
      id: "remove-from-list",
      label: copy.text("Remove from list", "由清單移除"),
        onSelect: () => {
          onRequestDestructiveAction({
            itemIds: [...menu.ids],
            deleteFile: false,
            returnFocusTarget: menu.origin,
            returnFocusFallback: menu.fallback,
          });
        closeMenu({ restoreFocus: false });
      },
    },
    {
      id: "remove-and-delete-file",
      label: copy.text("Remove and delete file", "移除並刪除檔案"),
      danger: true,
      onSelect: () => {
        onRequestDestructiveAction({
          itemIds: [...menu.ids],
          deleteFile: true,
          returnFocusTarget: menu.origin,
          returnFocusFallback: menu.fallback,
        });
        closeMenu({ restoreFocus: false });
      },
    },
    { id: "cancel", label: copy.cancel, onSelect: closeMenu },
  ] : [];

  return (
    <div
      className="table-scroll"
      id="downloads-table"
      ref={tableRef}
      tabIndex={-1}
      aria-label={copy.text("Downloads table", "下載項目表格")}
    >
      <table className="dl-table" aria-label={copy.downloads}>
        <thead>
          <tr>
            <th className="col-checkbox">
              <button
                type="button"
                className={`checkbox${allSelected ? " checked" : ""}`}
                aria-label={copy.selectAll}
                role="checkbox"
                aria-checked={allSelected}
                onClick={() => allSelected ? clearSelection() : selectMany(filteredItems.map((item) => item.id))}
              >
                {allSelected && <CheckIcon size={11} />}
              </button>
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={column.className}
                scope="col"
                tabIndex={0}
                aria-sort={sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}
                onClick={() => setSort(column.key)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSort(column.key);
                }}
              >
                <span className="th-inner">
                  <SortIcon size={11} className={`sort-icon${sort.key === column.key ? " active" : ""}${sort.key === column.key && sort.direction === "desc" ? " desc" : ""}`} />
                  {column.label}
                </span>
              </th>
            ))}
            <th className="col-actions" scope="col">{copy.text("Actions", "操作")}</th>
          </tr>
        </thead>
        <tbody>
          {filteredItems.map((item) => (
            <Row
              key={item.id}
              item={item}
              copy={copy}
              selected={selectedIds.has(item.id)}
              onClick={() => selectOnly(item.id)}
              onDoubleClick={() => {
                if (item.status === "completed") void openFile(item.id);
                else openDetails(item.id);
              }}
              onContextMenu={(event) => handleContextMenu(event, item)}
              onKeyDown={(event) => handleKeyboardContextMenu(event, item)}
              onToggleCheckbox={() => toggleSelect(item.id)}
              onOpenActions={(target) => handleRowActions(target, item)}
            />
          ))}
          {filteredItems.length === 0 && (
            <tr className="empty-row">
              <td colSpan={COLUMNS.length + 2}>
                {regexPending ? <span role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</span>
                  : regexError ? <span role="alert">{localizedRegexEvaluationError(regexError, copy.text)}</span>
                    : copy.text("No downloads to show.", "冇下載項目可以顯示。")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {menu && primary && menu.mode === "menu" && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} role="dialog" label={copy.text("Download actions", "下載項目操作")}>
          <ContextActionList label={copy.text("Download actions", "下載項目操作")} actions={actions} copy={copy} />
        </ContextMenu>
      )}

      {menu && menu.mode === "confirmRemove" && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} role="dialog" label={copy.text("Removal choices", "移除選擇")}>
          <div className="context-menu-heading">{copy.text(`Remove ${menu.ids.length} item${menu.ids.length === 1 ? "" : "s"}?`, `移除 ${menu.ids.length} 個項目？`)}</div>
          <ContextActionList label={copy.text("Removal choices", "移除選擇")} actions={removalActions} copy={copy} />
        </ContextMenu>
      )}
    </div>
  );
}

function Row({
  item,
  copy,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onToggleCheckbox,
  onOpenActions,
}: {
  item: DownloadItem;
  copy: ReturnType<typeof getUiCopy>;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLTableRowElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>) => void;
  onToggleCheckbox: () => void;
  onOpenActions: (target: HTMLButtonElement) => void;
}) {
  const percent = percentOf(item.downloadedSize, item.totalSize);
  const isActive = item.status === "downloading" || item.status === "paused";
  const label = statusLabel(item.status, copy);
  const rowId = `download-row-${item.id}`;

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return;
    onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onDoubleClick();
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      onClick();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = Array.from(event.currentTarget.closest(".table-scroll")?.querySelectorAll<HTMLTableRowElement>("tr[data-download-row]") ?? []);
      const currentIndex = rows.indexOf(event.currentTarget);
      if (currentIndex < 0) return;
      const nextIndex = event.key === "ArrowDown" ? Math.min(rows.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      rows[nextIndex]?.focus({ preventScroll: true });
    }
  }

  return (
    <tr
      id={rowId}
      data-download-row
      data-download-id={item.id}
      className={`dl-row${selected ? " selected" : ""}`}
      tabIndex={0}
      aria-label={copy.text(`${item.fileName}, ${label}. Press Enter for details, Space to select, or the Context Menu key for actions.`, `${item.fileName}，${label}。按 Enter 睇詳細資料，按空白鍵選取，或者按選單鍵開啟操作。`)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={handleRowKeyDown}
    >
      <td className="col-checkbox">
        <button
          type="button"
          className={`checkbox${selected ? " checked" : ""}`}
          aria-label={copy.text(`Select ${item.fileName}`, `選取 ${item.fileName}`)}
          role="checkbox"
          aria-checked={selected}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCheckbox();
          }}
        >
          {selected && <CheckIcon size={11} />}
        </button>
      </td>
      <td className="col-name">
        <div className="name-cell">
          <CategoryIcon category={item.category} size={20} className="name-icon" />
          <div className="name-text-wrap">
            <span className="name-text" title={item.fileName}>{item.fileName}</span>
            <span className="name-subtitle">{CATEGORY_LABELS[item.category]}</span>
          </div>
        </div>
      </td>
      <td className="col-size">{formatBytes(item.totalSize)}</td>
      <td className="col-status">
        <div className="status-cell">
          <span className={`status-label status-${item.status}`}>{percent !== null && isActive ? `${percent}% ` : ""}{label}</span>
          {isActive && (
            <div className="progress-track">
              <div className={`progress-fill status-${item.status}${percent === null ? " indeterminate" : ""}`} style={percent !== null ? { width: `${percent}%` } : undefined} />
            </div>
          )}
        </div>
      </td>
      <td className="col-speed">{item.status === "downloading" ? formatSpeed(item.speed) : ""}</td>
      <td className="col-eta">{item.status === "downloading" && item.eta !== null ? formatEta(item.eta) : ""}</td>
      <td className="col-date">{formatRelativeTime(item.dateAdded)}</td>
      <td className="col-actions">
        <button
          type="button"
          className="row-actions-button"
          aria-label={copy.text(`Actions for ${item.fileName}`, `${item.fileName} 的操作`)}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation();
            onOpenActions(event.currentTarget);
          }}
        >
          {copy.text("Actions", "操作")}
        </button>
      </td>
    </tr>
  );
}
