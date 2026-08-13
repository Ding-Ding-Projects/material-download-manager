# Destructive-action gate

## Behavior

Removing a download from the list or deleting its file requests the native
renderer gate. The gate states the exact affected count and action, requires
two independently operated authorization keys, unlocks a full-range slider
only after both keys are armed, and offers Emergency exit plus Escape
cancellation before authorization. Reaching the full slider range hands the
authorized request directly to the real removal path exactly once; it does not
wait on a decorative renderer timer. The host removes the gate immediately and
reports the final outcome through the notification centre, so a completed
authorization screen cannot remain as a false in-progress state.

## Configuration

The gate receives item ids and a delete-file boolean from the real download
context-menu path. The host reports partial failures through the notification
centre and does not claim that a batch succeeded when an item failed.

## Failure modes and security

No key/slider shortcut bypasses the gate. A ref-backed exactly-once handoff
prevents a repeated effect from issuing a second removal while also avoiding a
timer-dependent completion state. Focus is contained, the control names are
screen-reader readable, and reduced-motion styles keep the facts and controls.
The gate itself is implemented in the renderer's native UI, not in a separate
hosted or detached helper.

## Verification

Historical renderer checks cover the keyboard and focus boundary. This repair
was made under the current source-only direction, so no new build, test, smoke,
or capture claim is attached to it. Dedicated renderer DOM tests and
append-only history recording for deletions remain follow-up work.

## Suggested articles

- Renderer accessibility: ../accessibility/renderer-accessibility.md
- Notification centre: ../notifications/notification-center.md
