/**
 * Local-only app-logo records for the Chromium extension.
 *
 * Custom images are accepted only after byte-level inspection.  The original
 * stays in chrome.storage.local so crop edits can be rebuilt later; exports,
 * history, handoff envelopes, and diagnostics never read this record.
 */

export const LOGO_STORAGE_KEY = "extensionLogo";
export const LOGO_SCHEMA_VERSION = 1;
export const LOGO_VARIANT_SIZES = Object.freeze([16, 32, 48, 128]);
export const LOGO_LIMITS = Object.freeze({
  inputBytes: 2 * 1024 * 1024,
  outputBytes: 256 * 1024,
  maxDimension: 4096,
  maxPixels: 8 * 1024 * 1024,
  maxDataUrlCharacters: 2_800_000,
});

export const LOGO_PRESETS = Object.freeze([
  Object.freeze({ id: "material-stack", label: "Material stack" }),
  Object.freeze({ id: "download-orbit", label: "Download orbit" }),
  Object.freeze({ id: "handoff-ribbon", label: "Handoff ribbon" }),
]);

const DEFAULT_PRESET_ID = "material-stack";
const CUSTOM_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const FIT_MODES = new Set(["contain", "cover", "fill"]);
export const LOGO_RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "presetId",
  "sourceDataUrl",
  "sourceType",
  "sourceWidth",
  "sourceHeight",
  "fit",
  "cropZoom",
  "focalX",
  "focalY",
  "background",
  "variants",
]);
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readU32LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + ((bytes[offset + 3] << 24) >>> 0);
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function validDimensions(width, height) {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= LOGO_LIMITS.maxDimension
    && height <= LOGO_LIMITS.maxDimension
    && width * height <= LOGO_LIMITS.maxPixels;
}

function inspectPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) throw failure("logo-invalid-png");
  if (readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") throw failure("logo-invalid-png");
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (!validDimensions(width, height)) throw failure("logo-image-bounds");

  let offset = 8;
  let foundEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next > bytes.length) throw failure("logo-invalid-png");
    if (type === "acTL") throw failure("logo-animated-image");
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) throw failure("logo-invalid-png");
      foundEnd = true;
      break;
    }
    offset = next;
  }
  if (!foundEnd) throw failure("logo-invalid-png");
  return { type: "image/png", width, height };
}

function inspectJpeg(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw failure("logo-invalid-jpeg");
  let offset = 2;
  let dimensions = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw failure("logo-invalid-jpeg");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      if (!dimensions || offset !== bytes.length) throw failure("logo-invalid-jpeg");
      return dimensions;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) throw failure("logo-invalid-jpeg");
    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw failure("logo-invalid-jpeg");
    if (marker === 0xda) {
      if (!dimensions || bytes.length < offset + length + 2 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw failure("logo-invalid-jpeg");
      return dimensions;
    }
    const isFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) {
      if (length < 8) throw failure("logo-invalid-jpeg");
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      if (!validDimensions(width, height)) throw failure("logo-image-bounds");
      dimensions = { type: "image/jpeg", width, height };
    }
    offset += length;
  }
  throw failure("logo-invalid-jpeg");
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") throw failure("logo-invalid-webp");
  if (readU32LE(bytes, 4) + 8 !== bytes.length) throw failure("logo-invalid-webp");
  let offset = 12;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readU32LE(bytes, offset + 4);
    const payload = offset + 8;
    const next = payload + length + (length % 2);
    if (!Number.isSafeInteger(next) || next > bytes.length) throw failure("logo-invalid-webp");
    if (type === "ANIM" || type === "ANMF") throw failure("logo-animated-image");
    if (type === "VP8X") {
      if (length < 10 || (bytes[payload] & 0x02) !== 0) throw failure("logo-animated-image");
      width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
      height = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16);
    } else if (type === "VP8 ") {
      if (length < 10 || bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) throw failure("logo-invalid-webp");
      width = (bytes[payload + 6] | (bytes[payload + 7] << 8)) & 0x3fff;
      height = (bytes[payload + 8] | (bytes[payload + 9] << 8)) & 0x3fff;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[payload] !== 0x2f) throw failure("logo-invalid-webp");
      const bits = readU32LE(bytes, payload + 1);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
    offset = next;
  }
  if (!validDimensions(width, height)) throw failure("logo-image-bounds");
  return { type: "image/webp", width, height };
}

