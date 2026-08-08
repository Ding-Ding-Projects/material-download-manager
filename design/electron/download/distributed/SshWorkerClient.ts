import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import {
  Client,
  utils as sshUtils,
  type ClientChannel,
  type ConnectConfig,
} from "ssh2";

import {
  DISTRIBUTED_FRAME_TYPES,
  type DistributedRangeRequestV1,
  isDistributedRangeRequestV1,
} from "../../../shared/distributedProtocol";
import type { SshHostConfig, SshHostTransferProgress } from "../../../shared/types";
import {
  isSshHostConfig,
  type SshHostKeyScanResult,
} from "../../../shared/ssh";
import {
  DistributedFrameDecoder,
  DistributedProtocolError,
  WorkerResponseOrderValidator,
  encodeDistributedJsonFrame,
} from "./WorkerProtocol";
import { CredentialVault, sshHostKeyFingerprint } from "./CredentialVault";

const SSH_READY_TIMEOUT_MS = 15_000;
const SSH_KEEPALIVE_INTERVAL_MS = 15_000;
const SSH_KEEPALIVE_COUNT_MAX = 2;
const STDERR_MAX_BYTES = 8 * 1024;
const FRAME_IDLE_TIMEOUT_MS = 30_000;
const RANGE_WALL_TIMEOUT_MS = 30 * 60_000;

const SSH_ALGORITHMS: NonNullable<ConnectConfig["algorithms"]> = {
  serverHostKey: ["ssh-ed25519"],
  kex: [
    "curve25519-sha256",
    "curve25519-sha256@libssh.org",
    "ecdh-sha2-nistp256",
    "ecdh-sha2-nistp384",
    "ecdh-sha2-nistp521",
    "diffie-hellman-group16-sha512",
  ],
  cipher: [
    "chacha20-poly1305@openssh.com",
    "aes128-gcm@openssh.com",
    "aes256-gcm@openssh.com",
    "aes128-ctr",
    "aes256-ctr",
  ],
  hmac: [
    "hmac-sha2-256-etm@openssh.com",
    "hmac-sha2-512-etm@openssh.com",
    "hmac-sha2-256",
    "hmac-sha2-512",
  ],
};

export interface SshRangeFetchResult {
  byteLength: number;
  sha256: string;
}

export class SshWorkerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshWorkerIntegrityError";
  }
}

export class SshWorkerRemoteError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SshWorkerRemoteError";
  }
}

export type SshRangeDataSink = (chunk: Buffer) => Promise<void>;

export interface SshWorkerClientOptions {
  vault?: CredentialVault;
  readyTimeoutMs?: number;
  onHostProgress?: (progress: SshHostTransferProgress) => void;
}

function assertHost(host: SshHostConfig): void {
  if (!isSshHostConfig(host)) throw new Error("Invalid SSH host configuration");
}

function exactHostVerifier(expected: string): (key: Buffer) => boolean {
  return (key) => sshHostKeyFingerprint(key) === expected;
}

function safeAgentPath(): string {
  const configured = process.env.SSH_AUTH_SOCK;
  if (configured && configured.length <= 32_768 && !configured.includes("\0")) return configured;
  if (process.platform === "win32") return "pageant";
  throw new Error("The configured SSH agent is unavailable");
}

function closeClient(client: Client | null): void {
  if (!client) return;
  try {
    client.end();
  } catch {
    try {
      client.destroy();
    } catch {
      // Already closed.
    }
  }
}

function connect(config: ConnectConfig, signal?: AbortSignal): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error("The distributed range request was cancelled"));
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error("The SSH connection could not be established"));
    };
    const lifetimeError = () => {
      if (!settled) fail();
    };
    client.on("error", lifetimeError);
    client.once("ready", () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(client);
    });
    client.once("close", fail);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    client.connect(config);
  });
}

function scanSocketHostKey(sock: Duplex, readyTimeoutMs: number): Promise<SshHostKeyScanResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Managed SSH worker host-key scan timed out")), readyTimeoutMs);
    timer.unref();
    const finish = (error?: Error, result?: SshHostKeyScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      if (error || !result) reject(error ?? new Error("Managed SSH worker host-key scan failed"));
      else resolve(result);
    };
    client.once("error", () => finish(new Error("Managed SSH worker host-key scan failed")));
    client.connect({
      sock,
      username: "mdm-host-key-scan",
      readyTimeout: readyTimeoutMs,
      algorithms: SSH_ALGORITHMS,
      hostVerifier: (key: Buffer) => {
        const parsed = sshUtils.parseKey(key);
        const algorithm = parsed instanceof Error ? "ssh-ed25519" : parsed.type;
        finish(undefined, { hostKeySha256: sshHostKeyFingerprint(key), algorithm });
        return false;
      },
    });
  });
}

