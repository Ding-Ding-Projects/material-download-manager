# Download engine

This category documents the production download engine in
`design/electron/download/`. The engine is the real network-backed path used by
the Electron application; `prototype/` remains reference material only.

## Articles

- [Reliable transfers](reliable-transfers.md) — headers, redirects, queues,
  timeouts, retries, persistence, and verification.
- [Separate download progress window](progress-window.md) — a second live
  progress surface sharing the main-process download state.
- [Auto-organize downloads](auto-organize-downloads.md) — six category folders,
  ordered custom regex rules, terminable worker evaluation, trusted schema-v3
  persistence, and real-app verification.

## Scope

The engine currently covers segmented Range transfers, non-resumable fallback,
pause/resume, queue concurrency, schedule polling, custom request headers,
redirect limits, connection/idle/request timeouts, retry handling, local state
persistence, category-folder routing, ordered custom classification rules, and
the separate progress-window renderer route. User-authored regular expressions
run in bounded, terminable main-process workers instead of the renderer or the
Electron event loop. Installer and
release evidence is documented in the updates category; this category does not
claim a release merely from a local build.
