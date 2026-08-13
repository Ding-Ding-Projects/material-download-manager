# Local handoff contract

## Why this contract exists

The Material Download Manager Electron application implements the protocol-3
adapter in `design/electron/extension/HandoffServer.ts`. It binds
`127.0.0.1:43771`, provides `GET /v1/status` and `GET /v2/challenge`, and accepts
authenticated `POST /v1/downloads` requests. Chrome uses this HTTP boundary; it
cannot and must not reach the context-isolated preload IPC surface.

The extension defaults to `http://127.0.0.1:43771/v1/downloads`. Native
messaging is not used. If the app is absent, closed, unprepared, busy, or
unreachable, the extension reports the failure. A generic unpaired source ZIP
leaves the browser item untouched; a paired capture resumes and retains its
owned paused item instead of guessing that a takeover succeeded. Manual popup,
context-menu, and desktop paste recovery remain available.

## App-prepared pairing

The app's **Settings → Downloads → Install browser extension** action creates
the usable paired copy. The app generates a per-preparation capability, stores
the app-side value in the operating-system credential vault, writes the
matching value only into its private staged extension copy, and automatically
opens that exact folder for Chrome's **Load unpacked** picker. **Open extension
folder** remains the manual reveal fallback.

The generic source tree and
`material-download-manager-extension-<version>.zip` release asset deliberately
contain an empty `src/shared/pairing.js` capability module. They are auditable,
version-stamped source/reference packages, not freshly paired clients. Loading
one directly into a new browser profile produces an unpaired state and cannot
authenticate a handoff. Automatic capture leaves its Chrome download untouched
in that state; it does not briefly pause and resume an item before reporting
the preparation route. Do not add a capability to the public ZIP or source
tree; prepare the private load-unpacked copy from the app.

## Endpoint allowlist

The endpoint setting is accepted only when all of these conditions hold:

- The scheme is plain `http`.
- The hostname is exactly `127.0.0.1` or `localhost`.
- An explicit port from `1` through `65535` is present.
- The path is exactly `/v1/downloads`.
- There are no username, password, query-string, or fragment components.
- The URL is at most 256 characters.

Examples:

```text
http://127.0.0.1:47821/v1/downloads
http://localhost:47821/v1/downloads
```

The shipped default is:

```text
http://127.0.0.1:43771/v1/downloads
```

Non-loopback hosts, `file:`, `ftp:`, embedded endpoint credentials, redirects,
and arbitrary paths are rejected. The extension declares only
`http://127.0.0.1/*` and `http://localhost/*` host permissions.

## Protocol-3 authenticated sequence

### 1. Optional status probe

The Options page's **Test connection** action derives `/v1/status` from the
configured endpoint and sends a credential-free `GET`. The adapter answers
within the extension's 1,500 ms status timeout with a JSON body no larger than
4 KiB:

```json
{
  "protocol": 3,
  "acceptingUrls": true
}
```

This is an availability hint, not authority. The connection test succeeds only
after the app also passes the authenticated challenge below.

### 2. Challenge the app before disclosing the download URL

Before every handoff, the service worker creates a fresh nonce and sends only
that nonce to the derived challenge route:

```http
GET /v2/challenge?nonce=<fresh-client-nonce> HTTP/1.1
Accept: application/json
```

No download URL, filename, title, selection, cookies, authorization headers,
referrer, browser request headers, or browser destination path is sent in this
request. The app loads its capability from the operating-system credential
vault and responds:

```json
{
  "protocol": 3,
  "nonce": "<fresh-client-nonce>",
  "proof": "<HMAC-SHA-256 proof>"
}
```

The proof covers `challenge`, protocol version `3`, and the exact nonce. The
extension verifies it with the capability in its app-prepared private copy. A
generic ZIP, an unprepared app, or an unrelated process listening on the port
cannot produce the required proof, so the query-bearing URL remains in the
browser and no handoff POST is sent.

Each accepted challenge expires after 30 seconds, may authenticate only one
POST, and is removed when that POST attempts authentication. The server keeps
at most 64 outstanding challenges.

