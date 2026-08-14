import { exportRecords, type ExportFormat, type ExportResult } from "./export";

/**
 * Local-only Ollama suite contract.  This module deliberately contains no
 * official-catalog URL: the documented local API has no exhaustive catalog
 * endpoint, and the product must not quietly substitute a cloud service.
 */
export const OLLAMA_SUITE_SCHEMA_VERSION = 2 as const;
export const OLLAMA_SUITE_EXPORT_SCHEMA = "material-download-manager.ollama-suite" as const;
export const OLLAMA_MAX_PROVIDERS = 32;
export const OLLAMA_MAX_MODELS = 2_000;
export const OLLAMA_MAX_RESPONSE_BYTES = 2_097_152;
export const OLLAMA_MAX_STREAM_BYTES = 16_777_216;
export const OLLAMA_MAX_STATE_BYTES = 16_777_216;
export const OLLAMA_PROBE_TIMEOUT_MS = 3_000;
export const OLLAMA_MAX_PULL_ITEMS = 64;
export const OLLAMA_MAX_CHAT_SESSIONS = 64;
export const OLLAMA_MAX_CHAT_MESSAGES = 1_000;
export const OLLAMA_MAX_CHAT_MESSAGE_CHARS = 32_768;
export const OLLAMA_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const OLLAMA_MAX_ATTACHMENTS = 4;
export const OLLAMA_CATALOG_POLICY_REASON = "The documented local Ollama API does not expose an exhaustive official catalog endpoint. Remote catalog services and credentials are disabled by this app.";

export type OllamaProviderProbeState = "never" | "healthy" | "missing-runtime" | "stopped" | "unhealthy";
export type OllamaFitVerdict = "runs-well" | "runs-with-limits" | "unlikely" | "unknown";
export type OllamaPullItemState = "queued" | "running" | "pulled" | "skipped" | "cancelled" | "failed";
export type OllamaPullBatchState = "queued" | "running" | "completed" | "partial" | "cancelled" | "failed";
export type OllamaChatSessionState = "ready" | "streaming" | "failed" | "cancelled";
export type OllamaHarnessProfileKind = "built-in-diagnostics" | "registered-executable";
export type OllamaCatalogAvailability = "unavailable-by-policy";

export interface OllamaCredentialMetadata {
  provider: "os-credential-vault";
  configured: false;
}

export interface OllamaProviderRecord {
  id: string;
  name: string;
  endpoint: string;
  credential: OllamaCredentialMetadata;
  probe: {
    state: OllamaProviderProbeState;
    checkedAt: string | null;
    detail: string | null;
    modelCount: number;
    runtimeVersion: string | null;
    runningModelCount: number;
  };
}

export interface OllamaInstalledModelRecord {
  id: string;
  providerId: string;
  name: string;
  digest: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  details: {
    format: string | null;
    family: string | null;
    parameterSize: string | null;
    quantizationLevel: string | null;
  };
  observedAt: string;
  source: "ollama-local-api";
}

export interface OllamaRunningModelRecord {
  providerId: string;
  name: string;
  digest: string | null;
  sizeBytes: number | null;
  sizeVramBytes: number | null;
  contextLength: number | null;
  expiresAt: string | null;
  observedAt: string;
}

export interface OllamaModelDetailsRecord {
  providerId: string;
  modelName: string;
  capabilities: string[];
  contextLength: number | null;
  parameterText: string | null;
  quantizationLevel: string | null;
  family: string | null;
  observedAt: string;
}

export interface OllamaHardwareFacts {
  checkedAt: string;
  totalRamBytes: number | null;
  freeRamBytes: number | null;
  freeDiskBytes: number | null;
  architecture: string;
  gpu: {
    name: string | null;
    vramBytes: number | null;
    driver: string | null;
    backend: "unknown" | "detected";
  };
  diagnostic: string | null;
}

export interface OllamaFitEvidence {
  modelName: string;
  verdict: OllamaFitVerdict;
  checkedAt: string;
  blobBytes: number | null;
  parameterSize: string | null;
  quantization: string | null;
  contextLength: number | null;
  contextOverheadBytes: number;
  totalRamBytes: number | null;
  freeRamBytes: number | null;
  freeDiskBytes: number | null;
  gpuName: string | null;
  usableVramBytes: number | null;
  driver: string | null;
  assumptions: string[];
}

export interface OllamaPullItem {
  id: string;
  model: string;
  state: OllamaPullItemState;
  status: string;
  totalBytes: number | null;
  completedBytes: number | null;
  error: string | null;
  updatedAt: string;
}

export interface OllamaPullBatch {
  id: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  state: OllamaPullBatchState;
  parallelism: number;
  items: OllamaPullItem[];
  storagePreflightBytes: number;
  availableDiskBytes: number | null;
}

export interface OllamaChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking: string | null;
  createdAt: string;
  status: "complete" | "streaming" | "failed" | "cancelled";
}

