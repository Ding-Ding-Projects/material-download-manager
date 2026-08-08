import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Client, ClientChannel, SFTPWrapper } from "ssh2";

import type { SshHostConfig } from "../../../shared/types";
import {
  isSshHostConfig,
  type SshHostStatus,
  type SshProvisionResult,
} from "../../../shared/ssh";
import { CredentialVault } from "./CredentialVault";
import { SshWorkerClient } from "./SshWorkerClient";

const PROVISION_SCHEMA_VERSION = 1 as const;
const MAX_PROVISION_OUTPUT_BYTES = 256 * 1024;
const MAX_PROVISION_INPUT_BYTES = 64 * 1024;
const SFTP_OPERATION_TIMEOUT_MS = 120_000;
const STAGING_PATH = /^\/[A-Za-z0-9._/-]+\/\.local\/share\/material-download-manager\/staging\/operation-[A-Za-z0-9]+$/u;

interface ProvisionRequest {
  version: typeof PROVISION_SCHEMA_VERSION;
  hostId: string;
  workerPort: number;
  relayPublicKey: string;
  workerClientPublicKey: string;
  specHash: string;
}

interface ProvisionOutput {
  version: number;
  stage: string;
  state: string;
  message: string;
}

export interface SshProvisioningServiceOptions {
  bundlePath: string;
  vault?: CredentialVault;
  client?: SshWorkerClient;
}

function sftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, wrapper) => {
      if (error || !wrapper) reject(new Error("The SSH bootstrap account did not allow the bounded file upload"));
      else resolve(wrapper);
    });
  });
}

function mkdir(wrapper: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wrapper.mkdir(remotePath, { mode: 0o700 }, (error) => {
      if (error && (error as NodeJS.ErrnoException).code !== "EEXIST") reject(error);
      else resolve();
    });
  });
}

function fastPut(wrapper: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wrapper.fastPut(localPath, remotePath, { mode: 0o600 }, (error) => error ? reject(error) : resolve());
  });
}

function endSftp(wrapper: SFTPWrapper): Promise<void> {
  return new Promise((resolve) => {
    wrapper.end();
    wrapper.once("close", resolve);
    setTimeout(resolve, 250).unref();
  });
}

async function boundedSftp<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), SFTP_OPERATION_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCommand(
  client: Client,
  command: string,
  input = "",
  timeoutMs = 30_000,
): Promise<string> {
  if (Buffer.byteLength(input, "utf8") > MAX_PROVISION_INPUT_BYTES) {
    throw new Error("The SSH provision request exceeds its size limit");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    let exitCode: number | undefined;
    let exitSignal: string | undefined;
    let channel: ClientChannel | null = null;
    const timer = setTimeout(() => finish(new Error("The SSH provision command timed out")), timeoutMs);
    timer.unref();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel?.destroy();
      if (error || exitSignal || (exitCode !== undefined && exitCode !== 0)) {
        reject(error ?? new Error("The SSH provision command failed safely"));
      } else {
        resolve(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
      }
    };
    client.exec(command, { pty: false }, (error, opened) => {
      if (error || !opened) {
        finish(new Error("The SSH bootstrap account refused the provision command"));
        return;
      }
      channel = opened;
      opened.on("exit", (code: number | undefined, signalName?: string) => {
        exitCode = typeof code === "number" ? code : undefined;
        exitSignal = typeof signalName === "string" ? signalName : undefined;
      });
      opened.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_PROVISION_OUTPUT_BYTES) {
          finish(new Error("The SSH provision command exceeded its output limit"));
          return;
        }
        stdout.push(Buffer.from(chunk));
      });
      opened.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > 8 * 1024) finish(new Error("The SSH provision command exceeded its stderr limit"));
      });
      opened.once("error", () => finish(new Error("The SSH provision command failed safely")));
      opened.once("close", () => finish());
      opened.end(input);
    });
  });
}

