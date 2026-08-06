import { useEffect, useRef, useState } from "react";
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
  onCancel: () => void;
  onConfirm: (request: DestructiveActionRequest) => void;
}

export default function DestructiveActionGate({ request, onCancel, onConfirm }: DestructiveActionGateProps) {
  const [keys, setKeys] = useState<[boolean, boolean]>([false, false]);
  const [progress, setProgress] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstKeyRef = useRef<HTMLButtonElement>(null);

  const actionName = request.deleteFile ? "remove the downloads and delete their files" : "remove the downloads from the list";
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
            <h2 id="destructive-gate-title" ref={headingRef}>Confirm destructive action</h2>
          </div>
          <button type="button" className="dialog-close-btn" aria-label="Emergency exit" onClick={onCancel}>
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="dialog-body destructive-gate-body">
          <p id="destructive-gate-description" className="destructive-gate-warning">
            This will {actionName} for {request.itemIds.length} selected {request.itemIds.length === 1 ? "item" : "items"}. The action cannot be undone here.
          </p>
          <p className="destructive-gate-instruction">
            Operate both authorization keys independently, then move the slider across its full range. Escape or Emergency exit cancels without changing anything.
          </p>

          <div className="destructive-key-grid" aria-label="Independent authorization keys">
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
                <span>Authorization key {index + 1}</span>
                <small>{keys[index] ? "Armed" : "Press to arm"}</small>
              </button>
            ))}
          </div>

          <label className="destructive-slider-label" htmlFor="destructive-confirm-slider">
            Full-range confirmation: {progress}%
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
              Authorization complete. Applying {actionName}…
            </div>
          )}
        </div>

        <div className="dialog-footer destructive-gate-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={authorized}>
            Emergency exit
          </button>
          <span className="spacer" />
          <span className="destructive-gate-state" aria-live="polite">
            {authorized ? "Authorized" : bothKeysReady ? "Slider unlocked" : "Authorization required"}
          </span>
        </div>
      </section>
    </div>
  );
}
