import {
  DISTRIBUTED_MAX_HOSTS,
  DISTRIBUTED_MAX_PIECES,
  type DistributedPiece,
} from "../../../shared/distributedProtocol";

export const DISTRIBUTED_TARGET_PIECE_BYTES = 32 * 1024 * 1024;

export interface DistributedRangePlanInput {
  totalSize: number;
  selectedHostCount: number;
  targetPieceBytes?: number;
}

function requirePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

/**
 * Produces an immutable, contiguous partition of [0, totalSize). Natural
 * pieces target 32 MiB, while small files still produce enough pieces to keep
 * every selected host busy when at least one byte exists for each host.
 */
export function planDistributedRanges(input: DistributedRangePlanInput): readonly Readonly<DistributedPiece>[] {
  requirePositiveSafeInteger("totalSize", input.totalSize);
  requirePositiveSafeInteger("selectedHostCount", input.selectedHostCount);
  if (input.selectedHostCount > DISTRIBUTED_MAX_HOSTS) {
    throw new RangeError(`selectedHostCount cannot exceed ${DISTRIBUTED_MAX_HOSTS}.`);
  }

  const targetPieceBytes = input.targetPieceBytes ?? DISTRIBUTED_TARGET_PIECE_BYTES;
  requirePositiveSafeInteger("targetPieceBytes", targetPieceBytes);

  const naturalPieceCount = Math.ceil(input.totalSize / targetPieceBytes);
  const hostFloor = Math.min(input.selectedHostCount, input.totalSize);
  const pieceCount = Math.min(DISTRIBUTED_MAX_PIECES, Math.max(naturalPieceCount, hostFloor));
  const baseLength = Math.floor(input.totalSize / pieceCount);
  const remainder = input.totalSize % pieceCount;

  const pieces: Readonly<DistributedPiece>[] = [];
  let start = 0;
  for (let index = 0; index < pieceCount; index += 1) {
    const length = baseLength + (index < remainder ? 1 : 0);
    const endExclusive = start + length;
    pieces.push(Object.freeze({
      pieceId: `piece-${String(index + 1).padStart(4, "0")}`,
      index,
      start,
      endExclusive,
      length,
    }));
    start = endExclusive;
  }

  return Object.freeze(pieces);
}
