# Local handoff contract

## Why this contract exists

The Material Download Manager Electron application implements the protocol-2
adapter in `design/electron/extension/HandoffServer.ts`. It binds
`127.0.0.1:43771`, provides `GET /v1/status` and `GET /v2/challenge`, and accepts
authenticated `POST /v1/downloads` requests. Chrome uses this HTTP boundary; it
cannot and must not reach the context-isolated preload IPC surface.

The extension defaults to `http://127.0.0.1:43771/v1/downloads`. Native
messaging is not used. If the app is absent, closed, unprepared, busy, or
unreachable, the extension reports the failure. Automatic capture resumes and
retains the browser download instead of guessing that a takeover succeeded;
manual popup, context-menu, and desktop paste recovery remain available.

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
authenticate a handoff. Do not add a capability to the public ZIP or source
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

## Protocol-2 authenticated sequence

### 1. Optional status probe

The Options page's **Test connection** action derives `/v1/status` from the
configured endpoint and sends a credential-free `GET`. The adapter answers
within the extension's 1,500 ms status timeout with a JSON body no larger than
4 KiB:

```json
{
  "protocol": 2,
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
  "protocol": 2,
  "nonce": "<fresh-client-nonce>",
  "proof": "<HMAC-SHA-256 proof>"
}
```

The proof covers `challenge`, protocol version `2`, and the exact nonce. The
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
  "protocol": 2,
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

### 4. Prove the app can retrieve and durably accept the source

Before taking ownership, the app makes a credential-free ranged `GET` with
`Range: bytes=0-0` and `Accept-Encoding: identity`. It forwards no browser
cookies, authorization headers, referrer, or request headers. Only an HTTP
`200` or `206` response passes. A source that works only with browser-held
credentials is rejected, so the extension resumes and retains the browser
download.

The adapter then creates the download without starting it, persists the real
manager record, and starts the queue through the normal manager path. It sends
no success response until those operations finish. There is no provisional or
background-queue acknowledgement in protocol 2.

### 5. Authenticate final acceptance

Only a final durable acceptance returns `202`:

```json
{
  "protocol": 2,
  "accepted": true,
  "downloadId": "local-id",
  "proof": "<HMAC-SHA-256 proof>"
}
```

The response proof covers `response`, protocol version `2`, the one-use nonce,
and the returned download id. The extension verifies that proof before it
reports success or cancels the browser copy. `202` means the app durably
accepted and started the manager-side record; it is not a completed-download
signal.

If the client disconnects after the manager record is created but before the
authenticated response is delivered, the server removes that record and its
protected vault source. A manager/probe/persistence/start failure returns a
generic non-success response. In either case the extension treats the handoff
as failed and resumes or retains the browser download.

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
process-boundary diagnostics, but protocol-2 authentication still applies to
handoff requests. The adapter never enables credentials for this contract.

## Automatic browser-download lifecycle

Automatic capture is enabled by default and persists in extension settings.
The service worker acts only on an eligible in-progress, non-incognito,
not-already-paused HTTP(S) download that was not created by an extension. It
does not use Chrome's absolute `filename` field for handoff.

The ownership sequence is deliberate:

1. Reserve a bounded ownership claim for the exact download identity, then call
   `chrome.downloads.pause(id)` before any handoff.
2. Record the extension-owned paused state only after Chrome confirms the
   pause.
3. Complete the authenticated challenge and final protocol-2 POST using the
   credential-free browser context plus an optional URL-derived safe basename.
4. Only after the final authenticated `202` response, record acceptance,
   cancel the original browser download, and erase its cancelled history row.
5. After unpaired state, rejection, timeout, overload, offline app, invalid
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
