import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import ssh2 from "ssh2";

import { DEFAULT_TIMEOUTS } from "../dist/downloader.js";
import { FrameDecoder, FrameType, encodeJsonFrame } from "../dist/protocol.js";
import { PublicKeyAuthGate, WorkerServer, registerRejectedSessionCapabilities } from "../dist/server.js";

const { Client, utils } = ssh2;
const execFileAsync = promisify(execFile);

const CONTENT = Buffer.from("abcdefghij", "utf8");
const ETAG = '"worker-v1"';

function parsedKey(raw) {
  const parsed = utils.parseKey(raw);
  if (parsed instanceof Error) throw parsed;
  return parsed;
}

function workerConfig(hostKey, clientKey) {
  return {
    bindHost: "127.0.0.1",
    port: 0,
    username: "mdm-worker",
    hostKey,
    allowedClientKeys: [clientKey],
    maxConnections: 8,
    maxConcurrentFetches: 2,
    authTimeoutMs: 2_000,
    requestTimeoutMs: 1_000,
    downloadTimeouts: { ...DEFAULT_TIMEOUTS, connectMs: 1_000, headersMs: 1_000, idleMs: 1_000, wallMs: 3_000 },
  };
}

async function listenHttp(handler) {
  const server = createHttpServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

async function closeHttp(server) {
  server.close();
  await once(server, "close");
  assert.equal(server.listening, false);
}

function connectClient(port, privateKey, username = "mdm-worker") {
  const client = new Client();
  const ready = new Promise((resolve, reject) => {
    client.once("ready", () => resolve(client));
    client.once("error", reject);
  });
  client.connect({
    host: "127.0.0.1",
    port,
    username,
    privateKey,
    readyTimeout: 2_000,
    hostVerifier: () => true,
    strictVendor: false,
  });
  return ready;
}

function request(url) {
  return {
    version: 1,
    type: "range-request",
    requestId: "lease-1",
    pieceId: "piece-1",
    url,
    range: { start: 2, endExclusive: 7 },
    headers: { "user-agent": "mdm-ssh-test" },
    source: { length: CONTENT.length, etag: ETAG, lastModified: null },
  };
}

async function execute(client, command, payload) {
  return await new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) {
        reject(error);
        return;
      }
      const decoder = new FrameDecoder();
      const frames = [];
      channel.on("data", (chunk) => frames.push(...decoder.push(chunk)));
      channel.once("error", reject);
      channel.once("close", () => resolve(frames));
      if (Buffer.isBuffer(payload)) channel.end(payload);
      else if (payload) channel.end(encodeJsonFrame(FrameType.REQUEST, payload));
      else channel.end();
    });
  });
}

test("the authentication gate disconnects on the third failed attempt", () => {
  const keyPair = utils.generateKeyPairSync("ed25519");
  const metrics = { authQueriesAccepted: 0, authSignaturesVerified: 0 };
  const gate = new PublicKeyAuthGate({ username: "mdm-worker", allowedClientKeys: [parsedKey(keyPair.public)] }, metrics);
  let rejects = 0;
  const context = {
    method: "none",
    username: "mdm-worker",
    accept: () => assert.fail("invalid authentication must not be accepted"),
    reject: () => { rejects += 1; },
  };
  assert.deepEqual(gate.handle(context), { accepted: false, disconnect: false });
  assert.deepEqual(gate.handle(context), { accepted: false, disconnect: false });
  assert.deepEqual(gate.handle(context), { accepted: false, disconnect: true });
  assert.equal(rejects, 3);
});

test("every session capability other than the fixed exec path is rejected", () => {
  const session = new EventEmitter();
  let policyRejects = 0;
  let transportRejects = 0;
  let accepts = 0;
  registerRejectedSessionCapabilities(session, () => { policyRejects += 1; });
  for (const name of ["pty", "window-change", "x11", "env", "signal", "auth-agent", "shell", "sftp", "subsystem"])
    session.emit(name, () => { accepts += 1; }, () => { transportRejects += 1; }, {});
  assert.equal(policyRejects, 9);
  assert.equal(transportRejects, 9);
  assert.equal(accepts, 0);
});

