import { useState } from "react";
import type { DownloadItem, DownloadStatus } from "@shared/types";
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
import ContextMenu, { ContextMenuItem, ContextMenuSeparator } from "./ContextMenu";
import { getUiCopy } from "../i18n/ui";
import { localizedRegexEvaluationError } from "../hooks/useIsolatedRegex";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  added: "Added",
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Finished",
  error: "Error",
  cancelled: "Cancelled",
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

type MenuState = { x: number; y: number; ids: string[]; mode: "menu" | "confirmRemove" };

interface DownloadTableProps {
  filteredItems: DownloadItem[];
  regexError: string | null;
  regexPending: boolean;
}

export default function DownloadTable({ filteredItems, regexError, regexPending }: DownloadTableProps) {
  const settings = useAppStore((s) => s.settings);
  const copy = getUiCopy(settings);
  const sort = useAppStore((s) => s.sort);
  const setSort = useAppStore((s) => s.setSort);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const selectOnly = useAppStore((s) => s.selectOnly);
  const toggleSelect = useAppStore((s) => s.toggleSelect);
  const selectMany = useAppStore((s) => s.selectMany);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const openFile = useAppStore((s) => s.openFile);
  const openFolder = useAppStore((s) => s.openFolder);
  const openDetails = useAppStore((s) => s.openDetails);
  const pauseDownload = useAppStore((s) => s.pauseDownload);
  const resumeDownload = useAppStore((s) => s.resumeDownload);
  const retryDownload = useAppStore((s) => s.retryDownload);
  const removeDownload = useAppStore((s) => s.removeDownload);
  const items = useAppStore((s) => s.items);

  const [menu, setMenu] = useState<MenuState | null>(null);

  const allSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));

  function handleRowClick(item: DownloadItem) {
    selectOnly(item.id);
  }

  function handleRowDoubleClick(item: DownloadItem) {
    if (item.status === "completed") void openFile(item.id);
    else openDetails(item.id);
  }

  function handleContextMenu(e: React.MouseEvent, item: DownloadItem) {
    e.preventDefault();
    const ids = selectedIds.has(item.id) && selectedIds.size > 1 ? [...selectedIds] : [item.id];
    if (!(selectedIds.has(item.id) && selectedIds.size > 1)) selectOnly(item.id);
    setMenu({ x: e.clientX, y: e.clientY, ids, mode: "menu" });
  }

  function closeMenu() {
    setMenu(null);
  }

  const menuItems = menu ? menu.ids.map((id) => items.find((i) => i.id === id)).filter(Boolean) as DownloadItem[] : [];
  const primary = menuItems[0];

  return (
    <div className="table-scroll">
      <table className="dl-table">
        <thead>
          <tr>
            <th className="col-checkbox">
              <button
                type="button"
                className={`checkbox${allSelected ? " checked" : ""}`}
                aria-label="Select all"
                role="checkbox"
                aria-checked={allSelected}
                onClick={() =>
                  allSelected ? clearSelection() : selectMany(filteredItems.map((i) => i.id))
                }
              >
                {allSelected && <CheckIcon size={11} />}
              </button>
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.className}
                scope="col"
                tabIndex={0}
                aria-sort={
                  sort.key === col.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                onClick={() => setSort(col.key)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSort(col.key);
                }}
              >
                <span className="th-inner">
                  <SortIcon
                    size={11}
                    className={`sort-icon${sort.key === col.key ? " active" : ""}${
                      sort.key === col.key && sort.direction === "desc" ? " desc" : ""
                    }`}
                  />
                  {col.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredItems.map((item) => (
            <Row
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onClick={() => handleRowClick(item)}
              onDoubleClick={() => handleRowDoubleClick(item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
              onToggleCheckbox={() => toggleSelect(item.id)}
            />
          ))}
          {filteredItems.length === 0 && (
            <tr className="empty-row">
              <td colSpan={COLUMNS.length + 1}>
                {regexPending ? (
                  <span role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</span>
                ) : regexError ? (
                  <span role="alert">{localizedRegexEvaluationError(regexError, copy.text)}</span>
                ) : copy.text("No downloads to show.", "冇下載項目可以顯示。")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {menu && primary && menu.mode === "menu" && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          {(primary.status === "downloading" || primary.status === "queued") && (
            <ContextMenuItem
              icon={<PauseIcon size={14} />}
              label="Pause"
              onClick={() => {
                menuItems.forEach((i) => void pauseDownload(i.id));
                closeMenu();
              }}
            />
          )}
          {(primary.status === "paused" || primary.status === "added") && (
            <ContextMenuItem
              icon={<ResumeIcon size={14} />}
              label="Resume"
              onClick={() => {
                menuItems.forEach((i) => void resumeDownload(i.id));
                closeMenu();
              }}
            />
          )}
          {primary.status === "error" && (
            <ContextMenuItem
              icon={<RefreshIcon size={14} />}
              label="Retry"
              onClick={() => {
                menuItems.forEach((i) => void retryDownload(i.id));
                closeMenu();
              }}
            />
          )}
          <ContextMenuItem
            icon={<DocumentIcon size={14} />}
            label="Open File"
            disabled={primary.status !== "completed"}
            onClick={() => {
              void openFile(primary.id);
              closeMenu();
            }}
          />
          <ContextMenuItem
            icon={<FolderIcon size={14} />}
            label="Open Folder"
            onClick={() => {
              void openFolder(primary.id);
              closeMenu();
            }}
          />
          <ContextMenuItem
            icon={<ClipboardIcon size={14} />}
            label="Copy Link"
            onClick={() => {
              void navigator.clipboard.writeText(menuItems.map((i) => i.url).join("\n"));
              closeMenu();
            }}
          />
          <ContextMenuItem
            icon={<InfoIcon size={14} />}
            label="Details"
            onClick={() => {
              openDetails(primary.id);
              closeMenu();
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<TrashIcon size={14} />}
            label="Remove"
            danger
            onClick={() => setMenu((m) => (m ? { ...m, mode: "confirmRemove" } : m))}
          />
        </ContextMenu>
      )}

      {menu && menu.mode === "confirmRemove" && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <div className="context-menu-heading">Remove {menu.ids.length} item(s)?</div>
          <ContextMenuItem
            label="Remove from list"
            onClick={() => {
              menu.ids.forEach((id) => void removeDownload(id, false));
              closeMenu();
            }}
          />
          <ContextMenuItem
            label="Remove and delete file"
            danger
            onClick={() => {
              menu.ids.forEach((id) => void removeDownload(id, true));
              closeMenu();
            }}
          />
          <ContextMenuSeparator />
          <ContextMenuItem label="Cancel" onClick={closeMenu} />
        </ContextMenu>
      )}
    </div>
  );
}

function Row({
  item,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleCheckbox,
}: {
  item: DownloadItem;
  selected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleCheckbox: () => void;
}) {
  const percent = percentOf(item.downloadedSize, item.totalSize);
  const isActive = item.status === "downloading" || item.status === "paused";

  return (
    <tr
      className={`dl-row${selected ? " selected" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <td className="col-checkbox">
        <button
          type="button"
          className={`checkbox${selected ? " checked" : ""}`}
          aria-label="Select row"
          role="checkbox"
          aria-checked={selected}
          onClick={(e) => {
            e.stopPropagation();
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
            <span className="name-text" title={item.fileName}>
              {item.fileName}
            </span>
            <span className="name-subtitle">{CATEGORY_LABELS[item.category]}</span>
          </div>
        </div>
      </td>
      <td className="col-size">{formatBytes(item.totalSize)}</td>
      <td className="col-status">
        <div className="status-cell">
          <span className={`status-label status-${item.status}`}>
            {percent !== null && isActive ? `${percent}% ` : ""}
            {STATUS_LABEL[item.status]}
          </span>
          {isActive && (
            <div className="progress-track">
              <div
                className={`progress-fill status-${item.status}${percent === null ? " indeterminate" : ""}`}
                style={percent !== null ? { width: `${percent}%` } : undefined}
              />
            </div>
          )}
        </div>
      </td>
      <td className="col-speed">{item.status === "downloading" ? formatSpeed(item.speed) : ""}</td>
      <td className="col-eta">
        {item.status === "downloading" && item.eta !== null ? formatEta(item.eta) : ""}
      </td>
      <td className="col-date">{formatRelativeTime(item.dateAdded)}</td>
    </tr>
  );
}
