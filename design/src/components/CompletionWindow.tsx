import { useEffect, useState } from "react";
import type { AppSettings, DownloadCompletionNotice } from "@shared/types";
import { useUiCopy } from "../i18n/useUiCopy";
import { CheckIcon, CloseIcon } from "./icons";
import "../styles/browser-handoff.css";

/**
 * The app-controlled completion surface stays above other windows without
 * stealing focus. It is deliberately separate from the ordinary progress
 * monitor, which remains reopenable and non-topmost.
 */
export default function CompletionWindow() {
  const [notice, setNotice] = useState<DownloadCompletionNotice | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const copy = useUiCopy(settings);

  useEffect(() => {
    let active = true;
    void Promise.all([window.api.getCompletionNotice(), window.api.getSettings()])
      .then(([nextNotice, nextSettings]) => {
        if (!active) return;
        setNotice(nextNotice);
        setSettings(nextSettings);
      })
      .catch(() => {
        if (active) window.api.closeCompletionWindow();
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.api.closeCompletionWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="download-completion-window" data-surface="download-completion" role="status" aria-live="polite">
      <header className="browser-handoff-titlebar download-completion-titlebar">
        <div>
          <p>{copy.text("Download", "下載")}</p>
          <h1>{copy.text("Download complete", "下載完成")}</h1>
        </div>
        <button
          type="button"
          className="browser-handoff-close"
          aria-label={copy.text("Close download complete notification", "關閉下載完成通知")}
          onClick={() => window.api.closeCompletionWindow()}
        >
          <CloseIcon size={18} />
        </button>
      </header>

      <main className="download-completion-content">
        <div className="download-completion-mark" aria-hidden="true"><CheckIcon size={24} /></div>
        <div>
          <p>{copy.text("The background transfer has finished.", "背景傳輸已經完成。")}</p>
          <strong title={notice?.fileName}>{notice?.fileName ?? copy.text("Finalizing completion notice…", "完成通知準備緊…")}</strong>
        </div>
      </main>

      <footer className="download-completion-actions">
        <button type="button" className="btn btn-primary" onClick={() => window.api.closeCompletionWindow()}>
          {copy.text("Close", "關閉")}
        </button>
      </footer>
    </div>
  );
}
