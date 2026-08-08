import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  StrictSourceProbe,
  type StrictProbeRequester,
  type StrictProbeResponse,
} from "../distributed/StrictSourceProbe";

function response(
  statusCode: number,
  headers: Record<string, string>,
  bytes: Buffer = Buffer.from([1]),
): StrictProbeResponse {
  return { statusCode, headers, body: Readable.from([bytes]) };
}

test("strict source probe proves first and final bytes with one stable strong ETag", async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const requester: StrictProbeRequester = async (url, headers) => {
    requests.push({ url: url.toString(), headers: { ...headers } });
    const range = headers.range;
    const offset = range === "bytes=0-0" ? 0 : 9;
    return response(206, {
      "content-range": `bytes ${offset}-${offset}/10`,
      "content-length": "1",
      etag: '"stable-v1"',
    });
  };

  const result = await new StrictSourceProbe({ requester }).probe(
    "https://downloads.example.test/file.bin",
    { authorization: "Bearer private" },
  );
  assert.deepEqual(result.identity, { length: 10, etag: '"stable-v1"', lastModified: null });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.range, "bytes=0-0");
  assert.equal(requests[1].headers.range, "bytes=9-9");
  assert.equal(requests[1].headers["if-range"], '"stable-v1"');
  assert.equal(requests[1].headers["accept-encoding"], "identity");
});

test("strict source probe accepts canonical Last-Modified when a weak ETag is unusable", async () => {
  const modified = "Wed, 21 Oct 2015 07:28:00 GMT";
  const requester: StrictProbeRequester = async (_url, headers) => {
    const offset = headers.range === "bytes=0-0" ? 0 : 3;
    return response(206, {
      "content-range": `bytes ${offset}-${offset}/4`,
      "content-length": "1",
      etag: 'W/"weak"',
      "last-modified": modified,
    });
  };
  const result = await new StrictSourceProbe({ requester }).probe("https://downloads.example.test/file.bin");
  assert.deepEqual(result.identity, { length: 4, etag: null, lastModified: modified });
});

test("strict source probe rejects false range support and changing identities", async () => {
  await assert.rejects(
    new StrictSourceProbe({ requester: async () => response(200, { "content-length": "1" }) })
      .probe("https://downloads.example.test/file.bin"),
    /206/u,
  );

  let call = 0;
  await assert.rejects(
    new StrictSourceProbe({
      requester: async (_url, headers) => {
        call += 1;
        const offset = headers.range === "bytes=0-0" ? 0 : 9;
        return response(206, {
          "content-range": `bytes ${offset}-${offset}/10`,
          "content-length": "1",
          etag: call === 1 ? '"first"' : '"changed"',
        });
      },
    }).probe("https://downloads.example.test/file.bin"),
    /identity changed/u,
  );
});

test("strict source probe permanently strips every credential-like header after a cross-origin redirect", async () => {
  const seen: Array<{ url: string; authorization?: string; apiKey?: string; token?: string; referer?: string }> = [];
  const attempts = new Map<string, number>();
  const requester: StrictProbeRequester = async (url, headers) => {
    const range = headers.range ?? "";
    const attempt = (attempts.get(range) ?? 0) + 1;
    attempts.set(range, attempt);
    seen.push({
      url: url.toString(),
      authorization: headers.authorization,
      apiKey: headers["x-api-key"],
      token: headers["x-auth-token"],
      referer: headers.referer,
    });
    if (url.hostname === "downloads.example.test" && attempt === 1) {
      return response(302, { location: "https://cdn.example.test/file.bin" }, Buffer.alloc(0));
    }
    if (url.hostname === "cdn.example.test") {
      return response(302, { location: "https://downloads.example.test/file.bin" }, Buffer.alloc(0));
    }
    const offset = headers.range === "bytes=0-0" ? 0 : 1;
    return response(206, {
      "content-range": `bytes ${offset}-${offset}/2`,
      "content-length": "1",
      etag: '"cdn-v1"',
    });
  };

  await new StrictSourceProbe({ requester }).probe(
    "https://downloads.example.test/file.bin",
    {
      authorization: "Bearer must-not-cross",
      "x-api-key": "key-must-not-cross",
      "x-auth-token": "token-must-not-cross",
      referer: "https://app.example.test/callback?token=must-not-cross",
    },
  );
  assert.equal(seen[0].authorization, "Bearer must-not-cross");
  assert.equal(seen[0].apiKey, "key-must-not-cross");
  assert.equal(seen[0].token, "token-must-not-cross");
  assert.equal(seen[0].referer, "https://app.example.test/callback?token=must-not-cross");
  assert.equal(seen[1].authorization, undefined);
  assert.equal(seen[1].apiKey, undefined);
  assert.equal(seen[1].token, undefined);
  assert.equal(seen[1].referer, undefined);
  assert.equal(seen[2].authorization, undefined, "credentials stay stripped on a bounce-back");
  assert.equal(seen[2].apiKey, undefined);
  assert.equal(seen[2].token, undefined);
  assert.equal(seen[2].referer, undefined);
  // Each byte probe starts from the original source with its original
  // credentials; only the cross-origin hops strip them permanently.
  assert.equal(seen[3].authorization, "Bearer must-not-cross");
  assert.equal(seen[3].apiKey, "key-must-not-cross");
  assert.equal(seen[3].token, "token-must-not-cross");
  assert.equal(seen[3].referer, "https://app.example.test/callback?token=must-not-cross");
  assert.equal(seen[4].authorization, undefined);
  assert.equal(seen[4].apiKey, undefined);
  assert.equal(seen[4].token, undefined);
  assert.equal(seen[4].referer, undefined);
  assert.equal(seen[5].authorization, undefined);
  assert.equal(seen[5].apiKey, undefined);
  assert.equal(seen[5].token, undefined);
  assert.equal(seen[5].referer, undefined);
});

test("strict source probe rejects transport-controlled request headers before network activity", async () => {
  let called = false;
  await assert.rejects(
    new StrictSourceProbe({ requester: async () => {
      called = true;
      return response(206, {});
    } }).probe("https://downloads.example.test/file.bin", { range: "bytes=0-0" }),
    /headers are invalid/u,
  );
  assert.equal(called, false);
});
