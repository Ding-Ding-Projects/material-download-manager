/**
 * Secret-bearing authenticator registration primitives shared by the main
 * process and the type boundary. Callers must keep the secret-bearing values
 * in memory only; persistent metadata and renderer responses use the
 * secret-free types below.
 */

export const AUTHENTICATOR_SCHEMA_VERSION = 1 as const;
export const TOTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];
export type TotpDigits = 6 | 8;

export const AUTHENTICATOR_MAX_LABEL_LENGTH = 128;
export const AUTHENTICATOR_MAX_PERIOD_SECONDS = 86_400;
export const AUTHENTICATOR_MAX_SKEW_STEPS = 4;

/** Input accepted by the main-process registration boundary. */
export interface TotpRegistrationInput {
  issuer: string;
  account: string;
  secret: string;
  algorithm?: TotpAlgorithm;
  digits?: TotpDigits;
  period?: number;
}

/** Normalized secret-bearing registration, retained in memory only. */
export interface NormalizedTotpRegistration {
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  period: number;
}

/** Stable metadata safe to return through IPC and place in ordinary exports. */
export interface TotpRegistrationMetadata {
  schemaVersion: typeof AUTHENTICATOR_SCHEMA_VERSION;
  id: string;
  issuer: string;
  account: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  period: number;
}

/** Ordinary exports intentionally say that the credential was omitted. */
export interface TotpRegistrationExportRecord extends TotpRegistrationMetadata {
  secretOmitted: true;
}

/**
 * One-time QR/manual registration material. This object contains the secret
 * by design and must never be persisted, logged, snapshotted, or returned by
 * an ordinary metadata/export IPC method.
 */
export interface TotpQrRegistrationModel extends NormalizedTotpRegistration {
  kind: "totp";
  otpauthUri: string;
  manualSecret: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(field: string): never {
  throw new Error(`Invalid authenticator ${field}`);
}

function normalizeLabel(value: unknown, field: "issuer" | "account"): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > AUTHENTICATOR_MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    invalid(field);
  }
  return normalized;
}

function normalizeAlgorithm(value: unknown): TotpAlgorithm {
  const algorithm = value === undefined || value === null ? "SHA1" : value;
  if (typeof algorithm !== "string" || !(TOTP_ALGORITHMS as readonly string[]).includes(algorithm)) {
    invalid("algorithm");
  }
  return algorithm as TotpAlgorithm;
}

function normalizeDigits(value: unknown): TotpDigits {
  const digits = value === undefined || value === null ? 6 : value;
  if (digits !== 6 && digits !== 8) invalid("digits");
  return digits;
}

function normalizePeriod(value: unknown): number {
  const period = value === undefined || value === null ? 30 : value;
  if (typeof period !== "number" || !Number.isSafeInteger(period) || period < 1 || period > AUTHENTICATOR_MAX_PERIOD_SECONDS) {
    invalid("period");
  }
  return period;
}

/** Normalize a manually entered RFC 4648 base32 secret without retaining padding. */
export function normalizeTotpSecret(value: unknown, allowSeparators = true): string {
  if (typeof value !== "string") invalid("secret");
  const candidate = allowSeparators ? value.replace(/[\s-]/gu, "") : value;
  if (candidate.length === 0 || candidate.length > 512 || !/^[A-Za-z2-7]+=*$/u.test(candidate)) {
    invalid("secret");
  }
  const firstPadding = candidate.indexOf("=");
  const payload = firstPadding < 0 ? candidate : candidate.slice(0, firstPadding);
  const padding = firstPadding < 0 ? "" : candidate.slice(firstPadding);
  if (padding.length > 6 || (padding.length > 0 && !/^=+$/u.test(padding)) || payload.length % 8 === 1 || payload.length === 0) {
    invalid("secret");
  }
  return payload.toUpperCase();
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%3A/giu, ":");
}

function queryValue(value: string): string {
  return encodeURIComponent(value);
}

