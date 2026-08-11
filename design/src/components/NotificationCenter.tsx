import { useEffect, useMemo, useState } from "react";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import { CloseIcon, InfoIcon, RefreshIcon } from "./icons";
import DestructiveActionGate from "./DestructiveActionGate";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationInput {
  title: string;
  message: string;
  tone?: NotificationTone;
  timeoutMs?: number;
  /** Decorative only; never part of the accessible name or action label. */
  emoji?: string;
}

interface NotificationRecord extends Omit<NotificationInput, "tone"> {
  id: string;
  createdAt: number;
  tone: NotificationTone;
  dismissed: boolean;
}

const NOTIFICATION_EVENT = "mdm:notification";
let nextNotificationId = 0;

function toneEmoji(tone: NotificationTone | undefined): string {
  switch (tone) {
    case "success":
      return "✅";
    case "warning":
    case "error":
      return "⚠️";
    default:
      return "💬";
  }
}

export function notify(input: NotificationInput): string {
  const id = `notification-${Date.now()}-${++nextNotificationId}`;
  if (typeof window !== "undefined") {
    const settings = useAppStore.getState().settings;
    const emoji = settings?.showEmojis && !settings.schoolModeEnabled
      ? input.emoji ?? toneEmoji(input.tone)
      : undefined;
    window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { ...input, emoji, id } }));
  }
  return id;
}

function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "The operation could not be completed.";
}

function toneLabel(tone: NotificationTone, copy: ReturnType<typeof getUiCopy>): string {
  switch (tone) {
    case "success":
      return copy.text("Success", "成功");
    case "warning":
      return copy.text("Warning", "警告");
    case "error":
      return copy.text("Error", "錯誤");
    default:
      return copy.text("Information", "資訊");
  }
}

