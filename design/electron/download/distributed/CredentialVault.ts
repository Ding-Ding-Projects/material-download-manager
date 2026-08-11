import { AsyncEntry } from "@napi-rs/keyring";
import { createHash } from "node:crypto";
import { utils as sshUtils } from "ssh2";

import { isStableSshIdentifier, normalizeSshPrivateKeyCredential } from "../../../shared/ssh";
import type { SshPrivateKeyCredentialInput } from "../../../shared/ssh";
import {
  DISTRIBUTED_MAX_URL_LENGTH,
  isDistributedRequestHeaders,
} from "../../../shared/distributedProtocol";

const SERVICE_NAME = "MaterialDownloadManager.Ssh.v1";
const VAULT_SCHEMA_VERSION = 1 as const;
const VAULT_RECORD_MAX_BYTES = 96 * 1024;

export type SshCredentialPurpose = "bootstrap" | "relay" | "worker-client";

export interface DistributedSourceSecret {
  url: string;
  headers: Record<string, string>;
}

export interface StoredSshCredential extends SshPrivateKeyCredentialInput {
  publicKey: string;
}

export interface CredentialVaultAdapter {
  read(account: string): Promise<Uint8Array | null>;
  write(account: string, value: Uint8Array): Promise<void>;
  remove(account: string): Promise<void>;
}

interface StoredCredentialRecord {
  version: typeof VAULT_SCHEMA_VERSION;
  privateKey: string;
  passphrase: string | null;
  publicKey: string;
}

interface StoredSourceRecord {
  version: typeof VAULT_SCHEMA_VERSION;
  url: string;
  headers: Record<string, string>;
}

function isVaultSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > DISTRIBUTED_MAX_URL_LENGTH) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

class OperatingSystemCredentialVaultAdapter implements CredentialVaultAdapter {
  private entry(account: string): AsyncEntry {
    return new AsyncEntry(SERVICE_NAME, account);
  }

  async read(account: string): Promise<Uint8Array | null> {
    const secret = await this.entry(account).getSecret();
    return secret ? new Uint8Array(secret) : null;
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

function accountName(hostId: string, purpose: SshCredentialPurpose): string {
  if (!isStableSshIdentifier(hostId)) throw new Error("Invalid SSH host identifier");
  return `${purpose}:${hostId}`;
}

function sourceAccountName(downloadId: string): string {
  if (!isStableSshIdentifier(downloadId)) throw new Error("Invalid distributed download identifier");
  return `download-source:${downloadId}`;
}

function parsePrivateKey(input: SshPrivateKeyCredentialInput) {
  const parsed = sshUtils.parseKey(input.privateKey, input.passphrase ?? undefined);
  if (parsed instanceof Error || !parsed.isPrivateKey()) {
    throw new Error("SSH credential is not a usable private key");
  }
  if (parsed.type !== "ssh-ed25519") {
    throw new Error("SSH credentials must use Ed25519 keys");
  }
  return parsed;
}

function publicKeyLine(parsed: ReturnType<typeof parsePrivateKey>): string {
  return `${parsed.type} ${parsed.getPublicSSH().toString("base64")}`;
}

function normalizeStoredRecord(value: unknown): StoredCredentialRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored SSH credential has an invalid schema");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  const expected = new Set(["version", "privateKey", "passphrase", "publicKey"]);
  if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) {
    throw new Error("Stored SSH credential has an invalid schema");
  }
  if (record.version !== VAULT_SCHEMA_VERSION || typeof record.publicKey !== "string") {
    throw new Error("Stored SSH credential has an invalid schema");
  }
  const credential = normalizeSshPrivateKeyCredential({
    privateKey: record.privateKey,
    passphrase: record.passphrase,
  });
  const parsed = parsePrivateKey(credential);
  const derivedPublicKey = publicKeyLine(parsed);
  if (record.publicKey !== derivedPublicKey) {
    throw new Error("Stored SSH credential public key does not match its private key");
  }
  return {
    version: VAULT_SCHEMA_VERSION,
    privateKey: credential.privateKey,
    passphrase: credential.passphrase,
    publicKey: derivedPublicKey,
  };
}

export class CredentialVault {
  constructor(private readonly adapter: CredentialVaultAdapter = new OperatingSystemCredentialVaultAdapter()) {}

