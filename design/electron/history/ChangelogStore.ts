import { evaluateRegex, validateRegexPattern } from "../../shared/regex";
import { exportRecords, isExportFormat, type ExportFormat, type ExportResult } from "../../shared/export";

export const CHANGELOG_SCHEMA_VERSION = 1 as const;
export const CHANGELOG_IPC_CHANNELS = {
  GET_VIEW: "changelog:getView",
  EXPORT_VIEW: "changelog:exportView",
} as const;

const MAX_ENTRIES = 512;
const MAX_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 128;
const MAX_TITLE_LENGTH = 512;
const MAX_CHANGE_LENGTH = 4_096;
const MAX_SEARCH_LENGTH = 2_048;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ChangelogCategory = string;

export interface ChangelogChange {
  category: ChangelogCategory;
  text: string;
}

/** Source data is factual and contains no derived forge URL or renderer markup. */
export interface ChangelogEntry {
  id: string;
  version: string;
  releaseDate: string;
  title: string;
  changes: ChangelogChange[];
  commitSha: string;
}

export interface ChangelogViewEntry extends ChangelogEntry {
  commitUrl: string;
}

export interface ChangelogViewRequest {
  search: string;
  regex: boolean;
  flags: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface ChangelogView {
  schemaVersion: typeof CHANGELOG_SCHEMA_VERSION;
  entries: ChangelogViewEntry[];
  totalEntries: number;
  matchingEntries: number;
  request: ChangelogViewRequest;
  emptyReason: string | null;
}

function isSafeCommitUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      /\/commit\/[0-9a-f]{40}$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Runtime response guard for a future preload bridge to validate IPC data. */
export function isChangelogView(value: unknown): value is ChangelogView {
  if (!isRecord(value) || value.schemaVersion !== CHANGELOG_SCHEMA_VERSION ||
    typeof value.totalEntries !== "number" || typeof value.matchingEntries !== "number" ||
    !Array.isArray(value.entries) || !isRecord(value.request) ||
    (value.emptyReason !== null && typeof value.emptyReason !== "string")) {
    return false;
  }
  if (value.totalEntries < 0 || value.matchingEntries < 0 || value.matchingEntries > value.totalEntries || value.entries.length !== value.matchingEntries) {
    return false;
  }
  if (typeof value.request.search !== "string" || typeof value.request.regex !== "boolean" ||
    typeof value.request.flags !== "string" ||
    (value.request.dateFrom !== null && typeof value.request.dateFrom !== "string") ||
    (value.request.dateTo !== null && typeof value.request.dateTo !== "string")) {
    return false;
  }
  return value.entries.every((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.version !== "string" ||
      typeof entry.releaseDate !== "string" || !ISO_DATE.test(entry.releaseDate) ||
      typeof entry.title !== "string" || !Array.isArray(entry.changes) ||
      typeof entry.commitSha !== "string" || !COMMIT_SHA.test(entry.commitSha) ||
      !isSafeCommitUrl(entry.commitUrl)) return false;
    return entry.changes.every((change) => isRecord(change) && typeof change.category === "string" && typeof change.text === "string");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBoundedString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertIsoDate(value: unknown, field: string): asserts value is string {
  assertBoundedString(value, field, 10);
  if (!ISO_DATE.test(value)) throw new Error(`Invalid ${field}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${field}`);
}

function parseChange(value: unknown, index: number): ChangelogChange {
  if (!isRecord(value)) throw new Error(`Invalid changelog change ${index}`);
  assertBoundedString(value.category, `changelog change ${index} category`, 64);
  assertBoundedString(value.text, `changelog change ${index} text`, MAX_CHANGE_LENGTH);
  return { category: value.category, text: value.text };
}

function parseEntry(value: unknown, index: number): ChangelogEntry {
  if (!isRecord(value)) throw new Error(`Invalid changelog entry ${index}`);
  assertBoundedString(value.id, `changelog entry ${index} id`, MAX_ID_LENGTH);
  assertBoundedString(value.version, `changelog entry ${index} version`, MAX_VERSION_LENGTH);
  assertIsoDate(value.releaseDate, `changelog entry ${index} release date`);
  assertBoundedString(value.title, `changelog entry ${index} title`, MAX_TITLE_LENGTH);
  if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 64) {
    throw new Error(`Invalid changelog entry ${index} changes`);
  }
  assertBoundedString(value.commitSha, `changelog entry ${index} commit SHA`, 40);
  if (!COMMIT_SHA.test(value.commitSha)) throw new Error(`Invalid changelog entry ${index} commit SHA`);
  return {
    id: value.id,
    version: value.version,
    releaseDate: value.releaseDate,
    title: value.title,
    changes: value.changes.map(parseChange),
    commitSha: value.commitSha.toLowerCase(),
  };
}

export function parseChangelogEntries(value: unknown): ChangelogEntry[] {
  const source = isRecord(value) && Array.isArray(value.entries) ? value.entries : value;
  if (!Array.isArray(source) || source.length > MAX_ENTRIES) throw new Error("Invalid changelog entries");
  const ids = new Set<string>();
  return source.map((entry, index) => {
    const parsed = parseEntry(entry, index);
    if (ids.has(parsed.id)) throw new Error(`Duplicate changelog entry id: ${parsed.id}`);
    ids.add(parsed.id);
    return parsed;
  });
}

function normalizeRepositoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid changelog repository URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Changelog repository URL must be credential-free HTTPS");
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Changelog repository URL must identify one repository");
  }
  return `${url.origin}/${parts.join("/")}`;
}

