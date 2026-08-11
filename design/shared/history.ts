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
  "display-name-changed",
  "display-name-reset",
  "labeled",
  "pruned",
] as const;

export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export interface HistoryRevision {
  id: string;
  action: HistoryAction;
  summary: string;
  timestamp: string;
  /** A user-authored label is bounded metadata, never a snapshot value. */
  label?: string;
}

export interface HistoryDiff {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  revisionId: string;
  parentId: string | null;
  patch: string;
  redacted: boolean;
  hasChanges: boolean;
}

export interface HistoryPruneRequest {
  keep: number;
}

export interface HistoryPruneResult {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  requestedKeep: number;
  prunedRevisionIds: string[];
  remainingRevisions: number;
  auditRevision: HistoryRevision | null;
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
  /** Number of physically retained-but-hidden tombstoned revisions. */
  prunedRevisions?: number;
}

export interface HistoryAccessState {
  configured: boolean;
  unlocked: boolean;
}

const MAX_FILTER_TEXT = 2_048;
const MAX_FLAGS = 6;
const MAX_ACTIONS = HISTORY_ACTIONS.length;
export const MAX_HISTORY_LABEL_LENGTH = 120;
export const MAX_HISTORY_RETENTION = 5_000;

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

/** Validate a revision identifier before it reaches Git or a path-like value. */
export function normalizeHistoryRevisionId(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{7,64}$/iu.test(value)) {
    throw new Error("Invalid history revision id");
  }
  return value;
}

/** Normalize the optional label without silently changing user input. */
export function normalizeHistoryLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > MAX_HISTORY_LABEL_LENGTH) {
    throw new Error("Invalid history label");
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid history label");
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return null;
  if (normalized !== value) throw new Error("Invalid history label");
  return normalized;
}

export function normalizeHistoryPruneRequest(value: unknown): HistoryPruneRequest {
  if (!isRecord(value) || typeof value.keep !== "number" || !Number.isSafeInteger(value.keep) ||
    value.keep < 1 || value.keep > MAX_HISTORY_RETENTION) {
    throw new Error(`History retention must be a whole number from 1 to ${MAX_HISTORY_RETENTION}`);
  }
  return { keep: value.keep };
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
    typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp)) &&
    (value.label === undefined || (typeof value.label === "string" && value.label.length <= MAX_HISTORY_LABEL_LENGTH));
}

export function isHistoryDiff(value: unknown): value is HistoryDiff {
  return isRecord(value) && value.schemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof value.revisionId === "string" && /^[\da-f]{7,64}$/iu.test(value.revisionId) &&
    (value.parentId === null || (typeof value.parentId === "string" && /^[\da-f]{7,64}$/iu.test(value.parentId))) &&
    typeof value.patch === "string" && value.patch.length <= 2_000_000 &&
    typeof value.redacted === "boolean" && typeof value.hasChanges === "boolean";
}

export function isHistoryPruneResult(value: unknown): value is HistoryPruneResult {
  return isRecord(value) && value.schemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof value.requestedKeep === "number" && Number.isSafeInteger(value.requestedKeep) &&
    value.requestedKeep >= 1 && value.requestedKeep <= MAX_HISTORY_RETENTION &&
    Array.isArray(value.prunedRevisionIds) && value.prunedRevisionIds.length <= MAX_HISTORY_RETENTION &&
    value.prunedRevisionIds.every((id) => typeof id === "string" && /^[\da-f]{7,64}$/iu.test(id)) &&
    typeof value.remainingRevisions === "number" && Number.isSafeInteger(value.remainingRevisions) && value.remainingRevisions >= 0 &&
    (value.auditRevision === null || isHistoryRevision(value.auditRevision));
}

export function isHistoryView(value: unknown): value is HistoryView {
  if (!isRecord(value) || value.schemaVersion !== HISTORY_SCHEMA_VERSION || typeof value.available !== "boolean" ||
    !Array.isArray(value.revisions) || !isRecord(value.actionCounts) || typeof value.totalRevisions !== "number" ||
    typeof value.matchingRevisions !== "number" || !isRecord(value.request) ||
    (value.emptyReason !== null && typeof value.emptyReason !== "string") ||
    (value.prunedRevisions !== undefined && (typeof value.prunedRevisions !== "number" || !Number.isSafeInteger(value.prunedRevisions) || value.prunedRevisions < 0))) return false;
  if (!Number.isInteger(value.totalRevisions) || value.totalRevisions < 0 ||
    !Number.isInteger(value.matchingRevisions) || value.matchingRevisions < 0 ||
    value.matchingRevisions > value.totalRevisions || value.revisions.length !== value.matchingRevisions) return false;
  if (!isHistoryFilterRequest(value.request)) return false;
  return value.revisions.every(isHistoryRevision) && Object.entries(value.actionCounts).every(([action, count]) =>
    isHistoryAction(action) && typeof count === "number" && Number.isInteger(count) && count >= 0
  );
}

export function isHistoryAccessState(value: unknown): value is HistoryAccessState {
  return isRecord(value) && typeof value.configured === "boolean" && typeof value.unlocked === "boolean";
}

function isHistoryFilterRequest(value: Record<string, unknown>): value is Record<string, unknown> & HistoryFilterRequest {
  const fromValid = value.from === null || (typeof value.from === "number" && Number.isFinite(value.from) && value.from >= 0);
  const toValid = value.to === null || (typeof value.to === "number" && Number.isFinite(value.to) && value.to >= 0);
  const rangeValid = value.from === null || value.to === null ||
    (typeof value.from === "number" && typeof value.to === "number" && value.from <= value.to);
  const textValid = typeof value.text === "string" && value.text.length <= MAX_FILTER_TEXT;
  const flagsValid = typeof value.flags === "string" && value.flags.length <= MAX_FLAGS;
  const regexValid = typeof value.regex === "boolean" &&
    (!value.regex || (textValid && flagsValid && validateRegexPattern(value.text as string, value.flags as string) === null));
  return fromValid && toValid && rangeValid &&
    Array.isArray(value.actions) && value.actions.length <= MAX_ACTIONS && value.actions.every(isHistoryAction) &&
    textValid && flagsValid && regexValid;
}
