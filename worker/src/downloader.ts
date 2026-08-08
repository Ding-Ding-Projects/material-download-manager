import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";

import {
  FRAME_LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  type EndFrame,
  type MetaFrame,
  type RangeRequest,
} from "./protocol.js";
import {
  headersForRedirect,
  hostnameForLookup,
  isPublicAddress,
  parseSourceUrl,
  resolveAndPin,
  resolveRedirect,
  type ResolveHost,
} from "./network-policy.js";

export interface DownloadTimeouts {
  dnsMs: number;
  connectMs: number;
  headersMs: number;
  idleMs: number;
  wallMs: number;
}

export interface DownloadDependencies {
  resolveHost: ResolveHost;
  addressPolicy: (address: string) => boolean;
  requestHttp: typeof http.request;
  requestHttps: typeof https.request;
  timeouts: DownloadTimeouts;
  maxRedirects: number;
}

export interface FrameSink {
  meta(frame: MetaFrame): Promise<void>;
  data(chunk: Buffer): Promise<void>;
  end(frame: EndFrame): Promise<void>;
}

export const DEFAULT_TIMEOUTS: DownloadTimeouts = Object.freeze({
  dnsMs: 5_000,
  connectMs: 10_000,
  headersMs: 15_000,
  idleMs: 30_000,
  wallMs: 15 * 60_000,
});

export const DEFAULT_DOWNLOAD_DEPENDENCIES: DownloadDependencies = Object.freeze({
  resolveHost: async (hostname: string) => {
    const answers = await dns.lookup(hostname, { all: true, verbatim: true });
    return answers.map((answer) => ({ address: answer.address, family: answer.family as 4 | 6 }));
  },
  addressPolicy: isPublicAddress,
  requestHttp: http.request,
  requestHttps: https.request,
  timeouts: DEFAULT_TIMEOUTS,
  maxRedirects: 5,
});

function timeoutError(_message: string): ProtocolError {
  return new ProtocolError("source-unavailable", true);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(message)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface ResponseResult {
  response: http.IncomingMessage;
  request: http.ClientRequest;
}

async function openResponse(
  url: URL,
  headers: Record<string, string>,
  dependencies: DownloadDependencies,
  signal: AbortSignal,
): Promise<ResponseResult> {
  const lookupHostname = hostnameForLookup(url.hostname);
  const pinned = await withTimeout(
    resolveAndPin(lookupHostname, dependencies.resolveHost, dependencies.addressPolicy),
    dependencies.timeouts.dnsMs,
    "DNS resolution timed out.",
  );
  return await new Promise<ResponseResult>((resolve, reject) => {
    let settled = false;
    let connectTimer: NodeJS.Timeout | undefined;
    const headersTimer = setTimeout(
      () => request.destroy(timeoutError("The source did not return headers in time.")),
      dependencies.timeouts.headersMs,
    );
    headersTimer.unref();
    const requestFunction = url.protocol === "https:" ? dependencies.requestHttps : dependencies.requestHttp;
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    };
    const request = requestFunction({
      protocol: url.protocol,
      hostname: lookupHostname,
      port: url.port || undefined,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers,
      signal,
      servername: url.protocol === "https:" && isIP(lookupHostname) === 0 ? url.hostname : undefined,
      lookup: pinnedLookup,
      agent: false,
    });
    const cleanup = (): void => {
      clearTimeout(headersTimer);
      if (connectTimer) clearTimeout(connectTimer);
    };
    request.once("socket", (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(
        () => request.destroy(timeoutError("Connecting to the source timed out.")),
        dependencies.timeouts.connectMs,
      );
      connectTimer.unref();
      const connectedEvent = url.protocol === "https:" ? "secureConnect" : "connect";
      socket.once(connectedEvent, () => {
        if (connectTimer) clearTimeout(connectTimer);
      });
    });
    request.setTimeout(dependencies.timeouts.idleMs, () => {
      request.destroy(timeoutError("The source connection became idle."));
    });
    request.once("response", (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      response.setTimeout(dependencies.timeouts.idleMs, () => {
        response.destroy(timeoutError("The source response became idle."));
      });
      resolve({ response, request });
    });
    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.aborted && signal.reason instanceof ProtocolError
        ? signal.reason
        : error instanceof ProtocolError
        ? error
        : new ProtocolError("source-unavailable", true));
    });
    request.end();
  });
}

function redirectStatus(statusCode: number | undefined): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function headerValues(response: http.IncomingMessage, name: string): string[] {
  if (Array.isArray(response.rawHeaders)) {
    const values: string[] = [];
    for (let index = 0; index + 1 < response.rawHeaders.length; index += 2) {
      if (response.rawHeaders[index]?.toLowerCase() === name) {
        values.push(response.rawHeaders[index + 1] as string);
      }
    }
    return values;
  }
  const value = response.headers[name];
  return typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
}

function singleHeader(response: http.IncomingMessage, name: string): string | undefined {
  const values = headerValues(response, name);
  return values.length === 1 ? values[0] : undefined;
}

