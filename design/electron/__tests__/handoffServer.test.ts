import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { createDefaultSettings } from "../../shared/settings";
import {
  HandoffServer,
  CHALLENGE_PATH,
  HANDOFF_PATH,
  HANDOFF_PROTOCOL_VERSION,
  MAX_HANDOFF_FILE_NAME_LENGTH,
  MAX_ACTIVE_HANDOFFS,
  STATUS_PATH,
  normalizeOptionalHandoffFileName,
  normalizeHandoffUrl,
  parseHandoffEnvelope,
  challengeProofInput,
  handoffRequestProofInput,
  handoffResponseProofInput,
} from "../extension/HandoffServer";
import { extractBrowserHandoffRequests } from "../download/browserHandoff";

const TEST_CAPABILITY = "a".repeat(43);

function proof(input: string): string {
  return createHmac("sha256", TEST_CAPABILITY).update(input, "utf8").digest("hex");
}

function withRollback<T extends object>(manager: T): T & { rollbackBrowserHandoff: (downloadId: string) => Promise<void> } {
  return Object.assign(manager, { rollbackBrowserHandoff: async (_downloadId: string) => {} });
}

function requestJson(
  port: number,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<{ statusCode: number; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: {
          ...headers,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              headers: response.headers,
            });
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

async function authenticatedPost(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const authNonce = randomBytes(32).toString("hex");
  const challenge = await requestJson(port, "GET", `${CHALLENGE_PATH}?nonce=${authNonce}`, undefined, headers);
  assert.equal(challenge.statusCode, 200);
  assert.equal(challenge.body.nonce, authNonce);
  assert.equal(challenge.body.proof, proof(challengeProofInput(authNonce)));
  const authenticatedBody = {
    ...body,
    authNonce,
    authProof: proof(handoffRequestProofInput({ ...body, authNonce } as Parameters<typeof handoffRequestProofInput>[0])),
  };
  const response = await requestJson(port, "POST", HANDOFF_PATH, authenticatedBody, headers);
  if (response.body.accepted === true) {
    assert.equal(
      response.body.proof,
      proof(handoffResponseProofInput(authNonce, String(response.body.downloadId))),
    );
  }
  return response;
}

test("loopback handoff endpoint advertises status and queues a validated URL", async () => {
  const port = 43_872;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const status = await requestJson(port, "GET", STATUS_PATH);
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.body, { protocol: HANDOFF_PROTOCOL_VERSION, acceptingUrls: true });

    const accepted = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/reports/report.pdf",
      fileName: "Quarterly Report.pdf",
      requestedAt: new Date().toISOString(),
      title: "Report",
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(calls.length, 1);
    assert.equal(accepted.body.downloadId, "download-id");
    assert.deepEqual(calls[0], {
      url: "https://downloads.example.test/reports/report.pdf",
      folder: "C:/Downloads/MaterialDownloadManager",
      fileName: "Quarterly Report.pdf",
      queueId: null,
      startImmediately: true,
    });
  } finally {
    await server.stop();
  }
});

test("loopback handoff accepts only a bounded basename and falls back only when it is absent", () => {
  assert.equal(normalizeOptionalHandoffFileName("Quarterly Report (final).pdf"), "Quarterly Report (final).pdf");
  assert.equal(normalizeOptionalHandoffFileName(undefined), undefined);
  assert.equal(
    parseHandoffEnvelope({
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/report",
      authNonce: "1".repeat(64),
      authProof: "2".repeat(64),
    }).fileName,
    undefined,
  );

  for (const invalid of [
    "",
    null,
    ".",
    "..",
    "../report.pdf",
    "folder/report.pdf",
    "folder\\report.pdf",
    "/tmp/report.pdf",
    "C:\\Downloads\\report.pdf",
    "C:report.pdf",
    "report:alternate.pdf",
    "report.pdf.",
    "report.pdf ",
    "report\u0000.pdf",
    "x".repeat(MAX_HANDOFF_FILE_NAME_LENGTH + 1),
  ]) {
    assert.throws(() => normalizeOptionalHandoffFileName(invalid), /Invalid handoff file name/);
  }
});

test("loopback handoff permits Chromium extension origins and rejects website origins", async () => {
  const port = 43_878;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const accepted = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/report.pdf",
    }, { origin: extensionOrigin });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.headers["access-control-allow-origin"], extensionOrigin);

    const rejected = await requestJson(port, "POST", HANDOFF_PATH, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/website-trigger.zip",
    }, { origin: "https://attacker.example" });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.headers["access-control-allow-origin"], undefined);
    assert.equal(calls.length, 1);
  } finally {
    await server.stop();
  }
});

