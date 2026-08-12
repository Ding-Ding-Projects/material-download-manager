import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat } from "@shared/export";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { isSchoolModeSuppressedText } from "@shared/settings";
import type { ChangelogView, ChangelogViewRequest } from "../../electron/history/ChangelogStore";
import { getUiCopy } from "../i18n/ui";
import { useUiCopy } from "../i18n/useUiCopy";
import { localizedPrefixedRegexEvaluationError } from "../hooks/useIsolatedRegex";
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

function changelogActionError(
  kind: "copy" | "export",
  message: string,
  copy: ReturnType<typeof getUiCopy>
): string {
  const regexFailure = localizedPrefixedRegexEvaluationError(
    message,
    "Changelog regular expression evaluation failed: ",
    kind === "copy" ? "Changelog regex copy failed" : "Changelog regex export failed",
    kind === "copy" ? "更新日誌正則複製失敗" : "更新日誌正則匯出失敗",
    copy.text
  );
  return regexFailure === message
    ? copy.text(
      `${kind === "copy" ? "Changelog copy" : "Changelog export"} failed: ${message}`,
      `${kind === "copy" ? "複製更新日誌" : "匯出更新日誌"}失敗：${message}`
    )
    : regexFailure;
}

export default function ChangelogPanel() {
  const settings = useAppStore((state) => state.settings);
  const copy = useUiCopy(settings);
  const [builder, setBuilder] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [regexOpen, setRegexOpen] = useState(false);
  const regexButtonRef = useRef<HTMLButtonElement>(null);
  const previousRegexOpen = useRef(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [view, setView] = useState<ChangelogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ kind: "copy" | "export"; message: string } | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busyAction, setBusyAction] = useState<"export" | "copy" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [editorExport, setEditorExport] = useState<{ content: string; fileName: string } | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const displayView = useMemo(() => {
    if (!view || !settings?.schoolModeEnabled) return view;
    const entries = view.entries.filter((entry) => !isSchoolModeSuppressedText(
      [entry.title, ...entry.changes.map((change) => `${change.category} ${change.text}`)].join("\n")
    ));
    return {
      ...view,
      entries,
      totalEntries: entries.length,
      matchingEntries: entries.length,
      emptyReason: entries.length === 0 ? "School mode omits playful release surfaces." : view.emptyReason,
    };
  }, [settings?.schoolModeEnabled, view]);

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
    setFilterError(null);
    window.api.getChangelogView(request).then((next) => {
      if (!current) return;
      setView(next);
      const sampleEntries = settings?.schoolModeEnabled
        ? next.entries.filter((entry) => !isSchoolModeSuppressedText(
          [entry.title, ...entry.changes.map((change) => `${change.category} ${change.text}`)].join("\n")
        ))
        : next.entries;
      setBuilder((state) => state.sample
        ? state
        : {
            ...state,
            sample: sampleEntries.map((entry) =>
              entry.version + " " + entry.title + " " + entry.changes.map((change) => change.text).join(" ")
            ).join("\n"),
          });
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!current) return;
      setView(null);
      const message = reason instanceof Error ? reason.message : copy.text("The changelog could not be loaded.", "載入更新日誌失敗。");
      setFilterError(localizedPrefixedRegexEvaluationError(
        message,
        "Changelog regular expression evaluation failed: ",
        "Changelog regex filter failed",
        "更新日誌正則篩選失敗",
        copy.text
      ));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [copy, reloadGeneration, request]);

  async function exportFiltered() {
    setBusyAction("export");
    setActionMessage(null);
    setActionError(null);
    try {
      if (settings?.schoolModeEnabled) return;
      const result = await window.api.exportChangelog(format, request);
      const fileName = "material-download-manager-changelog." + result.extension;
      downloadText(fileName, result.content, result.mimeType);
      setEditorExport({ content: result.content, fileName });
      setEditorMessage(null);
      setActionMessage(copy.text(
        "Exported " + result.metadata.recordCount + " filtered release records as " + format.toUpperCase() + ".",
        "已匯出 " + result.metadata.recordCount + " 條篩選後版本紀錄，格式係 " + format.toUpperCase() + "。"
      ));
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : copy.text("The filtered changelog could not be exported.", "匯出篩選後更新日誌失敗。");
      setActionError({
        kind: "export",
        message: changelogActionError("export", message, copy),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function openLastExportInEditor() {
    if (!editorExport) return;
    setEditorBusy(true);
    setEditorMessage(null);
    try {
      const result = await window.api.openExportInEditor(editorExport.content, editorExport.fileName);
      setEditorMessage(result.opened
        ? copy.text("Opened the exported changelog in Visual Studio Code; its export folder is the workspace root.", "已用 Visual Studio Code 開啟匯出更新日誌；匯出資料夾係 workspace root。")
        : copy.text(result.error ?? "Visual Studio Code could not be opened.", result.error ?? "未能開啟 Visual Studio Code。"));
    } catch (reason: unknown) {
      setEditorMessage(reason instanceof Error ? reason.message : copy.text("Visual Studio Code could not be opened.", "未能開啟 Visual Studio Code。"));
    } finally {
      setEditorBusy(false);
    }
  }

  async function copyFiltered() {
    setBusyAction("copy");
    setActionMessage(null);
    setActionError(null);
    try {
      if (settings?.schoolModeEnabled) return;
      const result = await window.api.exportChangelog("markdown", request);
      if (!navigator.clipboard?.writeText) throw new Error(copy.text("Clipboard access is unavailable.", "剪貼簿存取未有提供。"));
      await navigator.clipboard.writeText(result.content);
      setActionMessage(copy.text(
        "Copied " + result.metadata.recordCount + " filtered release records as Markdown.",
        "已複製 " + result.metadata.recordCount + " 條篩選後版本紀錄（Markdown）。"
      ));
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : copy.text("The filtered changelog could not be copied.", "複製篩選後更新日誌失敗。");
      setActionError({
        kind: "copy",
        message: changelogActionError("copy", message, copy),
      });
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
          {settings?.schoolModeEnabled ? (
            <span className="setting-helper" role="note">{copy.text("School mode omits playful release export surfaces.", "學校模式會隱藏玩味版本匯出表面。")}</span>
          ) : <>
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
            {editorExport && <button type="button" className="btn btn-ghost" onClick={() => void openLastExportInEditor()} disabled={editorBusy || busyAction !== null}>
              {editorBusy ? copy.text("Opening editor…", "開緊編輯器…") : copy.text("Open last export in Visual Studio Code", "用 Visual Studio Code 開啟上次匯出")}
            </button>}
          </>}
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
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "changelog-filter-error" : undefined}
            />
            <button ref={regexButtonRef} type="button" className="btn btn-ghost btn-sm" aria-expanded={regexOpen} aria-controls="changelog-search-builder" onClick={() => setRegexOpen((open) => !open)}>
              {copy.text("Regex", "正則")}
            </button>
          </div>
          {regexOpen && (
            <div id="changelog-search-builder" className="changelog-search-builder">
              <RegexBuilder title={copy.text("Changelog regex builder", "更新日誌正則建立器")} value={builder} onChange={setBuilder} text={copy.text} />
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

      {filterError && <div id="changelog-filter-error" className="changelog-status changelog-status-error" role="alert"><span>{copy.funny(
        [
          "The changelog could not be loaded or processed: " + filterError,
          "The changelog reported an exact problem: " + filterError,
          "The changelog hit an error: " + filterError,
          "The changelog ledger stopped at this exact report: " + filterError,
          "The changelog cupboard filed this exact complaint: " + filterError,
        ],
        [
          "更新日誌載入或處理失敗：" + filterError,
          "更新日誌回報咗一個準確問題：" + filterError,
          "更新日誌撞到一個錯誤：" + filterError,
          "更新日誌紀錄簿停喺呢份準確報告：" + filterError,
          "更新日誌櫃提交咗呢份準確投訴：" + filterError,
        ]
      )}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadGeneration((value) => value + 1)}>{copy.text("Retry changelog filter", "重試更新日誌篩選")}</button></div>}
      {actionError && <div id="changelog-action-error" className="changelog-status changelog-status-error" role="alert">
        <span>{actionError.message}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busyAction !== null}
          onClick={() => void (actionError.kind === "copy" ? copyFiltered() : exportFiltered())}
        >
          {actionError.kind === "copy"
            ? copy.text("Retry changelog copy", "重試複製更新日誌")
            : copy.text("Retry changelog export", "重試匯出更新日誌")}
        </button>
      </div>}
      {actionMessage && <div className="changelog-status" role="status">{actionMessage}</div>}
      {editorMessage && <div className="changelog-status" role="status">{editorMessage}</div>}
      {loading && <div className="changelog-empty" role="status">{copy.funny(
        ["Loading the embedded changelog…", "Loading the embedded changelog; the release ledger is unfolding.", "Loading the embedded changelog — the tiny ledger is stretching.", "Loading the embedded changelog; the version shelf is doing its paperwork.", "Loading the embedded changelog — the release cupboard is putting on its spectacles."],
        ["載入緊嵌入嘅更新日誌…", "載入緊嵌入嘅更新日誌，版本紀錄簿攤開緊。", "載入緊嵌入嘅更新日誌，細細本紀錄簿伸緊懶腰。", "載入緊嵌入嘅更新日誌，版本架做緊文書工作。", "載入緊嵌入嘅更新日誌，版本櫃戴緊眼鏡。"]
      )}</div>}
      {!loading && !filterError && displayView?.entries.length === 0 && <div className="changelog-empty" role="status">{emptyMessage}</div>}
      {!loading && !filterError && displayView && displayView.entries.length > 0 && (
        <div className="changelog-results">
          <div className="changelog-results-summary" aria-live="polite">{releaseSummary(displayView, copy)}</div>
          <ol className="changelog-list" aria-label={copy.text("Published stable releases", "已發布穩定版本")}>
            {displayView.entries.map((entry) => (
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
