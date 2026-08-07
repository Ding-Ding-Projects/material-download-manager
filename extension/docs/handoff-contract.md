# Local handoff contract

## Why this contract exists

The integration Material Download Manager Electron application implements the adapter in `design/electron/extension/HandoffServer.ts`. It binds `127.0.0.1:43771`, provides `GET /v1/status`, and accepts `POST /v1/downloads`. Chrome uses this HTTP boundary; it cannot and must not reach the context-isolated preload IPC surface.

The extension ships with `http://127.0.0.1:43771/v1/downloads` as its default endpoint. Native messaging is not used. If the Electron integration is absent, the app is closed, the port is occupied, or a request fails, the extension reports the failure and exposes manual paste recovery instead of guessing success.

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

The integration app’s shipped default is:

```text
http://127.0.0.1:43771/v1/downloads
```

Non-loopback hosts, `file:`, `ftp:`, credentials, redirects, and arbitrary paths are rejected. The extension declares only `http://127.0.0.1/*` and `http://localhost/*` host permissions.

## Request

The service worker sends:

```http
POST /v1/downloads HTTP/1.1
Content-Type: application/json
Accept: application/json
```

```json
{
  "protocol": 1,
  "source": "material-download-manager-extension",
  "url": "https://example.test/archive.zip",
  "title": "Example page",
  "selectionText": "optional selected text",
  "requestedAt": "2026-08-07T12:00:00.000Z"
}
```

`url` must be an `http` or `https` URL without embedded credentials and is limited to 8,192 characters. `title` is optional and limited to 512 characters. `selectionText` is optional and limited to 2,048 characters. The adapter must treat the body as untrusted input and validate the same bounds before adding a download.

The extension exposes the same capture action for `page`, `link`, and `selection` context-menu invocations. A page invocation uses `pageUrl`; a link invocation prefers `linkUrl`; a selection invocation uses the page URL and forwards the browser-provided `selectionText`. The selection text remains optional metadata: empty or absent text is omitted from the envelope, and text over 2,048 characters or any non-string value is rejected before serialization.

The implemented adapter answers `202` after the `manager.addDownload(...)`
request is accepted. Fast queueing includes a protocol marker, `accepted: true`,
and the opaque download id:

```json
{
  "protocol": 1,
  "accepted": true,
  "downloadId": "local-id"
}
```

When URL probing is still in flight, the adapter returns the same `202` with
`accepted: true` and `pending: true` instead of making the browser wait for the
probe. The extension reports an accepted-but-checking state, so a slow valid
URL is not mistaken for a failed handoff that should be retried. The extension
validates that response before reporting success. A `202` means the adapter
accepted the request for queue dispatch; it does not prove that the download
completed. If queueing fails before acknowledgement, the adapter returns a
generic `500` with `accepted: false`, while logging only the redacted internal
diagnostic.

Because JSON POST requests can trigger CORS preflight, the adapter must support:

```http
OPTIONS /v1/downloads HTTP/1.1
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 300
```

The adapter must not enable credentials for this contract. A deployment that wants a narrower policy may replace `*` with the exact `chrome-extension://<extension-id>` origin after the unpacked or packaged extension ID is known.

## Status probe

The options page’s **Test connection** action changes the path to `/v1/status` and sends a `GET` request. The adapter should answer within the extension’s 1,500 ms timeout with a JSON body no larger than 4 KiB:

```json
{
  "protocol": 1,
  "acceptingUrls": true,
  "name": "Material Download Manager adapter"
}
```

`protocol: 1` and `acceptingUrls: true` are required. `name` is informational and is not used as an authority signal.

## Runtime safety boundary

- Every request is made by the MV3 service worker, never by page JavaScript.
- Requests use `credentials: omit`, `cache: no-store`, and `redirect: error`.
- Requests are cancelled after 1,500 ms.
- Status responses are capped at 4 KiB and are parsed as JSON only after the cap is enforced.
- Request metadata has explicit size limits and is validated before serialization.
- The endpoint is never silently expanded to a public host, arbitrary port, or arbitrary path.
- The extension stores only the endpoint, display preferences, and the last result in `chrome.storage.local`; it does not log request bodies or response bodies.
- A failed context-menu handoff is recorded locally and shown in the popup on the next open. No notification permission is needed.

## Recovery when no adapter exists

The ready state is the default, but failure recovery remains explicit. The user can:

1. Leave the default endpoint in place and run **Test connection** while the Electron app is running.
2. If the app is closed, the port is occupied, the status response is invalid, or the handoff returns a non-`2xx`, inspect the failed result in the popup or Options page.
3. Open the desktop app and paste the URL into its real Add download flow when the adapter is unavailable.
4. Use **Use default endpoint** to restore the shipped address after a manual edit, or clear it deliberately to keep handoff disabled.

Native messaging is not implemented in this lane and is not required for the current integration. Adding it later would require a separately installed, audited native host and a new manifest permission; the extension must keep the same explicit failure/recovery behavior until that host is actually available.
