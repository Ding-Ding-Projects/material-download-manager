import { TextDecoder } from "node:util";
import {
  DISTRIBUTED_FRAME_HEADER_BYTES,
  DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE,
  DISTRIBUTED_FRAME_TYPES,
  type DistributedFrameType,
  type DistributedRangeEndV1,
  type DistributedRangeErrorV1,
  type DistributedRangeMetaV1,
  type DistributedRangeRequestV1,
  isDistributedRangeEndV1,
  isDistributedRangeErrorV1,
  isDistributedRangeMetaV1,
  isDistributedRangeRequestV1,
} from "../../../shared/distributedProtocol";

export type DistributedDecodedFrame =
  | { frameType: typeof DISTRIBUTED_FRAME_TYPES.REQUEST; payload: DistributedRangeRequestV1 }
  | { frameType: typeof DISTRIBUTED_FRAME_TYPES.META; payload: DistributedRangeMetaV1 }
  | { frameType: typeof DISTRIBUTED_FRAME_TYPES.DATA; payload: Buffer }
  | { frameType: typeof DISTRIBUTED_FRAME_TYPES.END; payload: DistributedRangeEndV1 }
  | { frameType: typeof DISTRIBUTED_FRAME_TYPES.ERROR; payload: DistributedRangeErrorV1 };

export type DistributedWorkerResponseFrame = Exclude<
  DistributedDecodedFrame,
  { frameType: typeof DISTRIBUTED_FRAME_TYPES.REQUEST }
>;

export type DistributedProtocolErrorCode =
  | "unknown-frame-type"
  | "empty-frame"
  | "frame-too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "invalid-payload"
  | "invalid-response-order";

export class DistributedProtocolError extends Error {
  constructor(
    readonly code: DistributedProtocolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DistributedProtocolError";
  }
}

function isKnownFrameType(value: number): value is DistributedFrameType {
  return Object.prototype.hasOwnProperty.call(DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE, value);
}

function frameLimit(frameType: DistributedFrameType): number {
  return DISTRIBUTED_FRAME_MAX_PAYLOAD_BY_TYPE[frameType];
}

function assertPayloadLength(frameType: DistributedFrameType, length: number): void {
  if (length === 0) {
    throw new DistributedProtocolError("empty-frame", `Frame type ${frameType} cannot have an empty payload.`);
  }
  const maximum = frameLimit(frameType);
  if (length > maximum) {
    throw new DistributedProtocolError(
      "frame-too-large",
      `Frame type ${frameType} declares ${length} bytes; the maximum is ${maximum}.`
    );
  }
}

function assertJsonPayload(frameType: Exclude<DistributedFrameType, typeof DISTRIBUTED_FRAME_TYPES.DATA>, value: unknown): void {
  const valid =
    (frameType === DISTRIBUTED_FRAME_TYPES.REQUEST && isDistributedRangeRequestV1(value)) ||
    (frameType === DISTRIBUTED_FRAME_TYPES.META && isDistributedRangeMetaV1(value)) ||
    (frameType === DISTRIBUTED_FRAME_TYPES.END && isDistributedRangeEndV1(value)) ||
    (frameType === DISTRIBUTED_FRAME_TYPES.ERROR && isDistributedRangeErrorV1(value));
  if (!valid) {
    throw new DistributedProtocolError("invalid-payload", `Frame type ${frameType} has an invalid version-1 payload.`);
  }
}

function encodePayload(frameType: DistributedFrameType, payload: Buffer): Buffer {
  assertPayloadLength(frameType, payload.byteLength);
  const header = Buffer.alloc(DISTRIBUTED_FRAME_HEADER_BYTES);
  header.writeUInt8(frameType, 0);
  header.writeUInt32BE(payload.byteLength, 1);
  return Buffer.concat([header, payload], DISTRIBUTED_FRAME_HEADER_BYTES + payload.byteLength);
}

export function encodeDistributedJsonFrame(
  frameType: Exclude<DistributedFrameType, typeof DISTRIBUTED_FRAME_TYPES.DATA>,
  value: unknown
): Buffer {
  assertJsonPayload(frameType, value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new DistributedProtocolError("invalid-payload", `Frame type ${frameType} could not be serialized.`);
  }
  return encodePayload(frameType, Buffer.from(serialized, "utf8"));
}

