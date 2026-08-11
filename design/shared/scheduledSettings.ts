export const SCHEDULE_RECORD_SCHEMA_VERSION = 1 as const;
export const MAX_SCHEDULE_RECORDS = 100;
export const MAX_SCHEDULE_LABEL_LENGTH = 120;
export const MAX_SCHEDULE_ID_LENGTH = 96;
export const SCHEDULE_PRIORITY_MIN = -1000;
export const SCHEDULE_PRIORITY_MAX = 1000;

export const SCHEDULE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type ScheduleWeekday = (typeof SCHEDULE_WEEKDAYS)[number];

/**
 * A source record is deliberately data-only.  Credentials are resolved by the
 * main process from the operating-system vault and can never be represented by
 * this renderer-facing type.
 */
export type PersistedScheduleSource =
  | {
      kind: "local";
      settings: Record<string, unknown>;
    }
  | {
      kind: "api";
      url: string;
      allowLoopbackHttp?: boolean;
    }
  | {
      kind: "home-assistant";
      baseUrl: string;
      entityId: string;
      settings: Record<string, unknown>;
    };

export interface ScheduledSettingsRecord {
  schemaVersion: typeof SCHEDULE_RECORD_SCHEMA_VERSION;
  id: string;
  label: string;
  enabled: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  startTime: string;
  endTime: string;
  weekdays: ScheduleWeekday[];
  timezone: string;
  source: PersistedScheduleSource;
}

export interface ScheduleRecordValidationOptions {
  /** HTTP is allowed only for an explicitly bounded loopback development route. */
  allowLoopbackHttp?: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const TIMEZONE_FALLBACK = "UTC";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeysMatch(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  const allowed = new Set(expected);
  return keys.length === expected.length && keys.every((key) => typeof key === "string" && allowed.has(key));
}

function normalizeBoundedText(value: unknown, maxLength: number, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 96 || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isWeekday(value: unknown): value is ScheduleWeekday {
  return typeof value === "string" && (SCHEDULE_WEEKDAYS as readonly string[]).includes(value);
}

function validateSourceShape(source: unknown, options: ScheduleRecordValidationOptions): PersistedScheduleSource {
  if (!isRecord(source) || typeof source.kind !== "string") throw new Error("Invalid schedule source");
  if (source.kind === "local") {
    if (!ownKeysMatch(source, ["kind", "settings"]) || !isRecord(source.settings)) throw new Error("Invalid local schedule source");
    return { kind: "local", settings: { ...source.settings } };
  }
  if (source.kind === "api") {
    if (!ownKeysMatch(source, ["kind", "url"]) && !ownKeysMatch(source, ["kind", "url", "allowLoopbackHttp"])) {
      throw new Error("Invalid API schedule source");
    }
    if (typeof source.url !== "string" || source.url.length === 0 || source.url.length > 2_048) {
      throw new Error("Invalid API schedule URL");
    }
    let parsed: URL;
    try {
      parsed = new URL(source.url);
    } catch {
      throw new Error("Invalid API schedule URL");
    }
    const loopback = source.allowLoopbackHttp === true;
    const isLoopbackHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname || (parsed.protocol !== "https:" && !(loopback && isLoopbackHost && parsed.protocol === "http:"))) {
      throw new Error("Schedule source URL must be credential-free HTTPS or bounded loopback HTTP");
    }
    return { kind: "api", url: source.url, ...(loopback ? { allowLoopbackHttp: true } : {}) };
  }
  if (source.kind === "home-assistant") {
    if (!ownKeysMatch(source, ["kind", "baseUrl", "entityId", "settings"]) || !isRecord(source.settings)) {
      throw new Error("Invalid Home Assistant schedule source");
    }
    if (typeof source.baseUrl !== "string" || source.baseUrl.length === 0 || source.baseUrl.length > 2_048) {
      throw new Error("Invalid Home Assistant base URL");
    }
    let parsed: URL;
    try {
      parsed = new URL(source.baseUrl);
    } catch {
      throw new Error("Invalid Home Assistant base URL");
    }
    const loopback = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1");
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname || (parsed.protocol !== "https:" && !loopback)) {
      throw new Error("Home Assistant URL must be credential-free HTTPS or loopback HTTP");
    }
    if (typeof source.entityId !== "string" || !/^(?:binary_sensor|input_boolean)\.[a-z0-9_]+$/u.test(source.entityId)) {
      throw new Error("Home Assistant source requires a boolean entity");
    }
    // An explicit token/accessToken property is rejected by ownKeysMatch above;
    // this keeps credential material outside persisted records by construction.
    void options;
    return { kind: "home-assistant", baseUrl: source.baseUrl, entityId: source.entityId, settings: { ...source.settings } };
  }
  throw new Error("Unknown schedule source kind");
}

