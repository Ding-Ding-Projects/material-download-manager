import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportRecords, type ExportFormat, type ExportResult } from "../../shared/export";
import {
  HISTORY_ACTIONS,
  MAX_HISTORY_LABEL_LENGTH,
  MAX_HISTORY_RETENTION,
  type HistoryAction,
  type HistoryDiff,
  type HistoryFilter,
  type HistoryPruneResult,
  type HistoryRevision,
} from "../../shared/history";
import { APP_DISPLAY_NAME_MAX_LENGTH, normalizeAppDisplayName } from "../../shared/settings";
import { evaluateRegexBatchIsolated } from "../regex/RegexWorkerClient";

const execFileAsync = promisify(execFile);

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_PRUNED_IDS = MAX_HISTORY_RETENTION;
const MAX_SUMMARY_LENGTH = 1_024;
const SAFE_REVISION_ID = /^(?:HEAD|[0-9a-f]{7,64})$/i;
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const DISPLAY_NAME_HISTORY_SCHEMA_VERSION = 1 as const;

export type { HistoryAction, HistoryDiff, HistoryFilter, HistoryPruneResult, HistoryRevision } from "../../shared/history";

interface HistoryLabelsRecord {
  schemaVersion: 1;
  labels: Record<string, string>;
}

interface HistoryPrunedRecord {
  schemaVersion: 1;
  revisionIds: string[];
}

export interface HistoryActionCounts {
  [action: string]: number;
}

export interface RedactedDisplayNameMutation {
  schemaVersion: typeof DISPLAY_NAME_HISTORY_SCHEMA_VERSION;
  kind: "display-name";
  previousSha256: string | null;
  nextSha256: string;
}

function isHistoryAction(value: string): value is HistoryAction {
  return (HISTORY_ACTIONS as readonly string[]).includes(value);
}

function cleanSummary(summary: string): string {
  return summary
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY_LENGTH) || "Changed application state";
}

function assertSafeRevisionId(revisionId: string): void {
  if (typeof revisionId !== "string" || !SAFE_REVISION_ID.test(revisionId)) {
    throw new Error("Invalid history revision id");
  }
}

function assertConcreteRevisionId(revisionId: string): void {
  assertSafeRevisionId(revisionId);
  if (revisionId.toUpperCase() === "HEAD") throw new Error("A concrete history revision id is required");
}

function normalizeLabel(label: string | null): string | null {
  if (label === null) return null;
  if (typeof label !== "string" || label.length > MAX_HISTORY_LABEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new Error("Invalid history label");
  }
  const normalized = label.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return null;
  if (normalized !== label) throw new Error("Invalid history label");
  return normalized;
}

function isMetadataObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotByteLength(snapshot: string): number {
  return Buffer.byteLength(snapshot, "utf8");
}

function errorCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" || typeof code === "string" ? code : undefined;
}

function errorStderr(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" ? stderr : "";
}

function isMissingRevision(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 1) return true;
  if (code !== 128) return false;
  return /Needed a single revision|does not have any commits yet|unknown revision|bad object|invalid object name|ambiguous argument/i.test(errorStderr(error));
}

/**
 * Isolated, local-only Git history for the app's serialized user state.
 *
 * The store intentionally has no remote configuration and serializes all
 * writes. Restore, undo, and discard append a new revision; they never move
 * or rewrite an earlier commit. The caller supplies a renderer-safe snapshot
 * (DownloadManager already removes private request headers and URL secrets).
 */
