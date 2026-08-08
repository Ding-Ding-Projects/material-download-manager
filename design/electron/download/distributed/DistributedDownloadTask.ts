import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  DISTRIBUTED_FRAME_TYPES,
  type DistributedDownloadSelection,
  type DistributedManifest,
  type DistributedManifestPiece,
  type DistributedRangeRequestV1,
  type SourceIdentity,
  isDistributedManifest,
  isSourceIdentity,
} from "../../../shared/distributedProtocol";
import type {
  DownloadItem,
  PartInfo,
  SshHostConfig,
  SshHostTransferProgress,
} from "../../../shared/types";
import { isSshHostConfigs } from "../../../shared/ssh";
import type { DistributedSourceSecret } from "./CredentialVault";
import {
  DistributedManifestStore,
  createDistributedManifest,
  markDistributedPieceVerified,
} from "./DistributedManifestStore";
import { planDistributedRanges } from "./DistributedRangePlanner";
import {
  SshWorkerClient,
  SshWorkerIntegrityError,
  SshWorkerRemoteError,
  type SshRangeDataSink,
  type SshRangeFetchResult,
} from "./SshWorkerClient";
import { StrictSourceProbe } from "./StrictSourceProbe";

const MAX_ATTEMPTS_PER_PIECE = 3;

export interface DistributedRangeFetcher {
  fetchRange(
    host: SshHostConfig,
    request: DistributedRangeRequestV1,
    sink: SshRangeDataSink,
    signal?: AbortSignal,
  ): Promise<SshRangeFetchResult>;
}

export interface DistributedIdentityVerifier {
  verifyUnchanged(url: string, headers: Record<string, string>, expected: SourceIdentity): Promise<void>;
}

export interface DistributedDownloadTaskOptions {
  workRoot: string;
  source: DistributedSourceSecret;
  sourceIdentity: SourceIdentity;
  selection: DistributedDownloadSelection;
  hosts: SshHostConfig[];
  rangeFetcher?: DistributedRangeFetcher;
  identityVerifier?: DistributedIdentityVerifier;
  maxAttemptsPerPiece?: number;
}

interface PendingPiece {
  piece: DistributedManifestPiece;
  attempts: number;
  preferredHostId: string | null;
}

function sameIdentity(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.length === right.length && left.etag === right.etag && left.lastModified === right.lastModified;
}

function sameSelection(left: DistributedDownloadSelection, right: DistributedDownloadSelection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function sha256File(filePath: string): Promise<{ sha256: string; byteLength: number }> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += bytes.byteLength;
    hash.update(bytes);
  }
  return { sha256: hash.digest("hex"), byteLength };
}

function clonePending(piece: DistributedManifestPiece): DistributedManifestPiece {
  return {
    pieceId: piece.pieceId,
    index: piece.index,
    start: piece.start,
    endExclusive: piece.endExclusive,
    length: piece.length,
    state: "pending",
    verifiedByteLength: null,
    sha256: null,
    verifiedAt: null,
  };
}

export class DistributedDownloadTask extends EventEmitter {
  readonly item: DownloadItem;
  private readonly store: DistributedManifestStore;
  private readonly rangeFetcher: DistributedRangeFetcher;
  private readonly identityVerifier: DistributedIdentityVerifier;
  private readonly maxAttemptsPerPiece: number;
  private readonly selectedHosts: SshHostConfig[];
  private manifest: DistributedManifest | null = null;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private pauseRequested = false;
  private cancelRequested = false;
  private progressTimer: NodeJS.Timeout | null = null;
  private lastProgressBytes = 0;
  private lastProgressAt = Date.now();
  private readonly lastHostProgress = new Map<string, { bytes: number; at: number }>();
  private quarantinedHosts = new Set<string>();

