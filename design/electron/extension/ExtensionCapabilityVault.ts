import { AsyncEntry } from "@napi-rs/keyring";
import { randomBytes } from "node:crypto";

const SERVICE_NAME = "MaterialDownloadManager.Extension.v1";
const ACCOUNT_NAME = "loopback-handoff";
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ExtensionCapabilityAdapter {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

class OperatingSystemExtensionCapabilityAdapter implements ExtensionCapabilityAdapter {
  private readonly entry = new AsyncEntry(SERVICE_NAME, ACCOUNT_NAME);

  async read(): Promise<string | null> {
    const bytes = await this.entry.getSecret();
    if (!bytes) return null;
    const copy = new Uint8Array(bytes);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(copy);
    } finally {
      copy.fill(0);
    }
  }

  async write(value: string): Promise<void> {
    const bytes = new TextEncoder().encode(value);
    try {
      await this.entry.setSecret(bytes);
    } finally {
      bytes.fill(0);
    }
  }
}

export function createExtensionCapability(): string {
  return randomBytes(32).toString("base64url");
}

export class ExtensionCapabilityVault {
  constructor(private readonly adapter: ExtensionCapabilityAdapter = new OperatingSystemExtensionCapabilityAdapter()) {}

  async write(value: string): Promise<void> {
    if (!CAPABILITY_PATTERN.test(value)) {
      throw new Error("The extension handoff capability is invalid");
    }
    await this.adapter.write(value);
  }

  async rotate(): Promise<string> {
    const capability = createExtensionCapability();
    await this.write(capability);
    return capability;
  }

  async load(): Promise<string | null> {
    const capability = await this.adapter.read();
    if (capability === null) return null;
    if (!CAPABILITY_PATTERN.test(capability)) {
      throw new Error("The stored extension handoff capability is invalid");
    }
    return capability;
  }
}
