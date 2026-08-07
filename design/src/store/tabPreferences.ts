import {
  createDefaultTabState,
  normalizeTabState,
  type TabState,
} from "@shared/tabModel";

export const TAB_STATE_STORAGE_KEY = "material-download-manager.tab-state.v1";

export function loadTabState(): TabState {
  if (typeof window === "undefined") return createDefaultTabState();
  try {
    const raw = window.localStorage.getItem(TAB_STATE_STORAGE_KEY);
    return raw ? normalizeTabState(JSON.parse(raw)) : createDefaultTabState();
  } catch {
    return createDefaultTabState();
  }
}

export function saveTabState(state: TabState): void {
  try {
    window.localStorage.setItem(TAB_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Renderer-only convenience state must never make the app unusable when
    // storage is unavailable or full.
  }
}
