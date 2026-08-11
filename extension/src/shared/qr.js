/*
 * Small dependency-free QR encoder for the extension registration card.
 *
 * It emits byte-mode QR version 5, error-correction level L (37×37 modules)
 * for payloads up to 105 UTF-8 bytes. Larger issuer/account labels fail closed
 * and the UI keeps the manual registration path available. The implementation
 * is local-only and returns a matrix; no image service or network request is
 * involved.
 */

const VERSION = 5;
const SIZE = 4 * VERSION + 17;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS_PER_BLOCK = 26;
const BLOCK_COUNT = 1;
const MAX_PAYLOAD_BYTES = 105;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let fieldValue = 1;
for (let index = 0; index < 255; index += 1) {
  EXP[index] = fieldValue;
  LOG[fieldValue] = index;
  fieldValue <<= 1;
  if (fieldValue & 0x100) fieldValue ^= 0x11d;
}
for (let index = 255; index < EXP.length; index += 1) EXP[index] = EXP[index - 255];

function gfMultiply(left, right) {
  return left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]];
}

function generatorPolynomial(length) {
  let result = [1];
  for (let index = 0; index < length; index += 1) {
    const next = new Array(result.length + 1).fill(0);
    result.forEach((coefficient, position) => {
      next[position] ^= coefficient;
      next[position + 1] ^= gfMultiply(coefficient, EXP[index]);
    });
    result = next;
  }
  return result;
}

function errorCorrection(data) {
  const generator = generatorPolynomial(ECC_CODEWORDS_PER_BLOCK);
  const remainder = new Uint8Array(data.length + ECC_CODEWORDS_PER_BLOCK);
  remainder.set(data);
  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index];
    if (!factor) continue;
    generator.forEach((coefficient, offset) => {
      remainder[index + offset] ^= gfMultiply(coefficient, factor);
    });
  }
  return remainder.slice(data.length);
}

function appendBits(target, value, length) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >>> bit) & 1);
}

function dataCodewords(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new Error("The QR payload is too long; use the manual secret path.");
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const result = new Uint8Array(DATA_CODEWORDS);
  for (let index = 0; index < bits.length / 8; index += 1) {
    result[index] = bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0);
  }
  let offset = bits.length / 8;
  let pad = 0xec;
  while (offset < result.length) {
    result[offset] = pad;
    pad ^= 0xec ^ 0x11;
    offset += 1;
  }
  return result;
}

function matrixBlank() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function functionBlank() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
}

function setModule(matrix, functions, x, y, value) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  matrix[y][x] = value ? 1 : 0;
  functions[y][x] = true;
}

function drawFinder(matrix, functions, x, y) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setModule(matrix, functions, x + dx, y + dy, dark);
    }
  }
}

function drawAlignment(matrix, functions, centerX, centerY) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setModule(matrix, functions, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function setupFunctionPatterns(matrix, functions) {
  drawFinder(matrix, functions, 0, 0);
  drawFinder(matrix, functions, SIZE - 7, 0);
  drawFinder(matrix, functions, 0, SIZE - 7);
  const alignmentCenters = [6, 30];
  for (const centerY of alignmentCenters) {
    for (const centerX of alignmentCenters) {
      const overlapsFinder = (centerX < 9 && centerY < 9)
        || (centerX >= SIZE - 8 && centerY < 9)
        || (centerX < 9 && centerY >= SIZE - 8);
      if (!overlapsFinder) drawAlignment(matrix, functions, centerX, centerY);
    }
  }
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (!functions[6][index]) setModule(matrix, functions, index, 6, index % 2 === 0);
    if (!functions[index][6]) setModule(matrix, functions, 6, index, index % 2 === 0);
  }
  // Reserve both format-information strips and the fixed dark module.
  for (let index = 0; index < 9; index += 1) {
    if (!functions[index][8]) setModule(matrix, functions, 8, index, false);
    if (!functions[8][index]) setModule(matrix, functions, index, 8, false);
  }
  for (let index = 0; index < 8; index += 1) {
    setModule(matrix, functions, SIZE - 1 - index, 8, false);
    setModule(matrix, functions, 8, SIZE - 1 - index, false);
  }
  setModule(matrix, functions, 8, SIZE - 8, true);
}

function maskBit(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return (x * y) % 2 + (x * y) % 3 === 0;
  if (mask === 6) return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
  return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
}

function placeData(matrix, functions, codewords, mask) {
  const bits = [];
  codewords.forEach((byte) => appendBits(bits, byte, 8));
  let bitIndex = 0;
  let upward = true;
  for (let column = SIZE - 1; column >= 1; column -= 2) {
    if (column === 6) column -= 1;
    for (let rowOffset = 0; rowOffset < SIZE; rowOffset += 1) {
      const row = upward ? SIZE - 1 - rowOffset : rowOffset;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = column - offset;
        if (functions[row][x]) continue;
        let bit = bits[bitIndex] ?? 0;
        bitIndex += 1;
        if (maskBit(mask, x, row)) bit ^= 1;
        matrix[row][x] = bit;
      }
    }
    upward = !upward;
  }
}

