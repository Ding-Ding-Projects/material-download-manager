import { useAppStore } from "../store/useAppStore";
import { useUiCopy } from "../i18n/useUiCopy";
import { CloseIcon, LogoIcon, MaximizeIcon, MinimizeIcon } from "./icons";

export default function TitleBar() {
  const minimizeWindow = useAppStore((s) => s.minimizeWindow);
  const maximizeWindow = useAppStore((s) => s.maximizeWindow);
  const closeWindow = useAppStore((s) => s.closeWindow);
  const settings = useAppStore((s) => s.settings);
  const displayName = settings?.displayName ?? "Material Download Manager";
  const copy = useUiCopy(settings);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <LogoIcon size={20} />
        <span className="titlebar-title" title={displayName}>{displayName}</span>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          aria-label={copy.text("Minimize", "最小化")}
          onClick={() => minimizeWindow()}
        >
          <MinimizeIcon size={14} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label={copy.text("Maximize", "最大化")}
          onClick={() => maximizeWindow()}
        >
          <MaximizeIcon size={13} />
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          aria-label={copy.close}
          onClick={() => closeWindow()}
        >
          <CloseIcon size={15} />
        </button>
      </div>
    </header>
  );
}
