import { useEffect, useMemo, useRef, useState } from "react";
import RegexBuilder from "./RegexBuilder";
import { evaluateRegex, type RegexBuilderState } from "@shared/regex";
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
  const [localOpen, setLocalOpen] = useState(false);
  const [query, setQuery] = useState<RegexBuilderState>({ mode: "text", pattern: "", flags: "g", sample: "" });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = controlledOpen ?? localOpen;

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
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
    if (open) {
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const text = query.pattern.trim().toLocaleLowerCase();
    if (!text) return commands;
    if (query.mode === "text") {
      return commands.filter((command) => `${command.label} ${command.description ?? ""} ${(command.keywords ?? []).join(" ")}`.toLocaleLowerCase().includes(text));
    }
    return commands.filter((command) => {
      const text = `${command.label} ${command.description ?? ""} ${(command.keywords ?? []).join(" ")}`;
      const result = evaluateRegex(query.pattern, query.flags, text);
      return !result.error && result.matches.length > 0;
    });
  }, [commands, query.mode, query.pattern, query.flags]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      filtered[activeIndex]?.onSelect();
      setOpen(false);
    }
  }

  if (!open) return null;
  return (
    <div className="palette-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <div className="command-palette-header">
          <h2 id="command-palette-title">Command palette</h2>
          <kbd>Ctrl+Shift+F</kbd>
        </div>
        <input
          ref={inputRef}
          className="input command-palette-input"
          placeholder="Search commands, features, settings"
          value={query.pattern}
          onChange={(event) => setQuery((current) => ({ ...current, pattern: event.target.value }))}
          onKeyDown={handleKeyDown}
          aria-label="Command palette search"
        />
        <div className="command-palette-regex">
          <RegexBuilder
            value={query}
            onChange={setQuery}
            title="Command palette search builder"
          />
        </div>
        <div className="command-palette-list" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No matching commands.</div>
          ) : (
            filtered.map((command, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`command-palette-row${index === activeIndex ? " active" : ""}`}
                key={command.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  command.onSelect();
                  setOpen(false);
                }}
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
