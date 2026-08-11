import { DEFAULT_APP_DISPLAY_NAME, normalizeAppDisplayName } from "@shared/settings";

/** Legacy renderer storage key kept only for one-time migration. */
export const DISPLAY_NAME_STORAGE_KEY = "material-download-manager.display-name";
export const DEFAULT_DISPLAY_NAME = DEFAULT_APP_DISPLAY_NAME;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeDisplayName(value: string): string {
  return normalizeAppDisplayName(value);
}

/** Read the pre-IPC renderer value without making it authoritative. */
export function readLegacyDisplayName(): string | null {
  const value = storage()?.getItem(DISPLAY_NAME_STORAGE_KEY);
  if (!value) return null;
  const normalized = normalizeDisplayName(value);
  return normalized === DEFAULT_DISPLAY_NAME ? null : normalized;
}

/** Remove the legacy renderer value only after main-process migration succeeds. */
export function clearLegacyDisplayName(): void {
  try {
    storage()?.removeItem(DISPLAY_NAME_STORAGE_KEY);
  } catch {
    // A locked-down profile can keep the stale key; the canonical value is already in main state.
  }
}
