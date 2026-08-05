import type { DownloadCategory } from "@shared/types";

// Renderer-local mirror of electron/download/categories.ts. Kept separate
// (and Node-free, no `path` import) so the renderer bundle stays self
// contained; the main process performs the authoritative categorization.
const CATEGORY_EXTENSIONS: Record<Exclude<DownloadCategory, "other">, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "heic", "avif"],
  music: ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff"],
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp"],
  apps: ["exe", "msi", "msix", "appx", "apk", "deb", "rpm", "dmg", "pkg", "bat", "sh"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "odt", "epub"],
  compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"],
};

export function detectCategory(fileName: string): DownloadCategory {
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.includes(ext)) return category as DownloadCategory;
  }
  return "other";
}

export const CATEGORY_LABELS: Record<DownloadCategory, string> = {
  image: "Image",
  music: "Music",
  video: "Video",
  apps: "Apps",
  document: "Document",
  compressed: "Compressed",
  other: "Other",
};

export const CATEGORY_ORDER: DownloadCategory[] = [
  "image",
  "music",
  "video",
  "apps",
  "document",
  "compressed",
  "other",
];