function bchRemainder(value, polynomial) {
  let data = value;
  const degree = 31 - Math.clz32(polynomial);
  while (data !== 0 && 31 - Math.clz32(data) >= degree) {
    data ^= polynomial << ((31 - Math.clz32(data)) - degree);
  }
  return data;
}

function drawFormat(matrix, functions, mask) {
  const formatData = (1 << 3) | mask; // error correction level L
  const bits = ((formatData << 10) | bchRemainder(formatData << 10, 0x537)) ^ 0x5412;
  const set = (x, y, bit) => setModule(matrix, functions, x, y, bit);
  for (let index = 0; index <= 5; index += 1) set(8, index, ((bits >>> index) & 1) !== 0);
  set(8, 7, ((bits >>> 6) & 1) !== 0);
  set(8, 8, ((bits >>> 7) & 1) !== 0);
  set(7, 8, ((bits >>> 8) & 1) !== 0);
  for (let index = 9; index < 15; index += 1) set(14 - index, 8, ((bits >>> index) & 1) !== 0);
  for (let index = 0; index < 8; index += 1) set(SIZE - 1 - index, 8, ((bits >>> index) & 1) !== 0);
  for (let index = 8; index < 15; index += 1) set(8, SIZE - 15 + index, ((bits >>> index) & 1) !== 0);
  set(8, SIZE - 8, true);
}

function penalty(matrix) {
  let score = 0;
  const linePenalty = (line) => {
    let runColor = line[0];
    let runLength = 1;
    for (let index = 1; index < line.length; index += 1) {
      if (line[index] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += 3 + runLength - 5;
        runColor = line[index];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + runLength - 5;
  };
  for (let row = 0; row < SIZE; row += 1) linePenalty(matrix[row]);
  for (let column = 0; column < SIZE; column += 1) linePenalty(matrix.map((row) => row[column]));
  for (let y = 0; y < SIZE - 1; y += 1) {
    for (let x = 0; x < SIZE - 1; x += 1) {
      const value = matrix[y][x];
      if (matrix[y][x + 1] === value && matrix[y + 1][x] === value && matrix[y + 1][x + 1] === value) score += 3;
    }
  }
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column <= SIZE - 11; column += 1) {
      const segment = matrix[row].slice(column, column + 11).join("");
      if (segment === "10111010000" || segment === "00001011101") score += 40;
    }
  }
  for (let column = 0; column < SIZE; column += 1) {
    for (let row = 0; row <= SIZE - 11; row += 1) {
      const segment = matrix.slice(row, row + 11).map((line) => line[column]).join("");
      if (segment === "10111010000" || segment === "00001011101") score += 40;
    }
  }
  let dark = 0;
  matrix.forEach((row) => row.forEach((value) => { dark += value; }));
  score += Math.floor(Math.abs(dark * 20 - SIZE * SIZE * 10) / (SIZE * SIZE)) * 10;
  return score;
}

export function createQrMatrix(value) {
  const data = dataCodewords(String(value));
  const blockDataLength = DATA_CODEWORDS / BLOCK_COUNT;
  const dataBlocks = Array.from({ length: BLOCK_COUNT }, (_item, index) => data.slice(index * blockDataLength, (index + 1) * blockDataLength));
  const eccBlocks = dataBlocks.map((block) => errorCorrection(block));
  const codewords = [];
  for (let index = 0; index < blockDataLength; index += 1) dataBlocks.forEach((block) => codewords.push(block[index]));
  for (let index = 0; index < ECC_CODEWORDS_PER_BLOCK; index += 1) eccBlocks.forEach((block) => codewords.push(block[index]));
  const finalCodewords = Uint8Array.from(codewords);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = matrixBlank();
    const functions = functionBlank();
    setupFunctionPatterns(matrix, functions);
    placeData(matrix, functions, finalCodewords, mask);
    drawFormat(matrix, functions, mask);
    const score = penalty(matrix);
    if (!best || score < best.score) best = { matrix, score };
  }
  return best.matrix.map((row) => Object.freeze([...row]));
}

export function qrPayloadCapacity() {
  return MAX_PAYLOAD_BYTES;
}

export function qrMatrixToSvg(matrix, label) {
  const size = matrix.length;
  const quiet = 4;
  const total = size + quiet * 2;
  const paths = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) paths.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${String(label).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;")}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${paths.join("")}" fill="#000"/></svg>`;
}
