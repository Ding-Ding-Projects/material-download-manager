/**
 * Generate the manifest's four static PNG fallbacks from the shipped mark.
 *
 * The browser uses these files before the service worker can restore a
 * locally-selected logo.  Keep this generator dependency-free: the extension
 * cannot rely on a developer's image converter or a network service.
 *
 * Run: node scripts/generate-static-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = new URL("../assets/icons/", import.meta.url);
const sizes = [16, 32, 48, 128];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([length, typeBytes, payload, checksum]);
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

function fillRoundedRect(pixels, size, left, top, right, bottom, radius, color) {
  for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
    for (let x = Math.floor(left); x < Math.ceil(right); x += 1) {
      const nearestX = Math.max(left + radius, Math.min(x + 0.5, right - radius));
      const nearestY = Math.max(top + radius, Math.min(y + 0.5, bottom - radius));
      if ((x + 0.5 - nearestX) ** 2 + (y + 0.5 - nearestY) ** 2 <= radius ** 2) setPixel(pixels, size, x, y, color);
    }
  }
}

function fillPolygon(pixels, size, points, color) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 > y) === (y2 > y) || y1 === y2) continue;
      intersections.push(x1 + ((y + 0.5 - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      for (let x = Math.ceil(intersections[index]); x < Math.floor(intersections[index + 1]); x += 1) setPixel(pixels, size, x, y, color);
    }
  }
}

function makeIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / 128;
  fillRoundedRect(pixels, size, 8 * scale, 8 * scale, 120 * scale, 120 * scale, 28 * scale, [66, 79, 157, 255]);
  fillPolygon(pixels, size, [[57, 27], [71, 27], [71, 67], [84, 54], [94, 64], [64, 94], [34, 64], [44, 54], [57, 67]].map(([x, y]) => [x * scale, y * scale]), [255, 255, 255, 255]);
  fillRoundedRect(pixels, size, 34 * scale, 91 * scale, 94 * scale, 101 * scale, 5 * scale, [255, 183, 77, 255]);
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    scanlines[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(scanlines, y * (size * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

await mkdir(outputDirectory, { recursive: true });
for (const size of sizes) await writeFile(new URL(`icon${size}.png`, outputDirectory), makeIcon(size));
console.log(`Generated static extension icons (${sizes.join(", ")}) from ${scriptDirectory}`);
