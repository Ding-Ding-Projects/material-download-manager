import { useEffect, useState } from "react";
import type { PartInfo } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import { formatBytes, formatEta, percentOf } from "../utils/format";
import { CATEGORY_LABELS } from "../utils/category";
import Dialog from "./Dialog";
import {
  CategoryIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  PauseIcon,
  RefreshIcon,
  ResumeIcon,
} from "./icons";

const STATUS_TEXT: Record<string, string> = {
  added: "Added",
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  error: "Error",
  cancelled: "Cancelled",
};

const PART_STATUS_TEXT: Record<PartInfo["status"], string> = {
  idle: "Idle",
  connecting: "Connecting",
  downloading: "Receiving Data",
  completed: "Completed",
  error: "Error",
};

function partColor(status: PartInfo["status"]): string {
  switch (status) {
    case "completed":
    case "downloading":
      return "part-green";
    case "connecting":
      return "part-amber";
    case "error":
      return "part-red";
    default:
      return "part-gray";
  }
}

export default function DownloadDetailsDialog({ itemId }: { itemId: string }) {
  const item = useAppStore((s) => s.items.find((i) => i.id === itemId));
  const closeDetails = useAppStore((s) => s.closeDetails);
  const pauseDownload = useAppStore((s) => s.pauseDownload);
  const resumeDownload = useAppStore((s) => s.resumeDownload);
  const retryDownload = useAppStore((s) => s.retryDownload);
  const queues = useAppStore((s) => s.queues);

  const [tab, setTab] = useState<"info" | "settings">("info");
  const [partsExpanded, setPartsExpanded] = useState(true);

  useEffect(() => {
    if (!item) closeDetails();
  }, [item, closeDetails]);

  if (!item) return null;

  const percent = percentOf(item.downloadedSize, item.totalSize);
  const queueName = queues.find((q) => q.id === item.queueId)?.name ?? "None";

  return (
    <Dialog
      title={`${percent !== null ? `${percent}%-` : ""}${item.fileName}`}
      icon={<CategoryIcon category={item.category} size={16} />}
      onClose={closeDetails}
      width={560}
      className="details-dialog"
    >
      <div className="dialog-tabs">
        <button type="button" className={`dialog-tab${tab === "info" ? " active" : ""}`} onClick={() => setTab("info")}>
          Info
        </button>
        <button type="button" className={`dialog-tab${tab === "settings" ? " active" : ""}`} onClick={() => setTab("settings")}>
          Settings
        </button>
      </div>

      {tab === "info" ? (
        <div className="info-grid">
          <InfoRow label="Name" value={item.fileName} />
          <InfoRow label="Status" value={STATUS_TEXT[item.status]} />
          <InfoRow label="Size" value={formatBytes(item.totalSize)} />
          <InfoRow label="Downloaded" value={formatBytes(item.downloadedSize)} />
          <InfoRow label="Speed" value={item.status === "downloading" ? `${formatBytes(item.speed)}/s` : "—"} />
          <InfoRow label="Remaining Time" value={item.status === "downloading" ? formatEta(item.eta) || "—" : "—"} />
          <InfoRow
            label="Resume Support"
            value={item.resumeSupport ? "Yes" : "No"}
            valueClassName={item.resumeSupport ? "text-success" : "text-danger"}
          />
        </div>
      ) : (
        <div className="info-grid">
          <InfoRow label="URL" value={item.url} mono />
          <InfoRow label="Save Folder" value={item.folder} mono />
          <InfoRow label="Category" value={CATEGORY_LABELS[item.category]} />
          <InfoRow label="Queue" value={queueName} />
          <InfoRow label="Connections" value={String(item.connections)} />
          {item.error && <InfoRow label="Last Error" value={item.error} valueClassName="text-danger" />}
        </div>
      )}

      <div className="details-progress-track">
        <div
          className={`progress-fill status-${item.status}${percent === null ? " indeterminate" : ""}`}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>

      <div className="part-info-header">
        <button
          type="button"
          className="part-info-toggle"
          onClick={() => setPartsExpanded((v) => !v)}
        >
          {partsExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
          <span>Part Info</span>
        </button>
        <div className="part-info-actions">
          {item.status === "error" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retryDownload(item.id)}>
              <RefreshIcon size={14} />
              Retry
            </button>
          ) : item.status === "downloading" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void pauseDownload(item.id)}>
              <PauseIcon size={14} />
              Pause
            </button>
          ) : item.status === "paused" || item.status === "added" || item.status === "queued" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resumeDownload(item.id)}>
              <ResumeIcon size={14} />
              Resume
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetails}>
            <CloseIcon size={14} />
            Close
          </button>
        </div>
      </div>

      {partsExpanded && (
        <>
          <div className="part-strip">
            {item.parts.map((part) => (
              <span key={part.id} className={`part-chip ${partColor(part.status)}`} title={PART_STATUS_TEXT[part.status]} />
            ))}
          </div>
          <div className="part-table-scroll">
            <table className="part-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Downloaded</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {item.parts.map((part) => {
                  const downloaded = Math.max(0, part.current - part.from);
                  const total = part.to !== null ? part.to - part.from + 1 : null;
                  return (
                    <tr key={part.id}>
                      <td>{part.id}</td>
                      <td>
                        <span className={`part-dot ${partColor(part.status)}`} />
                        {PART_STATUS_TEXT[part.status]}
                      </td>
                      <td>{formatBytes(downloaded)}</td>
                      <td>{total !== null ? formatBytes(total) : "Unknown"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {item.sshProgress && item.sshProgress.length > 0 && (
        <section className="field" aria-labelledby="ssh-transfer-progress-heading">
          <h3 id="ssh-transfer-progress-heading">SSH worker progress</h3>
          <div className="part-table-scroll">
            <table className="part-table">
              <thead><tr><th>Host</th><th>Range</th><th>Bytes</th><th>Rate</th><th>State</th></tr></thead>
              <tbody>
                {item.sshProgress.map((progress) => (
                  <tr key={progress.hostId}>
                    <td>{progress.hostId.slice(0, 8)}</td>
                    <td>{progress.rangeStart !== null && progress.rangeStart !== undefined && progress.rangeEndExclusive !== null && progress.rangeEndExclusive !== undefined
                      ? `${progress.rangeStart}–${progress.rangeEndExclusive - 1}`
                      : "—"}</td>
                    <td>{formatBytes(progress.transferredBytes ?? 0)}</td>
                    <td>{formatBytes(progress.bytesPerSecond ?? 0)}/s</td>
                    <td>{progress.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Dialog>
  );
}

function InfoRow({
  label,
  value,
  mono,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="info-row">
      <span className="info-label">{label}:</span>
      <span className={`info-value${mono ? " mono" : ""}${valueClassName ? ` ${valueClassName}` : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}
