import type { AppSettings } from "../../shared/types";
import {
  isBoundedNumber,
  isDensityMode,
  isFunnyLevel,
  isHexColor,
  isLanguageMode,
  isUIFontFamily,
  isUIFontWeight,
} from "../../shared/settings";

export const SCHEDULE_SOURCE_SCHEMA_VERSION = 1 as const;
export const MAX_SCHEDULE_RESPONSE_BYTES = 256 * 1024;
export const MAX_SCHEDULE_TIMEOUT_MS = 10_000;
export const MAX_SCHEDULE_TOKEN_LENGTH = 4_096;

export type ScheduledSettings = Partial<Omit<AppSettings, "settingsVersion" | "settingProvenance">>;

export interface LocalScheduleSource {
  kind: "local";
  active: boolean;
  settings: unknown;
}

export interface ApiScheduleSource {
  kind: "api";
  url: string;
}

export interface HomeAssistantScheduleSource {
  kind: "home-assistant";
  baseUrl: string;
  entityId: string;
  settings: unknown;
  /** The main process should resolve this from the OS credential vault per request. */
  getAccessToken: () => Promise<string | null>;
}

export type ScheduleSource = LocalScheduleSource | ApiScheduleSource | HomeAssistantScheduleSource;
export type ScheduleSourceKind = ScheduleSource["kind"];

export interface ScheduleResponseBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | ArrayBuffer }>;
  cancel?: () => Promise<void> | void;
}

export interface ScheduleResponse {
  status: number;
  ok?: boolean;
  url?: string;
  body?: { getReader: () => ScheduleResponseBodyReader };
  text?: () => Promise<string>;
  headers?: { get?: (name: string) => string | null };
}

export interface ScheduleFetchInit {
  method: "GET";
  headers?: Record<string, string>;
  signal?: unknown;
  redirect: "error";
}

export type ScheduleFetcher = (url: string, init: ScheduleFetchInit) => Promise<ScheduleResponse>;

export interface ScheduleSourceResolveOptions {
  fetcher?: ScheduleFetcher;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Only tests or an explicitly bounded loopback development route may enable this. */
  allowLoopbackHttp?: boolean;
  /** Optional origin allowlist for deployments that know their API hosts. */
  allowedOrigins?: readonly string[];
  /** Home Assistant may intentionally use a user-configured private HTTPS host. */
  allowPrivateHttps?: boolean;
  signal?: unknown;
}

export interface ScheduleResolution {
  source: ScheduleSourceKind;
  status: "applied" | "inactive" | "fallback";
  active: boolean;
  settings: ScheduledSettings;
  usedFallback: boolean;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(settings: ScheduledSettings): ScheduledSettings {
  return { ...settings };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export { isLoopbackHostname };

function isPrivateIpOrLocalName(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) {
    return true;
  }
  if (normalized.includes(":")) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:127.");
  }
  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d*)$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 ||
    first === 100 && second >= 64 && second <= 127 || first >= 224;
}

function normalizedAllowedOrigins(origins: readonly string[] | undefined): Set<string> | null {
  if (!origins) return null;
  const result = new Set<string>();
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("Invalid schedule origin allowlist");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Schedule origin allowlist must contain credential-free HTTPS origins");
    }
    result.add(parsed.origin);
  }
  return result;
}

export function isSafeScheduleUrl(
  value: unknown,
  options: Pick<ScheduleSourceResolveOptions, "allowLoopbackHttp" | "allowedOrigins" | "allowPrivateHttps"> = {},
): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) return false;
  const loopbackHttp = parsed.protocol === "http:" && Boolean(options.allowLoopbackHttp) && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackHttp) return false;
  if (parsed.protocol === "https:" && isPrivateIpOrLocalName(parsed.hostname) && !isLoopbackHostname(parsed.hostname) && !options.allowPrivateHttps) {
    return false;
  }
  try {
    const allowlist = normalizedAllowedOrigins(options.allowedOrigins);
    if (allowlist && !allowlist.has(parsed.origin)) return false;
  } catch {
    return false;
  }
  return true;
}

export function assertSafeScheduleUrl(
  value: unknown,
  options: Pick<ScheduleSourceResolveOptions, "allowLoopbackHttp" | "allowedOrigins" | "allowPrivateHttps"> = {},
): asserts value is string {
  if (!isSafeScheduleUrl(value, options)) throw new Error("Schedule source URL is not an allowed credential-free HTTPS URL");
}

