import type {
  AppSettings,
  AutoOrganizeRule,
  DensityMode,
  DownloadCategory,
  FunnyLevel,
  LanguageMode,
  SettingKey,
  SettingsProvenance,
  UIFontFamily,
  UIFontWeight,
} from "./types";
import {
  AUTO_ORGANIZE_RULE_LIMIT,
  AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH,
  AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH,
  SETTING_KEYS,
} from "./types";
import { normalizeRegexFlags, validateRegexPattern } from "./regex";

export const SETTINGS_SCHEMA_VERSION = 2;
export const APP_DISPLAY_NAME_MAX_LENGTH = 64;

export const COMPILED_IN_DEFAULTS = {
  maxConnectionsPerDownload: 8,
  maxActiveDownloads: 3,
  globalSpeedLimitBytes: 0,
  showCompleteDialog: true,
  startOnSystemStartup: false,
  theme: "dark" as const,
  minConnectionPartSize: 2 * 1024 * 1024,
  languageMode: "english" as LanguageMode,
  funnyLevelEnglish: 1 as FunnyLevel,
  funnyLevelCantonese: 3 as FunnyLevel,
  density: "comfortable" as DensityMode,
  accentSeedColor: "#7c5cff",
  uiFontFamily: "segoe-ui" as UIFontFamily,
  uiFontSize: 13,
  uiFontWeight: 400 as UIFontWeight,
  autoOrganizeEnabled: true,
};

export function compiledInProvenance(): SettingsProvenance {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, "compiled-in"])
  ) as SettingsProvenance;
}

export function createDefaultSettings(defaultSaveFolder: string): AppSettings {
  return {
    settingsVersion: SETTINGS_SCHEMA_VERSION,
    defaultSaveFolder,
    ...COMPILED_IN_DEFAULTS,
    // A fresh array per settings object so one profile's rules can never
    // alias another's through the shared compiled-in default.
    autoOrganizeRules: [],
    settingProvenance: compiledInProvenance(),
  };
}

export function isLanguageMode(value: unknown): value is LanguageMode {
  return value === "english" || value === "cantonese" || value === "bilingual";
}

export function isFunnyLevel(value: unknown): value is FunnyLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isDensityMode(value: unknown): value is DensityMode {
  return value === "compact" || value === "comfortable" || value === "spacious";
}

export function isUIFontFamily(value: unknown): value is UIFontFamily {
  return value === "segoe-ui" || value === "inter" || value === "cascadia-code" || value === "system";
}

export function isUIFontWeight(value: unknown): value is UIFontWeight {
  return value === 400 || value === 500 || value === 600 || value === 700;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(value);
}

export function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

export function isDownloadCategory(value: unknown): value is DownloadCategory {
  return (
    value === "image" ||
    value === "music" ||
    value === "video" ||
    value === "apps" ||
    value === "document" ||
    value === "compressed" ||
    value === "other"
  );
}

/** Validate one auto-organize rule with the same bounds the editor enforces. */
export function isAutoOrganizeRule(value: unknown): value is AutoOrganizeRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  if (typeof rule.id !== "string" || rule.id.length === 0 || rule.id.length > 64) return false;
  if (typeof rule.name !== "string" || rule.name.length > AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH) return false;
  if (
    typeof rule.pattern !== "string" ||
    rule.pattern.length === 0 ||
    rule.pattern.length > AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH
  ) {
    return false;
  }
  if (typeof rule.flags !== "string" || normalizeRegexFlags(rule.flags) !== rule.flags) return false;
  if (validateRegexPattern(rule.pattern, rule.flags) !== null) return false;
  return isDownloadCategory(rule.category);
}

export function isAutoOrganizeRules(value: unknown): value is AutoOrganizeRule[] {
  return Array.isArray(value) && value.length <= AUTO_ORGANIZE_RULE_LIMIT && value.every(isAutoOrganizeRule);
}

/** Validate a renderer-originated patch before it reaches live application state. */
export function validateSettingsPatch(value: unknown): Partial<AppSettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid settings");
  }

  const patch = value as Record<string, unknown>;
  for (const [key, settingValue] of Object.entries(patch)) {
    if (!isSettingKey(key)) throw new Error(`Invalid setting key: ${key}`);
    const valid = (() => {
      switch (key) {
        case "defaultSaveFolder":
          return typeof settingValue === "string" && settingValue.length <= 32_768;
        case "maxConnectionsPerDownload":
        case "maxActiveDownloads":
          return isBoundedNumber(settingValue, 1, 32) && Number.isInteger(settingValue);
        case "globalSpeedLimitBytes":
          return isBoundedNumber(settingValue, 0, Number.MAX_SAFE_INTEGER);
        case "showCompleteDialog":
        case "startOnSystemStartup":
          return typeof settingValue === "boolean";
        case "theme":
          return settingValue === "dark" || settingValue === "light" || settingValue === "system";
        case "minConnectionPartSize":
          return isBoundedNumber(settingValue, 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(settingValue);
        case "languageMode":
          return isLanguageMode(settingValue);
        case "funnyLevelEnglish":
        case "funnyLevelCantonese":
          return isFunnyLevel(settingValue);
        case "density":
          return isDensityMode(settingValue);
        case "accentSeedColor":
          return isHexColor(settingValue);
        case "uiFontFamily":
          return isUIFontFamily(settingValue);
        case "uiFontSize":
          return isBoundedNumber(settingValue, 10, 32);
        case "uiFontWeight":
          return isUIFontWeight(settingValue);
        case "autoOrganizeEnabled":
          return typeof settingValue === "boolean";
        case "autoOrganizeRules":
          return isAutoOrganizeRules(settingValue);
      }
    })();
    if (!valid) throw new Error(`Invalid value for setting: ${key}`);
  }
  return patch as Partial<AppSettings>;
}
