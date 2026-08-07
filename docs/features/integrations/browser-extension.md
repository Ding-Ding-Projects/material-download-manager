# Chromium extension handoff

## Behavior

The `extension/` directory contains a Manifest V3 Chromium extension. Its
popup and context-menu action capture the active page, link, or selected text
and submit a validated JSON envelope to the desktop app's loopback endpoint at
`http://127.0.0.1:43771/v1/downloads`. The desktop app owns the real download
queue and progress state; the extension never creates a second store or
pretends that an accepted handoff is a completed download.

For a link context-menu event, the link target takes precedence over the page
URL. A selection event keeps the page URL as the download target and carries
the selected text as bounded metadata; selection text is never treated as a
second URL or fetched by the extension.

## Configuration

The extension's Options page persists a manager display name, loopback
endpoint, language mode, independent English and Cantonese funny levels, and
versioned JSON settings import/export. The endpoint defaults to the app's
loopback status and handoff paths and can be tested from the popup. Plain-text
search remains the default, with the anchored full regex builder available in
the settings surface.

## Failure modes

The desktop endpoint accepts only loopback clients, bounded JSON bodies,
credential-free HTTP(S) URLs, and the current protocol/source pair. It returns
an explicit status response or a non-success JSON error. The extension uses a
1.5-second timeout, rejects redirects and credentials, bounds status bodies,
records the last result, and shows a recovery action instead of claiming that
the URL was queued when the app is unavailable.

## Security considerations

The bridge binds to `127.0.0.1` only, never exposes a token, omits credentials
from fetches, rejects URL userinfo, and does not log request bodies. The
extension requests only `activeTab`, `contextMenus`, `storage`, and bounded
loopback host access. It does not fetch arbitrary page content or transmit
captured URLs or selected text to a third-party service. Context-menu metadata
is validated and size-limited before it crosses the local bridge.

## Verification

Run `npm test` from `extension/` for the pure extension contract tests. The
contract suite covers page, link, and selected-text captures, including the
link-target precedence case. Run the
desktop `npm run typecheck`, `npm run build`, and `npm run test:electron` from
`design/`; the compiled Electron suite exercises the real loopback server's
status, accepted handoff, credential rejection, and bounded-body behavior.
The cheap headless app smoke must also prove the server is reachable from the
running process before a shipped integration is called verified. The latest
hidden-desktop pass queried `/v1/status` and submitted a real protocol-v1
envelope for a live local transfer; the app returned `202` with
`accepted=true` and `pending=true`, proving a browser capture enters the same
queue that the separate progress window displays.

## Suggested articles

- [Reliable transfers](../download-engine/reliable-transfers.md)
- [Local version history](../history/local-version-history.md)
- [Landing and documentation site](../site/landing-and-documentation-site.md)
