import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DISTRIBUTED_MANIFEST_VERSION,
  type DistributedDownloadSelection,
  type DistributedManifest,
  type DistributedPiece,
  type SourceIdentity,
  isDistributedId,
  isDistributedManifest,
  isSha256,
  isSourceIdentity,
} from "../../../shared/distributedProtocol";

export const DISTRIBUTED_MANIFEST_FILE_NAME = "manifest.v1.json";
export const DISTRIBUTED_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

export interface CreateDistributedManifestInput {
  downloadId: string;
  source: SourceIdentity;
  selection: DistributedDownloadSelection;
  pieces: readonly Readonly<DistributedPiece>[];
  now?: number;
}

function cloneSelection(selection: DistributedDownloadSelection): DistributedDownloadSelection {
  return {
    mode: "ssh",
    ...(selection.hostIds ? { hostIds: [...selection.hostIds] } : {}),
    ...(selection.workerCount !== undefined ? { workerCount: selection.workerCount } : {}),
    ...(selection.expectedSha256 !== undefined ? { expectedSha256: selection.expectedSha256 } : {}),
  };
}

export function createDistributedManifest(input: CreateDistributedManifestInput): DistributedManifest {
  if (!isDistributedId(input.downloadId)) throw new TypeError("downloadId is not a valid distributed identifier.");
  if (!isSourceIdentity(input.source)) throw new TypeError("source identity is invalid or lacks a validator.");
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 1) throw new RangeError("now must be a positive safe integer.");

  const manifest: DistributedManifest = {
    version: DISTRIBUTED_MANIFEST_VERSION,
    downloadId: input.downloadId,
    source: { ...input.source },
    selection: cloneSelection(input.selection),
    createdAt: now,
    updatedAt: now,
    pieces: input.pieces.map((piece) => ({
      ...piece,
      state: "pending" as const,
      verifiedByteLength: null,
      sha256: null,
      verifiedAt: null,
    })),
  };
  if (!isDistributedManifest(manifest)) {
    throw new TypeError("The supplied pieces do not form a complete distributed manifest.");
  }
  return manifest;
}

export function markDistributedPieceVerified(
  manifest: DistributedManifest,
  pieceId: string,
  sha256: string,
  verifiedAt = Date.now()
): DistributedManifest {
  if (!isDistributedManifest(manifest)) throw new TypeError("Cannot update an invalid distributed manifest.");
  if (!isDistributedId(pieceId)) throw new TypeError("pieceId is not a valid distributed identifier.");
  if (!isSha256(sha256)) throw new TypeError("sha256 must be lowercase hexadecimal.");
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt < manifest.updatedAt) {
    throw new RangeError("verifiedAt must be a safe integer at or after the latest manifest update.");
  }
  let found = false;
  const pieces = manifest.pieces.map((piece) => {
    if (piece.pieceId !== pieceId) return { ...piece };
    found = true;
    if (piece.state === "verified" && piece.sha256 !== sha256) {
      throw new Error(`Verified distributed piece ${pieceId} cannot be replaced with a different digest.`);
    }
    return {
      ...piece,
      state: "verified" as const,
      verifiedByteLength: piece.length,
      sha256,
      verifiedAt,
    };
  });
  if (!found) throw new RangeError(`Unknown distributed piece ${pieceId}.`);
  return {
    ...manifest,
    source: { ...manifest.source },
    selection: cloneSelection(manifest.selection),
    updatedAt: verifiedAt,
    pieces,
  };
}

function assertContained(baseDirectory: string, candidate: string): string {
  const relative = path.relative(baseDirectory, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return candidate;
  }
  throw new Error("Derived distributed path escaped its managed directory.");
}

/**
 * Owns manifest and piece paths below one caller-supplied absolute data root.
 * Neither URLs nor persisted strings ever become filesystem path components.
 */
export class DistributedManifestStore {
  private static readonly saveChains = new Map<string, Promise<void>>();
  readonly baseDirectory: string;
  readonly workDirectory: string;
  readonly piecesDirectory: string;
  readonly manifestPath: string;

  constructor(baseDirectory: string, readonly downloadId: string) {
    if (!path.isAbsolute(baseDirectory) || baseDirectory.includes("\0")) {
      throw new TypeError("Distributed manifest baseDirectory must be an absolute local path.");
    }
    if (!isDistributedId(downloadId)) throw new TypeError("downloadId is not a valid distributed identifier.");
    this.baseDirectory = path.resolve(baseDirectory);
    this.workDirectory = assertContained(this.baseDirectory, path.resolve(this.baseDirectory, downloadId));
    this.piecesDirectory = assertContained(this.workDirectory, path.resolve(this.workDirectory, "pieces"));
    this.manifestPath = assertContained(
      this.workDirectory,
      path.resolve(this.workDirectory, DISTRIBUTED_MANIFEST_FILE_NAME)
    );
  }

  piecePath(pieceId: string): string {
    if (!isDistributedId(pieceId)) throw new TypeError("pieceId is not a valid distributed identifier.");
    return assertContained(this.piecesDirectory, path.resolve(this.piecesDirectory, `${pieceId}.part`));
  }

  async load(): Promise<DistributedManifest | null> {
    let stat;
    try {
      stat = await fsp.stat(this.manifestPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isFile() || stat.size > DISTRIBUTED_MANIFEST_MAX_BYTES) {
      throw new Error("Distributed manifest is not a bounded regular file.");
    }

    let value: unknown;
    try {
      value = JSON.parse(await fsp.readFile(this.manifestPath, "utf8"));
    } catch {
      throw new Error("Distributed manifest contains invalid JSON.");
    }
    if (!isDistributedManifest(value) || value.downloadId !== this.downloadId) {
      throw new Error("Distributed manifest does not match the exact version-1 schema.");
    }
    return value;
  }

  async save(manifest: DistributedManifest): Promise<void> {
    if (!isDistributedManifest(manifest) || manifest.downloadId !== this.downloadId) {
      throw new TypeError("Refusing to save an invalid or mismatched distributed manifest.");
    }
    const serialized = JSON.stringify(manifest, null, 2);
    if (Buffer.byteLength(serialized, "utf8") > DISTRIBUTED_MANIFEST_MAX_BYTES) {
      throw new RangeError("Distributed manifest exceeds its storage bound.");
    }

    const prior = DistributedManifestStore.saveChains.get(this.manifestPath) ?? Promise.resolve();
    const operation = prior.catch(() => undefined).then(async () => {
      await fsp.mkdir(this.piecesDirectory, { recursive: true });
      const temporaryPath = assertContained(
        this.workDirectory,
        path.resolve(this.workDirectory, `${DISTRIBUTED_MANIFEST_FILE_NAME}.${randomUUID()}.tmp`)
      );
      try {
        await fsp.writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await fsp.rename(temporaryPath, this.manifestPath);
      } finally {
        await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      }
    });
    DistributedManifestStore.saveChains.set(this.manifestPath, operation);
    try {
      await operation;
    } finally {
      if (DistributedManifestStore.saveChains.get(this.manifestPath) === operation) {
        DistributedManifestStore.saveChains.delete(this.manifestPath);
      }
    }
  }
}
