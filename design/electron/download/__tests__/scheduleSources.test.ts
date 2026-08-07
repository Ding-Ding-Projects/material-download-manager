import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  isSafeScheduleUrl,
  resolveScheduleSource,
  ScheduleSourceResolver,
  validateScheduleSourceDefinition,
  validateScheduledSettings,
  type ScheduleSource,
} from "../scheduleSources";

interface TestServer {
  url: string;
  requests: Array<{ path: string; authorization: string | undefined }>;
  close(): Promise<void>;
}

async function startServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse, requests: TestServer["requests"]) => void,
): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url ?? "", authorization: request.headers.authorization });
    handler(request, response, requests);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function baseSettings() {
  return { theme: "dark" as const, languageMode: "english" as const, uiFontSize: 14 };
}

test("schedule URL validation rejects credentials, query secrets, private API targets, and non-loopback HTTP", () => {
  assert.equal(isSafeScheduleUrl("https://example.com/schedule"), true);
  assert.equal(isSafeScheduleUrl("https://user:password@example.com/schedule"), false);
  assert.equal(isSafeScheduleUrl("https://example.com/schedule?token=secret"), false);
  assert.equal(isSafeScheduleUrl("http://192.168.1.10/schedule", { allowLoopbackHttp: true }), false);
  assert.equal(isSafeScheduleUrl("http://127.0.0.1:8080/schedule"), false);
  assert.equal(isSafeScheduleUrl("http://127.0.0.1:8080/schedule", { allowLoopbackHttp: true }), true);
  assert.equal(isSafeScheduleUrl("https://192.168.1.10/schedule", { allowPrivateHttps: true }), true);
});

test("local schedule sources validate allowlisted settings and fail safe on malformed values", async () => {
  const applied = await resolveScheduleSource({
    kind: "local",
    active: true,
    settings: { theme: "light", uiFontSize: 18 },
  }, baseSettings());
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.settings, { theme: "light", languageMode: "english", uiFontSize: 18 });

  const malformed = await resolveScheduleSource({
    kind: "local",
    active: true,
    settings: { unknownSetting: "nope" },
  }, baseSettings());
  assert.equal(malformed.status, "fallback");
  assert.deepEqual(malformed.settings, baseSettings());
  assert.equal(malformed.reason?.includes("unknownSetting"), false);
  assert.throws(() => validateScheduledSettings({ settingsVersion: 99 }), /Unknown scheduled setting/i);
  assert.throws(() => validateScheduleSourceDefinition({ kind: "home-assistant", baseUrl: "https://ha.example", entityId: "sensor.not_boolean", settings: {}, getAccessToken: async () => "x" }), /boolean entity/i);
});

test("API schedule source uses bounded real HTTP, versioned settings, and no redirects", async () => {
  const server = await startServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/schedule" });
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ version: 1, active: true, settings: { theme: "light", funnyLevelEnglish: 3 } }));
  });
  try {
    const result = await resolveScheduleSource({ kind: "api", url: `${server.url}/schedule` }, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(result.status, "applied");
    assert.equal(result.settings.theme, "light");
    assert.equal(result.settings.funnyLevelEnglish, 3);
    assert.equal(server.requests[0].authorization, undefined);

    const redirected = await resolveScheduleSource({ kind: "api", url: `${server.url}/redirect` }, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(redirected.status, "fallback");
    assert.deepEqual(redirected.settings, baseSettings());
  } finally {
    await server.close();
  }
});

test("API schedule failures preserve the previous valid state and enforce response limits", async () => {
  const server = await startServer((request, response) => {
    if (request.url === "/large") {
      const body = "x".repeat(2_048);
      response.setHeader("Content-Length", String(Buffer.byteLength(body)));
      response.end(body);
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ version: 2, active: true, settings: { theme: "light" } }));
  });
  try {
    const previous = { ...baseSettings(), theme: "light" as const };
    const invalid = await resolveScheduleSource({ kind: "api", url: `${server.url}/invalid` }, baseSettings(), { allowLoopbackHttp: true }, previous);
    assert.equal(invalid.status, "fallback");
    assert.deepEqual(invalid.settings, previous);
    assert.equal(invalid.reason?.includes("version"), false);

    const oversized = await resolveScheduleSource({ kind: "api", url: `${server.url}/large` }, baseSettings(), { allowLoopbackHttp: true, maxResponseBytes: 64 }, previous);
    assert.equal(oversized.status, "fallback");
    assert.deepEqual(oversized.settings, previous);
  } finally {
    await server.close();
  }
});

test("Home Assistant sources use a boolean entity endpoint and never return the access token", async () => {
  const token = "home-assistant-secret";
  const server = await startServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ entity_id: request.url, state: "on", attributes: { ignored: true } }));
  });
  try {
    const source: ScheduleSource = {
      kind: "home-assistant",
      baseUrl: server.url,
      entityId: "input_boolean.work_mode",
      settings: { density: "compact" },
      getAccessToken: async () => token,
    };
    const result = await resolveScheduleSource(source, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(result.status, "applied");
    assert.equal(result.settings.density, "compact");
    assert.equal(server.requests[0].path, "/api/states/input_boolean.work_mode");
    assert.equal(server.requests[0].authorization, `Bearer ${token}`);
    assert.equal(JSON.stringify(result).includes(token), false);
  } finally {
    await server.close();
  }
});

test("Home Assistant off state returns base settings and missing credentials fail safe", async () => {
  let state: "on" | "off" = "off";
  const server = await startServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ state }));
  });
  try {
    const source = {
      kind: "home-assistant" as const,
      baseUrl: server.url,
      entityId: "binary_sensor.focus_mode",
      settings: { density: "spacious" },
      getAccessToken: async (): Promise<string | null> => null,
    };
    const missing = await resolveScheduleSource(source, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(missing.status, "fallback");
    assert.deepEqual(missing.settings, baseSettings());
    assert.equal(missing.reason?.includes("credential"), false);

    source.getAccessToken = async () => "short-lived-token";
    const inactive = await resolveScheduleSource(source, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(inactive.status, "inactive");
    assert.deepEqual(inactive.settings, baseSettings());
    state = "on";
    const active = await resolveScheduleSource(source, baseSettings(), { allowLoopbackHttp: true });
    assert.equal(active.status, "applied");
    assert.equal(active.settings.density, "spacious");
  } finally {
    await server.close();
  }
});

test("schedule resolver ignores an older refresh result after a newer source wins", async () => {
  const server = await startServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/slow") {
      setTimeout(() => response.end(JSON.stringify({ version: 1, active: true, settings: { theme: "light" } })), 150);
      return;
    }
    response.end(JSON.stringify({ version: 1, active: true, settings: { theme: "dark", uiFontSize: 20 } }));
  });
  try {
    const resolver = new ScheduleSourceResolver();
    const first = resolver.refresh({ kind: "api", url: `${server.url}/slow` }, baseSettings(), { allowLoopbackHttp: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = resolver.refresh({ kind: "api", url: `${server.url}/fast` }, baseSettings(), { allowLoopbackHttp: true });
    const [oldResult, newResult] = await Promise.all([first, second]);
    assert.equal(newResult.status, "applied");
    assert.equal(newResult.settings.uiFontSize, 20);
    assert.equal(oldResult.status, "fallback");
    assert.match(oldResult.reason ?? "", /stale|last valid/i);
  } finally {
    await server.close();
  }
});