export function validateScheduledSettingsRecord(
  value: unknown,
  options: ScheduleRecordValidationOptions = {},
): ScheduledSettingsRecord {
  if (!isRecord(value)) throw new Error("Invalid scheduled settings record");
  const expected = ["schemaVersion", "id", "label", "enabled", "priority", "startDate", "endDate", "startTime", "endTime", "weekdays", "timezone", "source"] as const;
  if (!ownKeysMatch(value, expected)) throw new Error("Invalid scheduled settings record shape");
  if (value.schemaVersion !== SCHEDULE_RECORD_SCHEMA_VERSION || typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw new Error("Invalid scheduled settings record identity");
  }
  if (typeof value.label !== "string" || normalizeBoundedText(value.label, MAX_SCHEDULE_LABEL_LENGTH, "") !== value.label || value.label.length === 0) {
    throw new Error("Invalid scheduled settings label");
  }
  if (typeof value.enabled !== "boolean" || typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < SCHEDULE_PRIORITY_MIN || value.priority > SCHEDULE_PRIORITY_MAX) {
    throw new Error("Invalid scheduled settings priority or enabled state");
  }
  if (value.startDate !== null && !isValidDate(value.startDate)) throw new Error("Invalid schedule start date");
  if (value.endDate !== null && !isValidDate(value.endDate)) throw new Error("Invalid schedule end date");
  if (value.startDate !== null && value.endDate !== null && value.startDate > value.endDate) throw new Error("Schedule start date must not be after end date");
  if (!isValidTime(value.startTime) || !isValidTime(value.endTime)) throw new Error("Invalid schedule time");
  if (!Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.length > SCHEDULE_WEEKDAYS.length || !value.weekdays.every(isWeekday) || new Set(value.weekdays).size !== value.weekdays.length) {
    throw new Error("Schedule must select at least one unique weekday");
  }
  if (!isValidTimezone(value.timezone)) throw new Error("Invalid schedule timezone");
  return {
    schemaVersion: SCHEDULE_RECORD_SCHEMA_VERSION,
    id: value.id,
    label: value.label,
    enabled: value.enabled,
    priority: value.priority,
    startDate: value.startDate,
    endDate: value.endDate,
    startTime: value.startTime,
    endTime: value.endTime,
    weekdays: [...value.weekdays],
    timezone: value.timezone,
    source: validateSourceShape(value.source, options),
  };
}

export function validateScheduledSettingsRecords(value: unknown, options: ScheduleRecordValidationOptions = {}): ScheduledSettingsRecord[] {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULE_RECORDS) throw new Error("Invalid scheduled settings records");
  const records = value.map((record) => validateScheduledSettingsRecord(record, options));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error("Scheduled settings record identifiers must be unique");
  return records;
}

export function isScheduledSettingsRecord(value: unknown): value is ScheduledSettingsRecord {
  try {
    validateScheduledSettingsRecord(value);
    return true;
  } catch {
    return false;
  }
}

export function isScheduledSettingsRecords(value: unknown): value is ScheduledSettingsRecord[] {
  try {
    validateScheduledSettingsRecords(value);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY_INDEX: Record<ScheduleWeekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

function localDateTime(now: Date, timezone: string): { date: string; time: string; weekday: ScheduleWeekday } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(values.weekday ?? "").toLowerCase() as ScheduleWeekday;
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday,
  };
}

function dateIsInRange(date: string, startDate: string | null, endDate: string | null): boolean {
  return (startDate === null || date >= startDate) && (endDate === null || date <= endDate);
}

export function isScheduledSettingsRecordActive(record: ScheduledSettingsRecord, now = new Date()): boolean {
  if (!record.enabled) return false;
  const current = localDateTime(now, record.timezone);
  const weekdays = new Set(record.weekdays);
  const normalWindow = record.startTime <= record.endTime;
  if (normalWindow) {
    return weekdays.has(current.weekday) && dateIsInRange(current.date, record.startDate, record.endDate) && current.time >= record.startTime && current.time <= record.endTime;
  }
  const prior = SCHEDULE_WEEKDAYS.find((candidate) => WEEKDAY_INDEX[candidate] === ((WEEKDAY_INDEX[current.weekday] + 6) % 7));
  return (
    (weekdays.has(current.weekday) && current.time >= record.startTime && dateIsInRange(current.date, record.startDate, record.endDate)) ||
    (prior !== undefined && weekdays.has(prior) && current.time <= record.endTime && dateIsInRange(current.date, record.startDate, record.endDate))
  );
}

/** Highest priority wins; an id tie-breaker makes equal-priority records stable. */
export function selectScheduledSettingsRecords(records: readonly ScheduledSettingsRecord[], now = new Date()): ScheduledSettingsRecord[] {
  return records
    .filter((record) => isScheduledSettingsRecordActive(record, now))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export function resolveScheduledSettings<T extends Record<string, unknown>>(
  base: T,
  records: readonly ScheduledSettingsRecord[],
  now = new Date(),
): T {
  const matching = selectScheduledSettingsRecords(records, now);
  if (matching.length === 0) return { ...base };
  const overrides = [...matching].reverse().reduce<Record<string, unknown>>((merged, record) => {
    if (record.source.kind !== "api") Object.assign(merged, record.source.settings);
    return merged;
  }, {});
  return { ...base, ...overrides };
}

export function createDefaultScheduledSettingsRecord(timezone = TIMEZONE_FALLBACK): ScheduledSettingsRecord {
  return {
    schemaVersion: SCHEDULE_RECORD_SCHEMA_VERSION,
    id: `schedule-${Math.random().toString(36).slice(2, 10)}`,
    label: "New schedule",
    enabled: true,
    priority: 0,
    startDate: null,
    endDate: null,
    startTime: "09:00",
    endTime: "17:00",
    weekdays: [...SCHEDULE_WEEKDAYS],
    timezone: isValidTimezone(timezone) ? timezone : TIMEZONE_FALLBACK,
    source: { kind: "local", settings: { theme: "dark" } },
  };
}
