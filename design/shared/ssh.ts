import type { SshBootstrapAuthMode, SshHostConfig } from "./types";

export const SSH_HOST_LIMIT = 16;
export const SSH_HOST_NAME_MAX_LENGTH = 64;
export const SSH_PRIVATE_KEY_MAX_BYTES = 64 * 1024;
export const SSH_PASSPHRASE_MAX_LENGTH = 1024;

export interface SshPrivateKeyCredentialInput {
  privateKey: string;
  passphrase: string | null;
}

/** Renderer-safe host draft. Main derives worker pin, trust, and provision time. */
export interface SshHostDraft {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  username: string;
  hostKeySha256: string;
  bootstrapAuthMode: SshBootstrapAuthMode;
  workerPort: number;
  enabled: boolean;
}

export interface SshHostKeyScanResult {
  hostKeySha256: string;
  algorithm: string;
}

export type SshHostOperationState =
  | "unconfigured"
  | "checking"
  | "ready"
  | "degraded"
  | "provisioning"
  | "failed";

export interface SshHostStatus {
  hostId: string;
  state: SshHostOperationState;
  checkedAt: number;
  latencyMs: number | null;
  workerProtocolVersion: number | null;
  message: string;
}

export interface SshProvisionResult {
  hostId: string;
  state: "applied" | "unchanged";
  workerHostKeySha256: string;
  checkedAt: number;
  message: string;
}

const HOST_CONFIG_KEYS = new Set([
  "id",
  "name",
  "host",
  "sshPort",
  "username",
  "hostKeySha256",
  "bootstrapAuthMode",
  "workerPort",
  "workerHostKeySha256",
  "enabled",
  "trustedForSourceSecrets",
  "provisionedAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactStringKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every((key) => typeof key === "string" && expected.has(key));
}

export function isStableSshIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}

export function isSshHostKeyFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^SHA256:[A-Za-z0-9+/]{43}$/u.test(value);
}

function isIpv4Literal(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255)
  );
}

function isIpv6Candidate(value: string): boolean {
  if (!value.includes(":") || value.length > 45 || !/^[0-9a-fA-F:]+$/u.test(value)) return false;
  const compressionCount = (value.match(/::/gu) ?? []).length;
  if (compressionCount > 1) return false;
  const groups = value.split(":");
  if (groups.some((group) => group.length > 4 || !/^[0-9a-fA-F]{0,4}$/u.test(group))) return false;
  const groupCount = groups.filter(Boolean).length;
  return compressionCount === 1 ? groupCount < 8 : groupCount === 8;
}

function isDnsName(value: string): boolean {
  if (value.length > 253 || value.endsWith(".")) return false;
  const labels = value.split(".");
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  );
}

export function isSshHostname(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    value.trim() === value &&
    !/[\s\0/@?#\\]/u.test(value) &&
    (/^[0-9.]+$/u.test(value) ? isIpv4Literal(value) :
      value.includes(":") ? isIpv6Candidate(value) : isDnsName(value))
  );
}

export function isSshUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/u.test(value);
}

export function isSshPort(value: unknown, allowPrivileged = true): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (allowPrivileged ? 1 : 1024) &&
    value <= 65_535
  );
}

export function isSshBootstrapAuthMode(value: unknown): value is SshBootstrapAuthMode {
  return value === "system-agent" || value === "stored-private-key";
}

export function isSshHostConfig(value: unknown): value is SshHostConfig {
  if (!isRecord(value) || !hasExactStringKeys(value, HOST_CONFIG_KEYS)) return false;
  return (
    isStableSshIdentifier(value.id) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= SSH_HOST_NAME_MAX_LENGTH &&
    value.name.trim() === value.name &&
    isSshHostname(value.host) &&
    isSshPort(value.sshPort) &&
    isSshUsername(value.username) &&
    isSshHostKeyFingerprint(value.hostKeySha256) &&
    isSshBootstrapAuthMode(value.bootstrapAuthMode) &&
    isSshPort(value.workerPort, false) &&
    (value.workerHostKeySha256 === null || isSshHostKeyFingerprint(value.workerHostKeySha256)) &&
    typeof value.enabled === "boolean" &&
    typeof value.trustedForSourceSecrets === "boolean" &&
    (value.provisionedAt === null ||
      (typeof value.provisionedAt === "number" && Number.isSafeInteger(value.provisionedAt) && value.provisionedAt > 0))
  );
}

