import { useEffect, useId, useMemo, useState } from "react";
import {
  createDefaultRegexBuilderState,
  guidedTokenToPattern,
  normalizeRegexFlags,
  REGEX_FLAGS,
  type RegexBuilderState,
} from "@shared/regex";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { useExternalEditorExport } from "../hooks/useExternalEditorExport";
import "../styles/regex.css";

interface RegexBuilderProps {
  value?: RegexBuilderState;
  onChange?: (value: RegexBuilderState) => void;
  title?: string;
  className?: string;
  fixedRegex?: boolean;
  patternMaxLength?: number;
  text?: (english: string, cantonese: string) => string;
}

const FLAG_LABELS: Record<string, readonly [string, string]> = {
  g: ["Global", "全域"],
  i: ["Case insensitive", "不分大小寫"],
  m: ["Multiline", "多行"],
  s: ["Dot matches newline", "句點包括換行"],
  u: ["Unicode", "Unicode"],
  y: ["Sticky", "黏附模式"],
};

/**
 * Full local builder used by search fields. It intentionally advertises the
 * actual JavaScript RegExp dialect and keeps plain-text mode as the default.
 */
export default function RegexBuilder({
  value,
  onChange,
  title = "Regex builder",
  className,
  fixedRegex = false,
  patternMaxLength = 2048,
  text,
}: RegexBuilderProps) {
  const [local, setLocal] = useState<RegexBuilderState>(value ?? createDefaultRegexBuilderState());
  const [guidedError, setGuidedError] = useState(false);
  const modeGroupId = useId();
  const dialectId = useId();
  const guidedErrorId = useId();
  const state = value ?? local;
  const activeMode = fixedRegex ? "regex" : state.mode;
  const t = text ?? ((english: string) => english);
  const contextualName = (english: string, cantonese: string) => `${title}: ${t(english, cantonese)}`;
  const {
    editorExport,
    setEditorExport,
    editorBusy,
    editorMessage,
    setEditorMessage,
    openLastExportInEditor,
  } = useExternalEditorExport(t);
  const evaluationSamples = useMemo(() => [state.sample], [state.sample]);
  const isolatedEvaluation = useIsolatedRegexBatch(
    state.pattern,
    state.flags,
    evaluationSamples,
    activeMode === "regex" && state.pattern.length > 0,
    true
  );
  const evaluation = isolatedEvaluation.evaluations?.[0] ?? null;
  const evaluationError = fixedRegex && state.pattern.length === 0
    ? t("Enter a regular expression pattern.", "請輸入正規表示式模式。")
    : evaluation?.error
      ? localizedRegexEvaluationError(evaluation.error, t)
      : null;

  useEffect(() => {
    if (
      value &&
      (local.mode !== value.mode || local.pattern !== value.pattern || local.flags !== value.flags || local.sample !== value.sample)
    ) {
      setLocal(value);
    }
  }, [local.flags, local.mode, local.pattern, local.sample, value]);

  function update(patch: Partial<RegexBuilderState>) {
    const next = { ...state, ...patch, ...(fixedRegex ? { mode: "regex" as const } : {}) };
    if (!value) setLocal(next);
    onChange?.(next);
  }

  function toggleFlag(flag: string) {
    const nextFlags = state.flags.includes(flag)
      ? state.flags.replace(flag, "")
      : `${state.flags}${flag}`;
    update({ flags: normalizeRegexFlags(nextFlags) });
  }

  function insertGuided(pattern: string) {
    if (state.pattern.length + pattern.length > patternMaxLength) {
      setGuidedError(true);
      return;
    }
    setGuidedError(false);
    update({ mode: "regex", pattern: `${state.pattern}${pattern}` });
  }

  async function copyPattern() {
    await navigator.clipboard?.writeText(`/${state.pattern}/${state.flags}`);
  }

  function exportPattern() {
    const fileName = "material-download-manager-regex.json";
    const payload = JSON.stringify({ dialect: "JavaScript RegExp", pattern: state.pattern, flags: state.flags }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    setEditorExport({ content: payload, fileName });
    setEditorMessage(null);
  }

  return (
    <section
      className={`regex-builder${className ? ` ${className}` : ""}`}
      aria-label={title}
      aria-busy={isolatedEvaluation.pending || undefined}
    >
      <div className="regex-builder-header">
        <div>
          <h3>{title}</h3>
          <p>
            {fixedRegex
              ? t("JavaScript RegExp · this rule always uses regex · bounded local evaluation", "JavaScript RegExp · 呢條規則固定用 regex · 有界本機評估")
              : t("JavaScript RegExp · plain text stays the default · bounded local evaluation", "JavaScript RegExp · 預設保持純文字 · 有界本機評估")}
          </p>
        </div>
        <div className="regex-builder-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void copyPattern()}
            disabled={!state.pattern}
            aria-label={contextualName("Copy", "複製")}
            aria-describedby={!state.pattern ? dialectId : undefined}
            title={!state.pattern ? t("Enter a pattern before copying.", "請先輸入模式先可以複製。") : undefined}
          >
            {t("Copy", "複製")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exportPattern}
            disabled={!state.pattern}
            aria-label={contextualName("Export", "匯出")}
            aria-describedby={!state.pattern ? dialectId : undefined}
            title={!state.pattern ? t("Enter a pattern before exporting.", "請先輸入模式先可以匯出。") : undefined}
          >
            {t("Export", "匯出")}
          </button>
          {editorExport && <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void openLastExportInEditor()}
            disabled={editorBusy}
            aria-label={contextualName("Open last export in Visual Studio Code", "用 Visual Studio Code 開啟上次匯出")}
          >
            {editorBusy ? t("Opening editor…", "開緊編輯器…") : t("Open last export in Visual Studio Code", "用 Visual Studio Code 開啟上次匯出")}
          </button>}
        </div>
      </div>
      {editorMessage && <p className="regex-editor-message" role="status" aria-live="polite">{editorMessage}</p>}

      {!fixedRegex && <div className="regex-mode" role="radiogroup" aria-label={contextualName("Search mode", "搜尋模式")}>
        <label>
          <input aria-label={contextualName("Plain text", "純文字")} type="radio" name={`${modeGroupId}-regex-mode`} checked={state.mode === "text"} onChange={() => update({ mode: "text" })} />
          {t("Plain text", "純文字")}
        </label>
        <label>
          <input aria-label={contextualName("Regular expression", "正規表示式")} type="radio" name={`${modeGroupId}-regex-mode`} checked={state.mode === "regex"} onChange={() => update({ mode: "regex" })} />
          {t("Regular expression", "正規表示式")}
        </label>
      </div>}

      <label className="field">
        <span className="field-label">{t("Pattern", "模式")}</span>
        <input
          className="input regex-pattern"
          aria-label={contextualName("Pattern", "模式")}
          value={state.pattern}
          onChange={(event) => {
            setGuidedError(false);
            update({ pattern: event.target.value, mode: "regex" });
          }}
          maxLength={patternMaxLength}
          spellCheck={false}
          aria-invalid={evaluationError ? true : undefined}
          aria-describedby={`${dialectId}${guidedError ? ` ${guidedErrorId}` : ""}`}
        />
      </label>

      <div className="regex-guided" role="group" aria-label={contextualName("Guided construction", "引導式建立")}>
        <span className="field-label">{t("Build", "引導建立")}</span>
        <button aria-label={contextualName("Literal", "字面文字")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided(guidedTokenToPattern({ kind: "literal", value: "text" }))}>
          {t("Literal", "字面文字")}
        </button>
        <button aria-label={contextualName("Character class", "字元類別")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided(guidedTokenToPattern({ kind: "characterClass", value: "a-z" }))}>
          {t("Character class", "字元類別")}
        </button>
        <button aria-label={contextualName("Start anchor", "開頭錨點")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("^")}>
          {t("Start anchor", "開頭錨點")}
        </button>
        <button aria-label={contextualName("End anchor", "結尾錨點")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("$")}>
          {t("End anchor", "結尾錨點")}
        </button>
        <button aria-label={contextualName("Group", "群組")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("(?:group)")}>
          {t("Group", "群組")}
        </button>
        <button aria-label={contextualName("Alternation", "或選項")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("(?:one|two)")}>
          {t("Alternation", "或選項")}
        </button>
        <button aria-label={contextualName("Quantifier", "數量詞")} type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("atom{1,3}")}>
          {t("Quantifier", "數量詞")}
        </button>
      </div>
      {guidedError && (
        <p id={guidedErrorId} className="field-error" role="status">
          {t(
            `That guided fragment would exceed the ${patternMaxLength}-character pattern limit and was not added.`,
            `嗰段引導式內容會超過 ${patternMaxLength} 個字元上限，所以冇加入。`
          )}
        </p>
      )}

      <div className="regex-flags" role="group" aria-label={contextualName("Regular expression flags", "正規表示式旗標")}>
        <span className="field-label">{t("Flags", "旗標")}</span>
        {REGEX_FLAGS.map((flag) => (
          <label key={flag} title={t(...FLAG_LABELS[flag])}>
            <input aria-label={`${title}: ${t(...FLAG_LABELS[flag])}`} type="checkbox" checked={state.flags.includes(flag)} onChange={() => toggleFlag(flag)} />
            <code>{flag}</code>
            <span>{t(...FLAG_LABELS[flag])}</span>
          </label>
        ))}
      </div>

      <label className="field">
        <span className="field-label">{t("Sample text", "範例文字")}</span>
        <textarea
          className="input textarea regex-sample"
          aria-label={contextualName("Sample text", "範例文字")}
          value={state.sample}
          onChange={(event) => update({ sample: event.target.value })}
          maxLength={100000}
          rows={4}
        />
      </label>

      <div
        id={dialectId}
        className="regex-dialect-note"
        role={evaluationError ? "alert" : "status"}
        aria-live={evaluationError ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {isolatedEvaluation.pending ? (
          t("Evaluating safely…", "安全評估緊…")
        ) : evaluationError ? (
          <span className="text-danger">{evaluationError}</span>
        ) : (
          t("The pattern runs locally in the JavaScript RegExp engine.", "模式只會喺本機 JavaScript RegExp 引擎執行。")
        )}
      </div>

      {evaluation && !evaluation.error && (
        <div className="regex-results" aria-live="polite">
          <div className="regex-results-header">
            <span>{evaluation.matches.length} {t(evaluation.matches.length === 1 ? "match" : "matches", "個相符結果")}</span>
            {evaluation.truncated && <span className="text-danger">{t("Result list or sample was bounded.", "結果清單或範例已按上限截短。")}</span>}
          </div>
          {evaluation.matches.length === 0 ? (
            <div className="regex-empty">{t("No matches in the sample.", "範例冇相符結果。")}</div>
          ) : (
            <ol>
              {evaluation.matches.map((match, index) => (
                <li key={`${match.index}-${index}`}>
                  <code>{match.text || t("(zero-width)", "（零寬度）")}</code> {t("at", "位置")} {match.index}
                  {match.captures.length > 0 && <span className="regex-captures">{t("captures", "擷取群組")}: {JSON.stringify(match.captures)}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
