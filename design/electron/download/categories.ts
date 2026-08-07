import path from "node:path";
import type { AutoOrganizeRule, DownloadCategory } from "../../shared/types";
import { AUTO_ORGANIZE_FOLDERS } from "../../shared/types";
import { evaluateRegex } from "../../shared/regex";

// Extension -> category mapping, ported from the categorization rules used by
// AB Download Manager (shared/config DefaultCategories).
const CATEGORY_EXTENSIONS: Record<Exclude<DownloadCategory, "other">, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "heic", "avif"],
  music: ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp"],
  apps: ["exe", "msi", "msix", "appx", "apk", "deb", "rpm", "dmg", "pkg", "bat", "sh"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "epub"],
  compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"],
};

export function detectCategory(fileName: string): DownloadCategory {
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.includes(ext)) return category as DownloadCategory;
  }
  return "other";
}

/**
 * Resolve a download's category with the user's custom regex filters taking
 * precedence over the built-in extension mapping. Rules run in list order
 * against the file name first and then the source URL, under the shared
 * bounded regex evaluator; the first match wins. An invalid pattern never
 * throws here — it simply matches nothing, because the settings edge already
 * rejects invalid rules and a stale stored rule must not break adding
 * downloads.
 */
export function resolveCategory(
  fileName: string,
  url: string,
  rules: readonly AutoOrganizeRule[]
): DownloadCategory {
  for (const rule of rules) {
    for (const sample of [fileName, url]) {
      const evaluation = evaluateRegex(rule.pattern, rule.flags, sample);
      if (!evaluation.error && evaluation.matches.length > 0) return rule.category;
    }
  }
  return detectCategory(fileName);
}

/** The on-disk folder name a category organizes into. */
export function categoryFolderName(category: DownloadCategory): string {
  return AUTO_ORGANIZE_FOLDERS[category] ?? AUTO_ORGANIZE_FOLDERS.other;
}

function normalizeFolderPath(value: string): string {
  const resolved = path.resolve(value.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Decide the destination folder for a new download. Auto-organize routes into
 * a category subfolder only when the caller left the folder empty or chose
 * exactly the default save folder; an explicit different folder is always
 * honored as-is.
 */
export function resolveDownloadFolder(
  requestedFolder: string,
  defaultSaveFolder: string,
  category: DownloadCategory,
  autoOrganizeEnabled: boolean
): string {
  const base = requestedFolder || defaultSaveFolder;
  if (!autoOrganizeEnabled) return base;
  if (requestedFolder && normalizeFolderPath(requestedFolder) !== normalizeFolderPath(defaultSaveFolder)) {
    return requestedFolder;
  }
  return path.join(defaultSaveFolder, categoryFolderName(category));
}
