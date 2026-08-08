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
  assert.equal(isSafeScheduleUrl("http://10.0.0.10/schedule", { allowLoopbackHttp: true }), false);
  assert.equal(isSafeScheduleUrl("http://127.0.0.1:8080/schedule"), false);
  assert.equal(isSafeScheduleUrl("http://127.0.0.1:8080/schedule", { allowLoopbackHttp: true }), true);
  assert.equal(isSafeScheduleUrl("https://127.0.0.1/schedule"), false);
  assert.equal(isSafeScheduleUrl("https://localhost/schedule"), false);
  assert.equal(isSafeScheduleUrl("https://localhost./schedule"), false);
  assert.equal(isSafeScheduleUrl("https://[::1]/schedule"), false);
  assert.equal(isSafeScheduleUrl("https://10.0.0.10/schedule", { allowPrivateHttps: true }), true);
});

test("API schedule resolution rejects private, mapped, mixed, and rebinding DNS answers before fetch", async () => {
  const payload = JSON.stringify({ version: 1, active: true, settings: { theme: "light" } });
  let fetchCalls = 0;
  const fetcher = async () => {
    fetchCalls += 1;
    return { status: 200, ok: true, text: async () => payload };
  };
  for (const address of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1"]) {
    const family = address.includes(":") ? 6 as const : 4 as const;
    const result = await resolveScheduleSource(
      { kind: "api", url: "https://127.0.0.1.nip.io/schedule" },
      baseSettings(),
      { fetcher, hostnameResolver: async () => [{ address, family }] },
    );
    assert.equal(result.status, "fallback", address);
  }
  const mixed = await resolveScheduleSource(
    { kind: "api", url: "https://mixed.example/schedule" },
    baseSettings(),
    {
      fetcher,
      hostnameResolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.20", family: 4 },
      ],
    },
  );
  assert.equal(mixed.status, "fallback");
  assert.equal(fetchCalls, 0);

  let resolution = 0;
  const rebindingOptions = {
    fetcher,
    hostnameResolver: async () => ++resolution === 1
      ? [{ address: "93.184.216.34", family: 4 as const }]
      : [{ address: "127.0.0.1", family: 4 as const }],
  };
  const first = await resolveScheduleSource({ kind: "api", url: "https://rebind.example/schedule" }, baseSettings(), rebindingOptions);
  const second = await resolveScheduleSource({ kind: "api", url: "https://rebind.example/schedule" }, baseSettings(), rebindingOptions, first.settings);
  assert.equal(first.status, "applied");
  assert.equal(second.status, "fallback");
  assert.equal(fetchCalls, 1);
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

test("scheduled settings accept bounded auto-organize values and reject malformed rules", () => {
  const rule = {
    id: "archives",
    name: "Archive URLs",
    pattern: "\\.(?:zip|7z)$",
    flags: "i",
    category: "compressed",
  } as const;
  assert.deepEqual(validateScheduledSettings({ autoOrganizeEnabled: false, autoOrganizeRules: [rule] }), {
    autoOrganizeEnabled: false,
    autoOrganizeRules: [rule],
  });
  assert.throws(
    () => validateScheduledSettings({ autoOrganizeRules: [rule, { ...rule }] }),
    /Invalid scheduled autoOrganizeRules/
  );
  assert.throws(
    () => validateScheduledSettings({ autoOrganizeRules: [{ ...rule, category: "image" }] }),
    /Invalid scheduled autoOrganizeRules/
  );

  const source = { autoOrganizeRules: [{ ...rule, pattern: String(rule.pattern) }] };
  const cloned = validateScheduledSettings(source);
  assert.notEqual(cloned.autoOrganizeRules, source.autoOrganizeRules);
  assert.notEqual(cloned.autoOrganizeRules?.[0], source.autoOrganizeRules[0]);
  source.autoOrganizeRules[0].pattern = "changed-after-validation";
  assert.equal(cloned.autoOrganizeRules?.[0].pattern, "\\.(?:zip|7z)$");
});

test("applied schedule rules and resolver fallback state are isolated in both mutation directions", async () => {
  const rule = {
    id: "archives",
    name: "Archive URLs",
    pattern: "\\.(?:zip|7z)$",
    flags: "i",
    category: "compressed" as const,
  };
  const sourceRules = [{ ...rule }];
  const resolver = new ScheduleSourceResolver();
  const applied = await resolver.refresh({
    kind: "local",
    active: true,
    settings: { autoOrganizeRules: sourceRules },
  }, baseSettings());
  assert.equal(applied.status, "applied");
  assert.notEqual(applied.settings.autoOrganizeRules, sourceRules);
  assert.notEqual(applied.settings.autoOrganizeRules?.[0], sourceRules[0]);

  sourceRules[0].pattern = "source-mutated";
  assert.equal(applied.settings.autoOrganizeRules?.[0].pattern, "\\.(?:zip|7z)$");
  if (!applied.settings.autoOrganizeRules) throw new Error("Expected cloned rules");
  applied.settings.autoOrganizeRules[0].pattern = "result-mutated";
  assert.equal(sourceRules[0].pattern, "source-mutated");

  const fallback = await resolver.refresh({ kind: "local", active: true, settings: { autoOrganizeRules: "invalid" } }, baseSettings());
  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.settings.autoOrganizeRules?.[0].pattern, "\\.(?:zip|7z)$");
  if (!fallback.settings.autoOrganizeRules) throw new Error("Expected fallback rules");
  fallback.settings.autoOrganizeRules[0].pattern = "fallback-mutated";
  const nextFallback = await resolver.refresh({ kind: "local", active: true, settings: { autoOrganizeRules: "invalid" } }, baseSettings());
  assert.equal(nextFallback.settings.autoOrganizeRules?.[0].pattern, "\\.(?:zip|7z)$");
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

test("Home Assistant alone may resolve a configured private HTTPS host", async () => {
  let requestedUrl = "";
  const options = {
    hostnameResolver: async () => [{ address: "10.0.0.25", family: 4 as const }],
    fetcher: async (url: string) => {
      requestedUrl = url;
      return { status: 200, ok: true, text: async () => JSON.stringify({ state: "on" }) };
    },
  };
  const result = await resolveScheduleSource({
    kind: "home-assistant",
    baseUrl: "https://home.internal",
    entityId: "input_boolean.work_mode",
    settings: { density: "compact" },
    getAccessToken: async () => "vault-token",
  }, baseSettings(), options);
  assert.equal(result.status, "applied");
  assert.equal(result.settings.density, "compact");
  assert.equal(requestedUrl, "https://home.internal/api/states/input_boolean.work_mode");

  requestedUrl = "";
  const generic = await resolveScheduleSource({ kind: "api", url: "https://home.internal/schedule" }, baseSettings(), options);
  assert.equal(generic.status, "fallback");
  assert.equal(requestedUrl, "");
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
