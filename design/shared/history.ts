import { validateRegexPattern } from "./regex";

export const HISTORY_SCHEMA_VERSION = 1 as const;
export const HISTORY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "restored",
  "undone",
  "discarded",
  "imported",
  "settings-changed",
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface HistoryRevision {
  id: string;
  action: HistoryAction;
  summary: string;
  timestamp: string;
}

export interface HistoryFilter {
  from?: number;
  to?: number;
  actions?: HistoryAction[];
  text?: string;
  regex?: boolean;
  flags?: string;
}

export interface HistoryFilterRequest {
  from: number | null;
  to: number | null;
  actions: HistoryAction[];
  text: string;
  regex: boolean;
  flags: string;
}

export interface HistoryView {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  available: boolean;
  revisions: HistoryRevision[];
  actionCounts: Record<string, number>;
  totalRevisions: number;
  matchingRevisions: number;
  request: HistoryFilterRequest;
  emptyReason: string | null;
}

const MAX_FILTER_TEXT = 2_048;
const MAX_FLAGS = 6;
const MAX_ACTIONS = HISTORY_ACTIONS.length;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHistoryAction(value: unknown): value is HistoryAction {
  return typeof value === "string" && (HISTORY_ACTIONS as readonly string[]).includes(value);
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field}`);
  return value;
}

/** Normalize and bound the renderer-to-main history filter at the IPC edge. */
export function normalizeHistoryFilter(value: unknown): HistoryFilter {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("Invalid history filter");

  const from = optionalTimestamp(value.from, "history start timestamp");
  const to = optionalTimestamp(value.to, "history end timestamp");
  if (from !== undefined && to !== undefined && from > to) {
    throw new Error("History start timestamp must not be after end timestamp");
  }

  const actionsValue = value.actions === undefined || value.actions === null ? [] : value.actions;
  if (!Array.isArray(actionsValue) || actionsValue.length > MAX_ACTIONS || actionsValue.some((action) => !isHistoryAction(action))) {
    throw new Error("Invalid history actions");
  }
  const actions = [...new Set(actionsValue as HistoryAction[])];

  const text = value.text === undefined || value.text === null ? "" : value.text;
  if (typeof text !== "string" || text.length > MAX_FILTER_TEXT) throw new Error("Invalid history search");
  const regex = value.regex === undefined ? false : value.regex;
  if (typeof regex !== "boolean") throw new Error("Invalid history search mode");
  const flags = value.flags === undefined || value.flags === null ? "g" : value.flags;
  if (typeof flags !== "string" || flags.length > MAX_FLAGS || validateRegexPattern(regex ? text : "", flags)) {
    throw new Error("Invalid history regular expression");
  }

  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(actions.length === 0 ? {} : { actions }),
    ...(text.length === 0 ? {} : { text }),
    regex,
    flags,
  };
}

export function historyFilterRequest(filter: HistoryFilter): HistoryFilterRequest {
  return {
    from: filter.from ?? null,
    to: filter.to ?? null,
    actions: [...(filter.actions ?? [])],
    text: filter.text ?? "",
    regex: filter.regex === true,
    flags: filter.flags ?? "g",
  };
}

export function isHistoryRevision(value: unknown): value is HistoryRevision {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 64 &&
    isHistoryAction(value.action) && typeof value.summary === "string" && value.summary.length <= 1_024 &&
    typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp));
}

export function isHistoryView(value: unknown): value is HistoryView {
  if (!isRecord(value) || value.schemaVersion !== HISTORY_SCHEMA_VERSION || typeof value.available !== "boolean" ||
    !Array.isArray(value.revisions) || !isRecord(value.actionCounts) || typeof value.totalRevisions !== "number" ||
    typeof value.matchingRevisions !== "number" || !isRecord(value.request) ||
    (value.emptyReason !== null && typeof value.emptyReason !== "string")) return false;
  if (!Number.isInteger(value.totalRevisions) || value.totalRevisions < 0 ||
    !Number.isInteger(value.matchingRevisions) || value.matchingRevisions < 0 ||
    value.matchingRevisions > value.totalRevisions || value.revisions.length !== value.matchingRevisions) return false;
  if (!isHistoryFilterRequest(value.request)) return false;
  return value.revisions.every(isHistoryRevision) && Object.entries(value.actionCounts).every(([action, count]) =>
    isHistoryAction(action) && typeof count === "number" && Number.isInteger(count) && count >= 0
  );
}

function isHistoryFilterRequest(value: Record<string, unknown>): value is Record<string, unknown> & HistoryFilterRequest {
  return (value.from === null || typeof value.from === "number") && (value.to === null || typeof value.to === "number") &&
    Array.isArray(value.actions) && value.actions.every(isHistoryAction) && typeof value.text === "string" &&
    typeof value.regex === "boolean" && typeof value.flags === "string";
}
