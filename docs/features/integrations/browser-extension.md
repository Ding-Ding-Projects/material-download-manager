# Chromium extension handoff

## Behavior

The `extension/` directory contains a Manifest V3 Chromium extension. Automatic
download capture is enabled by default. When Chrome creates an eligible
in-progress HTTP(S) download, the extension pauses the exact download, records
that it owns the pause, and authenticates the desktop app before it sends the
download URL. A nonce-only `GET /v2/challenge` requires an HMAC-SHA-256 proof of
the app-prepared capability; only then does the extension submit a one-use
authenticated protocol-3 envelope to
`http://127.0.0.1:43771/v1/downloads`.

The app performs a credential-free ranged GET and returns an authenticated
protocol-3 **pending** `202`. It then opens its own always-on-top **Start
download** window, where the user can keep the original browser transfer or
start the segmented desktop transfer. Only an authenticated accepted decision
allows the extension to cancel its paused original. If cancellation fails, the
extension first proves a rollback request for the matching desktop transfer;
only after the desktop removes that transfer and its partial file does Chrome
resume its original item. A failed rollback leaves Chrome paused instead of
creating duplicate copies. Rejection, expiry, an unavailable app, invalid
proof, unreadable source, overload, or a failed pending request resumes and
retains the exact browser download the extension paused. If Chrome refuses the
initial pause, no handoff is sent. Pending ownership claims are recovered after
a service-worker restart; the extension never resumes or cancels an unrelated
browser download.

The **Downloading** window is deliberately separate and non-topmost. Closing it
does not stop the main-process transfer; the user can right-click that download
row and choose **Open Downloading window** at any time. Completion uses an
app-owned always-on-top **Download complete** window that does not take focus
from active work and can be closed or allowed to dismiss itself.

The toolbar popup and context-menu actions remain available for manual page,
link, and selected-text capture. For a link context-menu event, the link target
takes precedence over the page URL. A selection event keeps the page URL as the
download target and carries selected text as bounded metadata; selection text
is never treated as a second URL or fetched by the extension.

The desktop app owns the real download queue and progress state. The extension
never creates a second download store or presents a final `202` accepted
handoff as a completed download.

## Configuration and installation

The extension's Options page persists the automatic-capture checkbox, manager
display name, loopback endpoint, language mode, independent English and
Cantonese funny levels, and versioned JSON settings import/export. Automatic
capture defaults on and can be turned off without disabling the popup or
context-menu actions. Plain-text settings search remains the default, with the
adjacent anchored full regex builder bound to that search field.

From the desktop app, **Settings → Downloads → Install browser extension**
creates the paired private extension in a stable application-data folder. The
app-side capability is stored in the operating-system credential vault and its
matching value is written only into that staged copy. The app automatically
opens the exact folder. A file-manager launch failure is reported separately
and does not undo or misreport successful preparation. **Open extension
folder** remains available as a manual fallback. The Settings surface reads the
validated staged-folder state from the main process each time it opens, so the
manual action remains visible after an app restart or Settings remount; a
malformed, redirected, incomplete, or capability-mismatched folder is not
reported as ready.

The same card includes **Open Chrome extensions**, which requests Chrome's
fixed `chrome://extensions/` manager page without accepting an arbitrary URL.
Because the operating system may route that internal-page request to another
browser or refuse it, success copy says only that the open request was sent and
the card always retains the exact manual route: enter `chrome://extensions/` in
Chrome, enable **Developer mode**, choose **Load unpacked**, and select the
paired folder. A refusal is a non-blocking error with that same fallback.

Chrome still requires the user to open `chrome://extensions`, enable
**Developer mode**, choose **Load unpacked**, and select the app-prepared
folder. The stable release's
`material-download-manager-extension-<version>.zip` is a validated,
version-stamped source/reference artifact with an intentionally empty pairing
module. Loading the generic ZIP or source checkout directly in a fresh browser
profile reports an unpaired state; use the app-prepared folder for handoff.

## Eligibility and failure modes

Automatic capture ignores an item when any of these facts are true:

- automatic capture is disabled or the loopback endpoint is empty;
- the item has no non-negative numeric download id;
- the download is incognito, missing, already paused, complete, or interrupted;
- the download was created by an extension; or
- neither its final URL nor original URL is a credential-free HTTP(S) URL.

