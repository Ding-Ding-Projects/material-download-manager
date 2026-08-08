import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

import ssh2, { type ParsedKey } from "ssh2";

import { DEFAULT_TIMEOUTS, type DownloadTimeouts } from "./downloader.js";

const { utils } = ssh2;

export interface WorkerConfig {
  bindHost: string;
  port: number;
  username: string;
  hostKey: Buffer;
  allowedClientKeys: ParsedKey[];
  maxConnections: number;
  maxConcurrentFetches: number;
  authTimeoutMs: number;
  requestTimeoutMs: number;
  downloadTimeouts: DownloadTimeouts;
}

function boundedNumber(raw: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be a decimal integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function parseAllowedClientKeys(raw: string): ParsedKey[] {
  const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 32) throw new Error("MDM_WORKER_ALLOWED_KEYS must contain 1 to 32 public keys.");
  return lines.map((line) => {
    if (Buffer.byteLength(line) > 16 * 1024) throw new Error("An allowed public key is too large.");
    const parsed = utils.parseKey(line);
    if (parsed instanceof Error || parsed.type !== "ssh-ed25519" || parsed.isPrivateKey()) {
      throw new Error("Only valid Ed25519 public keys are allowed.");
    }
    return parsed;
  });
}

async function loadOrCreateHostKey(stateDirectory: string): Promise<Buffer> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const keyPath = join(stateDirectory, "host-ed25519");
  let raw: Buffer;
  try {
    raw = await readFile(keyPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const generated = utils.generateKeyPairSync("ed25519", { comment: "mdm-download-worker" });
    try {
      const handle = await open(keyPath, "wx", 0o600);
      try {
        await handle.writeFile(generated.private, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      raw = Buffer.from(generated.private, "utf8");
    } catch (writeError) {
      if (!(writeError instanceof Error) || !("code" in writeError) || writeError.code !== "EEXIST") throw writeError;
      raw = await readFile(keyPath);
    }
  }
  const parsed = utils.parseKey(raw);
  if (parsed instanceof Error || parsed.type !== "ssh-ed25519" || !parsed.isPrivateKey()) {
    throw new Error("The persisted worker host key is not a valid Ed25519 private key.");
  }
  await access(keyPath, fsConstants.R_OK);
  return raw;
}

export async function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = env.MDM_WORKER_STATE_DIR ?? "/var/lib/mdm-worker",
): Promise<WorkerConfig> {
  const username = env.MDM_WORKER_USERNAME ?? "mdm-worker";
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(username)) throw new Error("MDM_WORKER_USERNAME is invalid.");
  const allowedRaw = env.MDM_WORKER_ALLOWED_KEYS;
  if (!allowedRaw) throw new Error("MDM_WORKER_ALLOWED_KEYS is required.");
  return {
    bindHost: env.MDM_WORKER_BIND_HOST ?? "0.0.0.0",
    port: boundedNumber(env.MDM_WORKER_PORT, 2222, 1, 65535, "MDM_WORKER_PORT"),
    username,
    hostKey: await loadOrCreateHostKey(stateDirectory),
    allowedClientKeys: parseAllowedClientKeys(allowedRaw),
    maxConnections: boundedNumber(env.MDM_WORKER_MAX_CONNECTIONS, 16, 1, 128, "MDM_WORKER_MAX_CONNECTIONS"),
    maxConcurrentFetches: boundedNumber(env.MDM_WORKER_MAX_FETCHES, 4, 1, 32, "MDM_WORKER_MAX_FETCHES"),
    authTimeoutMs: boundedNumber(env.MDM_WORKER_AUTH_TIMEOUT_MS, 10_000, 1_000, 60_000, "MDM_WORKER_AUTH_TIMEOUT_MS"),
    requestTimeoutMs: boundedNumber(env.MDM_WORKER_REQUEST_TIMEOUT_MS, 10_000, 1_000, 60_000, "MDM_WORKER_REQUEST_TIMEOUT_MS"),
    downloadTimeouts: {
      dnsMs: boundedNumber(env.MDM_WORKER_DNS_TIMEOUT_MS, DEFAULT_TIMEOUTS.dnsMs, 500, 60_000, "MDM_WORKER_DNS_TIMEOUT_MS"),
      connectMs: boundedNumber(env.MDM_WORKER_CONNECT_TIMEOUT_MS, DEFAULT_TIMEOUTS.connectMs, 500, 120_000, "MDM_WORKER_CONNECT_TIMEOUT_MS"),
      headersMs: boundedNumber(env.MDM_WORKER_HEADERS_TIMEOUT_MS, DEFAULT_TIMEOUTS.headersMs, 500, 120_000, "MDM_WORKER_HEADERS_TIMEOUT_MS"),
      idleMs: boundedNumber(env.MDM_WORKER_IDLE_TIMEOUT_MS, DEFAULT_TIMEOUTS.idleMs, 1_000, 300_000, "MDM_WORKER_IDLE_TIMEOUT_MS"),
      wallMs: boundedNumber(env.MDM_WORKER_WALL_TIMEOUT_MS, DEFAULT_TIMEOUTS.wallMs, 5_000, 3_600_000, "MDM_WORKER_WALL_TIMEOUT_MS"),
    },
  };
}
