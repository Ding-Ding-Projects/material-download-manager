import assert from "node:assert/strict";
import test from "node:test";
import { DISTRIBUTED_MAX_PIECES } from "../../../shared/distributedProtocol";
import {
  DISTRIBUTED_TARGET_PIECE_BYTES,
  planDistributedRanges,
} from "../distributed/DistributedRangePlanner";

function assertCompletePartition(totalSize: number, pieces: ReturnType<typeof planDistributedRanges>): void {
  assert.ok(pieces.length > 0);
  let cursor = 0;
  for (const [index, piece] of pieces.entries()) {
    assert.equal(piece.index, index);
    assert.equal(piece.start, cursor);
    assert.ok(piece.endExclusive > piece.start);
    assert.equal(piece.length, piece.endExclusive - piece.start);
    cursor = piece.endExclusive;
  }
  assert.equal(cursor, totalSize);
}

test("planner covers the source exactly with contiguous non-overlapping immutable pieces", () => {
  const totalSize = DISTRIBUTED_TARGET_PIECE_BYTES * 5 + 123;
  const pieces = planDistributedRanges({ totalSize, selectedHostCount: 3 });
  assert.equal(pieces.length, 6);
  assertCompletePartition(totalSize, pieces);
  assert.equal(Object.isFrozen(pieces), true);
  assert.ok(pieces.every(Object.isFrozen));
  assert.ok(Math.max(...pieces.map((piece) => piece.length)) - Math.min(...pieces.map((piece) => piece.length)) <= 1);
  assert.throws(() => {
    (pieces[0] as unknown as DistributedMutablePiece).start = 99;
  }, TypeError);
});

interface DistributedMutablePiece {
  start: number;
}

test("planner creates at least one piece per selected host when the file has enough bytes", () => {
  const pieces = planDistributedRanges({ totalSize: 10, selectedHostCount: 8, targetPieceBytes: 1_000 });
  assert.equal(pieces.length, 8);
  assertCompletePartition(10, pieces);
});

test("planner handles a file smaller than the selected host count without zero-byte pieces", () => {
  const pieces = planDistributedRanges({ totalSize: 3, selectedHostCount: 16 });
  assert.deepEqual(
    pieces.map((piece) => [piece.start, piece.endExclusive, piece.length]),
    [
      [0, 1, 1],
      [1, 2, 1],
      [2, 3, 1],
    ]
  );
});

test("planner caps very large files at 4096 pieces without losing coverage", () => {
  const totalSize = DISTRIBUTED_TARGET_PIECE_BYTES * DISTRIBUTED_MAX_PIECES + 1;
  const pieces = planDistributedRanges({ totalSize, selectedHostCount: 16 });
  assert.equal(pieces.length, DISTRIBUTED_MAX_PIECES);
  assertCompletePartition(totalSize, pieces);
});

test("planner rejects unsafe sizes and more than sixteen selected hosts", () => {
  assert.throws(() => planDistributedRanges({ totalSize: 0, selectedHostCount: 1 }), /totalSize/i);
  assert.throws(() => planDistributedRanges({ totalSize: 1, selectedHostCount: 0 }), /selectedHostCount/i);
  assert.throws(() => planDistributedRanges({ totalSize: 1, selectedHostCount: 17 }), /cannot exceed 16/i);
  assert.throws(
    () => planDistributedRanges({ totalSize: Number.MAX_SAFE_INTEGER + 1, selectedHostCount: 1 }),
    /totalSize/i
  );
});
