// ABDM-M3 color utilities: conversions, translator, contrast, MD3 tonal palettes from seed.
// Engine: sRGB (CSS Color 4 formulas). Lab/LCH use D50 (CSS lab()); OKLab per Ottosson. CMYK = naive device approximation.

const NAMED = { aliceblue:'#f0f8ff', antiquewhite:'#faebd7', aqua:'#00ffff', aquamarine:'#7fffd4', azure:'#f0ffff', beige:'#f5f5dc', bisque:'#ffe4c4', black:'#000000', blanchedalmond:'#ffebcd', blue:'#0000ff', blueviolet:'#8a2be2', brown:'#a52a2a', burlywood:'#deb887', cadetblue:'#5f9ea0', chartreuse:'#7fff00', chocolate:'#d2691e', coral:'#ff7f50', cornflowerblue:'#6495ed', cornsilk:'#fff8dc', crimson:'#dc143c', cyan:'#00ffff', darkblue:'#00008b', darkcyan:'#008b8b', darkgoldenrod:'#b8860b', darkgray:'#a9a9a9', darkgreen:'#006400', darkkhaki:'#bdb76b', darkmagenta:'#8b008b', darkolivegreen:'#556b2f', darkorange:'#ff8c00', darkorchid:'#9932cc', darkred:'#8b0000', darksalmon:'#e9967a', darkseagreen:'#8fbc8f', darkslateblue:'#483d8b', darkslategray:'#2f4f4f', darkturquoise:'#00ced1', darkviolet:'#9400d3', deeppink:'#ff1493', deepskyblue:'#00bfff', dimgray:'#696969', dodgerblue:'#1e90ff', firebrick:'#b22222', floralwhite:'#fffaf0', forestgreen:'#228b22', fuchsia:'#ff00ff', gainsboro:'#dcdcdc', ghostwhite:'#f8f8ff', gold:'#ffd700', goldenrod:'#daa520', gray:'#808080', green:'#008000', greenyellow:'#adff2f', honeydew:'#f0fff0', hotpink:'#ff69b4', indianred:'#cd5c5c', indigo:'#4b0082', ivory:'#fffff0', khaki:'#f0e68c', lavender:'#e6e6fa', lavenderblush:'#fff0f5', lawngreen:'#7cfc00', lemonchiffon:'#fffacd', lightblue:'#add8e6', lightcoral:'#f08080', lightcyan:'#e0ffff', lightgoldenrodyellow:'#fafad2', lightgray:'#d3d3d3', lightgreen:'#90ee90', lightpink:'#ffb6c1', lightsalmon:'#ffa07a', lightseagreen:'#20b2aa', lightskyblue:'#87cefa', lightslategray:'#778899', lightsteelblue:'#b0c4de', lightyellow:'#ffffe0', lime:'#00ff00', limegreen:'#32cd32', linen:'#faf0e6', magenta:'#ff00ff', maroon:'#800000', mediumaquamarine:'#66cdaa', mediumblue:'#0000cd', mediumorchid:'#ba55d3', mediumpurple:'#9370db', mediumseagreen:'#3cb371', mediumslateblue:'#7b68ee', mediumspringgreen:'#00fa9a', mediumturquoise:'#48d1cc', mediumvioletred:'#c71585', midnightblue:'#191970', mintcream:'#f5fffa', mistyrose:'#ffe4e1', moccasin:'#ffe4b5', navajowhite:'#ffdead', navy:'#000080', oldlace:'#fdf5e6', olive:'#808000', olivedrab:'#6b8e23', orange:'#ffa500', orangered:'#ff4500', orchid:'#da70d6', palegoldenrod:'#eee8aa', palegreen:'#98fb98', paleturquoise:'#afeeee', palevioletred:'#db7093', papayawhip:'#ffefd5', peachpuff:'#ffdab9', peru:'#cd853f', pink:'#ffc0cb', plum:'#dda0dd', powderblue:'#b0e0e6', purple:'#800080', rebeccapurple:'#663399', red:'#ff0000', rosybrown:'#bc8f8f', royalblue:'#4169e1', saddlebrown:'#8b4513', salmon:'#fa8072', sandybrown:'#f4a460', seagreen:'#2e8b57', seashell:'#fff5ee', sienna:'#a0522d', silver:'#c0c0c0', skyblue:'#87ceeb', slateblue:'#6a5acd', slategray:'#708090', snow:'#fffafa', springgreen:'#00ff7f', steelblue:'#4682b4', tan:'#d2b48c', teal:'#008080', thistle:'#d8bfd8', tomato:'#ff6347', turquoise:'#40e0d0', violet:'#ee82ee', wheat:'#f5deb3', white:'#ffffff', whitesmoke:'#f5f5f5', yellow:'#ffff00', yellowgreen:'#9acd32' };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = v => Math.round(v * 100) / 100;

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (NAMED[h.toLowerCase()]) h = NAMED[h.toLowerCase()].slice(1);
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
export function rgbToHex({ r, g, b }, a = 1) {
  const p = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b) + (a < 1 ? p(a * 255) : '');
}
export function nameOf(hex) {
  const target = rgbToHex(hexToRgb(hex) || { r: 0, g: 0, b: 0 }).slice(0, 7).toLowerCase();
  for (const [n, v] of Object.entries(NAMED)) if (v === target) return n;
  return null;
}
export const namedColors = NAMED;

