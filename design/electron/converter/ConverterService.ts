import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  CONVERTER_ADAPTERS,
  CONVERTER_DEFAULT_CONCURRENCY,
  CONVERTER_MAX_INPUT_BYTES,
  CONVERTER_MAX_PUBLIC_JOBS,
  CONVERTER_MAX_STAGED_SOURCES,
  CONVERTER_SCHEMA_VERSION,
  compatibleConverterAdapters,
  converterAdapterForId,
  createEmptyConverterState,
  exportConverterHistory,
  isConverterAdapterId,
  isConverterState,
  type ConverterAdapter,
  type ConverterJobStatus,
  type ConverterJobView,
  type ConverterState,
  type ConverterStagedSource,
} from "../../shared/converter";
import type { ExportFormat, ExportResult } from "../../shared/export";
import { sniffConverterFile } from "./signatures";

const QUEUE_STATE_FILE = "queue-state.json";
const JOBS_DIRECTORY = "jobs";
const JOB_FILE_SUFFIX = ".json";
const INTERNAL_JOB_SCHEMA_VERSION = 1 as const;

interface InternalStagedSource extends ConverterStagedSource {
  sourcePath: string;
}

interface InternalJob extends ConverterJobView {
  schemaVersion: typeof INTERNAL_JOB_SCHEMA_VERSION;
  sourcePath: string;
  destinationDirectory: string;
  outputPath: string | null;
}

interface QueueStateRecord {
  schemaVersion: typeof CONVERTER_SCHEMA_VERSION;
  queuePaused: boolean;
  updatedAt: string;
}

interface WorkerMessage {
  kind: "progress" | "complete" | "error";
  jobId: string;
  processedBytes?: number;
  outputBytes?: number;
  error?: string;
}

interface ActiveWorker {
  jobId: string;
  temporaryOutputPath: string;
  worker: Worker;
  timeout: NodeJS.Timeout;
}

export interface ConverterServiceOptions {
  workerPath?: string;
  onStateChanged?: (state: ConverterState) => void;
  now?: () => Date;
}

function isSafeAbsolutePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32_768
    && !/[\0\r\n]/u.test(value)
    && path.isAbsolute(value)
    && path.normalize(value) === value;
}

function isSafeFileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !/[\\/\0\r\n]/u.test(value);
}

function isOutputPathForDirectory(value: unknown, directory: unknown, destinationName: unknown): value is string {
  return isSafeAbsolutePath(value)
    && isSafeAbsolutePath(directory)
    && isSafeFileName(destinationName)
    && path.dirname(value) === directory
    && path.basename(value) === destinationName;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isInternalJob(value: unknown): value is InternalJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  return job.schemaVersion === INTERNAL_JOB_SCHEMA_VERSION
    && typeof job.id === "string"
    && /^converter-job-\d{13}-[0-9a-f-]{36}$/u.test(job.id)
    && isSafeFileName(job.sourceName)
    && isSafeFileName(job.destinationName)
    && isConverterAdapterId(job.adapterId)
    && ["queued", "running", "paused", "succeeded", "failed", "cancelled"].includes(job.status as string)
    && typeof job.inputBytes === "number"
    && Number.isSafeInteger(job.inputBytes)
    && job.inputBytes >= 0
    && job.inputBytes <= CONVERTER_MAX_INPUT_BYTES
    && typeof job.processedBytes === "number"
    && Number.isSafeInteger(job.processedBytes)
    && job.processedBytes >= 0
    && (job.outputBytes === null || (typeof job.outputBytes === "number" && Number.isSafeInteger(job.outputBytes) && job.outputBytes >= 0))
    && (job.error === null || (typeof job.error === "string" && job.error.length > 0 && job.error.length <= 1_024))
    && isIsoTimestamp(job.createdAt)
    && isIsoTimestamp(job.updatedAt)
    && (job.completedAt === null || isIsoTimestamp(job.completedAt))
    && typeof job.retryCount === "number"
    && Number.isSafeInteger(job.retryCount)
    && job.retryCount >= 0
    && job.retryCount <= 100_000
    && typeof job.outputAvailable === "boolean"
    && isSafeAbsolutePath(job.sourcePath)
    && isSafeAbsolutePath(job.destinationDirectory)
    && (job.outputPath === null || isOutputPathForDirectory(job.outputPath, job.destinationDirectory, job.destinationName));
}

