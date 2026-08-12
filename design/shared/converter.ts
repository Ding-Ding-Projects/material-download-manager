import { exportRecords, isExportFormat, type ExportFormat, type ExportResult } from "./export";

/**
 * The converter deliberately exposes a small, explicit registry instead of
 * treating an executable on PATH or an online service as a capability.  A
 * registry entry is rendered even when it is unavailable so the UI can explain
 * the exact boundary rather than presenting a false target-format picker.
 */
export const CONVERTER_SCHEMA_VERSION = 1 as const;
export const CONVERTER_SNIFF_BYTES = 64 * 1024;
export const CONVERTER_MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const CONVERTER_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const CONVERTER_MAX_PUBLIC_JOBS = 200;
export const CONVERTER_MAX_STAGED_SOURCES = 200;
export const CONVERTER_DEFAULT_CONCURRENCY = 1;

export const CONVERTER_CATEGORIES = [
  "documents-pdf",
  "images",
  "audio",
  "video",
  "archives",
  "structured-data-spreadsheets",
  "code-text",
  "binary-encodings",
] as const;

export type ConverterCategory = (typeof CONVERTER_CATEGORIES)[number];

export const CONVERTER_CATEGORY_LABELS: Record<ConverterCategory, string> = {
  "documents-pdf": "Documents / PDF",
  images: "Images",
  audio: "Audio",
  video: "Video",
  archives: "Archives",
  "structured-data-spreadsheets": "Structured Data / Spreadsheets",
  "code-text": "Code / Text",
  "binary-encodings": "Binary Encodings",
};

export type ConverterDetectedKind =
  | "pdf"
  | "png"
  | "jpeg"
  | "wav"
  | "mp4"
  | "zip"
  | "xlsx"
  | "json"
  | "utf8-text"
  | "base64-text"
  | "binary";

export type ConverterJobStatus = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

export interface ConverterResourceLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxWorkerMemoryMiB: number;
  wallTimeMs: number;
}

export interface ConverterAdapter {
  id: string;
  category: ConverterCategory;
  label: string;
  sourceKinds: readonly ConverterDetectedKind[];
  targetLabel: string;
  targetExtension: string | null;
  outputKind: ConverterDetectedKind | null;
  /** An enabled entry must be bundled and must have a real packaged proof. */
  enabled: boolean;
  bundled: boolean;
  packagedArtifactProof: string | null;
  availabilityReason: string;
  lossiness: "lossless" | "formatting-only" | "lossy" | "unavailable";
  lossDisclosure: string;
  resourceLimits: ConverterResourceLimits;
  sandboxBoundary: string;
  outputValidator: string;
}

const IN_PROCESS_PROOF = "electron/converter/converterWorker.ts compiled into the packaged Electron main-process bundle";

const SAFE_LIMITS: ConverterResourceLimits = {
  maxInputBytes: CONVERTER_MAX_INPUT_BYTES,
  maxOutputBytes: CONVERTER_MAX_OUTPUT_BYTES,
  maxWorkerMemoryMiB: 64,
  wallTimeMs: 30_000,
};

function enabledAdapter(input: Omit<ConverterAdapter, "enabled" | "bundled" | "packagedArtifactProof" | "availabilityReason" | "resourceLimits" | "sandboxBoundary">): ConverterAdapter {
  return {
    ...input,
    enabled: true,
    bundled: true,
    packagedArtifactProof: IN_PROCESS_PROOF,
    availabilityReason: "Bundled locally in the converter worker; no PATH discovery, shell command, or network service is used.",
    resourceLimits: SAFE_LIMITS,
    sandboxBoundary: "Dedicated Node worker thread with a bounded heap, allowlisted adapter id, no child-process launch, and no network client import.",
  };
}

function unavailableAdapter(input: Omit<ConverterAdapter, "enabled" | "bundled" | "packagedArtifactProof" | "availabilityReason" | "lossiness" | "resourceLimits" | "sandboxBoundary" | "outputValidator"> & { reason: string }): ConverterAdapter {
  return {
    ...input,
    enabled: false,
    bundled: false,
    packagedArtifactProof: null,
    availabilityReason: input.reason,
    lossiness: "unavailable",
    resourceLimits: SAFE_LIMITS,
    sandboxBoundary: "Unavailable: no adapter process is started.",
    outputValidator: "Unavailable because no bundled adapter can produce an output to validate.",
  };
}

