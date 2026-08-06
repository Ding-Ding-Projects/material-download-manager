import { useEffect, useMemo, useState } from "react";
import { CloseIcon, InfoIcon, RefreshIcon } from "./icons";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationInput {
  title: string;
  message: string;
  tone?: NotificationTone;
  timeoutMs?: number;
}

interface NotificationRecord extends Omit<NotificationInput, "tone"> {
  id: string;
  createdAt: number;
  tone: NotificationTone;
  dismissed: boolean;
}

const NOTIFICATION_EVENT = "mdm:notification";
let nextNotificationId = 0;

export function notify(input: NotificationInput): string {
  const id = `notification-${Date.now()}-${++nextNotificationId}`;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { ...input, id } }));
  }
  return id;
}

function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "The operation could not be completed.";
}

function toneLabel(tone: NotificationTone): string {
  switch (tone) {
    case "success":
      return "Success";
    case "warning":
      return "Warning";
    case "error":
      return "Error";
    default:
      return "Information";
  }
}

export default function NotificationCenter() {
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

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
      setRecords((current) => [...current, record].slice(-30));

      const timeoutMs = record.timeoutMs ?? (record.tone === "error" || record.tone === "warning" ? 0 : 6500);
      if (timeoutMs > 0) {
        const timeoutId = window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          setRecords((current) =>
            current.map((candidate) => (candidate.id === record.id ? { ...candidate, dismissed: true } : candidate))
          );
        }, timeoutMs);
        timeoutIds.add(timeoutId);
      }
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      event.preventDefault();
      notify({ title: "Operation failed", message: rejectionMessage(event.reason), tone: "error" });
    }

    window.addEventListener(NOTIFICATION_EVENT, addRecord);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, addRecord);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const activeRecords = useMemo(() => records.filter((record) => !record.dismissed), [records]);

  function dismiss(id: string) {
    setRecords((current) => current.map((record) => (record.id === id ? { ...record, dismissed: true } : record)));
  }

  return (
    <aside className="notification-center" aria-label="Notification centre">
      <div className="notification-stack" aria-live="polite" aria-atomic="false">
        {activeRecords.map((record) => (
          <section
            key={record.id}
            className={`notification-toast notification-toast-${record.tone}`}
            role={record.tone === "error" || record.tone === "warning" ? "alert" : "status"}
          >
            <span className="notification-icon" aria-hidden="true">
              {record.tone === "error" ? <RefreshIcon size={16} /> : <InfoIcon size={16} />}
            </span>
            <div className="notification-copy">
              <strong>{record.title}</strong>
              <span>{record.message}</span>
            </div>
            <button
              type="button"
              className="notification-dismiss"
              aria-label={`Dismiss ${toneLabel(record.tone)} notification`}
              onClick={() => dismiss(record.id)}
            >
              <CloseIcon size={14} />
            </button>
          </section>
        ))}
      </div>

      {records.length > 0 && (
        <div className="notification-center-controls">
          <button
            type="button"
            className="notification-history-button"
            aria-expanded={historyOpen}
            aria-controls="notification-history"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <InfoIcon size={14} />
            Notifications ({records.length})
          </button>
          {historyOpen && (
            <div id="notification-history" className="notification-history" role="region" aria-label="Notification history">
              <div className="notification-history-header">
                <strong>Notification history</strong>
                <button
                  type="button"
                  className="notification-dismiss"
                  aria-label="Close notification history"
                  onClick={() => setHistoryOpen(false)}
                >
                  <CloseIcon size={14} />
                </button>
              </div>
              <div className="notification-history-list">
                {[...records].reverse().map((record) => (
                  <div key={record.id} className={`notification-history-item notification-history-item-${record.tone}`}>
                    <strong>{record.title}</strong>
                    <span>{record.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