function sanitizedJob(job: InternalJob): ConverterJobView {
  const { schemaVersion: _schemaVersion, sourcePath: _sourcePath, destinationDirectory: _destinationDirectory, outputPath: _outputPath, ...view } = job;
  return view;
}

function cloneView<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timePrefix(date: Date): string {
  return String(date.getTime()).padStart(13, "0");
}

function jobId(date: Date): string {
  return `converter-job-${timePrefix(date)}-${randomUUID()}`;
}

function safeError(_error: unknown, fallback: string): string {
  // Never surface a Node filesystem error because it can include the selected
  // absolute path. The per-job state is descriptive but path-free.
  return fallback;
}

function extensionFor(adapter: ConverterAdapter): string {
  if (!adapter.targetExtension || !/^[a-z0-9.]{1,32}$/u.test(adapter.targetExtension)) {
    throw new Error("The selected converter adapter has no valid output extension.");
  }
  return adapter.targetExtension;
}

function destinationNameFor(sourceName: string, adapter: ConverterAdapter, id: string): string {
  const extension = extensionFor(adapter);
  const parsed = path.parse(sourceName);
  const stem = (parsed.name || "converted").replace(/[\\/\0\r\n]/gu, "").slice(0, 180) || "converted";
  const suffix = id.slice(-8);
  const name = `${stem}-converted-${suffix}.${extension}`;
  if (!isSafeFileName(name)) throw new Error("The requested output name is unsafe.");
  return name;
}

async function regularFileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fsp.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink() ? stat.size : null;
  } catch {
    return null;
  }
}

async function regularFileExists(filePath: string): Promise<boolean> {
  return (await regularFileSize(filePath)) !== null;
}

/**
 * Atomically publish a worker-validated temporary file without allowing a
 * destination created by another process to be replaced between preflight and
 * publication. The temporary file is created in the destination directory,
 * so a hard link is a same-volume, no-replace publication primitive.
 */
async function publishNoOverwrite(temporaryOutputPath: string, outputPath: string, expectedBytes: number): Promise<void> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > CONVERTER_MAX_INPUT_BYTES * 2 + 8_192) {
    throw new Error("The converter worker reported an invalid output size.");
  }
  const temporarySize = await regularFileSize(temporaryOutputPath);
  if (temporarySize === null || temporarySize !== expectedBytes) {
    throw new Error("The validated temporary output is no longer available.");
  }
  try {
    await fsp.link(temporaryOutputPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
      throw new Error("The destination appeared while conversion was running; it was not overwritten.");
    }
    throw new Error("The validated output could not be published without risking an overwrite.");
  }
  const publishedSize = await regularFileSize(outputPath);
  if (publishedSize === null || publishedSize !== expectedBytes) {
    throw new Error("The published output did not pass its final bounded-file check.");
  }
  await fsp.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  if (!isSafeAbsolutePath(directory)) throw new Error("The chosen output folder is invalid.");
  const parsed = path.parse(directory);
  let current = parsed.root;
  const segments = directory.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current).catch(() => null);
    if (!stat) throw new Error("The chosen output folder is not available.");
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("The chosen output folder contains an unsafe directory link.");
  }
}

function estimatedOutputBytes(adapter: ConverterAdapter, inputBytes: number): number {
  if (adapter.id === "binary-to-base64") return Math.ceil(inputBytes / 3) * 4;
  if (adapter.id === "structured-json-to-csv") return Math.min(adapter.resourceLimits.maxOutputBytes, inputBytes * 2 + 8_192);
  return Math.min(adapter.resourceLimits.maxOutputBytes, inputBytes + 8_192);
}