function validateScheduledSetting(key: string, value: unknown): void {
  switch (key) {
    case "defaultSaveFolder":
      if (typeof value !== "string" || value.length === 0 || value.length > 32_768) throw new Error("Invalid scheduled defaultSaveFolder");
      return;
    case "maxConnectionsPerDownload":
    case "maxActiveDownloads":
      if (!isBoundedNumber(value, 1, 32) || !Number.isInteger(value)) throw new Error(`Invalid scheduled ${key}`);
      return;
    case "globalSpeedLimitBytes":
      if (!isBoundedNumber(value, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Invalid scheduled globalSpeedLimitBytes");
      return;
    case "showCompleteDialog":
    case "startOnSystemStartup":
      if (typeof value !== "boolean") throw new Error(`Invalid scheduled ${key}`);
      return;
    case "theme":
      if (value !== "dark" && value !== "light" && value !== "system") throw new Error("Invalid scheduled theme");
      return;
    case "minConnectionPartSize":
      if (!isBoundedNumber(value, 1, Number.MAX_SAFE_INTEGER) || !Number.isInteger(value)) throw new Error("Invalid scheduled minConnectionPartSize");
      return;
    case "languageMode":
      if (!isLanguageMode(value)) throw new Error("Invalid scheduled languageMode");
      return;
    case "funnyLevelEnglish":
    case "funnyLevelCantonese":
      if (!isFunnyLevel(value)) throw new Error(`Invalid scheduled ${key}`);
      return;
    case "density":
      if (!isDensityMode(value)) throw new Error("Invalid scheduled density");
      return;
    case "accentSeedColor":
      if (!isHexColor(value)) throw new Error("Invalid scheduled accentSeedColor");
      return;
    case "uiFontFamily":
      if (!isUIFontFamily(value)) throw new Error("Invalid scheduled uiFontFamily");
      return;
    case "uiFontSize":
      if (!isBoundedNumber(value, 10, 32)) throw new Error("Invalid scheduled uiFontSize");
      return;
    case "uiFontWeight":
      if (!isUIFontWeight(value)) throw new Error("Invalid scheduled uiFontWeight");
      return;
    default:
      throw new Error(`Unknown scheduled setting: ${key}`);
  }
}

export function validateScheduledSettings(value: unknown): ScheduledSettings {
  if (!isRecord(value)) throw new Error("Scheduled settings must be an object");
  const result: ScheduledSettings = {};
  for (const [key, setting] of Object.entries(value)) {
    validateScheduledSetting(key, setting);
    (result as Record<string, unknown>)[key] = setting;
  }
  return result;
}

export function validateScheduleSourceDefinition(
  value: unknown,
  options: Pick<ScheduleSourceResolveOptions, "allowLoopbackHttp" | "allowedOrigins" | "allowPrivateHttps"> = {},
): ScheduleSource {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("Invalid schedule source");
  switch (value.kind) {
    case "local":
      if (typeof value.active !== "boolean") throw new Error("Invalid local schedule state");
      return { kind: "local", active: value.active, settings: validateScheduledSettings(value.settings) };
    case "api":
      assertSafeScheduleUrl(value.url, options);
      return { kind: "api", url: value.url };
    case "home-assistant":
      assertSafeScheduleUrl(value.baseUrl, { ...options, allowedOrigins: undefined, allowPrivateHttps: true });
      if (typeof value.entityId !== "string" || !/^(?:binary_sensor|input_boolean)\.[a-z0-9_]+$/.test(value.entityId)) {
        throw new Error("Invalid Home Assistant boolean entity");
      }
      if (typeof value.getAccessToken !== "function") throw new Error("Home Assistant credential provider is required");
      return {
        kind: "home-assistant",
        baseUrl: value.baseUrl,
        entityId: value.entityId,
        settings: validateScheduledSettings(value.settings),
        getAccessToken: value.getAccessToken as () => Promise<string | null>,
      };
    default:
      throw new Error("Unknown schedule source kind");
  }
}

function sourceKind(value: unknown): ScheduleSourceKind {
  if (isRecord(value) && value.kind === "local") return "local";
  if (isRecord(value) && value.kind === "home-assistant") return "home-assistant";
  return "api";
}

function fallbackResolution(source: ScheduleSourceKind, settings: ScheduledSettings, reason: string): ScheduleResolution {
  return {
    source,
    status: "fallback",
    active: false,
    settings: cloneSettings(settings),
    usedFallback: true,
    reason,
  };
}

function inactiveResolution(source: ScheduleSourceKind, settings: ScheduledSettings): ScheduleResolution {
  return {
    source,
    status: "inactive",
    active: false,
    settings: cloneSettings(settings),
    usedFallback: false,
    reason: null,
  };
}

function appliedResolution(source: ScheduleSourceKind, base: ScheduledSettings, override: ScheduledSettings): ScheduleResolution {
  return {
    source,
    status: "applied",
    active: true,
    settings: { ...base, ...override },
    usedFallback: false,
    reason: null,
  };
}

function defaultFetcher(url: string, init: ScheduleFetchInit): Promise<ScheduleResponse> {
  const fetchFunction = (globalThis as unknown as { fetch?: ScheduleFetcher }).fetch;
  if (!fetchFunction) return Promise.reject(new Error("Fetch is unavailable"));
  return fetchFunction(url, init);
}

function responseByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

async function readBoundedBody(response: ScheduleResponse, maxBytes: number): Promise<string> {
  const advertisedLength = response.headers?.get?.("content-length");
  if (advertisedLength && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > maxBytes) {
    throw new Error("Schedule response is too large");
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value ?? []);
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error("Schedule response is too large");
        chunks.push(chunk);
      }
    } finally {
      if (total > maxBytes) await reader.cancel?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  if (!response.text) throw new Error("Schedule response has no readable body");
  const text = await response.text();
  if (responseByteLength(text) > maxBytes) throw new Error("Schedule response is too large");
  return text;
}

async function fetchJson(
  url: string,
  headers: Record<string, string> | undefined,
  options: ScheduleSourceResolveOptions,
): Promise<unknown> {
  const controller = new AbortController();
  const externalSignal = options.signal as { aborted?: boolean; addEventListener?: (type: string, listener: () => void, options?: unknown) => void } | undefined;
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener?.("abort", () => controller.abort(), { once: true });
  const requestedTimeout = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : MAX_SCHEDULE_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(Math.floor(requestedTimeout), 1), MAX_SCHEDULE_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetcher ?? defaultFetcher)(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status < 200 || response.status >= 300 || response.ok === false) {
      throw new Error("Schedule source returned a non-success response");
    }
    if (response.url && !sameUrl(response.url, url)) throw new Error("Schedule source redirected");
    const requestedLimit = typeof options.maxResponseBytes === "number" && Number.isFinite(options.maxResponseBytes)
      ? options.maxResponseBytes
      : MAX_SCHEDULE_RESPONSE_BYTES;
    const maxResponseBytes = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_SCHEDULE_RESPONSE_BYTES);
    const text = await readBoundedBody(response, maxResponseBytes);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function parseApiPayload(value: unknown): { active: boolean; settings: ScheduledSettings } {
  if (!isRecord(value) || value.version !== SCHEDULE_SOURCE_SCHEMA_VERSION || typeof value.active !== "boolean") {
    throw new Error("Invalid schedule API response version or active state");
  }
  return { active: value.active, settings: validateScheduledSettings(value.settings) };
}