export function normalizeChangelogViewRequest(value: unknown): ChangelogViewRequest {
  if (value === undefined || value === null) {
    return { search: "", regex: false, flags: "", dateFrom: null, dateTo: null };
  }
  if (!isRecord(value)) throw new Error("Invalid changelog view request");
  const search = value.search === undefined ? "" : value.search;
  if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH) throw new Error("Invalid changelog search");
  const regex = value.regex === undefined ? false : value.regex;
  if (typeof regex !== "boolean") throw new Error("Invalid changelog search mode");
  const flags = value.flags === undefined ? "" : value.flags;
  if (typeof flags !== "string" || flags.length > 6) throw new Error("Invalid changelog regex flags");
  if (validateRegexPattern(regex ? search : "", flags)) {
    throw new Error("Invalid changelog regular expression");
  }
  const dateFrom = value.dateFrom === undefined || value.dateFrom === null ? null : value.dateFrom;
  const dateTo = value.dateTo === undefined || value.dateTo === null ? null : value.dateTo;
  if (dateFrom !== null) assertIsoDate(dateFrom, "changelog start date");
  if (dateTo !== null) assertIsoDate(dateTo, "changelog end date");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Changelog start date must not be after end date");
  return { search, regex, flags, dateFrom, dateTo };
}

function entrySearchText(entry: ChangelogEntry): string {
  return [
    entry.id,
    entry.version,
    entry.releaseDate,
    entry.title,
    ...entry.changes.flatMap((change) => [change.category, change.text]),
  ].join(" ");
}

function matches(entry: ChangelogEntry, request: ChangelogViewRequest): boolean {
  if (request.dateFrom && entry.releaseDate < request.dateFrom) return false;
  if (request.dateTo && entry.releaseDate > request.dateTo) return false;
  if (!request.search) return true;
  const haystack = entrySearchText(entry);
  if (!request.regex) return haystack.toLocaleLowerCase().includes(request.search.toLocaleLowerCase());
  const result = evaluateRegex(request.search, request.flags || "gi", haystack);
  return !result.error && result.matches.length > 0;
}

function cloneEntry(entry: ChangelogEntry, repositoryUrl: string): ChangelogViewEntry {
  return {
    ...entry,
    changes: entry.changes.map((change) => ({ ...change })),
    commitUrl: `${repositoryUrl}/commit/${entry.commitSha}`,
  };
}

export class ChangelogStore {
  private readonly entries: ChangelogEntry[];
  private readonly repositoryUrl: string;

  constructor(entries: unknown, repositoryUrl: string) {
    this.entries = parseChangelogEntries(entries);
    this.repositoryUrl = normalizeRepositoryUrl(repositoryUrl);
  }

  getEntries(): ChangelogViewEntry[] {
    return this.entries.map((entry) => cloneEntry(entry, this.repositoryUrl));
  }

  getView(request: unknown = undefined): ChangelogView {
    const normalized = normalizeChangelogViewRequest(request);
    const entries = this.entries.filter((entry) => matches(entry, normalized));
    return {
      schemaVersion: CHANGELOG_SCHEMA_VERSION,
      entries: entries.map((entry) => cloneEntry(entry, this.repositoryUrl)),
      totalEntries: this.entries.length,
      matchingEntries: entries.length,
      request: normalized,
      emptyReason: entries.length === 0
        ? normalized.search || normalized.dateFrom || normalized.dateTo
          ? "No changelog entries match the active search or date filter."
          : "No changelog entries are available."
        : null,
    };
  }

  exportView(format: ExportFormat, request: unknown = undefined): ExportResult {
    if (!isExportFormat(format)) throw new Error("Invalid changelog export format");
    const view = this.getView(request);
    return exportRecords(view.entries.map((entry) => ({
      id: entry.id,
      version: entry.version,
      releaseDate: entry.releaseDate,
      title: entry.title,
      changes: entry.changes,
      commitSha: entry.commitSha,
      commitUrl: entry.commitUrl,
    })), format);
  }
}

export interface ChangelogIpcHandlers {
  getView(request: unknown): ChangelogView;
  exportView(request: unknown, format: unknown): ExportResult;
}

/**
 * IPC-safe adapter: it accepts only structured, bounded data and returns plain
 * serializable view objects. The main process can register these methods with
 * ipcMain.handle without giving the renderer a store, filesystem, or network
 * capability. No handler performs a network fetch.
 */
export function createChangelogIpcHandlers(store: ChangelogStore): ChangelogIpcHandlers {
  return {
    getView: (request) => store.getView(request),
    exportView: (request, format) => {
      if (!isExportFormat(format)) throw new Error("Invalid changelog export format");
      return store.exportView(format, request);
    },
  };
}
