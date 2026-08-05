import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import path from "node:path";
import type { NewDownloadInfo } from "../../shared/types";

const MAX_REDIRECTS = 10;
const MAX_FILENAME_LENGTH = 255;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function pickClient(u: URL) {
  return u.protocol === "http:" ? http : https;
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
  redirectsLeft = MAX_REDIRECTS
): Promise<NewDownloadInfo> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }
    const client = pickClient(target);
    const req = client.request(
      target,
      {
        method: "HEAD",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MaterialDownloadManager/0.1)",
          ...headers,
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
          resolve(probeUrl(nextUrl, headers, redirectsLeft - 1));
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
          url: target.toString(),
          suggestedFileName: sanitizeFileName(suggested),
          contentLength: Number.isFinite(contentLength) ? contentLength : null,
          resumeSupport,
          contentType: res.headers["content-type"] ?? null,
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Probe request timed out")));
    req.end();
  });
}
