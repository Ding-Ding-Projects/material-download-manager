# Reliable transfers

## Behavior

`DownloadManager` owns queues and applies both each queue's concurrency limit
and the global `maxActiveDownloads` limit. A `QueueScheduleClock` polls the
queue windows while the manager is alive. Work outside an enabled schedule is
paused and becomes queueable again when the next active window arrives.

`DownloadTask` splits resumable files into byte ranges, validates
`Content-Range` and `Content-Length`, writes each range at its own offset, and
falls back to one streamed part when the server does not support ranges. It
supports bounded connection, idle, and total-request timeouts, retry counts,
and a maximum redirect count.

Custom headers are kept in the main-process persistence record and are omitted
from `DownloadItem` and renderer state. Header names that the Node request
layer owns (`Host`, `Content-Length`, connection framing, and upgrade headers)
are rejected. Ordinary custom headers survive same-origin redirects. Credential
headers (`Authorization`, cookies, and proxy authorization) are stripped when
a redirect crosses the original origin, including when a later redirect tries
to bounce back.

State snapshots are written atomically. Each `StateStore` serializes saves so
overlapping manager updates cannot race on one temporary path, and every save
uses a unique temporary filename before replacing `state.json`. Temporary files
are removed after both successful and failed writes.

## Configuration

The queue and transfer controls are persisted in the app state:

- `maxActiveDownloads` limits active tasks across all queues.
- `maxConnectionsPerDownload` and `minConnectionPartSize` control range
  splitting.
- `scheduleEnabled`, `startAt`, and `endAt` define an ordinary or overnight
  local-time window; equal endpoints mean all day.
- Request headers are supplied through the add-download request and remain
  main-process-only after persistence.

## Failure modes and recovery

Invalid URLs, malformed redirects, excessive redirects, invalid range
responses, unexpected status codes, connection timeouts, idle timeouts, total
request timeouts, and exhausted retries produce an explicit item error. A
manual resume waits for an automatic schedule pause already in flight, so the
automatic pause cannot overwrite the user's resumed state.

## Security considerations

Header values are never logged or copied into renderer-facing state. Redirect
origin changes are treated as a credential boundary. The local state file is
user-data storage and currently does not provide an additional encryption layer;
operators should protect the app data directory with the operating system's
account and disk protections.

## Verification

From `design/`:

```powershell
npm run typecheck
npm run build
npm run test:engine
```

The engine tests cover persisted headers, cross-origin credential stripping,
Range reconstruction, pause/resume, concurrency across queues, serialized
StateStore saves, schedule windows and race handling, redirect limits, timeout
behavior, malformed range responses, categories, and throttling. The
`test:engine` script uses Node's `--test-concurrency=1` because the manager
tests exercise process-global Windows profile state intentionally. Node applies
the CLI timeout to each compiled test file as a whole, so the suite uses
`--test-timeout=60000`: that accommodates the deliberately serialized manager
cases while still failing a blocked file within a bounded interval.

The built Electron smoke starts a bounded loopback fixture and submits both the
rendered **Add** and **Download** form actions. It opens the separate progress
window through the visible toolbar action, resumes the added row through its
keyboard-accessible context menu, and verifies the resulting request, live
progress state, completion notification, and cleanup. This distinguishes a
working renderer/main-process handoff from a test that merely calls the preload
API directly.

## Suggested articles

- [Local version history](../history/local-version-history.md) — audit local
  record changes around download operations.
- [Destructive action gate](../safety/destructive-action-gate.md) — review the
  confirmation flow before removing a download or file.
- [Notification center](../notifications/notification-center.md) — understand
  how transfer failures and completion are surfaced without blocking the app.
