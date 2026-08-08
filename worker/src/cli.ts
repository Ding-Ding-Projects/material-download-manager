import { loadWorkerConfig } from "./config.js";
import { safeLogRecord } from "./network-policy.js";
import { WorkerServer } from "./server.js";

const server = new WorkerServer(await loadWorkerConfig());
const address = await server.listen();
process.stdout.write(`${safeLogRecord("worker-listening", { port: address.port })}\n`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${safeLogRecord("worker-stopping", { signal })}\n`);
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  await server.close();
  clearTimeout(forceTimer);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", () => {
  process.stderr.write(`${safeLogRecord("worker-fatal", { code: "UNCAUGHT_EXCEPTION" })}\n`);
  process.exit(1);
});
process.on("unhandledRejection", () => {
  process.stderr.write(`${safeLogRecord("worker-fatal", { code: "UNHANDLED_REJECTION" })}\n`);
  process.exit(1);
});
