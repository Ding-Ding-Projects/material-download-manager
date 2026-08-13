import { useEffect, useState } from "react";
import type { AppSettings, BrowserHandoffStart } from "@shared/types";
import { useUiCopy } from "../i18n/useUiCopy";
import { CloseIcon, FolderIcon, PlayIcon } from "./icons";
import "../styles/browser-handoff.css";

/**
 * A dedicated desktop-owned decision window for a browser-captured download.
 * It deliberately has no transfer controls: confirmation hands work to the
 * durable main-process manager, while declining resumes Chrome's original item.
 */
export default function BrowserHandoffStartWindow() {
  const [handoff, setHandoff] = useState<BrowserHandoffStart | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [fileName, setFileName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<"start" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = useUiCopy(settings);

  useEffect(() => {
    let active = true;
    void Promise.all([window.api.getBrowserHandoffStart(), window.api.getSettings()])
      .then(([nextHandoff, nextSettings]) => {
        if (!active) return;
        setHandoff(nextHandoff);
        setSettings(nextSettings);
        setFileName(nextHandoff.fileName);
        setFolder(nextHandoff.folder);
      })
      .catch(() => {
        if (active) setError(copy.text("This Start download request is no longer available. Chrome will keep the original download.", "呢個開始下載要求已經唔再可用。Chrome 會保留原本下載。"));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) void keepInChrome();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy]);

  async function browseFolder() {
    if (busy) return;
    const selected = await window.api.pickFolder();
    if (selected) setFolder(selected);
  }

  async function startDownload() {
    if (busy) return;
    if (!fileName.trim() || !folder.trim()) {
      setError(copy.text("Choose a file name and a save folder before starting the download.", "開始下載之前請揀檔案名稱同儲存資料夾。"));
      return;
    }
    setBusy("start");
    setError(null);
    try {
      await window.api.approveBrowserHandoff({ fileName: fileName.trim(), folder: folder.trim() });
    } catch (reason) {
      setBusy(null);
      setError(reason instanceof Error ? reason.message : copy.text("The download could not be started. Keep it in Chrome or try again.", "未能開始下載。可以留喺 Chrome 或者再試。"));
    }
  }

  async function keepInChrome() {
    if (busy) return;
    setBusy("keep");
    try {
      await window.api.rejectBrowserHandoff();
    } catch (reason) {
      setBusy(null);
      setError(reason instanceof Error ? reason.message : copy.text("Chrome could not be released yet. Try again.", "暫時未能交返畀 Chrome。請再試。"));
    }
  }

  const connections = handoff?.connections ?? 0;
  return (
    <div className="browser-handoff-window" data-surface="browser-handoff-start" aria-busy={busy !== null}>
      <header className="browser-handoff-titlebar">
        <div>
          <p>{copy.text("Browser capture", "瀏覽器擷取")}</p>
          <h1>{copy.text("Start download", "開始下載")}</h1>
        </div>
        <button
          type="button"
          className="browser-handoff-close"
          aria-label={copy.text("Keep this download in Chrome and close", "保留呢個下載喺 Chrome 並關閉")}
          disabled={busy !== null}
          onClick={() => void keepInChrome()}
        >
          <CloseIcon size={18} />
        </button>
      </header>

      <main className="browser-handoff-content">
        <p className="browser-handoff-intro">
          {copy.text(
            "Chrome has paused this download while you decide. Starting it transfers the job to the desktop app; keeping it in Chrome resumes the original browser download.",
            "Chrome 已暫停呢個下載等你決定。開始下載會交畀桌面程式；留喺 Chrome 會恢復原本瀏覽器下載。",
          )}
        </p>

        {handoff ? (
          <>
            <dl className="browser-handoff-summary">
              <div><dt>{copy.text("Source", "來源")}</dt><dd title={handoff.url}>{handoff.url}</dd></div>
              <div><dt>{copy.text("Transfer", "傳輸")}</dt><dd>{copy.text(`Up to ${connections} parts when the server supports ranges.`, `伺服器支援範圍下載時最多 ${connections} 段。`)}</dd></div>
            </dl>

            <label className="browser-handoff-field">
              <span>{copy.text("File name", "檔案名稱")}</span>
              <input value={fileName} maxLength={512} onChange={(event) => setFileName(event.target.value)} disabled={busy !== null} aria-label={copy.text("Download file name", "下載檔案名稱")} />
            </label>
            <label className="browser-handoff-field">
              <span>{copy.text("Save folder", "儲存資料夾")}</span>
              <div className="browser-handoff-folder-input">
                <input value={folder} maxLength={32768} onChange={(event) => setFolder(event.target.value)} disabled={busy !== null} aria-label={copy.text("Download save folder", "下載儲存資料夾")} />
                <button type="button" className="btn btn-ghost" onClick={() => void browseFolder()} disabled={busy !== null}>
                  <FolderIcon size={16} />
                  <span>{copy.text("Browse", "瀏覽")}</span>
                </button>
              </div>
            </label>
          </>
        ) : <p className="browser-handoff-loading" role="status">{copy.text("Loading the browser download…", "載入緊瀏覽器下載…")}</p>}

        {error && <p className="browser-handoff-error" role="alert">{error}</p>}
      </main>

      <footer className="browser-handoff-actions">
        <p>{copy.text("Closing the later Downloading window never cancels the background transfer. Right-click its row to reopen that window.", "之後關閉下載中視窗唔會取消背景傳輸。右撳該列可以重新開啟視窗。")}</p>
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => void keepInChrome()} disabled={busy !== null}>
            {busy === "keep" ? copy.text("Keeping in Chrome…", "留喺 Chrome 中…") : copy.text("Keep in Chrome", "留喺 Chrome")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void startDownload()} disabled={!handoff || busy !== null}>
            <PlayIcon size={16} />
            <span>{busy === "start" ? copy.text("Starting…", "開始緊…") : copy.text("Start download", "開始下載")}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
