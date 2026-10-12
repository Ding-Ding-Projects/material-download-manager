import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { createDefaultSettings } from "../../shared/settings";
import type { BrowserHandoffStart, BrowserHandoffDecisionState } from "../../shared/types";
import {
  HandoffServer,
  CHALLENGE_PATH,
  HANDOFF_PATH,
  HANDOFF_DECISION_PATH,
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
  handoffDecisionProofInput,
  handoffDecisionResponseProofInput,
  handoffRollbackProofInput,
} from "../extension/HandoffServer";
import { extractBrowserHandoffRequests } from "../download/browserHandoff";

const TEST_CAPABILITY = "a".repeat(43);

function proof(input: string): string {
  return createHmac("sha256", TEST_CAPABILITY).update(input, "utf8").digest("hex");
}

function withRollback<T extends object>(manager: T): T & { rollbackBrowserHandoff: (downloadId: string) => Promise<void> } {
  return Object.assign(manager, { rollbackBrowserHandoff: async (_downloadId: string) => {} });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
}

async function availablePort(): Promise<number> {
  // Keep the ordinary suite and isolated mutation subprocesses independent.
  const probe = http.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
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
        agent: false,
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
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.state, "pending", "acknowledgment must prove a pending Start download decision");
    assert.match(String(response.body.handoffId), /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(response.body.expiresAt));
    assert.ok(Number(response.body.expiresAt) > Date.now());
    assert.equal(response.body.downloadId, undefined, "pending acknowledgment must not claim queue acceptance");
    assert.equal(
      response.body.proof,
      proof(handoffResponseProofInput(authNonce, String(response.body.handoffId))),
    );
  }
  return response;
}

async function authenticatedDecision(port: number, handoffId: string) {
  const response = await requestJson(port, "GET", `${HANDOFF_DECISION_PATH}/${handoffId}?proof=${proof(handoffDecisionProofInput(handoffId))}`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.protocol, HANDOFF_PROTOCOL_VERSION);
  assert.equal(response.body.handoffId, handoffId);
  assert.equal(response.body.proof, proof(handoffDecisionResponseProofInput(
    handoffId, response.body.state as BrowserHandoffDecisionState, response.body.downloadId as string | null,
  )));
  return response;
}

async function approvePending(server: HandoffServer, port: number, handoffId: string) {
  const start = server.getBrowserHandoffStart(handoffId);
  assert.ok(start);
  await server.approveBrowserHandoff(handoffId, { fileName: start.fileName, folder: start.folder });
  const response = await authenticatedDecision(port, handoffId);
  assert.equal(response.body.state, "accepted");
  return response;
}

test("loopback handoff presents a pending decision before queueing a validated URL", async () => {
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
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
    assert.equal(calls.length, 0, "a pending acknowledgment must not enqueue before confirmation");
    const handoffId = String(accepted.body.handoffId);
    const pending = await authenticatedDecision(port, handoffId);
    assert.equal(pending.body.state, "pending");
    assert.equal(pending.body.downloadId, null);
    const start = server.getBrowserHandoffStart(handoffId);
    assert.ok(start);
    assert.equal(start.fileName, "Quarterly Report.pdf");
    assert.equal(start.folder, "C:/Downloads/MaterialDownloadManager");
    assert.equal(start.connections, manager.getSettings().maxConnectionsPerDownload);
    await assert.rejects(server.approveBrowserHandoff(handoffId, { ...start, fileName: "../unsafe.zip" }), /Invalid handoff file name/);
    await assert.rejects(server.approveBrowserHandoff(handoffId, { ...start, folder: "relative-folder" }), /absolute save folder/);
    assert.equal(calls.length, 0);
    const decision = await approvePending(server, port, handoffId);
    assert.equal(decision.body.downloadId, "download-id");
    assert.equal(calls.length, 1);
    await assert.rejects(server.approveBrowserHandoff(handoffId, start), /no longer waiting/);
    assert.equal(calls.length, 1, "a repeated confirmation must not create a duplicate");
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
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
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
    assert.equal(calls.length, 0);
    await approvePending(server, port, String(accepted.body.handoffId));

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
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
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

test("loopback handoff bounds concurrent presentation and pending decisions without enqueueing", async () => {
  const port = await availablePort();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let started = 0;
  let queueCalls = 0;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      queueCalls += 1;
      return `download-${queueCalls}`;
    },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY, presentPendingHandoff: async () => {
    started += 1;
    await barrier;
    return true;
  } });
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
    assert.equal(queueCalls, 0);
    const refused = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/one-too-many.zip",
    });
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.headers["retry-after"], "1");
    release();
    const pending = await Promise.all(active);
    assert.equal(pending.every((response) => response.body.state === "pending"), true);
    assert.equal(queueCalls, 0);
    const full = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/pending-table-full.zip",
    });
    assert.equal(full.statusCode, 429);
    server.rejectBrowserHandoff(String(pending[0].body.handoffId));
    const available = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/released-pending-slot.zip",
    });
    assert.equal(available.statusCode, 202);
    assert.equal(queueCalls, 0);
  } finally {
    release();
    await server.stop();
  }
});