test("signed allowlisted Ed25519 auth executes one range and emits META DATA END", { timeout: 5_000 }, async () => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const clientPair = utils.generateKeyPairSync("ed25519");
  const source = await listenHttp((_request, response) => {
    const body = CONTENT.subarray(2, 7);
    response.writeHead(206, {
      "content-range": `bytes 2-6/${CONTENT.length}`,
      "content-length": body.length,
      etag: ETAG,
    });
    response.end(body);
  });
  const server = new WorkerServer(
    workerConfig(Buffer.from(hostPair.private), parsedKey(clientPair.public)),
    {
      downloadDependencies: {
        resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
        addressPolicy: () => true,
      },
    },
  );
  const address = await server.listen();
  let client;
  try {
    client = await connectClient(address.port, clientPair.private);
    const frames = await execute(client, "mdm-download-v1", request(`http://range.test:${source.port}/file`));
    assert.deepEqual(frames.map((frame) => frame.type), [FrameType.META, FrameType.DATA, FrameType.END]);
    assert.deepEqual(frames[1].payload, CONTENT.subarray(2, 7));
    assert.equal(JSON.parse(frames[0].payload).type, "meta");
    assert.equal(JSON.parse(frames[2].payload).type, "end");
    assert.equal(server.metrics.authQueriesAccepted >= 1, true);
    assert.equal(server.metrics.authSignaturesVerified, 1);
    assert.equal(server.metrics.completedFetches, 1);
  } finally {
    client?.end();
    await server.close();
    assert.equal(server.listening, false);
    await closeHttp(source.server);
  }
});

test("a non-allowlisted key cannot authenticate", { timeout: 5_000 }, async () => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const allowedPair = utils.generateKeyPairSync("ed25519");
  const rejectedPair = utils.generateKeyPairSync("ed25519");
  const server = new WorkerServer(workerConfig(Buffer.from(hostPair.private), parsedKey(allowedPair.public)));
  const address = await server.listen();
  try {
    await assert.rejects(connectClient(address.port, rejectedPair.private), /authentication methods failed/u);
    assert.equal(server.metrics.authSignaturesVerified, 0);
  } finally {
    await server.close();
  }
});

test("malformed framing returns one generic ERROR with null identifiers", { timeout: 5_000 }, async () => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const clientPair = utils.generateKeyPairSync("ed25519");
  const server = new WorkerServer(workerConfig(Buffer.from(hostPair.private), parsedKey(clientPair.public)));
  const address = await server.listen();
  let client;
  try {
    client = await connectClient(address.port, clientPair.private);
    const hostileHeader = Buffer.alloc(5);
    hostileHeader.writeUInt8(FrameType.REQUEST, 0);
    hostileHeader.writeUInt32BE(65_537, 1);
    const frames = await execute(client, "mdm-download-v1", hostileHeader);
    assert.deepEqual(frames.map((frame) => frame.type), [FrameType.ERROR]);
    assert.deepEqual(JSON.parse(frames[0].payload), {
      version: 1,
      type: "error",
      requestId: null,
      pieceId: null,
      code: "invalid-request",
      message: "The worker rejected the range request.",
      retryable: false,
    });
  } finally {
    client?.end();
    await server.close();
  }
});