export interface OllamaChatSession {
  id: string;
  providerId: string;
  model: string;
  name: string;
  systemPrompt: string;
  options: { temperature: number; numCtx: number; keepAlive: string };
  createdAt: string;
  updatedAt: string;
  state: OllamaChatSessionState;
  error: string | null;
  messages: OllamaChatMessage[];
}

export interface OllamaHarnessProfile {
  id: string;
  name: string;
  kind: OllamaHarnessProfileKind;
  executablePath: string | null;
  workingDirectory: string | null;
  arguments: string[];
  allowedEnvironmentKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OllamaHarnessSnapshot {
  id: string;
  profileId: string;
  providerId: string;
  model: string;
  createdAt: string;
  restoredAt: string | null;
  outcome: "ready" | "launched" | "failed" | "restored";
  detail: string;
}

export interface OllamaCatalogState {
  availability: OllamaCatalogAvailability;
  checkedAt: string | null;
  reason: string;
  cachedAt: null;
  sourceRevision: null;
  pageCount: 0;
  complete: false;
}

export interface OllamaSuiteState {
  schemaVersion: typeof OLLAMA_SUITE_SCHEMA_VERSION;
  providers: OllamaProviderRecord[];
  installedModels: OllamaInstalledModelRecord[];
  runningModels: OllamaRunningModelRecord[];
  modelDetails: OllamaModelDetailsRecord[];
  hardware: OllamaHardwareFacts | null;
  fitEvidence: OllamaFitEvidence[];
  catalog: OllamaCatalogState;
  pullBatches: OllamaPullBatch[];
  chats: OllamaChatSession[];
  harnessProfiles: OllamaHarnessProfile[];
  harnessSnapshots: OllamaHarnessSnapshot[];
  updatedAt: string | null;
}

export interface OllamaMetadataExport {
  schema: typeof OLLAMA_SUITE_EXPORT_SCHEMA;
  schemaVersion: typeof OLLAMA_SUITE_SCHEMA_VERSION;
  exportedAt: string;
  state: Pick<OllamaSuiteState, "schemaVersion" | "providers" | "installedModels" | "runningModels" | "modelDetails" | "hardware" | "fitEvidence" | "catalog">;
  omissions: readonly ["credentials", "chat-history", "attachments", "harness-snapshots", "official-catalog"];
}

export interface OllamaChatAttachment {
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
}

export interface OllamaChatInput {
  sessionId: string;
  content: string;
  attachments: OllamaChatAttachment[];
}

/** A guided completion request. The result is retained as a local chat session
 * so it gets the same history, export, stop, and retention boundaries as chat. */
export interface OllamaGenerateInput {
  providerId: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  temperature: number;
  numCtx: number;
  keepAlive: string;
}

export interface OllamaPullInput {
  providerId: string;
  models: string[];
  parallelism: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

function optionalBoundedString(value: unknown, maxLength: number): string | null {
  return value === null || value === undefined || (typeof value === "string" && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value)) ? (value ?? null) as string | null : null;
}

function optionalInteger(value: unknown, max: number): number | null {
  return value === null || value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max) ? (value ?? null) as number | null : null;
}

function normalizedTimestamp(value: unknown): string | null {
  const timestamp = optionalBoundedString(value, 64);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function stableId(prefix: string, parts: string[]): string {
  const raw = parts.join("\u0000");
  let hash = 2166136261;
  for (const character of raw) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return `${prefix}-${hash.toString(16)}-${encodeURIComponent(parts.join("-"))}`.slice(0, 240);
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

export function normalizeOllamaEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value || value.includes("\0")) {
    throw new Error("Ollama endpoints must be a trimmed URL no longer than 2048 characters");
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Ollama endpoint must be an absolute loopback URL"); }
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/u, 1)[0] ?? "";
  if (authority.includes("@")) throw new Error("Ollama endpoint must be credential-free and must not contain URL credentials");
  if (value.includes("?") || value.includes("#")) throw new Error("Ollama endpoint must not contain a query or fragment");
  const host = parsed.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!loopback || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Ollama endpoint must be a credential-free loopback HTTP(S) URL on localhost, 127.0.0.1, or ::1");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("Ollama endpoint must not include a path");
  parsed.pathname = "/";
  return parsed.toString().replace(/\/$/u, "");
}

export function isOllamaEndpoint(value: unknown): value is string {
  try { normalizeOllamaEndpoint(value); return true; } catch { return false; }
}

