import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_LOGO_MAX_PREVIEW_DATA_URL_LENGTH,
  DEFAULT_APP_LOGO_SETTINGS,
  isAppLogoSettings,
  isAppLogoSnapshot,
} from "../../shared/appLogo";
import { validateScheduledSettings } from "../download/scheduleSources";
import { inspectLogoImageBytes } from "../logo/LogoCustomizationStore";

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function png(width = 1, height = 1, animated = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...(animated ? [pngChunk("acTL", Buffer.alloc(8))] : []),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function webpWithAnimatedTail(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[4] = 0; // width - 1 (one pixel)
  vp8x[7] = 0; // height - 1 (one pixel)
  const chunk = (type: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, ...(body.length % 2 ? [Buffer.alloc(1)] : [])]);
  };
  const body = Buffer.concat([Buffer.from("WEBP"), chunk("VP8X", vp8x), chunk("ANIM", Buffer.alloc(6))]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test("logo byte inspection reads signatures and rejects spoofed, animated, and oversized declarations", () => {
  assert.deepEqual(inspectLogoImageBytes(png(2, 3)), { format: "png", width: 2, height: 3 });
  assert.throws(() => inspectLogoImageBytes(png(2, 3, true)), /Animated images/u);
  assert.throws(() => inspectLogoImageBytes(png(9_000, 1)), /pixel limit/u);
  assert.throws(() => inspectLogoImageBytes(Buffer.from("not really a png", "utf8")), /Only PNG/u);
  assert.throws(() => inspectLogoImageBytes(webpWithAnimatedTail()), /Animated images/u);
});
test("app-logo settings and renderer snapshots are exact, bounded, and path-free", () => {
  assert.equal(isAppLogoSettings(DEFAULT_APP_LOGO_SETTINGS), true);
  assert.equal(isAppLogoSettings({ ...DEFAULT_APP_LOGO_SETTINGS, crop: { ...DEFAULT_APP_LOGO_SETTINGS.crop, x: 0.9, width: 0.5 } }), false);
  assert.equal(isAppLogoSettings({ ...DEFAULT_APP_LOGO_SETTINGS, unexpected: true }), false);
  const safeSnapshot = {
    settings: DEFAULT_APP_LOGO_SETTINGS,
    activeSource: "preset",
    previewDataUrl: null,
    status: "ready",
  } as const;
  assert.equal(isAppLogoSnapshot(safeSnapshot), true);
  assert.equal(isAppLogoSnapshot({ ...safeSnapshot, previewDataUrl: `data:image/png;base64,${"A".repeat(APP_LOGO_MAX_PREVIEW_DATA_URL_LENGTH)}` }), false);
  assert.equal(JSON.stringify(DEFAULT_APP_LOGO_SETTINGS).includes("path"), false);
});

test("scheduled logo values can select a shipped preset but never carry custom image state", () => {
  const preset = validateScheduledSettings({ appLogo: { ...DEFAULT_APP_LOGO_SETTINGS, preset: "orbit" } });
  assert.equal(preset.appLogo?.preset, "orbit");
  assert.throws(
    () => validateScheduledSettings({ appLogo: { ...DEFAULT_APP_LOGO_SETTINGS, source: "custom" } }),
    /shipped preset/u,
  );
});
