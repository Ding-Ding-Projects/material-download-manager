import type { DownloadItem } from "../../shared/types";

/**
 * Headers are deliberately kept out of DownloadItem/StateSnapshot so they are
 * never sent to the renderer. They are still persisted beside the item in the
 * main-process state file, where the next transfer can reuse them.
 */
export type StoredDownloadItem = DownloadItem & {
  headers?: Record<string, string>;
};

/** Clone only string header pairs; never log or stringify their values. */
export function cloneRequestHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name && typeof value === "string") {
      Object.defineProperty(copy, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  return Object.keys(copy).length > 0 ? copy : undefined;
}

export function withStoredHeaders(
  item: DownloadItem,
  headers: Record<string, string> | undefined
): StoredDownloadItem {
  const copy = cloneRequestHeaders(headers);
  return copy ? { ...item, headers: copy } : item;
}

export function splitStoredDownload(item: StoredDownloadItem): {
  item: DownloadItem;
  headers?: Record<string, string>;
} {
  const { headers, ...download } = item;
  return { item: download, headers: cloneRequestHeaders(headers) };
}
