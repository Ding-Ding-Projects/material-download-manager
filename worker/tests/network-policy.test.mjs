import assert from "node:assert/strict";
import { test } from "node:test";

import {
  headersForRedirect,
  hostnameForLookup,
  isPublicAddress,
  parseSourceUrl,
  resolveAndPin,
  resolveRedirect,
  safeLogRecord,
} from "../dist/network-policy.js";

test("public-address policy rejects loopback, private, link-local, documentation, multicast, and mapped addresses", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.100.100.200", "127.0.0.1", "169.254.1.1", "169.254.169.254", "172.31.1.1",
    "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
    "::", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002::1", "3fff::1",
  ]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    assert.equal(isPublicAddress(address), true, address);
});

test("every DNS answer is validated before one is pinned", async () => {
  await assert.rejects(
    resolveAndPin("mixed.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    (error) => error.code === "source-unavailable",
  );
  assert.deepEqual(
    await resolveAndPin("public.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ]),
    { address: "8.8.8.8", family: 4 },
  );
  await assert.rejects(
    resolveAndPin("mismatch.example", async () => [{ address: "8.8.8.8", family: 6 }]),
    (error) => error.code === "source-unavailable",
  );
  await assert.rejects(
    resolveAndPin("failure.example", async () => { throw new Error("resolver detail"); }),
    (error) => error.code === "source-unavailable" && error.message === "The source is unavailable to the worker.",
  );
});

test("bracketed IPv6 literals are normalized only for address lookup", async () => {
  assert.equal(hostnameForLookup("[2606:4700:4700::1111]"), "2606:4700:4700::1111");
  assert.deepEqual(
    await resolveAndPin("[2606:4700:4700::1111]", async () => assert.fail("literal addresses must not use DNS")),
    { address: "2606:4700:4700::1111", family: 6 },
  );
  await assert.rejects(
    resolveAndPin("[::1]", async () => assert.fail("literal addresses must not use DNS")),
    (error) => error.code === "source-unavailable",
  );
});

test("cross-origin redirects strip credential headers on the first hop", () => {
  const headers = {
    authorization: "Bearer secret",
    cookie: "session=secret",
    "proxy-authorization": "Basic secret",
    "user-agent": "mdm-test",
  };
  assert.deepEqual(
    headersForRedirect(headers, new URL("https://one.example/file"), new URL("https://two.example/file")),
    { "user-agent": "mdm-test" },
  );
  assert.deepEqual(
    headersForRedirect(headers, new URL("https://one.example/a"), new URL("https://one.example/b")),
    headers,
  );
});

test("source and redirect parsing reject embedded credentials and HTTPS downgrade", () => {
  assert.throws(() => parseSourceUrl("file:///tmp/source"), (error) => error.code === "invalid-request");
  assert.throws(() => parseSourceUrl("https://user:password@example.test/file"), (error) => error.code === "invalid-request");
  assert.throws(() => parseSourceUrl("https://example.test/file#fragment"), (error) => error.code === "invalid-request");
  assert.throws(
    () => resolveRedirect(new URL("https://example.test/file"), "http://example.test/file"),
    (error) => error.code === "source-unavailable",
  );
});

test("structured logs discard URLs, headers, credentials, and arbitrary fields", () => {
  const output = safeLogRecord("request-failed", {
    requestId: "request-1",
    code: "source-unavailable",
    url: "https://example.test/file?token=secret",
    authorization: "Bearer secret",
    arbitrary: "secret",
  });
  assert.deepEqual(JSON.parse(output), { event: "request-failed", requestId: "request-1", code: "source-unavailable" });
  assert.equal(output.includes("secret"), false);
});
