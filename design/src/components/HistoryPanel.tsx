import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ExportFormat } from "@shared/export";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import { HISTORY_ACTIONS, type HistoryAccessState, type HistoryAction, type HistoryFilter, type HistoryView } from "@shared/history";
import { getUiCopy } from "../i18n/ui";
import { localizedPrefixedRegexEvaluationError } from "../hooks/useIsolatedRegex";
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
    "display-name-changed": copy.text("Display name changed", "顯示名稱變更"),
    "display-name-reset": copy.text("Display name reset", "顯示名稱重設"),
  };
  return labels[action as HistoryAction] ?? action;
}

function historyExportError(message: string, copy: ReturnType<typeof getUiCopy>): string {
  const regexFailure = localizedPrefixedRegexEvaluationError(
    message,
    "History regular expression evaluation failed: ",
    "History regex export failed",
    "紀錄正則匯出失敗",
    copy.text
  );
  return regexFailure === message
    ? copy.text(`History export failed: ${message}`, `匯出紀錄失敗：${message}`)
    : regexFailure;
}

export default function HistoryPanel() {
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
  const [selectedActions, setSelectedActions] = useState<HistoryAction[]>([]);
  const [view, setView] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [accessState, setAccessState] = useState<HistoryAccessState | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessConfirmation, setAccessConfirmation] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setAccessLoading(true);
    setAccessError(null);
    window.api.getHistoryAccessState().then((next) => {
      if (!current) return;
      setAccessState(next);
      setAccessLoading(false);
    }).catch((reason: unknown) => {
      if (!current) return;
      setAccessState(null);
      setAccessError(reason instanceof Error ? reason.message : copy.text("History protection is unavailable.", "紀錄保護暫時不可用。"));
      setAccessLoading(false);
    });
    return () => {
      current = false;
    };
  }, [copy]);

  useLayoutEffect(() => {
    if (previousRegexOpen.current && !regexOpen) regexButtonRef.current?.focus({ preventScroll: true });
    previousRegexOpen.current = regexOpen;
  }, [regexOpen]);

  function handleHistoryKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !regexOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setRegexOpen(false);
  }

  const filter = useMemo<HistoryFilter>(() => ({
    ...(dateBoundary(fromDate, false) === undefined ? {} : { from: dateBoundary(fromDate, false) }),
    ...(dateBoundary(toDate, true) === undefined ? {} : { to: dateBoundary(toDate, true) }),
    ...(selectedActions.length === 0 ? {} : { actions: selectedActions }),
    ...(builder.pattern.length === 0 ? {} : { text: builder.pattern }),
    regex: builder.mode === "regex",
    flags: builder.flags,
  }), [builder.flags, builder.mode, builder.pattern, fromDate, selectedActions, toDate]);

  useEffect(() => {
    if (!accessState?.unlocked) {
      setView(null);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setFilterError(null);
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
      const message = reason instanceof Error ? reason.message : copy.text("History could not be loaded.", "載入紀錄失敗。");
      setFilterError(localizedPrefixedRegexEvaluationError(
        message,
        "History regular expression evaluation failed: ",
        "History regex filter failed",
        "紀錄正則篩選失敗",
        copy.text
      ));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [accessState?.unlocked, copy, filter, reloadGeneration]);

  async function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accessBusy) return;
    if (accessPassword.length < 8) {
      setAccessError(copy.text("Use at least 8 characters for the history password.", "紀錄密碼至少要有 8 個字元。"));
      return;
    }
    if (!accessState?.configured && accessPassword !== accessConfirmation) {
      setAccessError(copy.text("The two history passwords do not match.", "兩次紀錄密碼唔一致。"));
      return;
    }
    setAccessBusy(true);
    setAccessError(null);
    try {
      const next = accessState?.configured
        ? await window.api.unlockHistory(accessPassword)
        : await window.api.setupHistoryAccess(accessPassword);
      setAccessState(next);
      setAccessPassword("");
      setAccessConfirmation("");
    } catch (reason: unknown) {
      setAccessError(reason instanceof Error ? reason.message : copy.text("History access could not be changed.", "紀錄存取未能更新。"));
    } finally {
      setAccessBusy(false);
    }
  }

  async function lockAccess() {
    if (accessBusy) return;
    setAccessBusy(true);
    setAccessError(null);
    try {
      setAccessState(await window.api.lockHistory());
      setView(null);
    } catch (reason: unknown) {
      setAccessError(reason instanceof Error ? reason.message : copy.text("History could not be locked.", "紀錄未能鎖定。"));
    } finally {
      setAccessBusy(false);
    }
  }

  function toggleAction(action: HistoryAction) {
    setSelectedActions((current) => current.includes(action) ? current.filter((item) => item !== action) : [...current, action]);
  }

  async function exportFiltered() {
    setExporting(true);
    setExportMessage(null);
    setActionError(null);
    try {
      const result = await window.api.exportHistory(format, filter);
      downloadText(`material-download-manager-history.${result.extension}`, result.content, result.mimeType);
      const warnings = result.warnings.length > 0
        ? ` Warnings: ${result.warnings.join(" ")}`
        : "";
      setExportMessage(copy.text(
        `Exported ${result.metadata.recordCount} revision records as ${format.toUpperCase()} (${result.metadata.encoding}, ${result.metadata.lineEnding}); round-trip is ${result.roundTrip.status}.${warnings}`,
        `已匯出 ${result.metadata.recordCount} 條修訂紀錄，格式 ${format.toUpperCase()}（${result.metadata.encoding}、${result.metadata.lineEnding}）；往返狀態：${result.roundTrip.status}。${result.warnings.length > 0 ? `提示：${result.warnings.join(" ")}` : ""}`
      ));
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : copy.text("History export failed.", "匯出紀錄失敗。");
      setActionError(historyExportError(message, copy));
    } finally {
      setExporting(false);
    }
  }

  const availableActions = Object.entries(view?.actionCounts ?? {})
    .filter(([action, count]) => (HISTORY_ACTIONS as readonly string[]).includes(action) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return (
    <section className="history-panel" aria-labelledby="history-panel-heading" onKeyDownCapture={handleHistoryKeyDown}>
      <header className="history-panel-header">
        <div className="history-panel-title">
          <HistoryIcon size={18} />
          <div>
            <h1 id="history-panel-heading">{copy.text("Local revision history", "本機修訂紀錄")}</h1>
            <p>{copy.text("Browse append-only state changes without exposing raw snapshots.", "瀏覽只可追加嘅狀態變更，唔會公開原始快照。")}</p>
          </div>
        </div>
        <div className="history-panel-actions">
          {accessState?.unlocked && <button type="button" className="btn btn-ghost" onClick={() => void lockAccess()} disabled={accessBusy}>
            {copy.text("Lock history", "鎖定紀錄")}
          </button>}
          <label className="history-format-field">
            <span>{copy.text("Export format", "匯出格式")}</span>
            <select className="input select" value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void exportFiltered()} disabled={exporting || !view?.available || !accessState?.unlocked}>
            {exporting ? copy.text("Exporting…", "匯出緊…") : copy.text("Export filtered history", "匯出篩選後紀錄")}
          </button>
        </div>
      </header>

      {accessLoading && <div className="history-empty" role="status">{copy.text("Checking local history protection…", "檢查緊本機紀錄保護…")}</div>}
      {!accessLoading && accessError && <div className="history-status history-status-error" role="alert">{accessError}</div>}
      {!accessLoading && !accessError && accessState && !accessState.unlocked && (
        <form className="history-access" onSubmit={(event) => void submitAccess(event)}>
          <h2>{accessState.configured
            ? copy.text("Unlock local history", "解鎖本機紀錄")
            : copy.text("Create a local history password", "建立本機紀錄密碼")}</h2>
          <p>{copy.text(
            "History metadata is protected by a credential stored in the operating-system vault. The password itself is never written to settings or history.",
            "紀錄資料由儲存在作業系統保管庫嘅憑證保護；密碼本身唔會寫入設定或者紀錄。"
          )}</p>
          <label className="field">
            <span className="field-label">{copy.text("History password", "紀錄密碼")}</span>
            <input className="input" type="password" autoComplete={accessState.configured ? "current-password" : "new-password"} value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} />
          </label>
          {!accessState.configured && <label className="field">
            <span className="field-label">{copy.text("Confirm history password", "確認紀錄密碼")}</span>
            <input className="input" type="password" autoComplete="new-password" value={accessConfirmation} onChange={(event) => setAccessConfirmation(event.target.value)} />
          </label>}
          <div className="history-access-actions">
            <button type="submit" className="btn btn-primary" disabled={accessBusy}>
              {accessState.configured ? copy.text("Unlock history", "解鎖紀錄") : copy.text("Protect history", "保護紀錄")}
            </button>
          </div>
          <p className="setting-helper">{copy.text("Deleting the app's local application-data folder resets this local protection.", "刪除程式嘅本機應用程式資料夾就可以重設呢個本機保護。")}</p>
        </form>
      )}

      {accessState?.unlocked && <div className="history-filters" aria-label={copy.text("History filters", "紀錄篩選") }>
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
              aria-invalid={filterError ? true : undefined}
              aria-describedby={filterError ? "history-filter-error" : undefined}
            />
            <button ref={regexButtonRef} type="button" className="btn btn-ghost btn-sm" aria-expanded={regexOpen} aria-controls="history-search-builder" onClick={() => setRegexOpen((open) => !open)}>
              {copy.text("Regex", "正則")}
            </button>
          </div>
          {regexOpen && (
            <div id="history-search-builder" className="history-search-builder">
              <RegexBuilder title={copy.text("History regex builder", "紀錄正則建立器")} value={builder} onChange={setBuilder} text={copy.text} />
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
      </div>}

      {filterError && <div id="history-filter-error" className="history-status history-status-error" role="alert">
        <span>{filterError}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReloadGeneration((value) => value + 1)}>
          {copy.text("Retry history filter", "重試紀錄篩選")}
        </button>
      </div>}
      {actionError && <div id="history-export-error" className="history-status history-status-error" role="alert">
        <span>{actionError}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={exporting} onClick={() => void exportFiltered()}>
          {copy.text("Retry history export", "重試匯出紀錄")}
        </button>
      </div>}
      {exportMessage && <div className="history-status" role="status">{exportMessage}</div>}
      {accessState?.unlocked && loading && <div className="history-empty" role="status">{copy.text("Loading local history…", "載入緊本機紀錄…")}</div>}
      {accessState?.unlocked && !loading && view && !view.available && <div className="history-empty history-status-error" role="alert">{view.emptyReason}</div>}
      {accessState?.unlocked && !loading && view?.available && view.revisions.length === 0 && <div className="history-empty" role="status">{view.emptyReason}</div>}
      {accessState?.unlocked && !loading && view?.available && view.revisions.length > 0 && (
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
