import { parentPort } from "node:worker_threads";
import { evaluateRegex, evaluateRegexPredicate } from "../../shared/regex";

interface RegexEvaluationWorkerRequest {
  id: number;
  pattern: string;
  flags: string;
  samples: string[];
  includeMatches: boolean;
}

if (!parentPort) throw new Error("Regex evaluation worker requires a parent port");

parentPort.postMessage({ type: "ready" });

parentPort.on("message", (request: RegexEvaluationWorkerRequest) => {
  try {
    const evaluations = request.samples.map((sample) => {
      return request.includeMatches
        ? evaluateRegex(request.pattern, request.flags, sample)
        : evaluateRegexPredicate(request.pattern, request.flags, sample);
    });
    parentPort!.postMessage({ type: "result", id: request.id, evaluations });
  } catch {
    parentPort!.postMessage({ type: "result", id: request.id, evaluations: null });
  }
});
