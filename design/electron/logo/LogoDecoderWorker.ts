import { nativeImage, type MessageEvent } from "electron";
import {
  APP_LOGO_MAX_DECODED_BYTES,
  APP_LOGO_MAX_INPUT_BYTES,
  APP_LOGO_MAX_VARIANT_BYTES,
  APP_LOGO_MAX_VARIANTS,
  cloneAppLogoSettings,
  isAppLogoSettings,
  type AppLogoSettings,
} from "../../shared/appLogo";
import { inspectLogoImageBytes } from "./imageInspection";

const VARIANT_SIZES = [16, 20, 24, 32, 40, 48, 64, 128] as const;
const MAX_BASE64_INPUT_LENGTH = Math.ceil(APP_LOGO_MAX_INPUT_BYTES / 3) * 4;

interface WorkerRequest {
  kind: "render";
  sourceBase64: string;
  settings: AppLogoSettings;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function parseRequest(value: unknown): WorkerRequest {
  if (!isExactRecord(value, ["kind", "sourceBase64", "settings"]) || value.kind !== "render") {
    throw new Error("Invalid isolated logo decoder request.");
  }
  if (typeof value.sourceBase64 !== "string" || value.sourceBase64.length < 4 || value.sourceBase64.length > MAX_BASE64_INPUT_LENGTH
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.sourceBase64)) {
    throw new Error("Invalid isolated logo decoder source.");
  }
  const source = Buffer.from(value.sourceBase64, "base64");
  if (source.length < 1 || source.length > APP_LOGO_MAX_INPUT_BYTES || source.toString("base64") !== value.sourceBase64) {
    throw new Error("Invalid isolated logo decoder source.");
  }
  if (!isAppLogoSettings(value.settings) || value.settings.source !== "custom") {
    throw new Error("Invalid isolated logo decoder settings.");
  }
  return { kind: "render", sourceBase64: value.sourceBase64, settings: cloneAppLogoSettings(value.settings) };
}

function finiteInteger(value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error("Unsafe image geometry.");
  return value;
}

function cropSource(source: Electron.NativeImage, settings: AppLogoSettings): Electron.NativeImage {
  const dimensions = source.getSize();
  const crop = settings.crop;
  const x = finiteInteger(Math.floor(dimensions.width * crop.x));
  const y = finiteInteger(Math.floor(dimensions.height * crop.y));
  const width = finiteInteger(Math.max(1, Math.floor(dimensions.width * crop.width)));
  const height = finiteInteger(Math.max(1, Math.floor(dimensions.height * crop.height)));
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > dimensions.width || y + height > dimensions.height) {
    throw new Error("Unsafe crop geometry.");
  }
  return source.crop({ x, y, width, height });
}

function cropForCover(source: Electron.NativeImage, focalX: number, focalY: number): Electron.NativeImage {
  const dimensions = source.getSize();
  const side = Math.min(dimensions.width, dimensions.height);
  const centerX = dimensions.width * focalX;
  const centerY = dimensions.height * focalY;
  const x = Math.max(0, Math.min(dimensions.width - side, Math.round(centerX - side / 2)));
  const y = Math.max(0, Math.min(dimensions.height - side, Math.round(centerY - side / 2)));
  return source.crop({ x, y, width: side, height: side });
}

function svgRaster(
  source: Electron.NativeImage,
  size: number,
  settings: AppLogoSettings,
): Buffer {
  const dimensions = source.getSize();
  const ratio = Math.min(size / dimensions.width, size / dimensions.height);
  const width = Math.max(1, Math.round(dimensions.width * ratio));
  const height = Math.max(1, Math.round(dimensions.height * ratio));
  const x = Math.round((size - width) * settings.focalPoint.x);
  const y = Math.round((size - height) * settings.focalPoint.y);
  const background = settings.background === "color"
    ? `<rect width="${size}" height="${size}" fill="${settings.backgroundColor}"/>`
    : "";
  const imageDataUrl = source.toDataURL();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}<image href="${imageDataUrl}" x="${x}" y="${y}" width="${width}" height="${height}"/></svg>`;
  const raster = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`).toPNG();
  return raster;
}

function renderVariant(source: Electron.NativeImage, settings: AppLogoSettings, size: number): Buffer {
  const cropped = cropSource(source, settings);
  if (settings.fit === "fill") return cropped.resize({ width: size, height: size, quality: "best" }).toPNG();
  if (settings.fit === "cover") {
    return cropForCover(cropped, settings.focalPoint.x, settings.focalPoint.y)
      .resize({ width: size, height: size, quality: "best" })
      .toPNG();
  }
  return svgRaster(cropped, size, settings);
}

function render(request: WorkerRequest): Array<{ size: number; pngBase64: string }> {
  const sourceBytes = Buffer.from(request.sourceBase64, "base64");
  const inspection = inspectLogoImageBytes(sourceBytes);
  if (inspection.width * inspection.height * 4 > APP_LOGO_MAX_DECODED_BYTES) throw new Error("Decoded image exceeds the safe memory budget.");
  const source = nativeImage.createFromBuffer(sourceBytes);
  if (source.isEmpty()) throw new Error("The selected image could not be decoded.");
  const dimensions = source.getSize();
  if (dimensions.width !== inspection.width || dimensions.height !== inspection.height) {
    throw new Error("The selected image does not match its validated dimensions.");
  }
  const variants = VARIANT_SIZES.map((size) => {
    const png = renderVariant(source, request.settings, size);
    if (png.length < 1 || png.length > APP_LOGO_MAX_VARIANT_BYTES) throw new Error("A rendered logo variant exceeded the safe output limit.");
    const rendered = inspectLogoImageBytes(png);
    if (rendered.format !== "png" || rendered.width !== size || rendered.height !== size) throw new Error("A rendered logo variant failed verification.");
    return { size, pngBase64: png.toString("base64") };
  });
  if (variants.length !== APP_LOGO_MAX_VARIANTS) throw new Error("The isolated logo decoder returned an incomplete variant set.");
  return variants;
}

const utilityParentPort = process.parentPort;
if (!utilityParentPort) throw new Error("The logo decoder must run as an isolated utility process.");

utilityParentPort.on("message", (event: MessageEvent) => {
  try {
    const request = parseRequest(event.data);
    utilityParentPort.postMessage({ ok: true, variants: render(request) });
  } catch {
    // Deliberately omit decoder internals, selected paths, bytes, and image metadata.
    utilityParentPort.postMessage({ ok: false });
  }
});
