(function (global) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const MAX_INPUT_BYTES = 1572864;
  const MAX_WIDTH = 4096;
  const MAX_HEIGHT = 4096;
  const MAX_PIXELS = 12000000;
  const MAX_SCHEDULE_RULES = 12;
  const FITS = Object.freeze(["contain", "cover", "fill"]);
  const BACKGROUND_MODES = Object.freeze(["transparent", "color"]);
  const WEEKDAYS = Object.freeze(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
  const ALL_WEEKDAYS = Object.freeze([...WEEKDAYS]);
  const FAILURE_REASONS = Object.freeze([
    "empty-image", "missing-custom-data", "image-bytes-exceed-limit", "invalid-png-signature", "invalid-jpeg-signature",
    "unsupported-image-format", "animated-png-not-supported", "png-dimensions-exceed-limit", "jpeg-dimensions-exceed-limit",
    "malformed-png-chunk", "malformed-jpeg-segment", "missing-png-header", "malformed-png-header", "unsupported-png-header",
    "malformed-png-transparency", "malformed-png-end", "incomplete-png", "missing-jpeg-frame", "malformed-jpeg-frame",
    "incomplete-jpeg", "invalid-custom-data-uri", "custom-data-uri-exceeds-limit", "custom-data-uri-mime-mismatch",
    "decoder-rejected", "isolated-decoder-unavailable", "decoder-dimensions-mismatch"
  ]);

  // These are text-and-CSS marks, intentionally bundled rather than fetched images.
  const PRESETS = Object.freeze([
    Object.freeze({ id: "transfer", label: "Transfer arrow", labelYue: "傳輸箭咀", glyph: "↘", tone: "violet" }),
    Object.freeze({ id: "queue", label: "Queue arrow", labelYue: "隊列箭咀", glyph: "⇣", tone: "teal" }),
    Object.freeze({ id: "relay", label: "Relay mark", labelYue: "轉送標誌", glyph: "⤓", tone: "amber" })
  ]);
  const PRESET_IDS = new Set(PRESETS.map((preset) => preset.id));

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function normalizeHex(value, fallback = "#6750A4") {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
  }

  function normalizeClock(value, fallback) {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return fallback;
    return value;
  }

  function normalizeDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
  }

  function normalizeScheduleLabel(value, fallback) {
    const normalized = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").trim().slice(0, 64);
    return normalized || fallback;
  }

  function normalizeScheduleId(value, fallback) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return /^logo-[a-z0-9][a-z0-9-]{1,47}$/.test(normalized) ? normalized : fallback;
  }

  function localTimezone() {
    try {
      const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (typeof value === "string" && value) return value;
    } catch (_error) {
      // A missing Intl implementation is treated as UTC instead of guessing.
    }
    return "UTC";
  }

  function normalizeTimezone(value) {
    const candidate = typeof value === "string" && value ? value : localTimezone();
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch (_error) {
      return localTimezone();
    }
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }

  function readUInt32(bytes, offset) {
    return ((bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0;
  }

  function readAscii(bytes, offset, length) {
    let result = "";
    for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]);
    return result;
  }

  function dimensionsAreSafe(width, height) {
    return Number.isSafeInteger(width)
      && Number.isSafeInteger(height)
      && width > 0
      && height > 0
      && width <= MAX_WIDTH
      && height <= MAX_HEIGHT
      && width * height <= MAX_PIXELS;
  }

  function invalid(reason) {
    return Object.freeze({ valid: false, reason });
  }

  function inspectPng(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) return invalid("invalid-png-signature");
    let offset = 8;
    let sawHeader = false;
    let sawImageData = false;
    let sawEnd = false;
    let width = 0;
    let height = 0;
    let hasAlpha = false;
    let colorType = -1;

    while (offset + 12 <= bytes.length) {
      const length = readUInt32(bytes, offset);
      if (length > MAX_INPUT_BYTES || offset + 12 + length > bytes.length) return invalid("malformed-png-chunk");
      const type = readAscii(bytes, offset + 4, 4);
      const dataOffset = offset + 8;
      if (!sawHeader && type !== "IHDR") return invalid("missing-png-header");
      if (type === "IHDR") {
        if (sawHeader || length !== 13) return invalid("malformed-png-header");
        width = readUInt32(bytes, dataOffset);
        height = readUInt32(bytes, dataOffset + 4);
        const bitDepth = bytes[dataOffset + 8];
        colorType = bytes[dataOffset + 9];
        const compression = bytes[dataOffset + 10];
        const filter = bytes[dataOffset + 11];
        const interlace = bytes[dataOffset + 12];
        if (!dimensionsAreSafe(width, height)) return invalid("png-dimensions-exceed-limit");
        if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType) || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) return invalid("unsupported-png-header");
        hasAlpha = colorType === 4 || colorType === 6;
        sawHeader = true;
      } else if (type === "acTL") {
        return invalid("animated-png-not-supported");
      } else if (type === "tRNS") {
        if (sawImageData || ![0, 2, 3].includes(colorType)) return invalid("malformed-png-transparency");
        hasAlpha = true;
      } else if (type === "IDAT") {
        sawImageData = true;
      } else if (type === "IEND") {
        if (length !== 0 || !sawImageData || offset + 12 !== bytes.length) return invalid("malformed-png-end");
        sawEnd = true;
        break;
      }
      offset += 12 + length;
    }

    if (!sawHeader || !sawImageData || !sawEnd) return invalid("incomplete-png");
    return Object.freeze({ valid: true, format: "png", mime: "image/png", width, height, hasAlpha, animated: false, byteLength: bytes.length });
  }

  function inspectJpeg(bytes) {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return invalid("invalid-jpeg-signature");
    let offset = 2;
    let width = 0;
    let height = 0;
    let sawStartOfFrame = false;
    let sawStartOfScan = false;

    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9) break;
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return invalid("malformed-jpeg-segment");
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) return invalid("malformed-jpeg-segment");
      const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        if (length < 8 || sawStartOfFrame) return invalid("malformed-jpeg-frame");
        height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        if (!dimensionsAreSafe(width, height)) return invalid("jpeg-dimensions-exceed-limit");
        sawStartOfFrame = true;
      }
      if (marker === 0xda) {
        sawStartOfScan = true;
        break;
      }
      offset += length;
    }

    if (!sawStartOfFrame) return invalid("missing-jpeg-frame");
    if (!sawStartOfScan || bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return invalid("incomplete-jpeg");
    return Object.freeze({ valid: true, format: "jpeg", mime: "image/jpeg", width, height, hasAlpha: false, animated: false, byteLength: bytes.length });
  }

  function inspectImageBytes(value) {
    const bytes = toBytes(value);
    if (!bytes || !bytes.length) return invalid("empty-image");
    if (bytes.length > MAX_INPUT_BYTES) return invalid("image-bytes-exceed-limit");
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return inspectPng(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
    return invalid("unsupported-image-format");
  }

  function base64ToBytes(base64) {
    try {
      if (typeof atob === "function") {
        const decoded = atob(base64);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
        return bytes;
      }
      if (typeof Buffer === "function") return new Uint8Array(Buffer.from(base64, "base64"));
    } catch (_error) {
      return null;
    }
    return null;
  }

  function decodeDataUriCandidate(value) {
    if (typeof value !== "string") return invalid("missing-custom-data");
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) return invalid("invalid-custom-data-uri");
    const estimatedBytes = Math.floor((match[2].length * 3) / 4) - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
    if (estimatedBytes <= 0 || estimatedBytes > MAX_INPUT_BYTES) return invalid("custom-data-uri-exceeds-limit");
    const bytes = base64ToBytes(match[2]);
    if (!bytes || bytes.length !== estimatedBytes || bytes.length > MAX_INPUT_BYTES) return invalid("invalid-custom-data-uri");
    return Object.freeze({ valid: true, mime: match[1], bytes });
  }

  function parseDataUri(value) {
    const candidate = decodeDataUriCandidate(value);
    if (!candidate.valid) return candidate;
    const inspected = inspectImageBytes(candidate.bytes);
    if (!inspected.valid) return inspected;
    if (inspected.mime !== candidate.mime) return invalid("custom-data-uri-mime-mismatch");
    return Object.freeze({ ...inspected, dataUri: value });
  }

  function normalizeCustomSelection(selection) {
    const parsed = parseDataUri(selection?.dataUri);
    if (!parsed.valid) return null;
    return Object.freeze({
      kind: "custom",
      dataUri: parsed.dataUri,
      format: parsed.format,
      mime: parsed.mime,
      byteLength: parsed.byteLength,
      width: parsed.width,
      height: parsed.height,
      hasAlpha: parsed.hasAlpha
    });
  }

  function normalizePrivateCache(value) {
    const source = value && typeof value === "object" ? value : {};
    if (source.schemaVersion !== SCHEMA_VERSION) return null;
    const candidate = decodeDataUriCandidate(source.dataUri);
    if (!candidate.valid) return null;
    return Object.freeze({ schemaVersion: SCHEMA_VERSION, dataUri: source.dataUri });
  }

  function minutesSinceMidnight(value) {
    const clock = normalizeClock(value, "00:00");
    const [hour, minute] = clock.split(":").map(Number);
    return hour * 60 + minute;
  }

  function normalizeWeekdays(value) {
    if (!Array.isArray(value)) return ALL_WEEKDAYS;
    const weekdays = [...new Set(value.filter((day) => WEEKDAYS.includes(day)))];
    return weekdays.length ? Object.freeze(weekdays) : ALL_WEEKDAYS;
  }

  function normalizeScheduleRule(value, index = 0) {
    const source = value && typeof value === "object" ? value : {};
    const fallbackId = index === 0 ? "logo-local-default" : `logo-local-${index + 1}`;
    const startDate = normalizeDate(source.startDate);
    const endDate = normalizeDate(source.endDate);
    const validDateRange = !startDate || !endDate || startDate <= endDate;
    const weekdays = normalizeWeekdays(source.weekdays);
    return Object.freeze({
      id: normalizeScheduleId(source.id, fallbackId),
      label: normalizeScheduleLabel(source.label, index === 0 ? "Logo schedule" : `Logo schedule ${index + 1}`),
      enabled: source.enabled === true,
      priority: clamp(source.priority, 0, 1000, 100),
      startDate: validDateRange ? startDate : "",
      endDate: validDateRange ? endDate : "",
      start: normalizeClock(source.start, "18:00"),
      end: normalizeClock(source.end, "08:00"),
      weekdays,
      everyDay: weekdays.length === ALL_WEEKDAYS.length,
      presetId: PRESET_IDS.has(source.presetId) ? source.presetId : "queue",
      source: "local"
    });
  }

  function normalizeSchedule(value) {
    const source = value && typeof value === "object" ? value : {};
    const rawRules = Array.isArray(source.rules) && source.rules.length
      ? source.rules.slice(0, MAX_SCHEDULE_RULES)
      : [source];
    const seen = new Set();
    const rules = rawRules.map((rule, index) => {
      const normalized = normalizeScheduleRule(rule, index);
      const id = seen.has(normalized.id) ? `logo-local-${index + 1}` : normalized.id;
      seen.add(id);
      return id === normalized.id ? normalized : Object.freeze({ ...normalized, id });
    });
    return Object.freeze({
      timezone: normalizeTimezone(source.timezone),
      rules: Object.freeze(rules)
    });
  }

  function zonedParts(now, timezone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      });
      const raw = Object.fromEntries(formatter.formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      const weekdays = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
      const hour = Number(raw.hour);
      const minute = Number(raw.minute);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || !weekdays[raw.weekday]) return null;
      return Object.freeze({
        date: `${raw.year}-${raw.month}-${raw.day}`,
        weekday: weekdays[raw.weekday],
        minutes: hour * 60 + minute
      });
    } catch (_error) {
      return null;
    }
  }

  function previousLocalDay(parts) {
    const date = new Date(`${parts.date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return Object.freeze({
      date: date.toISOString().slice(0, 10),
      weekday: WEEKDAYS[date.getUTCDay()]
    });
  }

  function scheduleRuleIsActive(rule, timezone, now = new Date()) {
    if (!rule?.enabled || rule.source !== "local") return false;
    const parts = zonedParts(now, timezone);
    if (!parts) return false;
    const start = minutesSinceMidnight(rule.start);
    const end = minutesSinceMidnight(rule.end);
    const crossMidnight = start > end;
    const inWindow = start === end || (crossMidnight ? parts.minutes >= start || parts.minutes < end : parts.minutes >= start && parts.minutes < end);
    if (!inWindow) return false;
    const occurrence = crossMidnight && parts.minutes < end ? previousLocalDay(parts) : parts;
    if (rule.startDate && occurrence.date < rule.startDate) return false;
    if (rule.endDate && occurrence.date > rule.endDate) return false;
    return rule.weekdays.includes(occurrence.weekday);
  }

  function resolveScheduledRule(schedule, now = new Date()) {
    const normalized = normalizeSchedule(schedule);
    return normalized.rules
      .filter((rule) => scheduleRuleIsActive(rule, normalized.timezone, now))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0] || null;
  }

  function scheduleIsActive(schedule, now = new Date()) {
    return Boolean(resolveScheduledRule(schedule, now));
  }

  function normalizeLogoSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const custom = source.selection?.kind === "custom" ? normalizeCustomSelection(source.selection) : null;
    const presetId = PRESET_IDS.has(source.selection?.presetId) ? source.selection.presetId : "transfer";
    const lastPresetId = PRESET_IDS.has(source.lastPresetId) ? source.lastPresetId : presetId;
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      selection: custom || Object.freeze({ kind: "preset", presetId }),
      lastPresetId,
      transform: Object.freeze({
        fit: FITS.includes(source.transform?.fit) ? source.transform.fit : "contain",
        focalX: clamp(source.transform?.focalX, 0, 100, 50),
        focalY: clamp(source.transform?.focalY, 0, 100, 50),
        cropZoom: clamp(source.transform?.cropZoom, 100, 220, 100),
        backgroundMode: BACKGROUND_MODES.includes(source.transform?.backgroundMode) ? source.transform.backgroundMode : "transparent",
        backgroundColor: normalizeHex(source.transform?.backgroundColor)
      }),
      schedule: normalizeSchedule(source.schedule)
    });
  }

  function resolveLogo(value, now = new Date()) {
    const logo = normalizeLogoSettings(value);
    const rule = resolveScheduledRule(logo.schedule, now);
    return Object.freeze({
      ...logo,
      selection: rule ? Object.freeze({ kind: "preset", presetId: rule.presetId }) : logo.selection,
      scheduled: Boolean(rule),
      scheduleRule: rule
    });
  }

  function getPreset(id) {
    return PRESETS.find((preset) => preset.id === id) || PRESETS[0];
  }

  function buildSafeSettingsRecord(value) {
    const logo = normalizeLogoSettings(value);
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      selection: logo.selection.kind === "custom" ? Object.freeze({ kind: "custom" }) : Object.freeze({ kind: "preset", presetId: logo.selection.presetId }),
      lastPresetId: logo.lastPresetId,
      transform: logo.transform,
      schedule: logo.schedule
    });
  }

  function buildPrivateCache(value) {
    const logo = normalizeLogoSettings(value);
    return logo.selection.kind === "custom" ? Object.freeze({ schemaVersion: SCHEMA_VERSION, dataUri: logo.selection.dataUri }) : null;
  }

  function hydrateLogoSettings(configuration, privateCache) {
    const safe = configuration && typeof configuration === "object" && configuration.schemaVersion === SCHEMA_VERSION ? configuration : null;
    if (!safe) return normalizeLogoSettings(null);
    const cache = normalizePrivateCache(privateCache);
    const selection = safe.selection?.kind === "custom" && cache
      ? { kind: "custom", dataUri: cache.dataUri }
      : safe.selection;
    return normalizeLogoSettings({ ...safe, selection });
  }

  function buildSafeExport(value) {
    const logo = normalizeLogoSettings(value);
    const selection = logo.selection.kind === "custom"
      ? {
          kind: "custom",
          format: logo.selection.format,
          width: logo.selection.width,
          height: logo.selection.height,
          byteLength: logo.selection.byteLength,
          hasAlpha: logo.selection.hasAlpha,
          customImageBytes: "omitted",
          originalFilename: "never stored"
        }
      : { kind: "preset", presetId: logo.selection.presetId };
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      exportScope: "logo configuration only",
      privacy: "Custom image bytes, data URIs, source paths, and original filenames are omitted.",
      selection,
      transform: logo.transform,
      schedule: logo.schedule
    });
  }

  global.MDM_SITE_LOGO_CONTRACT = Object.freeze({
    SCHEMA_VERSION,
    MAX_INPUT_BYTES,
    MAX_WIDTH,
    MAX_HEIGHT,
    MAX_PIXELS,
    MAX_SCHEDULE_RULES,
    FITS,
    BACKGROUND_MODES,
    WEEKDAYS,
    FAILURE_REASONS,
    PRESETS,
    inspectImageBytes,
    decodeDataUriCandidate,
    parseDataUri,
    normalizeLogoSettings,
    normalizePrivateCache,
    normalizeSchedule,
    normalizeScheduleRule,
    buildSafeSettingsRecord,
    buildPrivateCache,
    hydrateLogoSettings,
    scheduleIsActive,
    scheduleRuleIsActive,
    resolveScheduledRule,
    resolveLogo,
    getPreset,
    buildSafeExport
  });
})(typeof window === "object" ? window : globalThis);
