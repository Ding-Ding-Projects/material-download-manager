import type { ReactNode } from "react";
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
}

export default function Dialog({ title, icon, onClose, width = 460, children, footer, className }: DialogProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${className ? ` ${className}` : ""}`} style={{ width }}>
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