  constructor(item: DownloadItem, private readonly options: DistributedDownloadTaskOptions) {
    super();
    if (!path.isAbsolute(options.workRoot)) throw new Error("Distributed workRoot must be absolute");
    if (!isSourceIdentity(options.sourceIdentity)) throw new Error("Invalid distributed source identity");
    if (!isSshHostConfigs(options.hosts) || options.hosts.length === 0) throw new Error("No valid SSH hosts were selected");
    this.item = item;
    this.store = new DistributedManifestStore(options.workRoot, item.id);
    this.rangeFetcher = options.rangeFetcher ?? new SshWorkerClient();
    this.identityVerifier = options.identityVerifier ?? new StrictSourceProbe();
    this.maxAttemptsPerPiece = Math.min(
      Math.max(options.maxAttemptsPerPiece ?? MAX_ATTEMPTS_PER_PIECE, 1),
      MAX_ATTEMPTS_PER_PIECE,
    );
    if (!options.selection.expectedSha256) {
      throw new Error("Distributed downloads require a trusted expected SHA-256 digest");
    }
    this.selectedHosts = options.hosts.map((host) => ({ ...host }));
    this.initializeHostProgress();
  }

  get filePath(): string {
    return path.join(this.item.folder, this.item.fileName);
  }

  async start(): Promise<void> {
    if (this.running) return this.running;
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.controller = new AbortController();
    this.item.status = "downloading";
    this.item.error = null;
    this.startProgressTimer();
    this.running = this.run(this.controller.signal)
      .then(() => {
        this.item.status = "completed";
        this.item.downloadedSize = this.item.totalSize ?? this.item.downloadedSize;
        this.item.speed = 0;
        this.item.eta = 0;
        this.item.dateCompleted = Date.now();
        this.finishHostProgress("completed", null);
        this.emit("progress");
        this.emit("completed");
      })
      .catch((error: unknown) => {
        this.item.speed = 0;
        this.item.eta = null;
        if (this.pauseRequested) {
          this.item.status = "paused";
          this.finishHostProgress("waiting", "Paused; verified pieces are preserved.");
          this.emit("paused");
          return;
        }
        if (this.cancelRequested) {
          this.item.status = "cancelled";
          return;
        }
        this.item.status = "error";
        this.item.error = error instanceof Error ? error.message : "Distributed download failed";
        this.finishHostProgress("error", this.item.error);
        this.emit("error", this.item.error);
        throw error;
      })
      .finally(() => {
        this.stopProgressTimer();
        this.controller = null;
        this.running = null;
      });
    return this.running;
  }

  async pause(): Promise<void> {
    this.pauseRequested = true;
    this.controller?.abort();
    await this.running?.catch(() => {});
    await this.removePartialFiles();
  }

  async cancel(deleteFile = false): Promise<void> {
    this.cancelRequested = true;
    this.controller?.abort();
    await this.running?.catch(() => {});
    await fsp.rm(this.store.workDirectory, { recursive: true, force: true });
    if (deleteFile) await fsp.rm(this.filePath, { force: true });
  }

  private async run(signal: AbortSignal): Promise<void> {
    this.manifest = await this.loadOrCreateManifest();
    await this.revalidatePersistedPieces();
    this.syncItemParts();
    const pending: PendingPiece[] = this.manifest.pieces
      .filter((piece) => piece.state === "pending")
      .map((piece, index) => ({
        piece,
        attempts: 0,
        preferredHostId: this.selectedHosts[index % this.selectedHosts.length]?.id ?? null,
      }));
    await this.downloadPendingPieces(pending, signal);
    if (signal.aborted) throw new Error("Distributed download stopped");
    await this.assembleVerifiedPieces(signal);
  }

  private async loadOrCreateManifest(): Promise<DistributedManifest> {
    const existing = await this.store.load();
    if (existing) {
      if (!sameIdentity(existing.source, this.options.sourceIdentity) || !sameSelection(existing.selection, this.options.selection)) {
        throw new Error("The saved distributed manifest belongs to a different source or host selection");
      }
      return existing;
    }
    const pieces = planDistributedRanges({
      totalSize: this.options.sourceIdentity.length,
      selectedHostCount: this.selectedHosts.length,
    });
    const manifest = createDistributedManifest({
      downloadId: this.item.id,
      source: this.options.sourceIdentity,
      selection: this.options.selection,
      pieces,
    });
    await this.store.save(manifest);
    return manifest;
  }