/**
 * This is a hand-written, exhaustive list of the capabilities this desktop
 * foundation knows about.  Adding an entry is intentionally a code review
 * event: enabled entries must prove their packaged adapter, while unavailable
 * entries remain visible with their precise missing boundary.
 */
export const CONVERTER_ADAPTERS: readonly ConverterAdapter[] = [
  unavailableAdapter({
    id: "pdf-inspect",
    category: "documents-pdf",
    label: "Inspect PDF",
    sourceKinds: ["pdf"],
    targetLabel: "PDF inspection report",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "No PDF parser is bundled, so page count and metadata cannot be reported honestly.",
    reason: "Unavailable: no bundled offline PDF parser has packaged-artifact proof. PATH tools and network services are intentionally ignored.",
  }),
  unavailableAdapter({
    id: "pdf-split",
    category: "documents-pdf",
    label: "Split PDF",
    sourceKinds: ["pdf"],
    targetLabel: "PDF pages",
    targetExtension: "pdf",
    outputKind: "pdf",
    lossDisclosure: "No output can be generated until a bundled parser can reopen and validate page order and count.",
    reason: "Unavailable: no bundled offline PDF split adapter can atomically write and reopen page output for validation.",
  }),
  unavailableAdapter({
    id: "pdf-merge",
    category: "documents-pdf",
    label: "Merge PDF",
    sourceKinds: ["pdf"],
    targetLabel: "Merged PDF",
    targetExtension: "pdf",
    outputKind: "pdf",
    lossDisclosure: "No output can be generated until a bundled parser can validate the requested page sequence.",
    reason: "Unavailable: no bundled offline PDF merge adapter can validate page order, count, rotation, and metadata after writing.",
  }),
  unavailableAdapter({
    id: "pdf-extract",
    category: "documents-pdf",
    label: "Extract PDF content",
    sourceKinds: ["pdf"],
    targetLabel: "Extracted PDF content",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "No text, attachments, or pages are extracted without a bundled parser.",
    reason: "Unavailable: no bundled offline PDF extraction adapter has packaged-artifact proof.",
  }),
  unavailableAdapter({
    id: "pdf-reorder",
    category: "documents-pdf",
    label: "Reorder PDF pages",
    sourceKinds: ["pdf"],
    targetLabel: "Reordered PDF",
    targetExtension: "pdf",
    outputKind: "pdf",
    lossDisclosure: "No output can be generated until a bundled parser can reopen and verify requested ordering.",
    reason: "Unavailable: no bundled offline PDF reorder adapter can validate page order after an atomic write.",
  }),
  unavailableAdapter({
    id: "pdf-rotate",
    category: "documents-pdf",
    label: "Rotate PDF pages",
    sourceKinds: ["pdf"],
    targetLabel: "Rotated PDF",
    targetExtension: "pdf",
    outputKind: "pdf",
    lossDisclosure: "No output can be generated until a bundled parser can reopen and verify rotation metadata.",
    reason: "Unavailable: no bundled offline PDF rotation adapter can validate requested rotations after writing.",
  }),
  unavailableAdapter({
    id: "pdf-metadata",
    category: "documents-pdf",
    label: "Edit PDF metadata",
    sourceKinds: ["pdf"],
    targetLabel: "PDF metadata",
    targetExtension: "pdf",
    outputKind: "pdf",
    lossDisclosure: "No metadata mutation is attempted without a parser that can reopen the resulting document.",
    reason: "Unavailable: no bundled offline PDF metadata adapter can validate a reopened output document.",
  }),
  unavailableAdapter({
    id: "image-transcode",
    category: "images",
    label: "PNG / JPEG image conversion",
    sourceKinds: ["png", "jpeg"],
    targetLabel: "PNG or JPEG image",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "Transparency, color profiles, frames, and pixels remain untouched because no image decoder/encoder is bundled.",
    reason: "Unavailable: no bundled offline image decoder/encoder has packaged-artifact proof. Developer-machine image tools are intentionally ignored.",
  }),
  unavailableAdapter({
    id: "audio-transcode",
    category: "audio",
    label: "WAV / MP3 audio conversion",
    sourceKinds: ["wav"],
    targetLabel: "Audio file",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "Samples, channels, and metadata are left untouched because no audio codec is bundled.",
    reason: "Unavailable: no bundled offline audio codec has packaged-artifact proof. PATH encoders and network services are intentionally ignored.",
  }),
  unavailableAdapter({
    id: "video-transcode",
    category: "video",
    label: "MP4 video conversion",
    sourceKinds: ["mp4"],
    targetLabel: "Video file",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "Frames, audio tracks, captions, and metadata are left untouched because no video codec is bundled.",
    reason: "Unavailable: no bundled offline video codec has packaged-artifact proof. PATH encoders and network services are intentionally ignored.",
  }),
  unavailableAdapter({
    id: "archive-zip",
    category: "archives",
    label: "ZIP archive tools",
    sourceKinds: ["zip", "xlsx"],
    targetLabel: "Archive output",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "Archive entries are not inspected, extracted, or repacked without a bounded bundled archive adapter.",
    reason: "Unavailable: no bundled offline archive adapter has packaged-artifact proof for safe inspection, extraction, or creation.",
  }),
  enabledAdapter({
    id: "structured-json-pretty",
    category: "structured-data-spreadsheets",
    label: "Format JSON",
    sourceKinds: ["json"],
    targetLabel: "Indented JSON",
    targetExtension: "json",
    outputKind: "json",
    lossiness: "formatting-only",
    lossDisclosure: "The JSON data is parsed and reserialized with two-space indentation. Original whitespace, key ordering supplied by a nonstandard producer, and a byte-order mark are not preserved.",
    outputValidator: "Reopen as strict UTF-8 JSON and compare the parsed data model with the requested input model.",
  }),
  enabledAdapter({
    id: "structured-json-to-csv",
    category: "structured-data-spreadsheets",
    label: "JSON records to CSV",
    sourceKinds: ["json"],
    targetLabel: "CSV table",
    targetExtension: "csv",
    outputKind: "utf8-text",
    lossiness: "lossy",
    lossDisclosure: "Only a top-level JSON array of flat records is accepted. Nested values are rejected; numbers, booleans, and null values are rendered as CSV text.",
    outputValidator: "Reopen strict UTF-8 CSV, parse RFC-4180 quoting, and verify the header and row count against the input records.",
  }),
  unavailableAdapter({
    id: "spreadsheet-xlsx",
    category: "structured-data-spreadsheets",
    label: "XLSX spreadsheet conversion",
    sourceKinds: ["xlsx", "zip"],
    targetLabel: "Spreadsheet output",
    targetExtension: null,
    outputKind: null,
    lossDisclosure: "Cells, formulas, sheets, styles, and macros are not read without a bundled spreadsheet adapter.",
    reason: "Unavailable: no bundled offline spreadsheet adapter can parse and validate XLSX output without relying on developer-machine tooling.",
  }),
  enabledAdapter({
    id: "text-normalize-utf8",
    category: "code-text",
    label: "Normalize UTF-8 text",
    sourceKinds: ["utf8-text", "json"],
    targetLabel: "UTF-8 text with LF line endings",
    targetExtension: "txt",
    outputKind: "utf8-text",
    lossiness: "formatting-only",
    lossDisclosure: "The content remains text, but a byte-order mark and original CRLF or CR line endings are normalized to UTF-8 with LF line endings.",
    outputValidator: "Stream-reopen with a fatal UTF-8 decoder and reject any output containing CR or an invalid byte sequence.",
  }),
  enabledAdapter({
    id: "binary-to-base64",
    category: "binary-encodings",
    label: "Binary to Base64 text",
    sourceKinds: ["pdf", "png", "jpeg", "wav", "mp4", "zip", "xlsx", "json", "utf8-text", "base64-text", "binary"],
    targetLabel: "Base64 text",
    targetExtension: "b64",
    outputKind: "base64-text",
    lossiness: "lossless",
    lossDisclosure: "The original bytes are represented as Base64 text. The output is larger than the input but can be decoded back to identical bytes.",
    outputValidator: "Strictly decode the Base64 output and compare its byte length and SHA-256 digest with the source bytes.",
  }),
  enabledAdapter({
    id: "base64-to-binary",
    category: "binary-encodings",
    label: "Base64 text to binary",
    sourceKinds: ["base64-text"],
    targetLabel: "Decoded binary",
    targetExtension: "bin",
    outputKind: "binary",
    lossiness: "lossless",
    lossDisclosure: "Whitespace is ignored while strict Base64 is decoded. Invalid padding or non-Base64 characters are rejected rather than guessed.",
    outputValidator: "Re-encode the decoded bytes and require an exact canonical Base64 match after whitespace normalization.",
  }),
] as const;