// ---- sRGB <-> linear <-> XYZ ----
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const l2s = c => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return clamp(Math.round(v * 255), 0, 255); };
const l2sRaw = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255;
export function rgbToXyz({ r, g, b }) { // D65
  const R = s2l(r), G = s2l(g), B = s2l(b);
  return {
    x: 0.4124564 * R + 0.3575761 * G + 0.1804375 * B,
    y: 0.2126729 * R + 0.7151522 * G + 0.0721750 * B,
    z: 0.0193339 * R + 0.1191920 * G + 0.9503041 * B,
  };
}
function xyzD65toD50({ x, y, z }) { // Bradford
  return {
    x: 1.0478112 * x + 0.0228866 * y - 0.0501270 * z,
    y: 0.0295424 * x + 1.0099425 * y - 0.0170491 * z,
    z: -0.0092345 * x + 0.0150436 * y + 0.7521316 * z,
  };
}
function xyzD50toD65({ x, y, z }) {
  return {
    x: 0.9555766 * x - 0.0230393 * y + 0.0631636 * z,
    y: -0.0282895 * x + 1.0099416 * y + 0.0210077 * z,
    z: 0.0122982 * x - 0.0204830 * y + 1.3299098 * z,
  };
}
function xyzToRgb({ x, y, z }) { // D65
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return { raw: [l2sRaw(R), l2sRaw(G), l2sRaw(B)], r: l2s(R), g: l2s(G), b: l2s(B) };
}
// ---- Lab / LCH (D50, as CSS lab()) ----
const D50 = { x: 0.96422, y: 1.0, z: 0.82521 };
export function rgbToLab(rgb) {
  const { x, y, z } = xyzD65toD50(rgbToXyz(rgb));
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(x / D50.x), fy = f(y / D50.y), fz = f(z / D50.z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
export function labToRgb({ l, a, b }) {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fi = t => { const t3 = t * t * t; return t3 > 216 / 24389 ? t3 : (116 * t - 16) * 27 / 24389; };
  const xyz = xyzD50toD65({ x: fi(fx) * D50.x, y: fi(fy) * D50.y, z: fi(fz) * D50.z });
  return xyzToRgb(xyz);
}
export const labToLch = ({ l, a, b }) => ({ l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 });
export const lchToLab = ({ l, c, h }) => ({ l, a: c * Math.cos(h * Math.PI / 180), b: c * Math.sin(h * Math.PI / 180) });
// ---- OKLab / OKLCH ----
export function rgbToOklab({ r, g, b }) {
  const R = s2l(r), G = s2l(g), B = s2l(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}
export function oklabToRgb({ l, a, b }) {
  const L = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const M = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const S = Math.pow(l - 0.0894841775 * a - 1.2914855480 * b, 3);
  const R = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const G = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const B = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;
  return { raw: [l2sRaw(R), l2sRaw(G), l2sRaw(B)], r: l2s(R), g: l2s(G), b: l2s(B) };
}
export const oklabToOklch = ({ l, a, b }) => ({ l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 });
export const oklchToOklab = ({ l, c, h }) => ({ l, a: c * Math.cos(h * Math.PI / 180), b: c * Math.sin(h * Math.PI / 180) });
export const inGamut = raw => raw.every(v => v >= -0.6 && v <= 255.6);
// ---- HSL / HSV / HWB ----
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  const l = (max + min) / 2;
  return { h, s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}
export function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
export function rgbToHsv({ r, g, b }) {
  const { h } = rgbToHsl({ r, g, b });
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  return { h, s: max === 0 ? 0 : (max - min) / max, v: max };
}
export function hsvToRgb({ h, s, v }) {
  const l = v * (1 - s / 2);
  return hslToRgb({ h, s: (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l), l });
}
export const rgbToHwb = rgb => { const { h } = rgbToHsl(rgb); return { h, w: Math.min(rgb.r, rgb.g, rgb.b) / 255, b: 1 - Math.max(rgb.r, rgb.g, rgb.b) / 255 }; };
export const hwbToRgb = ({ h, w, b }) => { if (w + b >= 1) { const g = Math.round(w / (w + b) * 255); return { r: g, g, b: g }; } const rgb = hslToRgb({ h, s: 1, l: 0.5 }); const f = c => Math.round((c / 255 * (1 - w - b) + w) * 255); return { r: f(rgb.r), g: f(rgb.g), b: f(rgb.b) }; };
export const rgbToCmyk = ({ r, g, b }) => { const k = 1 - Math.max(r, g, b) / 255; if (k === 1) return { c: 0, m: 0, y: 0, k: 1 }; const f = v => (1 - v / 255 - k) / (1 - k); return { c: f(r), m: f(g), y: f(b), k }; };
export const cmykToRgb = ({ c, m, y, k }) => ({ r: Math.round(255 * (1 - c) * (1 - k)), g: Math.round(255 * (1 - m) * (1 - k)), b: Math.round(255 * (1 - y) * (1 - k)) });

// ---- contrast (WCAG 2.x) ----
export function contrastRatio(hex1, hex2) {
  const lum = h => { const c = hexToRgb(h); if (!c) return 0; return 0.2126 * s2l(c.r) + 0.7152 * s2l(c.g) + 0.0722 * s2l(c.b); };
  const a = lum(hex1) + 0.05, b = lum(hex2) + 0.05;
  return r2(Math.max(a, b) / Math.min(a, b));
}

// ---- translator: parse any supported representation -> rgb+alpha; emit all ----
export function parseColor(input) {
  if (!input) return null;
  const str = String(input).trim();
  const rgb = hexToRgb(str);
  if (rgb) return { ...rgb, source: str.startsWith('#') ? 'hex' : 'named' };
  const m = str.match(/^(rgba?|hsla?|hsv|hsb|hwb|lab|lch|oklab|oklch|cmyk|device-cmyk)\s*\(([^)]+)\)$/i);
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const parts = m[2].split(/[,\s\/]+/).filter(Boolean).map(p => p.trim());
  const num = (p, scale = 1) => { if (p == null) return 0; const pct = p.endsWith('%'); const v = parseFloat(p); return pct ? v / 100 * scale : v; };
  const alpha = parts.length > (fn === 'cmyk' || fn === 'device-cmyk' ? 4 : 3) ? clamp(num(parts[fn.startsWith('cmyk') || fn === 'device-cmyk' ? 4 : 3], 1), 0, 1) : 1;
  let out;
  if (fn === 'rgb' || fn === 'rgba') out = { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255) };
  else if (fn === 'hsl' || fn === 'hsla') out = hslToRgb({ h: num(parts[0]), s: num(parts[1], 1) > 1 ? num(parts[1]) / 100 : num(parts[1], 1), l: num(parts[2], 1) > 1 ? num(parts[2]) / 100 : num(parts[2], 1) });
  else if (fn === 'hsv' || fn === 'hsb') out = hsvToRgb({ h: num(parts[0]), s: num(parts[1], 1) > 1 ? num(parts[1]) / 100 : num(parts[1], 1), v: num(parts[2], 1) > 1 ? num(parts[2]) / 100 : num(parts[2], 1) });
  else if (fn === 'hwb') out = hwbToRgb({ h: num(parts[0]), w: num(parts[1], 1) > 1 ? num(parts[1]) / 100 : num(parts[1], 1), b: num(parts[2], 1) > 1 ? num(parts[2]) / 100 : num(parts[2], 1) });
  else if (fn === 'lab') out = labToRgb({ l: num(parts[0]), a: num(parts[1]), b: num(parts[2]) });
  else if (fn === 'lch') out = labToRgb(lchToLab({ l: num(parts[0]), c: num(parts[1]), h: num(parts[2]) }));
  else if (fn === 'oklab') out = oklabToRgb({ l: num(parts[0], 1), a: num(parts[1]), b: num(parts[2]) });
  else if (fn === 'oklch') out = oklabToRgb(oklchToOklab({ l: num(parts[0], 1), c: num(parts[1]), h: num(parts[2]) }));
  else if (fn === 'cmyk' || fn === 'device-cmyk') out = cmykToRgb({ c: num(parts[0], 1), m: num(parts[1], 1), y: num(parts[2], 1), k: num(parts[3], 1) });
  if (!out) return null;
  const clipped = out.raw ? !inGamut(out.raw) : false;
  return { r: clamp(Math.round(out.r), 0, 255), g: clamp(Math.round(out.g), 0, 255), b: clamp(Math.round(out.b), 0, 255), a: alpha, source: fn, clipped };
}
export function translate(rgbIn) {
  const { r, g, b } = rgbIn, a = rgbIn.a ?? 1;
  const hsl = rgbToHsl(rgbIn), hsv = rgbToHsv(rgbIn), hwb = rgbToHwb(rgbIn);
  const lab = rgbToLab(rgbIn), lch = labToLch(lab), ok = rgbToOklab(rgbIn), okl = oklabToOklch(ok), cmyk = rgbToCmyk(rgbIn);
  const P = v => Math.round(v * 100);
  return {
    named: nameOf(rgbToHex(rgbIn)),
    hex: rgbToHex(rgbIn).slice(0, 7).toUpperCase(),
    hex8: rgbToHex(rgbIn, a).toUpperCase().padEnd(9, 'F').slice(0, 9),
    rgb: `rgb(${r} ${g} ${b})`, rgba: `rgba(${r}, ${g}, ${b}, ${r2(a)})`,
    hsl: `hsl(${Math.round(hsl.h)} ${P(hsl.s)}% ${P(hsl.l)}%)`, hsla: `hsla(${Math.round(hsl.h)}, ${P(hsl.s)}%, ${P(hsl.l)}%, ${r2(a)})`,
    hsv: `hsv(${Math.round(hsv.h)} ${P(hsv.s)}% ${P(hsv.v)}%)`,
    hwb: `hwb(${Math.round(hwb.h)} ${P(hwb.w)}% ${P(hwb.b)}%)`,
    lab: `lab(${r2(lab.l)} ${r2(lab.a)} ${r2(lab.b)})`,
    lch: `lch(${r2(lch.l)} ${r2(lch.c)} ${r2(lch.h)})`,
    oklab: `oklab(${r2(ok.l)} ${r2(ok.a)} ${r2(ok.b)})`,
    oklch: `oklch(${r2(okl.l)} ${r2(okl.c)} ${r2(okl.h)})`,
    cmyk: `cmyk(${P(cmyk.c)}% ${P(cmyk.m)}% ${P(cmyk.y)}% ${P(cmyk.k)}%)`,
  };
}

// ---- MD3 tonal palette from seed (OKLCH-based HCT approximation) ----
const toneToOkL = tone => { const L = clamp(tone, 0, 100); const Y = L > 8 ? Math.pow((L + 16) / 116, 3) : L / 903.3; return Math.cbrt(Y); };
export function tonal(hueDeg, chroma, tone) {
  const l = toneToOkL(tone);
  let c = chroma;
  for (let i = 0; i < 18; i++) { const out = oklabToRgb(oklchToOklab({ l, c, h: hueDeg })); if (inGamut(out.raw)) break; c *= 0.82; }
  const out = oklabToRgb(oklchToOklab({ l, c, h: hueDeg }));
  return rgbToHex(out);
}
export function schemeFromSeed(seedHex, dark) {
  const rgb = hexToRgb(seedHex) || hexToRgb('#6750A4');
  const okl = oklabToOklch(rgbToOklab(rgb));
  const H = okl.h, C = Math.max(0.09, Math.min(okl.c, 0.17));
  const p = t => tonal(H, C, t), s = t => tonal(H, C / 3, t), t3 = t => tonal((H + 60) % 360, C / 2, t);
  const n = t => tonal(H, 0.008, t), nv = t => tonal(H, 0.016, t), e = t => tonal(25, 0.19, t);
  const D = dark;
  return {
    primary: p(D ? 80 : 40), onPrimary: p(D ? 20 : 100), primaryContainer: p(D ? 30 : 90), onPrimaryContainer: p(D ? 90 : 10),
    secondary: s(D ? 80 : 40), onSecondary: s(D ? 20 : 100), secondaryContainer: s(D ? 30 : 90), onSecondaryContainer: s(D ? 90 : 10),
    tertiary: t3(D ? 80 : 40), onTertiary: t3(D ? 20 : 100), tertiaryContainer: t3(D ? 30 : 90), onTertiaryContainer: t3(D ? 90 : 10),
    error: e(D ? 80 : 40), onError: e(D ? 20 : 100), errorContainer: e(D ? 30 : 90), onErrorContainer: e(D ? 90 : 10),
    background: n(D ? 6 : 98), onBackground: n(D ? 90 : 10),
    surface: n(D ? 6 : 98), onSurface: n(D ? 90 : 10), surfaceVariant: nv(D ? 30 : 90), onSurfaceVariant: nv(D ? 80 : 30),
    surfaceDim: n(D ? 6 : 87), surfaceBright: n(D ? 24 : 98),
    surfaceContainerLowest: n(D ? 4 : 100), surfaceContainerLow: n(D ? 10 : 96), surfaceContainer: n(D ? 12 : 94),
    surfaceContainerHigh: n(D ? 17 : 92), surfaceContainerHighest: n(D ? 22 : 90),
    outline: nv(D ? 60 : 50), outlineVariant: nv(D ? 30 : 80),
    inverseSurface: n(D ? 90 : 20), inverseOnSurface: n(D ? 20 : 95), inversePrimary: p(D ? 40 : 80),
    scrim: '#000000', shadow: '#000000',
    surfaceTint: p(D ? 80 : 40),
    success: tonal(150, 0.12, D ? 80 : 40), onSuccess: tonal(150, 0.12, D ? 20 : 100), successContainer: tonal(150, 0.12, D ? 30 : 90), onSuccessContainer: tonal(150, 0.12, D ? 90 : 10),
    warning: tonal(85, 0.13, D ? 80 : 45), onWarning: tonal(85, 0.13, D ? 20 : 100), warningContainer: tonal(85, 0.13, D ? 30 : 90), onWarningContainer: tonal(85, 0.13, D ? 90 : 10),
    info: tonal(240, 0.12, D ? 80 : 40), infoContainer: tonal(240, 0.12, D ? 30 : 90),
  };
}
export function schemeVars(scheme) {
  return Object.entries(scheme).map(([k, v]) => `--md-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`).join(';');
}
