# Material Download Manager — Chromium extension

This is a real Chromium Manifest V3 extension for automatically catching
eligible browser downloads and for manually handing a page or link to a locally
configured Material Download Manager adapter. It is self-contained: the
service worker, popup, and options pages use local HTML, CSS, and JavaScript
only, with no analytics, CDN, remote images, or tracking.

## Local bridge state

The Electron app exposes the bounded protocol-2 loopback adapter in
`design/electron/extension/HandoffServer.ts`. It binds `127.0.0.1:43771`, serves
`/v1/status` and `/v2/challenge`, and accepts authenticated `/v1/downloads`
requests. The extension defaults to
`http://127.0.0.1:43771/v1/downloads` and never tries to reach the
context-isolated renderer IPC bridge from Chrome.

The supported contract is documented in
[`docs/handoff-contract.md`](docs/handoff-contract.md), and the exact main-
process/preload seam is recorded in
[`docs/electron-integration-seam.md`](docs/electron-integration-seam.md). If
the desktop app is closed or unprepared, the port is occupied, the app cannot
prove the pairing capability, the final response fails validation, or the
endpoint is manually cleared, the extension reports failure. An
automatic browser download that the extension paused is resumed; the manual
popup, context-menu, and paste recovery paths remain available.

Browser requests are accepted only from an exact `chrome-extension://` origin
with a 32-character Chromium extension id. Website origins are rejected before
status or handoff routing. Originless loopback clients remain available for
local process-boundary diagnostics without receiving a cross-origin grant.

## Load and use

The desktop app provides the supported install and pairing route: open
**Settings → Downloads**, choose **Install browser extension**, and the app
creates a paired private copy in its stable application-data folder. The app-
side capability is kept in the operating-system credential vault; the matching
value is written only into that staged copy. The app automatically opens the
exact folder so it can be selected in Chrome. The Settings card rechecks that
validated staged folder whenever it opens, so **Open extension folder** remains
available after an app restart or dialog remount if the pairing is still
usable. **Open Chrome extensions** requests Chrome's fixed
`chrome://extensions/` manager page; if the operating system routes or refuses
that internal URL, the card keeps the manual route visible instead of claiming
that Chrome opened.

Every stable GitHub Release also attaches the extension as
`material-download-manager-extension-<version>.zip`, packaged from the same
source commit as the installer. Download it from the
[latest release](https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest),
to inspect or reuse the exact versioned source. The generic ZIP and this source
directory deliberately carry an empty `src/shared/pairing.js` module. They are
source/reference artifacts until the app prepares its private staged copy;
loading either directly into a fresh browser profile reports an unpaired state
and cannot hand off URLs.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the paired folder opened by the desktop
   app.
3. Open **Details → Extension options**.
4. The default endpoint is already configured. Use **Test connection** to
   verify the running local adapter, or **Use default endpoint** after changing
   it.
5. Automatic download capture is enabled by default. Start an ordinary HTTP(S)
   browser download, or use the toolbar popup or context menu on a page, link,
   or selected text. Page captures use the page URL, link captures use the link
   target, and selection captures include selected text as bounded metadata.

## Automatic download lifecycle

The service worker listens for new Chrome downloads. It handles only eligible
in-progress, non-incognito HTTP(S) downloads that are not already paused and
were not created by an extension. For each eligible download it:

1. pauses the exact browser download and records a bounded ownership claim in
   `chrome.storage.local`;
2. sends a nonce-only `GET /v2/challenge`; the app must return a valid
   HMAC-SHA-256 proof of the app-prepared capability before the download URL is
   sent;
3. posts the credential-free URL and an optional safe basename derived from the
   URL path with a one-use authenticated protocol-2 proof;
4. waits while the app proves the source through a credential-free ranged GET,
   durably creates and starts the manager record, and returns an authenticated
   final `202` acceptance;
5. cancels the original browser transfer only after that final response, then
   erases the cancelled history row; or
6. resumes that exact browser download after unpaired state, rejection,
   overload, source-read failure, disconnect rollback, timeout, an offline app,
   or any other handoff failure.

Accepted claims and extension-owned pauses are recovered after service-worker
restart. The recovery code never resumes or cancels an unrelated download. A
cancelled history row that cannot be erased is reported as a cleanup warning;
manager acceptance is not misreported as a handoff rejection.

The automatic payload never contains cookies, authorization headers,
referrers, browser request headers, or Chrome's absolute destination path. The
filename hint is a basename only, is limited to 512 characters, and is omitted
when the final URL path cannot produce a safe value. A query-bearing URL may be
needed for a signed source; after acceptance, its full value persists only in
the app's operating-system credential vault, is redacted from normal state and
history, and is removed on terminal cleanup.

## Options and manual handoff

The options page includes browser-style tabs, keyboard-operable settings
search, an adjacent anchored full regex builder, English / playful Hong Kong
Cantonese / bilingual language modes, separate English and Cantonese funny-
level sliders from 1–5, a display-name setting, a persisted **Automatically
send browser downloads to the local manager** checkbox, the named School mode
foundation, the **Show emojis in dialogs and message boxes** preference, and
the opt-in spoken narrator with English, Hong Kong Cantonese, English-then-
Cantonese, sound-level, Quiet mode, reduced-motion, and **Test narration**
controls, plus versioned JSON settings export/import. The checkbox defaults on and can be
turned off without removing manual handoff actions. School mode keeps previous
language and funny-level choices stored, but presents serious English and
removes those controls while it is enabled.

