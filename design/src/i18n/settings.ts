import type { LanguageMode } from "@shared/types";

export interface SettingsCopy {
  language: string;
  languageHelper: string;
  english: string;
  cantonese: string;
  bilingual: string;
  funnyEnglish: string;
  funnyCantonese: string;
  funnyDisclosure: string;
  appearance: string;
  density: string;
  densityHelper: string;
  accent: string;
  accentHelper: string;
  accentInvalid: string;
  fontFamily: string;
  fontFamilyHelper: string;
  fontSize: string;
  fontWeight: string;
  reset: string;
  resetAll: string;
  resetAllConfirmation: string;
  sourcePersisted: string;
  sourceCompiledIn: (value: string) => string;
}

const SETTINGS_COPY: Record<LanguageMode, SettingsCopy> = {
  english: {
    language: "Language mode",
    languageHelper: "Choose exactly one interface language mode. Changes are saved with the rest of your settings.",
    english: "English",
    cantonese: "Playful Hong Kong-style Cantonese",
    bilingual: "Compact bilingual",
    funnyEnglish: "English funny level",
    funnyCantonese: "Cantonese funny level",
    funnyDisclosure: "Funny level styles every message, including errors and warnings. Facts and next steps remain exact; you can change or reset this at any time.",
    appearance: "Appearance",
    density: "Density",
    densityHelper: "Controls spacing in the renderer. The current value applies immediately and is saved.",
    accent: "Accent / seed color",
    accentHelper: "Sets the primary accent seed used by the existing theme tokens. Enter a six- or eight-digit HEX color.",
    accentInvalid: "Use #RRGGBB or #RRGGBBAA.",
    fontFamily: "UI font family",
    fontFamilyHelper: "Uses the selected installed or bundled face when available, then falls back to the listed system-safe stack.",
    fontSize: "UI font size",
    fontWeight: "UI font weight",
    reset: "Reset",
    resetAll: "Reset all settings to compiled-in values",
    resetAllConfirmation: "Reset every setting to its compiled-in value? This replaces saved preferences.",
    sourcePersisted: "Source: persisted value",
    sourceCompiledIn: (value) => `Source: compiled-in value (${value})`,
  },
  cantonese: {
    language: "語言模式",
    languageHelper: "揀一個介面語言模式；改動會同其他設定一齊儲存，唔會自己扮失憶。",
    english: "English 英文",
    cantonese: "Playful Hong Kong-style Cantonese · 香港玩味廣東話",
    bilingual: "Compact bilingual · 精簡雙語",
    funnyEnglish: "英文搞笑程度",
    funnyCantonese: "廣東話搞笑程度",
    funnyDisclosure: "搞笑程度會套用到所有訊息，包括錯誤同警告；事實同下一步保持準確，你隨時可以改返或者重設。",
    appearance: "外觀",
    density: "密度",
    densityHelper: "控制介面間距；改動會即時生效並儲存，唔使等佢慢慢諗。",
    accent: "主色／種子色",
    accentHelper: "用現有主題色彩代碼套用主色種子；請輸入六位或八位 HEX 顏色。",
    accentInvalid: "請用 #RRGGBB 或 #RRGGBBAA。",
    fontFamily: "介面字型",
    fontFamilyHelper: "有安裝或內置字型就用嗰個，搵唔到就按列出的安全後備字型顯示。",
    fontSize: "介面字體大小",
    fontWeight: "介面字體粗幼",
    reset: "重設",
    resetAll: "將所有設定重設為程式內置值",
    resetAllConfirmation: "要將所有設定重設為程式內置值嗎？已儲存偏好會被取代。",
    sourcePersisted: "來源：已儲存值",
    sourceCompiledIn: (value) => `來源：程式內置值（${value}）`,
  },
  bilingual: {
    language: "Language mode · 語言模式",
    languageHelper: "Choose one interface mode · 揀一個介面模式；changes are saved · 改動會儲存。",
    english: "English · 英文",
    cantonese: "Playful Hong Kong-style Cantonese · 香港玩味廣東話",
    bilingual: "Compact bilingual · 精簡雙語",
    funnyEnglish: "English funny level · 英文搞笑程度",
    funnyCantonese: "Cantonese funny level · 廣東話搞笑程度",
    funnyDisclosure: "Funny level styles every message, including errors and warnings · 搞笑程度套用到所有訊息，包括錯誤同警告。 Facts and next steps stay exact · 事實同下一步保持準確。",
    appearance: "Appearance · 外觀",
    density: "Density · 密度",
    densityHelper: "Controls spacing and applies immediately · 控制間距並即時生效。",
    accent: "Accent / seed color · 主色／種子色",
    accentHelper: "Uses the existing theme tokens · 使用現有主題色彩代碼；HEX only · 只接受 HEX。",
    accentInvalid: "Use #RRGGBB or #RRGGBBAA · 請用 #RRGGBB 或 #RRGGBBAA。",
    fontFamily: "UI font family · 介面字型",
    fontFamilyHelper: "Installed/bundled face first, safe fallback second · 先用安裝或內置字型，否則用安全後備字型。",
    fontSize: "UI font size · 字體大小",
    fontWeight: "UI font weight · 字體粗幼",
    reset: "Reset · 重設",
    resetAll: "Reset all settings · 重設全部設定",
    resetAllConfirmation: "Reset every setting to its compiled-in value? · 將所有設定重設為程式內置值？",
    sourcePersisted: "Source: persisted value · 來源：已儲存值",
    sourceCompiledIn: (value) => `Source: compiled-in value (${value}) · 來源：程式內置值（${value}）`,
  },
};

export function getSettingsCopy(mode: LanguageMode): SettingsCopy {
  return SETTINGS_COPY[mode];
}