test("loopback handoff derives the queued filename from the URL when fileName is absent", async () => {
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const accepted = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/reports/report.pdf",
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(calls.length, 0);
    await approvePending(server, port, String(accepted.body.handoffId));
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
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
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
test("loopback handoff keeps queue failures pending for retry without claiming acceptance", async () => {
  const port = await availablePort();
  let queueCalls = 0;
  let failQueue = true;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      queueCalls += 1;
      if (failQueue) throw new Error("fixture durable queue failure");
      return "retried-download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const acknowledged = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/file.zip",
    });
    assert.equal(queueCalls, 0);
    const handoffId = String(acknowledged.body.handoffId);
    const start = server.getBrowserHandoffStart(handoffId)!;
    await assert.rejects(server.approveBrowserHandoff(handoffId, start), /fixture durable queue failure/);
    const failed = await authenticatedDecision(port, handoffId);
    assert.equal(failed.body.state, "pending");
    assert.equal(failed.body.downloadId, null);
    failQueue = false;
    const retried = await approvePending(server, port, handoffId);
    assert.equal(retried.body.downloadId, "retried-download-id");
    assert.equal(queueCalls, 2);
  } finally {
    await server.stop();
  }
});

test("loopback handoff returns accepted decisions only after durable confirmation completes", async () => {
  const port = await availablePort();
  const queueStarted = deferred<void>();
  const queueBarrier = deferred<void>();
  let queueCalls = 0;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => {
      queueCalls += 1;
      queueStarted.resolve();
      await queueBarrier.promise;
      return "slow-download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const acknowledged = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/slow.zip",
    });
    assert.equal(queueCalls, 0, "pending acknowledgment must not begin the transfer");
    const handoffId = String(acknowledged.body.handoffId);
    const start = server.getBrowserHandoffStart(handoffId)!;
    const approval = server.approveBrowserHandoff(handoffId, start);
    await queueStarted.promise;
    const waiting = await authenticatedDecision(port, handoffId);
    assert.equal(waiting.body.state, "pending", "an unresolved durable queue operation cannot be accepted");
    assert.equal(waiting.body.downloadId, null);
    await assert.rejects(server.approveBrowserHandoff(handoffId, start), /no longer waiting/);
    assert.equal(server.rejectBrowserHandoff(handoffId).state, "pending");
    assert.equal(queueCalls, 1);
    queueBarrier.resolve();
    assert.equal((await approval).state, "accepted");
    const accepted = await authenticatedDecision(port, handoffId);
    assert.equal(accepted.body.state, "accepted");
    assert.equal(accepted.body.downloadId, "slow-download-id");
  } finally {
    queueBarrier.resolve();
    await server.stop();
  }
});

test("loopback handoff rejects an undelivered pending decision when the client disconnects", async () => {
  const port = await availablePort();
  const presentationStarted = deferred<BrowserHandoffStart>();
  const presentationBarrier = deferred<boolean>();
  let queueCalls = 0;
  const rolledBack: string[] = [];
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => { queueCalls += 1; return "must-not-be-enqueued"; },
    rollbackBrowserHandoff: async (downloadId: string) => { rolledBack.push(downloadId); },
  };
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY, presentPendingHandoff: (start) => {
    presentationStarted.resolve(start);
    return presentationBarrier.promise;
  } });
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
    const payload = JSON.stringify({ ...base, authProof: proof(handoffRequestProofInput(base)) });
    const client = http.request({
      host: "127.0.0.1", port, method: "POST", path: HANDOFF_PATH,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    });
    const clientClosed = new Promise<void>((resolve) => {
      client.once("error", () => resolve());
      client.once("close", () => resolve());
    });
    client.end(payload);
    const start = await presentationStarted.promise;
    assert.equal(queueCalls, 0);
    client.destroy();
    await clientClosed;
    // Let the server observe the socket close before the mocked window renders.
    await new Promise((resolve) => setTimeout(resolve, 10));
    presentationBarrier.resolve(true);
    await waitFor(() => server.getBrowserHandoffDecision(start.id)?.state === "rejected", "disconnected pending decision was not rejected");
    const rejected = await authenticatedDecision(port, start.id);
    assert.equal(rejected.body.state, "rejected");
    assert.equal(rejected.body.downloadId, null);
    assert.equal(queueCalls, 0, "a disconnected presentation must never enqueue");
    assert.deepEqual(rolledBack, [], "no queue item exists before confirmation");
  } finally {
    presentationBarrier.resolve(false);
    await server.stop();
  }
});

