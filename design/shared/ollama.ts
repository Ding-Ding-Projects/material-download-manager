import { exportRecords, type ExportFormat, type ExportResult } from "./export";

export const OLLAMA_SUITE_SCHEMA_VERSION = 1 as const;
export const OLLAMA_SUITE_EXPORT_SCHEMA = "material-download-manager.ollama-suite" as const;
export const OLLAMA_MAX_PROVIDERS = 32;
export const OLLAMA_MAX_MODELS = 2_000;
export const OLLAMA_MAX_RESPONSE_BYTES = 1_048_576;
export const OLLAMA_MAX_STATE_BYTES = 2_097_152;
export const OLLAMA_PROBE_TIMEOUT_MS = 1_500;

export type OllamaProviderProbeState = "never" | "healthy" | "unavailable";

export interface OllamaCredentialMetadata {
  provider: "os-credential-vault";
  configured: boolean;
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

export interface OllamaSuiteState {
  schemaVersion: typeof OLLAMA_SUITE_SCHEMA_VERSION;
  providers: OllamaProviderRecord[];
  installedModels: OllamaInstalledModelRecord[];
  updatedAt: string | null;
}

export interface OllamaMetadataExport {
  schema: typeof OLLAMA_SUITE_EXPORT_SCHEMA;
  schemaVersion: typeof OLLAMA_SUITE_SCHEMA_VERSION;
  exportedAt: string;
  state: OllamaSuiteState;
  omissions: readonly ["credentials", "cloud-catalog", "chat-history"];
}

export interface OllamaRefreshResult {
  state: OllamaSuiteState;
  providerId: string;
  modelCount: number;
  completeInstalledInventory: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

function optionalBoundedString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value));
}

function optionalInteger(value: unknown, max: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max);
}

