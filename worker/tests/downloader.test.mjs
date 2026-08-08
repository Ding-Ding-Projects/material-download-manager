import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";

import { DEFAULT_TIMEOUTS, downloadRange } from "../dist/downloader.js";

const CONTENT = Buffer.from("0123456789abcdef", "utf8");
const ETAG = '"range-v1"';

function requestFor(url, overrides = {}) {
  return {
    version: 1,
    type: "range-request",
    requestId: "request-1",
    pieceId: "piece-1",
    url,
    range: { start: 2, endExclusive: 8 },
    headers: { "user-agent": "mdm-worker-test" },
    source: { length: CONTENT.length, etag: ETAG, lastModified: null },
    ...overrides,
  };
}

function makeSink() {
  const events = [];
  return {
    events,
    sink: {
      meta: async (frame) => events.push({ type: "meta", frame }),
      data: async (chunk) => events.push({ type: "data", chunk: Buffer.from(chunk) }),
      end: async (frame) => events.push({ type: "end", frame }),
    },
  };
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, port: address.port };
}

async function close(server) {
  server.close();
  await once(server, "close");
}

function localDependencies(overrides = {}) {
  return {
    resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    addressPolicy: () => true,
    timeouts: { ...DEFAULT_TIMEOUTS, connectMs: 1_000, headersMs: 1_000, idleMs: 1_000, wallMs: 3_000 },
    ...overrides,
  };
}

function sendRange(response, headers = {}) {
  const body = CONTENT.subarray(2, 8);
  response.writeHead(206, {
    "content-range": `bytes 2-7/${CONTENT.length}`,
    "content-length": body.length,
    etag: ETAG,
    ...headers,
  });
  response.end(body);
}

test("a verified range emits exact META, DATA, and END frames with pinned hostname routing", async () => {
  let observed;
  const { server, port } = await listen((request, response) => {
    observed = { host: request.headers.host, range: request.headers.range, encoding: request.headers["accept-encoding"] };
    sendRange(response);
  });
  try {
    const capture = makeSink();
    const result = await downloadRange(
      requestFor(`http://range.test:${port}/file.bin?temporary=credential`),
      capture.sink,
      localDependencies(),
    );
    const data = Buffer.concat(capture.events.filter((event) => event.type === "data").map((event) => event.chunk));
    assert.deepEqual(observed, { host: `range.test:${port}`, range: "bytes=2-7", encoding: "identity" });
    assert.deepEqual(data, CONTENT.subarray(2, 8));
    assert.deepEqual(capture.events.map((event) => event.type), ["meta", "data", "end"]);
    assert.equal(capture.events[0].frame.type, "meta");
    assert.equal(result.type, "end");
    assert.equal(result.byteLength, 6);
    assert.equal(result.sha256, createHash("sha256").update(CONTENT.subarray(2, 8)).digest("hex"));
  } finally {
    await close(server);
  }
});

test("cross-origin redirect handling strips credentials before the first redirected request", async () => {
  let redirectedHeaders;
  const resolvedHosts = [];
  const destination = await listen((request, response) => {
    redirectedHeaders = request.headers;
    sendRange(response);
  });
  const origin = await listen((_request, response) => {
    response.writeHead(302, { location: `http://destination.test:${destination.port}/file.bin` });
    response.end();
  });
  try {
    const capture = makeSink();
    await downloadRange(
      requestFor(`http://origin.test:${origin.port}/file.bin`, {
        headers: {
          authorization: "Bearer should-not-cross",
          cookie: "session=should-not-cross",
          "x-api-key": "should-not-cross",
          referer: "http://origin.test/file?credential=should-not-cross",
          "user-agent": "mdm-worker-test",
        },
      }),
      capture.sink,
      localDependencies({
        resolveHost: async (hostname) => {
          resolvedHosts.push(hostname);
          return [{ address: "127.0.0.1", family: 4 }];
        },
      }),
    );
    assert.equal(redirectedHeaders.authorization, undefined);
    assert.equal(redirectedHeaders.cookie, undefined);
    assert.equal(redirectedHeaders["x-api-key"], undefined);
    assert.equal(redirectedHeaders.referer, undefined);
    assert.equal(redirectedHeaders["user-agent"], "mdm-worker-test");
    assert.deepEqual(resolvedHosts, ["origin.test", "destination.test"]);
  } finally {
    await close(origin.server);
    await close(destination.server);
  }
});

