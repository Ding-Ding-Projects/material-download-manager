/**
 * Public, non-sensitive logo configuration. Image bytes, original file names,
 * original paths, and generated cache paths deliberately do not occur here.
 * The main-process logo service owns those private details.
 */
export const APP_LOGO_SCHEMA_VERSION = 1 as const;
export const APP_LOGO_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const APP_LOGO_MAX_DIMENSION = 8_192;
export const APP_LOGO_MAX_PIXELS = 16 * 1024 * 1024;
/** A decoded RGBA frame cannot exceed this allocation budget. */
export const APP_LOGO_MAX_DECODED_BYTES = APP_LOGO_MAX_PIXELS * 4;
export const APP_LOGO_MAX_VARIANTS = 8;
export const APP_LOGO_MAX_VARIANT_BYTES = 512 * 1024;
export const APP_LOGO_MAX_TOTAL_VARIANT_BYTES = APP_LOGO_MAX_VARIANTS * APP_LOGO_MAX_VARIANT_BYTES;
export const APP_LOGO_MAX_PREVIEW_DATA_URL_LENGTH = 700_000;

export const APP_LOGO_PRESETS = ["material", "orbit", "stack"] as const;
export type AppLogoPreset = (typeof APP_LOGO_PRESETS)[number];
export type AppLogoSource = "preset" | "custom";
export type AppLogoFit = "contain" | "cover" | "fill";
export type AppLogoBackground = "transparent" | "color";

export interface AppLogoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppLogoFocalPoint {
  x: number;
  y: number;
}

/**
 * This is persisted in ordinary application settings. It contains no source
 * path, image bytes, decoder metadata, or cache file name.
 */
export interface AppLogoSettings {
  schemaVersion: typeof APP_LOGO_SCHEMA_VERSION;
  source: AppLogoSource;
  preset: AppLogoPreset;
  fit: AppLogoFit;
  crop: AppLogoCrop;
  focalPoint: AppLogoFocalPoint;
  background: AppLogoBackground;
  backgroundColor: string;
}

/** Renderer-safe description of the active display asset. */
export interface AppLogoSnapshot {
  settings: AppLogoSettings;
  /** A custom cache never becomes active until the decoder generated it. */
  activeSource: AppLogoSource;
  /** Derived 128px PNG only. Original bytes and paths are never exposed. */
  previewDataUrl: string | null;
  status: "ready" | "custom-cache-missing";
}

export const DEFAULT_APP_LOGO_SETTINGS: AppLogoSettings = {
  schemaVersion: APP_LOGO_SCHEMA_VERSION,
  source: "preset",
  preset: "material",
  fit: "contain",
  crop: { x: 0, y: 0, width: 1, height: 1 },
  focalPoint: { x: 0.5, y: 0.5 },
  background: "transparent",
  backgroundColor: "#16171d",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isAppLogoPreset(value: unknown): value is AppLogoPreset {
  return typeof value === "string" && (APP_LOGO_PRESETS as readonly string[]).includes(value);
}

export function isAppLogoCrop(value: unknown): value is AppLogoCrop {
  if (!isRecord(value) || !hasExactKeys(value, ["x", "y", "width", "height"])) return false;
  return isUnitNumber(value.x)
    && isUnitNumber(value.y)
    && typeof value.width === "number"
    && Number.isFinite(value.width)
    && value.width >= 0.05
    && value.width <= 1
    && typeof value.height === "number"
    && Number.isFinite(value.height)
    && value.height >= 0.05
    && value.height <= 1
    && value.x + value.width <= 1
    && value.y + value.height <= 1;
}

export function isAppLogoFocalPoint(value: unknown): value is AppLogoFocalPoint {
  return isRecord(value)
    && hasExactKeys(value, ["x", "y"])
    && isUnitNumber(value.x)
    && isUnitNumber(value.y);
}

export function isAppLogoSettings(value: unknown): value is AppLogoSettings {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "source", "preset", "fit", "crop", "focalPoint", "background", "backgroundColor"])) {
    return false;
  }
  return value.schemaVersion === APP_LOGO_SCHEMA_VERSION
    && (value.source === "preset" || value.source === "custom")
    && isAppLogoPreset(value.preset)
    && (value.fit === "contain" || value.fit === "cover" || value.fit === "fill")
    && isAppLogoCrop(value.crop)
    && isAppLogoFocalPoint(value.focalPoint)
    && (value.background === "transparent" || value.background === "color")
    && isHexColor(value.backgroundColor);
}

export function isAppLogoSnapshot(value: unknown): value is AppLogoSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ["settings", "activeSource", "previewDataUrl", "status"])) return false;
  return isAppLogoSettings(value.settings)
    && (value.activeSource === "preset" || value.activeSource === "custom")
    && (value.previewDataUrl === null || (typeof value.previewDataUrl === "string"
      && value.previewDataUrl.length <= APP_LOGO_MAX_PREVIEW_DATA_URL_LENGTH
      && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.previewDataUrl)))
    && (value.status === "ready" || value.status === "custom-cache-missing");
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(value);
}

export function cloneAppLogoSettings(value: AppLogoSettings): AppLogoSettings {
  return {
    schemaVersion: APP_LOGO_SCHEMA_VERSION,
    source: value.source,
    preset: value.preset,
    fit: value.fit,
    crop: { ...value.crop },
    focalPoint: { ...value.focalPoint },
    background: value.background,
    backgroundColor: value.backgroundColor.toLowerCase(),
  };
}
