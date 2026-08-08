import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { Readable } from "node:stream";

import {
  isDistributedRequestHeaders,
  isDistributedSourceUrl,
  isSourceIdentity,
  type SourceIdentity,
} from "../../../shared/distributedProtocol";
import {
  pinnedLookup,
  resolveSafeScheduleAddresses,
  type ScheduleHostnameResolver,
} from "../scheduleSources";
import { isSensitiveRequestHeader } from "../downloadMetadata";

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;

export interface StrictProbeResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Readable;
}

export type StrictProbeRequester = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<StrictProbeResponse>;

export interface StrictSourceProbeOptions {
  requester?: StrictProbeRequester;
  hostnameResolver?: ScheduleHostnameResolver;
  timeoutMs?: number;
}

export interface StrictSourceProbeResult {
  identity: SourceIdentity;
  finalUrl: string;
}

export class DistributedSourceCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributedSourceCapabilityError";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

function strongEtag(value: string | null): string | null {
  if (!value || value.startsWith("W/") || value.length > 1_024 || /[\r\n\0]/u.test(value)) return null;
  return /^"[\x21\x23-\x7e]*"$/u.test(value) ? value : null;
}

function canonicalLastModified(value: string | null): string | null {
  if (!value || value.length > 256 || /[\r\n\0]/u.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const canonical = new Date(parsed).toUTCString();
  return canonical === "Invalid Date" ? null : canonical;
}

function identityFromHeaders(headers: IncomingHttpHeaders, length: number): SourceIdentity {
  const etag = strongEtag(headerValue(headers, "etag"));
  const lastModified = canonicalLastModified(headerValue(headers, "last-modified"));
  const identity: SourceIdentity = { length, etag, lastModified };
  if (!isSourceIdentity(identity)) {
    throw new DistributedSourceCapabilityError("The source did not provide a strong ETag or valid Last-Modified validator");
  }
  return identity;
}

function sameIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.length === right.length && left.etag === right.etag && left.lastModified === right.lastModified;
}

async function readExactlyOneByte(body: Readable): Promise<void> {
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += Buffer.byteLength(chunk as Buffer);
      if (bytes > 1) throw new DistributedSourceCapabilityError("The source returned more than the single probed byte");
    }
  } finally {
    body.destroy();
  }
  if (bytes !== 1) throw new DistributedSourceCapabilityError("The source did not return the single probed byte");
}

function parseContentRange(value: string | null, expectedOffset: number): number {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value ?? "");
  if (!match) throw new DistributedSourceCapabilityError("The source did not return an exact Content-Range");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const length = Number(match[3]);
  if (
    start !== expectedOffset ||
    end !== expectedOffset ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    expectedOffset >= length
  ) {
    throw new DistributedSourceCapabilityError("The source returned a different byte range or length");
  }
  return length;
}

function redirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function stripCrossOriginCredentials(
  headers: Record<string, string>,
  from: URL,
  to: URL,
): Record<string, string> {
  if (from.origin === to.origin) return { ...headers };
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !isSensitiveRequestHeader(name)));
}

async function defaultRequest(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  hostnameResolver?: ScheduleHostnameResolver,
): Promise<StrictProbeResponse> {
  const addresses = await resolveSafeScheduleAddresses(url.toString(), { hostnameResolver });
  const address = addresses[0];
  if (!address) throw new Error("The distributed source hostname did not resolve safely");
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET",
      headers,
      agent: false,
      signal,
      lookup: pinnedLookup(address, false, false),
    }, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function oneByteProbe(
  rawUrl: string,
  offset: number,
  baseHeaders: Record<string, string>,
  expected: SourceIdentity | null,
  options: StrictSourceProbeOptions,
  signal: AbortSignal,
): Promise<StrictSourceProbeResult> {
  let current = new URL(rawUrl);
  let forwardedHeaders = { ...baseHeaders };
  const requester = options.requester ?? ((url, headers, requestSignal) =>
    defaultRequest(url, headers, requestSignal, options.hostnameResolver));
  for (let redirectCount = 0; ; redirectCount += 1) {
    const headers: Record<string, string> = {
      ...forwardedHeaders,
      "accept-encoding": "identity",
      range: `bytes=${offset}-${offset}`,
    };
    if (expected) headers["if-range"] = expected.etag ?? expected.lastModified as string;
    let response: StrictProbeResponse;
    try {
      response = await requester(current, headers, signal);
    } catch (error) {
      if (error instanceof DistributedSourceCapabilityError) throw error;
      throw new DistributedSourceCapabilityError("The source could not be proven range-capable");
    }
    if (redirectStatus(response.statusCode)) {
      const location = headerValue(response.headers, "location");
      response.body.destroy();
      if (!location || redirectCount >= MAX_REDIRECTS) throw new DistributedSourceCapabilityError("The distributed source exceeded its redirect limit");
      const next = new URL(location, current);
      if (!isDistributedSourceUrl(next.toString()) || (current.protocol === "https:" && next.protocol !== "https:")) {
        throw new Error("The distributed source redirected to an unsafe URL");
      }
      forwardedHeaders = stripCrossOriginCredentials(forwardedHeaders, current, next);
      current = next;
      continue;
    }
    if (response.statusCode !== 206) {
      response.body.destroy();
      throw new DistributedSourceCapabilityError("The source does not support immutable HTTP 206 byte ranges");
    }
    const encoding = headerValue(response.headers, "content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") {
      response.body.destroy();
      throw new DistributedSourceCapabilityError("The source returned an encoded byte-range response");
    }
    if (headerValue(response.headers, "content-length") !== "1") {
      response.body.destroy();
      throw new DistributedSourceCapabilityError("The source returned an unexpected Content-Length");
    }
    const length = parseContentRange(headerValue(response.headers, "content-range"), offset);
    const identity = identityFromHeaders(response.headers, length);
    if (expected && !sameIdentity(identity, expected)) {
      response.body.destroy();
      throw new DistributedSourceCapabilityError("The source identity changed between probes");
    }
    await readExactlyOneByte(response.body);
    return { identity, finalUrl: current.toString() };
  }
}

export class StrictSourceProbe {
  constructor(private readonly options: StrictSourceProbeOptions = {}) {}

  async probe(rawUrl: string, requestHeaders: Record<string, string> = {}): Promise<StrictSourceProbeResult> {
    if (!isDistributedSourceUrl(rawUrl)) throw new Error("Distributed downloads require an absolute credential-free HTTP(S) URL");
    if (!isDistributedRequestHeaders(requestHeaders)) throw new Error("Distributed download headers are invalid or unsafe");
    const timeoutMs = Math.min(Math.max(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS, 1_000), 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      const first = await oneByteProbe(rawUrl, 0, requestHeaders, null, this.options, controller.signal);
      const lastOffset = first.identity.length - 1;
      const second = await oneByteProbe(rawUrl, lastOffset, requestHeaders, first.identity, this.options, controller.signal);
      if (!sameIdentity(first.identity, second.identity)) {
        throw new DistributedSourceCapabilityError("The source identity changed between probes");
      }
      return { identity: first.identity, finalUrl: second.finalUrl };
    } catch (error) {
      if (controller.signal.aborted) throw new DistributedSourceCapabilityError("The distributed source probe timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyUnchanged(
    rawUrl: string,
    headers: Record<string, string>,
    expected: SourceIdentity,
  ): Promise<void> {
    if (!isSourceIdentity(expected)) throw new Error("Invalid expected distributed source identity");
    const result = await this.probe(rawUrl, headers);
    if (!sameIdentity(result.identity, expected)) throw new Error("The distributed source changed before assembly");
  }
}
