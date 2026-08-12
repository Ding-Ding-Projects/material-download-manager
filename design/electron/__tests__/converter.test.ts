import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONVERTER_ADAPTERS,
  createEmptyConverterState,
  exportConverterHistory,
  validateConverterRegistry,
} from "../../shared/converter";
import { ConverterService } from "../converter/ConverterService";
import { sniffConverterBytes } from "../converter/signatures";

async function temporaryDirectory(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "mdm-converter-"));
}

async function waitForJob(service: ConverterService, id: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await service.getState();
    const job = state.jobs.find((candidate) => candidate.id === id);
    if (job && ["succeeded", "failed", "paused", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for converter job");
}

function assertStreamingQueueSource(source: string): void {
  if (!/fsp\.opendir\(this\.jobsRoot\)/u.test(source)) {
    throw new Error("Converter queue must stream durable job directory entries with opendir.");
  }
  if (/fsp\.readdir(?:Sync)?\(this\.jobsRoot\)/u.test(source)) {
    throw new Error("Converter queue must not materialize every durable job path with readdir.");
  }
}

test("converter registry is categorized and fails closed when an unbundled adapter is enabled", () => {
  validateConverterRegistry();
  const disabled = CONVERTER_ADAPTERS.find((adapter) => !adapter.enabled);
  assert.ok(disabled);
  const mutated = CONVERTER_ADAPTERS.map((adapter) => adapter.id === disabled.id
    ? { ...adapter, enabled: true, bundled: false, packagedArtifactProof: null }
    : adapter);
  assert.throws(() => validateConverterRegistry(mutated), /lacks bundled packaged-artifact proof/u);
  assert.deepEqual(
    [...new Set(CONVERTER_ADAPTERS.map((adapter) => adapter.category))].sort(),
    ["archives", "audio", "binary-encodings", "code-text", "documents-pdf", "images", "structured-data-spreadsheets", "video"],
  );
});

test("byte sniffing uses actual signatures and never grants a file capability from its name", () => {
  assert.deepEqual(sniffConverterBytes(Buffer.from("%PDF-1.7\n", "ascii")), { kind: "pdf", label: "PDF document", evidence: "signature" });
  assert.deepEqual(sniffConverterBytes(Buffer.from('{"ok":true}\n', "utf8")), { kind: "json", label: "JSON", evidence: "bounded-text-inspection" });
  assert.equal(sniffConverterBytes(Buffer.from([0, 255, 17, 128])).kind, "binary");
});

test("converter queues an in-process JSON-to-CSV job, validates output, and redacts path history", async () => {
  const root = await temporaryDirectory();
  const sourceDirectory = path.join(root, "source");
  const outputDirectory = path.join(root, "output");
  const sourcePath = path.join(sourceDirectory, "records.json");
  await fsp.mkdir(sourceDirectory);
  await fsp.mkdir(outputDirectory);
  const sourceText = '[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}]\n';
  await fsp.writeFile(sourcePath, sourceText, "utf8");
  const service = new ConverterService(path.join(root, "app-data"));
  try {
    await service.init();
    const staged = await service.stageSources([sourcePath]);
    assert.equal(staged.stagedSources.length, 1);
    assert.equal(staged.stagedSources[0]?.detection.kind, "json");
    assert.equal(staged.stagedSources[0]?.preview.kind, "text");
    assert.match(staged.stagedSources[0]?.preview.text ?? "", /Ada/u);
    assert.ok(staged.stagedSources[0]?.compatibleAdapterIds.includes("structured-json-to-csv"));
    const queued = await service.queueStagedSources("structured-json-to-csv", outputDirectory);
    assert.equal(queued.stagedSources.length, 0);
    assert.equal(queued.jobs.length, 1);
    const job = await waitForJob(service, queued.jobs[0]!.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.outputAvailable, true);
    const outputPath = await service.outputPathForJob(job.id);
    assert.ok(outputPath);
    assert.equal(await fsp.readFile(outputPath!, "utf8"), "id,name\n1,Ada\n2,Grace\n");
    assert.equal(await fsp.readFile(sourcePath, "utf8"), sourceText);
    const exported = await service.exportHistory("json");
    assert.equal(exported.content.includes(root), false);
    assert.match(exported.content, /absolute source paths/u);
  } finally {
    await service.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("converter persists queued cancellation and resumes a bounded UTF-8 text normalization job", async () => {
  const root = await temporaryDirectory();
  const sourceDirectory = path.join(root, "source");
  const outputDirectory = path.join(root, "output");
  const sourcePath = path.join(sourceDirectory, "notes.txt");
  await fsp.mkdir(sourceDirectory);
  await fsp.mkdir(outputDirectory);
  await fsp.writeFile(sourcePath, "first\r\nsecond\rthird\n", "utf8");
  const service = new ConverterService(path.join(root, "app-data"));
  try {
    await service.init();
    await service.pauseQueue();
    await service.stageSources([sourcePath]);
    const cancelled = await service.queueStagedSources("text-normalize-utf8", outputDirectory);
    const cancelledJobId = cancelled.jobs[0]!.id;
    const cancellation = await service.cancelJob(cancelledJobId);
    assert.equal(cancellation.jobs[0]?.status, "cancelled");

    await service.stageSources([sourcePath]);
    const queued = await service.queueStagedSources("text-normalize-utf8", outputDirectory);
    const queuedJobId = queued.jobs.find((candidate) => candidate.status === "queued")!.id;
    assert.equal(queued.queuePaused, true);
    assert.equal(queued.jobs.find((job) => job.id === queuedJobId)?.status, "queued");
    await service.resumeQueue();
    const job = await waitForJob(service, queuedJobId);
    assert.equal(job.status, "succeeded");
    const outputPath = await service.outputPathForJob(job.id);
    assert.equal(await fsp.readFile(outputPath!, "utf8"), "first\nsecond\nthird\n");
  } finally {
    await service.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("converter keeps a bounded public history page while durable job records exceed that page", async () => {
  const root = await temporaryDirectory();
  const appData = path.join(root, "app-data");
  const sourceDirectory = path.join(root, "source");
  const outputDirectory = path.join(root, "output");
  await fsp.mkdir(sourceDirectory);
  await fsp.mkdir(outputDirectory);
  const service = new ConverterService(appData);
  try {
    await service.init();
    const jobsDirectory = path.join(appData, "converter", "jobs");
    const now = new Date().toISOString();
    for (let index = 0; index < 201; index += 1) {
      const id = `converter-job-${String(1_700_000_000_000 + index)}-${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
      await fsp.writeFile(path.join(jobsDirectory, `${id}.json`), `${JSON.stringify({
        schemaVersion: 1,
        id,
        sourceName: `record-${index}.txt`,
        destinationName: `record-${index}.txt`,
        adapterId: "text-normalize-utf8",
        status: "failed",
        inputBytes: 1,
        processedBytes: 0,
        outputBytes: null,
        error: "Fixture failure.",
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        retryCount: 0,
        outputAvailable: false,
        sourcePath: path.join(sourceDirectory, `record-${index}.txt`),
        destinationDirectory: outputDirectory,
        outputPath: null,
      })}\n`, "utf8");
    }
    const state = await service.getState();
    assert.equal(state.jobs.length, 200);
    assert.equal(state.hasMoreJobs, true);
  } finally {
    await service.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("converter rejects unavailable adapters before creating a job and Base64 output round-trips source bytes", async () => {
  const root = await temporaryDirectory();
  const sourceDirectory = path.join(root, "source");
  const outputDirectory = path.join(root, "output");
  const sourcePath = path.join(sourceDirectory, "payload.bin");
  const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5, 6, 7]);
  await fsp.mkdir(sourceDirectory);
  await fsp.mkdir(outputDirectory);
  await fsp.writeFile(sourcePath, bytes);
  const service = new ConverterService(path.join(root, "app-data"));
  try {
    await service.init();
    await service.stageSources([sourcePath]);
    await assert.rejects(() => service.queueStagedSources("pdf-inspect", outputDirectory), /unavailable/u);
    const before = await service.getState();
    assert.equal(before.jobs.length, 0);
    const queued = await service.queueStagedSources("binary-to-base64", outputDirectory);
    const job = await waitForJob(service, queued.jobs[0]!.id);
    assert.equal(job.status, "succeeded");
    const output = await fsp.readFile((await service.outputPathForJob(job.id))!, "utf8");
    const decoded = Buffer.from(output, "base64");
    assert.equal(createHash("sha256").update(decoded).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
  } finally {
    await service.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("converter history helper rejects a malformed public state rather than exporting a partial record", () => {
  const state = createEmptyConverterState();
  assert.equal(exportConverterHistory(state, "json").content.includes("absolute source paths"), true);
  assert.throws(() => exportConverterHistory({ ...state, jobs: [{ id: "unsafe" }] } as never, "json"), /Invalid converter history state/u);
});

test("converter worker contract stays local-only and rejects ambient transport or shell imports", async () => {
  const worker = await fsp.readFile(path.resolve(__dirname, "../../../electron/converter/converterWorker.ts"), "utf8");
  const service = await fsp.readFile(path.resolve(__dirname, "../../../electron/converter/ConverterService.ts"), "utf8");
  assert.doesNotMatch(worker, /node:(?:http|https|net|child_process)|\bfetch\s*\(/u);
  assert.doesNotMatch(service, /node:(?:child_process|http|https|net)/u);
  assert.match(service, /new Worker\(/u);
  assert.match(service, /env:\s*\{\}/u);
  assertStreamingQueueSource(service);
  assert.throws(
    () => assertStreamingQueueSource(service.replace("fsp.opendir(this.jobsRoot)", "fsp.readdir(this.jobsRoot)")),
    /must not materialize every durable job path/u,
  );
});
