/** Local color helpers for the logo background editor. No network or DOM state. */

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, precision = 2) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function hexChannel(value) {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

export function normalizeHexColor(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/u.exec(raw);
  if (short) return `#${short[1].split("").map((item) => item + item).join("")}`;
  const shortAlpha = /^#([0-9a-f]{4})$/u.exec(raw);
  if (shortAlpha) return `#${shortAlpha[1].split("").map((item) => item + item).join("")}`;
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u.test(raw) ? raw : null;
}

export function hexToRgb(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function hexAlpha(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  return hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1;
}

export function rgbToHex({ r, g, b }) {
  if (![r, g, b].every(Number.isFinite)) return null;
  return `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`;
}

function rgbUnit(rgb) {
  return { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 };
}

export function rgbToHsl(rgb) {
  const { r, g, b } = rgbUnit(rgb);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: round(h, 1), s: round(s * 100, 1), l: round(l * 100, 1) };
}

export function hslToRgb({ h, s, l }) {
  if (![h, s, l].every(Number.isFinite)) return null;
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s / 100);
  const lightness = clamp(l / 100);
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToHsv(rgb) {
  const { r, g, b } = rgbUnit(rgb);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h: round(h, 1), s: round((max === 0 ? 0 : delta / max) * 100, 1), v: round(max * 100, 1) };
}

export function rgbToHwb(rgb) {
  const hsv = rgbToHsv(rgb);
  const { r, g, b } = rgbUnit(rgb);
  return { h: hsv.h, w: round(Math.min(r, g, b) * 100, 1), b: round((1 - Math.max(r, g, b)) * 100, 1) };
}

export function rgbToCmyk(rgb) {
  const { r, g, b } = rgbUnit(rgb);
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: round(((1 - r - k) / (1 - k)) * 100, 1),
    m: round(((1 - g - k) / (1 - k)) * 100, 1),
    y: round(((1 - b - k) / (1 - k)) * 100, 1),
    k: round(k * 100, 1),
  };
}

function linear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz(rgb) {
  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

export function rgbToLab(rgb) {
  const xyz = rgbToXyz(rgb);
  const pivot = (value) => value > 216 / 24389 ? value ** (1 / 3) : (24389 / 27 * value + 16) / 116;
  const fx = pivot(xyz.x / 0.95047);
  const fy = pivot(xyz.y);
  const fz = pivot(xyz.z / 1.08883);
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  const l = 116 * fy - 16;
  return { l: round(l, 2), a: round(a, 2), b: round(b, 2) };
}

export function labToLch(lab) {
  const c = Math.sqrt(lab.a ** 2 + lab.b ** 2);
  const h = (Math.atan2(lab.b, lab.a) * 180 / Math.PI + 360) % 360;
  return { l: lab.l, c: round(c, 2), h: round(h, 2) };
}

export function rgbToOklab(rgb) {
  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: round(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 4),
    a: round(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 4),
    b: round(0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, 4),
  };
}

export function oklabToOklch(oklab) {
  const c = Math.sqrt(oklab.a ** 2 + oklab.b ** 2);
  const h = (Math.atan2(oklab.b, oklab.a) * 180 / Math.PI + 360) % 360;
  return { l: oklab.l, c: round(c, 4), h: round(h, 2) };
}

export function contrastRatio(rgb, against) {
  const luminance = (value) => {
    const linearRgb = rgbToXyz(value);
    return linearRgb.y;
  };
  const a = luminance(rgb);
  const b = luminance(against);
  return round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), 2);
}

function compositeRgb(foreground, alpha, background) {
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  };
}

export function parseColorInput(value) {
  const hex = normalizeHexColor(value);
  if (hex) return hex;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu.exec(String(value ?? ""));
  if (rgb && rgb.slice(1).every((part) => Number(part) <= 255)) return rgbToHex({ r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) });
  const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|0?\.\d+|1(?:\.0+)?)\s*\)$/iu.exec(String(value ?? ""));
  if (rgba && rgba.slice(1, 4).every((part) => Number(part) <= 255)) {
    const base = rgbToHex({ r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) });
    return base ? `${base}${hexChannel(Number(rgba[4]) * 255)}` : null;
  }
  const hsl = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%\s*\)$/iu.exec(String(value ?? ""));
  if (hsl && Number(hsl[2]) <= 100 && Number(hsl[3]) <= 100) return rgbToHex(hslToRgb({ h: Number(hsl[1]), s: Number(hsl[2]), l: Number(hsl[3]) }));
  const hsla = /^hsla\(\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%\s*(?:,|\s)\s*(\d+(?:\.\d+)?)%\s*(?:,|\s)\s*(0|0?\.\d+|1(?:\.0+)?)\s*\)$/iu.exec(String(value ?? ""));
  if (hsla && Number(hsla[2]) <= 100 && Number(hsla[3]) <= 100) {
    const base = rgbToHex(hslToRgb({ h: Number(hsla[1]), s: Number(hsla[2]), l: Number(hsla[3]) }));
    return base ? `${base}${hexChannel(Number(hsla[4]) * 255)}` : null;
  }
  return null;
}

export function colorTranslations(value) {
  const hex = normalizeHexColor(value);
  const rgb = hexToRgb(hex);
  const alpha = hexAlpha(hex);
  if (!hex || !rgb || alpha === null) return null;
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const hwb = rgbToHwb(rgb);
  const cmyk = rgbToCmyk(rgb);
  const lab = rgbToLab(rgb);
  const lch = labToLch(lab);
  const oklab = rgbToOklab(rgb);
  const oklch = oklabToOklch(oklab);
  return {
    HEX: hex.slice(0, 7).toUpperCase(),
    HEX8: (hex.length === 9 ? hex : `${hex}ff`).toUpperCase(),
    RGB: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    RGBA: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${round(alpha, 3)})`,
    HSL: `hsl(${hsl.h} ${hsl.s}% ${hsl.l}%)`,
    HSLA: `hsla(${hsl.h} ${hsl.s}% ${hsl.l}% / ${round(alpha, 3)})`,
    HSV: `hsv(${hsv.h} ${hsv.s}% ${hsv.v}%)`,
    HWB: `hwb(${hwb.h} ${hwb.w}% ${hwb.b}%)`,
    CIELAB: `lab(${lab.l}% ${lab.a} ${lab.b})`,
    LCH: `lch(${lch.l}% ${lch.c} ${lch.h})`,
    OKLab: `oklab(${oklab.l} ${oklab.a} ${oklab.b})`,
    OKLCH: `oklch(${oklch.l} ${oklch.c} ${oklch.h})`,
    CMYK: `cmyk(${cmyk.c}% ${cmyk.m}% ${cmyk.y}% ${cmyk.k}%)`,
    contrastOnWhite: contrastRatio(compositeRgb(rgb, alpha, { r: 255, g: 255, b: 255 }), { r: 255, g: 255, b: 255 }),
    contrastOnBlack: contrastRatio(compositeRgb(rgb, alpha, { r: 0, g: 0, b: 0 }), { r: 0, g: 0, b: 0 }),
  };
}
