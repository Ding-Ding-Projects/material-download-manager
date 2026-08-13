# Electron integration seam

The implementation is split across the app's private extension-preparation
path, its loopback protocol-3 server, and the existing download manager. This
document records that exact seam and the failure semantics the Chromium
extension targets.

## Existing process boundary

- `design/electron/main.ts` owns `DownloadManager`, creates
  `ExtensionCapabilityVault`, starts `HandoffServer` after `manager.init()`, and
  stops the server during app shutdown.
- `design/electron/preload.ts` exposes the renderer-only API through the
  context-isolated preload bridge. Chrome never receives or calls that object.
- `design/shared/types.ts` owns the typed extension install/reveal IPC contract,
  including independent folder-copy and folder-open facts.
- `design/electron/download/DownloadManager.ts` owns URL validation, protected
  source storage, durable state, queue start, rollback, and the actual transfer.

Chrome reaches only the bounded loopback HTTP server. The extension is never
granted arbitrary page access and never receives a copy of the preload bridge.

## App-prepared extension pairing

The renderer's **Install browser extension** action invokes the narrow trusted-
sender `extension:install` IPC channel. The main process:

1. rotates a per-preparation capability through
   `ExtensionCapabilityVault`, whose app-side value lives in the operating-
   system credential vault;
2. resolves the bundled extension root and replaces the stable private staged
   folder beneath the app's application-data directory;
3. copies only the load-unpacked payload and writes the matching capability
   into that staged copy's `src/shared/pairing.js`;
4. verifies the staged result is loadable; and
5. passes that exact folder to Electron's `shell.openPath(...)`.

The generic source tree and release ZIP keep `src/shared/pairing.js` empty. They
are versioned source/reference artifacts, not fresh paired clients. A
capability is never added to the public package or release metadata.

Successful staging and successful folder opening remain separate facts. A
file-manager launch failure returns the installed path, `folderOpened: false`,
and a bounded error instead of changing a completed copy into a failed one. The
renderer keeps **Open extension folder**, backed by the trusted-sender
`extension:reveal` IPC channel, as the manual recovery path.

## Protocol-3 loopback adapter

`design/electron/extension/HandoffServer.ts` implements these responsibilities:

1. Bind to `127.0.0.1:43771` by default. Never bind `0.0.0.0` or accept a public
   host override.
2. For every supplied browser `Origin`, require an exact
   `chrome-extension://` origin with a 32-character Chromium id, echo it with
   `Vary: Origin`, and reject websites or malformed/multiple origins before
   routing. Originless loopback diagnostics receive no cross-origin grant.
3. Implement `OPTIONS` for the documented `GET`/`POST` CORS boundary, without
   credentials or a wildcard origin.
4. Implement `GET /v1/status` with `{ "protocol": 3, "acceptingUrls": true }`
   only while the initialized server is accepting requests.
5. Implement `GET /v2/challenge?nonce=...`. Load the capability from the
   operating-system credential vault, return an HMAC-SHA-256 proof covering the
   exact nonce and protocol, and send `503` when the extension has not been
   prepared by the app. This request contains no download URL.
6. Keep challenges one-use and finite: 30-second expiry, at most 64 outstanding,
   and removal on the first POST authentication attempt.
7. Implement authenticated `POST /v1/downloads`; require protocol `3`, the
   exact source marker, a valid one-use nonce, and an HMAC proof covering every
   request field. Reject an invalid proof before calling `DownloadManager`.
8. Enforce a 16 KiB body cap, at most 8 active POST handoffs, at most 60
   challenge/POST requests in a rolling minute, and finite HTTP timeouts and
   per-socket request counts.

The extension endpoint remains
`http://127.0.0.1:<port>/v1/downloads`. A deployment that changes the port must
provide an explicit visible configuration route; the extension never scans
ports.

## Pending-decision and durable acceptance seam

After protocol authentication, the server validates the optional URL-derived
basename and creates a bounded pending handoff using the configured default
folder and default queue. It opens the desktop-owned always-on-top **Start
download** window and waits for `ready-to-show` before returning the
authenticated pending `202`. A renderer failure, load failure, destroyed
window, or readiness timeout rejects the pending handoff before the browser is
told to wait, allowing its original download to resume.

The window's **Start download** decision calls
`manager.addBrowserHandoff(...)`, not an unacknowledged background
`addDownload(...)`. That method:

1. proves the app can read the source without browser credentials by issuing a
   ranged `GET` with `Range: bytes=0-0` and `Accept-Encoding: identity`;
2. rejects anything other than `200` or `206`, including a source that works
   only with browser cookies or authorization headers;
3. creates and persists the real manager record; and
4. starts it through the normal segmented resume/queue path.

The extension polls an authenticated decision result. Only the later accepted
result includes the opaque download id and authorizes cancellation of the
paused browser item; it is still not a completed-download signal. If browser
cancellation fails, an authenticated rollback invokes
`rollbackBrowserHandoff(downloadId)` before Chrome resumes. That removes the
new manager record and protected source entry; a failed rollback deliberately
keeps the browser item paused rather than risking a duplicate takeover.

## Protected URL boundary

The handoff carries no browser cookies, authorization headers, referrer,
browser request headers, or absolute browser path. URL userinfo is forbidden.
A query string can nevertheless contain a signed source token, so accepted
query-bearing URLs are handled as protected sources:

- the raw URL materializes only in main-process memory while active;
- the durable full URL lives only in the operating-system credential vault;
- persisted application state, history, renderer events, and diagnostics use a
  redacted URL; and
- completion, cancellation, rollback, and record removal delete the vault
  source, with startup cleanup retrying a terminal tombstone if an earlier
  cleanup was interrupted.

## Acceptance and verification checklist

- The listener is loopback-only; public bind addresses are rejected.
- Website and malformed browser origins receive `403`; a valid Chromium origin
  is echoed exactly, and originless diagnostics receive no CORS grant.
- Status advertises protocol 3; the authenticated challenge must also pass.
- An unprepared app or generic ZIP cannot authenticate and receives no handoff
  URL.
- Expired, reused, malformed, or mismatched proofs fail before
  `DownloadManager`.
- Invalid JSON, oversized bodies, unsupported protocols, credential-bearing
  URLs, unsafe filename hints, overload, and malformed metadata do not create a
  download.
- A rendered Start-download decision completes before the authenticated pending
  `202`; a failed window delivery rejects the handoff before Chrome waits.
- A credential-free ranged GET and durable manager start complete only after
  the user's Start-download decision.
- Client disconnect or pending-response-delivery failure rejects the pending
  decision; post-acceptance rollback removes the new manager record before
  Chrome resumes.
- Protected query URLs persist only in the operating-system credential vault
  and are removed on terminal cleanup.
- Automatic browser capture verifies compiled app pairing before it pauses,
  leaves a generic ZIP/source download untouched, cancels/erases only after an
  authenticated accepted decision, and resumes the same extension-owned item
  after every failure route.
- Preparation opens the exact staged folder; **Open extension folder** remains
  available when automatic reveal fails or needs to be repeated.
- The settings search field touched by this feature retains its own adjacent
  anchored full regex builder; no new search field was added without one.