export function normalizeOllamaEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value || value.includes("\0")) {
    throw new Error("Ollama endpoints must be a trimmed URL no longer than 2048 characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Ollama endpoint must be an absolute loopback URL");
  }
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
  try {
    normalizeOllamaEndpoint(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeOllamaProvider(value: unknown): OllamaProviderRecord {
  if (!isRecord(value)) throw new Error("Invalid Ollama provider");
  const id = value.id;
  const name = value.name;
  if (!boundedString(id, 128) || !boundedString(name, 128) || name.trim().length === 0) throw new Error("Ollama provider name and identifier are required");
  const endpoint = normalizeOllamaEndpoint(value.endpoint);
  // This foundation never stores or verifies a provider secret. Imported
  // metadata therefore cannot claim a credential is configured.
  const credential = { provider: "os-credential-vault" as const, configured: false };
  const rawProbe = isRecord(value.probe) ? value.probe : {};
  const state: OllamaProviderProbeState = rawProbe.state === "healthy" || rawProbe.state === "unavailable" ? rawProbe.state : "never";
  const checkedAt = optionalBoundedString(rawProbe.checkedAt, 64) ? rawProbe.checkedAt : null;
  const detail = optionalBoundedString(rawProbe.detail, 512) ? rawProbe.detail : null;
  const modelCount = typeof rawProbe.modelCount === "number" && optionalInteger(rawProbe.modelCount, OLLAMA_MAX_MODELS)
    ? rawProbe.modelCount
    : 0;
  return { id, name: name.trim(), endpoint, credential, probe: { state, checkedAt, detail, modelCount } };
}

export function normalizeOllamaModel(value: unknown): OllamaInstalledModelRecord {
  if (!isRecord(value)) throw new Error("Invalid Ollama installed model");
  if (!boundedString(value.id, 256) || !boundedString(value.providerId, 128) || !boundedString(value.name, 256)) throw new Error("Ollama model identity is invalid");
  const rawDetails = isRecord(value.details) ? value.details : {};
  return {
    id: value.id,
    providerId: value.providerId,
    name: value.name,
    digest: optionalBoundedString(value.digest, 256) ? value.digest : null,
    sizeBytes: optionalInteger(value.sizeBytes, Number.MAX_SAFE_INTEGER) ? value.sizeBytes : null,
    modifiedAt: optionalBoundedString(value.modifiedAt, 64) ? value.modifiedAt : null,
    details: {
      format: optionalBoundedString(rawDetails.format, 64) ? rawDetails.format : null,
      family: optionalBoundedString(rawDetails.family, 128) ? rawDetails.family : null,
      parameterSize: optionalBoundedString(rawDetails.parameterSize, 64) ? rawDetails.parameterSize : null,
      quantizationLevel: optionalBoundedString(rawDetails.quantizationLevel, 64) ? rawDetails.quantizationLevel : null,
    },
    observedAt: boundedString(value.observedAt, 64) ? value.observedAt : new Date(0).toISOString(),
    source: "ollama-local-api",
  };
}

export function createEmptyOllamaSuiteState(): OllamaSuiteState {
  return { schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION, providers: [], installedModels: [], updatedAt: null };
}

export function normalizeOllamaSuiteState(value: unknown): OllamaSuiteState {
  if (!isRecord(value) || value.schemaVersion !== OLLAMA_SUITE_SCHEMA_VERSION || !Array.isArray(value.providers) || !Array.isArray(value.installedModels)) {
    throw new Error("Invalid Ollama suite state");
  }
  if (value.providers.length > OLLAMA_MAX_PROVIDERS || value.installedModels.length > OLLAMA_MAX_MODELS) throw new Error("Ollama suite state is too large");
  const providers = value.providers.map(normalizeOllamaProvider);
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw new Error("Ollama provider identifiers must be unique");
  const providerIds = new Set(providers.map((provider) => provider.id));
  const installedModels = value.installedModels.map(normalizeOllamaModel);
  if (installedModels.some((model) => !providerIds.has(model.providerId))) throw new Error("Ollama model references an unknown provider");
  if (new Set(installedModels.map((model) => model.id)).size !== installedModels.length) throw new Error("Ollama model identifiers must be unique");
  return {
    schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION,
    providers,
    installedModels,
    updatedAt: optionalBoundedString(value.updatedAt, 64) ? value.updatedAt : null,
  };
}

function modelId(providerId: string, name: string, digest: string | null): string {
  const digestPart = digest ? digest.slice(0, 32) : "no-digest";
  const raw = `${providerId}\u0000${name}\u0000${digestPart}`;
  let hash = 2166136261;
  for (const character of raw) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  return `ollama-model-${encodeURIComponent(providerId)}-${encodeURIComponent(name)}-${encodeURIComponent(digestPart)}-${hash.toString(16)}`.slice(0, 256);
}

function optionalDetail(value: unknown, key: string, maxLength: number): string | null {
  if (!isRecord(value)) return null;
  return optionalBoundedString(value[key], maxLength) ? value[key] : null;
}

/** Parse only the installed-model payload returned by GET /api/tags. */
export function parseOllamaTagsPayload(value: unknown, providerId: string, observedAt = new Date().toISOString()): OllamaInstalledModelRecord[] {
  if (!isRecord(value) || !Array.isArray(value.models) || value.models.length > OLLAMA_MAX_MODELS) throw new Error("Ollama local API returned an invalid or oversized model inventory");
  return value.models.map((raw, index) => {
    if (!isRecord(raw) || !boundedString(raw.name ?? raw.model, 256)) throw new Error(`Ollama model inventory item ${index + 1} has no valid name`);
    const name = String(raw.name ?? raw.model);
    const digest = optionalBoundedString(raw.digest, 256) ? raw.digest : null;
    return normalizeOllamaModel({
      id: modelId(providerId, name, digest),
      providerId,
      name,
      digest,
      sizeBytes: optionalInteger(raw.size, Number.MAX_SAFE_INTEGER) ? raw.size : null,
      modifiedAt: optionalBoundedString(raw.modified_at, 64) ? raw.modified_at : null,
      details: {
        format: optionalDetail(raw.details, "format", 64),
        family: optionalDetail(raw.details, "family", 128),
        parameterSize: optionalDetail(raw.details, "parameter_size", 64),
        quantizationLevel: optionalDetail(raw.details, "quantization_level", 64),
      },
      observedAt,
      source: "ollama-local-api",
    });
  });
}

export function createOllamaMetadataExport(state: OllamaSuiteState, exportedAt = new Date().toISOString()): OllamaMetadataExport {
  return {
    schema: OLLAMA_SUITE_EXPORT_SCHEMA,
    schemaVersion: OLLAMA_SUITE_SCHEMA_VERSION,
    exportedAt,
    state: normalizeOllamaSuiteState(state),
    omissions: ["credentials", "cloud-catalog", "chat-history"],
  };
}

export function parseOllamaMetadataExport(value: unknown): OllamaSuiteState {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!isRecord(candidate) || candidate.schema !== OLLAMA_SUITE_EXPORT_SCHEMA || candidate.schemaVersion !== OLLAMA_SUITE_SCHEMA_VERSION || !boundedString(candidate.exportedAt, 64) || !Array.isArray(candidate.omissions) || candidate.omissions.length !== 3 || !candidate.omissions.every((item) => item === "credentials" || item === "cloud-catalog" || item === "chat-history") || new Set(candidate.omissions).size !== 3) {
    throw new Error("This file is not a supported Ollama metadata export");
  }
  const imported = normalizeOllamaSuiteState(candidate.state);
  return {
    ...imported,
    providers: imported.providers.map((provider) => ({ ...provider, credential: { provider: "os-credential-vault", configured: false }, probe: { ...provider.probe, state: "never", detail: "Imported metadata requires a fresh local refresh.", modelCount: provider.probe.modelCount } })),
    updatedAt: null,
  };
}

export function exportOllamaMetadata(state: OllamaSuiteState, format: ExportFormat): ExportResult {
  const envelope = createOllamaMetadataExport(state);
  const result = exportRecords(envelope, format);
  if (format !== "json") return result;
  return { ...result, content: `${JSON.stringify(envelope, null, 2)}\n` };
}

export function isOllamaSuiteState(value: unknown): value is OllamaSuiteState {
  try { normalizeOllamaSuiteState(value); return true; } catch { return false; }
}

export function isOllamaRefreshResult(value: unknown): value is OllamaRefreshResult {
  if (!isRecord(value)) return false;
  const modelCount = value.modelCount;
  if (typeof value.providerId !== "string" || typeof modelCount !== "number" || !Number.isInteger(modelCount) || modelCount < 0 || modelCount > OLLAMA_MAX_MODELS || typeof value.completeInstalledInventory !== "boolean") return false;
  return isOllamaSuiteState(value.state);
}
