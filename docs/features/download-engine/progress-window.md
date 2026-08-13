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
open a target that is not present in the manager state. The progress window is
explicitly non-topmost; the browser Start download decision and Download
complete notice are their own app-owned always-on-top windows.

## Failure modes

The main process validates the requesting window/frame and item id before
opening or retargeting the window. A missing target returns `false` and does
not create an orphan surface. State broadcasts update both windows; closing
the progress window does not stop or remove the download. A download row's
right-click **Open Downloading window** action restores the same monitor later.
App shutdown closes the secondary window before the local manager shuts down.

## Security considerations

The secondary window uses the same isolated preload, disabled Node integration,
and trusted-sender checks as the primary window. It receives only typed state
and action channels; URLs and settings remain subject to the main-process
validation boundary. The progress renderer does not open a remote page or
accept a browser-provided target without main-process validation.

## Verification

The earlier built-artifact verification recorded the separate progress window
with a named `role="progressbar"` and an active transfer. This source follow-up
changes the completion presentation to a dedicated app-controlled window and
adds browser-cancellation rollback; it has no new capture or local verification result
yet. The existing captures below remain historical evidence for the earlier
start, active-transfer, and toast surfaces rather than evidence for the current
completion window.

## Capture evidence

These three PNGs were captured from an earlier built desktop artifact. The Add
download image is a populated, submit-ready form before the `Download` action;
the progress image is the separate top-level window while its status reads
`Downloading`; the completion image is the earlier renderer toast, retained as
historical evidence only. A current app-controlled completion-window capture is
not claimed in this source-only follow-up.

| State | Capture | Dimensions | SHA-256 |
| --- | --- | --- | --- |
| Add download before submit | ![Add download dialog before submit](../../screenshots/download-engine/add-download-pre-submit.png) | 568 × 431 | `120ccdda66856fa057c50c6e7a94eff5dfcf2da2964e6b5809b850b7ae0c183f` |
| Active Downloading progress window | ![Active Downloading progress window](../../screenshots/download-engine/downloading-progress-window.png) | 980 × 640 | `cb4145c8e3ecb4c0f2ec9d129e8e73657142bfbf4f5a0de2e7bb3f56836a9a46` |
| Download complete toast | ![Download complete toast](../../screenshots/notifications/download-complete-toast.png) | 420 × 108 | `c80c9e0befc81f748178979d1fa48d5677fb94f1db2f9c08b77fe3167c1133c7` |

## Suggested articles

- [Reliable transfers](./reliable-transfers.md)
- [Chromium extension handoff](../integrations/browser-extension.md)
- [Renderer accessibility](../accessibility/renderer-accessibility.md)