export function inspectLogoBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > LOGO_LIMITS.inputBytes) throw failure("logo-file-size");
  if (bytes[0] === 137) return inspectPng(bytes);
  if (bytes[0] === 0xff) return inspectJpeg(bytes);
  if (ascii(bytes, 0, 4) === "RIFF") return inspectWebp(bytes);
  throw failure("logo-unsupported-type");
}

function base64ToBytes(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) throw failure("logo-invalid-data-url");
  let raw;
  try {
    raw = atob(value);
  } catch {
    throw failure("logo-invalid-data-url");
  }
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

export function dataUrlFromBytes(type, bytes) {
  if (!CUSTOM_TYPES.has(type) || !(bytes instanceof Uint8Array)) throw failure("logo-unsupported-type");
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

export function validateLogoDataUrl(value, maxBytes = LOGO_LIMITS.inputBytes) {
  if (typeof value !== "string" || value.length === 0 || value.length > LOGO_LIMITS.maxDataUrlCharacters) throw failure("logo-invalid-data-url");
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) throw failure("logo-invalid-data-url");
  const bytes = base64ToBytes(match[2]);
  if (bytes.length > maxBytes) throw failure(maxBytes === LOGO_LIMITS.outputBytes ? "logo-output-size" : "logo-file-size");
  const inspection = inspectLogoBytes(bytes);
  if (inspection.type !== match[1]) throw failure("logo-type-mismatch");
  return { ...inspection, bytes };
}

function normalizeControls(value = {}) {
  if (!isRecord(value)) return null;
  const fit = value.fit === undefined ? "contain" : value.fit;
  const cropZoom = value.cropZoom === undefined ? 1 : Number(value.cropZoom);
  const focalX = value.focalX === undefined ? 0.5 : Number(value.focalX);
  const focalY = value.focalY === undefined ? 0.5 : Number(value.focalY);
  const background = value.background === undefined ? "transparent" : String(value.background).trim().toLowerCase();
  if (!FIT_MODES.has(fit) || !Number.isFinite(cropZoom) || cropZoom < 1 || cropZoom > 4 || !Number.isFinite(focalX) || !Number.isFinite(focalY) || focalX < 0 || focalX > 1 || focalY < 0 || focalY > 1) return null;
  if (background !== "transparent" && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u.test(background)) return null;
  return { fit, cropZoom, focalX, focalY, background };
}

function fixedPreset(id) {
  return LOGO_PRESETS.some((preset) => preset.id === id);
}

function fixedRecord(record) {
  return {
    schemaVersion: LOGO_SCHEMA_VERSION,
    kind: record.kind,
    presetId: record.presetId,
    sourceDataUrl: record.sourceDataUrl,
    sourceType: record.sourceType,
    sourceWidth: record.sourceWidth,
    sourceHeight: record.sourceHeight,
    fit: record.fit,
    cropZoom: record.cropZoom,
    focalX: record.focalX,
    focalY: record.focalY,
    background: record.background,
    variants: record.variants,
  };
}

