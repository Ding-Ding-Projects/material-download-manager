# Separate download progress window

## Behavior

The desktop app opens a second frameless Electron window for one download's
live progress. It has its own title bar, minimize and close controls, a named
accessible progress bar, status, byte count, speed, ETA, and pause/resume and
cancel actions. It reads the same main-process `StateSnapshot` as the primary
window, so the browser extension handoff and the visible progress surface use
one queue and one source of truth. Opening another item retargets the existing
progress window instead of creating duplicate engines.

## Configuration

The renderer route is selected by `?view=progress&progressItem=<id>`. The
preload bridge exposes item-targeted `openProgressWindow`, progress retargeting,
minimize, and close operations. The toolbar and command palette select the
first active item, then fall back to the first stored item. The app refuses to
open a target that is not present in the manager state.

## Failure modes

The main process validates the requesting window/frame and item id before
opening or retargeting the window. A missing target returns `false` and does
not create an orphan surface. State broadcasts update both windows; closing
the progress window does not stop or remove the download. App shutdown closes
the secondary window before the local manager shuts down.

## Security considerations

The secondary window uses the same isolated preload, disabled Node integration,
and trusted-sender checks as the primary window. It receives only typed state
and action channels; URLs and settings remain subject to the main-process
validation boundary. The progress renderer does not open a remote page or
accept a browser-provided target without main-process validation.

## Verification

Run `npm run typecheck`, `npm run build`, `npm run test:electron`, and
`node ui-tests/smoke.mjs` from `design/`. The smoke harness starts a local
fixture, creates a real queued item through the preload bridge, opens the
separate window through the main-process IPC handler, resolves its CDP page
target dynamically, waits for the built page to finish mounting, and rejects
any result without a named `role="progressbar"`. A cheap hidden-desktop capture must show the
primary window and the separately resolved progress window from a real active
download before release verification is complete. The latest hidden-desktop
pass resolved the second `Chrome_WidgetWin_1` at 980×640 and captured its live
download-progress surface without touching the visible desktop.

## Suggested articles

- [Reliable transfers](./reliable-transfers.md)
- [Chromium extension handoff](../integrations/browser-extension.md)
- [Renderer accessibility](../accessibility/renderer-accessibility.md)