export class HistoryStore {
  readonly repositoryPath: string;
  private readonly disabledHooksPath: string;
  private initialization: Promise<void> | null = null;
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly evaluateRegexBatch = evaluateRegexBatchIsolated
  ) {
    this.repositoryPath = path.join(path.resolve(userDataPath), "local-history");
    // Keep hooks outside the history checkout and point Git at a fresh path
    // that the app never creates. This also blocks post-commit hooks, which
    // --no-verify alone does not disable.
    this.disabledHooksPath = path.join(path.dirname(this.repositoryPath), `history-hooks-${randomUUID()}`);
  }

  private async git(args: string[], trim = true): Promise<string> {
    const result = await execFileAsync("git", [
      "--no-pager",
      "-c",
      `core.hooksPath=${this.disabledHooksPath}`,
      "-c",
      "commit.gpgSign=false",
      ...args,
    ], {
      cwd: this.repositoryPath,
      encoding: "utf8",
      maxBuffer: MAX_SNAPSHOT_BYTES * 2,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return trim ? result.stdout.trim() : result.stdout;
  }

  private async initialize(): Promise<void> {
    await fsp.mkdir(this.repositoryPath, { recursive: true });
    try {
      await fsp.access(path.join(this.repositoryPath, ".git"));
    } catch {
      await this.git(["init", "--quiet"]);
    }
    await this.git(["config", "user.name", "Material Download Manager History"]);
    await this.git(["config", "user.email", "history@localhost"]);
    await this.git(["config", "core.autocrlf", "false"]);

    // A local history repository must never become a transport for user data.
    // Refuse a pre-existing or tampered history directory with a remote rather
    // than silently deleting configuration that somebody may need to inspect.
    const remotes = await this.git(["remote"]);
    if (remotes.length > 0) throw new Error("Local history repository must not have Git remotes");
  }

  private async ensureInitialized(): Promise<void> {
    const pending = this.initialization ?? (this.initialization = this.initialize());
    try {
      await pending;
    } catch (error) {
      // A transient Git/filesystem timeout must not permanently poison this
      // store instance; the next operation gets a bounded retry.
      if (this.initialization === pending) this.initialization = null;
      throw error;
    }
  }

  /** True only when the local history repository can be opened and queried. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      await this.git(["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationChain.then(operation, operation);
    this.mutationChain = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Wait for every queued Git mutation before an owner tears down its data path. */
  async flush(): Promise<void> {
    await this.initialization?.catch(() => undefined);
    await this.mutationChain.catch(() => undefined);
  }

  private async writeSnapshot(fileName: string, snapshot: string): Promise<void> {
    const snapshotPath = path.join(this.repositoryPath, fileName);
    const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporaryPath, snapshot, "utf8");
    try {
      await fsp.rename(temporaryPath, snapshotPath);
    } finally {
      await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async readWorkingMetadata(fileName: string): Promise<string | null> {
    try {
      const value = await fsp.readFile(path.join(this.repositoryPath, fileName), "utf8");
      if (Buffer.byteLength(value, "utf8") > MAX_HISTORY_METADATA_BYTES) {
        throw new Error(`History metadata exceeds the ${MAX_HISTORY_METADATA_BYTES}-byte limit`);
      }
      return value;
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") return null;
      throw error;
    }
  }

  private async readLabels(): Promise<Record<string, string>> {
    const raw = await this.readWorkingMetadata("labels.json");
    if (raw === null) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("History labels metadata is corrupt");
    }
    if (!isMetadataObject(parsed) || parsed.schemaVersion !== 1 || !isMetadataObject(parsed.labels)) {
      throw new Error("History labels metadata is corrupt");
    }
    const labels: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed.labels)) {
      if (!SAFE_REVISION_ID.test(id) || id.toUpperCase() === "HEAD" || typeof value !== "string") {
        throw new Error("History labels metadata is corrupt");
      }
      const label = normalizeLabel(value);
      if (label !== null) labels[id.toLowerCase()] = label;
    }
    return labels;
  }

  private async readPrunedIds(): Promise<Set<string>> {
    const raw = await this.readWorkingMetadata("pruned.json");
    if (raw === null) return new Set();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("History retention metadata is corrupt");
    }
    if (!isMetadataObject(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.revisionIds) || parsed.revisionIds.length > MAX_PRUNED_IDS) {
      throw new Error("History retention metadata is corrupt");
    }
    const ids = new Set<string>();
    for (const value of parsed.revisionIds) {
      if (typeof value !== "string" || !SAFE_REVISION_ID.test(value) || value.toUpperCase() === "HEAD") {
        throw new Error("History retention metadata is corrupt");
      }
      ids.add(value.toLowerCase());
    }
    return ids;
  }

  private async writeLabels(labels: Record<string, string>): Promise<string> {
    const entries = Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_PRUNED_IDS)
      .reduce<Record<string, string>>((result, [id, label]) => {
        result[id] = normalizeLabel(label)!;
        return result;
      }, {});
    const record: HistoryLabelsRecord = { schemaVersion: 1, labels: entries };
    return JSON.stringify(record, null, 2);
  }

  private writePrunedIds(ids: Set<string>): string {
    const record: HistoryPrunedRecord = {
      schemaVersion: 1,
      revisionIds: [...ids].sort().slice(0, MAX_PRUNED_IDS),
    };
    return JSON.stringify(record, null, 2);
  }

  private async appendFileSnapshot(
    fileName: string,
    snapshot: string,
    action: HistoryAction,
    summary: string,
    force = false,
  ): Promise<HistoryRevision | null> {
    if (typeof snapshot !== "string" || snapshotByteLength(snapshot) > MAX_SNAPSHOT_BYTES) {
      throw new Error(`History snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit`);
    }
    if (!isHistoryAction(action)) throw new Error("Invalid history action");

    await this.ensureInitialized();
    return this.enqueueMutation(async () => {
      const snapshotPath = path.join(this.repositoryPath, fileName);
      let previous: string | null = null;
      try {
        previous = await fsp.readFile(snapshotPath, "utf8");
      } catch {
        // The first revision has no previous working snapshot.
      }
      if (previous === snapshot && !force) return null;

      await this.writeSnapshot(fileName, snapshot);
      const subject = `history: ${action} — ${cleanSummary(summary)}`;
      try {
        // --only commits this path from the working tree and preserves any
        // unrelated staged entries in the isolated repository's index.
        await this.git(["add", "--", fileName]);
        await this.git(["commit", "--quiet", "--no-verify", "--only", ...(force ? ["--allow-empty"] : []), "-m", subject, "--", fileName]);
      } catch (error) {
        // Keep a failed write recoverable and do not leave an uncommitted
        // replacement masquerading as the current committed state.
        if (previous === null) await fsp.rm(snapshotPath, { force: true }).catch(() => undefined);
        else await this.writeSnapshot(fileName, previous).catch(() => undefined);
        throw error;
      }

      const id = await this.git(["rev-parse", "HEAD"]);
      const timestamp = await this.git(["show", "-s", "--format=%aI", id]);
      return { id, action, summary: cleanSummary(summary), timestamp };
    });
  }

  async appendSnapshot(
    snapshot: string,
    action: HistoryAction,
    summary: string,
    force = false,
  ): Promise<HistoryRevision | null> {
    return this.appendFileSnapshot("snapshot.json", snapshot, action, summary, force);
  }

  /**
   * Record only hashes for a display-name mutation. The name itself never
   * enters the Git history, so the record is useful for audit/counting while
   * remaining redacted and free of user-authored text.
   */
  async appendDisplayNameMutation(
    previousName: string | null,
    nextName: string,
    action: Extract<HistoryAction, "display-name-changed" | "display-name-reset">,
  ): Promise<HistoryRevision> {
    const normalizedNext = normalizeAppDisplayName(nextName);
    if (normalizedNext !== nextName || normalizedNext.length > APP_DISPLAY_NAME_MAX_LENGTH) {
      throw new Error("Invalid display name history value");
    }
    const normalizedPrevious = previousName === null ? null : normalizeAppDisplayName(previousName);
    if (normalizedPrevious !== null && normalizedPrevious !== previousName) {
      throw new Error("Invalid previous display name history value");
    }
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    const record: RedactedDisplayNameMutation = {
      schemaVersion: DISPLAY_NAME_HISTORY_SCHEMA_VERSION,
      kind: "display-name",
      previousSha256: normalizedPrevious === null ? null : digest(normalizedPrevious),
      nextSha256: digest(normalizedNext),
    };
    const revision = await this.appendFileSnapshot(
      "display-name.json",
      JSON.stringify(record, null, 2),
      action,
      action === "display-name-reset" ? "Reset the application display name" : "Changed the application display name",
      true,
    );
    if (!revision) throw new Error("Display-name history did not create a revision");
    return revision;
  }

  /** Serialize an arbitrary JSON-compatible state envelope before appending it. */
  async appendState(state: unknown, action: HistoryAction, summary: string, force = false) {
    let snapshot: string;
    try {
      snapshot = JSON.stringify(state, null, 2);
    } catch {
      throw new Error("History state is not serializable");
    }
    if (snapshot === undefined) throw new Error("History state is not serializable");
    return this.appendSnapshot(snapshot, action, summary, force);
  }

  private async listAllRevisions(filter: HistoryFilter = {}): Promise<HistoryRevision[]> {
    await this.ensureInitialized();
    try {
      await this.git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    } catch (error) {
      if (isMissingRevision(error)) return [];
      throw error;
    }
    const log = await this.git(["log", "--format=%H%x09%aI%x09%s"]);

    const labels = await this.readLabels();
    const revisions = log.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [id, timestamp, subject] = line.split("\t");
      if (!id || !timestamp || !subject?.startsWith("history: ")) return [];
      const body = subject.slice("history: ".length);
      const separator = body.indexOf(" — ");
      const actionText = separator === -1 ? body : body.slice(0, separator);
      if (!isHistoryAction(actionText)) return [];
      const summary = separator === -1 ? actionText : body.slice(separator + 3) || actionText;
      const time = Date.parse(timestamp);
      if (!Number.isFinite(time)) return [];
      if (filter.from !== undefined && time < filter.from) return [];
      if (filter.to !== undefined && time > filter.to) return [];
      if (filter.actions?.length && !filter.actions.includes(actionText)) return [];
      if (filter.text) {
        const haystack = `${actionText} ${summary}`;
        if (!filter.regex && !haystack.toLocaleLowerCase().includes(filter.text.toLocaleLowerCase())) {
          return [];
        }
      }
      const label = labels[id.toLowerCase()];
      return [{ id, action: actionText, summary, timestamp, ...(label === undefined ? {} : { label }) }];
    });
    if (!filter.text || !filter.regex || revisions.length === 0) return revisions;
    const evaluations = await this.evaluateRegexBatch(
      filter.text,
      filter.flags ?? "gi",
      revisions.map((revision) => `${revision.action} ${revision.summary}`)
    );
    const evaluationError = evaluations.find((evaluation) => evaluation.error)?.error;
    if (evaluationError) throw new Error(`History regular expression evaluation failed: ${evaluationError}`);
    return revisions.filter((_, index) => (evaluations[index]?.matches.length ?? 0) > 0);
  }

  async listRevisions(filter: HistoryFilter = {}, options: { includePruned?: boolean } = {}): Promise<HistoryRevision[]> {
    const revisions = await this.listAllRevisions(filter);
    if (options.includePruned) return revisions;
    const pruned = await this.readPrunedIds();
    return revisions.filter((revision) => !pruned.has(revision.id.toLowerCase()));
  }

  async prunedCount(): Promise<number> {
    await this.ensureInitialized();
    return (await this.readPrunedIds()).size;
  }

  /** Counts only actions actually present in history; empty hard-coded buckets are omitted. */
  async actionCounts(filter: HistoryFilter = {}): Promise<HistoryActionCounts> {
    const counts: HistoryActionCounts = {};
    for (const revision of await this.listRevisions(filter)) {
      counts[revision.action] = (counts[revision.action] ?? 0) + 1;
    }
    return counts;
  }

  async readSnapshot(revisionId = "HEAD"): Promise<string | null> {
    assertSafeRevisionId(revisionId);
    await this.ensureInitialized();
    try {
      return await this.git(["show", `${revisionId}:snapshot.json`], false);
    } catch (error) {
      if (isMissingRevision(error)) return null;
      throw error;
    }
  }

  /** Record the pre-discard state before the caller closes or replaces it. */
  async discard(snapshot: string, summary = "Discarded unsaved state"): Promise<HistoryRevision | null> {
    return this.appendSnapshot(snapshot, "discarded", summary, true);
  }

  /** Explicit alias for close flows that need the audit point to be obvious. */
  async recordDiscard(snapshot: string, summary = "Discarded unsaved state"): Promise<HistoryRevision | null> {
    return this.discard(snapshot, summary);
  }

  async restore(revisionId: string): Promise<HistoryRevision | null> {
    assertSafeRevisionId(revisionId);
    const snapshot = await this.readSnapshot(revisionId);
    if (snapshot === null) return null;
    return this.appendSnapshot(snapshot, "restored", `Restored revision ${revisionId.slice(0, 8)}`, true);
  }

  async undo(revisionId: string): Promise<HistoryRevision | null> {
    assertSafeRevisionId(revisionId);
    const snapshot = await this.readSnapshot(revisionId);
    if (snapshot === null) return null;
    return this.appendSnapshot(snapshot, "undone", `Undid revision ${revisionId.slice(0, 8)}`, true);
  }

  async setLabel(revisionId: string, label: string | null): Promise<HistoryRevision | null> {
    assertConcreteRevisionId(revisionId);
    const normalizedLabel = normalizeLabel(label);
    const revisions = await this.listAllRevisions();
    const target = revisions.find((revision) => revision.id.toLowerCase() === revisionId.toLowerCase());
    if (!target) throw new Error("Unknown history revision");
    const labels = await this.readLabels();
    const key = target.id.toLowerCase();
    if (normalizedLabel === null) delete labels[key];
    else labels[key] = normalizedLabel;
    const snapshot = await this.writeLabels(labels);
    const revision = await this.appendFileSnapshot(
      "labels.json",
      snapshot,
      "labeled",
      `Updated label for revision ${target.id.slice(0, 8)}`,
      true,
    );
    if (!revision) throw new Error("History label did not create a revision");
    return revision;
  }

  /**
   * Mark older revisions as pruned without rewriting or deleting any Git
   * commit. The tombstone is itself an append-only revision, so the user can
   * audit exactly what was hidden by retention.
   */
  async prune(keep: number): Promise<HistoryPruneResult> {
    if (!Number.isSafeInteger(keep) || keep < 1 || keep > MAX_HISTORY_RETENTION) {
      throw new Error(`History retention must be a whole number from 1 to ${MAX_HISTORY_RETENTION}`);
    }
    const all = await this.listAllRevisions();
    const existingPruned = await this.readPrunedIds();
    const visible = all.filter((revision) => !existingPruned.has(revision.id.toLowerCase()));
    // Administrative audit entries are never retention candidates: hiding a
    // label/prune action would make the retention decision itself disappear
    // from the visible audit trail. Only state revisions are bounded here.
    const stateRevisions = visible.filter((revision) =>
      revision.action !== "labeled" && revision.action !== "pruned" &&
      revision.action !== "display-name-changed" && revision.action !== "display-name-reset"
    );
    const candidates = stateRevisions.slice(keep).map((revision) => revision.id.toLowerCase());
    if (candidates.length === 0) {
      return {
        schemaVersion: 1,
        requestedKeep: keep,
        prunedRevisionIds: [],
        remainingRevisions: visible.length,
        auditRevision: null,
      };
    }
    const nextPruned = new Set([...existingPruned, ...candidates]);
    const auditRevision = await this.appendFileSnapshot(
      "pruned.json",
      this.writePrunedIds(nextPruned),
      "pruned",
      `Pruned ${candidates.length} revision records; kept ${keep}`,
      true,
    );
    if (!auditRevision) throw new Error("History prune did not create an audit revision");
    return {
      schemaVersion: 1,
      requestedKeep: keep,
      prunedRevisionIds: candidates,
      remainingRevisions: visible.length - candidates.length,
      auditRevision,
    };
  }

  private redactDiffLine(line: string): string {
    const redactedKeys = "headers|authorization|cookie|proxy-authorization|password|secret|token|credential|privateKey|displayName|username|userName|accountName|email|author";
    const pathKeys = "path|filePath|folder|directory|defaultSaveFolder|downloadPath|sourcePath|destinationPath|saveFolder";
    if (new RegExp(`^[-+]\\s*"?(?:${redactedKeys})"?\\s*:`, "iu").test(line)) {
      return `${line.slice(0, 1)} [redacted sensitive history field]`;
    }
    return line
      .replace(new RegExp(`("(?:${redactedKeys})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "giu"), '$1"[REDACTED]"')
      .replace(new RegExp(`("(?:${pathKeys})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "giu"), '$1"[LOCAL_PATH_REDACTED]"')
      .replace(/([?&](?:access_token|token|password|secret|signature|key)=)[^&\s"']+/giu, "$1[REDACTED]")
      // Snapshot strings can contain JSON-escaped Windows/UNC paths or plain
      // POSIX home paths even when the property name is unfamiliar. Strip
      // those values as a final defence before the patch crosses IPC.
      .replace(/(?:[A-Za-z]:\\(?:\\.|[^"\\,}])*(?:\\.|[^"\\,}])|\\\\(?:\\.|[^"\\,}])*(?:\\.|[^"\\,}]))/gu, "[LOCAL_PATH_REDACTED]")
      .replace(/(?:^|["\s])\/(?:Users|home|private|tmp|var|mnt|opt|Volumes)\/[^"\s,}]+/gu, (match) => match.startsWith("/") ? "[LOCAL_PATH_REDACTED]" : `${match.slice(0, 1)}[LOCAL_PATH_REDACTED]`);
  }

  async getDiff(revisionId: string): Promise<HistoryDiff> {
    assertConcreteRevisionId(revisionId);
    await this.ensureInitialized();
    const revisions = await this.listAllRevisions();
    const target = revisions.find((revision) => revision.id.toLowerCase() === revisionId.toLowerCase());
    if (!target) throw new Error("Unknown history revision");
    let parentId: string | null = null;
    try {
      const parents = await this.git(["rev-list", "--parents", "-n", "1", target.id]);
      const ids = parents.split(/\s+/u).filter(Boolean);
      parentId = ids[1] ?? null;
    } catch (error) {
      if (!isMissingRevision(error)) throw error;
    }
    if (parentId === null) {
      return { schemaVersion: 1, revisionId: target.id, parentId: null, patch: "", redacted: true, hasChanges: false };
    }
    try {
      const raw = await this.git(["diff", "--no-ext-diff", "--unified=3", parentId, target.id, "--", "snapshot.json"]);
      const patch = raw.split(/\r?\n/u).map((line) => this.redactDiffLine(line)).join("\n").trim();
      return { schemaVersion: 1, revisionId: target.id, parentId, patch, redacted: true, hasChanges: patch.length > 0 };
    } catch (error) {
      if (isMissingRevision(error)) {
        return { schemaVersion: 1, revisionId: target.id, parentId, patch: "", redacted: true, hasChanges: false };
      }
      throw error;
    }
  }

  async diff(revisionId: string): Promise<string> {
    return (await this.getDiff(revisionId)).patch;
  }

  async exportRevisions(format: ExportFormat, filter: HistoryFilter = {}): Promise<ExportResult> {
    return exportRecords(await this.listRevisions(filter), format);
  }
}