export function normalizeLogoRecord(value) {
  if (!isRecord(value) || Object.keys(value).length !== LOGO_RECORD_KEYS.length || !hasOnlyKeys(value, LOGO_RECORD_KEYS) || value.schemaVersion !== LOGO_SCHEMA_VERSION) return null;
  const controls = normalizeControls(value);
  if (!controls || !isRecord(value.variants)) return null;
  const keys = Object.keys(value.variants).sort();
  const expected = LOGO_VARIANT_SIZES.map(String).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  const variants = {};
  for (const size of LOGO_VARIANT_SIZES) {
    try {
      const output = validateLogoDataUrl(value.variants[String(size)], LOGO_LIMITS.outputBytes);
      if (output.type !== "image/png" || output.width !== size || output.height !== size) return null;
      variants[String(size)] = value.variants[String(size)];
    } catch {
      return null;
    }
  }

  if (value.kind === "preset") {
    if (!fixedPreset(value.presetId) || value.sourceDataUrl !== null || value.sourceType !== null || value.sourceWidth !== null || value.sourceHeight !== null) return null;
    return fixedRecord({ kind: "preset", presetId: value.presetId, sourceDataUrl: null, sourceType: null, sourceWidth: null, sourceHeight: null, variants, ...controls });
  }
  if (value.kind !== "custom" || !CUSTOM_TYPES.has(value.sourceType)) return null;
  try {
    const source = validateLogoDataUrl(value.sourceDataUrl);
    if (source.type !== value.sourceType || source.width !== value.sourceWidth || source.height !== value.sourceHeight) return null;
    return fixedRecord({ kind: "custom", presetId: null, sourceDataUrl: value.sourceDataUrl, sourceType: source.type, sourceWidth: source.width, sourceHeight: source.height, variants, ...controls });
  } catch {
    return null;
  }
}

function presetSvg(id) {
  const art = {
    "material-stack": '<svg viewBox="0 0 100 100"><rect x="10" y="12" width="80" height="76" rx="24" fill="#6750a4"/><path d="M27 39 50 25l23 14-23 14-23-14Zm0 17 23 14 23-14m-46 13 23 14 23-14" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="7"/></svg>',
    "download-orbit": '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#006a6a"/><path d="M50 23v38m0 0L35 47m15 14 15-14M31 72h38" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="8"/></svg>',
    "handoff-ribbon": '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="20" fill="#8b5000"/><path d="M28 50h35m0 0-13-13m13 13-13 13M72 50H37m0 0 13-13M37 50l13 13" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="7"/></svg>',
  };
  return art[id] ?? art[DEFAULT_PRESET_ID];
}

