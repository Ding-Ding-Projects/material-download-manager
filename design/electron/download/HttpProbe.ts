import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import path from "node:path";
import type { NewDownloadInfo } from "../../shared/types";
import { headersForTarget } from "./downloadMetadata";

const MAX_REDIRECTS = 10;
const MAX_FILENAME_LENGTH = 255;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const REDACTED_URL_COMPONENT = "[REDACTED]";
const URL_LIKE_TEXT = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi;

function pickClient(u: URL) {
  return u.protocol === "http:" ? http : https;
}

function searchHasValue(search: string): boolean {
  return search.length > 1;
}

/** Keep parameter names as useful diagnostics while never retaining values. */
function redactSearch(search: string): string {
  if (!search || search === "?") return search;
  return (
    "?" +
    search
      .slice(1)
      .split("&")
      .map((part) => {
        const equals = part.indexOf("=");
        return equals < 0 ? REDACTED_URL_COMPONENT : `${part.slice(0, equals)}=${REDACTED_URL_COMPONENT}`;
      })
      .join("&")
  );
}

function redactMalformedUrl(input: string): string {
  let safe = input;
  const authority = /^(([a-z][a-z\d+.-]*:)?\/\/)([^/?#]*)([\s\S]*)$/i.exec(safe);
  if (authority) {
    const at = authority[3].lastIndexOf("@");
    if (at >= 0) {
      safe = `${authority[1]}${REDACTED_URL_COMPONENT}@${authority[3].slice(at + 1)}${authority[4]}`;
    }
  }

  const hashIndex = safe.indexOf("#");
  const withoutHash = hashIndex >= 0 ? safe.slice(0, hashIndex) : safe;
  const hash = hashIndex >= 0 ? safe.slice(hashIndex) : "";
  const safeHash = hash.length > 1 ? `#${REDACTED_URL_COMPONENT}` : hash;
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex >= 0) {
    safe = `${withoutHash.slice(0, queryIndex)}${redactSearch(withoutHash.slice(queryIndex))}${safeHash}`;
  } else if (hashIndex >= 0 && hash.length > 1) {
    safe = `${withoutHash}${safeHash}`;
  }
  return safe;
}

/**
 * Redact URL components that can carry credentials or bearer material while
 * retaining the scheme, host, path and parameter names for diagnostics.
 * Malformed input uses a conservative string fallback so the error path is
 * safe even when URL parsing itself fails.
 */
export function redactUrl(value: string): string {
  const input = String(value);
  try {
    const parsed = new URL(input);
    const hasUserInfo = parsed.username.length > 0 || parsed.password.length > 0;
    const hasQueryValues = searchHasValue(parsed.search);
    const hasFragment = parsed.hash.length > 1;
    if (!hasUserInfo && !hasQueryValues && !hasFragment) return input;

    const authority = parsed.host
      ? `${parsed.protocol}//${hasUserInfo ? `${REDACTED_URL_COMPONENT}@` : ""}${parsed.host}`
      : parsed.protocol;
    const search = hasQueryValues ? redactSearch(parsed.search) : parsed.search;
    const hash = hasFragment ? `#${REDACTED_URL_COMPONENT}` : parsed.hash;
    return `${authority}${parsed.pathname}${search}${hash}`;
  } catch {
    return redactMalformedUrl(input);
  }
}

/** Return an error string with any supplied or embedded URL safely redacted. */
export function redactErrorMessage(error: unknown, ...contextUrls: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const contextUrl of contextUrls) {
    const raw = String(contextUrl);
    if (!raw) continue;
    const safe = redactUrl(raw);
    if (safe !== raw) message = message.split(raw).join(safe);
  }
  return message.replace(URL_LIKE_TEXT, (candidate) => redactUrl(candidate));
}

function filenameFromContentDisposition(header: string | undefined): string | null {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename="?([^";]+)"?/i.exec(header);
  if (quoted) return quoted[1];
  return null;
}

/** Keep a server- or user-supplied name to one safe Windows path segment. */
export function sanitizeFileName(input: string): string {
  const cleaned = input
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, MAX_FILENAME_LENGTH);
  if (!cleaned || cleaned === "." || cleaned === "..") return "download";
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    return base && base !== "/" ? sanitizeFileName(decodeURIComponent(base)) : "download";
  } catch {
    return "download";
  }
}

/**
 * Issues a HEAD request (falling back to a ranged GET if HEAD is rejected) to
 * discover file size, resume support (Accept-Ranges) and suggested filename,
 * without downloading the body.
 */
export function probeUrl(
  url: string,
  headers: Record<string, string> = {},
  redirectsLeft = MAX_REDIRECTS,
  initialUrl = url
): Promise<NewDownloadInfo> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${redactUrl(url)}`));
      return;
    }
    const client = pickClient(target);
    const req = client.request(
      target,
      {
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MaterialDownloadManager/0.1)",
          ...headersForTarget(headers, initialUrl, target.toString()),
        },
      },
      (res) => {
        res.resume(); // discard body
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects"));
            return;
          }
          const nextUrl = new URL(res.headers.location, target).toString();
          resolve(probeUrl(nextUrl, headers, redirectsLeft - 1, initialUrl));
          return;
        }
        if (status >= 400) {
          reject(new Error(`Server responded with ${status}`));
          return;
        }
        const contentLengthHeader = res.headers["content-length"];
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
        const acceptRanges = (res.headers["accept-ranges"] ?? "").toLowerCase();
        const resumeSupport = acceptRanges === "bytes";
        const suggested =
          filenameFromContentDisposition(res.headers["content-disposition"]) ??
          filenameFromUrl(target.toString());
        resolve({
          url: redactUrl(target.toString()),
          suggestedFileName: sanitizeFileName(suggested),
          contentLength: Number.isFinite(contentLength) ? contentLength : null,
          resumeSupport,
          contentType: res.headers["content-type"] ?? null,
        });
      }
    );
    req.on("error", (error) => reject(new Error(redactErrorMessage(error, url))));
    req.setTimeout(15000, () => req.destroy(new Error("Probe request timed out")));
    req.end();
  });
}

/**
 * Prove that a credential-free GET can read the source before a browser
 * takeover is accepted. A server that exposes HEAD but rejects GET is not a
 * usable download source. The response is bounded to the first body chunk.
 */
export function proveDownloadReadable(
  url: string,
  headers: Record<string, string> = {},
  redirectsLeft = MAX_REDIRECTS,
  initialUrl = url
): Promise<void> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${redactUrl(url)}`));
      return;
    }

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const client = pickClient(target);
    const req = client.request(
      target,
      {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MaterialDownloadManager/0.1)",
          ...headersForTarget(headers, initialUrl, target.toString()),
          Range: "bytes=0-0",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            finish(new Error("Too many redirects"));
            return;
          }
          const nextUrl = new URL(res.headers.location, target).toString();
          settled = true;
          resolve(proveDownloadReadable(nextUrl, headers, redirectsLeft - 1, initialUrl));
          return;
        }
        if (status !== 200 && status !== 206) {
          res.resume();
          finish(new Error(`Server responded with ${status} to the download GET`));
          return;
        }
        res.once("data", (chunk: Buffer) => {
          if (chunk.length > 0) {
            finish();
            res.destroy();
          }
        });
        res.once("end", () => finish());
        res.once("error", (error) => finish(new Error(redactErrorMessage(error, url))));
      }
    );
    req.on("error", (error) => finish(new Error(redactErrorMessage(error, url))));
    req.setTimeout(15000, () => req.destroy(new Error("Download-readiness request timed out")));
    req.end();
  });
}
