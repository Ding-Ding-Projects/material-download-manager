import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AppSettings, AutoOrganizeRule, AutoOrganizeTargetCategory, PresentationPatch, PresentationSettingKey, SettingKey, SettingsPatch } from "@shared/types";
import type { SshHostDraft } from "@shared/ssh";
import {
  AUTO_ORGANIZE_FOLDERS,
  AUTO_ORGANIZE_RULE_LIMIT,
  AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH,
  AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH,
  SETTING_KEYS,
  PRESENTATION_SETTING_KEYS,
} from "@shared/types";
import { createDefaultSettings, isHexColor, isValidDefaultSaveFolder, normalizeSchoolModeName } from "@shared/settings";
import {
  createDefaultRegexBuilderState,
  normalizeRegexFlags,
  validateRegexPattern,
  type RegexBuilderState,
} from "@shared/regex";
import { localizedRegexEvaluationError, useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { getSettingsCopy } from "../i18n/settings";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import {
  DEFAULT_DISPLAY_NAME,
  clearLegacyDisplayName,
  normalizeDisplayName,
} from "../store/displayPreferences";
import { settingSourceLabel } from "../store/settingsAppearance";
import Dialog from "./Dialog";
import DestructiveActionGate from "./DestructiveActionGate";
import { FolderIcon, SettingsIcon } from "./icons";
import RegexBuilder from "./RegexBuilder";
import { notify } from "./NotificationCenter";
import AuthenticatorPanel from "./AuthenticatorPanel";

type SettingsTab = "language" | "appearance" | "downloads" | "authenticator" | "advanced";

const SETTINGS_TABS: readonly SettingsTab[] = ["language", "appearance", "downloads", "authenticator", "advanced"];
const SETTINGS_TAB_STORAGE_KEY = "material-download-manager.settings.active-tab";

const AUTO_ORGANIZE_TARGETS: readonly AutoOrganizeTargetCategory[] = [
  "other",
  "document",
  "video",
  "music",
  "apps",
  "compressed",
];

const AUTO_ORGANIZE_TARGET_LABELS: Record<AutoOrganizeTargetCategory, readonly [string, string]> = {
  other: ["General", "一般"],
  document: ["Documents", "文件"],
  video: ["Videos", "影片"],
  music: ["Music", "音樂"],
  apps: ["Programs", "程式"],
  compressed: ["Compressed", "壓縮檔"],
};

const DEFAULT_RULE_SAMPLE = "invoice-2026.pdf\nhttps://example.test/releases/archive.zip";

type AutoOrganizeRuleErrorField = "rule" | "name" | "pattern" | "category";

interface AutoOrganizeRuleError {
  field: AutoOrganizeRuleErrorField;
  message: string;
}

type ExtensionStatus =
  | { kind: "installed-opened"; path: string }
  | { kind: "installed"; path: string }
  | { kind: "revealed" }
  | null;

type ExtensionError =
  | { kind: "automatic-open"; detail: string }
  | { kind: "install"; detail: string }
  | { kind: "reveal"; detail: string }
  | null;

type SchoolModeCredentialAction = "setup" | "change" | "reset" | "disable" | null;

function displayAutoOrganizePath(base: string, leaf: string): string {
  if (!isValidDefaultSaveFolder(base)) return "";
  const trimmed = base.trim().replace(/[\\/]+$/u, "");
  if (!trimmed) return "";
  const separator = base.includes("\\") ? "\\" : "/";
  return `${trimmed}${separator}${leaf}`;
}

function createRuleId(): string {
  return window.crypto.randomUUID();
}

function settingValuesEqual(
  key: SettingKey,
  left: AppSettings[SettingKey],
  right: AppSettings[SettingKey]
): boolean {
  if (key !== "autoOrganizeRules") return Object.is(left, right);
  const leftRules = left as AutoOrganizeRule[];
  const rightRules = right as AutoOrganizeRule[];
  return leftRules.length === rightRules.length && leftRules.every((rule, index) => {
    const candidate = rightRules[index];
    return Boolean(candidate)
      && rule.id === candidate.id
      && rule.name === candidate.name
      && rule.pattern === candidate.pattern
      && rule.flags === candidate.flags
      && rule.category === candidate.category;
  });
}

const SETTINGS_SEARCH_INDEX = [
  {
    id: "settings-school-mode",
    targetId: "settings-school-mode-toggle",
    tab: "language" as const,
    labels: ["School mode English-only serious reset credential local application data", "學校模式 純英文 嚴肅 重設 credential 本機應用程式資料"],
  },
  {
    id: "settings-show-emojis",
    targetId: "settings-show-emojis-toggle",
    tab: "language" as const,
    labels: ["Show emojis dialogs message boxes decorative accessibility", "顯示 emoji 對話框 訊息框 裝飾 讀屏"],
  },
  {
    id: "settings-language-heading",
    targetId: "settings-language-mode",
    tab: "language" as const,
    labels: ["Language mode English Cantonese bilingual funny level", "語言模式 英文 廣東話 雙語 搞笑程度"],
  },
  {
    id: "settings-appearance-heading",
    targetId: "settings-theme",
    tab: "appearance" as const,
    labels: ["Appearance theme density accent seed color font family font size weight", "外觀 主題 密度 主色 種子色 字型 大小 粗幼"],
  },
  {
    id: "settings-display-name",
    targetId: "settings-display-name-input",
    tab: "appearance" as const,
    labels: ["App display name title bar notifications identity data folder installer update feed", "應用程式顯示名稱 標題列 通知 身分 資料夾 安裝程式 更新來源"],
  },
  {
    id: "settings-default-save-folder",
    targetId: "settings-default-save-folder-input",
    tab: "downloads" as const,
    labels: ["Default save folder browse folder", "預設儲存資料夾 瀏覽資料夾"],
  },
  {
    id: "settings-performance",
    targetId: "settings-max-connections-per-download",
    tab: "downloads" as const,
    labels: ["Max connections per download max active downloads", "每個下載最多連線 同時下載上限"],
  },
  {
    id: "settings-ssh-workers",
    targetId: "settings-ssh-workers",
    tab: "downloads" as const,
    labels: ["SSH workers Docker hosts distributed downloads worker count host key trust", "SSH 工作器 Docker 主機 分流下載 工作器數量 主機金鑰 信任"],
  },
  {
    id: "settings-speed",
    targetId: "settings-global-speed-limit",
    tab: "downloads" as const,
    labels: ["Global speed limit unlimited", "全域速度上限 無限速"],
  },
  {
    id: "settings-startup",
    targetId: "settings-startup-toggle",
    tab: "downloads" as const,
    labels: ["Start on system startup", "系統啟動時開啟"],
  },
  {
    id: "settings-completion",
    targetId: "settings-completion-toggle",
    tab: "downloads" as const,
    labels: ["Show completion notification when a download completes", "下載完成時顯示通知"],
  },
  {
    id: "settings-auto-organize",
    targetId: "settings-auto-organize-toggle",
    tab: "downloads" as const,
    labels: ["Auto-organize category folders General Documents Videos Music Programs Compressed", "自動分類 資料夾 一般 文件 影片 音樂 程式 壓縮檔"],
  },
  {
    id: "settings-auto-organize-rules",
    targetId: "settings-auto-organize-rules",
    tab: "downloads" as const,
    labels: ["Custom regex classification rules first match filename URL flags reorder", "自訂 regex 分類規則 第一條相符 檔名 網址 旗標 排序"],
  },
  {
    id: "settings-browser-extension",
    targetId: "settings-install-extension",
    tab: "downloads" as const,
    labels: ["Install browser extension Chrome Chromium load unpacked automatic downloads open reveal extension folder handoff", "安裝 瀏覽器 擴充功能 Chrome Chromium load unpacked 自動 下載 打開 顯示 擴充功能 資料夾 交接"],
  },
  {
    id: "settings-advanced",
    targetId: "settings-min-splittable-part-size",
    tab: "advanced" as const,
    labels: ["Advanced minimum splittable part size", "進階 最小可分割區塊大小"],
  },
  {
    id: "settings-authenticator",
    targetId: "settings-authenticator-panel",
    tab: "authenticator" as const,
    labels: ["Authenticator TOTP QR pairing secret-free metadata export", "Authenticator TOTP QR 配對 secret-free 資料標籤匯出"],
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
    sample: SETTINGS_SEARCH_INDEX.filter((entry) => entry.tab === tab).flatMap((entry) => entry.labels).join("\n"),
  };
}

function createSettingsSearchStates(): Record<SettingsTab, RegexBuilderState> {
  return {
    language: createSettingsSearchState("language"),
    appearance: createSettingsSearchState("appearance"),
    downloads: createSettingsSearchState("downloads"),
    authenticator: createSettingsSearchState("authenticator"),
    advanced: createSettingsSearchState("advanced"),
  };
}

export default function SettingsDialog() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setSettings = useAppStore((s) => s.setSettings);
  const setPresentationSettings = useAppStore((s) => s.setPresentationSettings);
  const pickFolder = useAppStore((s) => s.pickFolder);
  const currentSettings = useAppStore((s) => s.settings);
  const settingsFocus = useAppStore((s) => s.settingsFocus);

  const [form, setForm] = useState<AppSettings>(
    () => currentSettings ?? createDefaultSettings("")
  );
  const [resetSettingKeys, setResetSettingKeys] = useState<Set<SettingKey>>(() => new Set());
  const [unlimitedSpeed, setUnlimitedSpeed] = useState(form.globalSpeedLimitBytes === 0);
  const [speedMBs, setSpeedMBs] = useState(
    form.globalSpeedLimitBytes > 0 ? form.globalSpeedLimitBytes / (1024 * 1024) : 5
  );
  const [saving, setSaving] = useState(false);
  const [accentError, setAccentError] = useState<string | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(() => {
    if (settingsFocus === "language" || settingsFocus === "school-mode" || settingsFocus === "show-emojis") return "language";
    if (settingsFocus === "appearance" || settingsFocus === "downloads" || settingsFocus === "authenticator" || settingsFocus === "advanced") return settingsFocus;
    if (settingsFocus === "auto-organize" || settingsFocus === "auto-organize-rules") return "downloads";
    return readSettingsTab();
  });
  const appliedSettingsFocus = useRef<typeof settingsFocus>(null);
  const [settingsSearches, setSettingsSearches] = useState<Record<SettingsTab, RegexBuilderState>>(createSettingsSearchStates);
  const [customSettingsSearchSamples, setCustomSettingsSearchSamples] = useState<Set<SettingsTab>>(() => new Set());
  const settingsSearch = settingsSearches[activeSettingsTab];
  const [settingsRegexOpen, setSettingsRegexOpen] = useState(false);
  const settingsRegexButtonRef = useRef<HTMLButtonElement>(null);
  const [displayName, setDisplayName] = useState(currentSettings?.displayName ?? DEFAULT_DISPLAY_NAME);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [activeAutoOrganizeRuleId, setActiveAutoOrganizeRuleId] = useState<string | null>(null);
  const [autoOrganizeRuleSamples, setAutoOrganizeRuleSamples] = useState<Map<string, string>>(() => new Map());
  const [autoOrganizeRuleStatus, setAutoOrganizeRuleStatus] = useState("");
  const [extensionOperation, setExtensionOperation] = useState<"install" | "reveal" | null>(null);
  const extensionOperationRef = useRef<"install" | "reveal" | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>(null);
  const [extensionError, setExtensionError] = useState<ExtensionError>(null);
  const [extensionPath, setExtensionPath] = useState<string | null>(null);
  const [schoolModeCredentialAction, setSchoolModeCredentialAction] = useState<SchoolModeCredentialAction>(null);
  const [schoolModeCurrentCredential, setSchoolModeCurrentCredential] = useState("");
  const [schoolModeNextCredential, setSchoolModeNextCredential] = useState("");
  const [schoolModeCredentialConfirmation, setSchoolModeCredentialConfirmation] = useState("");
  const [schoolModeCredentialBusy, setSchoolModeCredentialBusy] = useState(false);
  const [schoolModeCredentialError, setSchoolModeCredentialError] = useState<string | null>(null);
  const autoOrganizeRuleButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const autoOrganizeRuleMoveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const autoOrganizeRuleNameRefs = useRef(new Map<string, HTMLInputElement>());
  const addAutoOrganizeRuleButtonRef = useRef<HTMLButtonElement>(null);
  const [sshDraft, setSshDraft] = useState<SshHostDraft>(() => ({
    id: window.crypto.randomUUID(),
    name: "",
    host: "",
    sshPort: 22,
    username: "docker",
    hostKeySha256: "",
    bootstrapAuthMode: "system-agent",
    workerPort: 2222,
    enabled: true,
  }));
  const [sshBusyId, setSshBusyId] = useState<string | null>(null);
  const [sshNotice, setSshNotice] = useState<string | null>(null);
  const [pendingSshRemovalId, setPendingSshRemovalId] = useState<string | null>(null);

  const ui = useMemo(() => getUiCopy(form), [form]);
  const copy = useMemo(() => getSettingsCopy(ui.languageMode), [ui.languageMode]);
  const extensionStatusText = extensionStatus?.kind === "installed-opened"
    ? ui.text(
        `Installed and opened the extension folder automatically. In Chrome open chrome://extensions, turn on Developer mode, click Load unpacked, and choose: ${extensionStatus.path}`,
        `安裝好兼自動打開咗擴充功能資料夾。喺 Chrome 開 chrome://extensions，開啟開發者模式，㩒 Load unpacked，再揀：${extensionStatus.path}`
      )
    : extensionStatus?.kind === "installed"
      ? ui.text(`Installed successfully at: ${extensionStatus.path}`, `安裝成功，位置係：${extensionStatus.path}`)
      : extensionStatus?.kind === "revealed"
        ? ui.text("Opened the installed extension folder.", "已打開安裝好嘅擴充功能資料夾。")
        : "";
  const extensionErrorText = extensionError?.kind === "automatic-open"
    ? ui.text(
        `The folder could not be opened automatically: ${extensionError.detail}. Use Open extension folder to try again.`,
        `資料夾未能自動打開：${extensionError.detail}。可以㩒「開啟擴充功能資料夾」再試。`
      )
    : extensionError?.kind === "install"
      ? ui.text(`The extension could not be installed: ${extensionError.detail}`, `未能安裝擴充功能：${extensionError.detail}`)
      : extensionError?.kind === "reveal"
        ? ui.text(`The extension folder could not be opened: ${extensionError.detail}`, `未能打開擴充功能資料夾：${extensionError.detail}`)
        : "";
  const compiledDefaults = useMemo(
    () => createDefaultSettings(form.defaultSaveFolder),
    [form.defaultSaveFolder]
  );
  const autoOrganizeRuleErrors = useMemo(() => {
    const idCounts = new Map<string, number>();
    for (const rule of form.autoOrganizeRules) idCounts.set(rule.id, (idCounts.get(rule.id) ?? 0) + 1);
    return form.autoOrganizeRules.map((rule) => {
      if ((idCounts.get(rule.id) ?? 0) > 1) {
        return { field: "rule", message: ui.text("This rule has a duplicate identifier. Remove and recreate it.", "呢條規則嘅識別碼重複，請移除再重新建立。") } satisfies AutoOrganizeRuleError;
      }
      if (!rule.name.trim()) return { field: "name", message: ui.text("Enter a rule name.", "請輸入規則名稱。") } satisfies AutoOrganizeRuleError;
      if (rule.name.length > AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH) {
        return { field: "name", message: ui.text(`Rule names are limited to ${AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH} characters.`, `規則名稱最多 ${AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH} 個字元。`) } satisfies AutoOrganizeRuleError;
      }
      if (!rule.pattern) return { field: "pattern", message: ui.text("Enter a regular expression pattern.", "請輸入正規表示式模式。") } satisfies AutoOrganizeRuleError;
      if (rule.pattern.length > AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH) {
        return { field: "pattern", message: ui.text(`Patterns are limited to ${AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH} characters.`, `模式最多 ${AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH} 個字元。`) } satisfies AutoOrganizeRuleError;
      }
      if (normalizeRegexFlags(rule.flags) !== rule.flags) {
        return { field: "pattern", message: ui.text("Choose each supported flag at most once.", "每個支援旗標只可以揀一次。") } satisfies AutoOrganizeRuleError;
      }
      const patternError = validateRegexPattern(rule.pattern, rule.flags);
      if (patternError) return { field: "pattern", message: ui.text(`Invalid regex: ${patternError}`, `Regex 無效：${patternError}`) } satisfies AutoOrganizeRuleError;
      if (!AUTO_ORGANIZE_TARGETS.includes(rule.category)) {
        return { field: "category", message: ui.text("Choose one of the six destination categories.", "請揀六個目的分類其中一個。") } satisfies AutoOrganizeRuleError;
      }
      return null;
    });
  }, [form.autoOrganizeRules, ui]);
  const invalidAutoOrganizeRuleCount = autoOrganizeRuleErrors.filter(Boolean).length;
  const defaultSaveFolderError = isValidDefaultSaveFolder(form.defaultSaveFolder)
    ? null
    : ui.text("Choose an absolute Windows folder before saving.", "儲存之前請揀一個完整 Windows 資料夾路徑。");

  const settingsSearchEntries = useMemo(() => {
    const baseEntries = SETTINGS_SEARCH_INDEX.map((entry) => {
    const dynamicValues: string[] = [];
    if (entry.id === "settings-display-name") dynamicValues.push(form.displayName);
    if (entry.id === "settings-default-save-folder") dynamicValues.push(form.defaultSaveFolder);
    if (entry.id === "settings-auto-organize") {
      dynamicValues.push(form.autoOrganizeEnabled ? "enabled on 開啟" : "disabled off 關閉");
    }
    return { ...entry, searchable: [...entry.labels, ...dynamicValues].join(" ") };
    });
    const ruleEntries = form.autoOrganizeRules.flatMap((rule, index) => {
      const ruleDomId = `settings-auto-rule-${index + 1}`;
      const ruleNumber = index + 1;
      return [
        {
          id: `${ruleDomId}-name-search`,
          targetId: `${ruleDomId}-name`,
          tab: "downloads" as const,
          labels: [`Rule ${ruleNumber} name`, `規則 ${ruleNumber} 名稱`] as const,
          searchable: `rule 規則 ${ruleNumber} name 名稱 ${rule.name}`,
        },
        {
          id: `${ruleDomId}-pattern-search`,
          targetId: `${ruleDomId}-pattern`,
          tab: "downloads" as const,
          labels: [`Rule ${ruleNumber} regex pattern and flags`, `規則 ${ruleNumber} regex 模式同旗標`] as const,
          searchable: `rule 規則 ${ruleNumber} regex pattern 模式 flags 旗標 ${rule.pattern} ${rule.flags}`,
        },
        {
          id: `${ruleDomId}-category-search`,
          targetId: `${ruleDomId}-category`,
          tab: "downloads" as const,
          labels: [`Rule ${ruleNumber} destination category`, `規則 ${ruleNumber} 目的分類`] as const,
          searchable: `rule 規則 ${ruleNumber} destination category 目的分類 ${rule.category} ${AUTO_ORGANIZE_TARGET_LABELS[rule.category].join(" ")}`,
        },
      ];
    });
    const pathEntries = AUTO_ORGANIZE_TARGETS.map((category) => ({
      id: `settings-auto-organize-path-${category}-search`,
      targetId: `settings-auto-organize-path-${category}`,
      tab: "downloads" as const,
      labels: [
        `${AUTO_ORGANIZE_TARGET_LABELS[category][0]} destination path`,
        `${AUTO_ORGANIZE_TARGET_LABELS[category][1]}目的路徑`,
      ] as const,
      searchable: `${AUTO_ORGANIZE_TARGET_LABELS[category].join(" ")} destination path 目的路徑 ${displayAutoOrganizePath(form.defaultSaveFolder, AUTO_ORGANIZE_FOLDERS[category])}`,
    }));
    const visibleBaseEntries = form.schoolModeEnabled
      ? baseEntries.filter((entry) => entry.id !== "settings-language-heading" && entry.id !== "settings-show-emojis")
      : baseEntries;
    return [...visibleBaseEntries, ...pathEntries, ...ruleEntries];
  }, [form.autoOrganizeEnabled, form.autoOrganizeRules, form.defaultSaveFolder, form.displayName, form.schoolModeEnabled]);

  const activeSettingsSearchEntries = useMemo(
    () => settingsSearchEntries.filter((entry) => entry.tab === activeSettingsTab),
    [activeSettingsTab, settingsSearchEntries]
  );
  const settingsRegexSamples = useMemo(
    () => activeSettingsSearchEntries.map((entry) => entry.searchable),
    [activeSettingsSearchEntries]
  );
  const defaultSettingsSearchSample = useMemo(
    () => activeSettingsSearchEntries.map((entry) => entry.searchable).join("\n"),
    [activeSettingsSearchEntries]
  );
  const settingsRegexBatch = useIsolatedRegexBatch(
    settingsSearch.pattern,
    settingsSearch.flags,
    settingsRegexSamples,
    settingsSearch.mode === "regex" && settingsSearch.pattern.length > 0,
  );
  const settingsSearchSyntaxError = settingsSearch.mode === "regex" && settingsSearch.pattern.length > 0
    ? validateRegexPattern(settingsSearch.pattern, settingsSearch.flags)
    : null;
  const settingsSearchError = settingsSearchSyntaxError ?? (settingsRegexBatch.pending ? null : settingsRegexBatch.error);
  const settingsSearchErrorText = settingsSearchError
    ? localizedRegexEvaluationError(settingsSearchError, ui.text)
    : null;
  const matchingSettings = useMemo(() => {
    const query = settingsSearch.pattern;
    if (query.length === 0) return [];
    if (settingsSearch.mode === "regex") {
      if (settingsSearchError || !settingsRegexBatch.evaluations) return [];
      return activeSettingsSearchEntries.filter(
        (_, index) => (settingsRegexBatch.evaluations?.[index]?.matches.length ?? 0) > 0
      );
    }
    const normalizedQuery = query.toLocaleLowerCase();
    return activeSettingsSearchEntries
      .filter((entry) => entry.searchable.toLocaleLowerCase().includes(normalizedQuery));
  }, [activeSettingsSearchEntries, settingsRegexBatch.evaluations, settingsSearch.mode, settingsSearch.pattern, settingsSearchError]);

  useEffect(() => {
    if (customSettingsSearchSamples.has(activeSettingsTab)) return;
    setSettingsSearches((current) => {
      if (current[activeSettingsTab].sample === defaultSettingsSearchSample) return current;
      return {
        ...current,
        [activeSettingsTab]: { ...current[activeSettingsTab], sample: defaultSettingsSearchSample },
      };
    });
  }, [activeSettingsTab, customSettingsSearchSamples, defaultSettingsSearchSample]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, activeSettingsTab);
    } catch {
      // A locked-down profile can still use the tabbed surface for this session.
    }
  }, [activeSettingsTab]);

  useEffect(() => {
    if (!currentSettings) return;
    setForm((current) => ({
      ...current,
      schoolModeEnabled: currentSettings.schoolModeEnabled,
      schoolModeCredential: currentSettings.schoolModeCredential,
    }));
  }, [currentSettings?.schoolModeCredential.state, currentSettings?.schoolModeEnabled]);

  function updateSettingsSearch(value: RegexBuilderState) {
    setSettingsSearches((current) => ({ ...current, [activeSettingsTab]: value }));
  }

  function selectSettingsTab(tab: SettingsTab) {
    setActiveSettingsTab(tab);
    setSettingsRegexOpen(false);
    setActiveAutoOrganizeRuleId(null);
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
    const targetTab: SettingsTab = settingsFocus === "auto-organize" || settingsFocus === "auto-organize-rules"
      ? "downloads"
      : settingsFocus === "school-mode" || settingsFocus === "show-emojis"
        ? "language"
        : settingsFocus;
    setActiveSettingsTab(targetTab);
    const targetId = settingsFocus === "school-mode"
      ? "settings-school-mode-toggle"
      : settingsFocus === "show-emojis"
        ? "settings-show-emojis-toggle"
        : settingsFocus === "language"
      ? "settings-language-mode"
      : settingsFocus === "appearance"
        ? "settings-theme"
        : settingsFocus === "auto-organize"
          ? "settings-auto-organize-toggle"
          : settingsFocus === "auto-organize-rules"
            ? "settings-auto-organize-rules"
          : settingsFocus === "authenticator"
            ? "settings-authenticator-panel"
            : settingsFocus === "advanced"
              ? "settings-min-splittable-part-size"
              : "settings-default-save-folder-input";
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
    if ((SETTING_KEYS as readonly string[]).includes(key)) {
      const settingKey = key as SettingKey;
      setResetSettingKeys((current) => {
        if (!current.has(settingKey)) return current;
        const next = new Set(current);
        next.delete(settingKey);
        return next;
      });
      setForm((current) => ({
        ...current,
        [key]: value,
        settingProvenance: {
          ...current.settingProvenance,
          [settingKey]: currentSettings?.settingProvenance[settingKey] ?? current.settingProvenance[settingKey],
        },
      }));
      return;
    }
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetSetting<K extends SettingKey>(key: K) {
    setResetSettingKeys((current) => new Set(current).add(key));
    setForm((current) => ({
      ...current,
      [key]: compiledDefaults[key] as AppSettings[K],
      settingProvenance: { ...current.settingProvenance, [key]: "compiled-in" },
    }));
  }

  function updateAutoOrganizeRule(index: number, patch: Partial<AutoOrganizeRule>) {
    update(
      "autoOrganizeRules",
      form.autoOrganizeRules.map((rule, candidateIndex) =>
        candidateIndex === index
          ? { ...rule, ...patch, ...(patch.flags !== undefined ? { flags: normalizeRegexFlags(patch.flags) } : {}) }
          : rule
      )
    );
  }

  function addAutoOrganizeRule(preset: "blank" | "documents" | "archives") {
    if (form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT) return;
    const rule: AutoOrganizeRule = preset === "documents"
      ? {
          id: createRuleId(),
          name: ui.text("Document filenames", "文件檔名"),
          pattern: "\\.(?:pdf|docx?|xlsx?|pptx?)$",
          flags: "i",
          category: "document",
        }
      : preset === "archives"
        ? {
            id: createRuleId(),
            name: ui.text("Archive URLs", "壓縮檔網址"),
            pattern: "\\.(?:zip|7z|rar)(?:[?#]|$)",
            flags: "i",
            category: "compressed",
          }
        : {
            id: createRuleId(),
            name: ui.text("New rule", "新規則"),
            pattern: "",
            flags: "i",
            category: "other",
          };
    update("autoOrganizeRules", [...form.autoOrganizeRules, rule]);
    setAutoOrganizeRuleSamples((current) => {
      const next = new Map(current);
      next.set(rule.id, DEFAULT_RULE_SAMPLE);
      return next;
    });
    if (preset === "blank") setActiveAutoOrganizeRuleId(rule.id);
    window.requestAnimationFrame(() => autoOrganizeRuleNameRefs.current.get(rule.id)?.focus());
  }

  function removeAutoOrganizeRule(index: number) {
    const removed = form.autoOrganizeRules[index];
    const focusRuleId = form.autoOrganizeRules[index + 1]?.id ?? form.autoOrganizeRules[index - 1]?.id ?? null;
    update("autoOrganizeRules", form.autoOrganizeRules.filter((_, candidateIndex) => candidateIndex !== index));
    if (!removed) return;
    if (activeAutoOrganizeRuleId === removed.id) setActiveAutoOrganizeRuleId(null);
    setAutoOrganizeRuleSamples((current) => {
      const next = new Map(current);
      next.delete(removed.id);
      return next;
    });
    setAutoOrganizeRuleStatus(ui.text(
      `Removed ${removed.name || `Rule ${index + 1}`}.`,
      `已移除 ${removed.name || `規則 ${index + 1}`}。`
    ));
    window.requestAnimationFrame(() => {
      if (focusRuleId) autoOrganizeRuleNameRefs.current.get(focusRuleId)?.focus({ preventScroll: true });
      else addAutoOrganizeRuleButtonRef.current?.focus({ preventScroll: true });
    });
  }

  function moveAutoOrganizeRule(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= form.autoOrganizeRules.length) return;
    const next = [...form.autoOrganizeRules];
    [next[index], next[target]] = [next[target], next[index]];
    update("autoOrganizeRules", next);
    const movedRuleId = next[target].id;
    setAutoOrganizeRuleStatus(ui.text(
      `Moved ${next[target].name || `Rule ${index + 1}`} to position ${target + 1} of ${next.length}.`,
      `已將 ${next[target].name || `規則 ${index + 1}`} 移到第 ${target + 1} 位，共 ${next.length} 條。`
    ));
    window.requestAnimationFrame(() => {
      const preferred = autoOrganizeRuleMoveButtonRefs.current.get(`${movedRuleId}:${offset}`);
      const fallback = autoOrganizeRuleMoveButtonRefs.current.get(`${movedRuleId}:${offset === -1 ? 1 : -1}`);
      (preferred && !preferred.disabled ? preferred : fallback)?.focus({ preventScroll: true });
    });
  }

  function closeAutoOrganizeRuleBuilder(restoreFocus = true) {
    const ruleId = activeAutoOrganizeRuleId;
    setActiveAutoOrganizeRuleId(null);
    if (!restoreFocus || !ruleId) return;
    window.requestAnimationFrame(() => autoOrganizeRuleButtonRefs.current.get(ruleId)?.focus({ preventScroll: true }));
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

  function clearSchoolModeCredentialForm() {
    setSchoolModeCurrentCredential("");
    setSchoolModeNextCredential("");
    setSchoolModeCredentialConfirmation("");
    setSchoolModeCredentialError(null);
    setSchoolModeCredentialAction(null);
  }

  function openSchoolModeCredentialAction(action: Exclude<SchoolModeCredentialAction, null>) {
    setSchoolModeCredentialAction(action);
    setSchoolModeCurrentCredential("");
    setSchoolModeNextCredential("");
    setSchoolModeCredentialConfirmation("");
    setSchoolModeCredentialError(null);
  }

  function handleSchoolModeToggle(enabled: boolean) {
    if (enabled) {
      update("schoolModeEnabled", true);
      return;
    }
    openSchoolModeCredentialAction("disable");
  }

  async function handleSchoolModeCredentialAction() {
    const action = schoolModeCredentialAction;
    if (!action || schoolModeCredentialBusy) return;
    setSchoolModeCredentialBusy(true);
    setSchoolModeCredentialError(null);
    try {
      const presentation = action === "setup"
        ? await window.api.setupSchoolModeCredential(schoolModeNextCredential, schoolModeCredentialConfirmation)
        : action === "change"
          ? await window.api.changeSchoolModeCredential(
              schoolModeCurrentCredential,
              schoolModeNextCredential,
              schoolModeCredentialConfirmation,
            )
          : action === "reset"
            ? await window.api.resetSchoolModeCredential(schoolModeCurrentCredential)
            : await window.api.disableSchoolMode(schoolModeCurrentCredential);
      setForm((current) => ({ ...current, ...presentation }));
      clearSchoolModeCredentialForm();
      notify({
        title: ui.text("School mode credential updated", "School mode credential 已更新"),
        message: action === "disable"
          ? ui.text("School mode is now off; your previous language and emoji choices are restored.", "School mode 已關閉，之前嘅語言同 emoji 選擇已恢復。")
          : ui.text("The credential metadata changed; the secret stayed in the operating-system vault.", "credential metadata 已更新，秘密仍然留喺作業系統憑證庫。"),
        tone: "success",
      });
    } catch (error) {
      setSchoolModeCredentialError(error instanceof Error ? error.message : ui.schoolModeUnavailable);
    } finally {
      setSchoolModeCredentialBusy(false);
    }
  }

  async function handleInstallExtension() {
    if (extensionOperationRef.current !== null) return;
    extensionOperationRef.current = "install";
    setExtensionOperation("install");
    setExtensionError(null);
    setExtensionStatus(null);
    try {
      const result = await window.api.installBrowserExtension();
      setExtensionPath(result.path);
      if (result.folderOpened) {
        setExtensionStatus({ kind: "installed-opened", path: result.path });
        setExtensionError(null);
      } else {
        setExtensionStatus({ kind: "installed", path: result.path });
        setExtensionError({ kind: "automatic-open", detail: result.folderOpenError ?? ui.text("Unknown file-manager error", "未知檔案管理員錯誤") });
      }
    } catch (error) {
      setExtensionError({ kind: "install", detail: error instanceof Error ? error.message : String(error) });
      setExtensionStatus(null);
    } finally {
      extensionOperationRef.current = null;
      setExtensionOperation(null);
    }
  }

  async function handleRevealExtension() {
    if (extensionOperationRef.current !== null) return;
    extensionOperationRef.current = "reveal";
    setExtensionOperation("reveal");
    setExtensionError(null);
    setExtensionStatus(null);
    try {
      await window.api.revealBrowserExtension();
      setExtensionStatus({ kind: "revealed" });
    } catch (error) {
      setExtensionError({ kind: "reveal", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      extensionOperationRef.current = null;
      setExtensionOperation(null);
    }
  }

  function editSshHost(host: AppSettings["sshHosts"][number]) {
    setSshDraft({
      id: host.id,
      name: host.name,
      host: host.host,
      sshPort: host.sshPort,
      username: host.username,
      hostKeySha256: host.hostKeySha256,
      bootstrapAuthMode: host.bootstrapAuthMode,
      workerPort: host.workerPort,
      enabled: host.enabled,
    });
    setSshNotice(null);
  }

  function newSshHost() {
    setSshDraft({
      id: window.crypto.randomUUID(),
      name: "",
      host: "",
      sshPort: 22,
      username: "docker",
      hostKeySha256: "",
      bootstrapAuthMode: "system-agent",
      workerPort: 2222,
      enabled: true,
    });
    setSshNotice(null);
  }

  async function saveSshHostDraft() {
    if (sshBusyId) return;
    setSshBusyId(sshDraft.id);
    setSshNotice(null);
    try {
      const next = await window.api.saveSshHost({ ...sshDraft, sshPort: Number(sshDraft.sshPort), workerPort: Number(sshDraft.workerPort) });
      setForm(next);
      setSshNotice(ui.text("Host saved after the main process verified its SSH key.", "主程序驗證 SSH 主機金鑰後，主機已儲存。"));
    } catch (error) {
      setSshNotice(error instanceof Error ? error.message : ui.text("The SSH host could not be saved.", "未能儲存 SSH 主機。"));
    } finally {
      setSshBusyId(null);
    }
  }

  async function runSshHostAction(hostId: string, action: "import" | "provision" | "verify" | "trust" | "revoke" | "remove") {
    if (sshBusyId) return;
    const host = form.sshHosts.find((candidate) => candidate.id === hostId);
    if (!host) return;
    setSshBusyId(hostId);
    setSshNotice(null);
    try {
      let actionNotice: string | null = null;
      let next: AppSettings;
      if (action === "import") {
        next = await window.api.importSshBootstrapKey(hostId);
      } else if (action === "provision") {
        next = await window.api.provisionSshHost(hostId);
      } else if (action === "verify") {
        const status = await window.api.verifySshHost(hostId);
        actionNotice = status.message;
        if (status.state === "failed" || status.state === "degraded") throw new Error(status.message);
        next = form;
      } else if (action === "trust" || action === "revoke") {
        next = await window.api.setSshHostSecretTrust(hostId, action === "trust");
      } else {
        next = await window.api.removeSshHost(hostId);
      }
      setForm(next);
      setSshNotice(actionNotice ?? ui.text("SSH host action completed.", "SSH 主機操作完成。"));
    } catch (error) {
      setSshNotice(error instanceof Error ? error.message : ui.text("The SSH host action failed.", "SSH 主機操作失敗。"));
    } finally {
      setSshBusyId(null);
    }
  }

  function requestSshHostRemoval(hostId: string) {
    if (sshBusyId) return;
    setPendingSshRemovalId(hostId);
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
    // Managed SSH hosts are owned by the main-process lifecycle IPC, not the
    // generic renderer settings patch/reset path.
    const resetKeys = SETTING_KEYS.filter((key) => key !== "defaultSaveFolder" && key !== "sshHosts");
    setResetSettingKeys(new Set(resetKeys));
    setForm({
      ...defaults,
      defaultSaveFolder: form.defaultSaveFolder,
      settingProvenance: {
        ...defaults.settingProvenance,
        defaultSaveFolder: currentSettings?.settingProvenance.defaultSaveFolder ?? form.settingProvenance.defaultSaveFolder,
      },
    });
    setDisplayName(DEFAULT_DISPLAY_NAME);
    setDisplayNameError(null);
    setUnlimitedSpeed(true);
    setSpeedMBs(5);
    setAccentError(null);
    setActiveAutoOrganizeRuleId(null);
    setAutoOrganizeRuleSamples(new Map());
  }

  function closeSettingsRegexBuilder() {
    setSettingsRegexOpen(false);
    // The builder is removed by the state commit. Queue a second focus pass so
    // Chromium versions that expose the post-commit DOM before the next frame
    // still return focus to the control that opened the builder.
    window.requestAnimationFrame(() => {
      settingsRegexButtonRef.current?.focus({ preventScroll: true });
    });
  }

  useLayoutEffect(() => {
    if (settingsRegexOpen) return;
    settingsRegexButtonRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(() => {
      settingsRegexButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsRegexOpen]);

  function handleSettingsEscape() {
    if (activeAutoOrganizeRuleId) {
      closeAutoOrganizeRuleBuilder();
      return true;
    }
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
    if (defaultSaveFolderError) return;
    if (invalidAutoOrganizeRuleCount > 0) return;

    setSaving(true);
    try {
      const normalizedRules = form.autoOrganizeRules.map((rule) => ({
        ...rule,
        name: rule.name.trim(),
        flags: normalizeRegexFlags(rule.flags),
      }));
      const desiredSettings: AppSettings = {
        ...form,
        displayName: normalizeDisplayName(displayName),
        globalSpeedLimitBytes: unlimitedSpeed ? 0 : Math.round(speedMBs * 1024 * 1024),
        autoOrganizeRules: normalizedRules,
      };
      const persistedSettings = currentSettings ?? form;
      const settingsPatch: SettingsPatch = {};
      const presentationPatch: PresentationPatch = {};
      const regularResetKeys: SettingKey[] = [];
      const presentationResetKeys: PresentationSettingKey[] = [];
      for (const key of SETTING_KEYS) {
        if (key === "sshHosts") continue;
        if (resetSettingKeys.has(key)) {
          if ((PRESENTATION_SETTING_KEYS as readonly string[]).includes(key)) {
            presentationResetKeys.push(key as PresentationSettingKey);
          } else {
            regularResetKeys.push(key);
          }
          continue;
        }
        if (!settingValuesEqual(key, desiredSettings[key], persistedSettings[key])) {
          if ((PRESENTATION_SETTING_KEYS as readonly string[]).includes(key)) {
            (presentationPatch as Record<string, unknown>)[key] = desiredSettings[key];
          } else {
            (settingsPatch as Record<string, unknown>)[key] = desiredSettings[key];
          }
        }
      }
      if (Object.keys(presentationPatch).length > 0 || presentationResetKeys.length > 0) {
        await setPresentationSettings(presentationPatch, presentationResetKeys);
      }
      if (Object.keys(settingsPatch).length > 0 || regularResetKeys.length > 0) {
        await setSettings(settingsPatch, regularResetKeys);
      }
      clearLegacyDisplayName();
      closeSettings();
    } catch (error) {
      notify({
        title: ui.text("Settings not saved", "設定未儲存"),
        message: error instanceof Error ? error.message : ui.schoolModeUnavailable,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const settingsTabLabels: Record<SettingsTab, string> = {
    language: ui.text("Language", "語言"),
    appearance: ui.text("Appearance", "外觀"),
    downloads: ui.text("Downloads", "下載"),
    authenticator: ui.text("Authenticator", "Authenticator"),
    advanced: ui.text("Advanced", "進階"),
  };

  function renderSettingsSearch() {
    const builderId = `settings-search-builder-${activeSettingsTab}`;
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
            aria-invalid={settingsSearchErrorText ? true : undefined}
            aria-describedby={settingsSearchErrorText
              ? `settings-search-error-${activeSettingsTab}`
              : settingsRegexBatch.pending
                ? `settings-search-pending-${activeSettingsTab}`
                : undefined}
            aria-busy={settingsRegexBatch.pending || undefined}
            onChange={(event) => updateSettingsSearch({ ...settingsSearch, pattern: event.target.value })}
          />
          <button
            type="button"
            ref={settingsRegexButtonRef}
            className={`btn btn-ghost btn-sm${settingsRegexOpen ? " active" : ""}`}
            aria-expanded={settingsRegexOpen}
            aria-controls={builderId}
            onClick={() => setSettingsRegexOpen((open) => !open)}
          >
            {ui.text("Regex", "Regex")}
          </button>
        </div>
        {settingsRegexOpen && (
          <div className="settings-search-builder" id={builderId}>
            <RegexBuilder
              title={`${settingsTabLabels[activeSettingsTab]} ${ui.text("regex builder", "regex 建構器")}`}
              value={settingsSearch}
              onChange={(value) => {
                if (value.sample !== settingsSearch.sample) {
                  setCustomSettingsSearchSamples((current) => new Set(current).add(activeSettingsTab));
                }
                updateSettingsSearch(value);
              }}
              text={ui.text}
            />
          </div>
        )}
        {settingsSearchErrorText && (
          <p id={`settings-search-error-${activeSettingsTab}`} className="field-error" role="alert">
            {settingsSearchErrorText}
          </p>
        )}
        {!settingsSearchErrorText && settingsRegexBatch.pending && (
          <p id={`settings-search-pending-${activeSettingsTab}`} className="setting-helper" role="status">
            {ui.text("Evaluating safely…", "安全評估緊…")}
          </p>
        )}
        {settingsSearch.pattern.length > 0 && !settingsSearchError && (
          <div className="settings-search-results" aria-live="polite" aria-busy={settingsRegexBatch.pending || undefined}>
            {settingsRegexBatch.pending ? (
              <span className="setting-helper" role="status">{ui.text("Evaluating safely…", "安全評估緊…")}</span>
            ) : <span className="setting-helper">
              {ui.text(
                `${matchingSettings.length} matching setting${matchingSettings.length === 1 ? "" : "s"}`,
                `${matchingSettings.length} 個相符設定`
              )}
            </span>}
            {!settingsRegexBatch.pending && matchingSettings.length > 0 ? (
              <ul>
                {matchingSettings.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => jumpToSetting(entry.targetId)}>{ui.text(entry.labels[0], entry.labels[1])}</button>
                  </li>
                ))}
              </ul>
            ) : !settingsRegexBatch.pending ? (
              <span className="setting-helper">{ui.text("No settings match this search.", "搵唔到相符設定。")}</span>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  return (<>
    <Dialog
      title={ui.settings}
      icon={<SettingsIcon size={16} />}
      onClose={closeSettings}
      width={520}
      onEscape={handleSettingsEscape}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || Boolean(defaultSaveFolderError) || invalidAutoOrganizeRuleCount > 0}
            aria-describedby={[
              defaultSaveFolderError ? "settings-default-save-folder-error" : "",
              invalidAutoOrganizeRuleCount > 0 ? "settings-auto-rule-save-error" : "",
            ].filter(Boolean).join(" ") || undefined}
            title={defaultSaveFolderError
              ?? (invalidAutoOrganizeRuleCount > 0
                ? ui.text("Fix every custom rule before saving.", "請先修正所有自訂規則再儲存。")
                : undefined)}
          >
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
        <section className="settings-section" aria-labelledby="settings-school-mode-heading">
          <div className="settings-section-heading" id="settings-school-mode-heading">{ui.schoolModeTitle}</div>
          <div className="field">
            <label className="field-label" htmlFor="settings-school-mode-name">{ui.schoolModeNameLabel}</label>
            <input
              id="settings-school-mode-name"
              className="input"
              type="text"
              maxLength={80}
              value={form.schoolModeName}
              onChange={(event) => update("schoolModeName", normalizeSchoolModeName(event.target.value))}
            />
            <span className="setting-source">{source("schoolModeName", "School mode")}</span>
            <button type="button" className="btn btn-ghost btn-sm setting-reset" onClick={() => resetSetting("schoolModeName")}>
              {copy.reset}
            </button>
          </div>
          <label className="checkbox-row" htmlFor="settings-school-mode-toggle">
            <input
              id="settings-school-mode-toggle"
              type="checkbox"
              checked={form.schoolModeEnabled}
              onChange={(event) => handleSchoolModeToggle(event.target.checked)}
            />
            <span>{ui.schoolModeLabel}</span>
          </label>
          <p className="setting-helper">{ui.schoolModeHelp}</p>
          <p className="setting-helper" role="status">
            {form.schoolModeCredential.state === "configured"
              ? ui.schoolModeCredentialConfigured
              : form.schoolModeCredential.state === "unconfigured"
                ? ui.schoolModeCredentialUnconfigured
                : `${ui.schoolModeCredentialStatus}: ${ui.schoolModeUnavailable}`}
          </p>
          <p className="setting-helper">{ui.schoolModeCredentialRecovery}</p>
          {form.schoolModeCredential.state === "configured" && schoolModeCredentialAction === null && (
            <div className="button-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSchoolModeCredentialAction("change")}>
                {ui.schoolModeCredentialChange}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSchoolModeCredentialAction("reset")}>
                {ui.schoolModeCredentialReset}
              </button>
            </div>
          )}
          {form.schoolModeCredential.state !== "configured" && schoolModeCredentialAction === null && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSchoolModeCredentialAction("setup")}>
              {ui.schoolModeCredentialSetup}
            </button>
          )}
          {schoolModeCredentialAction !== null && (
            <div className="settings-section credential-action" role="group" aria-labelledby="school-mode-credential-action-title">
              <div className="settings-section-heading" id="school-mode-credential-action-title">
                {schoolModeCredentialAction === "setup"
                  ? ui.schoolModeCredentialSetup
                  : schoolModeCredentialAction === "change"
                    ? ui.schoolModeCredentialChange
                    : schoolModeCredentialAction === "reset"
                      ? ui.schoolModeCredentialReset
                      : ui.text(`Turn off ${form.schoolModeName}`, `關閉${form.schoolModeName}`)}
              </div>
              {(schoolModeCredentialAction === "change" || schoolModeCredentialAction === "reset" || schoolModeCredentialAction === "disable") && (
                <div className="field">
                  <label className="field-label" htmlFor="school-mode-current-credential">{ui.schoolModeCredentialCurrentLabel}</label>
                  <input
                    id="school-mode-current-credential"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={schoolModeCurrentCredential}
                    onChange={(event) => setSchoolModeCurrentCredential(event.target.value)}
                  />
                </div>
              )}
              {(schoolModeCredentialAction === "setup" || schoolModeCredentialAction === "change") && (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="school-mode-new-credential">{ui.schoolModeCredentialNewLabel}</label>
                    <input
                      id="school-mode-new-credential"
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={schoolModeNextCredential}
                      onChange={(event) => setSchoolModeNextCredential(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="school-mode-confirm-credential">{ui.schoolModeCredentialConfirmLabel}</label>
                    <input
                      id="school-mode-confirm-credential"
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={schoolModeCredentialConfirmation}
                      onChange={(event) => setSchoolModeCredentialConfirmation(event.target.value)}
                    />
                  </div>
                </>
              )}
              {schoolModeCredentialError && <p className="field-error" role="alert">{schoolModeCredentialError}</p>}
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={() => void handleSchoolModeCredentialAction()} disabled={schoolModeCredentialBusy}>
                  {schoolModeCredentialBusy ? ui.text("Working…", "處理緊…") : schoolModeCredentialAction === "disable" ? ui.text("Verify and turn off", "驗證並關閉") : ui.schoolModeCredentialSave}
                </button>
                <button type="button" className="btn btn-ghost" onClick={clearSchoolModeCredentialForm} disabled={schoolModeCredentialBusy}>
                  {ui.schoolModeCredentialCancel}
                </button>
              </div>
            </div>
          )}
        </section>

        {!form.schoolModeEnabled && <section className="settings-section" aria-labelledby="settings-show-emojis-heading">
          <div className="settings-section-heading" id="settings-show-emojis-heading">{ui.showEmojisLabel}</div>
          <label className="checkbox-row" htmlFor="settings-show-emojis-toggle">
            <input
              id="settings-show-emojis-toggle"
              type="checkbox"
              checked={form.showEmojis}
              onChange={(event) => update("showEmojis", event.target.checked)}
            />
            <span>{ui.showEmojisLabel}</span>
          </label>
          <p className="setting-helper">{ui.showEmojisHelp}</p>
        </section>}

        {!form.schoolModeEnabled && <section className="settings-section" aria-labelledby="settings-language-heading">
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
        }
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
        <span className="field-label" id="settings-default-save-folder-label">{ui.text("Default save folder", "預設儲存資料夾")}</span>
          <div className="field-row">
          <input
            className="input"
            id="settings-default-save-folder-input"
            type="text"
            aria-labelledby="settings-default-save-folder-label"
            aria-invalid={defaultSaveFolderError ? true : undefined}
            aria-describedby={defaultSaveFolderError ? "settings-default-save-folder-error" : undefined}
            value={form.defaultSaveFolder}
            onChange={(e) => update("defaultSaveFolder", e.target.value)}
          />
          <button type="button" className="icon-btn" title={ui.text("Choose folder", "揀資料夾")} aria-label={ui.text("Choose default save folder", "揀預設儲存資料夾")} onClick={() => void handlePickFolder()}>
            <FolderIcon size={15} />
          </button>
        </div>
        {defaultSaveFolderError && <p id="settings-default-save-folder-error" className="field-error" role="alert">{defaultSaveFolderError}</p>}
        <span className="setting-source">{source("defaultSaveFolder", "the platform Downloads folder")}</span>
      </div>

      <section className="field" id="settings-ssh-workers" tabIndex={-1} aria-labelledby="settings-ssh-workers-heading">
        <div className="settings-section-heading" id="settings-ssh-workers-heading">
          {ui.text("Docker-backed SSH workers", "Docker SSH 工作器")}
        </div>
        <p className="setting-helper" id="settings-ssh-workers-helper">
          {ui.text(
            "Provision non-root Docker workers over pinned SSH, then split a download across the number of healthy hosts you choose. Credentials stay in the main-process vault.",
            "透過固定 SSH 金鑰自動配置非 root Docker 工作器，再按你揀嘅健康主機數量分流下載；憑證只會留喺主程序保險庫。"
          )}
        </p>
        <div className="field-pair">
          <label className="field">
            <span className="field-label">{ui.text("Default worker count", "預設工作器數量")}</span>
            <input
              className="input"
              id="settings-ssh-worker-count"
              type="number"
              min={1}
              max={16}
              value={form.sshDefaultWorkerCount}
              onChange={(event) => update("sshDefaultWorkerCount", Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
            />
            <span className="setting-source">{source("sshDefaultWorkerCount", "2")}</span>
          </label>
          <div className="field">
            <span className="field-label">{ui.text("Managed hosts", "已管理主機")}</span>
            <span className="setting-helper">{ui.text(`${form.sshHosts.length} configured`, `已設定 ${form.sshHosts.length} 部`)}</span>
          </div>
        </div>
        <div className="field-pair" role="list" aria-label={ui.text("Managed SSH hosts", "已管理 SSH 主機")}>
          {form.sshHosts.length === 0 && <div className="auto-organize-empty" role="listitem">{ui.text("No SSH hosts yet. Add one below to provision a worker.", "而家未有 SSH 主機；喺下面新增先可以配置工作器。")}</div>}
          {form.sshHosts.map((host) => (
            <article className="field" role="listitem" key={host.id}>
              <strong>{host.name}</strong>
              <code>{host.username}@{host.host}:{host.sshPort}</code>
              <span className="setting-helper">
                {host.provisionedAt ? ui.text("Provisioned", "已配置") : ui.text("Not provisioned", "未配置")}
                {host.trustedForSourceSecrets ? ui.text(" · trusted for source credentials", " · 已信任來源憑證") : ""}
              </span>
              <div className="field-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => editSshHost(host)}>{ui.text("Edit", "編輯")}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={sshBusyId === host.id} onClick={() => void runSshHostAction(host.id, "import")}>{ui.text("Import key", "匯入金鑰")}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={sshBusyId === host.id} onClick={() => void runSshHostAction(host.id, "provision")}>{ui.text("Provision", "配置")}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={sshBusyId === host.id} onClick={() => void runSshHostAction(host.id, "verify")}>{ui.text("Verify", "驗證")}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={sshBusyId === host.id || !host.provisionedAt} onClick={() => void runSshHostAction(host.id, host.trustedForSourceSecrets ? "revoke" : "trust")}>{host.trustedForSourceSecrets ? ui.text("Revoke trust", "撤銷信任") : ui.text("Trust source credentials", "信任來源憑證")}</button>
                <button type="button" className="btn btn-ghost btn-sm text-danger" disabled={sshBusyId === host.id} onClick={() => requestSshHostRemoval(host.id)}>{ui.text("Remove", "移除")}</button>
              </div>
            </article>
          ))}
        </div>
        <div className="field-pair">
          <label className="field"><span className="field-label">{ui.text("Host name", "主機名稱")}</span><input className="input" value={sshDraft.name} onChange={(event) => setSshDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
          <label className="field"><span className="field-label">{ui.text("Host", "主機")}</span><input className="input" value={sshDraft.host} onChange={(event) => setSshDraft((draft) => ({ ...draft, host: event.target.value }))} /></label>
          <label className="field"><span className="field-label">{ui.text("SSH port", "SSH 連接埠")}</span><input className="input" type="number" min={1} max={65535} value={sshDraft.sshPort} onChange={(event) => setSshDraft((draft) => ({ ...draft, sshPort: Number(event.target.value) || 22 }))} /></label>
          <label className="field"><span className="field-label">{ui.text("Username", "使用者名稱")}</span><input className="input" value={sshDraft.username} onChange={(event) => setSshDraft((draft) => ({ ...draft, username: event.target.value }))} /></label>
          <label className="field"><span className="field-label">{ui.text("Pinned host key SHA256", "固定主機金鑰 SHA256")}</span><input className="input" value={sshDraft.hostKeySha256} onChange={(event) => setSshDraft((draft) => ({ ...draft, hostKeySha256: event.target.value }))} placeholder="SHA256:…" /></label>
          <label className="field"><span className="field-label">{ui.text("Worker loopback port", "工作器 loopback 連接埠")}</span><input className="input" type="number" min={1024} max={65535} value={sshDraft.workerPort} onChange={(event) => setSshDraft((draft) => ({ ...draft, workerPort: Number(event.target.value) || 2222 }))} /></label>
        </div>
        <div className="field-row">
          <button type="button" className="btn btn-primary" disabled={sshBusyId === sshDraft.id} onClick={() => void saveSshHostDraft()}>{ui.text("Save and verify host", "儲存並驗證主機")}</button>
          <button type="button" className="btn btn-ghost" onClick={newSshHost}>{ui.text("New host", "新增主機")}</button>
        </div>
        {sshNotice && <p className="setting-helper" role="status" aria-live="polite">{sshNotice}</p>}
      </section>

      <div className="auto-organize-settings field" id="settings-auto-organize" tabIndex={-1}>
        <div className="auto-organize-setting-heading">
          <div>
            <span className="field-label" id="settings-auto-organize-label">
              {ui.text("Organize new downloads into category folders", "將新下載自動整理到分類資料夾")}
            </span>
            <p className="setting-helper" id="settings-auto-organize-helper">
              {ui.text(
                "When a download uses the default folder, the app creates and uses the matching category path. Existing files are never moved.",
                "下載使用預設資料夾時，應用程式會建立並使用相符分類路徑；現有檔案絕對唔會搬動。"
              )}
            </p>
          </div>
          <button
            type="button"
            id="settings-auto-organize-toggle"
            className={`switch-control${form.autoOrganizeEnabled ? " checked" : ""}`}
            role="switch"
            aria-checked={form.autoOrganizeEnabled}
            aria-labelledby="settings-auto-organize-label"
            aria-describedby="settings-auto-organize-helper settings-auto-organize-source"
            onClick={() => update("autoOrganizeEnabled", !form.autoOrganizeEnabled)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
        <span className="setting-source" id="settings-auto-organize-source">
          {source("autoOrganizeEnabled", ui.text("on", "開啟"))}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm setting-reset"
          aria-label={ui.text("Reset auto-organize folder routing", "重設自動分類資料夾整理")}
          aria-describedby="settings-auto-organize-helper settings-auto-organize-source"
          onClick={() => resetSetting("autoOrganizeEnabled")}
        >
          {copy.reset}
        </button>

        <div className="auto-organize-folder-map" role="list" aria-label={ui.text("Auto-organize destination paths", "自動分類目的路徑")}>
          {AUTO_ORGANIZE_TARGETS.map((category) => {
            const folder = AUTO_ORGANIZE_FOLDERS[category];
            const destination = displayAutoOrganizePath(form.defaultSaveFolder, folder);
            return (
              <div
                key={category}
                id={`settings-auto-organize-path-${category}`}
                className="auto-organize-folder-row"
                role="listitem"
                tabIndex={-1}
                aria-label={ui.text(
                  `${AUTO_ORGANIZE_TARGET_LABELS[category][0]} destination path`,
                  `${AUTO_ORGANIZE_TARGET_LABELS[category][1]}目的路徑`
                )}
              >
                <strong>{ui.text(...AUTO_ORGANIZE_TARGET_LABELS[category])}</strong>
                <code>{destination || ui.text("Choose a default save folder to preview this path.", "請先揀預設儲存資料夾先可以預覽路徑。")}</code>
              </div>
            );
          })}
        </div>
        <p className="setting-helper">
          {ui.text(
            "Folders are created only when a matching download starts. Images and uncategorized files both use General.",
            "分類資料夾只會喺相符下載開始時建立；圖片同未分類檔案都會用「一般」。"
          )}
        </p>
      </div>

      <div
        className="auto-organize-rules field"
        id="settings-auto-organize-rules"
        role="region"
        aria-labelledby="settings-auto-organize-rules-heading"
        aria-describedby="settings-auto-organize-rules-helper settings-auto-organize-rules-source"
        tabIndex={-1}
      >
        <div className="settings-section-heading" id="settings-auto-organize-rules-heading">
          {ui.text("Custom regex classification rules", "自訂 regex 分類規則")}
        </div>
        <p className="setting-helper" id="settings-auto-organize-rules-helper">
          {ui.text(
            "Rules run from top to bottom before extension mapping. Each rule checks the file name, then the URL; the first match wins. Rules still classify the sidebar when folder organization is off.",
            "規則由上至下喺副檔名分類之前執行，每條先檢查檔名再檢查網址，第一條相符就勝出；就算關咗資料夾整理，規則仍然會分類側邊欄。"
          )}
        </p>
        <div className="auto-organize-rule-presets" role="group" aria-label={ui.text("Add a custom rule", "新增自訂規則")}>
          <button
            type="button"
            ref={addAutoOrganizeRuleButtonRef}
            className="btn btn-ghost btn-sm"
            onClick={() => addAutoOrganizeRule("documents")}
            disabled={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT}
            title={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT ? ui.text("The 50-rule limit is reached.", "已達 50 條規則上限。") : undefined}
          >
            {ui.text("Add document preset", "新增文件預設")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAutoOrganizeRule("archives")}
            disabled={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT}
            title={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT ? ui.text("The 50-rule limit is reached.", "已達 50 條規則上限。") : undefined}
          >
            {ui.text("Add archive preset", "新增壓縮檔預設")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => addAutoOrganizeRule("blank")}
            disabled={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT}
            title={form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT ? ui.text("The 50-rule limit is reached.", "已達 50 條規則上限。") : undefined}
          >
            {ui.text("Add blank rule", "新增空白規則")}
          </button>
        </div>
        {form.autoOrganizeRules.length >= AUTO_ORGANIZE_RULE_LIMIT && (
          <p className="setting-helper" role="status">{ui.text("All 50 rule slots are in use.", "50 個規則位置已全部使用。")}</p>
        )}
        <span className="setting-source" id="settings-auto-organize-rules-source">
          {source("autoOrganizeRules", ui.text("no custom rules", "冇自訂規則"))}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm setting-reset"
          aria-label={ui.text("Reset custom classification rules", "重設自訂分類規則")}
          aria-describedby="settings-auto-organize-rules-helper settings-auto-organize-rules-source"
          onClick={() => {
            resetSetting("autoOrganizeRules");
            setActiveAutoOrganizeRuleId(null);
            setAutoOrganizeRuleSamples(new Map());
          }}
        >
          {copy.reset}
        </button>

        {form.autoOrganizeRules.length === 0 ? (
          <div className="auto-organize-empty">
            {ui.text(
              "No custom rules. Built-in extension mapping will choose the category.",
              "而家冇自訂規則，會由內置副檔名對照揀分類。"
            )}
          </div>
        ) : (
          <div className="auto-organize-rule-list" role="list" aria-label={ui.text("Ordered custom rules", "已排序自訂規則")}>
            {form.autoOrganizeRules.map((rule, index) => {
              const error = autoOrganizeRuleErrors[index];
              const builderOpen = activeAutoOrganizeRuleId === rule.id;
              const ruleDomId = `settings-auto-rule-${index + 1}`;
              const headingId = `${ruleDomId}-heading`;
              const nameLabelId = `${ruleDomId}-name-label`;
              const categoryLabelId = `${ruleDomId}-category-label`;
              const patternLabelId = `${ruleDomId}-pattern-label`;
              const errorId = `${ruleDomId}-error`;
              const builderId = `${ruleDomId}-builder`;
              const rulePosition = ui.text(`Rule ${index + 1}`, `規則 ${index + 1}`);
              return (
                <article
                  key={rule.id}
                  className={`auto-organize-rule-card${error ? " invalid" : ""}`}
                  role="listitem"
                  aria-labelledby={headingId}
                  aria-describedby={error?.field === "rule" ? errorId : undefined}
                >
                  <div className="auto-organize-rule-card-heading">
                    <strong id={headingId}>{rulePosition}</strong>
                    <span>{ui.text("First matching rule wins", "第一條相符規則勝出")}</span>
                  </div>
                  <div className="auto-organize-rule-grid">
                    <label className="field">
                      <span className="field-label" id={nameLabelId}>{ui.text("Rule name", "規則名稱")}</span>
                      <input
                        id={`${ruleDomId}-name`}
                        ref={(node) => {
                          if (node) autoOrganizeRuleNameRefs.current.set(rule.id, node);
                          else autoOrganizeRuleNameRefs.current.delete(rule.id);
                        }}
                        className="input"
                        value={rule.name}
                        maxLength={AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH}
                        aria-labelledby={`${headingId} ${nameLabelId}`}
                        aria-invalid={error?.field === "name" ? true : undefined}
                        aria-describedby={error?.field === "name" ? errorId : undefined}
                        onChange={(event) => updateAutoOrganizeRule(index, { name: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label" id={categoryLabelId}>{ui.text("Destination category", "目的分類")}</span>
                      <select
                        id={`${ruleDomId}-category`}
                        className="input select"
                        value={rule.category}
                        aria-labelledby={`${headingId} ${categoryLabelId}`}
                        aria-invalid={error?.field === "category" ? true : undefined}
                        aria-describedby={error?.field === "category" ? errorId : undefined}
                        onChange={(event) => updateAutoOrganizeRule(index, { category: event.target.value as AutoOrganizeTargetCategory })}
                      >
                        {AUTO_ORGANIZE_TARGETS.map((category) => (
                          <option key={category} value={category}>{ui.text(...AUTO_ORGANIZE_TARGET_LABELS[category])}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="field auto-organize-pattern-field">
                    <span className="field-label" id={patternLabelId}>{ui.text("Regex pattern", "Regex 模式")}</span>
                    <div className="field-row">
                      <input
                        id={`${ruleDomId}-pattern`}
                        className="input"
                        value={rule.pattern}
                        maxLength={AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH}
                        spellCheck={false}
                        aria-labelledby={`${headingId} ${patternLabelId}`}
                        aria-invalid={error?.field === "pattern" ? true : undefined}
                        aria-describedby={error?.field === "pattern" ? errorId : undefined}
                        onChange={(event) => updateAutoOrganizeRule(index, { pattern: event.target.value })}
                      />
                      <button
                        type="button"
                        id={`${ruleDomId}-builder-toggle`}
                        ref={(node) => {
                          if (node) autoOrganizeRuleButtonRefs.current.set(rule.id, node);
                          else autoOrganizeRuleButtonRefs.current.delete(rule.id);
                        }}
                        className={`btn btn-ghost btn-sm${builderOpen ? " active" : ""}`}
                        aria-expanded={builderOpen}
                        aria-controls={builderId}
                        aria-label={ui.text(
                          `${builderOpen ? "Close" : "Open"} regex builder for Rule ${index + 1}`,
                          `${builderOpen ? "關閉" : "開啟"}規則 ${index + 1} 嘅 regex 建構器`
                        )}
                        onClick={() => builderOpen ? closeAutoOrganizeRuleBuilder(false) : setActiveAutoOrganizeRuleId(rule.id)}
                      >
                        {ui.text("Regex builder", "Regex 建構器")}
                      </button>
                    </div>
                  </div>
                  <div className="auto-organize-flags-summary">
                    <span className="field-label">{ui.text("Flags", "旗標")}</span>
                    <code>{rule.flags || ui.text("none", "冇")}</code>
                    <span className="setting-helper">{ui.text("Choose flags in this rule's regex builder.", "請喺呢條規則嘅 regex 建構器揀旗標。")}</span>
                  </div>
                  {error && <p id={errorId} className="field-error" role="alert">{error.message}</p>}
                  <div className="auto-organize-rule-actions">
                    <button
                      type="button"
                      ref={(node) => {
                        const key = `${rule.id}:-1`;
                        if (node) autoOrganizeRuleMoveButtonRefs.current.set(key, node);
                        else autoOrganizeRuleMoveButtonRefs.current.delete(key);
                      }}
                      className="btn btn-ghost btn-sm"
                      onClick={() => moveAutoOrganizeRule(index, -1)}
                      disabled={index === 0}
                      aria-label={ui.text(`Rule ${index + 1}: Move up`, `規則 ${index + 1}：上移`)}
                      title={index === 0 ? ui.text("This is already the first rule.", "呢條已經係第一條規則。") : undefined}
                    >
                      {ui.text("Move up", "上移")}
                    </button>
                    <button
                      type="button"
                      ref={(node) => {
                        const key = `${rule.id}:1`;
                        if (node) autoOrganizeRuleMoveButtonRefs.current.set(key, node);
                        else autoOrganizeRuleMoveButtonRefs.current.delete(key);
                      }}
                      className="btn btn-ghost btn-sm"
                      onClick={() => moveAutoOrganizeRule(index, 1)}
                      disabled={index === form.autoOrganizeRules.length - 1}
                      aria-label={ui.text(`Rule ${index + 1}: Move down`, `規則 ${index + 1}：下移`)}
                      title={index === form.autoOrganizeRules.length - 1 ? ui.text("This is already the last rule.", "呢條已經係最後一條規則。") : undefined}
                    >
                      {ui.text("Move down", "下移")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-danger"
                      aria-label={ui.text(`Rule ${index + 1}: Remove rule`, `規則 ${index + 1}：移除規則`)}
                      onClick={() => removeAutoOrganizeRule(index)}
                    >
                      {ui.text("Remove rule", "移除規則")}
                    </button>
                  </div>
                  {builderOpen && (
                    <div className="auto-organize-rule-builder" id={builderId}>
                      <div className="auto-organize-rule-builder-toolbar">
                        <div>
                          <strong>{ui.text("Classification rule regex builder", "分類規則 regex 建構器")}</strong>
                          <span>{rule.name || rulePosition}</span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={ui.text(`Close regex builder for Rule ${index + 1}`, `關閉規則 ${index + 1} 嘅 regex 建構器`)}
                          onClick={() => closeAutoOrganizeRuleBuilder()}
                        >
                          {ui.text("Close builder", "關閉建構器")}
                        </button>
                      </div>
                      <RegexBuilder
                        title={ui.text(
                          `Rule ${index + 1} classification regex builder`,
                          `規則 ${index + 1} 分類 regex 建構器`
                        )}
                        fixedRegex
                        patternMaxLength={AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH}
                        text={ui.text}
                        value={{
                          mode: "regex",
                          pattern: rule.pattern,
                          flags: rule.flags,
                          sample: autoOrganizeRuleSamples.get(rule.id) ?? DEFAULT_RULE_SAMPLE,
                        }}
                        onChange={(value) => {
                          updateAutoOrganizeRule(index, { pattern: value.pattern, flags: value.flags });
                          setAutoOrganizeRuleSamples((current) => {
                            const next = new Map(current);
                            next.set(rule.id, value.sample);
                            return next;
                          });
                        }}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">{autoOrganizeRuleStatus}</p>
        {invalidAutoOrganizeRuleCount > 0 && (
          <p id="settings-auto-rule-save-error" className="field-error" role="alert">
            {ui.text(
              `${invalidAutoOrganizeRuleCount} custom rule${invalidAutoOrganizeRuleCount === 1 ? " needs" : "s need"} attention before settings can be saved.`,
              `儲存設定之前，仲有 ${invalidAutoOrganizeRuleCount} 條自訂規則要修正。`
            )}
          </p>
        )}
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

      <div className="field" id="settings-browser-extension" tabIndex={-1}>
        <span className="field-label" id="settings-install-extension-label">
          {ui.text("Browser extension", "瀏覽器擴充功能")}
        </span>
        <p className="setting-helper" id="settings-install-extension-helper">
          {ui.text(
            "Install the bundled Chromium extension to hand eligible browser downloads to this app automatically; pages and links can still be sent manually. It creates a private pairing for this app installation, stages the extension in a stable folder, and opens that folder automatically. In Chrome, turn on Developer mode, choose Load unpacked, and select that folder; use Reload there after preparing it again.",
            "安裝內置嘅 Chromium 擴充功能，就會自動將合資格嘅瀏覽器下載交畀呢個 app；網頁同連結仍然可以手動傳送。佢會為今次程式安裝建立私人配對、將擴充功能放入固定資料夾並自動打開。之後喺 Chrome 開開發者模式，揀 Load unpacked 再揀嗰個資料夾；如果再次準備，就要喺嗰度㩒 Reload。"
          )}
        </p>
        <div className="field-row">
          <button
            type="button"
            id="settings-install-extension"
            className="btn btn-primary btn-sm"
            aria-describedby="settings-install-extension-helper"
            disabled={extensionOperation !== null}
            onClick={() => void handleInstallExtension()}
          >
            {extensionOperation === "install"
              ? ui.text("Installing…", "安裝緊…")
              : ui.text("Install browser extension", "安裝瀏覽器擴充功能")}
          </button>
          {extensionPath && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={extensionOperation !== null}
              onClick={() => void handleRevealExtension()}
            >
              {extensionOperation === "reveal"
                ? ui.text("Opening…", "打開緊…")
                : ui.text("Open extension folder", "開啟擴充功能資料夾")}
            </button>
          )}
        </div>
        {extensionStatusText && (
          <p className="setting-helper" role="status" aria-live="polite">{extensionStatusText}</p>
        )}
        {extensionErrorText && (
          <p className="field-error" role="alert">{extensionErrorText}</p>
        )}
      </div>
        </section>
      </div>}

      {activeSettingsTab === "authenticator" && <div className="settings-tab-panel" id="settings-panel-authenticator" role="tabpanel" aria-labelledby="settings-tab-authenticator">
        {renderSettingsSearch()}
        <AuthenticatorPanel />
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
    {pendingSshRemovalId && (
      <DestructiveActionGate
        request={{ itemIds: [pendingSshRemovalId], deleteFile: false }}
        actionName={ui.text("remove this managed SSH worker host", "移除呢部已管理 SSH 工作器主機")}
        affectedLabel={ui.text("managed SSH worker host", "已管理 SSH 工作器主機")}
        onCancel={() => setPendingSshRemovalId(null)}
        onConfirm={() => {
          const hostId = pendingSshRemovalId;
          setPendingSshRemovalId(null);
          void runSshHostAction(hostId, "remove");
        }}
      />
    )}
  </>);
}