function forwardLoopback(client: Client, workerPort: number, timeoutMs: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The managed SSH worker tunnel timed out")), timeoutMs);
    timer.unref();
    client.forwardOut("127.0.0.1", 0, "127.0.0.1", workerPort, (error, stream) => {
      clearTimeout(timer);
      if (error || !stream) {
        reject(new Error("The managed SSH worker tunnel could not be opened"));
        return;
      }
      resolve(stream);
    });
  });
}

function execWorker(client: Client, timeoutMs: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The managed SSH worker command timed out")), timeoutMs);
    timer.unref();
    client.exec("mdm-download-v1", { pty: false }, (error, channel) => {
      clearTimeout(timer);
      if (error || !channel) {
        reject(new Error("The managed SSH worker command was refused"));
        return;
      }
      resolve(channel);
    });
  });
}

function watchBoundedStderr(channel: ClientChannel): { overflowed: () => boolean } {
  let bytes = 0;
  let overflow = false;
  channel.stderr.on("data", (chunk: Buffer | string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > STDERR_MAX_BYTES) {
      overflow = true;
      channel.destroy();
    }
  });
  channel.stderr.resume();
  return { overflowed: () => overflow };
}

export class SshWorkerClient {
  private readonly vault: CredentialVault;
  private readonly readyTimeoutMs: number;

  constructor(private readonly options: SshWorkerClientOptions = {}) {
    this.vault = options.vault ?? new CredentialVault();
    this.readyTimeoutMs = Math.min(Math.max(options.readyTimeoutMs ?? SSH_READY_TIMEOUT_MS, 1_000), 60_000);
  }

