import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AppSettings, SettingKey } from "@shared/types";
import { createDefaultSettings, isHexColor } from "@shared/settings";
import { createDefaultRegexBuilderState, evaluateRegex, type RegexBuilderState } from "@shared/regex";
import { getSettingsCopy } from "../i18n/settings";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import {
  DEFAULT_DISPLAY_NAME,
  normalizeDisplayName,
  readDisplayName,
  saveDisplayName,
} from "../store/displayPreferences";
import { settingSourceLabel } from "../store/settingsAppearance";
import Dialog from "./Dialog";
import { FolderIcon, SettingsIcon } from "./icons";
import RegexBuilder from "./RegexBuilder";

type SettingsTab = "language" | "appearance" | "downloads" | "advanced";

const SETTINGS_TABS: readonly SettingsTab[] = ["language", "appearance", "downloads", "advanced"];
const SETTINGS_TAB_STORAGE_KEY = "material-download-manager.settings.active-tab";

const SETTINGS_SEARCH_INDEX = [
  {
    id: "settings-language-heading",
    targetId: "settings-language-mode",
    tab: "language" as const,
    label: "Language mode English Cantonese bilingual funny level",
  },
  {
    id: "settings-appearance-heading",
    targetId: "settings-theme",
    tab: "appearance" as const,
    label: "Appearance theme density accent seed color font family font size weight",
  },
  {
    id: "settings-display-name",
    targetId: "settings-display-name-input",
    tab: "appearance" as const,
    label: "App display name title bar notifications identity data folder installer update feed",
  },
  {
    id: "settings-default-save-folder",
    targetId: "settings-default-save-folder-input",
    tab: "downloads" as const,
    label: "Default save folder browse folder",
  },
  {
    id: "settings-performance",
    targetId: "settings-max-connections-per-download",
    tab: "downloads" as const,
    label: "Max connections per download max active downloads",
  },
  {
    id: "settings-speed",
    targetId: "settings-global-speed-limit",
    tab: "downloads" as const,
    label: "Global speed limit unlimited",
  },
  {
    id: "settings-startup",
    targetId: "settings-startup-toggle",
    tab: "downloads" as const,
    label: "Start on system startup",
  },
  {
    id: "settings-completion",
    targetId: "settings-completion-toggle",
    tab: "downloads" as const,
    label: "Show completion notification when a download completes",
  },
  {
    id: "settings-advanced",
    targetId: "settings-min-splittable-part-size",
    tab: "advanced" as const,
    label: "Advanced minimum splittable part size",
  },
] as const;

function readSettingsTab(): SettingsTab {
  try {
    const stored = window.localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (stored && SETTINGS_TABS.includes(stored as SettingsTab)) return stored as SettingsTab;
  } catch {
    // A locked-down profile simply uses the stable first tab.
  }
  return "language";
}

function createSettingsSearchState(tab: SettingsTab): RegexBuilderState {
  return {
    ...createDefaultRegexBuilderState(),
    sample: SETTINGS_SEARCH_INDEX.filter((entry) => entry.tab === tab).map((entry) => entry.label).join("\n"),
  };
}