  private async revalidatePersistedPieces(): Promise<void> {
    if (!this.manifest) return;
    let changed = false;
    const pieces: DistributedManifestPiece[] = [];
    for (const piece of this.manifest.pieces) {
      if (piece.state !== "verified") {
        await fsp.rm(this.store.piecePath(piece.pieceId), { force: true });
        pieces.push(clonePending(piece));
        continue;
      }
      try {
        const actual = await sha256File(this.store.piecePath(piece.pieceId));
        if (actual.byteLength !== piece.length || actual.sha256 !== piece.sha256) throw new Error("mismatch");
        pieces.push({ ...piece });
      } catch {
        changed = true;
        await fsp.rm(this.store.piecePath(piece.pieceId), { force: true });
        pieces.push(clonePending(piece));
      }
    }
    if (changed) {
      this.manifest = { ...this.manifest, updatedAt: Date.now(), pieces };
      if (!isDistributedManifest(this.manifest)) throw new Error("Distributed manifest recovery produced invalid state");
      await this.store.save(this.manifest);
    }
  }

  private async downloadPendingPieces(work: PendingPiece[], signal: AbortSignal): Promise<void> {
    while (work.length > 0) {
      if (signal.aborted) throw new Error("Distributed download stopped");
      const healthy = this.selectedHosts.filter((host) => !this.quarantinedHosts.has(host.id));
      if (healthy.length === 0) throw new Error("Every selected SSH host was quarantined for this download");

      const assignments: Array<{ host: SshHostConfig; work: PendingPiece }> = [];
      const assigned = new Set<PendingPiece>();
      const healthyIds = new Set(healthy.map((host) => host.id));
      for (const host of healthy) {
        const candidate = work.find((entry) =>
          !assigned.has(entry) && (entry.preferredHostId === host.id || entry.preferredHostId === null));
        const fallback = candidate ?? work.find((entry) =>
          !assigned.has(entry) &&
          (entry.preferredHostId === null || !healthyIds.has(entry.preferredHostId))
        );
        if (!fallback) continue;
        assignments.push({ host, work: fallback });
        assigned.add(fallback);
      }

      if (assignments.length === 0) {
        throw new Error("Distributed scheduler could not assign any pending piece to a healthy SSH host");
      }

      const results = await Promise.all(assignments.map(async ({ host, work: entry }) => {
        try {
          await this.downloadOnePiece(host, entry.piece, signal);
          return { host, entry, error: null as unknown };
        } catch (error) {
          return { host, entry, error };
        }
      }));

      for (const result of results) {
        if (result.error === null) {
          work.splice(work.indexOf(result.entry), 1);
          continue;
        }
        if (signal.aborted) throw new Error("Distributed download stopped");
        if (result.error instanceof SshWorkerRemoteError && !result.error.retryable) {
          throw result.error;
        }
        result.entry.attempts += 1;
        const integrityFailure = result.error instanceof SshWorkerIntegrityError;
        if (integrityFailure) this.quarantineHost(result.host.id);
        if (result.entry.attempts >= this.maxAttemptsPerPiece) {
          throw new Error(`A distributed piece failed after ${this.maxAttemptsPerPiece} bounded attempts`);
        }
        if (integrityFailure) {
          const alternative = this.selectedHosts.find((host) =>
            host.id !== result.host.id && !this.quarantinedHosts.has(host.id));
          if (!alternative) throw new Error("No different healthy SSH host is available after an integrity failure");
          result.entry.preferredHostId = alternative.id;
        } else {
          const alternative = this.selectedHosts.find((host) =>
            host.id !== result.host.id && !this.quarantinedHosts.has(host.id));
          // A transient transport failure may retry on the same host when it
          // is the only healthy choice.  The attempt bound remains the real
          // liveness guard; do not turn a one-host download into a two-attempt
          // failure merely because reassignment has nowhere to go.
          result.entry.preferredHostId = alternative?.id ?? result.host.id;
        }
      }
    }
  }