export interface ConverterDetection {
  kind: ConverterDetectedKind;
  label: string;
  evidence: "signature" | "bounded-text-inspection" | "unknown";
}

/**
 * A bounded, renderer-safe local preview. It is intentionally part of the
 * transient source-selection state only: history exports never include it.
 */
export interface ConverterPreview {
  kind: "text" | "bytes";
  summary: string;
  text: string | null;
  truncated: boolean;
}

export interface ConverterStagedSource {
  id: string;
  sourceName: string;
  sizeBytes: number;
  detection: ConverterDetection;
  preview: ConverterPreview;
  compatibleAdapterIds: string[];
}

export interface ConverterJobView {
  id: string;
  sourceName: string;
  destinationName: string;
  adapterId: string;
  status: ConverterJobStatus;
  inputBytes: number;
  processedBytes: number;
  outputBytes: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  retryCount: number;
  outputAvailable: boolean;
}

export interface ConverterState {
  schemaVersion: typeof CONVERTER_SCHEMA_VERSION;
  queuePaused: boolean;
  stagedSources: ConverterStagedSource[];
  jobs: ConverterJobView[];
  hasMoreJobs: boolean;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isSafeName(value: unknown): value is string {
  return boundedString(value, 255) && !/[\\/\0\r\n]/u.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return boundedString(value, 64) && Number.isFinite(Date.parse(value));
}

export function isConverterAdapterId(value: unknown): value is string {
  return typeof value === "string" && CONVERTER_ADAPTERS.some((adapter) => adapter.id === value);
}

export function converterAdapterForId(value: string): ConverterAdapter | null {
  return CONVERTER_ADAPTERS.find((adapter) => adapter.id === value) ?? null;
}

export function compatibleConverterAdapters(detection: ConverterDetection): ConverterAdapter[] {
  return CONVERTER_ADAPTERS.filter((adapter) => adapter.sourceKinds.includes(detection.kind));
}

/** A fail-closed validator that is deliberately tested with invalid mutations. */
export function validateConverterRegistry(registry: readonly ConverterAdapter[] = CONVERTER_ADAPTERS): void {
  if (registry.length === 0) throw new Error("The converter registry is empty");
  const ids = new Set<string>();
  const categories = new Set<ConverterCategory>();
  for (const adapter of registry) {
    if (!boundedString(adapter.id, 128) || !/^[a-z0-9-]+$/u.test(adapter.id) || ids.has(adapter.id)) {
      throw new Error("Converter adapter identifiers must be unique, bounded, and exact");
    }
    ids.add(adapter.id);
    if (!CONVERTER_CATEGORIES.includes(adapter.category)) throw new Error("Converter adapter category is unknown");
    categories.add(adapter.category);
    if (!boundedString(adapter.label, 160) || adapter.sourceKinds.length === 0 || adapter.sourceKinds.some((kind) => typeof kind !== "string")) {
      throw new Error("Converter adapter metadata is incomplete");
    }
    if (adapter.enabled && (!adapter.bundled || !boundedString(adapter.packagedArtifactProof, 512))) {
      throw new Error(`Enabled converter adapter ${adapter.id} lacks bundled packaged-artifact proof`);
    }
    if (!adapter.enabled && (adapter.bundled || adapter.packagedArtifactProof !== null)) {
      throw new Error(`Unavailable converter adapter ${adapter.id} must not claim bundled proof`);
    }
    if (!boundedString(adapter.availabilityReason, 1_024) || !boundedString(adapter.lossDisclosure, 2_048) || !boundedString(adapter.outputValidator, 2_048)) {
      throw new Error("Converter adapter disclosure or validator metadata is missing");
    }
    if (adapter.resourceLimits.maxInputBytes <= 0 || adapter.resourceLimits.maxOutputBytes <= 0 || adapter.resourceLimits.maxWorkerMemoryMiB <= 0 || adapter.resourceLimits.wallTimeMs <= 0) {
      throw new Error("Converter adapter resource limits must be positive");
    }
  }
  for (const category of CONVERTER_CATEGORIES) {
    if (!categories.has(category)) throw new Error(`Converter registry omits required category ${category}`);
  }
}

export function isConverterDetection(value: unknown): value is ConverterDetection {
  return isRecord(value)
    && typeof value.kind === "string"
    && ["pdf", "png", "jpeg", "wav", "mp4", "zip", "xlsx", "json", "utf8-text", "base64-text", "binary"].includes(value.kind)
    && boundedString(value.label, 128)
    && ["signature", "bounded-text-inspection", "unknown"].includes(value.evidence as string);
}

export function isConverterPreview(value: unknown): value is ConverterPreview {
  return isRecord(value)
    && (value.kind === "text" || value.kind === "bytes")
    && boundedString(value.summary, 512)
    && (value.text === null || (typeof value.text === "string" && value.text.length <= 1_024))
    && typeof value.truncated === "boolean";
}

export function isConverterStagedSource(value: unknown): value is ConverterStagedSource {
  return isRecord(value)
    && boundedString(value.id, 128)
    && isSafeName(value.sourceName)
    && typeof value.sizeBytes === "number"
    && Number.isSafeInteger(value.sizeBytes)
    && value.sizeBytes >= 0
    && isConverterDetection(value.detection)
    && isConverterPreview(value.preview)
    && Array.isArray(value.compatibleAdapterIds)
    && value.compatibleAdapterIds.length <= CONVERTER_ADAPTERS.length
    && value.compatibleAdapterIds.every(isConverterAdapterId);
}

export function isConverterJobView(value: unknown): value is ConverterJobView {
  return isRecord(value)
    && boundedString(value.id, 128)
    && isSafeName(value.sourceName)
    && isSafeName(value.destinationName)
    && isConverterAdapterId(value.adapterId)
    && ["queued", "running", "paused", "succeeded", "failed", "cancelled"].includes(value.status as string)
    && typeof value.inputBytes === "number"
    && Number.isSafeInteger(value.inputBytes)
    && value.inputBytes >= 0
    && typeof value.processedBytes === "number"
    && Number.isSafeInteger(value.processedBytes)
    && value.processedBytes >= 0
    && (value.outputBytes === null || (typeof value.outputBytes === "number" && Number.isSafeInteger(value.outputBytes) && value.outputBytes >= 0))
    && (value.error === null || boundedString(value.error, 1_024))
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt)
    && (value.completedAt === null || isIsoTimestamp(value.completedAt))
    && typeof value.retryCount === "number"
    && Number.isSafeInteger(value.retryCount)
    && value.retryCount >= 0
    && value.retryCount <= 100_000
    && typeof value.outputAvailable === "boolean";
}

