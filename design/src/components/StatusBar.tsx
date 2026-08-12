import { useMemo } from "react";
import { useAppStore } from "../store/useAppStore";
import { formatSpeed } from "../utils/format";
import { GridIcon } from "./icons";
import { useUiCopy } from "../i18n/useUiCopy";

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

export default function StatusBar({ filteredCount, regexPending }: { filteredCount: number; regexPending: boolean }) {
  const items = useAppStore((s) => s.items);
  const settings = useAppStore((s) => s.settings);
  const copy = useUiCopy(settings);

  const totalSpeed = useMemo(
    () => items.filter((i) => i.status === "downloading").reduce((sum, i) => sum + i.speed, 0),
    [items]
  );

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <GridIcon size={13} />
        {regexPending
          ? <span role="status" aria-label={copy.text("Evaluating safely", "安全評估緊")}>…</span>
          : <span>{filteredCount}</span>}
      </div>
      <div className="status-bar-right">
        <CloudDownloadIcon size={14} />
        <span>{formatSpeed(totalSpeed)}</span>
      </div>
    </div>
  );
}
