import { useEffect, useMemo, useState } from "react";
import type { ExportFormat } from "@shared/export";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { HISTORY_ACTIONS, type HistoryAction, type HistoryFilter, type HistoryView } from "@shared/history";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import RegexBuilder from "./RegexBuilder";
import { HistoryIcon } from "./icons";

const EXPORT_FORMATS: readonly ExportFormat[] = ["json", "jsonl", "yaml", "toml", "csv", "markdown", "html"];

function dateBoundary(value: string, end: boolean): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : undefined;
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function actionLabel(action: string, copy: ReturnType<typeof getUiCopy>): string {
  const labels: Record<HistoryAction, string> = {
    created: copy.text("Created", "建立"),
    updated: copy.text("Updated", "更新"),
    deleted: copy.text("Deleted", "刪除"),
    restored: copy.text("Restored", "還原"),
    undone: copy.text("Undone", "撤銷"),
    discarded: copy.text("Discarded", "丟棄"),
    imported: copy.text("Imported", "匯入"),
    "settings-changed": copy.text("Settings changed", "設定變更"),
  };
  return labels[action as HistoryAction] ?? action;
}

export default function HistoryPanel() {
  const settings = useAppStore((state) => state.settings);
  const copy = useMemo(
    () => getUiCopy(settings),
    [settings?.funnyLevelCantonese, settings?.funnyLevelEnglish, settings?.languageMode]
  );
  const [builder, setBuilder] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [regexOpen, setRegexOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedActions, setSelectedActions] = useState<HistoryAction[]>([]);
  const [view, setView] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const filter = useMemo<HistoryFilter>(() => ({
    ...(dateBoundary(fromDate, false) === undefined ? {} : { from: dateBoundary(fromDate, false) }),
    ...(dateBoundary(toDate, true) === undefined ? {} : { to: dateBoundary(toDate, true) }),
    ...(selectedActions.length === 0 ? {} : { actions: selectedActions }),
    ...(builder.pattern.length === 0 ? {} : { text: builder.pattern }),
    regex: builder.mode === "regex",
    flags: builder.flags,
  }), [builder.flags, builder.mode, builder.pattern, fromDate, selectedActions, toDate]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    window.api.getHistoryView(filter).then((next) => {
      if (!current) return;
      setView(next);
      setBuilder((state) => ({
        ...state,
        sample: next.revisions.map((revision) => `${revision.action} ${revision.summary}`).join("\n"),
      }));
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!current) return;
      setView(null);
      setError(reason instanceof Error ? reason.message : copy.text("History could not be loaded.", "載入紀錄失敗。"));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [copy, filter]);

  function toggleAction(action: HistoryAction) {
    setSelectedActions((current) => current.includes(action) ? current.filter((item) => item !== action) : [...current, action]);
  }

  async function exportFiltered() {
    setExporting(true);
    setExportMessage(null);
    try {
      const result = await window.api.exportHistory(format, filter);
      downloadText(`material-download-manager-history.${result.extension}`, result.content, result.mimeType);
      setExportMessage(copy.text(
        `Exported ${result.metadata.recordCount} revision records as ${format.toUpperCase()} (${result.metadata.encoding}, ${result.metadata.lineEnding}).`,
        `已匯出 ${result.metadata.recordCount} 條修訂紀錄，格式 ${format.toUpperCase()}（${result.metadata.encoding}、${result.metadata.lineEnding}）。`
      ));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : copy.text("History export failed.", "匯出紀錄失敗。"));
    } finally {
      setExporting(false);
    }
  }

  const availableActions = Object.entries(view?.actionCounts ?? {})
    .filter(([action, count]) => (HISTORY_ACTIONS as readonly string[]).includes(action) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <section className="history-panel" aria-labelledby="history-panel-heading">
      <header className="history-panel-header">
        <div className="history-panel-title">
          <HistoryIcon size={18} />
          <div>
            <h1 id="history-panel-heading">{copy.text("Local revision history", "本機修訂紀錄")}</h1>
            <p>{copy.text("Browse append-only state changes without exposing raw snapshots.", "瀏覽只可追加嘅狀態變更，唔會公開原始快照。")}</p>
          </div>
        </div>
        <div className="history-panel-actions">
          <label className="history-format-field">
            <span>{copy.text("Export format", "匯出格式")}</span>
            <select className="input select" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void exportFiltered()} disabled={exporting || !view?.available}>
            {exporting ? copy.text("Exporting…", "匯出緊…") : copy.text("Export filtered history", "匯出篩選後紀錄")}
          </button>
        </div>
      </header>

      <div className="history-filters" aria-label={copy.text("History filters", "紀錄篩選") }>
        <div className="history-search">
          <label className="history-search-label" htmlFor="history-search-input">{copy.text("Search history", "搜尋紀錄")}</label>
          <div className="history-search-row">
            <input
              id="history-search-input"
              className="input"
              type="search"
              value={builder.pattern}
              placeholder={copy.text("Search revision actions and summaries", "搜尋修訂操作同摘要")}
              onChange={(event) => setBuilder((state) => ({ ...state, pattern: event.target.value }))}
              aria-label={copy.text("Search history", "搜尋紀錄")}
            />
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={regexOpen} onClick={() => setRegexOpen((open) => !open)}>
              {copy.text("Regex", "正則")}
            </button>
          </div>
          {regexOpen && (
            <div className="history-search-builder">
              <RegexBuilder title={copy.text("History regex builder", "紀錄正則建立器")} value={builder} onChange={setBuilder} />
            </div>
          )}
        </div>

        <div className="history-date-fields">
          <label className="field"><span className="field-label">{copy.text("From date", "開始日期")}</span><input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className="field"><span className="field-label">{copy.text("To date", "結束日期")}</span><input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </div>

        {availableActions.length > 0 && (
          <fieldset className="history-actions-filter">
            <legend>{copy.text("Actions present in history", "紀錄中出現嘅操作")}</legend>
            <div className="history-action-chips">
              {availableActions.map(([action, count]) => {
                const selected = selectedActions.includes(action as HistoryAction);
                return (
                  <button key={action} type="button" role="checkbox" aria-checked={selected} className={`history-action-chip${selected ? " selected" : ""}`} onClick={() => toggleAction(action as HistoryAction)}>
                    {actionLabel(action, copy)} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>

      {error && <div className="history-status history-status-error" role="alert">{error}</div>}
      {exportMessage && <div className="history-status" role="status">{exportMessage}</div>}
      {loading && <div className="history-empty" role="status">{copy.text("Loading local history…", "載入緊本機紀錄…")}</div>}
      {!loading && view && !view.available && <div className="history-empty history-status-error" role="alert">{view.emptyReason}</div>}
      {!loading && view?.available && view.revisions.length === 0 && <div className="history-empty" role="status">{view.emptyReason}</div>}
      {!loading && view?.available && view.revisions.length > 0 && (
        <div className="history-results">
          <div className="history-results-summary" aria-live="polite">
            {copy.text(`${view.matchingRevisions} of ${view.totalRevisions} revisions`, `${view.totalRevisions} 條入面 ${view.matchingRevisions} 條修訂`)}
          </div>
          <ol className="history-list" aria-label={copy.text("Revision list", "修訂清單")}>
            {view.revisions.map((revision) => (
              <li key={revision.id} className="history-row">
                <time dateTime={revision.timestamp}>{new Date(revision.timestamp).toLocaleString()}</time>
                <span className="history-action">{actionLabel(revision.action, copy)}</span>
                <span className="history-summary">{revision.summary}</span>
                <code title={revision.id}>{revision.id.slice(0, 8)}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
