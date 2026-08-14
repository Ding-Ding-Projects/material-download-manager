(function (global) {
  "use strict";

  function normalizeLabel(value, fallback, maxLength) {
    const normalized = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").trim().slice(0, maxLength);
    return normalized || fallback;
  }

  function validHex(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }

  function clamp(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function normalizeSettingsRecord(parsed, defaults, schoolModeName, productName) {
    const source = parsed && typeof parsed === "object" ? parsed : {};
    const storedSchool = source.schoolMode && typeof source.schoolMode === "object" ? source.schoolMode : {
      enabled: source.schoolModeEnabled,
      name: source.schoolModeName
    };
    return {
      schemaVersion: defaults.schemaVersion,
      revision: clamp(Number(source.revision), 0, Number.MAX_SAFE_INTEGER, defaults.revision),
      language: ["en", "yue", "bilingual"].includes(source.language) ? source.language : defaults.language,
      funnyEn: clamp(Number(source.funnyEn), 1, 5, defaults.funnyEn),
      funnyYue: clamp(Number(source.funnyYue), 1, 5, defaults.funnyYue),
      showEmojis: typeof source.showEmojis === "boolean" ? source.showEmojis : defaults.showEmojis,
      schoolMode: {
        enabled: storedSchool && storedSchool.enabled === true,
        name: normalizeLabel(storedSchool?.name, schoolModeName, 48)
      },
      theme: ["system", "light", "dark"].includes(source.theme) ? source.theme : defaults.theme,
      density: ["comfortable", "compact"].includes(source.density) ? source.density : defaults.density,
      accent: validHex(source.accent) ? source.accent.toUpperCase() : defaults.accent,
      fontScale: clamp(Number(source.fontScale), 90, 125, defaults.fontScale),
      reducedMotion: source.reducedMotion === true,
      tabPosition: ["left", "top"].includes(source.tabPosition) ? source.tabPosition : defaults.tabPosition,
      displayName: normalizeLabel(source.displayName, productName, 80),
      appearanceOverrides: source.appearanceOverrides && typeof source.appearanceOverrides === "object" ? source.appearanceOverrides : {},
      tabOverrides: source.tabOverrides && typeof source.tabOverrides === "object" ? source.tabOverrides : {},
      pinnedTabs: Array.isArray(source.pinnedTabs)
        ? [...new Set(source.pinnedTabs.filter((value) => typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)))].slice(0, 32)
        : Array.isArray(defaults.pinnedTabs) ? defaults.pinnedTabs : []
    };
  }

  function effectiveSettings(settings) {
    const school = settings?.schoolMode?.enabled === true;
    return {
      language: school ? "en" : settings.language,
      funnyEn: school ? 1 : settings.funnyEn,
      funnyYue: school ? 1 : settings.funnyYue,
      showEmojis: school ? false : settings.showEmojis,
      schoolMode: school
    };
  }

  function filterSchoolCopy(value, settings, modeName) {
    const text = String(value ?? "");
    if (settings?.schoolMode?.enabled !== true) return text;
    return text
      .replace(/[\u3400-\u9fff]/g, "")
      .replace(/\b(Cantonese|bilingual|funny|playful|dim[\s-]?sum|emoji|surprise|School mode)\b/gi, (match) => match.toLocaleLowerCase() === "school mode" ? modeName : "English-only")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  global.MDM_SITE_SETTINGS_CONTRACT = Object.freeze({
    normalizeLabel,
    normalizeSettingsRecord,
    effectiveSettings,
    filterSchoolCopy
  });
})(typeof window === "object" ? window : globalThis);
