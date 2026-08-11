import { AsyncEntry } from "@napi-rs/keyring";
import { normalizeTotpSecret } from "../../shared/authenticator";

const SERVICE_NAME = "MaterialDownloadManager.Authenticator.v1";
const RECORD_VERSION = 1 as const;
const MAX_RECORD_BYTES = 4 * 1024;

export interface TotpSecretVaultAdapter {
  read(account: string): Promise<Uint8Array | null>;
  write(account: string, value: Uint8Array): Promise<void>;
  remove(account: string): Promise<void>;
}

class OperatingSystemTotpSecretVaultAdapter implements TotpSecretVaultAdapter {
  private entry(account: string): AsyncEntry {
    return new AsyncEntry(SERVICE_NAME, account);
  }

  async read(account: string): Promise<Uint8Array | null> {
    const value = await this.entry(account).getSecret();
    return value ? new Uint8Array(value) : null;
  }

  async write(account: string, value: Uint8Array): Promise<void> {
    await this.entry(account).setSecret(value);
  }

  async remove(account: string): Promise<void> {
    await this.entry(account).deleteCredential().catch((error: unknown) => {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("no entry") && !message.includes("not found")) throw error;
    });
  }
}

interface StoredTotpSecretRecord {
  version: typeof RECORD_VERSION;
  secret: string;
}

function accountName(id: string): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(id)) {
    throw new Error("Invalid authenticator registration id");
  }
  return `totp:${id}`;
}

function parseStoredRecord(bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECORD_BYTES) {
    throw new Error("Stored authenticator secret has an invalid size");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Stored authenticator secret is corrupt");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored authenticator secret is corrupt");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !["version", "secret"].includes(key)) ||
    record.version !== RECORD_VERSION) {
    throw new Error("Stored authenticator secret has an invalid schema");
  }
  try {
    return normalizeTotpSecret(record.secret, false);
  } catch {
    throw new Error("Stored authenticator secret is invalid");
  }
}

/**
 * OS-vault boundary for TOTP secrets. No settings, history snapshot, ordinary
 * export, or renderer-facing metadata path calls this class with a secret.
 */
export class TotpSecretVault {
  constructor(private readonly adapter: TotpSecretVaultAdapter = new OperatingSystemTotpSecretVaultAdapter()) {}

  async store(id: string, secret: string): Promise<void> {
    const normalized = normalizeTotpSecret(secret);
    const bytes = new TextEncoder().encode(JSON.stringify({ version: RECORD_VERSION, secret: normalized } satisfies StoredTotpSecretRecord));
    if (bytes.byteLength > MAX_RECORD_BYTES) {
      bytes.fill(0);
      throw new Error("Authenticator secret is too large for the operating-system vault");
    }
    try {
      await this.adapter.write(accountName(id), bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async load(id: string): Promise<string | null> {
    const bytes = await this.adapter.read(accountName(id));
    if (!bytes) return null;
    try {
      return parseStoredRecord(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async remove(id: string): Promise<void> {
    await this.adapter.remove(accountName(id));
  }
}

export const AUTHENTICATOR_VAULT_SERVICE = SERVICE_NAME;
