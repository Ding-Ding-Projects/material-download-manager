import type { DownloadItem } from "../../shared/types";
import { URL } from "node:url";

/**
 * Headers are deliberately kept out of DownloadItem/StateSnapshot so they are
 * never sent to the renderer. They are still persisted beside the item in the
 * main-process state file, where the next transfer can reuse them.
 */
export type StoredDownloadItem = DownloadItem & {
  headers?: Record<string, string>;
};

const FORBIDDEN_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "set-cookie",
]);

/** Clone only string header pairs; never log or stringify their values. */
export function cloneRequestHeaders(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name && typeof value === "string" && !FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) {
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

/**
 * Keep ordinary custom headers on same-origin redirects, but never forward
 * credentials or cookie material to another origin. The initial URL is used
 * as the trust boundary so a redirect chain cannot regain those headers by
 * bouncing back to the original host.
 */
export function headersForTarget(
  headers: Record<string, string> | undefined,
  initialUrl: string,
  targetUrl: string
): Record<string, string> | undefined {
  const copy = cloneRequestHeaders(headers);
  if (!copy) return undefined;

  let initialOrigin: string;
  let targetOrigin: string;
  try {
    initialOrigin = new URL(initialUrl).origin;
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return copy;
  }

  if (initialOrigin === targetOrigin) return copy;

  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(copy)) {
    if (CROSS_ORIGIN_SENSITIVE_HEADERS.has(name.toLowerCase())) continue;
    Object.defineProperty(filtered, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
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