export class ConverterService {
  private initialized = false;
  private queuePaused = false;
  private stagedSources: InternalStagedSource[] = [];
  private active: ActiveWorker | null = null;
  private interrupted = new Map<string, "paused" | "cancelled">();
  private processing = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private emitTail: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly workerPath: string;
  private readonly onStateChanged: ((state: ConverterState) => void) | null;

  constructor(private readonly userDataPath: string, options: ConverterServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.workerPath = options.workerPath ?? path.join(__dirname, "converterWorker.js");
    this.onStateChanged = options.onStateChanged ?? null;
  }

  private get converterRoot(): string {
    return path.join(this.userDataPath, "converter");
  }

  private get jobsRoot(): string {
    return path.join(this.converterRoot, JOBS_DIRECTORY);
  }

  private get queueStatePath(): string {
    return path.join(this.converterRoot, QUEUE_STATE_FILE);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fsp.mkdir(this.jobsRoot, { recursive: true, mode: 0o700 });
    this.queuePaused = await this.readQueueState();
    await this.recoverInterruptedJobs();
    this.initialized = true;
    await this.emitState();
    if (!this.queuePaused) void this.pump();
  }

  private assertReady(): void {
    if (!this.initialized) throw new Error("Converter service is not initialized.");
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async readQueueState(): Promise<boolean> {
    try {
      const raw = JSON.parse(await fsp.readFile(this.queueStatePath, "utf8")) as Partial<QueueStateRecord>;
      if (raw.schemaVersion !== CONVERTER_SCHEMA_VERSION || typeof raw.queuePaused !== "boolean" || !isIsoTimestamp(raw.updatedAt)) {
        throw new Error("Invalid queue state.");
      }
      return raw.queuePaused;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return false;
      return true;
    }
  }

  private async persistQueueState(): Promise<void> {
    const state: QueueStateRecord = {
      schemaVersion: CONVERTER_SCHEMA_VERSION,
      queuePaused: this.queuePaused,
      updatedAt: this.now().toISOString(),
    };
    const temporary = `${this.queueStatePath}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fsp.rename(temporary, this.queueStatePath);
  }

  private jobPath(id: string): string {
    if (!/^converter-job-\d{13}-[0-9a-f-]{36}$/u.test(id)) throw new Error("Invalid converter job identifier.");
    return path.join(this.jobsRoot, `${id}${JOB_FILE_SUFFIX}`);
  }

  private async readJob(id: string): Promise<InternalJob | null> {
    try {
      const filePath = this.jobPath(id);
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) return null;
      const raw = JSON.parse(await fsp.readFile(filePath, "utf8")) as unknown;
      return isInternalJob(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  private async persistJob(job: InternalJob): Promise<void> {
    if (!isInternalJob(job)) throw new Error("Refusing to persist invalid converter job state.");
    const filePath = this.jobPath(job.id);
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(job)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fsp.rename(temporary, filePath);
  }

  private async scanJobs(limit = CONVERTER_MAX_PUBLIC_JOBS): Promise<{ jobs: InternalJob[]; hasMore: boolean }> {
    const fileNames: string[] = [];
    const directory = await fsp.opendir(this.jobsRoot);
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith(JOB_FILE_SUFFIX)) continue;
      const id = entry.name.slice(0, -JOB_FILE_SUFFIX.length);
      if (!/^converter-job-\d{13}-[0-9a-f-]{36}$/u.test(id)) continue;
      fileNames.push(id);
      fileNames.sort((left, right) => right.localeCompare(left));
      if (fileNames.length > limit + 1) fileNames.length = limit + 1;
    }
    const hasMore = fileNames.length > limit;
    const selected = fileNames.slice(0, limit);
    const jobs = (await Promise.all(selected.map((id) => this.readJob(id)))).filter((job): job is InternalJob => job !== null);
    jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { jobs, hasMore };
  }

  private async forEachJob(operation: (job: InternalJob) => Promise<void>): Promise<void> {
    const directory = await fsp.opendir(this.jobsRoot);
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith(JOB_FILE_SUFFIX)) continue;
      const id = entry.name.slice(0, -JOB_FILE_SUFFIX.length);
      const job = await this.readJob(id);
      if (job) await operation(job);
    }
  }

  private async recoverInterruptedJobs(): Promise<void> {
    await this.forEachJob(async (job) => {
      if (job.status !== "running") return;
      const recovered: InternalJob = {
        ...job,
        status: "paused",
        processedBytes: 0,
        outputBytes: null,
        outputAvailable: false,
        error: "The app restarted during this conversion. Review and resume it when the source and destination are still available.",
        updatedAt: this.now().toISOString(),
        completedAt: null,
      };
      await this.persistJob(recovered);
    });
  }

  private async emitState(): Promise<void> {
    const emit = this.onStateChanged;
    if (!emit) return;
    this.emitTail = this.emitTail.then(async () => {
      try {
        emit(await this.getState());
      } catch {
        // A destroyed renderer must not interrupt local conversion persistence.
      }
    });
    await this.emitTail;
  }

  async getState(): Promise<ConverterState> {
    this.assertReady();
    const { jobs, hasMore } = await this.scanJobs();
    const state: ConverterState = {
      schemaVersion: CONVERTER_SCHEMA_VERSION,
      queuePaused: this.queuePaused,
      stagedSources: this.stagedSources.map(({ sourcePath: _sourcePath, ...source }) => cloneView(source)),
      jobs: jobs.map((job) => cloneView(sanitizedJob(job))),
      hasMoreJobs: hasMore,
      updatedAt: this.now().toISOString(),
    };
    if (!isConverterState(state)) throw new Error("Converter state failed its renderer-boundary validation.");
    return state;
  }

  async stageSources(filePaths: readonly string[]): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        this.stagedSources = [];
        await this.emitState();
        return this.getState();
      }
      if (filePaths.length > CONVERTER_MAX_STAGED_SOURCES) {
        throw new Error(`Choose at most ${CONVERTER_MAX_STAGED_SOURCES} files per staging page. Queue records themselves are persisted independently and have no global item-count switch.`);
      }
      const next: InternalStagedSource[] = [];
      for (const sourcePath of filePaths) {
        if (!isSafeAbsolutePath(sourcePath)) throw new Error("A selected source path is invalid.");
        const sniffed = await sniffConverterFile(sourcePath);
        const adapters = compatibleConverterAdapters(sniffed.detection);
        next.push({
          id: `converter-source-${randomUUID()}`,
          sourcePath,
          sourceName: sniffed.sourceName,
          sizeBytes: sniffed.sizeBytes,
          detection: sniffed.detection,
          preview: sniffed.preview,
          compatibleAdapterIds: adapters.map((adapter) => adapter.id),
        });
      }
      this.stagedSources = next;
      await this.emitState();
      return this.getState();
    });
  }

  async clearStagedSources(): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      this.stagedSources = [];
      await this.emitState();
      return this.getState();
    });
  }

  async queueStagedSources(adapterId: string, destinationDirectory: string): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      const adapter = converterAdapterForId(adapterId);
      if (!adapter || !adapter.enabled || !adapter.bundled || !adapter.packagedArtifactProof) {
        throw new Error("The selected converter adapter is unavailable because it has no bundled packaged-artifact proof.");
      }
      if (this.stagedSources.length === 0) throw new Error("Choose one or more local source files before queueing a conversion.");
      await ensureSafeDirectory(destinationDirectory);
      for (const source of this.stagedSources) {
        if (!source.compatibleAdapterIds.includes(adapter.id)) {
          throw new Error(`${source.sourceName} is not compatible with ${adapter.label}.`);
        }
        if (source.sizeBytes > adapter.resourceLimits.maxInputBytes) {
          throw new Error(`${source.sourceName} exceeds this adapter's documented per-file safety boundary.`);
        }
      }
      const created: string[] = [];
      try {
        for (const source of this.stagedSources) {
          const id = jobId(this.now());
          const createdAt = this.now().toISOString();
          const destinationName = destinationNameFor(source.sourceName, adapter, id);
          const outputPath = path.join(destinationDirectory, destinationName);
          if (!isSafeAbsolutePath(outputPath) || !outputPath.startsWith(path.resolve(destinationDirectory) + path.sep)) {
            throw new Error("The generated output path escaped the selected folder.");
          }
          if (await regularFileExists(outputPath)) throw new Error(`${destinationName} already exists; the converter never overwrites a destination.`);
          const job: InternalJob = {
            schemaVersion: INTERNAL_JOB_SCHEMA_VERSION,
            id,
            sourceName: source.sourceName,
            destinationName,
            adapterId: adapter.id,
            status: "queued",
            inputBytes: source.sizeBytes,
            processedBytes: 0,
            outputBytes: null,
            error: null,
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
            retryCount: 0,
            outputAvailable: false,
            sourcePath: source.sourcePath,
            destinationDirectory,
            outputPath,
          };
          await this.persistJob(job);
          created.push(id);
        }
      } catch (error) {
        await Promise.all(created.map((id) => fsp.rm(this.jobPath(id), { force: true }).catch(() => undefined)));
        throw error;
      }
      this.stagedSources = [];
      await this.emitState();
      if (!this.queuePaused) void this.pump();
      return this.getState();
    });
  }

  async pauseQueue(): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      this.queuePaused = true;
      await this.persistQueueState();
      if (this.active) {
        this.interrupted.set(this.active.jobId, "paused");
        await this.active.worker.terminate().catch(() => undefined);
      }
      await this.emitState();
      return this.getState();
    });
  }

  async resumeQueue(): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      this.queuePaused = false;
      await this.persistQueueState();
      await this.forEachJob(async (job) => {
        if (job.status !== "paused") return;
        await this.persistJob({
          ...job,
          status: "queued",
          processedBytes: 0,
          outputBytes: null,
          outputAvailable: false,
          error: null,
          updatedAt: this.now().toISOString(),
          completedAt: null,
        });
      });
      await this.emitState();
      void this.pump();
      return this.getState();
    });
  }

  async cancelJob(id: string): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      const job = await this.readJob(id);
      if (!job) throw new Error("The converter job was not found.");
      if (job.status === "succeeded" || job.status === "cancelled") return this.getState();
      if (this.active?.jobId === id) {
        this.interrupted.set(id, "cancelled");
        await this.active.worker.terminate().catch(() => undefined);
      }
      await this.persistJob({
        ...job,
        status: "cancelled",
        processedBytes: 0,
        outputBytes: null,
        outputAvailable: false,
        error: "Cancelled before a validated output was published.",
        updatedAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      });
      await this.emitState();
      return this.getState();
    });
  }

  async retryJob(id: string): Promise<ConverterState> {
    this.assertReady();
    return this.withMutation(async () => {
      const job = await this.readJob(id);
      if (!job) throw new Error("The converter job was not found.");
      if (job.status === "running") throw new Error("Pause or cancel the running conversion before retrying it.");
      if (job.status === "succeeded") throw new Error("A successful conversion is immutable; create a new conversion instead.");
      const retried: InternalJob = {
        ...job,
        status: "queued",
        processedBytes: 0,
        outputBytes: null,
        outputAvailable: false,
        error: null,
        retryCount: job.retryCount + 1,
        updatedAt: this.now().toISOString(),
        completedAt: null,
      };
      await this.persistJob(retried);
      await this.emitState();
      if (!this.queuePaused) void this.pump();
      return this.getState();
    });
  }

  async outputPathForJob(id: string): Promise<string | null> {
    this.assertReady();
    const job = await this.readJob(id);
    if (!job || !job.outputAvailable || !job.outputPath || typeof job.outputBytes !== "number") return null;
    if ((await regularFileSize(job.outputPath)) !== job.outputBytes) return null;
    return job.outputPath;
  }

  async exportHistory(format: ExportFormat): Promise<ExportResult> {
    this.assertReady();
    return exportConverterHistory(await this.getState(), format);
  }

  private async findNextQueuedJob(): Promise<InternalJob | null> {
    let selected: InternalJob | null = null;
    await this.forEachJob(async (job) => {
      if (job.status !== "queued") return;
      if (!selected || job.createdAt < selected.createdAt) selected = job;
    });
    return selected;
  }

  private async preflightStorage(adapter: ConverterAdapter, job: InternalJob): Promise<void> {
    await ensureSafeDirectory(job.destinationDirectory);
    const source = await fsp.lstat(job.sourcePath).catch(() => null);
    if (!source || !source.isFile() || source.isSymbolicLink() || source.size !== job.inputBytes) {
      throw new Error("The source changed, disappeared, or is no longer a regular file.");
    }
    if (job.outputPath && await regularFileExists(job.outputPath)) {
      throw new Error("The destination already exists; no overwrite was attempted.");
    }
    const stat = await fsp.statfs(job.destinationDirectory).catch(() => null);
    if (!stat) throw new Error("Free storage could not be verified for the selected output folder.");
    const available = Number(stat.bavail) * Number(stat.bsize);
    const required = estimatedOutputBytes(adapter, job.inputBytes) + 1024 * 1024;
    if (!Number.isFinite(available) || available < required) {
      throw new Error("The selected output folder does not have enough verified free storage for this conversion.");
    }
  }

  private async pump(): Promise<void> {
    if (this.processing || this.queuePaused || !this.initialized) return;
    this.processing = true;
    try {
      while (!this.queuePaused) {
        const job = await this.findNextQueuedJob();
        if (!job) break;
        await this.executeJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeJob(initial: InternalJob): Promise<void> {
    const adapter = converterAdapterForId(initial.adapterId);
    if (!adapter || !adapter.enabled || !adapter.bundled || !adapter.packagedArtifactProof) {
      await this.persistJob({ ...initial, status: "failed", error: "The adapter is unavailable because its bundled proof is missing.", updatedAt: this.now().toISOString(), completedAt: this.now().toISOString() });
      await this.emitState();
      return;
    }
    const outputPath = initial.outputPath;
    if (!outputPath) {
      await this.persistJob({ ...initial, status: "failed", error: "The durable output destination is missing.", updatedAt: this.now().toISOString(), completedAt: this.now().toISOString() });
      await this.emitState();
      return;
    }
    const temporaryOutputPath = path.join(initial.destinationDirectory, `.${initial.destinationName}.${randomUUID()}.partial`);
    const running: InternalJob = {
      ...initial,
      status: "running",
      processedBytes: 0,
      error: null,
      outputBytes: null,
      outputAvailable: false,
      updatedAt: this.now().toISOString(),
      completedAt: null,
    };
    try {
      await this.preflightStorage(adapter, running);
      await this.persistJob(running);
      await this.emitState();
      const outputBytes = await this.runWorker(running, adapter, temporaryOutputPath);
      const interrupted = this.interrupted.get(running.id);
      this.interrupted.delete(running.id);
      if (interrupted) {
        const status: ConverterJobStatus = interrupted;
        await fsp.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
        await this.persistJob({
          ...running,
          status,
          processedBytes: 0,
          outputBytes: null,
          outputAvailable: false,
          error: status === "paused" ? "Paused before a validated output was published." : "Cancelled before a validated output was published.",
          updatedAt: this.now().toISOString(),
          completedAt: status === "cancelled" ? this.now().toISOString() : null,
        });
        await this.emitState();
        return;
      }
      await publishNoOverwrite(temporaryOutputPath, outputPath, outputBytes);
      await this.persistJob({
        ...running,
        status: "succeeded",
        processedBytes: running.inputBytes,
        outputBytes,
        outputAvailable: true,
        error: null,
        updatedAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      });
    } catch (error) {
      const interrupted = this.interrupted.get(running.id);
      this.interrupted.delete(running.id);
      await fsp.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
      const status: ConverterJobStatus = interrupted ?? "failed";
      await this.persistJob({
        ...running,
        status,
        processedBytes: 0,
        outputBytes: null,
        outputAvailable: false,
        error: status === "paused"
          ? "Paused before a validated output was published."
          : status === "cancelled"
            ? "Cancelled before a validated output was published."
            : safeError(error, "The conversion could not complete; no output was published."),
        updatedAt: this.now().toISOString(),
        completedAt: status === "cancelled" || status === "failed" ? this.now().toISOString() : null,
      });
    } finally {
      await this.emitState();
    }
  }

  private async runWorker(job: InternalJob, adapter: ConverterAdapter, temporaryOutputPath: string): Promise<number> {
    if (!await regularFileExists(this.workerPath)) throw new Error("The bundled converter worker is missing from this build.");
    return new Promise<number>((resolve, reject) => {
      const worker = new Worker(this.workerPath, {
        resourceLimits: {
          maxOldGenerationSizeMb: adapter.resourceLimits.maxWorkerMemoryMiB,
          maxYoungGenerationSizeMb: Math.min(16, adapter.resourceLimits.maxWorkerMemoryMiB),
        },
        // No environment values, credentials, or network configuration are inherited.
        env: {},
      });
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new Error("The converter worker exceeded its wall-time boundary."));
      }, adapter.resourceLimits.wallTimeMs);
      this.active = { jobId: job.id, temporaryOutputPath, worker, timeout };
      let lastPersistAt = 0;
      const cleanup = () => {
        clearTimeout(timeout);
        if (this.active?.jobId === job.id) this.active = null;
      };
      worker.once("error", (error) => {
        cleanup();
        reject(error);
      });
      worker.once("exit", (code) => {
        if (code !== 0 && this.interrupted.has(job.id)) {
          cleanup();
          reject(new Error("The converter worker was interrupted by a queue action."));
        } else if (code !== 0) {
          cleanup();
          reject(new Error("The isolated converter worker exited before producing a validated result."));
        }
      });
      worker.on("message", (message: WorkerMessage) => {
        if (!message || message.jobId !== job.id) return;
        if (message.kind === "progress" && typeof message.processedBytes === "number") {
          const now = Date.now();
          if (now - lastPersistAt >= 200) {
            lastPersistAt = now;
            void this.readJob(job.id).then(async (current) => {
              if (!current || current.status !== "running") return;
              await this.persistJob({
                ...current,
                processedBytes: Math.min(current.inputBytes, Math.max(0, Math.floor(message.processedBytes!))),
                updatedAt: this.now().toISOString(),
              });
              await this.emitState();
            }).catch(() => undefined);
          }
          return;
        }
        if (message.kind === "complete" && typeof message.outputBytes === "number") {
          cleanup();
          void worker.terminate().catch(() => undefined);
          resolve(message.outputBytes);
          return;
        }
        if (message.kind === "error") {
          cleanup();
          void worker.terminate().catch(() => undefined);
          reject(new Error(message.error || "The converter worker rejected this input."));
        }
      });
      worker.postMessage({
        kind: "convert",
        jobId: job.id,
        adapterId: job.adapterId,
        sourcePath: job.sourcePath,
        temporaryOutputPath,
        inputBytes: job.inputBytes,
      });
    });
  }

  async shutdown(): Promise<void> {
    this.queuePaused = true;
    if (this.active) {
      this.interrupted.set(this.active.jobId, "paused");
      await this.active.worker.terminate().catch(() => undefined);
    }
  }
}

// This static reference makes it difficult for a future refactor to accidentally
// replace the declared adapter registry with PATH discovery.
void CONVERTER_ADAPTERS;
void CONVERTER_DEFAULT_CONCURRENCY;
