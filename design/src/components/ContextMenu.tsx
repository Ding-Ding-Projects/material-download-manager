import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  label?: string;
}

/** A small positioned, self-closing popup menu. No external dependency. */
export default function ContextMenu({ x, y, onClose, children, label = "Context menu" }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top), visible: true });
  }, [x, y]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top, opacity: pos.visible ? 1 : 0 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function ContextMenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`context-menu-item${danger ? " danger" : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="context-menu-item-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="context-menu-separator" />;
}