function parseHomeAssistantState(value: unknown): boolean {
  if (!isRecord(value) || (value.state !== "on" && value.state !== "off")) {
    throw new Error("Invalid Home Assistant boolean state");
  }
  return value.state === "on";
}

function safeFailureReason(): string {
  return "Schedule source failed validation or refresh; keeping the last valid local state.";
}

export async function resolveScheduleSource(
  sourceValue: unknown,
  baseSettings: ScheduledSettings,
  options: ScheduleSourceResolveOptions = {},
  previousEffectiveSettings: ScheduledSettings = baseSettings,
): Promise<ScheduleResolution> {
  const kind = sourceKind(sourceValue);
  try {
    const source = validateScheduleSourceDefinition(sourceValue, options);
    if (source.kind === "local") {
      return source.active
        ? appliedResolution(source.kind, baseSettings, validateScheduledSettings(source.settings))
        : inactiveResolution(source.kind, baseSettings);
    }
    if (source.kind === "api") {
      const payload = parseApiPayload(await fetchJson(source.url, { Accept: "application/json" }, options));
      return payload.active
        ? appliedResolution(source.kind, baseSettings, payload.settings)
        : inactiveResolution(source.kind, baseSettings);
    }

    const base = new URL(source.baseUrl);
    const basePath = base.pathname.replace(/\/+$/g, "");
    const stateUrl = new URL(`${basePath}/api/states/${encodeURIComponent(source.entityId)}`, `${base.origin}/`).toString();
    const token = await source.getAccessToken();
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_SCHEDULE_TOKEN_LENGTH) {
      throw new Error("Home Assistant credential is unavailable");
    }
    const active = parseHomeAssistantState(await fetchJson(
      stateUrl,
      { Accept: "application/json", Authorization: `Bearer ${token}` },
      options,
    ));
    return active
      ? appliedResolution(source.kind, baseSettings, validateScheduledSettings(source.settings))
      : inactiveResolution(source.kind, baseSettings);
  } catch {
    return fallbackResolution(kind, previousEffectiveSettings, safeFailureReason());
  }
}

/** Cancels stale refreshes and refuses to let an older response replace newer state. */
export class ScheduleSourceResolver {
  private generation = 0;
  private controller: AbortController | null = null;
  private previousEffective: ScheduledSettings | null = null;

  async refresh(
    source: unknown,
    baseSettings: ScheduledSettings,
    options: ScheduleSourceResolveOptions = {},
  ): Promise<ScheduleResolution> {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const previous = this.previousEffective ?? baseSettings;
    const result = await resolveScheduleSource(source, baseSettings, { ...options, signal: controller.signal }, previous);
    if (generation !== this.generation) {
      return fallbackResolution(sourceKind(source), previous, "Stale schedule response ignored; keeping the last valid local state.");
    }
    this.previousEffective = result.settings;
    return result;
  }

  cancel(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}
