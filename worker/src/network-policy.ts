import { isIP } from "node:net";

import { ProtocolError } from "./protocol.js";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export function hostnameForLookup(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseIPv4(address: string): number | undefined {
  const pieces = address.split(".");
  if (pieces.length !== 4) return undefined;
  let result = 0;
  for (const piece of pieces) {
    if (!/^\d{1,3}$/u.test(piece)) return undefined;
    const value = Number(piece);
    if (value > 255) return undefined;
    result = result * 256 + value;
  }
  return result >>> 0;
}

function ipv4InCidr(value: number, base: number, prefix: number): boolean {
  const divisor = 2 ** (32 - prefix);
  return Math.floor(value / divisor) === Math.floor(base / divisor);
}

function parseIPv6(address: string): bigint | undefined {
  let input = address.toLowerCase();
  const zoneIndex = input.indexOf("%");
  if (zoneIndex !== -1) input = input.slice(0, zoneIndex);
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) return undefined;
    const v4 = parseIPv4(input.slice(lastColon + 1));
    if (v4 === undefined) return undefined;
    input = `${input.slice(0, lastColon)}:${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined;
  let result = 0n;
  for (const group of groups) result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  return result;
}

function ipv6InCidr(value: bigint, base: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (base >> shift);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = parseIPv4(address);
    if (value === undefined) return false;
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, prefix]) => ipv4InCidr(value, parseIPv4(base) as number, prefix));
  }
  if (family === 6) {
    const value = parseIPv6(address);
    if (value === undefined) return false;
    const globalBase = parseIPv6("2000::") as bigint;
    if (!ipv6InCidr(value, globalBase, 3)) return false;
    const blocked: Array<[string, number]> = [
      ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
    ];
    return !blocked.some(([base, prefix]) => ipv6InCidr(value, parseIPv6(base) as bigint, prefix));
  }
  return false;
}

export async function resolveAndPin(
  hostname: string,
  resolveHost: ResolveHost,
  addressPolicy: (address: string) => boolean = isPublicAddress,
): Promise<ResolvedAddress> {
  const lookupHostname = hostnameForLookup(hostname);
  const literalFamily = isIP(lookupHostname);
  if (literalFamily !== 0) {
    if (!addressPolicy(lookupHostname)) throw new ProtocolError("source-unavailable");
    return { address: lookupHostname, family: literalFamily as 4 | 6 };
  }
  let answers: ResolvedAddress[];
  try {
    answers = await resolveHost(lookupHostname);
  } catch {
    throw new ProtocolError("source-unavailable", true);
  }
  if (answers.length === 0 || answers.length > 32) {
    throw new ProtocolError("source-unavailable", true);
  }
  if (answers.some((answer) => isIP(answer.address) !== answer.family || !addressPolicy(answer.address))) {
    throw new ProtocolError("source-unavailable");
  }
  return answers[0] as ResolvedAddress;
}

export const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "referer",
  "x-api-key",
  "x-auth-token",
]);

export function headersForRedirect(headers: Record<string, string>, from: URL, to: URL): Record<string, string> {
  if (from.origin === to.origin) return { ...headers };
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name)));
}

export function parseSourceUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ProtocolError("invalid-request");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.hash) {
    throw new ProtocolError("invalid-request");
  }
  return url;
}

export function resolveRedirect(from: URL, location: string): URL {
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    throw new ProtocolError("source-unavailable");
  }
  if ((target.protocol !== "http:" && target.protocol !== "https:") || target.username || target.password || target.hash) {
    throw new ProtocolError("source-unavailable");
  }
  if (from.protocol === "https:" && target.protocol !== "https:") {
    throw new ProtocolError("source-unavailable");
  }
  return target;
}

export function safeLogRecord(event: string, fields: Record<string, unknown> = {}): string {
  const allowed: Record<string, unknown> = { event };
  for (const key of ["requestId", "pieceId", "code", "retryable", "bytes", "durationMs"] as const) {
    const value = fields[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") allowed[key] = value;
  }
  return JSON.stringify(allowed);
}