export function encodeDistributedDataFrame(value: Uint8Array): Buffer {
  const payload = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return encodePayload(DISTRIBUTED_FRAME_TYPES.DATA, payload);
}

/**
 * Incremental decoder for the 1-byte type + 4-byte big-endian length wire
 * format. It validates a type-specific bound as soon as the five header bytes
 * arrive and never allocates a declared payload before that validation.
 */
export class DistributedFrameDecoder {
  private readonly header = Buffer.alloc(DISTRIBUTED_FRAME_HEADER_BYTES);
  private headerBytes = 0;
  private frameType: DistributedFrameType | null = null;
  private expectedPayloadBytes = 0;
  private receivedPayloadBytes = 0;
  private payloadChunks: Buffer[] = [];
  private failure: DistributedProtocolError | null = null;

  push(input: Uint8Array): DistributedDecodedFrame[] {
    if (this.failure) throw this.failure;
    const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const frames: DistributedDecodedFrame[] = [];
    let offset = 0;

    try {
      while (offset < chunk.byteLength) {
        if (this.frameType === null) {
          const needed = DISTRIBUTED_FRAME_HEADER_BYTES - this.headerBytes;
          const count = Math.min(needed, chunk.byteLength - offset);
          chunk.copy(this.header, this.headerBytes, offset, offset + count);
          this.headerBytes += count;
          offset += count;
          if (this.headerBytes < DISTRIBUTED_FRAME_HEADER_BYTES) continue;

          const rawType = this.header.readUInt8(0);
          if (!isKnownFrameType(rawType)) {
            throw new DistributedProtocolError("unknown-frame-type", `Unknown distributed frame type ${rawType}.`);
          }
          const declaredLength = this.header.readUInt32BE(1);
          assertPayloadLength(rawType, declaredLength);
          this.frameType = rawType;
          this.expectedPayloadBytes = declaredLength;
          this.receivedPayloadBytes = 0;
          this.payloadChunks = [];
          this.headerBytes = 0;
        }

        const remainingPayload = this.expectedPayloadBytes - this.receivedPayloadBytes;
        const count = Math.min(remainingPayload, chunk.byteLength - offset);
        if (count > 0) {
          // Copy only after the declared length has passed its type-specific bound.
          this.payloadChunks.push(Buffer.from(chunk.subarray(offset, offset + count)));
          this.receivedPayloadBytes += count;
          offset += count;
        }

        if (this.receivedPayloadBytes === this.expectedPayloadBytes) {
          const completedType = this.frameType;
          const payload = Buffer.concat(this.payloadChunks, this.expectedPayloadBytes);
          this.frameType = null;
          this.expectedPayloadBytes = 0;
          this.receivedPayloadBytes = 0;
          this.payloadChunks = [];
          frames.push(this.decodePayload(completedType, payload));
        }
      }
    } catch (error) {
      this.failure = error instanceof DistributedProtocolError
        ? error
        : new DistributedProtocolError("invalid-payload", "The distributed frame could not be decoded.");
      throw this.failure;
    }

    return frames;
  }

  get bufferedByteLength(): number {
    return this.headerBytes + this.receivedPayloadBytes;
  }

  private decodePayload(frameType: DistributedFrameType, payload: Buffer): DistributedDecodedFrame {
    if (frameType === DISTRIBUTED_FRAME_TYPES.DATA) {
      return { frameType, payload };
    }

    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    } catch {
      throw new DistributedProtocolError("invalid-utf8", `Frame type ${frameType} is not valid UTF-8.`);
    }

    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw new DistributedProtocolError("invalid-json", `Frame type ${frameType} is not valid JSON.`);
    }
    assertJsonPayload(frameType, value);

    switch (frameType) {
      case DISTRIBUTED_FRAME_TYPES.REQUEST:
        return { frameType, payload: value as DistributedRangeRequestV1 };
      case DISTRIBUTED_FRAME_TYPES.META:
        return { frameType, payload: value as DistributedRangeMetaV1 };
      case DISTRIBUTED_FRAME_TYPES.END:
        return { frameType, payload: value as DistributedRangeEndV1 };
      case DISTRIBUTED_FRAME_TYPES.ERROR:
        return { frameType, payload: value as DistributedRangeErrorV1 };
      default:
        throw new DistributedProtocolError("unknown-frame-type", `Unknown distributed frame type ${frameType}.`);
    }
  }
}

