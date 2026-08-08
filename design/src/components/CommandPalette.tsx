import { useEffect, useId, useMemo, useRef, useState } from "react";
import RegexBuilder from "./RegexBuilder";
import { validateRegexPattern, type RegexBuilderState } from "@shared/regex";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { useAppStore } from "../store/useAppStore";
import { getUiCopy } from "../i18n/ui";
import "../styles/command-palette.css";

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  section?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function CommandPalette({ commands, open: controlledOpen, onOpenChange }: CommandPaletteProps) {
  const settings = useAppStore((state) => state.settings);
  const copy = getUiCopy(settings);
  const [localOpen, setLocalOpen] = useState(false);
  const [query, setQuery] = useState<RegexBuilderState>({ mode: "text", pattern: "", flags: "g", sample: "" });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const paletteId = useId();
  const titleId = `${paletteId}-title`;
  const listboxId = `${paletteId}-listbox`;
  const errorId = `${paletteId}-error`;
  const pendingId = `${paletteId}-pending`;
  const open = controlledOpen ?? localOpen;

  function restoreOpener() {
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener || !opener.isConnected || opener === document.body) return;
    window.requestAnimationFrame(() => {
      if (opener.isConnected) opener.focus();
    });
  }

  function setOpen(next: boolean) {
    if (next && !open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      openerRef.current = document.activeElement;
    }
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
    if (!next && open) restoreOpener();
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    if (!open) return;
    if (!openerRef.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      openerRef.current = document.activeElement;
    }
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const syntaxError = useMemo(
    () => (query.mode === "regex" && query.pattern.length > 0 ? validateRegexPattern(query.pattern, query.flags) : null),
    [query.flags, query.mode, query.pattern]
  );
  const commandSearchSamples = useMemo(
    () => commands.map((command) => `${command.label} ${command.description ?? ""} ${(command.keywords ?? []).join(" ")}`),
    [commands]
  );
  const regexBatch = useIsolatedRegexBatch(
    query.pattern,
    query.flags,
    commandSearchSamples,
    query.mode === "regex" && query.pattern.length > 0,
  );
  const queryError = syntaxError ?? (regexBatch.pending ? null : regexBatch.error);
  const queryErrorText = queryError ? localizedRegexEvaluationError(queryError, copy.text) : null;

  const filtered = useMemo(() => {
    const text = query.pattern.toLocaleLowerCase();
    if (query.pattern.length === 0) return commands;
    if (query.mode === "text") {
      return commands.filter((command) =>
        `${command.label} ${command.description ?? ""} ${(command.keywords ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(text)
      );
    }
    if (queryError || !regexBatch.evaluations) return [];
    return commands.filter((_, index) => (regexBatch.evaluations?.[index]?.matches.length ?? 0) > 0);
  }, [commands, query.mode, query.pattern, queryError, regexBatch.evaluations]);

  useEffect(() => {
    setActiveIndex((index) => (filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)));
  }, [filtered.length]);

  function closePalette() {
    setOpen(false);
  }

  function selectCommand(command: PaletteCommand | undefined) {
    if (!command) return;
    command.onSelect();
    closePalette();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (filtered.length === 0 ? 0 : Math.min(filtered.length - 1, index + 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (filtered.length === 0 ? 0 : Math.max(0, index - 1)));
    } else if (event.key === "Home" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectCommand(filtered[activeIndex] ?? filtered[0]);
    }
  }

  function handlePaletteKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // This is attached to the palette root so Escape works while focus is in
    // the nested RegexBuilder, not only while the search input is focused.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePalette();
    }
  }

  if (!open) return null;
  const activeOptionId = filtered[activeIndex] ? `${paletteId}-option-${activeIndex}` : undefined;

  return (
    <div
      className="palette-overlay"
      role="presentation"
      onKeyDown={handlePaletteKeyDown}
      onMouseDown={(event) => event.target === event.currentTarget && closePalette()}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="command-palette-header">
          <h2 id={titleId}>{copy.commandPalette}</h2>
          <kbd>Ctrl+Shift+F</kbd>
        </div>
        <input
          ref={inputRef}
          className="input command-palette-input"
          placeholder={copy.commandPaletteSearch}
          value={query.pattern}
          onChange={(event) => setQuery((current) => ({ ...current, pattern: event.target.value }))}
          onKeyDown={handleKeyDown}
          aria-label={copy.text("Command palette search", "指令面板搜尋")}
          role="combobox"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-invalid={queryErrorText !== null}
          aria-describedby={queryErrorText ? errorId : regexBatch.pending ? pendingId : undefined}
          aria-busy={regexBatch.pending || undefined}
        />
        {queryErrorText && (
          <p id={errorId} className="field-error" role="alert">
            {queryErrorText}
          </p>
        )}
        {!queryErrorText && regexBatch.pending && (
          <p id={pendingId} className="setting-helper" role="status">
            {copy.text("Evaluating safely…", "安全評估緊…")}
          </p>
        )}
        <div className="command-palette-regex">
          <RegexBuilder
            value={query}
            onChange={setQuery}
            title={copy.text("Command palette search builder", "指令面板搜尋建構器")}
            text={copy.text}
          />
        </div>
        <div className="command-palette-list" id={listboxId} role="listbox" aria-label={copy.text("Commands", "指令")} aria-busy={regexBatch.pending || undefined}>
          {regexBatch.pending ? (
            <div className="command-palette-empty" role="status">{copy.text("Evaluating safely…", "安全評估緊…")}</div>
          ) : filtered.length === 0 ? (
            <div className="command-palette-empty">{queryErrorText ? copy.fixPattern : copy.noMatchingCommands}</div>
          ) : (
            filtered.map((command, index) => (
              <button
                type="button"
                role="option"
                id={`${paletteId}-option-${index}`}
                aria-selected={index === activeIndex}
                className={`command-palette-row${index === activeIndex ? " active" : ""}`}
                key={command.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectCommand(command)}
              >
                <span>
                  <strong>{command.label}</strong>
                  {command.description && <small>{command.description}</small>}
                </span>
                {command.section && <em>{command.section}</em>}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
