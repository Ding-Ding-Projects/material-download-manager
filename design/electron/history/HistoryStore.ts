import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluateRegex } from "../../shared/regex";
import { exportRecords, type ExportFormat, type ExportResult } from "../../shared/export";

const execFileAsync = promisify(execFile);

export type HistoryAction = "created" | "updated" | "deleted" | "restored" | "undone" | "imported" | "settings-changed";

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

export class HistoryStore {
  readonly repositoryPath: string;
  private initialized = false;

  constructor(userDataPath: string) {
    this.repositoryPath = path.join(userDataPath, "local-history");
  }

  private async git(args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd: this.repositoryPath,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout.trim();
  }

  private async ensureInitialized() {
    if (this.initialized) return;
    await fsp.mkdir(this.repositoryPath, { recursive: true });
    try {
      await fsp.access(path.join(this.repositoryPath, ".git"));
    } catch {
      await this.git(["init", "--quiet"]);
      await this.git(["config", "user.name", "Material Download Manager History"]);
      await this.git(["config", "user.email", "history@localhost"]);
    }
    this.initialized = true;
  }

  async appendSnapshot(snapshot: string, action: HistoryAction, summary: string): Promise<HistoryRevision | null> {
    await this.ensureInitialized();
    const snapshotPath = path.join(this.repositoryPath, "snapshot.json");
    try {
      const previous = await fsp.readFile(snapshotPath, "utf8");
      if (previous === snapshot) return null;
    } catch {
      // first revision
    }
    await fsp.writeFile(snapshotPath, snapshot, "utf8");
    const cleanSummary = summary.replace(/[\r\n]+/g, " ").trim() || "Changed application state";
    const subject = "history: " + action + " — " + cleanSummary;
    await this.git(["add", "--", "snapshot.json"]);
    await this.git(["commit", "--quiet", "-m", subject]);
    const id = await this.git(["rev-parse", "HEAD"]);
    const timestamp = await this.git(["show", "-s", "--format=%aI", id]);
    return { id, action, summary: cleanSummary, timestamp };
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
      if (!id || !timestamp || !subject.startsWith("history: ")) return [];
      const parts = subject.slice("history: ".length).split(" — ");
      const action = parts.shift() as HistoryAction;
      const summary = parts.join(" — ") || action;
      const time = Date.parse(timestamp);
      if (filter.from !== undefined && time < filter.from) return [];
      if (filter.to !== undefined && time > filter.to) return [];
      if (filter.actions?.length && !filter.actions.includes(action)) return [];
      if (filter.text) {
        const haystack = action + " " + summary;
        if (filter.regex) {
          const result = evaluateRegex(filter.text, filter.flags ?? "gi", haystack);
          if (result.error || result.matches.length === 0) return [];
        } else if (!haystack.toLocaleLowerCase().includes(filter.text.toLocaleLowerCase())) {
          return [];
        }
      }
      return [{ id, action, summary, timestamp }];
    });
  }

  async readSnapshot(revisionId = "HEAD"): Promise<string | null> {
    await this.ensureInitialized();
    try {
      return await this.git(["show", revisionId + ":snapshot.json"]);
    } catch {
      return null;
    }
  }

  async restore(revisionId: string): Promise<HistoryRevision | null> {
    const snapshot = await this.readSnapshot(revisionId);
    if (snapshot === null) return null;
    return this.appendSnapshot(snapshot, "restored", "Restored revision " + revisionId.slice(0, 8));
  }

  async diff(revisionId: string): Promise<string> {
    await this.ensureInitialized();
    try {
      return await this.git(["diff", revisionId + "^", revisionId, "--", "snapshot.json"]);
    } catch {
      return "";
    }
  }

  async exportRevisions(format: ExportFormat, filter: HistoryFilter = {}): Promise<ExportResult> {
    return exportRecords(await this.listRevisions(filter), format);
  }
}