function validateRangeResponse(request: RangeRequest, response: http.IncomingMessage): void {
  if (response.statusCode !== 206) {
    throw new ProtocolError("range-rejected", true);
  }
  const contentEncodings = headerValues(response, "content-encoding");
  if (contentEncodings.length > 1
      || (contentEncodings[0] && contentEncodings[0].toLowerCase() !== "identity")) {
    throw new ProtocolError("range-rejected");
  }
  const contentRange = singleHeader(response, "content-range");
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(contentRange ?? "");
  const expectedEnd = request.range.endExclusive - 1;
  if (!match || Number(match[1]) !== request.range.start || Number(match[2]) !== expectedEnd
      || Number(match[3]) !== request.source.length) {
    throw new ProtocolError("range-rejected");
  }
  const expectedLength = request.range.endExclusive - request.range.start;
  const contentLength = singleHeader(response, "content-length");
  if (!contentLength || !/^\d+$/u.test(contentLength) || Number(contentLength) !== expectedLength) {
    throw new ProtocolError("range-rejected");
  }
  if (request.source.etag) {
    if (singleHeader(response, "etag") !== request.source.etag) {
      throw new ProtocolError("source-changed", true);
    }
  }
  if (request.source.lastModified !== null
      && singleHeader(response, "last-modified") !== request.source.lastModified) {
    throw new ProtocolError("source-changed", true);
  }
}

async function destroyResponse(response: Readable): Promise<void> {
  response.destroy();
  await Promise.resolve();
}

export async function downloadRange(
  rangeRequest: RangeRequest,
  sink: FrameSink,
  overrides: Partial<DownloadDependencies> = {},
  externalSignal?: AbortSignal,
): Promise<EndFrame> {
  const dependencies: DownloadDependencies = {
    ...DEFAULT_DOWNLOAD_DEPENDENCIES,
    ...overrides,
    timeouts: { ...DEFAULT_TIMEOUTS, ...overrides.timeouts },
  };
  const controller = new AbortController();
  const abortFromExternal = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const wallTimer = setTimeout(
    () => controller.abort(timeoutError("The range exceeded the wall-clock limit.")),
    dependencies.timeouts.wallMs,
  );
  wallTimer.unref();
  let currentUrl = parseSourceUrl(rangeRequest.url);
  let forwardedHeaders = { ...rangeRequest.headers };
  const ifRange = (rangeRequest.source.etag ?? rangeRequest.source.lastModified) as string;
  try {
    for (let redirects = 0; ; redirects += 1) {
      const headers = {
        ...forwardedHeaders,
        "accept-encoding": "identity",
        "if-range": ifRange,
        range: `bytes=${rangeRequest.range.start}-${rangeRequest.range.endExclusive - 1}`,
      };
      const { response } = await openResponse(currentUrl, headers, dependencies, controller.signal);
      if (redirectStatus(response.statusCode)) {
        const location = singleHeader(response, "location");
        if (!location || redirects >= dependencies.maxRedirects) {
          await destroyResponse(response);
          throw new ProtocolError("source-unavailable");
        }
        const nextUrl = resolveRedirect(currentUrl, location);
        forwardedHeaders = headersForRedirect(forwardedHeaders, currentUrl, nextUrl);
        currentUrl = nextUrl;
        await destroyResponse(response);
        continue;
      }
      validateRangeResponse(rangeRequest, response);
      const meta: MetaFrame = {
        version: PROTOCOL_VERSION,
        type: "meta",
        requestId: rangeRequest.requestId,
        pieceId: rangeRequest.pieceId,
        range: { ...rangeRequest.range },
        source: { ...rangeRequest.source },
      };
      await sink.meta(meta);
      const hash = createHash("sha256");
      const expectedLength = rangeRequest.range.endExclusive - rangeRequest.range.start;
      let byteLength = 0;
      try {
        for await (const rawChunk of response) {
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
          byteLength += chunk.byteLength;
          if (byteLength > expectedLength) {
            throw new ProtocolError("transfer-failed");
          }
          hash.update(chunk);
          for (let offset = 0; offset < chunk.byteLength; offset += FRAME_LIMITS.data) {
            await sink.data(chunk.subarray(offset, Math.min(offset + FRAME_LIMITS.data, chunk.byteLength)));
          }
        }
      } finally {
        response.destroy();
      }
      if (byteLength !== expectedLength) {
        throw new ProtocolError("transfer-failed", true);
      }
      const end: EndFrame = {
        version: PROTOCOL_VERSION,
        type: "end",
        requestId: rangeRequest.requestId,
        pieceId: rangeRequest.pieceId,
        range: { ...rangeRequest.range },
        byteLength,
        sha256: hash.digest("hex"),
      };
      await sink.end(end);
      return end;
    }
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof ProtocolError)) {
      throw timeoutError("The range exceeded the wall-clock limit.");
    }
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("transfer-failed", true);
  } finally {
    clearTimeout(wallTimer);
    externalSignal?.removeEventListener("abort", abortFromExternal);
    controller.abort();
  }
}