### 3. Authenticate the request

After the app proves itself, the extension sends the validated envelope:

```http
POST /v1/downloads HTTP/1.1
Content-Type: application/json
Accept: application/json
```

```json
{
  "protocol": 3,
  "source": "material-download-manager-extension",
  "url": "https://example.test/archive.zip?download=example",
  "fileName": "archive.zip",
  "title": "Example page",
  "selectionText": "optional selected text",
  "requestedAt": "2026-08-11T12:00:00.000Z",
  "authNonce": "<the-one-use-challenge-nonce>",
  "authProof": "<HMAC-SHA-256 proof>"
}
```

The request proof covers the protocol, nonce, URL, timestamp, filename, title,
and selection text in a fixed order. Changing any covered field invalidates the
proof. The server rejects a missing, expired, reused, or mismatched proof before
the URL reaches `DownloadManager`.

`url` must be an `http` or `https` URL without embedded username/password
credentials and is limited to 8,192 characters. Its fragment is removed. A
query string may be necessary for a signed download link, so the app treats a
query-bearing source as protected: the full URL persists only in the
operating-system credential vault, while state, history, renderer payloads,
and logs use a redacted URL. The vault entry is removed when the download
reaches a terminal completed or cancelled state, or when its record is
removed.

`fileName` is optional and limited to 512 characters. It must be one safe
basename rather than an absolute or relative path, cannot be `.` or `..`,
cannot end in a dot or space, and cannot contain control characters, path
separators, or the Windows-forbidden `< > : " | ? *` characters. Automatic
capture derives it only from the final URL path and omits it when a safe value
cannot be produced. The server validates it independently. `title` is optional
and limited to 512 characters; `selectionText` is optional and limited to
2,048 characters.

### 4. Render the Start download decision before acknowledging the handoff

The adapter creates a bounded pending decision and opens the desktop-owned,
always-on-top **Start download** window. It waits for that window to reach
`ready-to-show` before it returns the protocol response. A load failure, lost
renderer, destroyed window, or bounded readiness timeout rejects the pending
request with a non-success response, so the extension resumes the browser item
instead of leaving it paused without a visible decision.

Only a rendered decision returns the authenticated pending `202`:

```json
{
  "protocol": 3,
  "accepted": true,
  "state": "pending",
  "handoffId": "<opaque-hand-off-id>",
  "expiresAt": 0,
  "proof": "<HMAC-SHA-256 proof>"
}
```

The response proof covers `response`, protocol version `3`, the one-use nonce,
and the opaque handoff id. `202` means a visible Start download decision exists;
it is neither queue acceptance nor a completed-download signal.

### 5. Start or keep the browser download

The extension polls the authenticated decision endpoint while its exact
browser item is paused. **Keep in Chrome**, expiry, a closed Start window, or a
failed decision returns a rejected/expired state and resumes only that owned
browser item.

On **Start download**, the app first proves the source can be read with a
credential-free ranged `GET` using `Range: bytes=0-0` and
`Accept-Encoding: identity`. It forwards no browser cookies, authorization
headers, referrer, or request headers. Only HTTP `200` or `206` passes. The
normal manager then creates and durably starts the segmented transfer. The
authenticated accepted decision binds the exact `downloadId` to the opaque
handoff id; only then may the extension cancel and erase its paused browser
copy. If cancellation fails, the extension proves a rollback request first.
The app removes the new manager record and partial file before the browser item
is resumed; a failed rollback leaves Chrome paused rather than knowingly
creating duplicate transfers.

## Origin and CORS boundary

JSON POST requests can trigger CORS preflight:

```http
OPTIONS /v1/downloads HTTP/1.1
Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop
Access-Control-Allow-Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop
Vary: Origin
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type, accept
```

The adapter accepts a supplied `Origin` only when it is exactly
`chrome-extension://` followed by a 32-character Chromium extension id using
the `[a-p]` alphabet. It echoes that origin and adds `Vary: Origin`. Website
origins, malformed extension origins, multiple origins, and other schemes
receive `403` with no cross-origin grant and never reach status, challenge, or
download routing. Originless loopback clients remain available for local
process-boundary diagnostics, but protocol-3 authentication still applies to
handoff requests. The adapter never enables credentials for this contract.

