import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat } from "@shared/export";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import type { ChangelogView, ChangelogViewRequest } from "../../electron/history/ChangelogStore";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import RegexBuilder from "./RegexBuilder";
import { HistoryIcon } from "./icons";

const EXPORT_FORMATS: readonly ExportFormat[] = ["markdown", "json", "jsonl", "yaml", "toml", "csv", "html"];

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function releaseSummary(view: ChangelogView, copy: ReturnType<typeof getUiCopy>): string {
  return copy.text(
    view.matchingEntries + " of " + view.totalEntries + " published stable releases",
    view.totalEntries + " 個已發布穩定版本入面有 " + view.matchingEntries + " 個"
  );
}

export default function ChangelogPanel() {
  const settings = useAppStore((state) => state.settings);
  const copy = useMemo(
    () => getUiCopy(settings),
    [settings?.funnyLevelCantonese, settings?.funnyLevelEnglish, settings?.languageMode]
  );
  const [builder, setBuilder] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [regexOpen, setRegexOpen] = useState(false);
  const regexButtonRef = useRef<HTMLButtonElement>(null);
  const previousRegexOpen = useRef(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [view, setView] = useState<ChangelogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busyAction, setBusyAction] = useState<"export" | "copy" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (previousRegexOpen.current && !regexOpen) regexButtonRef.current?.focus({ preventScroll: true });
    previousRegexOpen.current = regexOpen;
  }, [regexOpen]);

  const request = useMemo<ChangelogViewRequest>(() => ({
    search: builder.pattern,
    regex: builder.mode === "regex",
    flags: builder.flags,
    dateFrom: fromDate || null,
    dateTo: toDate || null,
  }), [builder.flags, builder.mode, builder.pattern, fromDate, toDate]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    window.api.getChangelogView(request).then((next) => {
      if (!current) return;
      setView(next);
      setBuilder((state) => state.sample
        ? state
        : {
            ...state,
            sample: next.entries.map((entry) =>
              entry.version + " " + entry.title + " " + entry.changes.map((change) => change.text).join(" ")
            ).join("\n"),
          });
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!current) return;
      setView(null);
      setError(reason instanceof Error ? reason.message : copy.text("The changelog could not be loaded.", "載入更新日誌失敗。"));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [copy, request]);

  async function exportFiltered() {
    setBusyAction("export");
    setActionMessage(null);
    try {
      const result = await window.api.exportChangelog(format, request);
      downloadText("material-download-manager-changelog." + result.extension, result.content, result.mimeType);
      setActionMessage(copy.text(
        "Exported " + result.metadata.recordCount + " filtered release records as " + format.toUpperCase() + ".",
        "已匯出 " + result.metadata.recordCount + " 條篩選後版本紀錄，格式係 " + format.toUpperCase() + "。"
      ));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.text("The filtered changelog could not be exported.", "匯出篩選後更新日誌失敗。"));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyFiltered() {
    setBusyAction("copy");
    setActionMessage(null);
    try {
      const result = await window.api.exportChangelog("markdown", request);
      if (!navigator.clipboard?.writeText) throw new Error(copy.text("Clipboard access is unavailable.", "剪貼簿存取未有提供。"));
      await navigator.clipboard.writeText(result.content);
      setActionMessage(copy.text(
        "Copied " + result.metadata.recordCount + " filtered release records as Markdown.",
        "已複製 " + result.metadata.recordCount + " 條篩選後版本紀錄（Markdown）。"
      ));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.text("The filtered changelog could not be copied.", "複製篩選後更新日誌失敗。"));
    } finally {
      setBusyAction(null);
    }
  }

  const hasActiveFilter = Boolean(request.search || request.dateFrom || request.dateTo);
  const emptyMessage = hasActiveFilter
    ? copy.funny(
      [
        "No published stable releases match the active search or date filter.",
        "No published stable releases match those filters; the release shelf is being very selective.",
        "No published stable releases match those filters — the shelf has gone into hiding.",
        "No published stable releases match those filters; even the release ledger found no alibi.",
        "No published stable releases match those filters — the release cupboard is dramatically empty.",
      ],
      [
        "目前搜尋或日期篩選搵唔到已發布穩定版本。",
        "目前篩選搵唔到已發布穩定版本，版本架揀得幾嚴喎。",
        "目前篩選搵唔到已發布穩定版本，版本架匿埋咗。",
        "目前篩選搵唔到已發布穩定版本，連紀錄簿都冇口供。",
        "目前篩選搵唔到已發布穩定版本，版本櫃隆重地空空如也。",
      ]
    )
    : copy.funny(
      [
        "No published stable releases are embedded.",
        "No published stable releases are embedded; the ledger is waiting for its first page.",
        "No published stable releases are embedded — the ledger has not met a release yet.",
        "No published stable releases are embedded; the release shelf is practising minimalism.",
        "No published stable releases are embedded — the release cupboard is taking a very serious break.",
      ],
      [
        "暫時未有已嵌入嘅已發布穩定版本。",
        "暫時未有已嵌入嘅已發布穩定版本，紀錄簿等緊第一頁。",
        "暫時未有已嵌入嘅已發布穩定版本，紀錄簿仲未遇到版本。",
        "暫時未有已嵌入嘅已發布穩定版本，版本架實踐緊極簡主義。",
        "暫時未有已嵌入嘅已發布穩定版本，版本櫃認真咁放緊大假。",
      ]
    );

  return (
    <section className="changelog-panel" aria-labelledby="changelog-panel-heading" aria-busy={loading}>
      <header className="changelog-panel-header">
        <div className="changelog-panel-title">
          <HistoryIcon size={18} />
          <div>
            <h1 id="changelog-panel-heading">{copy.text("Changelog", "更新日誌")}</h1>
            <p>{copy.text("Published stable releases are embedded locally; no release data is fetched at runtime.", "已發布穩定版本資料嵌入本機，執行時唔會下載版本資料。")}</p>
          </div>
        </div>
        <div className="changelog-panel-actions">
          <label className="changelog-format-field">
            <span>{copy.text("Export format", "匯出格式")}</span>
            <select className="input select" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} aria-label={copy.text("Changelog export format", "更新日誌匯出格式")}>
              {EXPORT_FORMATS.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => void copyFiltered()} disabled={busyAction !== null || loading || !view}>
            {busyAction === "copy" ? copy.text("Copying…", "複製緊…") : copy.text("Copy filtered", "複製篩選結果")}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void exportFiltered()} disabled={busyAction !== null || loading || !view}>
            {busyAction === "export" ? copy.text("Exporting…", "匯出緊…") : copy.text("Export filtered", "匯出篩選結果")}
          </button>
        </div>
      </header>

      <div className="changelog-filters" aria-label={copy.text("Changelog filters", "更新日誌篩選")}>
        <div className="changelog-search">
          <label className="changelog-search-label" htmlFor="changelog-search-input">{copy.text("Search changelog", "搜尋更新日誌")}</label>
          <div className="changelog-search-row">
            <input
              id="changelog-search-input"
              className="input"
              type="search"
              value={builder.pattern}
              placeholder={copy.text("Search versions, release names, and changes", "搜尋版本、版本名稱同變更")}
              onChange={(event) => setBuilder((state) => ({ ...state, pattern: event.target.value }))}
              aria-label={copy.text("Search changelog", "搜尋更新日誌")}
            />
            <button ref={regexButtonRef} type="button" className="btn btn-ghost btn-sm" aria-expanded={regexOpen} aria-controls="changelog-search-builder" onClick={() => setRegexOpen((open) => !open)}>
              {copy.text("Regex", "正則")}
            </button>
          </div>
          {regexOpen && (
            <div id="changelog-search-builder" className="changelog-search-builder">
              <RegexBuilder title={copy.text("Changelog regex builder", "更新日誌正則建立器")} value={builder} onChange={setBuilder} />
            </div>
          )}
        </div>
        <div className="changelog-date-fields">
          <label className="field">
            <span className="field-label">{copy.text("From date", "開始日期")}</span>
            <input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label={copy.text("Changelog start date in ISO format", "更新日誌開始日期（ISO 格式）")} />
          </label>
          <label className="field">
            <span className="field-label">{copy.text("To date", "結束日期")}</span>
            <input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label={copy.text("Changelog end date in ISO format", "更新日誌結束日期（ISO 格式）")} />
          </label>
          <p className="changelog-date-helper">{copy.text("Native date fields submit ISO dates and compose with search.", "原生日期欄位會提交 ISO 日期，同搜尋一齊生效。")}</p>
        </div>
      </div>

      {error && <div className="changelog-status changelog-status-error" role="alert">{copy.funny(
        [
          "The changelog could not be loaded or processed: " + error,
          "The changelog reported an exact problem: " + error,
          "The changelog hit an error: " + error,
          "The changelog ledger stopped at this exact report: " + error,
          "The changelog cupboard filed this exact complaint: " + error,
        ],
        [
          "更新日誌載入或處理失敗：" + error,
          "更新日誌回報咗一個準確問題：" + error,
          "更新日誌撞到一個錯誤：" + error,
          "更新日誌紀錄簿停喺呢份準確報告：" + error,
          "更新日誌櫃提交咗呢份準確投訴：" + error,
        ]
      )}</div>}
      {actionMessage && <div className="changelog-status" role="status">{actionMessage}</div>}
      {loading && <div className="changelog-empty" role="status">{copy.funny(
        ["Loading the embedded changelog…", "Loading the embedded changelog; the release ledger is unfolding.", "Loading the embedded changelog — the tiny ledger is stretching.", "Loading the embedded changelog; the version shelf is doing its paperwork.", "Loading the embedded changelog — the release cupboard is putting on its spectacles."],
        ["載入緊嵌入嘅更新日誌…", "載入緊嵌入嘅更新日誌，版本紀錄簿攤開緊。", "載入緊嵌入嘅更新日誌，細細本紀錄簿伸緊懶腰。", "載入緊嵌入嘅更新日誌，版本架做緊文書工作。", "載入緊嵌入嘅更新日誌，版本櫃戴緊眼鏡。"]
      )}</div>}
      {!loading && !error && view?.entries.length === 0 && <div className="changelog-empty" role="status">{emptyMessage}</div>}
      {!loading && !error && view && view.entries.length > 0 && (
        <div className="changelog-results">
          <div className="changelog-results-summary" aria-live="polite">{releaseSummary(view, copy)}</div>
          <ol className="changelog-list" aria-label={copy.text("Published stable releases", "已發布穩定版本")}>
            {view.entries.map((entry) => (
              <li key={entry.id} className="changelog-entry">
                <article>
                  <header className="changelog-entry-header">
                    <div>
                      <h2>{entry.title}</h2>
                      <time dateTime={entry.releaseDate}>{entry.releaseDate}</time>
                    </div>
                    <a className="changelog-commit" href={entry.commitUrl} target="_blank" rel="noreferrer" title={copy.text("Open the full source commit on GitHub", "喺 GitHub 開啟完整來源 commit")}>
                      <span className="sr-only">{copy.text("Source commit", "來源 commit")}: </span>{entry.commitSha}
                    </a>
                  </header>
                  <ul className="changelog-change-list">
                    {entry.changes.map((change, index) => <li key={entry.id + "-" + index}><span className="changelog-category">{change.category}</span><span>{change.text}</span></li>)}
                  </ul>
                </article>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