  async scanHostKey(host: string, port: number): Promise<SshHostKeyScanResult> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const timer = setTimeout(() => finish(new Error("SSH host-key scan timed out")), this.readyTimeoutMs);
      timer.unref();
      const finish = (error?: Error, result?: SshHostKeyScanResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.destroy();
        if (error || !result) reject(error ?? new Error("SSH host-key scan failed"));
        else resolve(result);
      };
      client.once("error", () => finish(new Error("SSH host-key scan failed")));
      client.connect({
        host,
        port,
        username: "mdm-host-key-scan",
        readyTimeout: this.readyTimeoutMs,
        algorithms: SSH_ALGORITHMS,
        hostVerifier: (key: Buffer) => {
          const parsed = sshUtils.parseKey(key);
          const algorithm = parsed instanceof Error ? "ssh-ed25519" : parsed.type;
          finish(undefined, { hostKeySha256: sshHostKeyFingerprint(key), algorithm });
          return false;
        },
      });
    });
  }

  async connectBootstrap(host: SshHostConfig): Promise<Client> {
    assertHost(host);
    const common: ConnectConfig = {
      host: host.host,
      port: host.sshPort,
      username: host.username,
      readyTimeout: this.readyTimeoutMs,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      hostVerifier: exactHostVerifier(host.hostKeySha256),
      algorithms: SSH_ALGORITHMS,
      agentForward: false,
    };
    if (host.bootstrapAuthMode === "system-agent") {
      return connect({ ...common, agent: safeAgentPath(), authHandler: ["agent"] });
    }
    const credential = await this.vault.load(host.id, "bootstrap");
    if (!credential) throw new Error("The SSH bootstrap credential is unavailable");
    return connect({
      ...common,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase ?? undefined,
      authHandler: ["publickey"],
    });
  }

  async connectRelay(host: SshHostConfig, signal?: AbortSignal): Promise<Client> {
    assertHost(host);
    const credential = await this.vault.load(host.id, "relay");
    if (!credential) throw new Error("The managed SSH relay credential is unavailable");
    return connect({
      host: host.host,
      port: host.sshPort,
      username: host.username,
      readyTimeout: this.readyTimeoutMs,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      hostVerifier: exactHostVerifier(host.hostKeySha256),
      algorithms: SSH_ALGORITHMS,
      agentForward: false,
      authHandler: ["publickey"],
      privateKey: credential.privateKey,
      passphrase: credential.passphrase ?? undefined,
    }, signal);
  }

  async scanWorkerHostKey(host: SshHostConfig): Promise<SshHostKeyScanResult> {
    assertHost(host);
    let outer: Client | null = null;
    let tunnel: ClientChannel | null = null;
    try {
      outer = await this.connectRelay(host);
      tunnel = await forwardLoopback(outer, host.workerPort, this.readyTimeoutMs);
      return await scanSocketHostKey(tunnel, this.readyTimeoutMs);
    } finally {
      tunnel?.destroy();
      closeClient(outer);
    }
  }

  async verifyWorker(host: SshHostConfig): Promise<{ latencyMs: number; protocolVersion: 1 }> {
    assertHost(host);
    if (!host.workerHostKeySha256) throw new Error("The managed SSH worker host key is unavailable");
    const credential = await this.vault.load(host.id, "worker-client");
    if (!credential) throw new Error("The managed SSH worker credential is unavailable");
    const startedAt = Date.now();
    let outer: Client | null = null;
    let inner: Client | null = null;
    let tunnel: ClientChannel | null = null;
    try {
      outer = await this.connectRelay(host);
      tunnel = await forwardLoopback(outer, host.workerPort, this.readyTimeoutMs);
      inner = await connect({
        sock: tunnel,
        username: "mdm-worker",
        readyTimeout: this.readyTimeoutMs,
        algorithms: SSH_ALGORITHMS,
        hostVerifier: exactHostVerifier(host.workerHostKeySha256),
        agentForward: false,
        authHandler: ["publickey"],
        privateKey: credential.privateKey,
        passphrase: credential.passphrase ?? undefined,
      });
      const channel = await execWorker(inner, this.readyTimeoutMs);
      const decoder = new DistributedFrameDecoder();
      const challengePayload = Buffer.from(JSON.stringify({}), "utf8");
      const header = Buffer.alloc(5);
      header.writeUInt8(DISTRIBUTED_FRAME_TYPES.REQUEST, 0);
      header.writeUInt32BE(challengePayload.byteLength, 1);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error("The managed worker protocol handshake timed out")), this.readyTimeoutMs);
        timer.unref();
        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.off("data", onData);
          channel.off("error", onError);
          channel.off("close", onClose);
          if (error) reject(error); else resolve();
        };
        const onError = (): void => finish(new Error("The managed worker protocol handshake failed"));
        const onClose = (): void => finish(new Error("The managed worker protocol handshake closed early"));
        const onData = (chunk: Buffer): void => {
          try {
            for (const frame of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
              if (frame.frameType === DISTRIBUTED_FRAME_TYPES.ERROR && frame.payload.code === "invalid-request") {
                finish();
                return;
              }
              throw new Error("The managed worker returned an unexpected handshake response");
            }
          } catch (error) {
            finish(error instanceof Error ? error : new Error("The managed worker protocol handshake failed"));
          }
        };
        channel.on("data", onData);
        channel.once("error", onError);
        channel.once("close", onClose);
        channel.end(Buffer.concat([header, challengePayload]));
      });
      return { latencyMs: Date.now() - startedAt, protocolVersion: 1 };
    } finally {
      closeClient(inner);
      tunnel?.destroy();
      closeClient(outer);
    }
  }

  async fetchRange(
    host: SshHostConfig,
    request: DistributedRangeRequestV1,
    sink: SshRangeDataSink,
    signal?: AbortSignal,
  ): Promise<SshRangeFetchResult> {
    assertHost(host);
    if (!host.workerHostKeySha256) throw new Error("The managed SSH worker host key is unavailable");
    if (!isDistributedRangeRequestV1(request)) throw new Error("Invalid distributed range request");
    let outer: Client | null = null;
    let inner: Client | null = null;
    let tunnel: Duplex | null = null;
    let channel: ClientChannel | null = null;
    let wallTimer: NodeJS.Timeout | null = null;
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error("The distributed range request was cancelled");
    };
    const cancel = () => {
      channel?.destroy();
      tunnel?.destroy();
      inner?.destroy();
      outer?.destroy();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      throwIfAborted();
      const workerCredential = await this.vault.load(host.id, "worker-client");
      throwIfAborted();
      if (!workerCredential) throw new Error("The managed SSH worker credential is unavailable");
      outer = await this.connectRelay(host, signal);
      throwIfAborted();
      tunnel = await forwardLoopback(outer, host.workerPort, this.readyTimeoutMs);
      throwIfAborted();
      inner = await connect({
        sock: tunnel,
        username: "mdm-worker",
        readyTimeout: this.readyTimeoutMs,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        algorithms: SSH_ALGORITHMS,
        hostVerifier: exactHostVerifier(host.workerHostKeySha256),
        agentForward: false,
        authHandler: ["publickey"],
        privateKey: workerCredential.privateKey,
        passphrase: workerCredential.passphrase ?? undefined,
      }, signal);
      throwIfAborted();
      channel = await execWorker(inner, this.readyTimeoutMs);
      throwIfAborted();
      const stderr = watchBoundedStderr(channel);
      const decoder = new DistributedFrameDecoder();
      const ordering = new WorkerResponseOrderValidator(request);
      const localHash = createHash("sha256");
      let endHash: string | null = null;
      let exitCode: number | undefined;
      let exitSignal: string | undefined;
      let idleError: Error | null = null;
      let wallError: Error | null = null;
      let idleTimer: NodeJS.Timeout | null = null;
      wallTimer = setTimeout(() => {
        wallError = new Error("The managed SSH worker exceeded the bounded range deadline");
        channel?.destroy();
      }, RANGE_WALL_TIMEOUT_MS);
      wallTimer.unref();
      const armIdleTimer = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleError = new Error("The managed SSH worker stopped sending frames");
          channel?.destroy();
        }, FRAME_IDLE_TIMEOUT_MS);
        idleTimer.unref();
      };
      armIdleTimer();
      channel.on("exit", (code: number | undefined, signalName?: string) => {
        exitCode = typeof code === "number" ? code : undefined;
        exitSignal = typeof signalName === "string" ? signalName : undefined;
      });
      channel.end(encodeDistributedJsonFrame(DISTRIBUTED_FRAME_TYPES.REQUEST, request));

      for await (const rawChunk of channel) {
        if (idleError) throw idleError;
        if (wallError) throw wallError;
        if (signal?.aborted) throw new Error("The distributed range request was cancelled");
        const frames = decoder.push(Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array));
        armIdleTimer();
        for (const frame of frames) {
          if (frame.frameType === DISTRIBUTED_FRAME_TYPES.REQUEST) {
            throw new SshWorkerIntegrityError("The managed SSH worker sent a client-only request frame");
          }
          ordering.accept(frame);
          if (frame.frameType === DISTRIBUTED_FRAME_TYPES.DATA) {
            localHash.update(frame.payload);
            await sink(frame.payload);
          } else if (frame.frameType === DISTRIBUTED_FRAME_TYPES.END) {
            endHash = frame.payload.sha256;
          } else if (frame.frameType === DISTRIBUTED_FRAME_TYPES.ERROR) {
            throw new SshWorkerRemoteError(
              `Managed SSH worker rejected the range (${frame.payload.code})`,
              frame.payload.code,
              frame.payload.retryable,
            );
          }
        }
      }
      if (idleTimer) clearTimeout(idleTimer);
      if (wallTimer) clearTimeout(wallTimer);
      if (idleError) throw idleError;
      if (wallError) throw wallError;

      if (decoder.bufferedByteLength !== 0) {
        throw new SshWorkerIntegrityError("The managed SSH worker ended with a partial frame");
      }
      if (ordering.state !== "completed" || !endHash) {
        throw new SshWorkerIntegrityError("The managed SSH worker ended before verification");
      }
      if (stderr.overflowed() || exitSignal || (exitCode !== undefined && exitCode !== 0)) {
        throw new Error("The managed SSH worker exited unsuccessfully");
      }
      const sha256 = localHash.digest("hex");
      if (sha256 !== endHash) throw new SshWorkerIntegrityError("The managed SSH worker range hash did not match locally received bytes");
      return { byteLength: ordering.receivedByteLength, sha256 };
    } catch (error) {
      if (error instanceof DistributedProtocolError) {
        throw new SshWorkerIntegrityError("The managed SSH worker violated the framed protocol");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (wallTimer) clearTimeout(wallTimer);
      channel?.destroy();
      tunnel?.destroy();
      closeClient(inner);
      closeClient(outer);
    }
  }
}