export function normalizeOllamaModelName(value: unknown, label = "model"): string {
  if (typeof value !== "string") throw new Error(`Invalid Ollama ${label}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f\s]/u.test(normalized) || /^(?:https?|file):/iu.test(normalized)) {
    throw new Error(`Invalid Ollama ${label}`);
  }
  return normalized;
}

export function createEmptyCatalogState(): OllamaCatalogState {
  return { availability: "unavailable-by-policy", checkedAt: null, reason: OLLAMA_CATALOG_POLICY_REASON, cachedAt: null, sourceRevision: null, pageCount: 0, complete: false };
}

export function createEmptyOllamaSuiteState(): OllamaSuiteState {
  return {
    schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION,
    providers: [], installedModels: [], runningModels: [], modelDetails: [], hardware: null, fitEvidence: [],
    catalog: createEmptyCatalogState(), pullBatches: [], chats: [], harnessProfiles: [
      { id: "ollama-built-in-diagnostics", name: "Local API diagnostics", kind: "built-in-diagnostics", executablePath: null, workingDirectory: null, arguments: [], allowedEnvironmentKeys: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() },
    ], harnessSnapshots: [], updatedAt: null,
  };
}

function normalizeProviderProbe(value: unknown): OllamaProviderRecord["probe"] {
  const raw = isRecord(value) ? value : {};
  const candidate = raw.state;
  const state: OllamaProviderProbeState = candidate === "healthy" || candidate === "missing-runtime" || candidate === "stopped" || candidate === "unhealthy" ? candidate : "never";
  return {
    state,
    checkedAt: normalizedTimestamp(raw.checkedAt),
    detail: optionalBoundedString(raw.detail, 512),
    modelCount: optionalInteger(raw.modelCount, OLLAMA_MAX_MODELS) ?? 0,
    runtimeVersion: optionalBoundedString(raw.runtimeVersion, 128),
    runningModelCount: optionalInteger(raw.runningModelCount, OLLAMA_MAX_MODELS) ?? 0,
  };
}

export function normalizeOllamaProvider(value: unknown): OllamaProviderRecord {
  if (!isRecord(value)) throw new Error("Invalid Ollama provider");
  if (!boundedString(value.id, 128) || !boundedString(value.name, 128) || value.name.trim().length === 0) throw new Error("Ollama provider name and identifier are required");
  return { id: value.id, name: value.name.trim(), endpoint: normalizeOllamaEndpoint(value.endpoint), credential: { provider: "os-credential-vault", configured: false }, probe: normalizeProviderProbe(value.probe) };
}

export function normalizeOllamaModel(value: unknown): OllamaInstalledModelRecord {
  if (!isRecord(value) || !boundedString(value.id, 256) || !boundedString(value.providerId, 128)) throw new Error("Invalid Ollama installed model");
  const rawDetails = isRecord(value.details) ? value.details : {};
  return {
    id: value.id, providerId: value.providerId, name: normalizeOllamaModelName(value.name), digest: optionalBoundedString(value.digest, 256),
    sizeBytes: optionalInteger(value.sizeBytes, Number.MAX_SAFE_INTEGER), modifiedAt: normalizedTimestamp(value.modifiedAt),
    details: { format: optionalBoundedString(rawDetails.format, 64), family: optionalBoundedString(rawDetails.family, 128), parameterSize: optionalBoundedString(rawDetails.parameterSize, 64), quantizationLevel: optionalBoundedString(rawDetails.quantizationLevel, 64) },
    observedAt: normalizedTimestamp(value.observedAt) ?? new Date(0).toISOString(), source: "ollama-local-api",
  };
}

function normalizeRunningModel(value: unknown): OllamaRunningModelRecord {
  if (!isRecord(value) || !boundedString(value.providerId, 128)) throw new Error("Invalid running Ollama model");
  return { providerId: value.providerId, name: normalizeOllamaModelName(value.name), digest: optionalBoundedString(value.digest, 256), sizeBytes: optionalInteger(value.sizeBytes, Number.MAX_SAFE_INTEGER), sizeVramBytes: optionalInteger(value.sizeVramBytes, Number.MAX_SAFE_INTEGER), contextLength: optionalInteger(value.contextLength, 16_777_216), expiresAt: normalizedTimestamp(value.expiresAt), observedAt: normalizedTimestamp(value.observedAt) ?? new Date(0).toISOString() };
}

function normalizeModelDetails(value: unknown): OllamaModelDetailsRecord {
  if (!isRecord(value) || !boundedString(value.providerId, 128)) throw new Error("Invalid Ollama model details");
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  if (capabilities.length > 32 || capabilities.some((item) => !boundedString(item, 64))) throw new Error("Invalid Ollama model capabilities");
  return { providerId: value.providerId, modelName: normalizeOllamaModelName(value.modelName), capabilities: [...new Set(capabilities)].sort(), contextLength: optionalInteger(value.contextLength, 16_777_216), parameterText: optionalBoundedString(value.parameterText, 4_096), quantizationLevel: optionalBoundedString(value.quantizationLevel, 64), family: optionalBoundedString(value.family, 128), observedAt: normalizedTimestamp(value.observedAt) ?? new Date(0).toISOString() };
}

function normalizeHardware(value: unknown): OllamaHardwareFacts | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !boundedString(value.checkedAt, 64) || !boundedString(value.architecture, 128)) throw new Error("Invalid Ollama hardware facts");
  const gpu = isRecord(value.gpu) ? value.gpu : null;
  if (!gpu || (gpu.backend !== "unknown" && gpu.backend !== "detected")) throw new Error("Invalid Ollama GPU facts");
  return { checkedAt: value.checkedAt, totalRamBytes: optionalInteger(value.totalRamBytes, Number.MAX_SAFE_INTEGER), freeRamBytes: optionalInteger(value.freeRamBytes, Number.MAX_SAFE_INTEGER), freeDiskBytes: optionalInteger(value.freeDiskBytes, Number.MAX_SAFE_INTEGER), architecture: value.architecture, gpu: { name: optionalBoundedString(gpu.name, 512), vramBytes: optionalInteger(gpu.vramBytes, Number.MAX_SAFE_INTEGER), driver: optionalBoundedString(gpu.driver, 128), backend: gpu.backend }, diagnostic: optionalBoundedString(value.diagnostic, 512) };
}

function normalizeFitEvidence(value: unknown): OllamaFitEvidence {
  if (!isRecord(value) || !boundedString(value.modelName, 256) || !boundedString(value.checkedAt, 64) || !["runs-well", "runs-with-limits", "unlikely", "unknown"].includes(String(value.verdict))) throw new Error("Invalid Ollama fit evidence");
  const assumptions = Array.isArray(value.assumptions) ? value.assumptions : [];
  if (assumptions.length > 32 || assumptions.some((item) => !boundedString(item, 512))) throw new Error("Invalid Ollama fit assumptions");
  return { modelName: normalizeOllamaModelName(value.modelName), verdict: value.verdict as OllamaFitVerdict, checkedAt: value.checkedAt, blobBytes: optionalInteger(value.blobBytes, Number.MAX_SAFE_INTEGER), parameterSize: optionalBoundedString(value.parameterSize, 64), quantization: optionalBoundedString(value.quantization, 64), contextLength: optionalInteger(value.contextLength, 16_777_216), contextOverheadBytes: optionalInteger(value.contextOverheadBytes, Number.MAX_SAFE_INTEGER) ?? 0, totalRamBytes: optionalInteger(value.totalRamBytes, Number.MAX_SAFE_INTEGER), freeRamBytes: optionalInteger(value.freeRamBytes, Number.MAX_SAFE_INTEGER), freeDiskBytes: optionalInteger(value.freeDiskBytes, Number.MAX_SAFE_INTEGER), gpuName: optionalBoundedString(value.gpuName, 512), usableVramBytes: optionalInteger(value.usableVramBytes, Number.MAX_SAFE_INTEGER), driver: optionalBoundedString(value.driver, 128), assumptions };
}

function normalizePullItem(value: unknown): OllamaPullItem {
  if (!isRecord(value) || !boundedString(value.id, 160) || !["queued", "running", "pulled", "skipped", "cancelled", "failed"].includes(String(value.state)) || !boundedString(value.status, 512, true) || !boundedString(value.updatedAt, 64)) throw new Error("Invalid Ollama pull item");
  return { id: value.id, model: normalizeOllamaModelName(value.model), state: value.state as OllamaPullItemState, status: value.status, totalBytes: optionalInteger(value.totalBytes, Number.MAX_SAFE_INTEGER), completedBytes: optionalInteger(value.completedBytes, Number.MAX_SAFE_INTEGER), error: optionalBoundedString(value.error, 1_024), updatedAt: value.updatedAt };
}

function normalizePullBatch(value: unknown): OllamaPullBatch {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.providerId, 128) || !boundedString(value.createdAt, 64) || !boundedString(value.updatedAt, 64) || !["queued", "running", "completed", "partial", "cancelled", "failed"].includes(String(value.state)) || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > OLLAMA_MAX_PULL_ITEMS) throw new Error("Invalid Ollama pull batch");
  const items = value.items.map(normalizePullItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Ollama pull item identifiers must be unique");
  const parallelism = optionalInteger(value.parallelism, 4);
  if (!parallelism || parallelism < 1) throw new Error("Invalid Ollama pull parallelism");
  return { id: value.id, providerId: value.providerId, createdAt: value.createdAt, updatedAt: value.updatedAt, state: value.state as OllamaPullBatchState, parallelism, items, storagePreflightBytes: optionalInteger(value.storagePreflightBytes, Number.MAX_SAFE_INTEGER) ?? 0, availableDiskBytes: optionalInteger(value.availableDiskBytes, Number.MAX_SAFE_INTEGER) };
}

function normalizeChatMessage(value: unknown): OllamaChatMessage {
  if (!isRecord(value) || !boundedString(value.id, 160) || !["user", "assistant", "system"].includes(String(value.role)) || !boundedString(value.content, OLLAMA_MAX_CHAT_MESSAGE_CHARS, true) || !boundedString(value.createdAt, 64) || !["complete", "streaming", "failed", "cancelled"].includes(String(value.status))) throw new Error("Invalid Ollama chat message");
  return { id: value.id, role: value.role as OllamaChatMessage["role"], content: value.content, thinking: optionalBoundedString(value.thinking, OLLAMA_MAX_CHAT_MESSAGE_CHARS), createdAt: value.createdAt, status: value.status as OllamaChatMessage["status"] };
}

function normalizeChatSession(value: unknown): OllamaChatSession {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.providerId, 128) || !boundedString(value.name, 128) || !boundedString(value.systemPrompt, OLLAMA_MAX_CHAT_MESSAGE_CHARS, true) || !boundedString(value.createdAt, 64) || !boundedString(value.updatedAt, 64) || !["ready", "streaming", "failed", "cancelled"].includes(String(value.state)) || !Array.isArray(value.messages) || value.messages.length > OLLAMA_MAX_CHAT_MESSAGES) throw new Error("Invalid Ollama chat session");
  const options = isRecord(value.options) ? value.options : null;
  const temperature = options?.temperature;
  const numCtx = options?.numCtx;
  const keepAlive = options?.keepAlive;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2 || typeof numCtx !== "number" || !Number.isSafeInteger(numCtx) || numCtx < 128 || numCtx > 16_777_216 || !boundedString(keepAlive, 32)) throw new Error("Invalid Ollama chat options");
  return { id: value.id, providerId: value.providerId, model: normalizeOllamaModelName(value.model), name: value.name, systemPrompt: value.systemPrompt, options: { temperature, numCtx, keepAlive }, createdAt: value.createdAt, updatedAt: value.updatedAt, state: value.state as OllamaChatSessionState, error: optionalBoundedString(value.error, 1_024), messages: value.messages.map(normalizeChatMessage) };
}

function normalizeHarnessProfile(value: unknown): OllamaHarnessProfile {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.name, 128) || !["built-in-diagnostics", "registered-executable"].includes(String(value.kind)) || !boundedString(value.createdAt, 64) || !boundedString(value.updatedAt, 64) || !Array.isArray(value.arguments) || !Array.isArray(value.allowedEnvironmentKeys)) throw new Error("Invalid Ollama harness profile");
  if (value.arguments.length > 16 || value.arguments.some((item) => !boundedString(item, 256)) || value.allowedEnvironmentKeys.length > 16 || value.allowedEnvironmentKeys.some((item) => !boundedString(item, 64))) throw new Error("Invalid Ollama harness profile arguments");
  const kind = value.kind as OllamaHarnessProfileKind;
  const executablePath = optionalBoundedString(value.executablePath, 2_048);
  const workingDirectory = optionalBoundedString(value.workingDirectory, 2_048);
  if (kind === "built-in-diagnostics" && (executablePath !== null || workingDirectory !== null || value.arguments.length !== 0)) throw new Error("Built-in Ollama harness profiles cannot launch a program");
  if (kind === "registered-executable" && (!executablePath || !workingDirectory)) throw new Error("Registered Ollama harness profiles require a selected executable and folder");
  return { id: value.id, name: value.name, kind, executablePath, workingDirectory, arguments: [...value.arguments], allowedEnvironmentKeys: [...new Set(value.allowedEnvironmentKeys)].sort(), createdAt: value.createdAt, updatedAt: value.updatedAt };
}

function normalizeHarnessSnapshot(value: unknown): OllamaHarnessSnapshot {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.profileId, 160) || !boundedString(value.providerId, 128) || !boundedString(value.createdAt, 64) || !["ready", "launched", "failed", "restored"].includes(String(value.outcome)) || !boundedString(value.detail, 1_024, true)) throw new Error("Invalid Ollama harness snapshot");
  return { id: value.id, profileId: value.profileId, providerId: value.providerId, model: normalizeOllamaModelName(value.model), createdAt: value.createdAt, restoredAt: normalizedTimestamp(value.restoredAt), outcome: value.outcome as OllamaHarnessSnapshot["outcome"], detail: value.detail };
}

function normalizeCatalog(value: unknown): OllamaCatalogState {
  if (!isRecord(value)) return createEmptyCatalogState();
  // Do not accept an import that claims a remotely enumerated catalog exists.
  if (value.availability !== "unavailable-by-policy" || value.cachedAt !== null || value.sourceRevision !== null || value.pageCount !== 0 || value.complete !== false) throw new Error("Official Ollama catalog records are unavailable under the local-only policy");
  return { availability: "unavailable-by-policy", checkedAt: normalizedTimestamp(value.checkedAt), reason: OLLAMA_CATALOG_POLICY_REASON, cachedAt: null, sourceRevision: null, pageCount: 0, complete: false };
}

function migrateLegacyState(value: Record<string, unknown>): OllamaSuiteState {
  const blank = createEmptyOllamaSuiteState();
  return normalizeOllamaSuiteState({ ...blank, providers: value.providers ?? [], installedModels: value.installedModels ?? [], updatedAt: value.updatedAt ?? null });
}

export function normalizeOllamaSuiteState(value: unknown): OllamaSuiteState {
  if (!isRecord(value)) throw new Error("Invalid Ollama suite state");
  if (value.schemaVersion === 1) return migrateLegacyState(value);
  if (value.schemaVersion !== OLLAMA_SUITE_SCHEMA_VERSION || !Array.isArray(value.providers) || !Array.isArray(value.installedModels) || !Array.isArray(value.runningModels) || !Array.isArray(value.modelDetails) || !Array.isArray(value.fitEvidence) || !Array.isArray(value.pullBatches) || !Array.isArray(value.chats) || !Array.isArray(value.harnessProfiles) || !Array.isArray(value.harnessSnapshots)) throw new Error("Invalid Ollama suite state");
  if (value.providers.length > OLLAMA_MAX_PROVIDERS || value.installedModels.length > OLLAMA_MAX_MODELS || value.runningModels.length > OLLAMA_MAX_MODELS || value.modelDetails.length > OLLAMA_MAX_MODELS || value.fitEvidence.length > OLLAMA_MAX_MODELS || value.pullBatches.length > 128 || value.chats.length > OLLAMA_MAX_CHAT_SESSIONS || value.harnessProfiles.length > 64 || value.harnessSnapshots.length > 128) throw new Error("Ollama suite state is too large");
  const providers = value.providers.map(normalizeOllamaProvider);
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new Error("Ollama provider identifiers must be unique");
  const providerIds = new Set(providers.map((provider) => provider.id));
  const installedModels = value.installedModels.map(normalizeOllamaModel);
  const runningModels = value.runningModels.map(normalizeRunningModel);
  const modelDetails = value.modelDetails.map(normalizeModelDetails);
  const fitEvidence = value.fitEvidence.map(normalizeFitEvidence);
  const pullBatches = value.pullBatches.map(normalizePullBatch);
  const chats = value.chats.map(normalizeChatSession);
  const harnessProfiles = value.harnessProfiles.map(normalizeHarnessProfile);
  const harnessSnapshots = value.harnessSnapshots.map(normalizeHarnessSnapshot);
  for (const providerBound of [...installedModels, ...runningModels, ...modelDetails, ...pullBatches, ...chats, ...harnessSnapshots]) if (!providerIds.has(providerBound.providerId)) throw new Error("Ollama state references an unknown provider");
  if (new Set(installedModels.map((model) => model.id)).size !== installedModels.length || new Set(chats.map((chat) => chat.id)).size !== chats.length || new Set(pullBatches.map((batch) => batch.id)).size !== pullBatches.length || new Set(harnessProfiles.map((profile) => profile.id)).size !== harnessProfiles.length) throw new Error("Ollama state identifiers must be unique");
  return { schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION, providers, installedModels, runningModels, modelDetails, hardware: normalizeHardware(value.hardware), fitEvidence, catalog: normalizeCatalog(value.catalog), pullBatches, chats, harnessProfiles, harnessSnapshots, updatedAt: normalizedTimestamp(value.updatedAt) };
}

function modelId(providerId: string, name: string, digest: string | null): string { return stableId("ollama-model", [providerId, name, digest ?? "no-digest"]); }

function optionalDetail(value: unknown, key: string, maxLength: number): string | null { return isRecord(value) ? optionalBoundedString(value[key], maxLength) : null; }

/** Parse only the documented local GET /api/tags response. */
export function parseOllamaTagsPayload(value: unknown, providerId: string, observedAt = new Date().toISOString()): OllamaInstalledModelRecord[] {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > OLLAMA_MAX_MODELS) throw new Error("Ollama local API returned an invalid or oversized model inventory");
  return value.models.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Ollama model inventory item ${index + 1} is invalid`);
    const name = normalizeOllamaModelName(raw.name ?? raw.model);
    const digest = optionalBoundedString(raw.digest, 256);
    return normalizeOllamaModel({ id: modelId(providerId, name, digest), providerId, name, digest, sizeBytes: optionalInteger(raw.size, Number.MAX_SAFE_INTEGER), modifiedAt: normalizedTimestamp(raw.modified_at), details: { format: optionalDetail(raw.details, "format", 64), family: optionalDetail(raw.details, "family", 128), parameterSize: optionalDetail(raw.details, "parameter_size", 64), quantizationLevel: optionalDetail(raw.details, "quantization_level", 64) }, observedAt, source: "ollama-local-api" });
  });
}

