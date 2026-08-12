import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CONVERTER_ADAPTERS,
  CONVERTER_CATEGORY_LABELS,
  CONVERTER_CATEGORIES,
  createEmptyConverterState,
  type ConverterAdapter,
  type ConverterCategory,
  type ConverterState,
} from "@shared/converter";
import { createDefaultRegexBuilderState, validateRegexPattern, type RegexBuilderState } from "@shared/regex";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { notify } from "./NotificationCenter";
import RegexBuilder from "./RegexBuilder";
import { ArchiveIcon, DocumentIcon, RefreshIcon } from "./icons";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function categoryIcon(category: ConverterCategory) {
  return category === "archives" || category === "binary-encodings" ? ArchiveIcon : DocumentIcon;
}

interface CatalogCategoryProps {
  category: ConverterCategory;
  selectedAdapterId: string | null;
  onSelect: (adapter: ConverterAdapter) => void;
}

function CatalogCategory({ category, selectedAdapterId, onSelect }: CatalogCategoryProps) {
  const settings = useAppStore((state) => state.settings);
  const copy = getUiCopy(settings);
  const [query, setQuery] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const [builderOpen, setBuilderOpen] = useState(false);
  const builderButtonRef = useRef<HTMLButtonElement>(null);
  const previousBuilderOpen = useRef(false);
  const baseId = useId().replace(/:/gu, "");
  const adapters = useMemo(() => CONVERTER_ADAPTERS.filter((adapter) => adapter.category === category), [category]);
  const samples = useMemo(
    () => adapters.map((adapter) => `${adapter.label}\n${adapter.targetLabel}\n${adapter.availabilityReason}\n${adapter.lossDisclosure}`),
    [adapters],
  );
  const syntaxError = query.mode === "regex" && query.pattern ? validateRegexPattern(query.pattern, query.flags) : null;
  const regexBatch = useIsolatedRegexBatch(query.pattern, query.flags, samples, query.mode === "regex" && query.pattern.length > 0);
  const evaluationError = syntaxError ?? (regexBatch.pending ? null : regexBatch.error);
  const errorText = evaluationError ? localizedRegexEvaluationError(evaluationError, copy.text) : null;
  const filtered = useMemo(() => {
    if (!query.pattern) return adapters;
    if (query.mode === "text") {
      const needle = query.pattern.toLocaleLowerCase();
      return adapters.filter((adapter) => `${adapter.label} ${adapter.targetLabel} ${adapter.availabilityReason}`.toLocaleLowerCase().includes(needle));
    }
    if (evaluationError || !regexBatch.evaluations) return [];
    return adapters.filter((_adapter, index) => (regexBatch.evaluations?.[index]?.matches.length ?? 0) > 0);
  }, [adapters, evaluationError, query.mode, query.pattern, regexBatch.evaluations]);

  useEffect(() => {
    if (previousBuilderOpen.current && !builderOpen) builderButtonRef.current?.focus({ preventScroll: true });
    previousBuilderOpen.current = builderOpen;
  }, [builderOpen]);

  const Icon = categoryIcon(category);
  return (
    <section className="converter-category" aria-labelledby={`${baseId}-heading`}>
      <header className="converter-category-heading">
        <Icon size={18} />
        <div>
          <h2 id={`${baseId}-heading`}>{copy.text(CONVERTER_CATEGORY_LABELS[category], CONVERTER_CATEGORY_LABELS[category])}</h2>
          <p>{copy.text("Search this adapter category locally. Plain text is the default; Regex opens the bounded builder attached to this field.", "本機搜尋呢個轉換器分類。預設用純文字；Regex 會開啟連住呢個欄位、有界線嘅建立器。")}</p>
        </div>
      </header>
      <div className="converter-search-row">
        <label className="sr-only" htmlFor={`${baseId}-search`}>{copy.text(`Search ${CONVERTER_CATEGORY_LABELS[category]} adapters`, `搜尋 ${CONVERTER_CATEGORY_LABELS[category]} 轉換器`)}</label>
        <input
          id={`${baseId}-search`}
          className="input"
          type="search"
          value={query.pattern}
          onChange={(event) => setQuery((current) => ({ ...current, pattern: event.target.value }))}
          placeholder={copy.text("Filter adapters", "篩選轉換器")}
          aria-label={copy.text(`Search ${CONVERTER_CATEGORY_LABELS[category]} adapters`, `搜尋 ${CONVERTER_CATEGORY_LABELS[category]} 轉換器`)}
          aria-invalid={errorText ? true : undefined}
          aria-busy={regexBatch.pending || undefined}
          aria-describedby={errorText ? `${baseId}-error` : undefined}
        />
        <button
          ref={builderButtonRef}
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={builderOpen}
          aria-controls={`${baseId}-builder`}
          onClick={() => setBuilderOpen((open) => !open)}
        >
          {copy.text("Regex", "正則")}
        </button>
      </div>
      {builderOpen && (
        <div id={`${baseId}-builder`} className="converter-regex-builder">
          <RegexBuilder
            title={copy.text(`${CONVERTER_CATEGORY_LABELS[category]} adapter search builder`, `${CONVERTER_CATEGORY_LABELS[category]} 轉換器搜尋建立器`)}
            value={{ ...query, sample: samples.join("\n\n") }}
            onChange={setQuery}
            text={copy.text}
          />
        </div>
      )}
      {errorText && <p id={`${baseId}-error`} className="field-error" role="alert">{errorText}</p>}
      {!errorText && regexBatch.pending && <p className="setting-helper" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p>}
      <div className="converter-adapter-grid" aria-live="polite" aria-busy={regexBatch.pending || undefined}>
        {regexBatch.pending ? <p className="empty-state" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p> : filtered.length === 0 ? <p className="empty-state" role="status">{copy.text("No adapters match this category search.", "呢個分類搜尋搵唔到相符轉換器。")}</p> : filtered.map((adapter) => (
          <article key={adapter.id} className={`converter-adapter-card${selectedAdapterId === adapter.id ? " selected" : ""}${adapter.enabled ? "" : " unavailable"}`}>
            <div className="converter-adapter-card-heading">
              <h3>{adapter.label}</h3>
              <span className={adapter.enabled ? "converter-availability enabled" : "converter-availability unavailable"}>{adapter.enabled ? copy.text("Bundled", "已內置") : copy.text("Unavailable", "未提供")}</span>
            </div>
            <p>{adapter.targetLabel}</p>
            <p className="setting-helper">{adapter.availabilityReason}</p>
            <p className="setting-helper"><strong>{copy.text("Conversion note:", "轉換提示：")}</strong> {adapter.lossDisclosure}</p>
            <p className="setting-helper"><strong>{copy.text("Output validation:", "輸出驗證：")}</strong> {adapter.outputValidator}</p>
            <button
              type="button"
              className={selectedAdapterId === adapter.id ? "btn btn-primary" : "btn btn-ghost"}
              disabled={!adapter.enabled}
              aria-pressed={selectedAdapterId === adapter.id}
              aria-describedby={`${baseId}-${adapter.id}-reason`}
              onClick={() => onSelect(adapter)}
            >
              {adapter.enabled ? (selectedAdapterId === adapter.id ? copy.text("Selected", "已選擇") : copy.text("Select format", "選擇格式")) : copy.text("Unavailable", "未提供")}
            </button>
            <span id={`${baseId}-${adapter.id}-reason`} className="sr-only">{adapter.availabilityReason}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function filterStagedSources(sources: ConverterState["stagedSources"], query: RegexBuilderState, evaluations: ReturnType<typeof useIsolatedRegexBatch>["evaluations"] | null, failed: boolean) {
  if (!query.pattern) return sources;
  if (query.mode === "text") {
    const needle = query.pattern.toLocaleLowerCase();
    return sources.filter((source) => `${source.sourceName} ${source.detection.label}`.toLocaleLowerCase().includes(needle));
  }
  if (failed || !evaluations) return [];
  return sources.filter((_source, index) => (evaluations[index]?.matches.length ?? 0) > 0);
}

export default function ConverterPanel() {
  const settings = useAppStore((state) => state.settings);
  const copy = useMemo(
    () => getUiCopy(settings),
    [settings?.funnyLevelCantonese, settings?.funnyLevelEnglish, settings?.languageMode, settings?.schoolModeEnabled, settings?.schoolModeName, settings?.showEmojis],
  );
  const [state, setState] = useState<ConverterState>(createEmptyConverterState);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stagedQuery, setStagedQuery] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const [stagedBuilderOpen, setStagedBuilderOpen] = useState(false);
  const stagedBuilderButtonRef = useRef<HTMLButtonElement>(null);
  const previousStagedBuilderOpen = useRef(false);
  const stagedId = useId().replace(/:/gu, "");
  const selectedAdapter = useMemo(() => CONVERTER_ADAPTERS.find((adapter) => adapter.id === selectedAdapterId) ?? null, [selectedAdapterId]);
  const stagedSamples = useMemo(() => state.stagedSources.map((source) => `${source.sourceName}\n${source.detection.label}`), [state.stagedSources]);
  const stagedSyntaxError = stagedQuery.mode === "regex" && stagedQuery.pattern ? validateRegexPattern(stagedQuery.pattern, stagedQuery.flags) : null;
  const stagedRegex = useIsolatedRegexBatch(stagedQuery.pattern, stagedQuery.flags, stagedSamples, stagedQuery.mode === "regex" && stagedQuery.pattern.length > 0);
  const stagedError = stagedSyntaxError ?? (stagedRegex.pending ? null : stagedRegex.error);
  const stagedErrorText = stagedError ? localizedRegexEvaluationError(stagedError, copy.text) : null;
  const visibleStagedSources = useMemo(
    () => filterStagedSources(state.stagedSources, stagedQuery, stagedRegex.evaluations, Boolean(stagedError)),
    [stagedError, stagedQuery, stagedRegex.evaluations, state.stagedSources],
  );
  const canQueue = Boolean(selectedAdapter?.enabled)
    && state.stagedSources.length > 0
    && state.stagedSources.every((source) => selectedAdapter ? source.compatibleAdapterIds.includes(selectedAdapter.id) && source.sizeBytes <= selectedAdapter.resourceLimits.maxInputBytes : false);

  useEffect(() => {
    let live = true;
    void window.api.getConverterState().then((next) => {
      if (live) setState(next);
    }).catch(() => {
      if (live) setError(copy.text("The local converter state is unavailable. Try reopening this tab.", "本機轉換器狀態暫時不可用；請重新開啟呢個分頁。"));
    });
    const unsubscribe = window.api.onConverterStateChanged((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [copy]);

  useEffect(() => {
    if (previousStagedBuilderOpen.current && !stagedBuilderOpen) stagedBuilderButtonRef.current?.focus({ preventScroll: true });
    previousStagedBuilderOpen.current = stagedBuilderOpen;
  }, [stagedBuilderOpen]);

  async function run(action: string, task: () => Promise<ConverterState>, success: string) {
    setBusy(action);
    setError(null);
    setStatus(null);
    try {
      const next = await task();
      setState(next);
      setStatus(success);
      notify({ title: copy.text("File converter", "檔案轉換器"), message: success, tone: "success" });
    } catch {
      const message = copy.text("The requested local converter action did not complete. No source file was changed.", "要求嘅本機轉換器操作未完成；冇改到來源檔案。");
      setError(message);
      notify({ title: copy.text("File converter", "檔案轉換器"), message, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function exportHistory() {
    setBusy("export-history");
    setError(null);
    try {
      const exported = await window.api.exportConverterHistory("json");
      await navigator.clipboard.writeText(exported.content);
      const message = copy.text("Copied the visible, path-redacted converter history JSON.", "已複製可見、已移除路徑嘅轉換器紀錄 JSON。");
      setStatus(message);
      notify({ title: copy.text("File converter", "檔案轉換器"), message, tone: "success" });
    } catch {
      setError(copy.text("The converter history could not be copied. No file paths or file contents were exposed.", "轉換器紀錄未能複製；冇公開任何檔案路徑或者檔案內容。"));
    } finally {
      setBusy(null);
    }
  }

  async function openResult(id: string, inEditor: boolean) {
    setBusy(`${inEditor ? "editor" : "open"}-${id}`);
    setError(null);
    try {
      const opened = inEditor ? await window.api.openConverterResultInEditor(id) : await window.api.openConverterResult(id);
      if (!opened) throw new Error("Not opened");
      setStatus(inEditor ? copy.text("Opened the validated result folder in the configured external editor.", "已喺設定嘅外部編輯器開啟已驗證結果資料夾。") : copy.text("Opened the validated converter result.", "已開啟已驗證轉換器結果。"));
    } catch {
      setError(inEditor ? copy.text("The result could not be opened in the configured external editor. Choose or refresh an editor in Settings.", "結果未能喺設定嘅外部編輯器開啟；請喺設定選擇或者更新編輯器。") : copy.text("The validated result could not be opened.", "已驗證結果未能開啟。"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="converter-panel" id="file-converter-panel" aria-labelledby="file-converter-heading">
      <header className="converter-panel-header">
        <div className="converter-panel-title">
          <DocumentIcon size={20} />
          <div>
            <h1 id="file-converter-heading">{copy.text("Local file converter", "本機檔案轉換器")}</h1>
            <p>{copy.text("Choose local files, inspect their bounded byte signatures, select a proven bundled adapter, then choose an output folder. Sources are never uploaded or overwritten.", "選擇本機檔案、檢查有界線嘅位元簽名、選擇有證明嘅內置轉換器，再選擇輸出資料夾。來源檔案唔會上載或者覆寫。")}</p>
          </div>
        </div>
        <div className="converter-panel-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void exportHistory()} disabled={busy !== null}>{copy.text("Copy history JSON", "複製紀錄 JSON")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void run("refresh", () => window.api.getConverterState(), copy.text("Refreshed local converter state.", "已更新本機轉換器狀態。"))} disabled={busy !== null}><RefreshIcon size={16} />{copy.text("Refresh", "更新")}</button>
        </div>
      </header>

      <section className="converter-guided-card" aria-labelledby="converter-guided-heading">
        <div>
          <h2 id="converter-guided-heading">{copy.text("1. Choose local source files", "1. 選擇本機來源檔案")}</h2>
          <p>{copy.text("The native picker keeps folder paths in the privileged process. This staging page intentionally holds up to 200 selected files at once; durable queue records are stored independently and are processed one job at a time.", "原生選檔器會將資料夾路徑留喺受權限嘅程序。呢頁暫存最多 200 個已選檔案；耐用佇列記錄會獨立儲存，逐項處理。")}</p>
        </div>
        <div className="converter-guided-actions">
          <button type="button" className="btn btn-primary" onClick={() => void run("pick", () => window.api.pickConverterSources(), copy.text("Updated the local source staging page.", "已更新本機來源暫存頁。"))} disabled={busy !== null}>{copy.text("Choose files", "選擇檔案")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void run("clear", () => window.api.clearConverterSources(), copy.text("Cleared the unqueued source selection.", "已清除未加入佇列嘅來源選擇。"))} disabled={busy !== null || state.stagedSources.length === 0}>{copy.text("Clear selection", "清除選擇")}</button>
        </div>
      </section>

      <section className="converter-staged" aria-labelledby={`${stagedId}-heading`}>
        <header>
          <h2 id={`${stagedId}-heading`}>{copy.text("Staged source files", "暫存來源檔案")}</h2>
          <span aria-live="polite">{copy.text(`${state.stagedSources.length} selected`, `已選 ${state.stagedSources.length} 個`)}</span>
        </header>
        <div className="converter-search-row">
          <label className="sr-only" htmlFor={`${stagedId}-search`}>{copy.text("Search staged source files", "搜尋暫存來源檔案")}</label>
          <input id={`${stagedId}-search`} className="input" type="search" value={stagedQuery.pattern} onChange={(event) => setStagedQuery((current) => ({ ...current, pattern: event.target.value }))} placeholder={copy.text("Filter selected files", "篩選已選檔案")} aria-label={copy.text("Search staged source files", "搜尋暫存來源檔案")} aria-invalid={stagedErrorText ? true : undefined} aria-busy={stagedRegex.pending || undefined} />
          <button ref={stagedBuilderButtonRef} type="button" className="btn btn-ghost btn-sm" aria-expanded={stagedBuilderOpen} aria-controls={`${stagedId}-builder`} onClick={() => setStagedBuilderOpen((open) => !open)}>{copy.text("Regex", "正則")}</button>
        </div>
        {stagedBuilderOpen && <div id={`${stagedId}-builder`} className="converter-regex-builder"><RegexBuilder title={copy.text("Staged file search builder", "暫存檔案搜尋建立器")} value={{ ...stagedQuery, sample: stagedSamples.join("\n\n") }} onChange={setStagedQuery} text={copy.text} /></div>}
        {stagedErrorText && <p className="field-error" role="alert">{stagedErrorText}</p>}
        {state.stagedSources.length === 0 ? <p className="empty-state" role="status">{copy.text("No local source files are staged. Choose files to inspect their real bytes before conversion.", "未有暫存本機來源檔案；請選擇檔案，轉換前會檢查佢哋真實位元。")}</p> : stagedRegex.pending ? <p className="empty-state" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</p> : <ul className="converter-staged-list">
          {visibleStagedSources.map((source) => <li key={source.id}><div><strong>{source.sourceName}</strong><span>{source.detection.label} · {formatBytes(source.sizeBytes)} · {source.detection.evidence === "signature" ? copy.text("signature detected", "已偵測簽名") : source.detection.evidence === "bounded-text-inspection" ? copy.text("bounded text inspection", "有界文字檢查") : copy.text("unknown bytes", "未知位元")}</span></div><small>{source.compatibleAdapterIds.length === 0 ? copy.text("No registered adapter accepts these bytes.", "冇已登記轉換器接受呢啲位元。") : copy.text(`${source.compatibleAdapterIds.length} registered adapter${source.compatibleAdapterIds.length === 1 ? "" : "s"} can inspect this type.`, `${source.compatibleAdapterIds.length} 個已登記轉換器可以檢查呢種類型。`)}</small>{source.preview.kind === "text" && source.preview.text !== null ? <pre className="converter-source-preview" aria-label={copy.text(`Bounded local preview for ${source.sourceName}`, `${source.sourceName} 嘅有界本機預覽`)}>{source.preview.text}{source.preview.truncated ? "…" : ""}</pre> : <small className="converter-source-preview converter-source-preview-bytes">{source.preview.summary}</small>}</li>)}
        </ul>}
      </section>

      <section className="converter-guided-card converter-queue-card" aria-labelledby="converter-queue-heading">
        <div>
          <h2 id="converter-queue-heading">{copy.text("2. Choose a bundled format and output folder", "2. 選擇內置格式同輸出資料夾")}</h2>
          <p>{selectedAdapter ? `${selectedAdapter.label}: ${selectedAdapter.lossDisclosure}` : copy.text("Choose an enabled adapter below. Disabled entries remain visible with the exact missing packaged proof.", "請喺下面選擇已啟用轉換器；未提供項目會保留顯示，講清楚缺少咩封裝證明。")}</p>
        </div>
        <div className="converter-guided-actions">
          <button type="button" className="btn btn-primary" onClick={() => selectedAdapter && void run("queue", () => window.api.queueConverterSources(selectedAdapter.id), copy.text("Queued local conversions after destination selection.", "選好目標資料夾後，已加入本機轉換佇列。"))} disabled={busy !== null || !canQueue} title={!selectedAdapter ? copy.text("Choose a bundled adapter first.", "請先選擇已內置轉換器。") : !canQueue ? copy.text("Every staged file must match the selected adapter and its per-file safety limit.", "每個暫存檔案都要符合已選轉換器同每檔安全上限。") : undefined}>{copy.text("Choose output folder and queue", "選擇輸出資料夾並加入佇列")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void run("queue-toggle", () => state.queuePaused ? window.api.resumeConverterQueue() : window.api.pauseConverterQueue(), state.queuePaused ? copy.text("Resumed the local conversion queue.", "已繼續本機轉換佇列。") : copy.text("Paused the local conversion queue.", "已暫停本機轉換佇列。"))} disabled={busy !== null}>{state.queuePaused ? copy.text("Resume queue", "繼續佇列") : copy.text("Pause queue", "暫停佇列")}</button>
        </div>
      </section>

      <section className="converter-catalog" aria-labelledby="converter-catalog-heading">
        <header className="converter-catalog-heading"><h2 id="converter-catalog-heading">{copy.text("Categorized adapter catalog", "分類轉換器目錄")}</h2><p>{copy.text("Every entry states whether it is packaged and validated. Unavailable entries are not hidden, and they never fall back to PATH tools or an online converter.", "每個項目都會講明係咪已封裝同驗證；未提供項目唔會隱藏，亦絕對唔會退回 PATH 工具或者網上轉換器。")}</p></header>
        {CONVERTER_CATEGORIES.map((category) => <CatalogCategory key={category} category={category} selectedAdapterId={selectedAdapterId} onSelect={(adapter) => { setSelectedAdapterId(adapter.id); setStatus(copy.text(`${adapter.label} is selected for the next local conversion.`, `已選擇 ${adapter.label} 作下一個本機轉換。`)); }} />)}
      </section>

      <section className="converter-history" aria-labelledby="converter-history-heading">
        <header><h2 id="converter-history-heading">{copy.text("Queue and result history", "佇列同結果紀錄")}</h2><span aria-live="polite">{state.hasMoreJobs ? copy.text("Showing a bounded local history page", "顯示有界線嘅本機紀錄頁") : copy.text(`${state.jobs.length} visible record${state.jobs.length === 1 ? "" : "s"}`, `顯示 ${state.jobs.length} 項記錄`)}</span></header>
        {state.jobs.length === 0 ? <p className="empty-state" role="status">{copy.text("No conversions have been queued yet.", "未有轉換加入佇列。")}</p> : <ul className="converter-job-list">
          {state.jobs.map((job) => <li key={job.id} className={`converter-job converter-job-${job.status}`}>
            <div className="converter-job-summary"><strong>{job.sourceName}</strong><span>{job.destinationName} · {job.status} · {formatBytes(job.processedBytes)}/{formatBytes(job.inputBytes)}</span>{job.status === "running" && <progress value={job.processedBytes} max={Math.max(1, job.inputBytes)} aria-label={copy.text(`Conversion progress for ${job.sourceName}`, `${job.sourceName} 轉換進度`)} />}{job.error && <small className="field-error">{job.error}</small>}</div>
            <div className="converter-job-actions">
              {(job.status === "queued" || job.status === "running" || job.status === "paused") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(`cancel-${job.id}`, () => window.api.cancelConverterJob(job.id), copy.text("Cancelled the queued conversion before publishing an output.", "已取消佇列轉換，未有發佈輸出。"))} disabled={busy !== null}>{copy.text("Cancel", "取消")}</button>}
              {(job.status === "failed" || job.status === "paused" || job.status === "cancelled") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(`retry-${job.id}`, () => window.api.retryConverterJob(job.id), copy.text("Queued the conversion retry.", "已加入重試轉換佇列。"))} disabled={busy !== null}>{copy.text("Retry", "重試")}</button>}
              {job.outputAvailable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openResult(job.id, false)} disabled={busy !== null}>{copy.text("Open result", "開啟結果")}</button>}
              {job.outputAvailable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openResult(job.id, true)} disabled={busy !== null}>{copy.text("Open in Visual Studio Code", "喺 Visual Studio Code 開啟")}</button>}
            </div>
          </li>)}
        </ul>}
      </section>
      {error && <p className="field-error converter-action-error" role="alert">{error}</p>}
      {status && <p className="setting-helper converter-action-status" role="status">{status}</p>}
    </section>
  );
}
