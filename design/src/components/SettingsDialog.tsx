import { useEffect, useMemo, useState } from "react";
import type { AppSettings, SettingKey } from "@shared/types";
import { createDefaultSettings, isHexColor } from "@shared/settings";
import { createDefaultRegexBuilderState, evaluateRegex, type RegexBuilderState } from "@shared/regex";
import { getSettingsCopy } from "../i18n/settings";
import { useAppStore } from "../store/useAppStore";
import { settingSourceLabel } from "../store/settingsAppearance";
import Dialog from "./Dialog";
import { FolderIcon, SettingsIcon } from "./icons";
import RegexBuilder from "./RegexBuilder";

const SETTINGS_SEARCH_INDEX = [
  {
    id: "settings-language-heading",
    label: "Language mode English Cantonese bilingual funny level",
  },
  {
    id: "settings-appearance-heading",
    label: "Appearance theme density accent seed color font family font size weight",
  },
  {
    id: "settings-default-save-folder",
    label: "Default save folder browse folder",
  },
  {
    id: "settings-performance",
    label: "Max connections per download max active downloads",
  },
  {
    id: "settings-speed",
    label: "Global speed limit unlimited",
  },
  {
    id: "settings-startup",
    label: "Start on system startup",
  },
  {
    id: "settings-completion",
    label: "Show completion notification when a download completes",
  },
  {
    id: "settings-advanced",
    label: "Advanced minimum splittable part size",
  },
] as const;

const SETTINGS_SEARCH_SAMPLE = SETTINGS_SEARCH_INDEX.map((entry) => entry.label).join("\n");

