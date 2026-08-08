import { parentPort } from "node:worker_threads";
import { resolveCategory } from "../../shared/categories";
import type { AutoOrganizeRule } from "../../shared/types";

interface CategoryWorkerRequest {
  id: number;
  fileName: string;
  url: string;
  rules: AutoOrganizeRule[];
}

if (!parentPort) throw new Error("Category regex worker requires a parent port");

parentPort.postMessage({ type: "ready" });

parentPort.on("message", (request: CategoryWorkerRequest) => {
  try {
    parentPort!.postMessage({ type: "result", id: request.id, category: resolveCategory(request.fileName, request.url, request.rules) });
  } catch {
    parentPort!.postMessage({ type: "result", id: request.id, category: null });
  }
});
