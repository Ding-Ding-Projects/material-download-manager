import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AUTHENTICATOR_MAX_SKEW_STEPS,
  normalizeTotpRegistration,
  type NormalizedTotpRegistration,
} from "../../shared/authenticator";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret: string): Buffer {
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) throw new Error("Invalid authenticator secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
    }
  }
  if (bits >= 5 || (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0)) {
    throw new Error("Invalid authenticator secret");
  }
  return Buffer.from(output);
}
function algorithmName(algorithm: NormalizedTotpRegistration["algorithm"]): "sha1" | "sha256" | "sha512" {
  if (algorithm === "SHA1") return "sha1";
  if (algorithm === "SHA256") return "sha256";
  return "sha512";
}

function assertTimestamp(timestampMs: number): void {
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid authenticator timestamp");
  }
}

function assertSkew(skewSteps: number): void {
  if (!Number.isSafeInteger(skewSteps) || skewSteps < 0 || skewSteps > AUTHENTICATOR_MAX_SKEW_STEPS) {
    throw new Error("Invalid authenticator clock-skew window");
  }
}

function counterFor(timestampMs: number, period: number): bigint {
  return BigInt(Math.floor(timestampMs / 1_000 / period));
}

function counterBytes(counter: bigint): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(counter);
  return result;
}

function codeForCounter(registration: NormalizedTotpRegistration, counter: bigint): string {
  const secret = decodeBase32(registration.secret);
  const counterValue = counterBytes(counter);
  try {
    const digest = createHmac(algorithmName(registration.algorithm), secret).update(counterValue).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    return String(binary % (10 ** registration.digits)).padStart(registration.digits, "0");
  } finally {
    secret.fill(0);
    counterValue.fill(0);
  }
}

/** Generate one RFC 6238 code for the supplied timestamp (milliseconds). */
export function generateTotpCode(value: unknown, timestampMs = Date.now()): string {
  const registration = normalizeTotpRegistration(value);
  assertTimestamp(timestampMs);
  return codeForCounter(registration, counterFor(timestampMs, registration.period));
}

/**
 * Verify a code against the current time and a bounded number of adjacent
 * periods. The comparison is constant-time for every candidate of the right
 * length, and malformed codes are rejected before any secret operation.
 */
export function verifyTotpCode(
  value: unknown,
  candidate: unknown,
  timestampMs = Date.now(),
  skewSteps = 1,
): boolean {
  const registration = normalizeTotpRegistration(value);
  assertTimestamp(timestampMs);
  assertSkew(skewSteps);
  if (typeof candidate !== "string" || !new RegExp(`^\\d{${registration.digits}}$`, "u").test(candidate)) return false;
  const currentCounter = counterFor(timestampMs, registration.period);
  const expected = Buffer.from(candidate, "ascii");
  try {
    for (let offset = -skewSteps; offset <= skewSteps; offset += 1) {
      const counter = currentCounter + BigInt(offset);
      if (counter < 0n) continue;
      const actual = Buffer.from(codeForCounter(registration, counter), "ascii");
      try {
        if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
      } finally {
        actual.fill(0);
      }
    }
    return false;
  } finally {
    expected.fill(0);
  }
}