/** Parse only the documented local GET /api/ps response. */
export function parseOllamaPsPayload(value: unknown, providerId: string, observedAt = new Date().toISOString()): OllamaRunningModelRecord[] {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > OLLAMA_MAX_MODELS) throw new Error("Ollama local API returned an invalid or oversized running-model inventory");
  return value.models.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Ollama running model ${index + 1} is invalid`);
    return normalizeRunningModel({ providerId, name: raw.name ?? raw.model, digest: optionalBoundedString(raw.digest, 256), sizeBytes: optionalInteger(raw.size, Number.MAX_SAFE_INTEGER), sizeVramBytes: optionalInteger(raw.size_vram, Number.MAX_SAFE_INTEGER), contextLength: optionalInteger(raw.context_length, 16_777_216), expiresAt: normalizedTimestamp(raw.expires_at), observedAt });
  });
}

export function parseOllamaVersionPayload(value: unknown): string {
  if (!isRecord(value) || !boundedString(value.version, 128)) throw new Error("Ollama local API returned an invalid runtime version");
  return value.version;
}

export function parseOllamaShowPayload(value: unknown, providerId: string, modelName: string, observedAt = new Date().toISOString()): OllamaModelDetailsRecord {
  if (!isRecord(value)) throw new Error("Ollama local API returned invalid model details");
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  const modelInfo = isRecord(value.model_info) ? value.model_info : {};
  const contextKey = Object.keys(modelInfo).find((key) => /(?:^|\.)context_length$/u.test(key));
  const contextLength = contextKey ? optionalInteger(modelInfo[contextKey], 16_777_216) : null;
  return normalizeModelDetails({ providerId, modelName, capabilities, contextLength, parameterText: optionalBoundedString(value.parameters, 4_096), quantizationLevel: optionalDetail(value.details, "quantization_level", 64), family: optionalDetail(value.details, "family", 128), observedAt });
}

export function calculateOllamaFit(model: OllamaInstalledModelRecord, details: OllamaModelDetailsRecord | null, hardware: OllamaHardwareFacts | null, now = new Date().toISOString()): OllamaFitEvidence {
  const contextLength = details?.contextLength ?? null;
  const contextOverheadBytes = contextLength === null ? 512 * 1024 * 1024 : Math.min(4 * 1024 * 1024 * 1024, Math.max(256 * 1024 * 1024, contextLength * 128 * 1024));
  const assumptions = ["Fit is a conservative local estimate, not a promise of successful execution.", "The documented local API does not provide a universal hardware-fit guarantee."];
  let verdict: OllamaFitVerdict = "unknown";
  if (model.sizeBytes === null || !hardware || hardware.freeRamBytes === null || hardware.freeDiskBytes === null) {
    assumptions.push("Missing blob-size, RAM, or free-disk evidence keeps this verdict Unknown.");
  } else {
    const requiredRam = model.sizeBytes + contextOverheadBytes;
    const requiredDisk = Math.ceil(model.sizeBytes * 1.1);
    if (hardware.freeDiskBytes < requiredDisk || hardware.freeRamBytes < Math.ceil(requiredRam * 0.6)) verdict = "unlikely";
    else if (hardware.gpu.vramBytes !== null && hardware.gpu.vramBytes >= Math.ceil(requiredRam * 1.1) && hardware.freeDiskBytes >= requiredDisk) verdict = "runs-well";
    else if (hardware.freeRamBytes >= Math.ceil(requiredRam * 1.35) && hardware.freeDiskBytes >= requiredDisk) verdict = "runs-well";
    else if (hardware.freeRamBytes >= requiredRam && hardware.freeDiskBytes >= requiredDisk) verdict = "runs-with-limits";
    else verdict = "unlikely";
    if (hardware.gpu.vramBytes === null) assumptions.push("GPU and usable VRAM were not detected; this is a CPU-memory estimate.");
    if (hardware.gpu.driver === null) assumptions.push("GPU driver/backend evidence is unavailable.");
  }
  return { modelName: model.name, verdict, checkedAt: now, blobBytes: model.sizeBytes, parameterSize: details?.parameterText ?? model.details.parameterSize, quantization: details?.quantizationLevel ?? model.details.quantizationLevel, contextLength, contextOverheadBytes, totalRamBytes: hardware?.totalRamBytes ?? null, freeRamBytes: hardware?.freeRamBytes ?? null, freeDiskBytes: hardware?.freeDiskBytes ?? null, gpuName: hardware?.gpu.name ?? null, usableVramBytes: hardware?.gpu.vramBytes ?? null, driver: hardware?.gpu.driver ?? null, assumptions };
}

export function normalizeOllamaPullInput(value: unknown): OllamaPullInput {
  if (!isRecord(value) || !boundedString(value.providerId, 128) || !Array.isArray(value.models) || value.models.length === 0 || value.models.length > OLLAMA_MAX_PULL_ITEMS) throw new Error("Choose one or more local Ollama model tags to pull");
  const models = value.models.map((model) => normalizeOllamaModelName(model));
  if (new Set(models).size !== models.length) throw new Error("Each Ollama pull tag must be unique");
  const parallelism = typeof value.parallelism === "number" && Number.isSafeInteger(value.parallelism) ? value.parallelism : 1;
  if (parallelism < 1 || parallelism > 4) throw new Error("Ollama pull parallelism must be between 1 and 4");
  return { providerId: value.providerId, models, parallelism };
}

export function normalizeOllamaChatInput(value: unknown): OllamaChatInput {
  if (!isRecord(value) || !boundedString(value.sessionId, 160) || !boundedString(value.content, OLLAMA_MAX_CHAT_MESSAGE_CHARS)) throw new Error("A bounded local chat message is required");
  const attachments = Array.isArray(value.attachments) ? value.attachments : [];
  if (attachments.length > OLLAMA_MAX_ATTACHMENTS) throw new Error("Too many local chat attachments");
  const normalizedAttachments = attachments.map((attachment) => {
    if (!isRecord(attachment) || !boundedString(attachment.name, 256) || !["image/jpeg", "image/png", "image/webp"].includes(String(attachment.mimeType)) || !boundedString(attachment.dataBase64, Math.ceil(OLLAMA_MAX_ATTACHMENT_BYTES * 1.4))) throw new Error("Invalid local image attachment");
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(attachment.dataBase64) || decodedBase64Bytes(attachment.dataBase64) > OLLAMA_MAX_ATTACHMENT_BYTES) throw new Error("Local image attachment exceeds the approved size limit");
    return { name: attachment.name, mimeType: attachment.mimeType as OllamaChatAttachment["mimeType"], dataBase64: attachment.dataBase64 };
  });
  return { sessionId: value.sessionId, content: value.content.trim(), attachments: normalizedAttachments };
}

export function normalizeOllamaGenerateInput(value: unknown): OllamaGenerateInput {
  if (!isRecord(value) || !boundedString(value.providerId, 128) || !boundedString(value.prompt, OLLAMA_MAX_CHAT_MESSAGE_CHARS)) throw new Error("Choose a local provider, verified installed model, and bounded prompt for generation");
  const prompt = value.prompt.trim();
  if (!prompt) throw new Error("A local generation prompt is required");
  const systemPrompt = value.systemPrompt === undefined ? "" : value.systemPrompt;
  if (!boundedString(systemPrompt, OLLAMA_MAX_CHAT_MESSAGE_CHARS, true)) throw new Error("The local generation system prompt is invalid");
  const temperature = value.temperature === undefined ? 0.7 : value.temperature;
  const numCtx = value.numCtx === undefined ? 4096 : value.numCtx;
  const keepAlive = value.keepAlive === undefined ? "5m" : value.keepAlive;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2 || typeof numCtx !== "number" || !Number.isSafeInteger(numCtx) || numCtx < 128 || numCtx > 16_777_216 || typeof keepAlive !== "string" || !/^\d+(?:s|m|h)$|^0$/u.test(keepAlive)) throw new Error("Generation temperature, context limit, or keep-alive value is outside the documented local bounds");
  return { providerId: value.providerId, model: normalizeOllamaModelName(value.model), prompt, systemPrompt: systemPrompt.trim(), temperature, numCtx, keepAlive };
}

export function createOllamaMetadataExport(state: OllamaSuiteState, exportedAt = new Date().toISOString()): OllamaMetadataExport {
  const normalized = normalizeOllamaSuiteState(state);
  return { schema: OLLAMA_SUITE_EXPORT_SCHEMA, schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION, exportedAt, state: { schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION, providers: normalized.providers, installedModels: normalized.installedModels, runningModels: normalized.runningModels, modelDetails: normalized.modelDetails, hardware: normalized.hardware, fitEvidence: normalized.fitEvidence, catalog: normalized.catalog }, omissions: ["credentials", "chat-history", "attachments", "harness-snapshots", "official-catalog"] };
}

export function parseOllamaMetadataExport(value: unknown): OllamaSuiteState {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const omissions = isRecord(candidate) && Array.isArray(candidate.omissions) ? candidate.omissions : null;
  if (!isRecord(candidate) || candidate.schema !== OLLAMA_SUITE_EXPORT_SCHEMA || candidate.schemaVersion !== OLLAMA_SUITE_SCHEMA_VERSION || !boundedString(candidate.exportedAt, 64) || !omissions || omissions.length !== 5 || !["credentials", "chat-history", "attachments", "harness-snapshots", "official-catalog"].every((item) => omissions.includes(item))) throw new Error("This file is not a supported Ollama metadata export");
  const state = isRecord(candidate.state) ? candidate.state : null;
  if (!state) throw new Error("This file has no Ollama metadata state");
  return normalizeOllamaSuiteState({ ...createEmptyOllamaSuiteState(), ...state, schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION, pullBatches: [], chats: [], harnessSnapshots: [], harnessProfiles: createEmptyOllamaSuiteState().harnessProfiles, updatedAt: null });
}

export function exportOllamaMetadata(state: OllamaSuiteState, format: ExportFormat): ExportResult {
  const envelope = createOllamaMetadataExport(state);
  const result = exportRecords(envelope, format);
  return format === "json" ? { ...result, content: `${JSON.stringify(envelope, null, 2)}\n` } : result;
}

export function isOllamaSuiteState(value: unknown): value is OllamaSuiteState { try { normalizeOllamaSuiteState(value); return true; } catch { return false; } }
