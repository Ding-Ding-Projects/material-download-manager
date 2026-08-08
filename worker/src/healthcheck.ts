import { connect } from "node:net";

const host = process.env.MDM_WORKER_HEALTH_HOST ?? "127.0.0.1";
const port = Number(process.env.MDM_WORKER_PORT ?? "2222");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) process.exit(1);

const socket = connect({ host, port });
const timer = setTimeout(() => socket.destroy(new Error("healthcheck timeout")), 3_000);
timer.unref();
socket.setEncoding("utf8");
let banner = "";
socket.on("data", (chunk: string) => {
  banner += chunk;
  if (banner.length > 255 || banner.includes("\n")) {
    clearTimeout(timer);
    socket.destroy();
    process.exit(banner.startsWith("SSH-2.0-mdm-download-worker_1\r\n") ? 0 : 1);
  }
});
socket.once("error", () => process.exit(1));
