import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect } from "react";
import { CloseIcon } from "./icons";

interface DialogProps {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Return true when a nested surface owns this Escape press. */
  onEscape?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
}

export default function Dialog({ title, icon, onClose, width = 460, children, footer, className, onEscape }: DialogProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !onEscape?.(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog${className ? ` ${className}` : ""}`}
        style={{ width }}
        onKeyDownCapture={handleDialogKeyDown}
      >
        <div className="dialog-header">
          <div className="dialog-header-title">
            {icon}
            <span>{title}</span>
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
