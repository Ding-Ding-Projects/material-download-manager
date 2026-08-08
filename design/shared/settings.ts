import type {
  AppSettings,
  AutoOrganizeRule,
  AutoOrganizeTargetCategory,
  DensityMode,
  DownloadCategory,
  FunnyLevel,
  LanguageMode,
  SettingKey,
  SettingsPatch,
  SettingsProvenance,
  SshHostConfig,
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
import { cloneSshHostConfigs, isSshHostConfigs } from "./ssh";

export const SETTINGS_SCHEMA_VERSION = 4;
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
  sshDefaultWorkerCount: 2,
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
    sshHosts: [],
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

export function isValidDefaultSaveFolder(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32_768 || value.trim() !== value || value.includes("\0")) {
    return false;
  }
  return /^[a-zA-Z]:[\\/]/u.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(value);
}

export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

/** Validate the trusted reset intent separately from renderer-authored values. */
export function validateSettingResetKeys(value: unknown): SettingKey[] {
  if (!Array.isArray(value) || value.length > SETTING_KEYS.length) {
    throw new Error("Invalid setting reset keys");
  }
  const keys: SettingKey[] = [];
  const seen = new Set<SettingKey>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !isSettingKey(candidate) || seen.has(candidate)) {
      throw new Error("Invalid setting reset keys");
    }
    seen.add(candidate);
    keys.push(candidate);
  }
  return keys;
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

export function isAutoOrganizeTargetCategory(value: unknown): value is AutoOrganizeTargetCategory {
  return isDownloadCategory(value) && value !== "image";
}

/** Validate one auto-organize rule with the same bounds the editor enforces. */
export function isAutoOrganizeRule(value: unknown): value is AutoOrganizeRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(rule);
  const expectedKeys = new Set(["id", "name", "pattern", "flags", "category"]);
  if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) return false;
  if (typeof rule.id !== "string" || rule.id.length === 0 || rule.id.length > 64) return false;
  if (rule.id in Object.prototype) return false;
  if (
    typeof rule.name !== "string" ||
    rule.name.trim().length === 0 ||
    rule.name.length > AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH
  ) {
    return false;
  }
  if (
    typeof rule.pattern !== "string" ||
    rule.pattern.length === 0 ||
    rule.pattern.length > AUTO_ORGANIZE_RULE_PATTERN_MAX_LENGTH
  ) {
    return false;
  }
  if (typeof rule.flags !== "string" || normalizeRegexFlags(rule.flags) !== rule.flags) return false;
  if (validateRegexPattern(rule.pattern, rule.flags) !== null) return false;
  return isAutoOrganizeTargetCategory(rule.category);
}

export function isAutoOrganizeRules(value: unknown): value is AutoOrganizeRule[] {
  if (!Array.isArray(value) || value.length > AUTO_ORGANIZE_RULE_LIMIT || !value.every(isAutoOrganizeRule)) return false;
  return new Set(value.map((rule) => rule.id)).size === value.length;
}

/** Validate a renderer-originated patch before it reaches live application state. */
export interface SettingsPatchValidationOptions {
  /** Internal main-process host lifecycle code may replace the canonical host list. */
  allowManagedSshHosts?: boolean;
}

export function validateSettingsPatch(
  value: unknown,
  options: SettingsPatchValidationOptions = {},
): SettingsPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid settings");
  }

  const patch = value as Record<string, unknown>;
  const normalizedPatch: Record<string, unknown> = {};
  for (const [key, settingValue] of Object.entries(patch)) {
    if (!isSettingKey(key)) throw new Error(`Invalid setting key: ${key}`);
    const valid = (() => {
      switch (key) {
        case "defaultSaveFolder":
          return isValidDefaultSaveFolder(settingValue);
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
        case "sshHosts":
          if (options.allowManagedSshHosts !== true) return false;
          return isSshHostConfigs(settingValue);
        case "sshDefaultWorkerCount":
          return isBoundedNumber(settingValue, 1, 16) && Number.isInteger(settingValue);
      }
    })();
    if (!valid) throw new Error(`Invalid value for setting: ${key}`);
    normalizedPatch[key] = key === "autoOrganizeRules"
      ? (settingValue as AutoOrganizeRule[]).map((rule) => ({
          id: rule.id,
          name: rule.name,
          pattern: rule.pattern,
          flags: rule.flags,
          category: rule.category,
        }))
      : key === "sshHosts"
        ? cloneSshHostConfigs(settingValue as SshHostConfig[])
      : settingValue;
  }
  return normalizedPatch as SettingsPatch;
}