export function isConverterState(value: unknown): value is ConverterState {
  return isRecord(value)
    && value.schemaVersion === CONVERTER_SCHEMA_VERSION
    && typeof value.queuePaused === "boolean"
    && Array.isArray(value.stagedSources)
    && value.stagedSources.length <= CONVERTER_MAX_STAGED_SOURCES
    && value.stagedSources.every(isConverterStagedSource)
    && Array.isArray(value.jobs)
    && value.jobs.length <= CONVERTER_MAX_PUBLIC_JOBS
    && value.jobs.every(isConverterJobView)
    && typeof value.hasMoreJobs === "boolean"
    && isIsoTimestamp(value.updatedAt);
}

export function createEmptyConverterState(): ConverterState {
  return {
    schemaVersion: CONVERTER_SCHEMA_VERSION,
    queuePaused: false,
    stagedSources: [],
    jobs: [],
    hasMoreJobs: false,
    updatedAt: new Date(0).toISOString(),
  };
}

/** Export intentionally omits all absolute paths, source bytes, and file contents. */
export function exportConverterHistory(state: ConverterState, format: ExportFormat): ExportResult {
  if (!isExportFormat(format)) throw new Error("Unsupported converter history export format");
  if (!isConverterState(state)) throw new Error("Invalid converter history state");
  const envelope = {
    schema: "material-download-manager.converter-history",
    schemaVersion: CONVERTER_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    visibleRecords: state.jobs.map((job) => ({
      id: job.id,
      sourceName: job.sourceName,
      destinationName: job.destinationName,
      adapterId: job.adapterId,
      status: job.status,
      inputBytes: job.inputBytes,
      processedBytes: job.processedBytes,
      outputBytes: job.outputBytes,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      retryCount: job.retryCount,
    })),
    omissions: ["absolute source paths", "absolute destination paths", "source bytes", "output bytes", "file contents"],
    pageTruncated: state.hasMoreJobs,
  };
  const result = exportRecords(envelope, format);
  const warnings = [...result.warnings, "Converter history exports omit absolute paths and file contents."];
  if (state.hasMoreJobs) warnings.push("Only the currently visible converter-history page is included; older records remain local.");
  return format === "json"
    ? { ...result, content: `${JSON.stringify(envelope, null, 2)}\n`, warnings }
    : { ...result, warnings };
}

validateConverterRegistry();
