import { useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { useFilteredItems } from "../hooks/useFilteredItems";
import { formatSpeed } from "../utils/format";
import { GridIcon } from "./icons";

function CloudDownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 18a4.5 4.5 0 0 1-1-8.9A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1-1 7.9" />
      <path d="M12 12v7M9 16.5 12 19.5 15 16.5" />
    </svg>
  );
}

export default function StatusBar() {
  const items = useAppStore((s) => s.items);
  const filtered = useFilteredItems();

  const totalSpeed = useMemo(
    () => items.filter((i) => i.status === "downloading").reduce((sum, i) => sum + i.speed, 0),
    [items]
  );

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <GridIcon size={13} />
        <span>{filtered.length}</span>
      </div>
      <div className="status-bar-right">
        <CloudDownloadIcon size={14} />
        <span>{formatSpeed(totalSpeed)}</span>
      </div>
    </div>
  );
}
