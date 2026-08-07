import type { DownloadItem, StateSnapshot } from "./types";

export const PROGRESS_WINDOW_QUERY_KEY = "progressItem";

export function progressWindowQuery(itemId: string): string {
  return `?${PROGRESS_WINDOW_QUERY_KEY}=${encodeURIComponent(itemId)}`;
}

export function readProgressWindowItemId(search: string): string | null {
  try {
    const itemId = new URLSearchParams(search).get(PROGRESS_WINDOW_QUERY_KEY)?.trim();
    return itemId || null;
  } catch {
    return null;
  }
}

export function findProgressItem(snapshot: StateSnapshot | null, itemId: string | null): DownloadItem | null {
  if (!snapshot || !itemId) return null;
  return snapshot.items.find((item) => item.id === itemId) ?? null;
}