  private async downloadOnePiece(
    host: SshHostConfig,
    piece: DistributedManifestPiece,
    signal: AbortSignal,
  ): Promise<void> {
    const requestId = randomUUID();
    const partialPath = path.join(this.store.piecesDirectory, `${piece.pieceId}.partial.${requestId}`);
    await fsp.mkdir(this.store.piecesDirectory, { recursive: true });
    const handle = await fsp.open(partialPath, "wx", 0o600);
    let written = 0;
    this.setHostState(host.id, "downloading", null, 1, piece, 0);
    const request: DistributedRangeRequestV1 = {
      version: 1,
      type: "range-request",
      requestId,
      pieceId: piece.pieceId,
      url: this.options.source.url,
      range: { start: piece.start, endExclusive: piece.endExclusive },
      headers: { ...this.options.source.headers },
      source: { ...this.options.sourceIdentity },
    };
    try {
      const result = await this.rangeFetcher.fetchRange(host, request, async (chunk) => {
        if (signal.aborted) throw new Error("Distributed download stopped");
        let offset = 0;
        while (offset < chunk.byteLength) {
          const outcome = await handle.write(chunk, offset, chunk.byteLength - offset, written);
          if (outcome.bytesWritten < 1) throw new Error("The local piece file stopped accepting bytes");
          offset += outcome.bytesWritten;
          written += outcome.bytesWritten;
          this.advancePieceProgress(piece.pieceId, outcome.bytesWritten);
          this.advanceHostProgress(host.id, piece, outcome.bytesWritten);
        }
      }, signal);
      if (written !== piece.length || result.byteLength !== piece.length) {
        throw new SshWorkerIntegrityError("The received piece length did not match its immutable assignment");
      }
      await handle.sync();
      await handle.close();
      const actual = await sha256File(partialPath);
      if (actual.byteLength !== piece.length || actual.sha256 !== result.sha256) {
        throw new SshWorkerIntegrityError("The persisted piece hash did not match the verified transfer");
      }
      const finalPath = this.store.piecePath(piece.pieceId);
      await fsp.rename(partialPath, finalPath);
      this.manifest = markDistributedPieceVerified(this.manifest as DistributedManifest, piece.pieceId, actual.sha256);
      await this.store.save(this.manifest);
      this.completePieceProgress(piece.pieceId);
      this.incrementHostCompleted(host.id);
    } catch (error) {
      await handle.close().catch(() => {});
      await fsp.rm(partialPath, { force: true });
      this.resetPieceProgress(piece.pieceId);
      this.incrementHostFailed(host.id, error instanceof Error ? error.message : "Piece failed");
      throw error;
    } finally {
      this.setHostState(host.id, this.quarantinedHosts.has(host.id) ? "quarantined" : "waiting", null, -1);
    }
  }