export function presetSourceDataUrl(id = DEFAULT_PRESET_ID) {
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(presetSvg(fixedPreset(id) ? id : DEFAULT_PRESET_ID)))}`;
}

export function defaultLogoDescriptor() {
  return {
    kind: "preset",
    presetId: DEFAULT_PRESET_ID,
    sourceDataUrl: null,
    sourceType: null,
    sourceWidth: null,
    sourceHeight: null,
    fit: "contain",
    cropZoom: 1,
    focalX: 0.5,
    focalY: 0.5,
    background: "transparent",
  };
}

export function logoDisplayDescriptor(value, target = 128) {
  const logo = normalizeLogoRecord(value) ?? defaultLogoDescriptor();
  const selected = LOGO_VARIANT_SIZES.includes(target) ? String(target) : "128";
  return {
    kind: logo.kind,
    presetId: logo.presetId,
    fit: logo.fit,
    cropZoom: logo.cropZoom,
    focalX: logo.focalX,
    focalY: logo.focalY,
    background: logo.background,
    previewDataUrl: logo.variants?.[selected] ?? presetSourceDataUrl(logo.presetId),
  };
}

function blobFromDataUrl(dataUrl) {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (match) return new Blob([base64ToBytes(match[2])], { type: match[1] });
  if (dataUrl.startsWith("data:image/svg+xml;base64,")) {
    return new Blob([base64ToBytes(dataUrl.slice("data:image/svg+xml;base64,".length))], { type: "image/svg+xml" });
  }
  throw failure("logo-invalid-data-url");
}

async function decodeBitmap(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  if (typeof document === "undefined") throw failure("logo-converter-unavailable");
  const sourceUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = sourceUrl;
    });
    if (!validDimensions(image.naturalWidth, image.naturalHeight)) throw failure("logo-image-bounds");
    return image;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size);
  if (typeof document === "undefined") throw failure("logo-converter-unavailable");
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

async function canvasDataUrl(canvas, size) {
  const blob = typeof canvas.convertToBlob === "function"
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(failure("logo-conversion-failed")), "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > LOGO_LIMITS.outputBytes) throw failure("logo-output-size");
  const output = inspectLogoBytes(bytes);
  if (output.type !== "image/png" || output.width !== size || output.height !== size) throw failure("logo-output-invalid");
  const roundTrip = await decodeBitmap(new Blob([bytes], { type: "image/png" }));
  try {
    const width = Number(roundTrip.width ?? roundTrip.naturalWidth);
    const height = Number(roundTrip.height ?? roundTrip.naturalHeight);
    if (width !== size || height !== size) throw failure("logo-output-invalid");
  } finally {
    roundTrip.close?.();
  }
  return dataUrlFromBytes("image/png", bytes);
}

function prepareContext(canvas, background) {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw failure("logo-converter-unavailable");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (background !== "transparent") {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function drawBitmap(context, bitmap, size, controls) {
  const sourceWidth = Number(bitmap.width ?? bitmap.naturalWidth);
  const sourceHeight = Number(bitmap.height ?? bitmap.naturalHeight);
  if (!validDimensions(sourceWidth, sourceHeight)) throw failure("logo-image-bounds");
  const contain = Math.min(size / sourceWidth, size / sourceHeight);
  const cover = Math.max(size / sourceWidth, size / sourceHeight);
  const scale = controls.fit === "contain" ? contain * controls.cropZoom : controls.fit === "cover" ? cover * controls.cropZoom : null;
  if (scale === null) {
    context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, 0, 0, size, size);
    return;
  }
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const canFocalCrop = controls.fit === "cover" || controls.cropZoom > 1;
  const x = canFocalCrop ? (size - width) * controls.focalX : (size - width) / 2;
  const y = canFocalCrop ? (size - height) * controls.focalY : (size - height) / 2;
  context.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight, x, y, width, height);
}

function drawPreset(context, id, size) {
  const scale = size / 100;
  context.save();
  context.scale(scale, scale);
  context.lineCap = "round";
  context.lineJoin = "round";
  if (id === "download-orbit") {
    context.fillStyle = "#006a6a";
    context.beginPath();
    context.arc(50, 50, 40, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(50, 23); context.lineTo(50, 61); context.moveTo(50, 61); context.lineTo(35, 47); context.moveTo(50, 61); context.lineTo(65, 47); context.moveTo(31, 72); context.lineTo(69, 72);
    context.stroke();
  } else if (id === "handoff-ribbon") {
    context.fillStyle = "#8b5000";
    roundedRect(context, 10, 10, 80, 80, 20);
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(28, 50); context.lineTo(63, 50); context.moveTo(63, 50); context.lineTo(50, 37); context.moveTo(63, 50); context.lineTo(50, 63); context.moveTo(72, 50); context.lineTo(37, 50); context.moveTo(37, 50); context.lineTo(50, 37); context.moveTo(37, 50); context.lineTo(50, 63);
    context.stroke();
  } else {
    context.fillStyle = "#6750a4";
    roundedRect(context, 10, 12, 80, 76, 24);
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(27, 39); context.lineTo(50, 25); context.lineTo(73, 39); context.lineTo(50, 53); context.closePath(); context.moveTo(27, 56); context.lineTo(50, 70); context.lineTo(73, 56); context.moveTo(27, 69); context.lineTo(50, 83); context.lineTo(73, 69);
    context.stroke();
  }
  context.restore();
}

function roundedRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

async function renderCustomVariants(sourceDataUrl, controls) {
  const source = validateLogoDataUrl(sourceDataUrl);
  const bitmap = await decodeBitmap(new Blob([source.bytes], { type: source.type }));
  try {
    const variants = {};
    for (const size of LOGO_VARIANT_SIZES) {
      const canvas = makeCanvas(size);
      const context = prepareContext(canvas, controls.background);
      drawBitmap(context, bitmap, size, controls);
      variants[String(size)] = await canvasDataUrl(canvas, size);
    }
    return { source, variants };
  } finally {
    bitmap.close?.();
  }
}

async function renderPresetVariants(id, controls) {
  const variants = {};
  for (const size of LOGO_VARIANT_SIZES) {
    const canvas = makeCanvas(size);
    const context = prepareContext(canvas, controls.background);
    drawPreset(context, id, size);
    variants[String(size)] = await canvasDataUrl(canvas, size);
  }
  return variants;
}

export async function createCustomLogoRecord(fileOrDataUrl, rawControls = {}) {
  const controls = normalizeControls(rawControls);
  if (!controls) throw failure("logo-invalid-controls");
  let sourceDataUrl;
  if (typeof fileOrDataUrl === "string") {
    sourceDataUrl = fileOrDataUrl;
  } else {
    if (!(fileOrDataUrl instanceof Blob) || fileOrDataUrl.size <= 0 || fileOrDataUrl.size > LOGO_LIMITS.inputBytes) throw failure("logo-file-size");
    const bytes = new Uint8Array(await fileOrDataUrl.arrayBuffer());
    const inspected = inspectLogoBytes(bytes);
    sourceDataUrl = dataUrlFromBytes(inspected.type, bytes);
  }
  const { source, variants } = await renderCustomVariants(sourceDataUrl, controls);
  return fixedRecord({ kind: "custom", presetId: null, sourceDataUrl, sourceType: source.type, sourceWidth: source.width, sourceHeight: source.height, variants, ...controls });
}

export async function createPresetLogoRecord(presetId, rawControls = {}) {
  const controls = normalizeControls(rawControls);
  if (!controls || !fixedPreset(presetId)) throw failure("logo-invalid-preset");
  const variants = await renderPresetVariants(presetId, controls);
  return fixedRecord({ kind: "preset", presetId, sourceDataUrl: null, sourceType: null, sourceWidth: null, sourceHeight: null, variants, ...controls });
}

/**
 * Rebuild a record from its trusted source and rendering controls.  Incoming
 * derived PNGs are validated for cache shape but are never trusted as the
 * pixels that reach the action icon; this makes a mismatched variant unable
 * to impersonate a preset or custom source.
 */
export async function rehydrateLogoRecord(value) {
  const stored = normalizeLogoRecord(value);
  if (!stored) throw failure("logo-cache-corrupt");
  const controls = {
    fit: stored.fit,
    cropZoom: stored.cropZoom,
    focalX: stored.focalX,
    focalY: stored.focalY,
    background: stored.background,
  };
  if (stored.kind === "preset") return createPresetLogoRecord(stored.presetId, controls);
  return createCustomLogoRecord(stored.sourceDataUrl, controls);
}

export function validateLogoRecordShape(value) {
  return normalizeLogoRecord(value) !== null;
}

export async function createActionIconImageData(value) {
  const logo = normalizeLogoRecord(value);
  const descriptor = logo ?? defaultLogoDescriptor();
  const imageData = {};
  for (const size of [16, 32]) {
    const canvas = makeCanvas(size);
    const context = prepareContext(canvas, descriptor.background);
    if (logo?.kind === "custom") {
      const candidate = logo.variants[String(size)];
      const bitmap = await decodeBitmap(blobFromDataUrl(candidate));
      try {
        context.drawImage(bitmap, 0, 0, size, size);
      } finally {
        bitmap.close?.();
      }
    } else {
      drawPreset(context, descriptor.presetId, size);
    }
    imageData[size] = context.getImageData(0, 0, size, size);
  }
  return imageData;
}

export function assertLogoFeatureContract(source) {
  const exactAnchors = [
    "export function validateLogoDataUrl(",
    "export function normalizeLogoRecord(",
    "export async function createCustomLogoRecord(",
    "export async function createPresetLogoRecord(",
    "export async function createActionIconImageData(",
    "export async function rehydrateLogoRecord(",
  ];
  for (const anchor of exactAnchors) {
    if (!String(source).includes(anchor)) throw failure(`logo-contract-missing:${anchor}`);
  }
  return true;
}
