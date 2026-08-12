import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  /** Menus containing editable controls are contextual dialogs, not ARIA menus. */
  role?: "menu" | "dialog";
}

/** A small positioned, self-closing popup menu. No external dependency. */
export default function ContextMenu({ x, y, onClose, children, label = "Context menu", role = "menu" }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reposition = () => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
      setPos((current) => current.left === left && current.top === top && current.visible
        ? current
        : { left, top, visible: true });
    };

    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(el);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [x, y]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role={role}
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
  menuItem = true,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  menuItem?: boolean;
}) {
  return (
    <button
      type="button"
      {...(menuItem ? { role: "menuitem" } : {})}
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