test("pinned HTTPS lookup retains the original hostname for TLS verification", async () => {
  let observedOptions;
  const requestHttps = (options) => {
    observedOptions = options;
    const transport = new EventEmitter();
    transport.setTimeout = () => transport;
    transport.destroy = (error) => {
      if (error) transport.emit("error", error);
    };
    transport.end = () => {
      setImmediate(() => {
        const body = CONTENT.subarray(2, 8);
        const response = Readable.from([body]);
        response.statusCode = 206;
        response.headers = {
          "content-range": `bytes 2-7/${CONTENT.length}`,
          "content-length": String(body.length),
          etag: ETAG,
        };
        response.setTimeout = () => response;
        transport.emit("response", response);
      });
    };
    return transport;
  };
  const capture = makeSink();
  await downloadRange(
    requestFor("https://downloads.example/file"),
    capture.sink,
    localDependencies({
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
      addressPolicy: undefined,
      requestHttps,
    }),
  );
  assert.equal(observedOptions.hostname, "downloads.example");
  assert.equal(observedOptions.servername, "downloads.example");
  const pinned = await new Promise((resolve, reject) => {
    observedOptions.lookup("downloads.example", { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinned, { address: "8.8.8.8", family: 4 });
});

test("status, content range, content length, encoding, and identity mismatches fail before DATA", async (t) => {
  const cases = [
    ["status", (response) => response.writeHead(200, { "content-length": 6, etag: ETAG }), "source-changed"],
    ["content-range", (response) => response.writeHead(206, { "content-range": `bytes 3-8/${CONTENT.length}`, "content-length": 6, etag: ETAG }), "range-rejected"],
    ["content-length", (response) => response.writeHead(206, { "content-range": `bytes 2-7/${CONTENT.length}`, "content-length": 5, etag: ETAG }), "range-rejected"],
    ["content-encoding", (response) => response.writeHead(206, { "content-range": `bytes 2-7/${CONTENT.length}`, "content-length": 6, "content-encoding": "gzip", etag: ETAG }), "range-rejected"],
    ["duplicate-content-encoding", (response) => response.writeHead(206, { "content-range": `bytes 2-7/${CONTENT.length}`, "content-length": 6, "content-encoding": ["identity", "identity"], etag: ETAG }), "range-rejected"],
    ["source-identity", (response) => response.writeHead(206, { "content-range": `bytes 2-7/${CONTENT.length}`, "content-length": 6, etag: '"changed"' }), "source-changed"],
    ["duplicate-source-identity", (response) => response.writeHead(206, { "content-range": `bytes 2-7/${CONTENT.length}`, "content-length": 6, etag: [ETAG, '"changed"'] }), "source-changed"],
  ];
  for (const [name, writeHeaders, expectedCode] of cases) {
    await t.test(name, async () => {
      const { server, port } = await listen((_request, response) => {
        writeHeaders(response);
        response.end(CONTENT.subarray(2, 8));
      });
      try {
        const capture = makeSink();
        await assert.rejects(
          downloadRange(requestFor(`http://range.test:${port}/file`), capture.sink, localDependencies()),
          (error) => error.code === expectedCode,
        );
        assert.deepEqual(capture.events, []);
      } finally {
        await close(server);
      }
    });
  }
});

test("every supplied source validator must match the response", async () => {
  const expectedLastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
  const { server, port } = await listen((_request, response) => {
    sendRange(response, { "last-modified": "Thu, 22 Oct 2015 07:28:00 GMT" });
  });
  try {
    const capture = makeSink();
    await assert.rejects(
      downloadRange(
        requestFor(`http://range.test:${port}/file`, {
          source: { length: CONTENT.length, etag: ETAG, lastModified: expectedLastModified },
        }),
        capture.sink,
        localDependencies(),
      ),
      (error) => error.code === "source-changed",
    );
    assert.deepEqual(capture.events, []);
  } finally {
    await close(server);
  }
});

test("a truncated body never emits END and returns only a generic transfer error", async () => {
  const { server, port } = await listen((_request, response) => {
    const body = CONTENT.subarray(2, 8);
    response.writeHead(206, {
      "content-range": `bytes 2-7/${CONTENT.length}`,
      "content-length": body.length,
      etag: ETAG,
    });
    response.end(body.subarray(0, 3));
  });
  try {
    const capture = makeSink();
    await assert.rejects(
      downloadRange(requestFor(`http://range.test:${port}/file`), capture.sink, localDependencies()),
      (error) => error.code === "transfer-failed"
        && error.message === "The worker could not complete the byte range.",
    );
    assert.equal(capture.events.some((event) => event.type === "meta"), true);
    assert.equal(capture.events.some((event) => event.type === "end"), false);
  } finally {
    await close(server);
  }
});

test("redirect limits fail closed before metadata is emitted", async () => {
  const { server, port } = await listen((_request, response) => {
    response.writeHead(302, { location: "/again" });
    response.end();
  });
  try {
    const capture = makeSink();
    await assert.rejects(
      downloadRange(
        requestFor(`http://range.test:${port}/file`),
        capture.sink,
        localDependencies({ maxRedirects: 0 }),
      ),
      (error) => error.code === "source-unavailable",
    );
    assert.deepEqual(capture.events, []);
  } finally {
    await close(server);
  }
});

test("private DNS answers are rejected before a socket is opened", async () => {
  const capture = makeSink();
  await assert.rejects(
    downloadRange(
      requestFor("http://private.test/file"),
      capture.sink,
      { resolveHost: async () => [{ address: "127.0.0.1", family: 4 }] },
    ),
    (error) => error.code === "source-unavailable",
  );
  assert.deepEqual(capture.events, []);
});

test("header and wall timeouts are bounded and use generic errors", async () => {
  const { server, port } = await listen(() => undefined);
  try {
    const capture = makeSink();
    const started = Date.now();
    await assert.rejects(
      downloadRange(
        requestFor(`http://range.test:${port}/file`),
        capture.sink,
        localDependencies({ timeouts: { ...DEFAULT_TIMEOUTS, connectMs: 200, headersMs: 50, idleMs: 100, wallMs: 200 } }),
      ),
      (error) => error.code === "source-unavailable" && error.message === "The source is unavailable to the worker.",
    );
    assert.equal(Date.now() - started < 1_000, true);
  } finally {
    await close(server);
  }
});