function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function NotificationCenter() {
  const settings = useAppStore((state) => state.settings);
  const copy = getUiCopy(settings);
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<string[] | null>(null);

  useEffect(() => {
    const timeoutIds = new Set<number>();

    function addRecord(event: Event) {
      const detail = (event as CustomEvent<NotificationRecord>).detail;
      if (!detail?.title || !detail.message) return;
      const record: NotificationRecord = {
        ...detail,
        id: detail.id ?? `notification-${Date.now()}-${++nextNotificationId}`,
        tone: detail.tone ?? "info",
        createdAt: detail.createdAt ?? Date.now(),
        dismissed: false,
      };
      setRecords((current) => [...current, record].slice(-50));

      const timeoutMs = record.timeoutMs ?? (record.tone === "error" || record.tone === "warning" ? 0 : 6500);
      if (timeoutMs > 0) {
        const timeoutId = window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          setRecords((current) => current.map((candidate) => candidate.id === record.id ? { ...candidate, dismissed: true } : candidate));
        }, timeoutMs);
        timeoutIds.add(timeoutId);
      }
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      event.preventDefault();
      notify({ title: copy.text("Operation failed", "操作失敗"), message: rejectionMessage(event.reason), tone: "error" });
    }

    window.addEventListener(NOTIFICATION_EVENT, addRecord);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, addRecord);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [copy]);

  const activeRecords = useMemo(() => records.filter((record) => !record.dismissed), [records]);
  const historyRecords = useMemo(() => [...records].reverse(), [records]);
  const selectedCount = selectedIds.size;
  const allSelected = records.length > 0 && records.every((record) => selectedIds.has(record.id));

  function dismiss(id: string) {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, dismissed: true } : record));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(records.map((record) => record.id)));
  }

  function invertSelection() {
    setSelectedIds(new Set(records.filter((record) => !selectedIds.has(record.id)).map((record) => record.id)));
  }

  function dismissSelected() {
    if (selectedCount === 0) return;
    setRecords((current) => current.map((record) => selectedIds.has(record.id) ? { ...record, dismissed: true } : record));
    setSelectedIds(new Set());
  }

  function exportSelected() {
    const exported = records.filter((record) => selectedIds.has(record.id));
    if (exported.length === 0) return;
    downloadBlob("material-download-manager-notifications.json", `${JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records: exported }, null, 2)}\n`, "application/json");
  }

  function confirmDelete() {
    if (!deleteRequest) return;
    const requested = new Set(deleteRequest);
    setRecords((current) => current.filter((record) => !requested.has(record.id)));
    setSelectedIds((current) => new Set([...current].filter((id) => !requested.has(id))));
    setDeleteRequest(null);
  }

  return (
    <aside className="notification-center" aria-label={copy.notifications}>
      <div className="notification-stack" aria-live="polite" aria-atomic="false">
        {activeRecords.map((record) => (
          <section key={record.id} className={`notification-toast notification-toast-${record.tone}`} role={record.tone === "error" || record.tone === "warning" ? "alert" : "status"}>
            <span className="notification-icon" aria-hidden="true">{record.emoji ?? (record.tone === "error" ? <RefreshIcon size={16} /> : <InfoIcon size={16} />)}</span>
            <div className="notification-copy"><strong>{record.title}</strong><span>{record.message}</span></div>
            <button type="button" className="notification-dismiss" aria-label={copy.text(`Dismiss ${toneLabel(record.tone, copy)} notification`, `消除${toneLabel(record.tone, copy)}通知`)} onClick={() => dismiss(record.id)}><CloseIcon size={14} /></button>
          </section>
        ))}
      </div>

      {(records.length > 0 || historyOpen) && (
        <div className="notification-center-controls">
          <button type="button" className="notification-history-button" aria-expanded={historyOpen} aria-controls="notification-history" onClick={() => setHistoryOpen((open) => !open)}>
            <InfoIcon size={14} /> {copy.notifications} ({records.length})
          </button>
          {historyOpen && (
            <div id="notification-history" className="notification-history" role="region" aria-label={copy.notificationHistory}>
              <div className="notification-history-header">
                <strong>{copy.notificationHistory}</strong>
                <button type="button" className="notification-dismiss" aria-label={copy.closeNotificationHistory} onClick={() => setHistoryOpen(false)}><CloseIcon size={14} /></button>
              </div>
              {records.length > 0 ? (
                <>
                  <div className="notification-history-actions" role="toolbar" aria-label={copy.text("Notification bulk actions", "通知批量操作")}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll}>{allSelected ? copy.text("Clear selection", "清除選取") : copy.selectAll}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={invertSelection}>{copy.invertSelection}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={dismissSelected} disabled={selectedCount === 0}>{copy.dismissSelected}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={exportSelected} disabled={selectedCount === 0}>{copy.exportSelected}</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteRequest([...selectedIds])} disabled={selectedCount === 0}>{copy.deleteSelected}</button>
                  </div>
                  <span className="setting-helper notification-selection-count" aria-live="polite">{selectedCount} {copy.text("selected", "個已選")}</span>
                  <div className="notification-history-list" role="list">
                    {historyRecords.map((record) => (
                      <div key={record.id} className={`notification-history-item notification-history-item-${record.tone}`} role="listitem">
                        <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelected(record.id)} aria-label={`${copy.text("Select", "選取")} ${record.title}`} />
                        <div className="notification-history-copy"><strong>{record.title}</strong><span>{record.message}</span><small>{new Date(record.createdAt).toLocaleString()} · {record.dismissed ? copy.text("Dismissed", "已消除") : copy.text("Active", "生效中")}</small></div>
                        {!record.dismissed && <button type="button" className="notification-dismiss" aria-label={copy.text("Dismiss notification", "消除通知")} onClick={() => dismiss(record.id)}><CloseIcon size={14} /></button>}
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="notification-history-empty">{copy.noNotifications}</div>}
            </div>
          )}
        </div>
      )}

      {deleteRequest && (
        <DestructiveActionGate
          request={{ itemIds: deleteRequest, deleteFile: false }}
          actionName={copy.text("delete the selected notification history entries", "刪除已選通知紀錄")}
          onCancel={() => setDeleteRequest(null)}
          onConfirm={confirmDelete}
        />
      )}
    </aside>
  );
}
