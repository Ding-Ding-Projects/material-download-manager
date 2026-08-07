import { useSyncExternalStore } from "react";
import { APP_DISPLAY_NAME_MAX_LENGTH } from "@shared/settings";

export const DEFAULT_DISPLAY_NAME = "Material Download Manager";
export const DISPLAY_NAME_STORAGE_KEY = "material-download-manager.display-name";
const DISPLAY_NAME_EVENT = "mdm:display-name-changed";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeDisplayName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, APP_DISPLAY_NAME_MAX_LENGTH);
  return normalized || DEFAULT_DISPLAY_NAME;
}

export function readDisplayName(): string {
  const value = storage()?.getItem(DISPLAY_NAME_STORAGE_KEY);
  return value ? normalizeDisplayName(value) : DEFAULT_DISPLAY_NAME;
}

function notifyChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DISPLAY_NAME_EVENT));
}

export function saveDisplayName(value: string): string {
  const normalized = normalizeDisplayName(value);
  const store = storage();
  try {
    if (normalized === DEFAULT_DISPLAY_NAME) store?.removeItem(DISPLAY_NAME_STORAGE_KEY);
    else store?.setItem(DISPLAY_NAME_STORAGE_KEY, normalized);
  } catch {
    // A read-only storage implementation must not prevent the settings dialog
    // from saving the IPC-backed application settings.
  }
  notifyChange();
  return normalized;
}

export function resetDisplayName(): void {
  try {
    storage()?.removeItem(DISPLAY_NAME_STORAGE_KEY);
  } catch {
    // See saveDisplayName: display-name persistence is best effort and local.
  }
  notifyChange();
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(DISPLAY_NAME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(DISPLAY_NAME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useDisplayName(): string {
  return useSyncExternalStore(subscribe, readDisplayName, () => DEFAULT_DISPLAY_NAME);
}