Status and challenge requests have a 1.5-second timeout; the final handoff POST
has a 35-second timeout so credential-free source proof and durable queue start
can finish. Requests reject redirects and browser credentials, bound response
bodies, record the last result, and show a recovery action instead of claiming
success when the app is unavailable. A cancelled browser history row that
cannot be erased produces a cleanup warning without changing the fact that the
manager accepted the URL. If cancellation fails after final acceptance, the
extension attempts to resume the browser transfer and warns that a duplicate
may result.

A request with a website origin, malformed extension origin, or multiple
origin values receives `403` before queueing. The server echoes only an exact
`chrome-extension://` origin with a 32-character Chromium id and varies the
response by `Origin`; it does not expose a wildcard cross-origin grant.

The ownership journal is bounded to 64 entries. On service-worker startup,
paused claims are resumed, accepted claims finish cancellation and cleanup,
and terminal or missing items are removed from the journal.

The server admits at most 8 in-flight handoff POSTs and 60 challenge/POST
requests per rolling minute. Challenges expire after 30 seconds, can be used
only once, and occupy a table capped at 64 entries. Overload returns `429`
without creating an unacknowledged manager record.

## Security considerations

The bridge binds to `127.0.0.1` only and accepts no website origin. App
preparation keeps the app-side capability in the operating-system credential
vault and writes its match only into the private staged extension. The
nonce-only challenge proves the app before any download URL is sent; the
one-use request proof covers every envelope field, and the final response proof
covers the accepted download id. Requests use `credentials: omit`, reject URL
userinfo, and do not log request or response bodies.

Automatic capture sends only the credential-free URL and, when the URL path
yields one, a validated basename of at most 512 characters. It never sends
cookies, authorization headers, referrers, browser request headers, or Chrome's
absolute destination path. The app proves readability with a ranged
`GET bytes=0-0` using no browser credentials. Accepted query-bearing URLs
persist only in the operating-system credential vault, are redacted from state
and history, and are removed on terminal cleanup.

The extension requests `activeTab`, `contextMenus`, `downloads`, `storage`, and
bounded loopback host access. It does not request `tabs`, `scripting`,
`notifications`, or `<all_urls>`, fetch arbitrary page content, or transmit
captures to a third-party service.

Release packaging writes the reserved stable version into the staged
`manifest.json`, verifies the archive root and manifest-referenced entry points,
requires the pairing module to remain empty, rejects embedded capabilities,
signing, and CRX material, and records the ZIP's size and SHA-256 for
publication verification. A genuine CRX3 requires a cryptographic signature
and persistent private key. Because this repository permanently prohibits code
signing and signing keys, it does not publish a CRX or disguise the ZIP as one.
Ordinary off-store Chrome installation also remains restricted outside
administrator-managed enterprise policies, so **Load unpacked** with the app-
prepared folder is the honest installation route.

## Verification

Run `npm test` from `extension/` for the extension contract tests. The suite
covers app-prepared pairing and the generic empty module, protocol-2 challenge,
request, and response proofs, final-only acceptance, default and persisted
automatic-capture settings, eligibility, accepted pause/cancel/erase behavior,
rejection and offline pause/resume behavior, failure to pause, duplicate events,
restart ownership recovery, privacy-safe payloads, page/link/selection capture,
endpoint validation, and the settings search's anchored regex-builder markers.

Run `npm run typecheck`, `npm run build`, and `npm run test:electron` from
`design/`; the compiled Electron suite covers the real loopback server's
protocol-2 status, pairing vault, authenticated challenge/POST/response,
one-use and expired challenges, rate/concurrency bounds, credential-free ranged
GET proof, durable acceptance, client-disconnect rollback, protected-query URL
storage and cleanup, optional safe basename validation, website-origin
rejection, bounded bodies, extension preparation, automatic folder opening,
the separate folder-open failure result, validated remount state, malformed
staged pairing rejection, concurrent install serialization, redirected-manifest
rejection, and the fixed Chrome-manager request/refusal result. The built-app
smoke exercises the real IPC boundary and the Settings surface on a hidden
desktop, including the Chrome action and state after a Settings remount. The
fresh built-artifact capture below frames the automatic folder-open status and
its manual fallback without exposing a user-specific application-data path:

![Downloads Settings browser-extension installation and automatic folder-open status](../../screenshots/browser-extension/settings-install-and-reveal.png)

## Suggested articles

- [Reliable transfers](../download-engine/reliable-transfers.md)
- [Squirrel.Windows packaging and updates](../updates/squirrel-windows.md)
- [Landing and documentation site](../site/landing-and-documentation-site.md)
