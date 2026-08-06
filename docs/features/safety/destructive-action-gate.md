# Destructive-action gate

## Behavior

Removing a download from the list or deleting its file requests the native
renderer gate. The gate states the exact affected count and action, requires
two independently operated authorization keys, unlocks a full-range slider
only after both keys are armed, shows progress and completion state, and
offers Emergency exit plus Escape cancellation. The removal IPC call is not
made until authorization completes.

## Configuration

The gate receives item ids and a delete-file boolean from the real download
context-menu path. The host reports partial failures through the notification
centre and does not claim that a batch succeeded when an item failed.

## Failure modes and security

No key/slider shortcut bypasses the gate. Focus is contained, the control names
are screen-reader readable, and reduced-motion styles disable the decorative
animation while keeping the facts and controls. The gate itself is implemented
in the renderer's native UI, not in a separate hosted or detached helper.

## Verification

The renderer build and typecheck pass; the cheap headless smoke opened Settings,
closed it with Escape, and confirmed focus restoration. Dedicated renderer DOM
tests and append-only history recording for deletions remain follow-up work.

## Suggested articles

- Renderer accessibility: ../accessibility/renderer-accessibility.md
- Notification centre: ../notifications/notification-center.md
