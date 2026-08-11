/**
 * Browser-safe RFC 6238 primitives for the extension authenticator surface.
 *
 * This module deliberately has no storage or network side effects. Secret
 * values are accepted only in memory and callers must keep them out of
 * persistent settings, metadata, logs, and ordinary exports.
 */

export const AUTHENTICATOR_SCHEMA_VERSION = 1;
export const TOTP_ALGORITHMS = Object.freeze(["SHA1", "SHA256", "SHA512"]);
export const AUTHENTICATOR_MAX_LABEL_LENGTH = 128;
export const AUTHENTICATOR_MAX_PERIOD_SECONDS = 86_400;
export const AUTHENTICATOR_MAX_SKEW_STEPS = 4;
export const AUTHENTICATOR_MAX_RECORDS = 64;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(field) {
  throw new Error(`Invalid authenticator ${field}`);
}

function normalizeLabel(value, field) {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > AUTHENTICATOR_MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    invalid(field);
  }
  return normalized;
}

export function normalizeTotpSecret(value, allowSeparators = true) {
  if (typeof value !== "string") invalid("secret");
  const candidate = (allowSeparators ? value.replace(/[\s-]/gu, "") : value).toUpperCase();
  if (!candidate || candidate.length > 512 || !/^[A-Z2-7]+=*$/u.test(candidate)) invalid("secret");
  const firstPadding = candidate.indexOf("=");
  const payload = firstPadding < 0 ? candidate : candidate.slice(0, firstPadding);
  const padding = firstPadding < 0 ? "" : candidate.slice(firstPadding);
  if (!payload || payload.length % 8 === 1 || padding.length > 6 || (padding && !/^=+$/u.test(padding))) invalid("secret");
  return payload;
}

function normalizeAlgorithm(value) {
  const algorithm = value === undefined || value === null ? "SHA1" : value;
  if (typeof algorithm !== "string" || !TOTP_ALGORITHMS.includes(algorithm)) invalid("algorithm");
  return algorithm;
}

function normalizeDigits(value) {
  const digits = value === undefined || value === null ? 6 : value;
  if (digits !== 6 && digits !== 8) invalid("digits");
  return digits;
}

function normalizePeriod(value) {
  const period = value === undefined || value === null ? 30 : value;
  if (!Number.isSafeInteger(period) || period < 1 || period > AUTHENTICATOR_MAX_PERIOD_SECONDS) invalid("period");
  return period;
}

export function normalizeTotpRegistration(value) {
  if (!isRecord(value)) invalid("registration");
  return {
    issuer: normalizeLabel(value.issuer, "issuer"),
    account: normalizeLabel(value.account, "account"),
    secret: normalizeTotpSecret(value.secret),
    algorithm: normalizeAlgorithm(value.algorithm),
    digits: normalizeDigits(value.digits),
    period: normalizePeriod(value.period),
  };
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%3A/giu, ":");
}

export function buildTotpUri(value) {
  const registration = normalizeTotpRegistration(value);
  const label = `${registration.issuer}:${registration.account}`;
  const query = [
    `secret=${encodeURIComponent(registration.secret)}`,
    ...(registration.algorithm === "SHA1" ? [] : [`algorithm=${registration.algorithm}`]),
    ...(registration.digits === 6 ? [] : [`digits=${registration.digits}`]),
    ...(registration.period === 30 ? [] : [`period=${registration.period}`]),
  ].join("&");
  return `otpauth://totp/${encodePathSegment(label)}?${query}`;
}

export function parseTotpUri(value) {
  if (typeof value !== "string" || !value || value.length > 8192) invalid("otpauth URI");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid("otpauth URI");
  }
  if (parsed.protocol !== "otpauth:" || parsed.hostname !== "totp" || parsed.username || parsed.password || parsed.port || parsed.hash) {
    invalid("otpauth URI");
  }
  const rawLabel = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : "";
  if (!rawLabel) invalid("otpauth label");
  let label;
  try {
    label = decodeURIComponent(rawLabel);
  } catch {
    invalid("otpauth label");
  }
  const separator = label.indexOf(":");
  const labelIssuer = separator < 0 ? "" : label.slice(0, separator);
  const labelAccount = separator < 0 ? label : label.slice(separator + 1);
  const allowed = new Set(["secret", "issuer", "algorithm", "digits", "period"]);
  const seen = new Set();
  for (const key of parsed.searchParams.keys()) {
    if (seen.has(key) || !allowed.has(key)) invalid("otpauth query");
    seen.add(key);
  }
  const secret = parsed.searchParams.get("secret");
  if (secret === null) invalid("secret");
  const issuerQuery = parsed.searchParams.get("issuer") ?? "";
  const issuer = normalizeLabel(issuerQuery || labelIssuer, "issuer");
  const account = normalizeLabel(labelAccount, "account");
  if (issuerQuery && labelIssuer && issuerQuery !== labelIssuer) invalid("issuer");
  return normalizeTotpRegistration({
    issuer,
    account,
    secret: normalizeTotpSecret(secret, false),
    algorithm: parsed.searchParams.get("algorithm") ?? undefined,
    digits: parsed.searchParams.has("digits") ? Number(parsed.searchParams.get("digits")) : undefined,
    period: parsed.searchParams.has("period") ? Number(parsed.searchParams.get("period")) : undefined,
  });
}

