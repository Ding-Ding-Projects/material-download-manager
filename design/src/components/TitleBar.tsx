import { useAppStore } from "../store/useAppStore";
import { CloseIcon, LogoIcon, MaximizeIcon, MinimizeIcon } from "./icons";

export default function TitleBar() {
  const minimizeWindow = useAppStore((s) => s.minimizeWindow);
  const maximizeWindow = useAppStore((s) => s.maximizeWindow);
  const closeWindow = useAppStore((s) => s.closeWindow);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <LogoIcon size={20} />
        <span className="titlebar-title">Material Download Manager</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Minimize"
          onClick={() => minimizeWindow()}
        >
          <MinimizeIcon size={14} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Maximize"
          onClick={() => maximizeWindow()}
        >
          <MaximizeIcon size={13} />
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          aria-label="Close"
          onClick={() => closeWindow()}
        >
          <CloseIcon size={15} />
        </button>
      </div>
    </header>
  );
}