  private async assembleVerifiedPieces(signal: AbortSignal): Promise<void> {
    const manifest = this.manifest;
    if (!manifest || manifest.pieces.some((piece) => piece.state !== "verified")) {
      throw new Error("Distributed assembly requires every piece to be verified");
    }
    await this.identityVerifier.verifyUnchanged(
      this.options.source.url,
      this.options.source.headers,
      manifest.source,
    );
    await fsp.mkdir(this.item.folder, { recursive: true });
    const assemblingPath = path.join(this.item.folder, `${this.item.fileName}.mdm-assembling.${randomUUID()}`);
    const destination = await fsp.open(assemblingPath, "wx", 0o600);
    const wholeHash = createHash("sha256");
    let total = 0;
    try {
      for (const piece of manifest.pieces) {
        if (signal.aborted) throw new Error("Distributed download stopped");
        const piecePath = this.store.piecePath(piece.pieceId);
        const actual = await sha256File(piecePath);
        if (actual.byteLength !== piece.length || actual.sha256 !== piece.sha256) {
          throw new SshWorkerIntegrityError("A verified piece changed before assembly");
        }
        for await (const chunk of fs.createReadStream(piecePath)) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          wholeHash.update(bytes);
          let offset = 0;
          while (offset < bytes.byteLength) {
            const result = await destination.write(bytes, offset, bytes.byteLength - offset, total);
            if (result.bytesWritten < 1) throw new Error("The assembled file stopped accepting bytes");
            offset += result.bytesWritten;
            total += result.bytesWritten;
          }
        }
      }
      if (total !== manifest.source.length) throw new Error("The assembled file length did not match the source identity");
      const digest = wholeHash.digest("hex");
      const expected = manifest.selection.expectedSha256;
      if (expected && digest !== expected) {
        await this.invalidateVerifiedPieces(manifest);
        throw new SshWorkerIntegrityError("The assembled file did not match the trusted expected SHA-256 digest");
      }
      await destination.sync();
      await destination.close();
      await fsp.access(this.filePath).then(
        () => { throw new Error("The final download path became occupied before assembly completed"); },
        () => undefined,
      );
      await fsp.rename(assemblingPath, this.filePath);
      // The rename is the commit point.  A locked antivirus handle or a
      // best-effort cleanup failure must not turn an installed, hash-checked
      // file back into a failed download.
      try {
        await fsp.rm(this.store.workDirectory, { recursive: true, force: true });
      } catch {
        this.item.transferNotice = "Download completed, but temporary distributed files remain and require cleanup.";
      }
    } catch (error) {
      await destination.close().catch(() => {});
      await fsp.rm(assemblingPath, { force: true });
      throw error;
    }
  }

  private async invalidateVerifiedPieces(manifest: DistributedManifest): Promise<void> {
    await Promise.all(manifest.pieces.map((piece) =>
      fsp.rm(this.store.piecePath(piece.pieceId), { force: true }).catch(() => {})
    ));
    const pieces = manifest.pieces.map((piece) => {
      return clonePending(piece);
    });
    this.manifest = { ...manifest, pieces, updatedAt: Date.now() };
    await this.store.save(this.manifest);
    this.syncItemParts();
  }

  private syncItemParts(): void {
    if (!this.manifest) return;
    this.item.parts = this.manifest.pieces.map((piece): PartInfo => ({
      id: piece.index + 1,
      from: piece.start,
      to: piece.endExclusive - 1,
      current: piece.state === "verified" ? piece.endExclusive : piece.start,
      status: piece.state === "verified" ? "completed" : "idle",
    }));
    this.item.connections = this.selectedHosts.length;
    this.item.totalSize = this.manifest.source.length;
    this.item.resumeSupport = true;
    this.item.downloadedSize = this.item.parts.reduce((sum, piece) => sum + Math.max(0, piece.current - piece.from), 0);
  }

  private advancePieceProgress(pieceId: string, bytes: number): void {
    const manifestPiece = this.manifest?.pieces.find((piece) => piece.pieceId === pieceId);
    if (!manifestPiece) return;
    const part = this.item.parts[manifestPiece.index];
    if (!part) return;
    part.status = "downloading";
    part.current = Math.min(manifestPiece.endExclusive, part.current + bytes);
    this.item.downloadedSize = this.item.parts.reduce((sum, candidate) =>
      sum + Math.max(0, candidate.current - candidate.from), 0);
    this.emit("progress");
  }

  private completePieceProgress(pieceId: string): void {
    const manifestPiece = this.manifest?.pieces.find((piece) => piece.pieceId === pieceId);
    if (!manifestPiece) return;
    const part = this.item.parts[manifestPiece.index];
    if (!part) return;
    part.current = manifestPiece.endExclusive;
    part.status = "completed";
    this.emit("progress");
  }

  private resetPieceProgress(pieceId: string): void {
    const manifestPiece = this.manifest?.pieces.find((piece) => piece.pieceId === pieceId);
    if (!manifestPiece) return;
    const part = this.item.parts[manifestPiece.index];
    if (!part) return;
    part.current = manifestPiece.start;
    part.status = "idle";
    this.item.downloadedSize = this.item.parts.reduce((sum, candidate) =>
      sum + Math.max(0, candidate.current - candidate.from), 0);
    this.emit("progress");
  }

  private startProgressTimer(): void {
    this.lastProgressBytes = this.item.downloadedSize;
    this.lastProgressAt = Date.now();
    this.progressTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastProgressAt) / 1_000;
      const delta = this.item.downloadedSize - this.lastProgressBytes;
      this.item.speed = elapsed > 0 ? Math.max(0, delta / elapsed) : 0;
      const remaining = Math.max(0, (this.item.totalSize ?? 0) - this.item.downloadedSize);
      this.item.eta = this.item.speed > 0 ? Math.ceil(remaining / this.item.speed) : null;
      this.lastProgressBytes = this.item.downloadedSize;
      this.lastProgressAt = now;
      for (const progress of this.item.sshProgress ?? []) {
        const bytes = progress.transferredBytes ?? 0;
        const previous = this.lastHostProgress.get(progress.hostId) ?? { bytes, at: now };
        const hostElapsed = (now - previous.at) / 1_000;
        progress.bytesPerSecond = hostElapsed > 0 ? Math.max(0, (bytes - previous.bytes) / hostElapsed) : 0;
        this.lastHostProgress.set(progress.hostId, { bytes, at: now });
      }
      this.emit("progress");
    }, 1_000);
    this.progressTimer.unref();
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private async removePartialFiles(): Promise<void> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.store.piecesDirectory);
    } catch {
      return;
    }
    await Promise.all(entries
      .filter((entry) => /^piece-\d{4}\.partial\.[0-9a-f-]+$/u.test(entry))
      .map((entry) => fsp.rm(path.join(this.store.piecesDirectory, entry), { force: true })));
  }

  private initializeHostProgress(): void {
    this.item.sshProgress = this.selectedHosts.map((host): SshHostTransferProgress => ({
      hostId: host.id,
      pieceId: null,
      rangeStart: null,
      rangeEndExclusive: null,
      transferredBytes: 0,
      bytesPerSecond: 0,
      activePieces: 0,
      completedPieces: 0,
      failedPieces: 0,
      state: "waiting",
      message: null,
    }));
  }

  private hostProgress(hostId: string): SshHostTransferProgress | undefined {
    return this.item.sshProgress?.find((entry) => entry.hostId === hostId);
  }

  private setHostState(
    hostId: string,
    state: SshHostTransferProgress["state"],
    message: string | null,
    activeDelta = 0,
    piece: DistributedManifestPiece | null = null,
    transferredBytes = 0,
  ): void {
    const progress = this.hostProgress(hostId);
    if (!progress) return;
    progress.state = state;
    progress.message = message;
    progress.activePieces = Math.max(0, progress.activePieces + activeDelta);
    if (piece) {
      progress.pieceId = piece.pieceId;
      progress.rangeStart = piece.start;
      progress.rangeEndExclusive = piece.endExclusive;
      progress.transferredBytes = transferredBytes;
      progress.bytesPerSecond = 0;
    }
    if (activeDelta < 0 && progress.activePieces === 0) {
      progress.pieceId = null;
      progress.rangeStart = null;
      progress.rangeEndExclusive = null;
      progress.bytesPerSecond = 0;
    }
    this.emit("progress");
  }

  private advanceHostProgress(hostId: string, piece: DistributedManifestPiece, bytes: number): void {
    const progress = this.hostProgress(hostId);
    if (!progress) return;
    progress.pieceId = piece.pieceId;
    progress.rangeStart = piece.start;
    progress.rangeEndExclusive = piece.endExclusive;
    progress.transferredBytes = (progress.transferredBytes ?? 0) + bytes;
    this.emit("progress");
  }

  private incrementHostCompleted(hostId: string): void {
    const progress = this.hostProgress(hostId);
    if (progress) progress.completedPieces += 1;
  }

  private incrementHostFailed(hostId: string, message: string): void {
    const progress = this.hostProgress(hostId);
    if (!progress) return;
    progress.failedPieces += 1;
    progress.message = message.slice(0, 512);
  }

  private quarantineHost(hostId: string): void {
    this.quarantinedHosts.add(hostId);
    const progress = this.hostProgress(hostId);
    if (progress) {
      progress.state = "quarantined";
      progress.message = "This host was quarantined after a protocol or integrity failure.";
    }
  }

  private finishHostProgress(state: SshHostTransferProgress["state"], message: string | null): void {
    for (const progress of this.item.sshProgress ?? []) {
      if (progress.state !== "quarantined") progress.state = state;
      progress.activePieces = 0;
      progress.message = progress.state === "quarantined" ? progress.message : message;
    }
  }
}