test("loopback handoff requires a fresh capability proof and rejects replay", async () => {
  const port = 43_880;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const authNonce = randomBytes(32).toString("hex");
    const challenge = await requestJson(port, "GET", `${CHALLENGE_PATH}?nonce=${authNonce}`);
    assert.equal(challenge.statusCode, 200);
    const base = {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/replay.zip",
      authNonce,
    } as const;
    const rejected = await requestJson(port, "POST", HANDOFF_PATH, { ...base, authProof: "0".repeat(64) });
    assert.equal(rejected.statusCode, 403);
    const validProof = proof(handoffRequestProofInput(base));
    const replayed = await requestJson(port, "POST", HANDOFF_PATH, { ...base, authProof: validProof });
    assert.equal(replayed.statusCode, 403, "a consumed challenge must not authorize a replay");
    assert.equal(calls.length, 0);
  } finally {
    await server.stop();
  }
});

test("loopback handoff bounds concurrent authenticated probes", async () => {
  const port = 43_881;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let started = 0;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      started += 1;
      await barrier;
      return `download-${started}`;
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const active = Array.from({ length: MAX_ACTIVE_HANDOFFS }, (_, index) => authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: `https://downloads.example.test/active-${index}.zip`,
    }));
    for (let attempt = 0; attempt < 100 && started < MAX_ACTIVE_HANDOFFS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(started, MAX_ACTIVE_HANDOFFS);
    const refused = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/one-too-many.zip",
    });
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.headers["retry-after"], "1");
    release();
    await Promise.all(active);
  } finally {
    release();
    await server.stop();
  }
});

test("loopback handoff derives the queued filename from the URL when fileName is absent", async () => {
  const port = 43_877;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const accepted = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/reports/report.pdf",
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(calls.length, 1);
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

test("loopback handoff rejects a supplied path instead of falling back to the URL basename", async () => {
  const port = 43_876;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const rejected = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/safe-fallback.pdf",
      fileName: "../outside.pdf",
    });
    assert.equal(rejected.statusCode, 400);
    assert.match(String(rejected.body.error), /Invalid handoff file name/);
    assert.equal(calls.length, 0);
  } finally {
    await server.stop();
  }
});
test("loopback handoff reports queue failures instead of claiming acceptance", async () => {
  const port = 43_874;
  const messages: string[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      throw new Error("probe failed for https://example.test/file.zip");
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY, logger: (message) => messages.push(message) });
  assert.equal(await server.start(), true);
  try {
    const rejected = await authenticatedPost(port, {
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

test("loopback handoff waits for durable acceptance instead of returning a duplicate-prone pending state", async () => {
  const port = 43_875;
  let completed = false;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      completed = true;
      return "slow-download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const acknowledged = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/slow.zip",
    });
    assert.equal(acknowledged.statusCode, 202);
    assert.equal(acknowledged.body.accepted, true);
    assert.equal(acknowledged.body.downloadId, "slow-download-id");
    assert.equal(completed, true);
  } finally {
    await server.stop();
  }
});

test("loopback handoff rolls back a durable queue item when the client disconnects before acceptance", async () => {
  const port = 43_882;
  let releaseQueue!: () => void;
  const queueBarrier = new Promise<void>((resolve) => { releaseQueue = resolve; });
  let markStarted!: () => void;
  const queueStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  const rolledBack: string[] = [];
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      markStarted();
      await queueBarrier;
      return "disconnected-download-id";
    },
    rollbackBrowserHandoff: async (downloadId: string) => {
      rolledBack.push(downloadId);
    },
  };
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const authNonce = randomBytes(32).toString("hex");
    const challenge = await requestJson(port, "GET", `${CHALLENGE_PATH}?nonce=${authNonce}`);
    assert.equal(challenge.statusCode, 200);
    const base = {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/disconnected.zip",
      authNonce,
    } as const;
    const payload = JSON.stringify({
      ...base,
      authProof: proof(handoffRequestProofInput(base)),
    });
    const client = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: HANDOFF_PATH,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    });
    const clientClosed = new Promise<void>((resolve) => {
      client.once("error", () => resolve());
      client.once("close", () => resolve());
    });
    client.end(payload);
    await queueStarted;
    client.destroy();
    await clientClosed;
    releaseQueue();
    for (let attempt = 0; attempt < 100 && rolledBack.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.deepEqual(rolledBack, ["disconnected-download-id"]);
  } finally {
    releaseQueue();
    await server.stop();
  }
});

test("loopback handoff returns a final failure when a slow durable queue rejects", async () => {
  const port = 43_879;
  const messages: string[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      throw new Error("delayed durable queue failure");
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY, logger: (message) => messages.push(message) });
  assert.equal(await server.start(), true);
  try {
    const rejected = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/slow-failure.zip",
    });
    assert.equal(rejected.statusCode, 500);
    assert.deepEqual(rejected.body, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      accepted: false,
      error: "The download could not be queued.",
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /delayed durable queue failure/);
  } finally {
    await server.stop();
  }
});

test("loopback handoff endpoint rejects credentials and oversized bodies", async () => {
  assert.throws(() => normalizeHandoffUrl("https://user:password@example.test/file"), /credentials/);
  const port = 43_873;
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const rejected = await authenticatedPost(port, {
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
