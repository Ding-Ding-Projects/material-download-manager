import type {
  AppSettings,
  DensityMode,
  FunnyLevel,
  LanguageMode,
  SettingKey,
  SettingsProvenance,
  UIFontFamily,
  UIFontWeight,
} from "./types";
import { SETTING_KEYS } from "./types";

export const SETTINGS_SCHEMA_VERSION = 2;

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
