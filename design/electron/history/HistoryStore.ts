import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportRecords, type ExportFormat, type ExportResult } from "../../shared/export";
import { HISTORY_ACTIONS, type HistoryAction, type HistoryFilter, type HistoryRevision } from "../../shared/history";
import { evaluateRegexBatchIsolated } from "../regex/RegexWorkerClient";

const execFileAsync = promisify(execFile);

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_LENGTH = 1_024;
const SAFE_REVISION_ID = /^(?:HEAD|[0-9a-f]{7,64})$/i;
const GIT_COMMAND_TIMEOUT_MS = 10_000;

export type { HistoryAction, HistoryFilter, HistoryRevision } from "../../shared/history";

export interface HistoryActionCounts {
  [action: string]: number;
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

  private async writeSnapshot(snapshot: string): Promise<void> {
    const snapshotPath = path.join(this.repositoryPath, "snapshot.json");
    const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporaryPath, snapshot, "utf8");
    try {
      await fsp.rename(temporaryPath, snapshotPath);
    } finally {
      await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async appendSnapshot(
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
      const snapshotPath = path.join(this.repositoryPath, "snapshot.json");
      let previous: string | null = null;
      try {
        previous = await fsp.readFile(snapshotPath, "utf8");
      } catch {
        // The first revision has no previous working snapshot.
      }
      if (previous === snapshot && !force) return null;

      await this.writeSnapshot(snapshot);
      const subject = `history: ${action} — ${cleanSummary(summary)}`;
      try {
        // --only commits this path from the working tree and preserves any
        // unrelated staged entries in the isolated repository's index.
        await this.git(["add", "--", "snapshot.json"]);
        await this.git(["commit", "--quiet", "--no-verify", "--only", ...(force ? ["--allow-empty"] : []), "-m", subject, "--", "snapshot.json"]);
      } catch (error) {
        // Keep a failed write recoverable and do not leave an uncommitted
        // replacement masquerading as the current committed state.
        if (previous === null) await fsp.rm(snapshotPath, { force: true }).catch(() => undefined);
        else await this.writeSnapshot(previous).catch(() => undefined);
        throw error;
      }

      const id = await this.git(["rev-parse", "HEAD"]);
      const timestamp = await this.git(["show", "-s", "--format=%aI", id]);
      return { id, action, summary: cleanSummary(summary), timestamp };
    });
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

  async listRevisions(filter: HistoryFilter = {}): Promise<HistoryRevision[]> {
    await this.ensureInitialized();
    try {
      await this.git(["rev-parse", "--verify", "--quiet", "HEAD"]);
    } catch (error) {
      if (isMissingRevision(error)) return [];
      throw error;
    }
    const log = await this.git(["log", "--format=%H%x09%aI%x09%s"]);

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
      return [{ id, action: actionText, summary, timestamp }];
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

  async diff(revisionId: string): Promise<string> {
    assertSafeRevisionId(revisionId);
    await this.ensureInitialized();
    try {
      return await this.git(["diff", `${revisionId}^`, revisionId, "--", "snapshot.json"]);
    } catch (error) {
      if (isMissingRevision(error)) return "";
      throw error;
    }
  }

  async exportRevisions(format: ExportFormat, filter: HistoryFilter = {}): Promise<ExportResult> {
    return exportRecords(await this.listRevisions(filter), format);
  }
}
