import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { CloseIcon } from "./icons";

interface DialogProps {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  overlayClassName?: string;
  /** Return true when a nested surface owns this Escape press. */
  onEscape?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
}

export default function Dialog({ title, icon, onClose, width = 460, children, footer, className, overlayClassName, onEscape }: DialogProps) {
  const titleId = `mdm-dialog-title-${useId().replace(/:/g, "")}`;
  const returnFocusTarget = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // React removes the currently focused dialog control after effect cleanup.
      // Focus on the next frame so the browser cannot replace the initiating
      // control with <body> while the overlay unmounts.
      window.requestAnimationFrame(() => {
        const target = returnFocusTarget.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [onClose]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !onEscape?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className={`dialog-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog${className ? ` ${className}` : ""}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDownCapture={handleDialogKeyDown}
      >
        <div className="dialog-header">
          <div className="dialog-header-title">
            {icon}
            <span id={titleId}>{title}</span>
          </div>
          <button type="button" className="dialog-close-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
