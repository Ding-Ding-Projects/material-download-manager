# Download engine

This category documents the production download engine in
`design/electron/download/`. The engine is the real network-backed path used by
the Electron application; `prototype/` remains reference material only.

## Articles

- [Reliable transfers](reliable-transfers.md) — headers, redirects, queues,
  timeouts, retries, persistence, and verification.

## Scope

The engine currently covers segmented Range transfers, non-resumable fallback,
pause/resume, queue concurrency, schedule polling, custom request headers,
redirect limits, connection/idle/request timeouts, retry handling, and local
state persistence. It does not claim installer, signed updater, or release
coverage.
