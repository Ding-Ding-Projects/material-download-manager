# Distributed SSH workers

## Behavior

The desktop app can split a range-capable download across a chosen number of
managed Docker-backed SSH workers. The main process probes the source with an
exact `bytes=0-0` request, requires a stable length and strong ETag or
Last-Modified validator, plans immutable contiguous pieces, and assembles the
verified pieces locally. The worker count is a request, not a promise: the app
uses only enabled, provisioned, pinned workers that are available at task
creation time.

Distributed mode requires a trusted whole-file SHA-256 supplied by the user.
Without that anchor, or when the source cannot prove immutable ranges, the app
keeps the transfer local and shows a non-blocking explanation. Existing files
are never moved by selecting a worker route.

Each worker receives one fixed protocol request over a pinned SSH connection.
The protocol carries bounded framed metadata and data, exact ranges, validator
echoes, and a worker hash. The main process independently hashes every byte,
rejects mismatched IDs, ranges, validators, lengths, ordering, or terminal
frames, and quarantines a worker after an integrity or host-key failure.
Verified pieces are written to per-lease temporary files, fsynced, renamed,
and recorded in an atomic manifest before final assembly. Pause and cancel
discard unverified partials; retry resumes only missing or invalidated pieces.
Each range also has both an idle deadline and an absolute wall deadline, so a
worker cannot keep a task alive forever by trickling one byte at a time.

## Configuration

In **Settings → Downloads**, add a Docker SSH worker host with its SSH
endpoint, username, pinned `SHA256:` host-key fingerprint, and loopback worker
port. The main process scans the SSH host key before saving the draft. **Import
bootstrap key**, **Provision**, **Verify**, and **Remove** operate through the
main-process lifecycle boundary; renderer settings patches cannot write worker
pins, provisioning timestamps, or source-secret trust.

Provisioning uploads the repository worker bundle through a bounded SSH/SFTP
operation, verifies its digest, runs the fixed `preflight`, `apply`, `verify`,
and rollback/finalize verbs, and journals prepared/swapped/applied phases so a
process restart can recover the last known-good worker before accepting a new
specification. The removal entry point remains outside the versioned worker
root until cleanup is committed, making removal idempotent after a transport
failure. It labels only resources owned by that host. The
worker container runs as a non-root user with no Docker socket, no shell,
forwarding, PTY, agent, X11, or arbitrary subsystem access. A host must be
explicitly trusted before a credential-bearing URL or request header can be
sent to it; changing its connection identity requires removal and a fresh host
record.

## Failure modes and recovery

Unavailable, non-range, slow, or validator-changing sources fall back to the
ordinary local downloader when it is safe to do so. Unsafe URLs, SSRF/private
DNS answers, malformed protocol input, host-key changes, validator changes,
and trusted whole-file hash mismatches fail closed. Retryable worker failures
retry within a bounded attempt count; non-retryable protocol/source errors do
not get disguised as repeated ordinary connection failures.

The raw URL and credential-bearing headers never enter renderer state,
history, or plaintext `state.json`. Active distributed sources and protected
local fallbacks are held in the operating-system credential vault and removed
after durable completion or deletion. Protected-source deletion first writes
a terminal cleanup tombstone, so a crash between vault cleanup and the final
record deletion can be reconciled safely on restart. A worker hash detects transfer/storage
corruption; it does not by itself authenticate a malicious worker, which is
why the user-supplied whole-file digest is mandatory.
Cancelling a protected transfer is terminal: its raw source is cleared from
memory and vault cleanup is retried by startup reconciliation rather than
silently offering a resume path with a missing secret.

## Security considerations

SSH host keys are pinned rather than trusted on first use. The worker's
outbound HTTP client resolves every redirect, rejects private/special DNS
answers and rebinding, pins the selected public address while retaining the
original TLS hostname, strips credential headers permanently after a
cross-origin hop, and uses identity encoding with exact ranges. The worker
never receives source credentials unless the host has explicit main-process
trust consent.

The Docker host is not modified automatically by this documentation or by a
failed preflight. Provisioning must recheck capacity and existing workloads,
claim only project-owned resources, and roll back an applied change without
destroying a prior worker identity. Removing a worker does not remove existing
downloaded files.

## Verification

From `design/`:

```powershell
npm run typecheck
npm run build
npm run test:engine
```

The focused engine coverage includes frame/schema validation, range planning,
atomic manifest recovery, vault round trips, source-probe capability fallback,
manager redaction/restart behavior, terminal protected cancellation across a
restart, ordinary retry bounds, poisoned-piece invalidation after whole-file
mismatch, and the worker's hostile SSH/protocol tests. A real Docker image/runtime
check requires a Docker daemon; when that
daemon is unavailable, the static Compose contract and worker test suite are
reported separately rather than presented as runtime evidence.

## Suggested articles

- [Reliable transfers](reliable-transfers.md) — the local segmented-transfer
  path used for safe fallback.
- [Browser handoff](../integrations/browser-extension.md) — bounded URL capture
  into the same main-process queue.
- [Destructive action gate](../safety/destructive-action-gate.md) — review the
  confirmation boundary before removing managed infrastructure.
