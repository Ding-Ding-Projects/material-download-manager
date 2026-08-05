// Small, pure formatting helpers used across the renderer UI.
// Kept dependency free so they're trivially testable / tree-shakeable.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Trim a fixed-point number string down to at most 2 decimals, dropping a
 * trailing ".00" / trailing zero (e.g. "245.30" -> "245.3", "1.70" -> "1.7"). */
function trimDecimals(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Formats a byte count like "927.43 MB" / "1.14 GB" / "512 B". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "Unknown";
  if (bytes < 0) bytes = 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${trimDecimals(value, 2)} ${BYTE_UNITS[unitIndex]}`;
}

/** Formats a speed like "4.91 MB/s". */
export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Formats a duration in seconds like "2 m 22 s left" / "1 h 5 m left" / "45 s left". */
export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) return `${hours} h ${minutes} m left`;
  if (minutes > 0) return `${minutes} m ${secs} s left`;
  return `${secs} s left`;
}

/** Formats a plain duration (no "left" suffix) like "2 m 22 s". */
export function formatDuration(seconds: number | null | undefined): string {
  const withLeft = formatEta(seconds);
  return withLeft ? withLeft.replace(/\s*left$/, "") : "";
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Formats a timestamp like "14 hours ago" / "2 days ago" / "just now". */
export function formatRelativeTime(timestampMs: number | null | undefined): string {
  if (!timestampMs) return "";
  const diff = Date.now() - timestampMs;
  if (diff < 0) return "just now";
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < WEEK) {
    const d = Math.floor(diff / DAY);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  if (diff < MONTH) {
    const w = Math.floor(diff / WEEK);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  if (diff < YEAR) {
    const mo = Math.floor(diff / MONTH);
    return `${mo} month${mo === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(diff / YEAR);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** Percentage (0-100, rounded) of downloaded/total, or null if unknown. */
export function percentOf(downloaded: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}
