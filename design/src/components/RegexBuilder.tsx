import { useEffect, useMemo, useState } from "react";
import {
  createDefaultRegexBuilderState,
  evaluateRegex,
  guidedTokenToPattern,
  REGEX_FLAGS,
  type RegexBuilderState,
} from "@shared/regex";
import "../styles/regex.css";

interface RegexBuilderProps {
  value?: RegexBuilderState;
  onChange?: (value: RegexBuilderState) => void;
  title?: string;
  className?: string;
}

const FLAG_LABELS: Record<string, string> = {
  g: "Global",
  i: "Case insensitive",
  m: "Multiline",
  s: "Dot matches newline",
  u: "Unicode",
  y: "Sticky",
};

/**
 * Full local builder used by search fields. It intentionally advertises the
 * actual JavaScript RegExp dialect and keeps plain-text mode as the default.
 */
export default function RegexBuilder({ value, onChange, title = "Regex builder", className }: RegexBuilderProps) {
  const [local, setLocal] = useState<RegexBuilderState>(value ?? createDefaultRegexBuilderState());
  const state = value ?? local;
  const evaluation = useMemo(
    () => (state.mode === "regex" ? evaluateRegex(state.pattern, state.flags, state.sample) : null),
    [state.flags, state.mode, state.pattern, state.sample]
  );

  useEffect(() => {
    if (value) setLocal(value);
  }, [value]);

  function update(patch: Partial<RegexBuilderState>) {
    const next = { ...state, ...patch };
    if (!value) setLocal(next);
    onChange?.(next);
  }

  function toggleFlag(flag: string) {
    const nextFlags = state.flags.includes(flag)
      ? state.flags.replace(flag, "")
      : `${state.flags}${flag}`;
    update({ flags: nextFlags });
  }

  function insertGuided(pattern: string) {
    update({ mode: "regex", pattern: `${state.pattern}${pattern}` });
  }

  async function copyPattern() {
    await navigator.clipboard?.writeText(`/${state.pattern}/${state.flags}`);
  }

  function exportPattern() {
    const payload = JSON.stringify({ dialect: "JavaScript RegExp", pattern: state.pattern, flags: state.flags }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "material-download-manager-regex.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={`regex-builder${className ? ` ${className}` : ""}`} aria-label={title}>
      <div className="regex-builder-header">
        <div>
          <h3>{title}</h3>
          <p>JavaScript RegExp · plain text stays the default · bounded local evaluation</p>
        </div>
        <div className="regex-builder-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyPattern()} disabled={!state.pattern}>
            Copy
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportPattern} disabled={!state.pattern}>
            Export
          </button>
        </div>
      </div>

      <div className="regex-mode" role="radiogroup" aria-label="Search mode">
        <label>
          <input type="radio" name="regex-mode" checked={state.mode === "text"} onChange={() => update({ mode: "text" })} />
          Plain text
        </label>
        <label>
          <input type="radio" name="regex-mode" checked={state.mode === "regex"} onChange={() => update({ mode: "regex" })} />
          Regular expression
        </label>
      </div>

      <label className="field">
        <span className="field-label">Pattern</span>
        <input
          className="input regex-pattern"
          value={state.pattern}
          onChange={(event) => update({ pattern: event.target.value, mode: "regex" })}
          maxLength={2048}
          spellCheck={false}
          aria-describedby="regex-dialect"
        />
      </label>

      <div className="regex-guided" aria-label="Guided construction">
        <span className="field-label">Build</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided(guidedTokenToPattern({ kind: "literal", value: "text" }))}>
          Literal
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided(guidedTokenToPattern({ kind: "characterClass", value: "a-z" }))}>
          Character class
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("^")}>
          Start anchor
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("$")}>
          End anchor
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("(?:group)")}>
          Group
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("(?:one|two)")}>
          Alternation
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertGuided("atom{1,3}")}>
          Quantifier
        </button>
      </div>

      <div className="regex-flags" aria-label="Regular expression flags">
        <span className="field-label">Flags</span>
        {REGEX_FLAGS.map((flag) => (
          <label key={flag} title={FLAG_LABELS[flag]}>
            <input type="checkbox" checked={state.flags.includes(flag)} onChange={() => toggleFlag(flag)} />
            <code>{flag}</code>
            <span>{FLAG_LABELS[flag]}</span>
          </label>
        ))}
      </div>

      <label className="field">
        <span className="field-label">Sample text</span>
        <textarea
          className="input textarea regex-sample"
          value={state.sample}
          onChange={(event) => update({ sample: event.target.value })}
          maxLength={100000}
          rows={4}
        />
      </label>

      <div id="regex-dialect" className="regex-dialect-note">
        {evaluation?.error ? <span className="text-danger">{evaluation.error}</span> : "The pattern runs locally in the JavaScript RegExp engine."}
      </div>

      {evaluation && !evaluation.error && (
        <div className="regex-results" aria-live="polite">
          <div className="regex-results-header">
            <span>{evaluation.matches.length} match{evaluation.matches.length === 1 ? "" : "es"}</span>
            {evaluation.truncated && <span className="text-danger">Result list or sample was bounded.</span>}
          </div>
          {evaluation.matches.length === 0 ? (
            <div className="regex-empty">No matches in the sample.</div>
          ) : (
            <ol>
              {evaluation.matches.map((match, index) => (
                <li key={`${match.index}-${index}`}>
                  <code>{match.text || "(zero-width)"}</code> at {match.index}
                  {match.captures.length > 0 && <span className="regex-captures">captures: {JSON.stringify(match.captures)}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
