import {
  APP_LOGO_MAX_DIMENSION,
  APP_LOGO_MAX_INPUT_BYTES,
  APP_LOGO_MAX_PIXELS,
} from "../../shared/appLogo";

export interface LogoImageInspection {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
}

function bufferIsAt(input: Buffer, offset: number, bytes: readonly number[]): boolean {
  return offset >= 0 && offset + bytes.length <= input.length && bytes.every((value, index) => input[offset + index] === value);
}

function assertDeclaredBounds(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("The selected image has invalid dimensions.");
  }
  if (width > APP_LOGO_MAX_DIMENSION || height > APP_LOGO_MAX_DIMENSION || width * height > APP_LOGO_MAX_PIXELS) {
    throw new Error("The selected image exceeds the safe pixel limit.");
  }
}

function inspectPng(input: Buffer): LogoImageInspection {
  if (!bufferIsAt(input, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw new Error("The selected file is not a PNG image.");
  }
  if (input.length < 33 || input.readUInt32BE(8) !== 13 || input.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("The PNG header is incomplete.");
  }
  const width = input.readUInt32BE(16);
  const height = input.readUInt32BE(20);
  assertDeclaredBounds(width, height);
  let cursor = 8;
  let foundEnd = false;
  while (cursor + 12 <= input.length) {
    const length = input.readUInt32BE(cursor);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > input.length) throw new Error("The PNG chunk layout is invalid.");
    const type = input.subarray(cursor + 4, cursor + 8).toString("ascii");
    if (type === "acTL" || type === "fcTL") throw new Error("Animated images are not supported for app logos.");
    cursor = dataEnd + 4;
    if (type === "IEND") {
      foundEnd = cursor === input.length;
      break;
    }
  }
  if (!foundEnd) throw new Error("The PNG image is incomplete.");
  return { format: "png", width, height };
}

function jpegSegmentLength(input: Buffer, offset: number): number {
  if (offset + 2 > input.length) throw new Error("The JPEG segment is incomplete.");
  const length = input.readUInt16BE(offset);
  if (length < 2 || offset + length > input.length) throw new Error("The JPEG segment is invalid.");
  return length;
}

function inspectJpeg(input: Buffer): LogoImageInspection {
  if (!bufferIsAt(input, 0, [0xff, 0xd8])) throw new Error("The selected file is not a JPEG image.");
  let cursor = 2;
  while (cursor < input.length) {
    while (cursor < input.length && input[cursor] !== 0xff) cursor += 1;
    while (cursor < input.length && input[cursor] === 0xff) cursor += 1;
    if (cursor >= input.length) break;
    const marker = input[cursor++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = jpegSegmentLength(input, cursor);
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (length < 8) throw new Error("The JPEG frame is invalid.");
      const height = input.readUInt16BE(cursor + 3);
      const width = input.readUInt16BE(cursor + 5);
      assertDeclaredBounds(width, height);
      return { format: "jpeg", width, height };
    }
    cursor += length;
  }
  throw new Error("The JPEG image has no supported frame.");
}

function readUInt24LE(input: Buffer, offset: number): number {
  if (offset + 3 > input.length) throw new Error("The WebP image is incomplete.");
  return input[offset] | (input[offset + 1] << 8) | (input[offset + 2] << 16);
}

function inspectWebp(input: Buffer): LogoImageInspection {
  if (!bufferIsAt(input, 0, [0x52, 0x49, 0x46, 0x46]) || !bufferIsAt(input, 8, [0x57, 0x45, 0x42, 0x50])) {
    throw new Error("The selected file is not a WebP image.");
  }
  if (input.length < 20 || input.readUInt32LE(4) + 8 !== input.length) throw new Error("The WebP container is invalid.");
  let cursor = 12;
  let inspection: LogoImageInspection | null = null;
  while (cursor + 8 <= input.length) {
    const type = input.subarray(cursor, cursor + 4).toString("ascii");
    const length = input.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;
    const paddedLength = length + (length % 2);
    const next = dataStart + paddedLength;
    if (next > input.length) throw new Error("The WebP chunk layout is invalid.");
    if (type === "ANIM" || type === "ANMF") throw new Error("Animated images are not supported for app logos.");
    if (type === "VP8X") {
      if (length < 10) throw new Error("The WebP extended header is invalid.");
      if ((input[dataStart] & 0x02) !== 0) throw new Error("Animated images are not supported for app logos.");
      const width = readUInt24LE(input, dataStart + 4) + 1;
      const height = readUInt24LE(input, dataStart + 7) + 1;
      assertDeclaredBounds(width, height);
      inspection = { format: "webp", width, height };
    } else if (type === "VP8 ") {
      if (length < 10 || !bufferIsAt(input, dataStart + 3, [0x9d, 0x01, 0x2a])) throw new Error("The WebP VP8 frame is invalid.");
      const width = input.readUInt16LE(dataStart + 6) & 0x3fff;
      const height = input.readUInt16LE(dataStart + 8) & 0x3fff;
      assertDeclaredBounds(width, height);
      inspection ??= { format: "webp", width, height };
    } else if (type === "VP8L") {
      if (length < 5 || input[dataStart] !== 0x2f) throw new Error("The WebP VP8L frame is invalid.");
      const packed = input.readUInt32LE(dataStart + 1);
      const width = (packed & 0x3fff) + 1;
      const height = ((packed >>> 14) & 0x3fff) + 1;
      assertDeclaredBounds(width, height);
      inspection ??= { format: "webp", width, height };
    }
    cursor = next;
  }
  if (!inspection) throw new Error("The WebP image has no supported frame.");
  return inspection;
}

/** Exact bounded still-image parser shared by main and decoder worker. */
export function inspectLogoImageBytes(input: Buffer): LogoImageInspection {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new Error("Choose an image file first.");
  if (input.length > APP_LOGO_MAX_INPUT_BYTES) throw new Error("The selected image exceeds the 8 MiB input limit.");
  if (bufferIsAt(input, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return inspectPng(input);
  if (bufferIsAt(input, 0, [0xff, 0xd8])) return inspectJpeg(input);
  if (bufferIsAt(input, 0, [0x52, 0x49, 0x46, 0x46]) && bufferIsAt(input, 8, [0x57, 0x45, 0x42, 0x50])) return inspectWebp(input);
  throw new Error("Only PNG, JPEG, and still WebP images are supported.");
}

