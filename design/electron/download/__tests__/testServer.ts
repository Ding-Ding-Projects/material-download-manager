import http from "node:http";
import type { Server } from "node:http";
import crypto from "node:crypto";

export interface TestServerHandle {
  url: string;
  buffer: Buffer;
  close: () => Promise<void>;
  server: Server;
}

/**
 * Spins up a plain HTTP server on localhost serving a single deterministic
 * file at `/file.bin`, with full Range/Accept-Ranges support so the
 * multi-connection segmented downloader has something real to exercise.
 */
export function startTestServer(sizeBytes: number, opts: { supportRanges?: boolean } = {}): Promise<TestServerHandle> {
  const supportRanges = opts.supportRanges ?? true;
  const buffer = crypto.randomBytes(sizeBytes);

  const server = http.createServer((req, res) => {
    if (req.url !== "/file.bin") {
      res.writeHead(404);
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
    if (supportRanges && range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : buffer.length - 1;
        const chunk = buffer.subarray(start, end + 1);
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${buffer.length}`,
          "Content-Length": String(chunk.length),
          "Accept-Ranges": "bytes",
        });
        res.end(chunk);
        return;
      }
    }
    res.writeHead(200, {
      "Content-Length": String(buffer.length),
      ...(supportRanges ? { "Accept-Ranges": "bytes" } : {}),
    });
    res.end(buffer);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/file.bin`,
        buffer,
        server,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
