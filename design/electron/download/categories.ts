import path from "node:path";
import type { DownloadCategory } from "../../shared/types";

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