/** Build the standards-compatible URI used by a local QR renderer. */
export function buildTotpUri(registration: NormalizedTotpRegistration): string {
  const normalized = normalizeTotpRegistration(registration);
  const label = normalized.issuer ? `${normalized.issuer}:${normalized.account}` : normalized.account;
  const query = [
    `secret=${queryValue(normalized.secret)}`,
    `issuer=${queryValue(normalized.issuer)}`,
    `algorithm=${normalized.algorithm}`,
    `digits=${normalized.digits}`,
    `period=${normalized.period}`,
  ].join("&");
  return `otpauth://totp/${encodePathSegment(label)}?${query}`;
}

/** Parse and validate a local `otpauth://totp/` URI without leaking secrets in errors. */
export function parseTotpUri(value: unknown): NormalizedTotpRegistration {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) invalid("otpauth URI");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid("otpauth URI");
  }
  if (parsed.protocol !== "otpauth:" || parsed.hostname !== "totp" || parsed.username || parsed.password || parsed.hash || parsed.port) {
    invalid("otpauth URI");
  }
  const rawLabel = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : "";
  if (!rawLabel) invalid("otpauth label");
  let label: string;
  try {
    label = decodeURIComponent(rawLabel);
  } catch {
    invalid("otpauth label");
  }
  const separator = label.indexOf(":");
  const labelIssuer = separator < 0 ? "" : label.slice(0, separator);
  const labelAccount = separator < 0 ? label : label.slice(separator + 1);
  const keys = new Set<string>();
  parsed.searchParams.forEach((_item, key) => {
    if (keys.has(key) || !["secret", "issuer", "algorithm", "digits", "period"].includes(key)) {
      invalid("otpauth query");
    }
    keys.add(key);
  });
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

export function normalizeTotpRegistration(value: unknown): NormalizedTotpRegistration {
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

export function createTotpQrRegistrationModel(value: unknown): TotpQrRegistrationModel {
  const registration = normalizeTotpRegistration(value);
  return {
    kind: "totp",
    ...registration,
    otpauthUri: buildTotpUri(registration),
    manualSecret: registration.secret,
  };
}

export function createTotpMetadata(id: string, value: NormalizedTotpRegistration): TotpRegistrationMetadata {
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
  };
}

export function toSecretFreeTotpExport(value: TotpRegistrationMetadata): TotpRegistrationExportRecord {
  if (!isTotpRegistrationMetadata(value)) invalid("registration metadata");
  return { ...value, secretOmitted: true };
}

export function isTotpRegistrationMetadata(value: unknown): value is TotpRegistrationMetadata {
  if (!isRecord(value) || value.schemaVersion !== AUTHENTICATOR_SCHEMA_VERSION || typeof value.id !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/u.test(value.id)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 7 || keys.some((key) => typeof key !== "string" ||
    !["schemaVersion", "id", "issuer", "account", "algorithm", "digits", "period"].includes(key))) return false;
  try {
    normalizeTotpRegistration({
      issuer: value.issuer,
      account: value.account,
      secret: "JBSWY3DPEHPK3PXP", // validation-only placeholder; metadata never carries a secret
      algorithm: value.algorithm,
      digits: value.digits,
      period: value.period,
    });
  } catch {
    return false;
  }
  return typeof value.issuer === "string" && typeof value.account === "string" &&
    typeof value.algorithm === "string" && (value.digits === 6 || value.digits === 8) &&
    typeof value.period === "number";
}

export function isTotpRegistrationExportRecord(value: unknown): value is TotpRegistrationExportRecord {
  if (!isRecord(value) || !isTotpRegistrationMetadata({
    schemaVersion: value.schemaVersion,
    id: value.id,
    issuer: value.issuer,
    account: value.account,
    algorithm: value.algorithm,
    digits: value.digits,
    period: value.period,
  })) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 8 && keys.some((key) => key === "secretOmitted") &&
    (value as unknown as Record<string, unknown>).secretOmitted === true;
}