function createSettingsSearchStates(): Record<SettingsTab, RegexBuilderState> {
  return {
    language: createSettingsSearchState("language"),
    appearance: createSettingsSearchState("appearance"),
    downloads: createSettingsSearchState("downloads"),
    advanced: createSettingsSearchState("advanced"),
  };
}

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
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(() => {
    if (settingsFocus === "language" || settingsFocus === "appearance") return settingsFocus;
    return readSettingsTab();
  });
  const appliedSettingsFocus = useRef<typeof settingsFocus>(null);
  const [settingsSearches, setSettingsSearches] = useState<Record<SettingsTab, RegexBuilderState>>(createSettingsSearchStates);
  const settingsSearch = settingsSearches[activeSettingsTab];
  const [settingsRegexOpen, setSettingsRegexOpen] = useState(false);
  const settingsRegexButtonRef = useRef<HTMLButtonElement>(null);
  const [displayName, setDisplayName] = useState(readDisplayName);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

  const copy = useMemo(() => getSettingsCopy(form.languageMode), [form.languageMode]);
  const ui = useMemo(() => getUiCopy(form), [form]);
  const compiledDefaults = useMemo(
    () => createDefaultSettings(form.defaultSaveFolder),
    [form.defaultSaveFolder]
  );

  const settingsSearchEvaluation = useMemo(
    () =>
      settingsSearch.mode === "regex"
        ? evaluateRegex(settingsSearch.pattern, settingsSearch.flags, settingsSearch.sample)
        : null,
    [settingsSearch.flags, settingsSearch.mode, settingsSearch.pattern, settingsSearch.sample]
  );
  const matchingSettings = useMemo(() => {
    const query = settingsSearch.pattern;
    if (query.length === 0) return [];
    if (settingsSearch.mode === "regex") {
      if (settingsSearchEvaluation?.error) return [];
      return SETTINGS_SEARCH_INDEX.filter((entry) => entry.tab === activeSettingsTab).filter((entry) => {
        const evaluation = evaluateRegex(settingsSearch.pattern, settingsSearch.flags, entry.label);
        return !evaluation.error && evaluation.matches.length > 0;
      });
    }
    const normalizedQuery = query.toLocaleLowerCase();
    return SETTINGS_SEARCH_INDEX
      .filter((entry) => entry.tab === activeSettingsTab)
      .filter((entry) => entry.label.toLocaleLowerCase().includes(normalizedQuery));
  }, [activeSettingsTab, settingsSearch, settingsSearchEvaluation]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, activeSettingsTab);
    } catch {
      // A locked-down profile can still use the tabbed surface for this session.
    }
  }, [activeSettingsTab]);

  function updateSettingsSearch(value: RegexBuilderState) {
    setSettingsSearches((current) => ({ ...current, [activeSettingsTab]: value }));
  }

  function selectSettingsTab(tab: SettingsTab) {
    setActiveSettingsTab(tab);
    setSettingsRegexOpen(false);
  }

  function handleSettingsTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) {
    const currentIndex = SETTINGS_TABS.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % SETTINGS_TABS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SETTINGS_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = SETTINGS_TABS[nextIndex];
    selectSettingsTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`settings-tab-${nextTab}`)?.focus());
  }

  useEffect(() => {
    if (!settingsFocus) return;
    if (appliedSettingsFocus.current === settingsFocus) return;
    appliedSettingsFocus.current = settingsFocus;
    if (settingsFocus === "language" || settingsFocus === "appearance") {
      setActiveSettingsTab(settingsFocus);
    }
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
    const entry = SETTINGS_SEARCH_INDEX.find((candidate) => candidate.targetId === id);
    if (entry && entry.tab !== activeSettingsTab) {
      selectSettingsTab(entry.tab);
      window.requestAnimationFrame(() => jumpToSetting(id));
      return;
    }
    const target = document.getElementById(id);
    if (!(target instanceof HTMLElement)) return;
    const details = target.closest("details");
    if (details instanceof HTMLDetailsElement) details.open = true;
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
    setDisplayName(DEFAULT_DISPLAY_NAME);
    setDisplayNameError(null);
    setUnlimitedSpeed(true);
    setSpeedMBs(5);
    setAccentError(null);
  }

  function closeSettingsRegexBuilder() {
    setSettingsRegexOpen(false);
  }

  useLayoutEffect(() => {
    if (settingsRegexOpen) return;
    settingsRegexButtonRef.current?.focus({ preventScroll: true });
  }, [settingsRegexOpen]);

  function handleSettingsEscape() {
    if (!settingsRegexOpen) return false;
    closeSettingsRegexBuilder();
    return true;
  }

  async function handleSave() {
    if (!isHexColor(form.accentSeedColor)) {
      setAccentError(copy.accentInvalid);
      return;
    }
    if (!displayName.trim()) {
      setDisplayNameError(ui.displayNameInvalid);
      return;
    }

    setSaving(true);
    try {
      await setSettings({
        ...form,
        globalSpeedLimitBytes: unlimitedSpeed ? 0 : Math.round(speedMBs * 1024 * 1024),
      });
      saveDisplayName(normalizeDisplayName(displayName));
      closeSettings();
    } finally {
      setSaving(false);
    }
  }

  const settingsTabLabels: Record<SettingsTab, string> = {
    language: ui.text("Language", "語言"),
    appearance: ui.text("Appearance", "外觀"),
    downloads: ui.text("Downloads", "下載"),
    advanced: ui.text("Advanced", "進階"),
  };

  function renderSettingsSearch() {
    return (
      <section className="settings-search" aria-labelledby={`settings-search-heading-${activeSettingsTab}`}>
        <div className="settings-section-heading" id={`settings-search-heading-${activeSettingsTab}`}>
          {ui.text("Search this settings tab", "搜尋呢個設定分頁")}
        </div>
        <div className="settings-search-row">
          <input
            className="input"
            type="search"
            value={settingsSearch.pattern}
            placeholder={ui.text("Search setting names and descriptions", "搜尋設定名稱同描述")}
            aria-label={ui.text("Search settings", "搜尋設定")}
            aria-invalid={settingsSearchEvaluation?.error ? true : undefined}
            aria-describedby={settingsSearchEvaluation?.error ? `settings-search-error-${activeSettingsTab}` : undefined}
            onChange={(event) => updateSettingsSearch({ ...settingsSearch, pattern: event.target.value })}
          />
          <button
            type="button"
            ref={settingsRegexButtonRef}
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
              title={`${settingsTabLabels[activeSettingsTab]} regex builder`}
              value={settingsSearch}
              onChange={updateSettingsSearch}
            />
          </div>
        )}
        {settingsSearchEvaluation?.error && (
          <p id={`settings-search-error-${activeSettingsTab}`} className="field-error" role="alert">
            {settingsSearchEvaluation.error}
          </p>
        )}
        {settingsSearch.pattern.length > 0 && !settingsSearchEvaluation?.error && (
          <div className="settings-search-results" aria-live="polite">
            <span className="setting-helper">
              {matchingSettings.length} {ui.text("matching setting", "個相符設定")}{matchingSettings.length === 1 ? "" : "s"}
            </span>
            {matchingSettings.length > 0 ? (
              <ul>
                {matchingSettings.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => jumpToSetting(entry.targetId)}>{entry.label}</button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="setting-helper">{ui.text("No settings match this search.", "搵唔到相符設定。")}</span>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <Dialog
      title={ui.settings}
      icon={<SettingsIcon size={16} />}
      onClose={closeSettings}
      width={520}
      onEscape={handleSettingsEscape}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {ui.text("Save", "儲存")}
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={closeSettings}>
            {ui.cancel}
          </button>
        </>
      }
    >
      <div className="settings-tabs" role="tablist" aria-label={ui.text("Settings sections", "設定分頁")}>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            id={`settings-tab-${tab}`}
            className="settings-tab"
            role="tab"
            aria-selected={activeSettingsTab === tab}
            aria-controls={`settings-panel-${tab}`}
            tabIndex={activeSettingsTab === tab ? 0 : -1}
            onClick={() => selectSettingsTab(tab)}
            onKeyDown={(event) => handleSettingsTabKeyDown(event, tab)}
          >
            {settingsTabLabels[tab]}
          </button>
        ))}
      </div>

      {activeSettingsTab === "language" && <div className="settings-tab-panel" id="settings-panel-language" role="tabpanel" aria-labelledby="settings-tab-language">
        {renderSettingsSearch()}
        <section className="settings-section" aria-labelledby="settings-language-heading">
        <div className="settings-section-heading" id="settings-language-heading">{copy.language}</div>
        <p className="setting-helper">{copy.languageHelper}</p>
        <div className="field">
          <span className="field-label" id="settings-language-mode-label">{copy.language}</span>
          <select
            id="settings-language-mode"
            className="input select"
            aria-labelledby="settings-language-mode-label"
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
        </div>

        <div className="settings-level-grid">
          <div className="field">
            <span className="field-label" id="settings-funny-english-label">{copy.funnyEnglish}</span>
            <input
              id="settings-funny-english"
              className="range-input"
              type="range"
              aria-labelledby="settings-funny-english-label"
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
          </div>
          <div className="field">
            <span className="field-label" id="settings-funny-cantonese-label">{copy.funnyCantonese}</span>
            <input
              id="settings-funny-cantonese"
              className="range-input"
              type="range"
              aria-labelledby="settings-funny-cantonese-label"
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
          </div>
        </div>
        <p className="setting-disclosure" role="note">{copy.funnyDisclosure}</p>
        <p className="setting-preview" role="status">{ui.funnyPreview}</p>
        </section>
      </div>}

      {activeSettingsTab === "appearance" && <div className="settings-tab-panel" id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
        {renderSettingsSearch()}
        <section className="settings-section" aria-labelledby="settings-appearance-heading">
        <div className="settings-section-heading" id="settings-appearance-heading">{copy.appearance}</div>

        <div className="field" id="settings-display-name" tabIndex={-1}>
          <label className="field-label" htmlFor="settings-display-name-input">{ui.displayName}</label>
          <div className="field-row">
            <input
              className="input"
              id="settings-display-name-input"
              type="text"
              maxLength={64}
              value={displayName}
              aria-invalid={displayNameError !== null}
              aria-describedby="settings-display-name-helper"
              onChange={(event) => {
                setDisplayName(event.target.value);
                setDisplayNameError(null);
              }}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDisplayName(DEFAULT_DISPLAY_NAME)}>
              {ui.resetDisplayName}
            </button>
          </div>
          <span className="setting-helper" id="settings-display-name-helper">{ui.displayNameHelper}</span>
          {displayNameError && <span className="field-error" role="alert">{displayNameError}</span>}
        </div>

        <div className="field">
          <span className="field-label" id="settings-theme-label">Theme</span>
          <select
            id="settings-theme"
            className="input select"
            aria-labelledby="settings-theme-label"
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
        </div>

        <div className="field">
          <span className="field-label" id="settings-density-label">{copy.density}</span>
          <select
            id="settings-density"
            className="input select"
            aria-labelledby="settings-density-label"
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
        </div>

        <div className="field">
          <span className="field-label" id="settings-accent-label">{copy.accent}</span>
          <div className="field-row">
            <input
              className="color-input"
              type="color"
              aria-labelledby="settings-accent-label"
              aria-label="Accent color picker"
              value={form.accentSeedColor.slice(0, 7)}
              onChange={(e) => updateAccent(e.target.value)}
            />
            <input
              className="input"
              aria-label="Accent color value"
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
        </div>

        <div className="field">
          <span className="field-label" id="settings-font-family-label">{copy.fontFamily}</span>
          <select
            id="settings-font-family"
            className="input select"
            aria-labelledby="settings-font-family-label"
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
        </div>

        <div className="field-pair">
          <div className="field">
            <span className="field-label" id="settings-font-size-label">{copy.fontSize}</span>
            <input
              id="settings-font-size"
              className="input"
              type="number"
              aria-labelledby="settings-font-size-label"
              min={10}
              max={32}
              value={form.uiFontSize}
              onChange={(e) => update("uiFontSize", Math.min(32, Math.max(10, Number(e.target.value) || 10)))}
            />
            <span className="setting-source">{source("uiFontSize", "13px")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("uiFontSize")}>
              {copy.reset}
            </button>
          </div>
          <div className="field">
            <span className="field-label" id="settings-font-weight-label">{copy.fontWeight}</span>
            <select
              id="settings-font-weight"
              className="input select"
              aria-labelledby="settings-font-weight-label"
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
          </div>
        </div>

        <button type="button" className="btn btn-ghost" onClick={resetAllSettings} title={copy.resetAllConfirmation}>
          {copy.resetAll} (save folder kept · 保留儲存資料夾)
        </button>
        </section>
      </div>}

      {activeSettingsTab === "downloads" && <div className="settings-tab-panel" id="settings-panel-downloads" role="tabpanel" aria-labelledby="settings-tab-downloads">
        {renderSettingsSearch()}
        <section className="settings-section" aria-labelledby="settings-downloads-heading">
          <div className="settings-section-heading" id="settings-downloads-heading">{ui.downloads}</div>
      <div className="field" id="settings-default-save-folder" tabIndex={-1}>
        <span className="field-label" id="settings-default-save-folder-label">Default save folder</span>
          <div className="field-row">
          <input
            className="input"
            id="settings-default-save-folder-input"
            type="text"
            aria-labelledby="settings-default-save-folder-label"
            value={form.defaultSaveFolder}
            onChange={(e) => update("defaultSaveFolder", e.target.value)}
          />
          <button type="button" className="icon-btn" title="Choose folder" aria-label="Choose default save folder" onClick={() => void handlePickFolder()}>
            <FolderIcon size={15} />
          </button>
        </div>
        <span className="setting-source">{source("defaultSaveFolder", "the platform Downloads folder")}</span>
      </div>

      <div className="field-pair" id="settings-performance" tabIndex={-1}>
        <div className="field">
          <span className="field-label" id="settings-max-connections-label">Max connections per download</span>
          <input
            className="input"
            id="settings-max-connections-per-download"
            type="number"
            aria-labelledby="settings-max-connections-label"
            min={1}
            max={32}
            value={form.maxConnectionsPerDownload}
            onChange={(e) => update("maxConnectionsPerDownload", Number(e.target.value) || 1)}
          />
          <span className="setting-source">{source("maxConnectionsPerDownload", "8")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("maxConnectionsPerDownload")}>
            {copy.reset}
          </button>
        </div>
        <div className="field">
          <span className="field-label" id="settings-max-active-label">Max active downloads</span>
          <input
            className="input"
            id="settings-max-active-downloads"
            type="number"
            aria-labelledby="settings-max-active-label"
            min={1}
            max={32}
            value={form.maxActiveDownloads}
            onChange={(e) => update("maxActiveDownloads", Number(e.target.value) || 1)}
          />
          <span className="setting-source">{source("maxActiveDownloads", "3")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("maxActiveDownloads")}>
            {copy.reset}
          </button>
        </div>
      </div>

      <div className="field" id="settings-speed" tabIndex={-1}>
        <span className="field-label" id="settings-global-speed-label">Global speed limit</span>
        <div className="field-row">
          <input
            className="input"
            id="settings-global-speed-limit"
            type="number"
            aria-labelledby="settings-global-speed-label"
            min={0.1}
            step={0.1}
            disabled={unlimitedSpeed}
            value={speedMBs}
            onChange={(e) => setSpeedMBs(Number(e.target.value) || 0)}
          />
          <span className="field-suffix">MB/s</span>
          <div className="checkbox-row">
            <button
              type="button"
              id="settings-unlimited-speed"
              className={`checkbox${unlimitedSpeed ? " checked" : ""}`}
              role="checkbox"
              aria-checked={unlimitedSpeed}
              onClick={() => setUnlimitedSpeed((v) => !v)}
              aria-label="Unlimited speed"
            />
            <span>Unlimited</span>
          </div>
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
      </div>

      <div className="checkbox-row field" id="settings-startup" tabIndex={-1}>
        <button
          type="button"
          id="settings-startup-toggle"
          className={`checkbox${form.startOnSystemStartup ? " checked" : ""}`}
          role="checkbox"
          aria-checked={form.startOnSystemStartup}
          onClick={() => update("startOnSystemStartup", !form.startOnSystemStartup)}
          aria-label="Start on system startup"
        />
        <span>Start on system startup</span>
        <span className="setting-source">{source("startOnSystemStartup", "false")}</span>
        <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("startOnSystemStartup")}>
          {copy.reset}
        </button>
      </div>

      <div className="checkbox-row field" id="settings-completion" tabIndex={-1}>
        <button
          type="button"
          id="settings-completion-toggle"
          className={`checkbox${form.showCompleteDialog ? " checked" : ""}`}
          role="checkbox"
          aria-checked={form.showCompleteDialog}
          onClick={() => update("showCompleteDialog", !form.showCompleteDialog)}
          aria-label="Show completion notification"
        />
        <span>Show a non-blocking notification when a download completes</span>
        <span className="setting-source">{source("showCompleteDialog", "true")}</span>
        <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("showCompleteDialog")}>
          {copy.reset}
        </button>
      </div>
        </section>
      </div>}

      {activeSettingsTab === "advanced" && <div className="settings-tab-panel" id="settings-panel-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced">
        {renderSettingsSearch()}
        <section className="settings-section" aria-labelledby="settings-advanced-heading">
      <details className="advanced-details" id="settings-advanced" tabIndex={-1}>
        <summary>Advanced</summary>
        <div className="field">
          <span className="field-label" id="settings-min-splittable-label">Minimum splittable part size (KB)</span>
          <input
            className="input"
            id="settings-min-splittable-part-size"
            type="number"
            aria-labelledby="settings-min-splittable-label"
            min={1}
            value={Math.round(form.minConnectionPartSize / 1024)}
            onChange={(e) => update("minConnectionPartSize", Math.max(1, Number(e.target.value) || 1) * 1024)}
          />
          <span className="setting-source">{source("minConnectionPartSize", "2048 KB")}</span>
          <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("minConnectionPartSize")}>
            {copy.reset}
          </button>
        </div>
      </details>
        </section>
      </div>}
    </Dialog>
  );
}