export default function SettingsDialog() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setSettings = useAppStore((s) => s.setSettings);
  const pickFolder = useAppStore((s) => s.pickFolder);
  const currentSettings = useAppStore((s) => s.settings);
  const settingsFocus = useAppStore((s) => s.settingsFocus);

  const [form, setForm] = useState<AppSettings>(
    () => currentSettings ?? createDefaultSettings("")
  );
  const [unlimitedSpeed, setUnlimitedSpeed] = useState(form.globalSpeedLimitBytes === 0);
  const [speedMBs, setSpeedMBs] = useState(
    form.globalSpeedLimitBytes > 0 ? form.globalSpeedLimitBytes / (1024 * 1024) : 5
  );
  const [saving, setSaving] = useState(false);
  const [accentError, setAccentError] = useState<string | null>(null);
  const [settingsSearch, setSettingsSearch] = useState<RegexBuilderState>(() => ({
    ...createDefaultRegexBuilderState(),
    sample: SETTINGS_SEARCH_SAMPLE,
  }));
  const [settingsRegexOpen, setSettingsRegexOpen] = useState(false);

  const copy = useMemo(() => getSettingsCopy(form.languageMode), [form.languageMode]);
  const compiledDefaults = useMemo(
    () => createDefaultSettings(form.defaultSaveFolder),
    [form.defaultSaveFolder]
  );

  const settingsSearchEvaluation = useMemo(
    () =>
      settingsSearch.mode === "regex"
        ? evaluateRegex(settingsSearch.pattern, settingsSearch.flags, SETTINGS_SEARCH_SAMPLE)
        : null,
    [settingsSearch.flags, settingsSearch.mode, settingsSearch.pattern]
  );
  const matchingSettings = useMemo(() => {
    const query = settingsSearch.pattern;
    if (query.length === 0) return [];
    if (settingsSearch.mode === "regex") {
      if (settingsSearchEvaluation?.error) return [];
      return SETTINGS_SEARCH_INDEX.filter((entry) => {
        const evaluation = evaluateRegex(settingsSearch.pattern, settingsSearch.flags, entry.label);
        return !evaluation.error && evaluation.matches.length > 0;
      });
    }
    const normalizedQuery = query.toLocaleLowerCase();
    return SETTINGS_SEARCH_INDEX.filter((entry) => entry.label.toLocaleLowerCase().includes(normalizedQuery));
  }, [settingsSearch, settingsSearchEvaluation]);

  useEffect(() => {
    if (!settingsFocus) return;
    const targetId = settingsFocus === "language" ? "settings-language-mode" : "settings-theme";
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLElement)) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsFocus]);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetSetting<K extends SettingKey>(key: K) {
    update(key, compiledDefaults[key] as AppSettings[K]);
  }

  function source(key: SettingKey, compiledValue: string) {
    return settingSourceLabel(form, key, compiledValue)
      .replace("Source: persisted value", copy.sourcePersisted)
      .replace(/^Source: compiled-in value \((.*)\)$/, (_, value: string) => copy.sourceCompiledIn(value));
  }

  async function handlePickFolder() {
    const picked = await pickFolder();
    if (picked) update("defaultSaveFolder", picked);
  }

  function jumpToSetting(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    target.focus({ preventScroll: true });
  }

  function updateAccent(value: string) {
    update("accentSeedColor", value);
    setAccentError(isHexColor(value) ? null : copy.accentInvalid);
  }

  function resetAllSettings() {
    const defaults = createDefaultSettings(form.defaultSaveFolder);
    setForm({ ...defaults, defaultSaveFolder: form.defaultSaveFolder });
    setUnlimitedSpeed(true);
    setSpeedMBs(5);
    setAccentError(null);
  }

  async function handleSave() {
    if (!isHexColor(form.accentSeedColor)) {
      setAccentError(copy.accentInvalid);
      return;
    }

    setSaving(true);
    try {
      await setSettings({
        ...form,
        globalSpeedLimitBytes: unlimitedSpeed ? 0 : Math.round(speedMBs * 1024 * 1024),
      });
      closeSettings();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Settings"
      icon={<SettingsIcon size={16} />}
      onClose={closeSettings}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={closeSettings}>
            Cancel
          </button>
        </>
      }
    >
      <section className="settings-search" aria-labelledby="settings-search-heading">
        <div className="settings-section-heading" id="settings-search-heading">Search settings</div>
        <div className="settings-search-row">
          <input
            className="input"
            type="search"
            value={settingsSearch.pattern}
            placeholder="Search setting names and descriptions"
            aria-label="Search settings"
            aria-invalid={settingsSearchEvaluation?.error ? true : undefined}
            aria-describedby={settingsSearchEvaluation?.error ? "settings-search-error" : undefined}
            onChange={(event) => setSettingsSearch((current) => ({ ...current, pattern: event.target.value }))}
          />
          <button
            type="button"
            className={`btn btn-ghost btn-sm${settingsRegexOpen ? " active" : ""}`}
            aria-expanded={settingsRegexOpen}
            onClick={() => setSettingsRegexOpen((open) => !open)}
          >
            Regex
          </button>
        </div>
        {settingsRegexOpen && (
          <div className="settings-search-builder">
            <RegexBuilder
              title="Settings regex builder"
              value={settingsSearch}
              onChange={setSettingsSearch}
            />
          </div>
        )}
        {settingsSearchEvaluation?.error && <p id="settings-search-error" className="field-error" role="alert">{settingsSearchEvaluation.error}</p>}
        {settingsSearch.pattern.length > 0 && !settingsSearchEvaluation?.error && (
          <div className="settings-search-results" aria-live="polite">
            <span className="setting-helper">
              {matchingSettings.length} matching setting{matchingSettings.length === 1 ? "" : "s"}
            </span>
            {matchingSettings.length > 0 ? (
              <ul>
                {matchingSettings.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => jumpToSetting(entry.id)}>{entry.label}</button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="setting-helper">No settings match this search.</span>
            )}
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="settings-language-heading">
        <div className="settings-section-heading" id="settings-language-heading">{copy.language}</div>
        <p className="setting-helper">{copy.languageHelper}</p>
        <label className="field">
          <span className="field-label">{copy.language}</span>
          <select
            id="settings-language-mode"
            className="input select"
            value={form.languageMode}
            onChange={(e) => update("languageMode", e.target.value as AppSettings["languageMode"])}
          >
            <option value="english">{copy.english}</option>
            <option value="cantonese">{copy.cantonese}</option>
            <option value="bilingual">{copy.bilingual}</option>
          </select>
          <span className="setting-source">{source("languageMode", "English")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("languageMode")}>
            {copy.reset}
          </button>
        </label>

        <div className="settings-level-grid">
          <label className="field">
            <span className="field-label">{copy.funnyEnglish}</span>
            <input
              className="range-input"
              type="range"
              min={1}
              max={5}
              step={1}
              value={form.funnyLevelEnglish}
              onChange={(e) => update("funnyLevelEnglish", Number(e.target.value) as AppSettings["funnyLevelEnglish"])}
            />
            <output className="range-output">{form.funnyLevelEnglish} / 5</output>
            <span className="setting-source">{source("funnyLevelEnglish", "1")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("funnyLevelEnglish")}>
              {copy.reset}
            </button>
          </label>
          <label className="field">
            <span className="field-label">{copy.funnyCantonese}</span>
            <input
              className="range-input"
              type="range"
              min={1}
              max={5}
              step={1}
              value={form.funnyLevelCantonese}
              onChange={(e) => update("funnyLevelCantonese", Number(e.target.value) as AppSettings["funnyLevelCantonese"])}
            />
            <output className="range-output">{form.funnyLevelCantonese} / 5</output>
            <span className="setting-source">{source("funnyLevelCantonese", "3")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("funnyLevelCantonese")}>
              {copy.reset}
            </button>
          </label>
        </div>
        <p className="setting-disclosure" role="note">{copy.funnyDisclosure}</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-appearance-heading">
        <div className="settings-section-heading" id="settings-appearance-heading">{copy.appearance}</div>

        <label className="field">
          <span className="field-label">Theme</span>
          <select
            id="settings-theme"
            className="input select"
            value={form.theme}
            onChange={(e) => update("theme", e.target.value as AppSettings["theme"])}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
          <span className="setting-source">{source("theme", "dark")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("theme")}>
            {copy.reset}
          </button>
        </label>

        <label className="field">
          <span className="field-label">{copy.density}</span>
          <select
            className="input select"
            value={form.density}
            onChange={(e) => update("density", e.target.value as AppSettings["density"])}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
          <span className="setting-helper">{copy.densityHelper}</span>
          <span className="setting-source">{source("density", "comfortable")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("density")}>
            {copy.reset}
          </button>
        </label>

        <label className="field">
          <span className="field-label">{copy.accent}</span>
          <div className="field-row">
            <input
              className="color-input"
              type="color"
              aria-label="Accent color picker"
              value={form.accentSeedColor.slice(0, 7)}
              onChange={(e) => updateAccent(e.target.value)}
            />
            <input
              className="input"
              type="text"
              value={form.accentSeedColor}
              aria-invalid={accentError !== null}
              onChange={(e) => updateAccent(e.target.value)}
            />
          </div>
          <span className="setting-helper">{copy.accentHelper}</span>
          {accentError && <span className="field-error">{accentError}</span>}
          <span className="setting-source">{source("accentSeedColor", "#7c5cff")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("accentSeedColor")}>
            {copy.reset}
          </button>
        </label>

        <label className="field">
          <span className="field-label">{copy.fontFamily}</span>
          <select
            className="input select"
            value={form.uiFontFamily}
            onChange={(e) => update("uiFontFamily", e.target.value as AppSettings["uiFontFamily"])}
          >
            <option value="segoe-ui">Segoe UI · Windows bundled</option>
            <option value="inter">Inter · installed/bundled fallback</option>
            <option value="cascadia-code">Cascadia Code · Windows bundled</option>
            <option value="system">System UI · platform fallback</option>
          </select>
          <span className="setting-helper">{copy.fontFamilyHelper}</span>
          <span className="setting-source">{source("uiFontFamily", "Segoe UI")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("uiFontFamily")}>
            {copy.reset}
          </button>
        </label>

        <div className="field-pair">
          <label className="field">
            <span className="field-label">{copy.fontSize}</span>
            <input
              className="input"
              type="number"
              min={10}
              max={32}
              value={form.uiFontSize}
              onChange={(e) => update("uiFontSize", Math.min(32, Math.max(10, Number(e.target.value) || 10)))}
            />
            <span className="setting-source">{source("uiFontSize", "13px")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("uiFontSize")}>
              {copy.reset}
            </button>
          </label>
          <label className="field">
            <span className="field-label">{copy.fontWeight}</span>
            <select
              className="input select"
              value={form.uiFontWeight}
              onChange={(e) => update("uiFontWeight", Number(e.target.value) as AppSettings["uiFontWeight"])}
            >
              <option value={400}>400 · Regular</option>
              <option value={500}>500 · Medium</option>
              <option value={600}>600 · Semibold</option>
              <option value={700}>700 · Bold</option>
            </select>
            <span className="setting-source">{source("uiFontWeight", "400")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("uiFontWeight")}>
              {copy.reset}
            </button>
          </label>
        </div>

        <button type="button" className="btn btn-ghost" onClick={resetAllSettings} title={copy.resetAllConfirmation}>
          {copy.resetAll} (save folder kept · 保留儲存資料夾)
        </button>
      </section>

      <label className="field" id="settings-default-save-folder" tabIndex={-1}>
        <span className="field-label">Default save folder</span>
        <div className="field-row">
          <input
            className="input"
            type="text"
            value={form.defaultSaveFolder}
            onChange={(e) => update("defaultSaveFolder", e.target.value)}
          />
          <button type="button" className="icon-btn" title="Choose folder" onClick={() => void handlePickFolder()}>
            <FolderIcon size={15} />
          </button>
        </div>
        <span className="setting-source">{source("defaultSaveFolder", "the platform Downloads folder")}</span>
      </label>

      <div className="field-pair" id="settings-performance" tabIndex={-1}>
        <label className="field">
          <span className="field-label">Max connections per download</span>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={form.maxConnectionsPerDownload}
            onChange={(e) => update("maxConnectionsPerDownload", Number(e.target.value) || 1)}
          />
          <span className="setting-source">{source("maxConnectionsPerDownload", "8")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("maxConnectionsPerDownload")}>
            {copy.reset}
          </button>
        </label>
        <label className="field">
          <span className="field-label">Max active downloads</span>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={form.maxActiveDownloads}
            onChange={(e) => update("maxActiveDownloads", Number(e.target.value) || 1)}
          />
          <span className="setting-source">{source("maxActiveDownloads", "3")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("maxActiveDownloads")}>
            {copy.reset}
          </button>
        </label>
      </div>

      <label className="field" id="settings-speed" tabIndex={-1}>
        <span className="field-label">Global speed limit</span>
        <div className="field-row">
          <input
            className="input"
            type="number"
            min={0.1}
            step={0.1}
            disabled={unlimitedSpeed}
            value={speedMBs}
            onChange={(e) => setSpeedMBs(Number(e.target.value) || 0)}
          />
          <span className="field-suffix">MB/s</span>
          <label className="checkbox-row">
            <button
              type="button"
              className={`checkbox${unlimitedSpeed ? " checked" : ""}`}
              onClick={() => setUnlimitedSpeed((v) => !v)}
              aria-label="Unlimited speed"
            />
            <span>Unlimited</span>
          </label>
        </div>
        <span className="setting-source">{source("globalSpeedLimitBytes", "0 bytes/sec (unlimited)")}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm setting-reset"
          onClick={() => {
            resetSetting("globalSpeedLimitBytes");
            setUnlimitedSpeed(true);
            setSpeedMBs(5);
          }}
        >
          {copy.reset}
        </button>
      </label>

      <label className="checkbox-row field" id="settings-startup" tabIndex={-1}>
        <button
          type="button"
          className={`checkbox${form.startOnSystemStartup ? " checked" : ""}`}
          onClick={() => update("startOnSystemStartup", !form.startOnSystemStartup)}
          aria-label="Start on system startup"
        />
        <span>Start on system startup</span>
        <span className="setting-source">{source("startOnSystemStartup", "false")}</span>
        <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("startOnSystemStartup")}>
          {copy.reset}
        </button>
      </label>

      <label className="checkbox-row field" id="settings-completion" tabIndex={-1}>
        <button
          type="button"
          className={`checkbox${form.showCompleteDialog ? " checked" : ""}`}
          onClick={() => update("showCompleteDialog", !form.showCompleteDialog)}
          aria-label="Show completion notification"
        />
        <span>Show a non-blocking notification when a download completes</span>
        <span className="setting-source">{source("showCompleteDialog", "true")}</span>
        <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("showCompleteDialog")}>
          {copy.reset}
        </button>
      </label>

      <details className="advanced-details" id="settings-advanced" tabIndex={-1}>
        <summary>Advanced</summary>
        <label className="field">
          <span className="field-label">Minimum splittable part size (KB)</span>
          <input
            className="input"
            type="number"
            min={1}
            value={Math.round(form.minConnectionPartSize / 1024)}
            onChange={(e) => update("minConnectionPartSize", Math.max(1, Number(e.target.value) || 1) * 1024)}
          />
          <span className="setting-source">{source("minConnectionPartSize", "2048 KB")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("minConnectionPartSize")}>
            {copy.reset}
          </button>
        </label>
      </details>
    </Dialog>
  );
}
