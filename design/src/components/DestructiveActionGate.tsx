import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "../i18n/ui";
import { CloseIcon, ErrorIcon, TrashIcon } from "./icons";

export interface DestructiveActionRequest {
  itemIds: string[];
  deleteFile: boolean;
}

const DESTRUCTIVE_REQUEST_EVENT = "mdm:request-destructive-action";
const CLOSE_CONTEXT_MENU_EVENT = "mdm:close-context-menus";

export function requestDestructiveAction(request: DestructiveActionRequest) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DESTRUCTIVE_REQUEST_EVENT, { detail: request }));
  }
}

interface DestructiveActionGateProps {
  request: DestructiveActionRequest;
  actionName?: string;
  affectedLabel?: string;
  onCancel: () => void;
  onConfirm: (request: DestructiveActionRequest) => void;
}

export default function DestructiveActionGate({ request, actionName: actionNameOverride, affectedLabel: affectedLabelOverride, onCancel, onConfirm }: DestructiveActionGateProps) {
  const settings = useAppStore((state) => state.settings);
  const copy = getUiCopy(settings);
  const [keys, setKeys] = useState<[boolean, boolean]>([false, false]);
  const [progress, setProgress] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstKeyRef = useRef<HTMLButtonElement>(null);

  const actionName = actionNameOverride ?? (request.deleteFile
    ? copy.text("remove the downloads and delete their files", "移除下載項目並刪除檔案")
    : copy.text("remove the downloads from the list", "由清單移除下載項目"));
  const affectedLabel = affectedLabelOverride ?? copy.text("download", "下載項目");
  const bothKeysReady = keys[0] && keys[1];

  useEffect(() => {
    firstKeyRef.current?.focus();
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onCancel]);

  useEffect(() => {
    if (progress !== 100 || !bothKeysReady || authorized) return;
    setAuthorized(true);
    const timeoutId = window.setTimeout(() => {
      window.dispatchEvent(new Event(CLOSE_CONTEXT_MENU_EVENT));
      onConfirm(request);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [authorized, bothKeysReady, onConfirm, progress, request]);

  function toggleKey(index: 0 | 1) {
    if (authorized) return;
    setKeys((current) => {
      const next: [boolean, boolean] = [...current] as [boolean, boolean];
      next[index] = !next[index];
      return next;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-overlay destructive-gate-overlay" onMouseDown={(event) => event.stopPropagation()}>
      <section
        className={`dialog destructive-gate${authorized ? " authorized" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="destructive-gate-title"
        aria-describedby="destructive-gate-description"
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">
          <div className="dialog-header-title">
            <ErrorIcon size={16} />
            <h2 id="destructive-gate-title" ref={headingRef}>{copy.destructiveTitle}</h2>
          </div>
          <button type="button" className="dialog-close-btn" aria-label={copy.emergencyExit} onClick={onCancel}>
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="dialog-body destructive-gate-body">
          <p id="destructive-gate-description" className="destructive-gate-warning">
            This will {actionName} for {request.itemIds.length} selected {affectedLabel}{request.itemIds.length === 1 ? "" : "s"}. The action cannot be undone here.
          </p>
          <p className="destructive-gate-instruction">
             {copy.funny(
               [
                 "Operate both authorization keys independently, then move the slider across its full range. Escape or Emergency exit cancels without changing anything.",
                 "Operate both authorization keys independently, then move the slider across its full range. The action stays paused until you finish.",
                 "Operate both authorization keys independently, then move the slider across its full range. The deletion gremlin gets no shortcut.",
                 "Operate both authorization keys independently, then move the slider across its full range. Facts first; drama stays decorative.",
                 "Operate both authorization keys independently, then move the slider across its full range. The broom only moves after the paperwork.",
               ],
               [
                 "請分別操作兩把授權匙，再將滑桿推完整段；按 Escape 或緊急退出就會取消，唔會改任何嘢。",
                 "請分別操作兩把授權匙，再將滑桿推完整段；未完成之前操作會停低。",
                 "請分別操作兩把授權匙，再將滑桿推完整段；刪除小鬼冇捷徑。",
                 "請分別操作兩把授權匙，再將滑桿推完整段；事實行先，戲劇效果只係裝飾。",
                 "請分別操作兩把授權匙，再將滑桿推完整段；文件未齊，掃把唔郁。",
               ]
             )}
          </p>

          <div className="destructive-key-grid" aria-label={copy.text("Independent authorization keys", "獨立授權匙")}>
            {[0, 1].map((index) => (
              <button
                key={index}
                ref={index === 0 ? firstKeyRef : undefined}
                type="button"
                className={`destructive-key${keys[index] ? " armed" : ""}`}
                aria-pressed={keys[index]}
                onClick={() => toggleKey(index as 0 | 1)}
              >
                <span className="destructive-key-icon" aria-hidden="true"><TrashIcon size={15} /></span>
                 <span>{copy.text(`Authorization key ${index + 1}`, `授權匙 ${index + 1}`)}</span>
                 <small>{keys[index] ? copy.text("Armed", "已啟動") : copy.text("Press to arm", "按一下啟動")}</small>
              </button>
            ))}
          </div>

          <label className="destructive-slider-label" htmlFor="destructive-confirm-slider">
             {copy.text("Full-range confirmation", "完整範圍確認")}：{progress}%
          </label>
          <input
            id="destructive-confirm-slider"
            className="destructive-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={progress}
            disabled={!bothKeysReady || authorized}
            aria-valuetext={`${progress}% of the confirmation range`}
            onChange={(event) => setProgress(Number(event.target.value))}
          />
          <div className="destructive-slider-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          {authorized && (
            <div className="destructive-complete" role="status" aria-live="polite">
               {copy.text("Authorization complete. Applying", "授權完成，正在執行")} {actionName}…
            </div>
          )}
        </div>

        <div className="dialog-footer destructive-gate-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={authorized}>
             {copy.emergencyExit}
          </button>
          <span className="spacer" />
          <span className="destructive-gate-state" aria-live="polite">
             {authorized ? copy.text("Authorized", "已授權") : bothKeysReady ? copy.text("Slider unlocked", "滑桿已解鎖") : copy.text("Authorization required", "需要授權")}
          </span>
        </div>
      </section>
    </div>
  );
}
