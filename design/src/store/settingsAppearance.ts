import type { AppSettings, UIFontFamily, SettingKey } from "@shared/types";

export const UI_FONT_STACKS: Record<UIFontFamily, string> = {
  "segoe-ui": '"Segoe UI", "Inter", system-ui, sans-serif',
  inter: '"Inter", "Segoe UI", system-ui, sans-serif',
  "cascadia-code": '"Cascadia Code", "Segoe UI", monospace',
  system: 'system-ui, "Segoe UI", sans-serif',
};

export function applyAppearanceSettings(settings: AppSettings): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-density", settings.density);
  root.style.setProperty("--accent-seed", settings.accentSeedColor);
  root.style.setProperty("--ui-font-family", UI_FONT_STACKS[settings.uiFontFamily]);
  root.style.setProperty("--ui-font-size", `${settings.uiFontSize}px`);
  root.style.setProperty("--ui-font-weight", String(settings.uiFontWeight));
}

export function settingSourceLabel(settings: AppSettings, key: SettingKey, compiledValue: string): string {
  return settings.settingProvenance[key] === "persisted"
    ? "Source: persisted value"
    : `Source: compiled-in value (${compiledValue})`;
}
