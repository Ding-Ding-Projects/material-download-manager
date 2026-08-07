import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateRegex } from "../../shared/regex";
import { exportRecords, type ExportFormat, type ExportResult } from "../../shared/export";

const execFileAsync = promisify(execFile);

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_LENGTH = 1_024;
const SAFE_REVISION_ID = /^(?:HEAD|[0-9a-f]{7,64})$/i;

export type HistoryAction =
  | "created"
  | "updated"
  | "deleted"
  | "restored"
  | "undone"
  | "discarded"
  | "imported"
  | "settings-changed";

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

export interface HistoryActionCounts {
  [action: string]: number;
}

function isHistoryAction(value: string): value is HistoryAction {
  return [
    "created",
    "updated",
    "deleted",
    "restored",
    "undone",
    "discarded",
    "imported",
    "settings-changed",
  ].includes(value as HistoryAction);
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
  private initialization: Promise<void> | null = null;
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.repositoryPath = path.join(path.resolve(userDataPath), "local-history");
  }

  private async git(args: string[], trim = true): Promise<string> {
    const result = await execFileAsync("git", ["--no-pager", ...args], {
      cwd: this.repositoryPath,
      encoding: "utf8",
      maxBuffer: MAX_SNAPSHOT_BYTES * 2,
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
    if (!this.initialization) {
      this.initialization = this.initialize();
    }
    await this.initialization;
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
        await this.git(["add", "--", "snapshot.json"]);
        await this.git(["commit", "--quiet", ...(force ? ["--allow-empty"] : []), "-m", subject]);
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
    let log = "";
    try {
      log = await this.git(["log", "--format=%H%x09%aI%x09%s"]);
    } catch {
      return [];
    }

    return log.split(/\r?\n/).filter(Boolean).flatMap((line) => {
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
        if (filter.regex) {
          const result = evaluateRegex(filter.text, filter.flags ?? "gi", haystack);
          if (result.error || result.matches.length === 0) return [];
        } else if (!haystack.toLocaleLowerCase().includes(filter.text.toLocaleLowerCase())) {
          return [];
        }
      }
      return [{ id, action: actionText, summary, timestamp }];
    });
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
    } catch {
      return null;
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
    } catch {
      return "";
    }
  }

  async exportRevisions(format: ExportFormat, filter: HistoryFilter = {}): Promise<ExportResult> {
    return exportRecords(await this.listRevisions(filter), format);
  }
}
