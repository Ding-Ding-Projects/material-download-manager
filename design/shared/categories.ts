import type { AutoOrganizeRule, DownloadCategory } from "./types";
import { evaluateRegex } from "./regex";

// Extension -> category mapping, ported from the categorization rules used by
// AB Download Manager (shared/config DefaultCategories). This pure module is
// shared by the renderer preview and the main-process download path so the two
// surfaces cannot disagree about rule precedence.
const CATEGORY_EXTENSIONS: Record<Exclude<DownloadCategory, "other">, readonly string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "heic", "avif"],
  music: ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp"],
  apps: ["exe", "msi", "msix", "appx", "apk", "deb", "rpm", "dmg", "pkg", "bat", "sh"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "epub"],
  compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"],
};

export function detectCategory(fileName: string): DownloadCategory {
  const baseName = fileName.split(/[\\/]/u).at(-1) ?? fileName;
  const dot = baseName.lastIndexOf(".");
  const extension = dot > 0 && dot < baseName.length - 1 ? baseName.slice(dot + 1).toLowerCase() : "";
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.includes(extension)) return category as DownloadCategory;
  }
  return "other";
}

/**
 * Resolve custom rules in stable list order before the built-in extension
 * mapping. The Electron manager calls this inside a terminable worker; the
 * renderer preview reaches this function only through the main-process worker.
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
