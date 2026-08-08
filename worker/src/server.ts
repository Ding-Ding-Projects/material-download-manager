import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import ssh2, {
  type AuthContext,
  type Connection,
  type PublicKeyAuthContext,
  type ServerChannel,
  type Server as SshServer,
  type Session,
} from "ssh2";

import type { WorkerConfig } from "./config.js";
import { downloadRange, type DownloadDependencies, type FrameSink } from "./downloader.js";
import {
  FrameDecoder,
  FrameType,
  ProtocolError,
  encodeFrame,
  encodeJsonFrame,
  parseRangeRequest,
  toErrorFrame,
  type EndFrame,
  type MetaFrame,
  type RangeRequest,
} from "./protocol.js";

const { Server } = ssh2;

export interface WorkerMetrics {
  authQueriesAccepted: number;
  authSignaturesVerified: number;
  rejectedCapabilities: number;
  completedFetches: number;
}

export interface WorkerServerOptions {
  downloadDependencies?: Partial<DownloadDependencies>;
  log?: (line: string) => void;
}

function constantTimeMatch(input: Buffer, expected: Buffer): boolean {
  const sameLength = input.byteLength === expected.byteLength;
  const comparison = sameLength ? expected : input;
  return timingSafeEqual(input, comparison) && sameLength;
}

function channelWrite(channel: Duplex, payload: Buffer, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("SSH channel write timed out")), timeoutMs);
    timer.unref();
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.off("drain", onDrain);
      channel.off("error", onError);
      channel.off("close", onClose);
      channel.off("aborted", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    const onDrain = (): void => {
      finish();
    };
    const onClose = (): void => finish(new Error("SSH channel closed while writing"));
    channel.once("error", onError);
    channel.once("close", onClose);
    channel.once("aborted", onClose);
    if (channel.write(payload)) {
      finish();
    } else {
      channel.once("drain", onDrain);
    }
  });
}

function rejectPublicKey(context: PublicKeyAuthContext): void {
  context.reject(["publickey"]);
}

export class PublicKeyAuthGate {
  #failedAttempts = 0;

  constructor(
    readonly config: Pick<WorkerConfig, "username" | "allowedClientKeys">,
    readonly metrics: Pick<WorkerMetrics, "authQueriesAccepted" | "authSignaturesVerified">,
  ) {}

  handle(context: AuthContext): { accepted: boolean; disconnect: boolean } {
    let accepted = false;
    if (context.method !== "publickey" || context.username !== this.config.username || context.key.algo !== "ssh-ed25519") {
      context.reject(["publickey"]);
    } else {
      const candidate = this.config.allowedClientKeys.find((key) => constantTimeMatch(context.key.data, key.getPublicSSH()));
      if (!candidate) {
        rejectPublicKey(context);
      } else if (!context.signature || !context.blob) {
        this.metrics.authQueriesAccepted += 1;
        context.accept();
        accepted = true;
      } else if (candidate.verify(context.blob, context.signature, context.hashAlgo) !== true) {
        rejectPublicKey(context);
      } else {
        this.metrics.authSignaturesVerified += 1;
        context.accept();
        accepted = true;
      }
    }
    if (!accepted) this.#failedAttempts += 1;
    return { accepted, disconnect: this.#failedAttempts >= 3 };
  }
}

export function registerRejectedSessionCapabilities(session: Session, onReject: () => void): void {
  const reject = (_accept: unknown, deny: () => void): void => {
    onReject();
    deny();
  };
  session.on("pty", reject);
  session.on("window-change", reject);
  session.on("x11", reject);
  session.on("env", reject);
  session.on("signal", reject);
  session.on("auth-agent", reject);
  session.on("shell", reject);
  session.on("sftp", reject);
  session.on("subsystem", reject);
}

export class WorkerServer {
  readonly metrics: WorkerMetrics = {
    authQueriesAccepted: 0,
    authSignaturesVerified: 0,
    rejectedCapabilities: 0,
    completedFetches: 0,
  };

  readonly #server: SshServer;
  readonly #clients = new Set<Connection>();
  #activeFetches = 0;
  #listening = false;

  get listening(): boolean {
    return this.#listening;
  }

  constructor(
    readonly config: WorkerConfig,
    readonly options: WorkerServerOptions = {},
  ) {
    this.#server = new Server({
      hostKeys: [config.hostKey],
      ident: "mdm-download-worker_1",
      algorithms: {
        serverHostKey: ["ssh-ed25519"],
        kex: [
          "curve25519-sha256", "curve25519-sha256@libssh.org", "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384", "ecdh-sha2-nistp521", "diffie-hellman-group16-sha512",
        ],
        cipher: [
          "chacha20-poly1305@openssh.com", "aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
          "aes128-ctr", "aes256-ctr",
        ],
        hmac: [
          "hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com",
          "hmac-sha2-256", "hmac-sha2-512",
        ],
      },
    }, (client) => this.#handleClient(client));
  }