## Automatic browser-download lifecycle

Automatic capture is enabled by default and persists in extension settings.
The service worker acts only on an eligible in-progress, non-incognito,
not-already-paused HTTP(S) download that was not created by an extension. It
does not use Chrome's absolute `filename` field for handoff.

The ownership sequence is deliberate:

1. Verify the app-prepared capability before touching the browser item. A
   generic ZIP or source checkout has no compiled pairing value and leaves its
   Chrome download untouched.
2. Reserve a bounded ownership claim for the exact download identity, then call
   `chrome.downloads.pause(id)` before any handoff. A warm settings cache avoids
   a second storage round trip on the hot capture path; a cold worker still
   reads persisted settings before it reserves or pauses anything.
3. Record the extension-owned paused state only after Chrome confirms the
   pause.
4. Complete the authenticated challenge and protocol-3 POST using the
   credential-free browser context plus an optional URL-derived safe basename.
5. A pending `202` proves the Start download decision window rendered. Poll its
   authenticated decision until the user starts the manager transfer or keeps
   the item in Chrome.
6. Only after an authenticated accepted decision, cancel the original browser
   download and erase its cancelled history row.
7. After rejection, expiry, timeout, overload, offline app, invalid
   proof/response, source-read failure, disconnect rollback, or any other
   failure, resume only that extension-owned paused download and clear the
   claim. If the initial pause failed, do not submit a handoff.

The ownership journal is serialized and limited to 64 valid entries. Claims
include the original download identity so id reuse cannot make recovery touch
an unrelated item. After service-worker restart, accepted claims finish
cancellation and cleanup; paused claims resume; terminal, changed, or missing
downloads leave the journal without being mutated incorrectly.

## Capacity and runtime safety

- The adapter admits at most 8 simultaneous handoff POSTs and at most 60
  challenge/POST requests per rolling minute. Overload returns `429` with a
  bounded retry hint; it never creates an unacknowledged queue record.
- The challenge table is limited to 64 entries with a 30-second lifetime and
  one-use consumption.
- Handoff bodies are limited to 16 KiB. Server header, request, keep-alive, and
  per-socket request limits are finite.
- Status and challenge calls use the extension's 1,500 ms bound; the final POST
  uses a 35-second bound while the server's request timeout is 40 seconds.
- Requests use `credentials: omit`, `cache: no-store`, and `redirect: error`.
- Every request comes from the MV3 service worker, never page JavaScript.
- Automatic capture forwards no cookies, authorization headers, referrer,
  browser request headers, or absolute browser destination path.
- The extension stores local settings, its prepared capability, last result,
  and bounded ownership claims in `chrome.storage.local`; it does not store
  handed-off query URLs there or log request/response bodies.
- The app keeps protected query-bearing source URLs only in the
  operating-system credential vault and redacts them everywhere else.
- A failed context-menu handoff is recorded locally and shown in the popup on
  the next open. No notification permission is needed.

## Recovery when no adapter exists

The user can:

1. Use **Install browser extension** in the running app to prepare a paired
   private copy, then select the automatically opened folder in Chrome.
2. Run **Test connection**. An unpaired copy, unavailable app, invalid status,
   rejected website origin, failed challenge, overload, or non-`2xx` handoff is
   reported without a success claim.
3. Open the desktop app and paste the URL into its real Add download flow when
   browser handoff is unavailable.
4. Use **Use default endpoint** after a manual endpoint edit, or clear the
   endpoint deliberately to keep handoff disabled.

For automatic capture, every failed takeover resumes or retains the exact
browser download. The persisted **Automatically send browser downloads to the
local manager** checkbox disables automatic interception without removing
manual popup or context-menu handoffs.

Native messaging is not implemented and is not required for this integration.
Adding it later would require a separately installed, audited native host and a
new manifest permission; it would still need the same explicit failure and
browser-retention behavior.