  async store(
    hostId: string,
    purpose: SshCredentialPurpose,
    input: unknown,
  ): Promise<{ publicKey: string }> {
    const credential = normalizeSshPrivateKeyCredential(input);
    const parsed = parsePrivateKey(credential);
    const record: StoredCredentialRecord = {
      version: VAULT_SCHEMA_VERSION,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
      publicKey: publicKeyLine(parsed),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    if (bytes.byteLength > VAULT_RECORD_MAX_BYTES) {
      bytes.fill(0);
      throw new Error("SSH credential is too large for the operating-system vault");
    }
    try {
      await this.adapter.write(accountName(hostId, purpose), bytes);
    } finally {
      bytes.fill(0);
    }
    return { publicKey: record.publicKey };
  }

  async generate(hostId: string, purpose: Exclude<SshCredentialPurpose, "bootstrap">): Promise<{ publicKey: string }> {
    const pair = sshUtils.generateKeyPairSync("ed25519");
    return this.store(hostId, purpose, { privateKey: pair.private, passphrase: null });
  }

  async load(hostId: string, purpose: SshCredentialPurpose): Promise<StoredSshCredential | null> {
    const bytes = await this.adapter.read(accountName(hostId, purpose));
    if (!bytes) return null;
    if (bytes.byteLength === 0 || bytes.byteLength > VAULT_RECORD_MAX_BYTES) {
      bytes.fill(0);
      throw new Error("Stored SSH credential has an invalid size");
    }
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const record = normalizeStoredRecord(JSON.parse(decoded));
      return {
        privateKey: record.privateKey,
        passphrase: record.passphrase,
        publicKey: record.publicKey,
      };
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new Error("Stored SSH credential is corrupt");
      }
      throw error;
    } finally {
      bytes.fill(0);
    }
  }

  async remove(hostId: string, purpose: SshCredentialPurpose): Promise<void> {
    await this.adapter.remove(accountName(hostId, purpose));
  }

  async removeHost(hostId: string): Promise<void> {
    await Promise.all([
      this.remove(hostId, "bootstrap"),
      this.remove(hostId, "relay"),
      this.remove(hostId, "worker-client"),
    ]);
  }

  async storeDownloadSource(downloadId: string, value: unknown): Promise<void> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Invalid distributed download source");
    }
    const record = value as Record<string, unknown>;
    if (
      Reflect.ownKeys(record).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(record, "url") ||
      !Object.prototype.hasOwnProperty.call(record, "headers") ||
      !isVaultSourceUrl(record.url) ||
      !isDistributedRequestHeaders(record.headers)
    ) {
      throw new Error("Invalid distributed download source");
    }
    const stored: StoredSourceRecord = {
      version: VAULT_SCHEMA_VERSION,
      url: record.url,
      headers: { ...record.headers },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(stored));
    if (bytes.byteLength > VAULT_RECORD_MAX_BYTES) {
      bytes.fill(0);
      throw new Error("Distributed download source is too large for the operating-system vault");
    }
    try {
      await this.adapter.write(sourceAccountName(downloadId), bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async loadDownloadSource(downloadId: string): Promise<DistributedSourceSecret | null> {
    const bytes = await this.adapter.read(sourceAccountName(downloadId));
    if (!bytes) return null;
    if (bytes.byteLength === 0 || bytes.byteLength > VAULT_RECORD_MAX_BYTES) {
      bytes.fill(0);
      throw new Error("Stored distributed download source has an invalid size");
    }
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Stored distributed download source is corrupt");
      }
      const record = value as Record<string, unknown>;
      const expected = new Set(["version", "url", "headers"]);
      if (
        Reflect.ownKeys(record).length !== expected.size ||
        Reflect.ownKeys(record).some((key) => typeof key !== "string" || !expected.has(key)) ||
        record.version !== VAULT_SCHEMA_VERSION ||
        !isVaultSourceUrl(record.url) ||
        !isDistributedRequestHeaders(record.headers)
      ) {
        throw new Error("Stored distributed download source is corrupt");
      }
      return { url: record.url, headers: { ...record.headers } };
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        throw new Error("Stored distributed download source is corrupt");
      }
      throw error;
    } finally {
      bytes.fill(0);
    }
  }

  async removeDownloadSource(downloadId: string): Promise<void> {
    await this.adapter.remove(sourceAccountName(downloadId));
  }
}

export function sshHostKeyFingerprint(rawKey: Buffer): string {
  return `SHA256:${createHash("sha256").update(rawKey).digest("base64").replace(/=+$/u, "")}`;
}