  async listen(): Promise<AddressInfo> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(this.config.port, this.config.bindHost, () => {
        this.#server.off("error", reject);
        this.#listening = true;
        resolve();
      });
    });
    return this.#server.address() as AddressInfo;
  }

  async close(): Promise<void> {
    for (const client of this.#clients) client.end();
    if (!this.#listening) return;
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        this.#listening = false;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  #handleClient(client: Connection): void {
    if (this.#clients.size >= this.config.maxConnections) {
      client.end();
      return;
    }
    this.#clients.add(client);
    let authenticated = false;
    let sessionSeen = false;
    let sessionTimer: NodeJS.Timeout | undefined;
    const authGate = new PublicKeyAuthGate(this.config, this.metrics);
    const authTimer = setTimeout(() => client.end(), this.config.authTimeoutMs);
    authTimer.unref();
    client.on("authentication", (context) => {
      if (authGate.handle(context).disconnect) setImmediate(() => client.end());
    });
    client.on("ready", () => {
      authenticated = true;
      clearTimeout(authTimer);
      sessionTimer = setTimeout(() => client.end(), this.config.requestTimeoutMs);
      sessionTimer.unref();
    });
    client.on("tcpip", (_accept, reject) => {
      this.metrics.rejectedCapabilities += 1;
      reject();
    });
    client.on("openssh.streamlocal", (_accept, reject) => {
      this.metrics.rejectedCapabilities += 1;
      reject();
    });
    client.on("request", (_accept, reject) => {
      this.metrics.rejectedCapabilities += 1;
      reject?.();
    });
    client.on("session", (accept, reject) => {
      if (!authenticated || sessionSeen) {
        reject();
        return;
      }
      sessionSeen = true;
      if (sessionTimer) clearTimeout(sessionTimer);
      client.noMoreSessions = true;
      const session = accept();
      registerRejectedSessionCapabilities(session, () => {
        this.metrics.rejectedCapabilities += 1;
      });
      let execSeen = false;
      const execTimer = setTimeout(() => client.end(), this.config.requestTimeoutMs);
      execTimer.unref();
      session.once("close", () => clearTimeout(execTimer));
      session.on("exec", (acceptExec, rejectExec, info) => {
        if (execSeen || info.command !== "mdm-download-v1") {
          this.metrics.rejectedCapabilities += 1;
          rejectExec();
          return;
        }
        execSeen = true;
        clearTimeout(execTimer);
        const channel = acceptExec();
        void this.#handleExec(channel, client);
      });
    });
    client.on("error", () => undefined);
    client.on("close", () => {
      clearTimeout(authTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
      this.#clients.delete(client);
    });
  }

  async #handleExec(channel: ServerChannel, client: Connection): Promise<void> {
    let request: RangeRequest | undefined;
    let terminal = false;
    const decoder = new FrameDecoder();
    const abortController = new AbortController();
    const requestTimer = setTimeout(() => {
      abortController.abort();
      void fail(new ProtocolError("invalid-request"));
    }, this.config.requestTimeoutMs);
    requestTimer.unref();

    const closeChannel = (exitCode: number): void => {
      clearTimeout(requestTimer);
      try {
        channel.exit(exitCode);
        channel.end();
      } finally {
        client.end();
      }
    };
    const fail = async (error: unknown): Promise<void> => {
      if (terminal) return;
      terminal = true;
      abortController.abort();
      try {
        await channelWrite(channel, encodeJsonFrame(FrameType.ERROR, toErrorFrame(error, request)));
      } catch {
        // The peer is gone; there is no remaining transport for a safe error frame.
      }
      closeChannel(1);
    };
    const writeResponse = async (payload: Buffer): Promise<void> => {
      if (terminal) throw new Error("The exec channel is already terminal.");
      await channelWrite(channel, payload);
    };
    const sink: FrameSink = {
      meta: async (frame: MetaFrame) => writeResponse(encodeJsonFrame(FrameType.META, frame)),
      data: async (chunk: Buffer) => writeResponse(encodeFrame(FrameType.DATA, chunk)),
      end: async (frame: EndFrame) => writeResponse(encodeJsonFrame(FrameType.END, frame)),
    };

    channel.on("data", (chunk: Buffer) => {
      if (request || terminal) {
        void fail(new ProtocolError("invalid-request"));
        return;
      }
      try {
        const frames = decoder.push(chunk);
        if (frames.length > 1 || (frames[0] && frames[0].type !== FrameType.REQUEST)) {
          throw new ProtocolError("invalid-request");
        }
        const frame = frames[0];
        if (!frame) return;
        if (decoder.bufferedBytes !== 0) {
          throw new ProtocolError("invalid-request");
        }
        request = parseRangeRequest(frame.payload);
        clearTimeout(requestTimer);
        if (this.#activeFetches >= this.config.maxConcurrentFetches) {
          void fail(new ProtocolError("transfer-failed", true));
          return;
        }
        this.#activeFetches += 1;
        void downloadRange(
          request,
          sink,
          { ...this.options.downloadDependencies, timeouts: this.config.downloadTimeouts },
          abortController.signal,
        ).then(() => {
          if (terminal) return;
          terminal = true;
          this.metrics.completedFetches += 1;
          closeChannel(0);
        }).catch(fail).finally(() => {
          this.#activeFetches -= 1;
        });
      } catch (error) {
        void fail(error);
      }
    });
    channel.on("end", () => {
      if (!request) {
        try {
          decoder.finish();
          void fail(new ProtocolError("invalid-request"));
        } catch (error) {
          void fail(error);
        }
      }
    });
    channel.on("close", () => {
      clearTimeout(requestTimer);
      abortController.abort();
    });
    channel.on("error", () => {
      clearTimeout(requestTimer);
      abortController.abort();
    });
  }
}
