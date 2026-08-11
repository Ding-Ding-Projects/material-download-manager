import { AsyncEntry } from "@napi-rs/keyring";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const SERVICE_NAME = "MaterialDownloadManager.History.v1";
const ACCOUNT_NAME = "history-access";
const RECORD_VERSION = 1 as const;
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const MAX_RECORD_BYTES = 4 * 1024;

function scopedAccountName(scope: string | undefined): string {
  const normalized = typeof scope === "string"
    ? scope.trim().replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48)
    : "";
  return normalized ? `${ACCOUNT_NAME}-${normalized}` : ACCOUNT_NAME;
}

interface HistoryAccessRecord {
  version: typeof RECORD_VERSION;
  salt: string;
  verifier: string;
}

export interface HistoryAccessVaultAdapter {
  read(): Promise<Uint8Array | null>;
  write(value: Uint8Array): Promise<void>;
  remove(): Promise<void>;
}

class OperatingSystemHistoryAccessAdapter implements HistoryAccessVaultAdapter {
  private readonly entry: AsyncEntry;

  constructor(scope = process.env.MDM_HISTORY_ACCESS_SCOPE) {
    this.entry = new AsyncEntry(SERVICE_NAME, scopedAccountName(scope));
  }

  async read(): Promise<Uint8Array | null> {
    const value = await this.entry.getSecret();
    return value ? new Uint8Array(value) : null;
  }

  async write(value: Uint8Array): Promise<void> {
    await this.entry.setSecret(value);
  }

  async remove(): Promise<void> {
    await this.entry.deleteCredential().catch((error: unknown) => {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("no entry") && !message.includes("not found")) throw error;
    });
  }
}

function assertPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`History password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
  }
}

function decodeBase64(value: string, expectedLength: number, label: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== expectedLength || bytes.toString("base64") !== value) throw new Error(`Invalid history access ${label}`);
  return bytes;
}

function parseRecord(bytes: Uint8Array): HistoryAccessRecord | null {
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_RECORD_BYTES) throw new Error("History access credential is too large");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("History access credential is corrupt");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("History access credential is corrupt");
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 3 || keys.some((key) => typeof key !== "string" || !["version", "salt", "verifier"].includes(key))) {
    throw new Error("History access credential has an invalid schema");
  }
  if (record.version !== RECORD_VERSION || typeof record.salt !== "string" || typeof record.verifier !== "string") {
    throw new Error("History access credential has an invalid schema");
  }
  decodeBase64(record.salt, SALT_BYTES, "salt");
  decodeBase64(record.verifier, VERIFIER_BYTES, "verifier");
  return { version: RECORD_VERSION, salt: record.salt, verifier: record.verifier };
}

async function deriveVerifier(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, VERIFIER_BYTES, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    }, (error, derived) => {
      if (error) reject(error);
      else resolve(Buffer.from(derived));
    });
  });
}

/** OS-vault-backed password verifier for the local History surface. */
export class HistoryAccessVault {
  constructor(private readonly adapter: HistoryAccessVaultAdapter = new OperatingSystemHistoryAccessAdapter()) {}

  async remove(): Promise<void> {
    await this.adapter.remove();
  }

  async isConfigured(): Promise<boolean> {
    const bytes = await this.adapter.read();
    if (!bytes) return false;
    try {
      return parseRecord(bytes) !== null;
    } finally {
      bytes.fill(0);
    }
  }

  async configure(password: string): Promise<void> {
    assertPassword(password);
    const existing = await this.adapter.read();
    if (existing) {
      try {
        if (parseRecord(existing)) throw new Error("History access is already configured");
      } finally {
        existing.fill(0);
      }
    }
    const salt = randomBytes(SALT_BYTES);
    const verifier = await deriveVerifier(password, salt);
    const record: HistoryAccessRecord = {
      version: RECORD_VERSION,
      salt: salt.toString("base64"),
      verifier: verifier.toString("base64"),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    salt.fill(0);
    verifier.fill(0);
    try {
      await this.adapter.write(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async verify(password: string): Promise<boolean> {
    assertPassword(password);
    const bytes = await this.adapter.read();
    if (!bytes) return false;
    try {
      const record = parseRecord(bytes);
      if (!record) return false;
      const salt = decodeBase64(record.salt, SALT_BYTES, "salt");
      const expected = decodeBase64(record.verifier, VERIFIER_BYTES, "verifier");
      const actual = await deriveVerifier(password, salt);
      try {
        return timingSafeEqual(actual, expected);
      } finally {
        salt.fill(0);
        expected.fill(0);
        actual.fill(0);
      }
    } finally {
      bytes.fill(0);
    }
  }
}

export const HISTORY_ACCESS_PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;
