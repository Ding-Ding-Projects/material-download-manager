import { createHash } from "node:crypto";

const MAX_RELEASES_BYTES = 256 * 1024;
const MAX_RELEASES_ENTRIES = 256;

export interface UpdateFeedResponseBodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | ArrayBuffer }>;
  cancel?: () => Promise<void> | void;
}

export interface UpdateFeedResponse {
  status: number;
  ok?: boolean;
  url?: string;
  body?: { getReader: () => UpdateFeedResponseBodyReader };
  text?: () => Promise<string>;
  headers?: { get?: (name: string) => string | null };
}

export interface UpdateFeedFetchInit {
  method: "GET";
  headers?: Record<string, string>;
  signal?: unknown;
  redirect: "follow";
}

export type UpdateFeedFetcher = (url: string, init: UpdateFeedFetchInit) => Promise<UpdateFeedResponse>;

export interface UpdateFeedIntegrity {
  version: string;
  packageName: string;
  packageSize: number;
  packageDigestAlgorithm: "sha1";
  packageDigest: string;
  releasesSha256: string;
}

export interface VerifyUpdateFeedOptions {
  fetcher?: UpdateFeedFetcher;
  timeoutMs?: number;
  signal?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

function responseByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function safeResponseUrl(value: string | undefined, requestedUrl: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    const requested = new URL(requestedUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return false;
    if (url.origin === requested.origin) return true;
    // GitHub's immutable release assets redirect to one of these hosts. Keep
    // the allowlist narrow so an HTTPS redirect cannot turn into an arbitrary
    // metadata endpoint. Signed query material is never returned to callers.
    return requested.hostname === "github.com" && [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
      "github-releases.githubusercontent.com",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

async function readBoundedBody(response: UpdateFeedResponse): Promise<string> {
  const advertisedLength = response.headers?.get?.("content-length");
  if (advertisedLength && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > MAX_RELEASES_BYTES) {
    throw new Error("The update RELEASES metadata is too large.");
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
        if (total > MAX_RELEASES_BYTES) throw new Error("The update RELEASES metadata is too large.");
        chunks.push(chunk);
      }
    } finally {
      if (total > MAX_RELEASES_BYTES) await reader.cancel?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  if (!response.text) throw new Error("The update RELEASES metadata has no readable body.");
  const text = await response.text();
  if (responseByteLength(text) > MAX_RELEASES_BYTES) throw new Error("The update RELEASES metadata is too large.");
  return text;
}

function normalizeFeedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The update feed URL is invalid.");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("The update feed URL must be credential-free HTTPS without a query or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function packageVersion(name: string): string | null {
  const match = /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(?:full|delta)\.nupkg$/i.exec(name);
  return match?.[1] ?? null;
}

function normalizedVersion(value: string | null): string | null {
  if (!value) return null;
  const result = value.trim().replace(/^v(?=\d)/iu, "");
  return result.length > 0 ? result : null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function parseReleases(text: string, requestedVersion: string | null): { version: string; packageName: string; packageSize: number; packageDigest: string } {
  // GitHub's text response can include a UTF-8 BOM; it is transport framing,
  // not part of the first Squirrel digest token. Keep the original bytes for
  // the index SHA-256 evidence while removing only that leading marker here.
  const entries = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (entries.length === 0 || entries.length > MAX_RELEASES_ENTRIES) {
    throw new Error("The update RELEASES metadata has no bounded package entries.");
  }

  const fullPackages: Array<{ version: string; packageName: string; packageSize: number; packageDigest: string }> = [];
  for (const line of entries) {
    const match = /^(?<digest>[a-f0-9]{40})\s+(?<name>[A-Za-z0-9._-]+\.nupkg)\s+(?<size>[1-9]\d*)$/i.exec(line);
    if (!match?.groups) throw new Error("The update RELEASES metadata contains a malformed package entry.");
    const packageName = match.groups.name;
    const packageSize = Number(match.groups.size);
    if (!Number.isSafeInteger(packageSize) || packageSize <= 0) {
      throw new Error("The update RELEASES metadata contains an invalid package size.");
    }
    const version = packageVersion(packageName);
    if (version && /-full\.nupkg$/i.test(packageName)) {
      fullPackages.push({ version, packageName, packageSize, packageDigest: match.groups.digest.toLowerCase() });
    }
  }

  const normalizedRequestedVersion = normalizedVersion(requestedVersion);
  const matchingFull = normalizedRequestedVersion
    ? fullPackages.filter((entry) => entry.version === normalizedRequestedVersion)
    : fullPackages.sort((left, right) => compareVersions(right.version, left.version)).slice(0, 1);
  if (matchingFull.length !== 1) {
    throw new Error(`The update RELEASES metadata does not identify exactly one full package for version ${normalizedRequestedVersion ?? "the newest entry"}.`);
  }
  return matchingFull[0];
}

async function defaultFetcher(url: string, init: UpdateFeedFetchInit): Promise<UpdateFeedResponse> {
  const fetcher = (globalThis as unknown as { fetch?: UpdateFeedFetcher }).fetch;
  if (!fetcher) throw new Error("The main process has no HTTPS fetch implementation for update metadata.");
  return fetcher(url, init);
}

/**
 * Validate the Squirrel feed's own package metadata before the native updater
 * is allowed to report a ready update. RELEASES carries SHA-1 and byte-size
 * metadata; the index body also receives a local SHA-256 evidence value. This
 * is transport/package-integrity metadata, not a signature or authenticity
 * claim.
 */
export async function verifyUpdateFeedIntegrity(
  feedUrl: string,
  version: string | null,
  options: VerifyUpdateFeedOptions = {}
): Promise<UpdateFeedIntegrity> {
  const normalizedFeed = normalizeFeedUrl(feedUrl);
  const releasesUrl = new URL("RELEASES", normalizedFeed).toString();
  const controller = new AbortController();
  const externalSignal = options.signal as {
    aborted?: boolean;
    addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
  } | undefined;
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener?.("abort", () => controller.abort(), { once: true });
  const requestedTimeout = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(Math.floor(requestedTimeout), 1), MAX_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetcher ?? defaultFetcher)(releasesUrl, {
      method: "GET",
      headers: { accept: "text/plain" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (response.status < 200 || response.status >= 300 || response.ok === false) {
      throw new Error("The update RELEASES metadata request was not successful.");
    }
    if (!safeResponseUrl(response.url, releasesUrl)) {
      throw new Error("The update RELEASES metadata request redirected to an unsafe URL.");
    }
    const text = await readBoundedBody(response);
    const parsed = parseReleases(text, version);
    const releasesSha256 = createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
    return { ...parsed, packageDigestAlgorithm: "sha1", releasesSha256 };
  } finally {
    clearTimeout(timer);
  }
}