test("concurrent fetches are admitted only up to the configured bound", { timeout: 8_000 }, async () => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const clientPair = utils.generateKeyPairSync("ed25519");
  let releaseSource;
  let markStarted;
  const sourceStarted = new Promise((resolve) => { markStarted = resolve; });
  const sourceReleased = new Promise((resolve) => { releaseSource = resolve; });
  const source = await listenHttp(async (_request, response) => {
    markStarted();
    await sourceReleased;
    const body = CONTENT.subarray(2, 7);
    response.writeHead(206, {
      "content-range": `bytes 2-6/${CONTENT.length}`,
      "content-length": body.length,
      etag: ETAG,
    });
    response.end(body);
  });
  const config = workerConfig(Buffer.from(hostPair.private), parsedKey(clientPair.public));
  config.maxConcurrentFetches = 1;
  const server = new WorkerServer(config, {
    downloadDependencies: {
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      addressPolicy: () => true,
    },
  });
  const address = await server.listen();
  let firstClient;
  let secondClient;
  try {
    [firstClient, secondClient] = await Promise.all([
      connectClient(address.port, clientPair.private),
      connectClient(address.port, clientPair.private),
    ]);
    const first = execute(firstClient, "mdm-download-v1", request(`http://range.test:${source.port}/first`));
    await sourceStarted;
    const rejectedFrames = await execute(secondClient, "mdm-download-v1", request(`http://range.test:${source.port}/second`));
    assert.deepEqual(rejectedFrames.map((frame) => frame.type), [FrameType.ERROR]);
    const rejected = JSON.parse(rejectedFrames[0].payload);
    assert.equal(rejected.code, "transfer-failed");
    assert.equal(rejected.message, "The worker could not complete the byte range.");
    assert.equal(rejected.retryable, true);
    releaseSource();
    const acceptedFrames = await first;
    assert.deepEqual(acceptedFrames.map((frame) => frame.type), [FrameType.META, FrameType.DATA, FrameType.END]);
    assert.equal(server.metrics.completedFetches, 1);
  } finally {
    releaseSource?.();
    firstClient?.end();
    secondClient?.end();
    await server.close();
    await closeHttp(source.server);
  }
});

test("the container healthcheck validates the restricted SSH banner", { timeout: 5_000 }, async () => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const clientPair = utils.generateKeyPairSync("ed25519");
  const server = new WorkerServer(workerConfig(Buffer.from(hostPair.private), parsedKey(clientPair.public)));
  const address = await server.listen();
  try {
    await execFileAsync(process.execPath, [fileURLToPath(new URL("../dist/healthcheck.js", import.meta.url))], {
      env: { ...process.env, MDM_WORKER_PORT: String(address.port), MDM_WORKER_HEALTH_HOST: "127.0.0.1" },
      timeout: 4_000,
      windowsHide: true,
    });
  } finally {
    await server.close();
    assert.equal(server.listening, false);
  }
});

test("shell, SFTP, arbitrary exec, TCP, and streamlocal forwarding are rejected", { timeout: 20_000 }, async (t) => {
  const hostPair = utils.generateKeyPairSync("ed25519");
  const clientPair = utils.generateKeyPairSync("ed25519");
  const newFixture = async () => {
    const server = new WorkerServer(workerConfig(Buffer.from(hostPair.private), parsedKey(clientPair.public)));
    const address = await server.listen();
    const client = await connectClient(address.port, clientPair.private);
    return { server, client, port: address.port };
  };
  const rejected = async (operation) => {
    const fixture = await newFixture();
    try {
      await assert.rejects(new Promise((resolve, reject) => operation(fixture.client, (error) => error ? reject(error) : resolve())));
      assert.equal(fixture.server.metrics.rejectedCapabilities >= 1, true);
    } finally {
      fixture.client.end();
      await fixture.server.close();
    }
  };
  await t.test("shell", () => rejected((client, callback) => client.shell(false, callback)));
  await t.test("sftp", () => rejected((client, callback) => client.sftp(callback)));
  await t.test("arbitrary exec", () => rejected((client, callback) => client.exec("mdm-download-v1 --extra", callback)));
  await t.test("direct TCP", () => rejected((client, callback) => client.forwardOut("127.0.0.1", 1, "127.0.0.1", 80, callback)));
  await t.test("global forwarding", () => rejected((client, callback) => client.forwardIn("127.0.0.1", 0, callback)));
  await t.test("direct streamlocal forwarding", () => rejected((client, callback) => client.openssh_forwardOutStreamLocal("/tmp/mdm-worker-denied.sock", callback)));
  await t.test("global streamlocal forwarding", () => rejected((client, callback) => client.openssh_forwardInStreamLocal("/tmp/mdm-worker-denied.sock", callback)));
});
