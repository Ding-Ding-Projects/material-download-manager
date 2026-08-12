import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useUiCopy } from "../i18n/useUiCopy";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../utils/category";
import { CategoryIcon, ChevronDownIcon, ChevronUpIcon, FolderIcon } from "./icons";

function SidebarSection({
  label,
  active,
  count,
  expanded,
  onToggleExpand,
  onSelect,
  bold,
  children,
}: {
  label: string;
  active?: boolean;
  count?: number;
  expanded: boolean;
  onToggleExpand?: () => void;
  onSelect?: () => void;
  bold?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="sidebar-section">
      <div
        className={`sidebar-item sidebar-item-group${active ? " active" : ""}`}
        onClick={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest(".sidebar-chevron-btn")) return;
          onSelect?.();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!onSelect || (event.key !== "Enter" && event.key !== " ")) return;
          if (event.target instanceof HTMLElement && event.target.closest(".sidebar-chevron-btn")) return;
          event.preventDefault();
          onSelect();
        }}
      >
        <FolderIcon size={16} className="sidebar-item-icon" />
        <span className={`sidebar-item-label${bold ? " bold" : ""}`}>{label}</span>
        {typeof count === "number" && <span className="sidebar-item-count">{count}</span>}
        {children && (
          <button
            type="button"
            className="sidebar-chevron-btn"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
          </button>
        )}
      </div>
      {expanded && children}
    </div>
  );
}

export default function Sidebar() {
  const items = useAppStore((s) => s.items);
  const queues = useAppStore((s) => s.queues);
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const openQueues = useAppStore((s) => s.openQueues);
  const settings = useAppStore((s) => s.settings);
  const copy = useUiCopy(settings);

  const [allExpanded, setAllExpanded] = useState(true);
  const [queuesExpanded, setQueuesExpanded] = useState(true);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const finishedCount = useMemo(
    () => items.filter((i) => i.status === "completed").length,
    [items]
  );
  const unfinishedCount = useMemo(
    () => items.filter((i) => i.status !== "completed").length,
    [items]
  );

  return (
    <nav className="sidebar">
      <SidebarSection
        label={copy.text("All", "全部")}
        bold
        active={filter.kind === "all"}
        count={items.length}
        expanded={allExpanded}
        onToggleExpand={() => setAllExpanded((v) => !v)}
        onSelect={() => setFilter({ kind: "all" })}
      >
        <div className="sidebar-children">
          {CATEGORY_ORDER.map((category) => (
            <div
              key={category}
              className={`sidebar-item sidebar-item-leaf${
                filter.kind === "category" && filter.category === category ? " active" : ""
              }`}
              role="button"
              tabIndex={0}
              onClick={() => setFilter({ kind: "category", category })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setFilter({ kind: "category", category });
              }}
            >
              <CategoryIcon category={category} size={15} className="sidebar-item-icon" />
              <span className="sidebar-item-label">{CATEGORY_LABELS[category]}</span>
              <span className="sidebar-item-count">{categoryCounts.get(category) ?? 0}</span>
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection
        label={copy.text("Finished", "已完成")}
        active={filter.kind === "status" && filter.status === "finished"}
        count={finishedCount}
        expanded={false}
        onSelect={() => setFilter({ kind: "status", status: "finished" })}
      />

      <SidebarSection
        label={copy.text("Unfinished", "未完成")}
        active={filter.kind === "status" && filter.status === "unfinished"}
        count={unfinishedCount}
        expanded={false}
        onSelect={() => setFilter({ kind: "status", status: "unfinished" })}
      />

      {queues.length > 0 && (
        <SidebarSection
          label={copy.queues}
          expanded={queuesExpanded}
          onToggleExpand={() => setQueuesExpanded((v) => !v)}
          onSelect={openQueues}
        >
          <div className="sidebar-children">
            {queues.map((queue) => (
              <div
                key={queue.id}
                className={`sidebar-item sidebar-item-leaf${
                  filter.kind === "queue" && filter.queueId === queue.id ? " active" : ""
                }`}
                role="button"
                tabIndex={0}
                onClick={() => setFilter({ kind: "queue", queueId: queue.id })}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setFilter({ kind: "queue", queueId: queue.id });
                }}
              >
                <span className={`queue-dot${queue.isRunning ? " running" : ""}`} />
                <span className="sidebar-item-label">{queue.name}</span>
                <span className="sidebar-item-count">{queue.itemIds.length}</span>
              </div>
            ))}
          </div>
        </SidebarSection>
      )}
    </nav>
  );
}