export function isSshHostDraft(value: unknown): value is SshHostDraft {
  if (!isRecord(value)) return false;
  const expected = new Set([
    "id", "name", "host", "sshPort", "username", "hostKeySha256",
    "bootstrapAuthMode", "workerPort", "enabled",
  ]);
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key)) &&
    isStableSshIdentifier(value.id) &&
    typeof value.name === "string" && value.name.length > 0 &&
    value.name.length <= SSH_HOST_NAME_MAX_LENGTH && value.name.trim() === value.name &&
    isSshHostname(value.host) && isSshPort(value.sshPort) && isSshUsername(value.username) &&
    isSshHostKeyFingerprint(value.hostKeySha256) &&
    isSshBootstrapAuthMode(value.bootstrapAuthMode) && isSshPort(value.workerPort, false) &&
    typeof value.enabled === "boolean";
}

export function isSshHostConfigs(value: unknown): value is SshHostConfig[] {
  if (!Array.isArray(value) || value.length > SSH_HOST_LIMIT || !value.every(isSshHostConfig)) return false;
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  for (const host of value) {
    const endpoint = `${host.host.toLowerCase()}:${host.sshPort}`;
    if (ids.has(host.id) || endpoints.has(endpoint)) return false;
    ids.add(host.id);
    endpoints.add(endpoint);
  }
  return true;
}

export function cloneSshHostConfigs(value: readonly SshHostConfig[]): SshHostConfig[] {
  return value.map((host) => ({ ...host }));
}

export function normalizeSshPrivateKeyCredential(value: unknown): SshPrivateKeyCredentialInput {
  if (!isRecord(value)) throw new Error("Invalid SSH private-key credential");
  const expected = new Set(["privateKey", "passphrase"]);
  if (!hasExactStringKeys(value, expected)) throw new Error("Invalid SSH private-key credential");
  if (
    typeof value.privateKey !== "string" ||
    new TextEncoder().encode(value.privateKey).byteLength === 0 ||
    new TextEncoder().encode(value.privateKey).byteLength > SSH_PRIVATE_KEY_MAX_BYTES ||
    value.privateKey.includes("\0") ||
    !value.privateKey.includes("PRIVATE KEY")
  ) {
    throw new Error("Invalid SSH private key");
  }
  if (
    value.passphrase !== null &&
    (typeof value.passphrase !== "string" ||
      value.passphrase.length > SSH_PASSPHRASE_MAX_LENGTH ||
      value.passphrase.includes("\0"))
  ) {
    throw new Error("Invalid SSH private-key passphrase");
  }
  return { privateKey: value.privateKey, passphrase: value.passphrase as string | null };
}

export function isSshHostKeyScanResult(value: unknown): value is SshHostKeyScanResult {
  return (
    isRecord(value) &&
    hasExactStringKeys(value, new Set(["hostKeySha256", "algorithm"])) &&
    isSshHostKeyFingerprint(value.hostKeySha256) &&
    typeof value.algorithm === "string" &&
    /^[A-Za-z0-9@._+-]{1,64}$/u.test(value.algorithm)
  );
}

export function isSshHostStatus(value: unknown): value is SshHostStatus {
  if (!isRecord(value) || !hasExactStringKeys(value, new Set([
    "hostId",
    "state",
    "checkedAt",
    "latencyMs",
    "workerProtocolVersion",
    "message",
  ]))) return false;
  return (
    isStableSshIdentifier(value.hostId) &&
    ["unconfigured", "checking", "ready", "degraded", "provisioning", "failed"].includes(String(value.state)) &&
    typeof value.checkedAt === "number" &&
    Number.isSafeInteger(value.checkedAt) &&
    value.checkedAt >= 0 &&
    (value.latencyMs === null ||
      (typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs) && value.latencyMs >= 0)) &&
    (value.workerProtocolVersion === null || value.workerProtocolVersion === 1) &&
    typeof value.message === "string" &&
    value.message.length <= 512
  );
}

export function isSshProvisionResult(value: unknown): value is SshProvisionResult {
  return (
    isRecord(value) &&
    hasExactStringKeys(value, new Set([
      "hostId",
      "state",
      "workerHostKeySha256",
      "checkedAt",
      "message",
    ])) &&
    isStableSshIdentifier(value.hostId) &&
    (value.state === "applied" || value.state === "unchanged") &&
    isSshHostKeyFingerprint(value.workerHostKeySha256) &&
    typeof value.checkedAt === "number" &&
    Number.isSafeInteger(value.checkedAt) &&
    value.checkedAt > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 512
  );
}