async function bundleFiles(root: string): Promise<string[]> {
  const allowedRootFiles = new Set([
    "Dockerfile",
    "compose.yaml",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "provision.py",
  ]);
  const results: string[] = [];
  for (const file of allowedRootFiles) {
    const local = path.join(root, file);
    const stat = await fsp.lstat(local).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Worker bundle is missing ${file}`);
    results.push(file);
  }
  const sourceRoot = path.join(root, "src");
  const entries = await fsp.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^[A-Za-z0-9._-]+\.ts$/u.test(entry.name)) {
      throw new Error("Worker bundle src contains an unexpected entry");
    }
    results.push(`src/${entry.name}`);
  }
  return results.sort();
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await fsp.readFile(filePath)).digest("hex");
}

function parseProvisionOutput(output: string): ProvisionOutput[] {
  if (Buffer.byteLength(output, "utf8") > MAX_PROVISION_OUTPUT_BYTES) throw new Error("Provision output is too large");
  return output.split(/\r?\n/u).filter(Boolean).map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Provision output was not bounded NDJSON");
    }
    if (
      typeof value !== "object" || value === null || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 4
    ) throw new Error("Provision output has an invalid schema");
    const record = value as Record<string, unknown>;
    if (
      record.version !== PROVISION_SCHEMA_VERSION || typeof record.stage !== "string" ||
      typeof record.state !== "string" || typeof record.message !== "string" ||
      record.stage.length > 64 || record.state.length > 64 || record.message.length > 512
    ) throw new Error("Provision output has an invalid schema");
    return record as unknown as ProvisionOutput;
  });
}

export class SshProvisioningService {
  private readonly vault: CredentialVault;
  private readonly client: SshWorkerClient;
  private readonly bundlePath: string;
  private readonly hostLocks = new Map<string, Promise<void>>();

  constructor(options: SshProvisioningServiceOptions) {
    if (!path.isAbsolute(options.bundlePath)) throw new Error("Worker bundle path must be absolute");
    this.bundlePath = path.resolve(options.bundlePath);
    this.vault = options.vault ?? new CredentialVault();
    this.client = options.client ?? new SshWorkerClient({ vault: this.vault });
  }

  private async withHostLock<T>(hostId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.hostLocks.get(hostId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.hostLocks.set(hostId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.hostLocks.get(hostId) === queued) this.hostLocks.delete(hostId);
    }
  }

  async provision(host: SshHostConfig): Promise<SshProvisionResult> {
    if (!isSshHostConfig(host)) throw new Error("Invalid SSH host configuration");
    return this.withHostLock(host.id, () => this.provisionLocked(host));
  }

  private async provisionLocked(host: SshHostConfig): Promise<SshProvisionResult> {
    const relay = await this.vault.load(host.id, "relay") ?? {
      ...(await this.generateAndLoad(host.id, "relay")),
    };
    const workerClient = await this.vault.load(host.id, "worker-client") ?? {
      ...(await this.generateAndLoad(host.id, "worker-client")),
    };
    const files = await bundleFiles(this.bundlePath);
    const fileHashes = await Promise.all(files.map(async (relative) => ({
      relative,
      sha256: await hashFile(path.join(this.bundlePath, ...relative.split("/"))),
    })));
    const specHash = createHash("sha256").update(JSON.stringify({
      version: PROVISION_SCHEMA_VERSION,
      workerPort: host.workerPort,
      relayPublicKey: relay.publicKey,
      workerClientPublicKey: workerClient.publicKey,
      files: fileHashes,
    })).digest("hex");
    const request: ProvisionRequest = {
      version: PROVISION_SCHEMA_VERSION,
      hostId: host.id,
      workerPort: host.workerPort,
      relayPublicKey: relay.publicKey,
      workerClientPublicKey: workerClient.publicKey,
      specHash,
    };

    const bootstrap = await this.client.connectBootstrap(host);
    let stagingDirectory: string | null = null;
    let provisionState: SshProvisionResult["state"] = "applied";
    let appliedTransaction = false;
    try {
      stagingDirectory = (await runCommand(
        bootstrap,
        "umask 077; base=\"$HOME/.local/share/material-download-manager/staging\"; mkdir -p \"$base\"; mktemp -d \"$base/operation-XXXXXXXXXXXXXXXXXXXXXXXX\"",
      )).trim();
      if (!STAGING_PATH.test(stagingDirectory)) throw new Error("SSH host returned an unsafe staging path");
      await this.uploadBundle(bootstrap, stagingDirectory, fileHashes);
      await runCommand(
        bootstrap,
        `cd '${stagingDirectory}' && sha256sum --check bundle.sha256 >/dev/null`,
      );
      const output = await runCommand(
        bootstrap,
        `python3 '${stagingDirectory}/provision.py' apply`,
        JSON.stringify(request),
        30 * 60_000,
      );
      const records = parseProvisionOutput(output);
      const outcome = [...records].reverse().find((record) =>
        record.stage === "apply" && (record.state === "applied" || record.state === "unchanged"));
      if (!outcome) throw new Error("The SSH provisioner did not report a verified outcome");
      provisionState = outcome.state as SshProvisionResult["state"];
      appliedTransaction = provisionState === "applied";

      const scan = await this.client.scanWorkerHostKey(host);
      if (scan.algorithm !== "ssh-ed25519") throw new Error("The managed worker did not present an Ed25519 host key");
      if (host.workerHostKeySha256 && host.workerHostKeySha256 !== scan.hostKeySha256) {
        throw new Error("The managed worker host key changed; the new pin was rejected");
      }
      const verifiedHost = { ...host, workerHostKeySha256: scan.hostKeySha256 };
      await this.client.verifyWorker(verifiedHost);

      if (appliedTransaction) {
        let finalRecords: ProvisionOutput[];
        try {
          const finalized = await runCommand(
            bootstrap,
            `python3 '${stagingDirectory}/provision.py' finalize`,
            JSON.stringify(request),
            5 * 60_000,
          );
          finalRecords = parseProvisionOutput(finalized);
        } catch (firstFinalizeError) {
          // Finalize is idempotent.  A response can be lost after the remote
          // commit; retry the acknowledgement before considering rollback.
          try {
            const retried = await runCommand(
              bootstrap,
              `python3 '${stagingDirectory}/provision.py' finalize`,
              JSON.stringify(request),
              5 * 60_000,
            );
            finalRecords = parseProvisionOutput(retried);
          } catch {
            throw firstFinalizeError;
          }
        }
        if (!finalRecords.some((record) => record.stage === "finalize" && record.state === "finalized")) {
          throw new Error("The SSH provisioner did not finalize its verified transaction");
        }
      }
      return {
        hostId: host.id,
        state: provisionState,
        workerHostKeySha256: scan.hostKeySha256,
        checkedAt: Date.now(),
        message: "The managed worker was provisioned and verified through its pinned loopback relay.",
      };
    } catch (error) {
      if (appliedTransaction && stagingDirectory && STAGING_PATH.test(stagingDirectory)) {
        await runCommand(
          bootstrap,
          `python3 '${stagingDirectory}/provision.py' rollback`,
          JSON.stringify(request),
          30 * 60_000,
        ).catch(() => {});
      }
      throw error;
    } finally {
      if (stagingDirectory && STAGING_PATH.test(stagingDirectory)) {
        const cleanup = {
          version: PROVISION_SCHEMA_VERSION,
          hostId: host.id,
          stagingDirectory,
        };
        await runCommand(
          bootstrap,
          `python3 '${stagingDirectory}/provision.py' cleanup`,
          JSON.stringify(cleanup),
        ).catch(() => {});
      }
      bootstrap.end();
    }
  }

  async verify(host: SshHostConfig): Promise<SshHostStatus> {
    if (!isSshHostConfig(host)) throw new Error("Invalid SSH host configuration");
    return this.withHostLock(host.id, () => this.verifyLocked(host));
  }

  private async verifyLocked(host: SshHostConfig): Promise<SshHostStatus> {
    const checkedAt = Date.now();
    try {
      const result = await this.client.verifyWorker(host);
      return {
        hostId: host.id,
        state: "ready",
        checkedAt,
        latencyMs: result.latencyMs,
        workerProtocolVersion: result.protocolVersion,
        message: "The pinned relay and managed worker are reachable.",
      };
    } catch {
      return {
        hostId: host.id,
        state: "failed",
        checkedAt,
        latencyMs: null,
        workerProtocolVersion: null,
        message: "The pinned relay or managed worker could not be verified.",
      };
    }
  }

  async remove(host: SshHostConfig): Promise<void> {
    if (!isSshHostConfig(host)) throw new Error("Invalid SSH host configuration");
    return this.withHostLock(host.id, () => this.removeLocked(host));
  }

  private async removeLocked(host: SshHostConfig): Promise<void> {
    if (!host.provisionedAt && !host.workerHostKeySha256) {
      await this.vault.removeHost(host.id);
      return;
    }
    const bootstrap = await this.client.connectBootstrap(host);
    try {
      const command = [
        `current=\"$HOME/.local/share/material-download-manager/ssh-worker/${host.id}/current/provision.py\"`,
        `fallback=\"$HOME/.local/share/material-download-manager/ssh-worker/${host.id}.remove.py\"`,
        `if [ -f \"$current\" ]; then script=\"$current\"; else script=\"$fallback\"; fi`,
        `python3 \"$script\" remove`,
      ].join("; ");
      const output = await runCommand(
        bootstrap,
        command,
        JSON.stringify({ version: PROVISION_SCHEMA_VERSION, hostId: host.id }),
        5 * 60_000,
      );
      const records = parseProvisionOutput(output);
      if (!records.some((record) => record.stage === "remove" && record.state === "removed")) {
        throw new Error("The SSH provisioner did not confirm exact label-owned resource removal");
      }
    } finally {
      bootstrap.end();
    }
  }

  /** Finish local cleanup only after the host inventory deletion is durable. */
  async finalizeRemoval(host: SshHostConfig): Promise<void> {
    if (!isSshHostConfig(host)) throw new Error("Invalid SSH host configuration");
    try {
      const bootstrap = await this.client.connectBootstrap(host);
      try {
        await runCommand(
          bootstrap,
          `rm -f -- \"$HOME/.local/share/material-download-manager/ssh-worker/${host.id}.remove.py\"`,
          "",
          30_000,
        );
      } finally {
        bootstrap.end();
      }
    } catch {
      // The worker is already removed; a stale removal entry point is safe to
      // leave for a later bounded cleanup attempt.
    } finally {
      await this.vault.removeHost(host.id);
    }
  }

  private async generateAndLoad(
    hostId: string,
    purpose: "relay" | "worker-client",
  ) {
    await this.vault.generate(hostId, purpose);
    const loaded = await this.vault.load(hostId, purpose);
    if (!loaded) throw new Error("The generated SSH credential could not be reloaded from the operating-system vault");
    return loaded;
  }

  private async uploadBundle(
    bootstrap: Client,
    remoteRoot: string,
    hashes: Array<{ relative: string; sha256: string }>,
  ): Promise<void> {
    const wrapper = await boundedSftp(sftp(bootstrap), "The SSH bundle SFTP session timed out");
    try {
      await boundedSftp(mkdir(wrapper, `${remoteRoot}/src`), "The SSH bundle directory creation timed out");
      for (const entry of hashes) {
        const localPath = path.join(this.bundlePath, ...entry.relative.split("/"));
        const remotePath = `${remoteRoot}/${entry.relative}`;
        await boundedSftp(fastPut(wrapper, localPath, remotePath), "The SSH bundle upload timed out");
      }
      const manifest = `${hashes.map((entry) => `${entry.sha256}  ${entry.relative}`).join("\n")}\n`;
      const localManifest = path.join(os.tmpdir(), `mdm-bundle-sha256-${randomUUID()}`);
      await fsp.writeFile(localManifest, manifest, { encoding: "utf8", flag: "wx", mode: 0o600 });
      try {
        await boundedSftp(fastPut(wrapper, localManifest, `${remoteRoot}/bundle.sha256`), "The SSH bundle manifest upload timed out");
      } finally {
        await fsp.rm(localManifest, { force: true });
      }
    } finally {
      await endSftp(wrapper);
    }
  }
}