test("loopback handoff waits for presentation readiness before pending acknowledgment", async () => {
  const port = await availablePort();
  const presentationStarted = deferred<BrowserHandoffStart>();
  const presentationBarrier = deferred<boolean>();
  let queueCalls = 0;
  let acknowledged = false;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => { queueCalls += 1; return "must-not-be-enqueued"; },
  });
  const server = new HandoffServer({ manager, port, loadCapability: async () => TEST_CAPABILITY, presentPendingHandoff: (start) => {
    presentationStarted.resolve(start);
    return presentationBarrier.promise;
  } });
  assert.equal(await server.start(), true);
  try {
    const request = authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/presentation.zip",
    }).then((response) => { acknowledged = true; return response; });
    const start = await presentationStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(acknowledged, false, "pending acknowledgment must wait for the rendered Start download window");
    assert.equal(queueCalls, 0);
    presentationBarrier.resolve(true);
    const response = await request;
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.handoffId, start.id);
    assert.equal(queueCalls, 0);
    const rejected = server.rejectBrowserHandoff(start.id);
    assert.equal(rejected.state, "rejected");
    const decision = await authenticatedDecision(port, start.id);
    assert.equal(decision.body.state, "rejected");
    await assert.rejects(server.approveBrowserHandoff(start.id, start), /no longer waiting/);
    assert.equal(queueCalls, 0, "Keep in Chrome must not enqueue");
  } finally {
    presentationBarrier.resolve(false);
    await server.stop();
  }
});

test("loopback handoff endpoint rejects credentials and oversized bodies", async () => {
  assert.throws(() => normalizeHandoffUrl("https://user:password@example.test/file"), /credentials/);
  const port = await availablePort();
  const calls: unknown[] = [];
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async (request: unknown) => {
      calls.push(request);
      return "download-id";
    },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const rejected = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://user:password@example.test/file.zip",
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(calls.length, 0);
    const oversized = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/oversized.zip",
      title: "x".repeat(20_000),
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(calls.length, 0);
  } finally {
    await server.stop();
  }
});

test("loopback handoff fails closed when presentation is missing, refused, or throws", async () => {
  const port = await availablePort();
  for (const mode of ["missing", "refused", "throws"]) {
    let queueCalls = 0;
    const presented: BrowserHandoffStart[] = [];
    const manager = withRollback({
      getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
      addBrowserHandoff: async () => { queueCalls += 1; return "must-not-be-enqueued"; },
    });
    const server = new HandoffServer({
      manager, port, loadCapability: async () => TEST_CAPABILITY,
      ...(mode === "missing" ? {} : { presentPendingHandoff: (start: BrowserHandoffStart) => {
        presented.push(start);
        if (mode === "throws") throw new Error("fixture renderer could not load");
        return false;
      } }),
    });
    assert.equal(await server.start(), true);
    try {
      const response = await authenticatedPost(port, {
        protocol: HANDOFF_PROTOCOL_VERSION,
        source: "material-download-manager-extension",
        url: "https://downloads.example.test/unshown.zip",
      });
      assert.equal(response.statusCode, mode === "throws" ? 500 : 503, `${mode} presentation must not receive pending acknowledgment`);
      assert.equal(response.body.accepted, false);
      assert.equal(response.body.handoffId, undefined);
      assert.equal(queueCalls, 0);
      assert.equal(presented.length, mode === "missing" ? 0 : 1);
      for (const start of presented) {
        const decision = await authenticatedDecision(port, start.id);
        assert.equal(decision.body.state, "rejected");
        assert.equal(decision.body.downloadId, null);
      }
    } finally {
      await server.stop();
    }
  }
});

