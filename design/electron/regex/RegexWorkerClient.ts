import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  REGEX_MAX_SAMPLE_LENGTH,
  type RegexEvaluation,
} from "../../shared/regex";

export const REGEX_EVALUATION_TIMEOUT_MS = 500;
const REGEX_WORKER_STARTUP_TIMEOUT_MS = 10_000;

interface RegexWorkerResponse {
  type: "ready" | "result";
  id?: number;
  evaluations?: RegexEvaluation[] | null;
}

interface PendingRegexEvaluation {
  samples: readonly string[];
  resolve: (evaluations: RegexEvaluation[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerReadiness {
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

function failureEvaluations(samples: readonly string[], message: string): RegexEvaluation[] {
  return samples.map((sample) => ({
    error: message,
    matches: [],
    truncated: true,
    normalizedSample: sample.slice(0, REGEX_MAX_SAMPLE_LENGTH),
  }));
}

class RegexWorkerClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRegexEvaluation>();
  private readonly readiness = new Map<Worker, WorkerReadiness>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, "regexEvaluationWorker.js"));
    this.worker = worker;
    worker.on("message", (message: RegexWorkerResponse) => {
      if (message.type === "ready") {
        const readiness = this.readiness.get(worker);
        if (readiness) {
          clearTimeout(readiness.timer);
          readiness.resolve(true);
          this.readiness.delete(worker);
        }
        return;
      }
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(
        Array.isArray(message.evaluations) && message.evaluations.length === pending.samples.length
          ? message.evaluations
          : failureEvaluations(pending.samples, "Regular expression evaluation failed.")
      );
    });
    worker.on("error", () => this.failWorker(worker, "Regular expression worker failed."));
    worker.on("exit", () => this.failWorker(worker, "Regular expression worker stopped."));
    worker.unref();
    let markReady!: (ready: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      markReady = resolve;
    });
    const timer = setTimeout(
      () => this.failWorker(worker, "Regular expression worker startup timed out."),
      REGEX_WORKER_STARTUP_TIMEOUT_MS
    );
    this.readiness.set(worker, { promise, resolve: markReady, timer });
    return worker;
  }

  private failWorker(worker: Worker, message: string): void {
    if (this.worker !== worker) return;
    this.worker = null;
    void worker.terminate().catch(() => undefined);
    const readiness = this.readiness.get(worker);
    if (readiness) {
      clearTimeout(readiness.timer);
      readiness.resolve(false);
      this.readiness.delete(worker);
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.resolve(failureEvaluations(request.samples, message));
    }
  }

  evaluate(
    pattern: string,
    flags: string,
    samples: readonly string[],
    includeMatches: boolean,
    timeoutMs = REGEX_EVALUATION_TIMEOUT_MS
  ): Promise<RegexEvaluation[]> {
    if (samples.length === 0) return Promise.resolve([]);
    const worker = this.ensureWorker();
    const readiness = this.readiness.get(worker)?.promise ?? Promise.resolve(true);
    return readiness.then((ready) => new Promise<RegexEvaluation[]>((resolve) => {
      if (!ready || this.worker !== worker) {
        resolve(failureEvaluations(samples, "Regular expression worker failed to start."));
        return;
      }
      const id = ++this.nextId;
      const timer = setTimeout(
        () => this.failWorker(worker, "Regular expression evaluation timed out."),
        Math.max(0, timeoutMs)
      );
      this.pending.set(id, { samples, resolve, timer });
      try {
        worker.postMessage({ id, pattern, flags, samples: [...samples], includeMatches });
      } catch {
        this.failWorker(worker, "Regular expression worker request failed.");
      }
    }));
  }
}

const regexWorker = new RegexWorkerClient();

export function evaluateRegexBatchIsolated(
  pattern: string,
  flags: string,
  samples: readonly string[],
  includeMatches = false,
  timeoutMs = REGEX_EVALUATION_TIMEOUT_MS
): Promise<RegexEvaluation[]> {
  return regexWorker.evaluate(pattern, flags, samples, includeMatches, timeoutMs);
}
