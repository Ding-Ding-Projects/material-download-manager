import fsp from "node:fs/promises";
import path from "node:path";
import {
  CONVERTER_SNIFF_BYTES,
  type ConverterDetection,
  type ConverterPreview,
} from "../../shared/converter";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.length <= bytes.length && signature.every((value, index) => bytes[index] === value);
}

function printableText(text: string): boolean {
  if (text.length === 0) return true;
  let printable = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || code >= 32) printable += 1;
  }
  return printable / text.length >= 0.95;
}

function textWithoutBom(bytes: Uint8Array): Uint8Array {
  return startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
}

function detectText(bytes: Uint8Array): ConverterDetection | null {
  try {
    const text = UTF8_DECODER.decode(textWithoutBom(bytes));
    const trimmed = text.trim();
    if (!printableText(text)) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      // The sniff window intentionally stops at CONVERTER_SNIFF_BYTES.  A
      // larger valid JSON document is therefore commonly incomplete here and
      // cannot be parsed yet.  Classify the prefix as a JSON candidate so its
      // bounded worker adapters remain selectable; those workers re-parse the
      // whole bounded source before they write anything.
      return { kind: "json", label: "JSON candidate", evidence: "bounded-text-inspection" };
    }
    if (trimmed.length >= 4 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/\s]+={0,2}$/u.test(trimmed)) {
      const normalized = trimmed.replace(/\s/gu, "");
      try {
        const decoded = Buffer.from(normalized, "base64");
        if (decoded.length > 0 && decoded.toString("base64") === normalized) {
          return { kind: "base64-text", label: "Base64 text", evidence: "bounded-text-inspection" };
        }
      } catch {
        // Deliberately retain the generic text classification below.
      }
    }
    return { kind: "utf8-text", label: "UTF-8 text", evidence: "bounded-text-inspection" };
  } catch {
    return null;
  }
}

function previewFor(bytes: Uint8Array, detection: ConverterDetection, sourceSize: number): ConverterPreview {
  const previewBytes = bytes.subarray(0, Math.min(bytes.length, 1_536));
  const sourceWasTruncated = sourceSize > bytes.length;
  if (detection.evidence === "bounded-text-inspection") {
    try {
      const decoded = UTF8_DECODER.decode(textWithoutBom(previewBytes));
      const cleaned = decoded.replace(/[^\t\n\r\x20-\u{10FFFF}]/gu, "");
      const text = [...cleaned].slice(0, 1_024).join("");
      return {
        kind: "text",
        summary: `${detection.label} preview from the first bounded bytes`,
        text,
        truncated: sourceWasTruncated || text.length < cleaned.length,
      };
    } catch {
      // A preview is optional and must never downgrade a successful signature
      // classification or cause an unbounded retry.
    }
  }
  const prefix = Buffer.from(previewBytes.subarray(0, 32)).toString("hex").match(/.{1,2}/gu)?.join(" ") ?? "";
  return {
    kind: "bytes",
    summary: `${detection.label} byte prefix${prefix ? `: ${prefix}` : ""}`,
    text: null,
    truncated: sourceWasTruncated || bytes.length > 32,
  };
}

/**
 * Detect from bounded bytes only.  Extensions are deliberately not used for
 * capability decisions; an XLSX-like ZIP is labelled as a ZIP until a bundled
 * spreadsheet adapter can inspect its internal records safely.
 */
export function sniffConverterBytes(bytes: Uint8Array): ConverterDetection {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf", label: "PDF document", evidence: "signature" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png", label: "PNG image", evidence: "signature" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg", label: "JPEG image", evidence: "signature" };
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WAVE") {
    return { kind: "wav", label: "WAV audio", evidence: "signature" };
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp") return { kind: "mp4", label: "MP4 media", evidence: "signature" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) {
    return { kind: "zip", label: "ZIP-compatible archive", evidence: "signature" };
  }
  return detectText(bytes) ?? { kind: "binary", label: "Unknown binary", evidence: "unknown" };
}

export async function sniffConverterFile(filePath: string): Promise<{ detection: ConverterDetection; preview: ConverterPreview; sizeBytes: number; sourceName: string }> {
  const sourceName = path.basename(filePath);
  if (!sourceName || /[\\/\0\r\n]/u.test(sourceName)) throw new Error("The selected source name is unsafe.");
  const link = await fsp.lstat(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw new Error("The selected source must be a regular file, not a link.");
  const handle = await fsp.open(filePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("The selected source must be a regular file.");
    const length = Math.min(stats.size, CONVERTER_SNIFF_BYTES);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    const inspected = bytes.subarray(0, bytesRead);
    const detection = sniffConverterBytes(inspected);
    return { detection, preview: previewFor(inspected, detection, stats.size), sizeBytes: stats.size, sourceName };
  } finally {
    await handle.close();
  }
}
