import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createDefaultSettings } from "../../shared/settings";
import {
  HandoffServer,
  HANDOFF_QUEUE_RESPONSE_TIMEOUT_MS,
  HANDOFF_PATH,
  HANDOFF_PROTOCOL_VERSION,
  STATUS_PATH,
  normalizeHandoffUrl,
} from "../extension/HandoffServer";
import { extractBrowserHandoffRequests } from "../download/browserHandoff";

function requestJson(port: number, method: string, pathname: string, body?: unknown) {
  return new Promise<{ statusCode: number; body: Record<string, unknown> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      { host: "127.0.0.1", port, method, path: pathname, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

test("loopback handoff endpoint advertises status and queues a validated URL", async () => {
  const port = 43_872;
  const calls: unknown[] = [];
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addDownload: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  };
  const server = new HandoffServer({ manager, port });
  assert.equal(await server.start(), true);
  try {
    const status = await requestJson(port, "GET", STATUS_PATH);
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.body, { protocol: HANDOFF_PROTOCOL_VERSION, acceptingUrls: true });

    const accepted = await requestJson(port, "POST", HANDOFF_PATH, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/reports/report.pdf",
      requestedAt: new Date().toISOString(),
      title: "Report",
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(calls.length, 1);
    assert.equal(accepted.body.downloadId, "download-id");
    assert.deepEqual(calls[0], {
      url: "https://downloads.example.test/reports/report.pdf",
      folder: "C:/Downloads/MaterialDownloadManager",
      fileName: "report.pdf",
      queueId: null,
      startImmediately: true,
    });
  } finally {
    await server.stop();
  }
});
test("loopback handoff reports queue failures instead of claiming acceptance", async () => {
  const port = 43_874;
  const messages: string[] = [];
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addDownload: async () => {
      throw new Error("probe failed for https://example.test/file.zip");
    },
  };
  const server = new HandoffServer({ manager, port, logger: (message) => messages.push(message) });
  assert.equal(await server.start(), true);
  try {
    const rejected = await requestJson(port, "POST", HANDOFF_PATH, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/file.zip",
    });
    assert.equal(rejected.statusCode, 500);
    assert.deepEqual(rejected.body, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      accepted: false,
      error: "The download could not be queued.",
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /probe failed/);
  } finally {
    await server.stop();
  }
});

test("loopback handoff acknowledges a slow queue without making the extension retry blindly", async () => {
  const port = 43_875;
  let completed = false;
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addDownload: async () => {
      await new Promise((resolve) => setTimeout(resolve, HANDOFF_QUEUE_RESPONSE_TIMEOUT_MS + 100));
      completed = true;
      return "slow-download-id";
    },
  };
  const server = new HandoffServer({ manager, port });
  assert.equal(await server.start(), true);
  try {
    const acknowledged = await requestJson(port, "POST", HANDOFF_PATH, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/slow.zip",
    });
    assert.equal(acknowledged.statusCode, 202);
    assert.deepEqual(acknowledged.body, { protocol: HANDOFF_PROTOCOL_VERSION, accepted: true, pending: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(completed, true);
  } finally {
    await server.stop();
  }
});

test("loopback handoff endpoint rejects credentials and oversized bodies", async () => {
  assert.throws(() => normalizeHandoffUrl("https://user:password@example.test/file"), /credentials/);
  const port = 43_873;
  const calls: unknown[] = [];
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addDownload: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  };
  const server = new HandoffServer({ manager, port });
  assert.equal(await server.start(), true);
  try {
    const rejected = await requestJson(port, "POST", HANDOFF_PATH, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://user:password@example.test/file.zip",
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(calls.length, 0);
  } finally {
    await server.stop();
  }
});

test("browser launch handoff parses into the shared download request shape", () => {
  const encodedUrl = encodeURIComponent("https://downloads.example.test/archive.zip");
  const requests = extractBrowserHandoffRequests([
    "electron.exe",
    `--mdm-download=material-download-manager://download?url=${encodedUrl}&fileName=archive.zip&folder=C%3A%2FDownloads&start=0`,
  ]);
  assert.deepEqual(requests, [{
    url: "https://downloads.example.test/archive.zip",
    folder: "C:/Downloads",
    fileName: "archive.zip",
    queueId: null,
    startImmediately: false,
  }]);
});
