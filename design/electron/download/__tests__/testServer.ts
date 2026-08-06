import http from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";

export interface TestServerHandle {
  url: string;
  redirectUrl: string;
  buffer: Buffer;
  requestHeaders: Array<Record<string, string | string[] | undefined>>;
  close: () => Promise<void>;
  server: Server;
}

/**
 * Spins up a plain HTTP server on localhost serving a single deterministic
 * file at `/file.bin`, with full Range/Accept-Ranges support so the
 * multi-connection segmented downloader has something real to exercise.
 */
export function startTestServer(
  sizeBytes: number,
  opts: {
    supportRanges?: boolean;
    ignoreRange?: boolean;
    requiredHeader?: { name: string; value: string };
    redirectHops?: number;
    responseDelayMs?: number;
    bodyChunkDelayMs?: number;
  } = {}
): Promise<TestServerHandle> {
  const supportRanges = opts.supportRanges ?? true;
  const honorRange = supportRanges && !opts.ignoreRange;
  const buffer = crypto.randomBytes(sizeBytes);
  const requestHeaders: Array<Record<string, string | string[] | undefined>> = [];

  const server = http.createServer((req, res) => {
    requestHeaders.push(req.headers);

    const respond = () => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const redirectMatch = /^\/redirect\/(\d+)$/.exec(path);
      if (redirectMatch) {
        const hopsLeft = Number(redirectMatch[1]);
        res.writeHead(302, { Location: hopsLeft > 0 ? `/redirect/${hopsLeft - 1}` : "/file.bin" });
        res.end();
        return;
      }
      if (path !== "/file.bin") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (
        opts.requiredHeader &&
        req.headers[opts.requiredHeader.name.toLowerCase()] !== opts.requiredHeader.value
      ) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Length": String(buffer.length),
          ...(supportRanges ? { "Accept-Ranges": "bytes" } : {}),
          "Content-Disposition": 'attachment; filename="file.bin"',
          "Content-Type": "application/octet-stream",
        });
        res.end();
        return;
      }

      const range = req.headers.range;
      let body = buffer;
      let status = 200;
      let extraHeaders: Record<string, string> = {};
      if (honorRange && range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : buffer.length - 1;
          body = buffer.subarray(start, end + 1);
          status = 206;
          extraHeaders = { "Content-Range": `bytes ${start}-${end}/${buffer.length}` };
        }
      }
      res.writeHead(status, {
        "Content-Length": String(body.length),
        ...(supportRanges ? { "Accept-Ranges": "bytes" } : {}),
        ...extraHeaders,
      });
      if (opts.bodyChunkDelayMs && body.length > 1) {
        res.write(body.subarray(0, 1));
        setTimeout(() => res.end(body.subarray(1)), opts.bodyChunkDelayMs);
      } else {
        res.end(body);
      }
    };

    if (opts.responseDelayMs) setTimeout(respond, opts.responseDelayMs);
    else respond();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/file.bin`,
        redirectUrl: `http://127.0.0.1:${port}/redirect/${opts.redirectHops ?? 0}`,
        buffer,
        requestHeaders,
        server,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