export type WorkerResponseSequenceState = "awaiting-meta" | "streaming" | "completed" | "failed";

function sameRange(
  left: { start: number; endExclusive: number },
  right: { start: number; endExclusive: number }
): boolean {
  return left.start === right.start && left.endExclusive === right.endExclusive;
}

function sameSourceIdentity(
  left: { length: number; etag: string | null; lastModified: string | null },
  right: { length: number; etag: string | null; lastModified: string | null }
): boolean {
  return left.length === right.length && left.etag === right.etag && left.lastModified === right.lastModified;
}

/** Enforces META -> DATA* -> END, or ERROR as the only terminal alternative. */
export class WorkerResponseOrderValidator {
  private sequenceState: WorkerResponseSequenceState = "awaiting-meta";
  private receivedBytes = 0;

  constructor(private readonly request: DistributedRangeRequestV1) {
    if (!isDistributedRangeRequestV1(request)) {
      throw new DistributedProtocolError("invalid-payload", "Response ordering requires a valid range request.");
    }
  }

  accept(frame: DistributedWorkerResponseFrame): WorkerResponseSequenceState {
    if (this.sequenceState === "completed" || this.sequenceState === "failed") {
      throw new DistributedProtocolError(
        "invalid-response-order",
        `A ${this.sequenceState} response sequence cannot accept another frame.`
      );
    }

    if (frame.frameType === DISTRIBUTED_FRAME_TYPES.ERROR) {
      if (frame.payload.requestId !== null && frame.payload.pieceId !== null) {
        this.assertMatchingIds(frame.payload.requestId, frame.payload.pieceId);
      }
      this.sequenceState = "failed";
      return this.sequenceState;
    }

    if (this.sequenceState === "awaiting-meta") {
      if (frame.frameType !== DISTRIBUTED_FRAME_TYPES.META) {
        throw new DistributedProtocolError("invalid-response-order", "The first worker response must be META or ERROR.");
      }
      this.assertMatchingIds(frame.payload.requestId, frame.payload.pieceId);
      if (!sameRange(frame.payload.range, this.request.range)) {
        throw new DistributedProtocolError("invalid-response-order", "META does not echo the requested byte range.");
      }
      if (!sameSourceIdentity(frame.payload.source, this.request.source)) {
        throw new DistributedProtocolError("invalid-response-order", "META reports a different source identity.");
      }
      this.sequenceState = "streaming";
      return this.sequenceState;
    }

    if (frame.frameType === DISTRIBUTED_FRAME_TYPES.META) {
      throw new DistributedProtocolError("invalid-response-order", "META may appear only once at the start.");
    }
    if (frame.frameType === DISTRIBUTED_FRAME_TYPES.DATA) {
      this.receivedBytes += frame.payload.byteLength;
      const expectedBytes = this.request.range.endExclusive - this.request.range.start;
      if (this.receivedBytes > expectedBytes) {
        throw new DistributedProtocolError("invalid-response-order", "DATA exceeds the requested byte range.");
      }
      return this.sequenceState;
    }

    this.assertMatchingIds(frame.payload.requestId, frame.payload.pieceId);
    if (!sameRange(frame.payload.range, this.request.range)) {
      throw new DistributedProtocolError("invalid-response-order", "END does not echo the requested byte range.");
    }
    const expectedBytes = this.request.range.endExclusive - this.request.range.start;
    if (frame.payload.byteLength !== expectedBytes || this.receivedBytes !== expectedBytes) {
      throw new DistributedProtocolError(
        "invalid-response-order",
        `END reports ${frame.payload.byteLength} bytes after ${this.receivedBytes}; ${expectedBytes} were required.`
      );
    }
    this.sequenceState = "completed";
    return this.sequenceState;
  }

  get state(): WorkerResponseSequenceState {
    return this.sequenceState;
  }

  get receivedByteLength(): number {
    return this.receivedBytes;
  }

  private assertMatchingIds(requestId: string, pieceId: string): void {
    if (requestId !== this.request.requestId || pieceId !== this.request.pieceId) {
      throw new DistributedProtocolError("invalid-response-order", "Worker response identifiers do not match the request.");
    }
  }
}
