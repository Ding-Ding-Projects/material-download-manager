import { useEffect, useMemo, useState } from "react";
import { readProgressWindowItemId } from "@shared/progressWindow";
import type { DownloadItem, DownloadStatus } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "../i18n/ui";
import { formatBytes, formatEta, formatSpeed } from "../utils/format";
import { CloseIcon, LogoIcon, MinimizeIcon, PauseIcon, ResumeIcon, StopIcon } from "./icons";
import "../styles/progress.css";

function progressValue(item: DownloadItem | null): number {
  if (!item) return 0;
  if (item.status === "completed") return 100;
  if (!item.totalSize || item.totalSize <= 0) return 0;
  return Math.max(0, Math.min(100, (item.downloadedSize / item.totalSize) * 100));
}

function statusLabel(copy: ReturnType<typeof getUiCopy>, item: DownloadItem | null): string {
  if (!item) return copy.funny(["Waiting", "Waiting; the window is ready.", "Waiting; the progress card is standing by.", "Waiting; the tiny progress clerk is on break.", "Waiting; the progress orchestra is still tuning."], ["等緊", "等緊，個視窗準備好喇。", "等緊，進度卡企定定等候中。", "等緊，細細隻進度文員去咗飲茶。", "等緊，進度樂隊仲喺調音。"]);
  const labels: Record<DownloadStatus, [string, string]> = {
    added: ["Added", "已加入"],
    queued: ["Queued", "已排隊"],
    downloading: ["Downloading", "下載緊"],
    paused: ["Paused", "已暫停"],
    completed: ["Finished", "完成"],
    error: ["Error", "錯誤"],
    cancelled: ["Cancelled", "已取消"],
  };
  const [english, cantonese] = labels[item.status];
  return copy.funny(
    [english, `${english}; the transfer state is unchanged.`, `${english}; the download gears are reporting in.`, `${english}; even the progress gremlins logged it.`, `${english}; the transfer orchestra has found its cue.`],
    [cantonese, `${cantonese}，傳輸狀態冇變。`, `${cantonese}，下載齒輪報到喇。`, `${cantonese}，連進度小鬼都記低咗。`, `${cantonese}，傳輸樂隊搵到拍子喇。`],
  );
}

export default function ProgressWindow() {
  const ready = useAppStore((state) => state.ready);
  const items = useAppStore((state) => state.items);
  const settings = useAppStore((state) => state.settings);
  const displayName = settings?.displayName ?? "Material Download Manager";
  const pauseDownload = useAppStore((state) => state.pauseDownload);
  const resumeDownload = useAppStore((state) => state.resumeDownload);
  const cancelDownload = useAppStore((state) => state.cancelDownload);
  const [targetId, setTargetId] = useState(() => readProgressWindowItemId(window.location.search));
  const copy = useMemo(() => getUiCopy(settings), [settings]);
  const item = items.find((candidate) => candidate.id === targetId) ?? null;
  const percent = progressValue(item);
  const name = item?.fileName || item?.url || copy.text("Download progress", "下載進度");

  useEffect(() => {
    const unsubscribeState = useAppStore.getState().init();
    const unsubscribeTarget = window.api.onProgressTargetChanged((nextTargetId) => setTargetId(nextTargetId));
    return () => {
      unsubscribeState();
      unsubscribeTarget();
    };
  }, []);

  function handlePauseResume() {
    if (!item) return;
    if (item.status === "downloading" || item.status === "queued") void pauseDownload(item.id);
    else if (item.status === "paused" || item.status === "added") void resumeDownload(item.id);
  }

  const canPauseResume = item && ["downloading", "queued", "paused", "added"].includes(item.status);
  const canCancel = item && ["added", "queued", "downloading", "paused"].includes(item.status);

  return (
    <div className="progress-window" data-surface="progress-window">
      <header className="progress-titlebar">
        <div className="progress-titlebar-brand">
          <LogoIcon size={20} />
          <span title={`${displayName} · ${copy.text("Download progress", "下載進度")}`}>
            {displayName} · {copy.text("Download progress", "下載進度")}
          </span>
        </div>
        <div className="progress-titlebar-controls">
          <button type="button" className="progress-titlebar-btn" aria-label={copy.text("Minimize", "最小化")} onClick={() => window.api.minimizeProgressWindow()}>
            <MinimizeIcon size={14} />
          </button>
          <button type="button" className="progress-titlebar-btn progress-titlebar-btn-close" aria-label={copy.close} onClick={() => window.api.closeProgressWindow()}>
            <CloseIcon size={15} />
          </button>
        </div>
      </header>

      <main className="progress-content" aria-live="polite">
        <section className="progress-card" aria-labelledby="progress-window-heading">
          <div className="progress-card-heading">
            <div>
              <p className="progress-eyebrow">{copy.text("Live download", "即時下載")}</p>
              <h1 id="progress-window-heading">{name}</h1>
              {item?.url && <p className="progress-url" title={item.url}>{item.url}</p>}
            </div>
            <span className={`progress-status progress-status-${item?.status ?? "added"}`}>{statusLabel(copy, item)}</span>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-label={copy.text(`${name} download progress`, `${name} 下載進度`)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={`${Math.round(percent)}%`}
          >
            <span className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-metrics">
            <strong>{Math.round(percent)}%</strong>
            <span>{item ? `${formatBytes(item.downloadedSize)}${item.totalSize ? ` / ${formatBytes(item.totalSize)}` : ""}` : copy.text("No download selected", "未選擇下載")}</span>
            <span>{item?.speed ? formatSpeed(item.speed) : copy.text("Waiting for transfer", "等緊傳輸")}</span>
            <span>{item?.eta !== null && item?.eta !== undefined ? formatEta(item.eta) : "—"}</span>
          </div>

          {item?.error && <p className="progress-error" role="alert">{copy.downloadError(name, item.error)}</p>}

          {!ready && <p className="progress-note">{copy.text("Connecting to the download engine…", "連接緊下載引擎…")}</p>}
          {ready && !item && <p className="progress-note">{copy.text("This download is no longer available in the manager.", "呢個下載已經唔喺管理器入面。")}</p>}

          <div className="progress-actions">
            {canPauseResume && (
              <button type="button" className="progress-action-btn progress-action-primary" onClick={handlePauseResume}>
                {item?.status === "downloading" || item?.status === "queued" ? <PauseIcon size={16} /> : <ResumeIcon size={16} />}
                <span>{item?.status === "downloading" || item?.status === "queued" ? copy.text("Pause", "暫停") : copy.text("Resume", "繼續")}</span>
              </button>
            )}
            {canCancel && (
              <button type="button" className="progress-action-btn" onClick={() => item && void cancelDownload(item.id)}>
                <StopIcon size={16} />
                <span>{copy.text("Cancel", "取消")}</span>
              </button>
            )}
            <button type="button" className="progress-action-btn" onClick={() => window.api.closeProgressWindow()}>
              <CloseIcon size={16} />
              <span>{copy.text("Close window", "關閉視窗")}</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