test("loopback handoff authenticates decisions and expires without queue acceptance", async (t) => {
  const port = await availablePort();
  let queueCalls = 0;
  const manager = withRollback({
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => { queueCalls += 1; return "must-not-be-enqueued"; },
  });
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const response = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/expiring.zip",
    });
    const handoffId = String(response.body.handoffId);
    const start = server.getBrowserHandoffStart(handoffId)!;
    for (const suppliedProof of ["", "0".repeat(64), proof(handoffDecisionProofInput("f".repeat(64)))]) {
      const rejected = await requestJson(port, "GET", `${HANDOFF_DECISION_PATH}/${handoffId}?proof=${suppliedProof}`);
      assert.equal(rejected.statusCode, 403, "unauthenticated polls must not disclose a decision");
      assert.equal(rejected.body.state, undefined);
      assert.equal(queueCalls, 0);
    }
    const pending = await authenticatedDecision(port, handoffId);
    assert.equal(pending.body.state, "pending");
    t.mock.method(Date, "now", () => start.expiresAt + 1);
    const expired = await authenticatedDecision(port, handoffId);
    assert.equal(expired.body.state, "expired");
    assert.equal(expired.body.downloadId, null);
    assert.equal(server.getBrowserHandoffStart(handoffId), null);
    await assert.rejects(server.approveBrowserHandoff(handoffId, start), /no longer waiting/);
    assert.equal(queueCalls, 0);
  } finally {
    await server.stop();
  }
});

test("loopback handoff authenticates rollback and retains acceptance until removal succeeds", async () => {
  const port = await availablePort();
  const rollbackStarted = deferred<void>();
  const rollbackBarrier = deferred<void>();
  const removed: string[] = [];
  let failRollback = true;
  const manager = {
    getSettings: () => createDefaultSettings("C:/Downloads/MaterialDownloadManager"),
    addBrowserHandoff: async () => "rollback-download-id",
    rollbackBrowserHandoff: async (downloadId: string) => {
      removed.push(downloadId);
      if (failRollback) throw new Error("fixture partial-file removal failed");
      rollbackStarted.resolve();
      await rollbackBarrier.promise;
    },
  };
  const server = new HandoffServer({ manager, port, presentPendingHandoff: () => true, loadCapability: async () => TEST_CAPABILITY });
  assert.equal(await server.start(), true);
  try {
    const response = await authenticatedPost(port, {
      protocol: HANDOFF_PROTOCOL_VERSION,
      source: "material-download-manager-extension",
      url: "https://downloads.example.test/rollback.zip",
    });
    const handoffId = String(response.body.handoffId);
    await approvePending(server, port, handoffId);
    const route = `${HANDOFF_DECISION_PATH}/${handoffId}/rollback`;
    const body = { downloadId: "rollback-download-id", proof: proof(handoffRollbackProofInput(handoffId, "rollback-download-id")) };
    const forged = await requestJson(port, "POST", route, { ...body, proof: "0".repeat(64) });
    assert.equal(forged.statusCode, 403);
    const mismatched = await requestJson(port, "POST", route, {
      downloadId: "unrelated-download-id",
      proof: proof(handoffRollbackProofInput(handoffId, "unrelated-download-id")),
    });
    assert.equal(mismatched.statusCode, 409);
    assert.deepEqual(removed, []);
    const failed = await requestJson(port, "POST", route, body);
    assert.equal(failed.statusCode, 400);
    const retained = await authenticatedDecision(port, handoffId);
    assert.equal(retained.body.state, "accepted", "failed rollback must preserve accepted ownership to prevent duplicates");
    assert.equal(retained.body.downloadId, "rollback-download-id");

    failRollback = false;
    const rollback = requestJson(port, "POST", route, body);
    await rollbackStarted.promise;
    const removing = await authenticatedDecision(port, handoffId);
    assert.equal(removing.body.state, "accepted", "rollback must await removal before permitting browser recovery");
    const concurrent = await requestJson(port, "POST", route, body);
    assert.equal(concurrent.statusCode, 409);
    rollbackBarrier.resolve();
    const completed = await rollback;
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.body.state, "rejected");
    assert.equal(completed.body.downloadId, null);
    assert.equal(completed.body.proof, proof(handoffDecisionResponseProofInput(handoffId, "rejected", null)));
    assert.deepEqual(removed, ["rollback-download-id", "rollback-download-id"]);
    const terminal = await authenticatedDecision(port, handoffId);
    assert.equal(terminal.body.state, "rejected");
    assert.equal((await requestJson(port, "POST", route, body)).statusCode, 409);
  } finally {
    rollbackBarrier.resolve();
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