export function createTotpRegistrationModel(value) {
  const registration = normalizeTotpRegistration(value);
  return {
    kind: "totp",
    ...registration,
    otpauthUri: buildTotpUri(registration),
    manualSecret: registration.secret,
  };
}

export function createTotpMetadata(id, value) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(id)) invalid("registration id");
  const registration = normalizeTotpRegistration(value);
  return {
    schemaVersion: AUTHENTICATOR_SCHEMA_VERSION,
    id,
    issuer: registration.issuer,
    account: registration.account,
    algorithm: registration.algorithm,
    digits: registration.digits,
    period: registration.period,
    secretOmitted: true,
  };
}

export function isTotpMetadata(value) {
  if (!isRecord(value) || value.schemaVersion !== AUTHENTICATOR_SCHEMA_VERSION || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(value.id)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "account,algorithm,digits,id,issuer,period,schemaVersion,secretOmitted" || value.secretOmitted !== true) return false;
  try {
    normalizeTotpRegistration({ issuer: value.issuer, account: value.account, secret: "JBSWY3DPEHPK3PXP", algorithm: value.algorithm, digits: value.digits, period: value.period });
    return true;
  } catch {
    return false;
  }
}

export function toSecretFreeMetadata(value) {
  if (!isTotpMetadata(value)) invalid("registration metadata");
  return { ...value, secretOmitted: true };
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of normalizeTotpSecret(value, false)) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) invalid("secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  if (bits >= 5 || (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0)) invalid("secret");
  return new Uint8Array(bytes);
}

function algorithmHash(algorithm) {
  return algorithm === "SHA1" ? "SHA-1" : algorithm === "SHA256" ? "SHA-256" : "SHA-512";
}

function counterBytes(counter) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  const value = BigInt(counter);
  view.setUint32(0, Number((value >> 32n) & 0xffffffffn));
  view.setUint32(4, Number(value & 0xffffffffn));
  return bytes;
}

function assertTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > Number.MAX_SAFE_INTEGER) invalid("timestamp");
}

function assertSkew(skewSteps) {
  if (!Number.isSafeInteger(skewSteps) || skewSteps < 0 || skewSteps > AUTHENTICATOR_MAX_SKEW_STEPS) invalid("clock-skew window");
}

async function codeForCounter(registration, counter) {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle) throw new Error("Browser cryptography is unavailable for the authenticator.");
  const secret = decodeBase32(registration.secret);
  const counterBuffer = counterBytes(counter);
  let digest = null;
  try {
    const key = await webCrypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithmHash(registration.algorithm) }, false, ["sign"]);
    digest = new Uint8Array(await webCrypto.subtle.sign("HMAC", key, counterBuffer));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
    return String(binary % (10 ** registration.digits)).padStart(registration.digits, "0");
  } finally {
    secret.fill(0);
    new Uint8Array(counterBuffer).fill(0);
    digest?.fill(0);
  }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function generateTotpCode(value, timestampMs = Date.now()) {
  const registration = normalizeTotpRegistration(value);
  assertTimestamp(timestampMs);
  const counter = BigInt(Math.floor(timestampMs / 1000 / registration.period));
  return codeForCounter(registration, counter);
}

export async function verifyTotpCode(value, candidate, timestampMs = Date.now(), skewSteps = 1) {
  const registration = normalizeTotpRegistration(value);
  assertTimestamp(timestampMs);
  assertSkew(skewSteps);
  if (typeof candidate !== "string" || !new RegExp(`^\\d{${registration.digits}}$`, "u").test(candidate)) return false;
  const current = BigInt(Math.floor(timestampMs / 1000 / registration.period));
  for (let offset = -skewSteps; offset <= skewSteps; offset += 1) {
    const counter = current + BigInt(offset);
    if (counter < 0n) continue;
    const actual = new TextEncoder().encode(await codeForCounter(registration, counter));
    const expected = new TextEncoder().encode(candidate);
    try {
      if (constantTimeEqual(actual, expected)) return true;
    } finally {
      actual.fill(0);
      expected.fill(0);
    }
  }
  return false;
}