Display-name changes are recorded before success in a local redacted mutation
journal. Journal entries contain hashes and action metadata only; they never
contain a display name or credential. The extension's reset-credential
abstraction is deliberately unavailable until the trusted desktop credential
vault bridge exists, so disabling School mode fails safely rather than storing
a credential in browser storage. See
[`docs/settings-foundation.md`](docs/settings-foundation.md) for the exact
boundary and remaining protected-history work.

Protocol 2 has no provisional response. An authenticated `202` means the app
finished its credential-free source proof, durable manager-state write, and
queue start; it is still not a completed-download signal. If the client
disconnects before that response is delivered, the app rolls the new record
back and the browser fallback remains available. Funny levels change voice
only. Warnings, errors, URLs, affected data, and recovery choices remain
explicit at every level.

The spoken narrator is off by default. New worker result events are narrated
through Chrome's local `tts` API only after the user opts in; its queue
debounces, rate-limits, replaces pending status speech, and serializes English
then Cantonese. Quiet mode, Muted sound, and the reduced-motion preference can
suppress speech without changing the visible result. See
[`docs/narrator.md`](docs/narrator.md) for the browser and final-event boundary.

The options page also includes an **Authenticator** tab. It accepts a local
`otpauth://totp/` URI or bounded manual registration values, renders a local
QR with an explicit one-time manual-secret reveal, verifies the current code
before storing, and shows current/next codes with a readable countdown. The
list has its own plain-text search and full adjacent regex builder. Metadata and
the browser-local secret fallback use separate versioned local-storage records;
the extension has no operating-system vault API, so this fallback is plainly
not a security boundary and is not synced or exported. Clearing this
extension's local storage is the reset route. See
[`docs/authenticator.md`](docs/authenticator.md) for the exact registration,
QR-size, storage, rollback, and follow-up boundaries. Image/camera/clipboard
QR import and deliberate secret export are not claimed by this slice.

## Permissions

| Permission | Reason |
| --- | --- |
| `activeTab` | Read the active page URL only after the user opens the popup or invokes the extension action. |
| `contextMenus` | Add the page, link, and selection “Send URL” action. |
| `downloads` | Pause eligible new browser downloads before handoff, then cancel/erase only after final authenticated acceptance or resume after failure. |
| `storage` | Persist local settings, the prepared pairing capability, the last handoff result, and bounded ownership claims for restart-safe recovery; handed-off query URLs are not stored here. |
| `tts` | Speak newly recorded extension events through the browser's local operating-system speech service after the user opts in; no remote audio service is used. |
| `http://127.0.0.1/*`, `http://localhost/*` | Permit only the documented loopback HTTP handoff; no arbitrary web-host access is declared. |

The extension does not request `tabs`, `scripting`, `notifications`, or
`<all_urls>`.

## Release format and CRX boundary

Release automation stamps the reserved stable version into the staged
`manifest.json`, verifies the archive root and every manifest-referenced entry
point, requires the public pairing module to remain empty, rejects embedded
capabilities, signing material, and `.crx` files, and records the ZIP's size and
SHA-256 for publication and download verification. The ZIP is a source/reference
artifact; use the app-prepared folder for a working paired installation.

The repository does not publish a CRX. A genuine CRX3 is a cryptographically
signed package and requires a persistent private key to keep a stable extension
identity. This project permanently prohibits code-signing keys and signing
operations, so generating an ephemeral key or renaming the ZIP would be both
misleading and unusable as a stable release. Ordinary Chrome installations on
Windows also restrict direct off-store CRX installation; outside an
administrator-managed enterprise policy, use **Developer mode → Load
unpacked** with the paired folder opened by the desktop app. The extracted ZIP
remains useful for inspection and source reuse, but it is intentionally
unpaired.

## Verification

From the repository root:

```powershell
node --test extension/tests/*.test.mjs
```

Or from this directory:

```powershell
npm test
```

The verifier checks the MV3 manifest and bounded permissions, app-prepared
pairing and generic-package empty state, challenge/request/response
authentication, final-only acceptance, automatic pause/accept/cancel/erase and
pause/reject/resume behavior, ownership recovery, privacy-safe payload
construction, entrypoint wiring for the service worker, popup, and options
surfaces, the runtime message boundary, URL and endpoint validation, settings
export sanitization, regex safety limits, accessible UI markers, and narrator
queue/permission/result wiring. The full regex builder remains adjacent to the
settings search; this change adds no search field without its own builder.

## File map

- `manifest.json` — MV3 metadata and bounded permissions.
- `src/service-worker.js` — automatic download ownership and recovery, context
  menu, message boundary, storage, bounded fetch timeout, and result state.
- `src/popup.*` — current-tab URL handoff surface.
- `src/options.*` — connection, preferences, help, settings search, regex
  builder, School mode and emoji settings, redacted display-name journal
  wiring, spoken narrator controls, and settings export/import.
- `src/shared/` — pure validation, protocol-2 proofs, handoff envelope, pairing
  module, regex, settings, localization, the capability-free credential
  abstraction, redacted display-name/authenticator journal, serialized narrator,
  Chrome TTS adapter, RFC 6238 TOTP core, local QR encoder, and browser-local
  authenticator store. The repository pairing module is intentionally empty;
  only the app's private staged copy is paired.
- `docs/README.md`, `docs/settings-foundation.md`, `docs/narrator.md`, and
  `docs/authenticator.md` — documentation index, shared settings/journal
  boundary, spoken narrator contract, and the local authenticator boundary.
- `docs/handoff-contract.md` — adapter contract and security boundary.
- `docs/electron-integration-seam.md` — implemented Electron seam and truthful
  failure behavior.
- `tests/extension.test.mjs` — automated static and pure-logic verifier.
