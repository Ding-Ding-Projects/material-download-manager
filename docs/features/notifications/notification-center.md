# Notification centre

## Behavior

NotificationCenter renders informational, success, warning, and error events
as corner-anchored non-blocking toasts. Informational and success messages
auto-dismiss; warnings and errors remain until dismissed. Dismissed records
remain reviewable in the session notification history.

Download status changes, errors, and rejected renderer operations use the same
event path. When the main window is visible, a completed download also emits a
localized **Download complete** success toast through this renderer surface;
the toast is non-blocking and remains above the Add download form. If the main
window is hidden, minimized, or unavailable, the main process uses the native
completion notification instead, so one completion produces one visible
notification rather than duplicate claims. The history surface is intentionally
separate from blocking confirmation dialogs.

The Pages surface now provides the same bounded local foundation in the
browser: the top-bar **Notification centre** opens a painted, viewport-bounded
review panel. It stores up to 100 text-only records in browser storage with a
schema version, timestamp, tone, and dismissed state. Dismissed toasts remain
reviewable until the user deliberately deletes them. The centre owns an
independent plain-text search with an anchored regex builder, a tone/status
filter, visible-scope selection and inverse selection, bulk dismiss, a
two-control typed confirmation for permanent bulk deletion, and JSON export of
the currently visible filter. Regex exports include the active pattern and
flags so the predicate can be reproduced. The selection itself is session-only;
history, search, filter, and regex mode persist locally.

Regex evaluation is deliberately bounded. Patterns are capped at 2,048
characters and common nested or ambiguous quantified forms such as
`(a|aa)+$` and `(a+)+$` are rejected before the synchronous JavaScript engine
runs. Preview samples and searchable record text are capped as well. This is a
conservative local-search boundary: a rejected pattern can be rewritten as a
plain-text search or a simpler expression without sending data elsewhere.

While School mode is active the centre and its launcher are suppressed, new
notifications are not recorded, existing toasts and their timers are cleared,
and the saved history returns when the mode is turned off. Notification emoji remains a
decorative `aria-hidden` marker controlled by the shared emoji switch and never
enters a title, message, accessible name, or export.

Deleting history rows also removes any matching live toast and timer. Bulk
dismiss reports only records that changed state and separately names already
dismissed selections. A permanent-delete prompt freezes its selection revision,
traps keyboard focus, marks the surrounding centre content inert, and returns
focus to the initiating control after cancellation or completion.

The Settings option named `showCompleteDialog` is retained as a compatibility
key, but its user-facing meaning is accurately shown as “Show a non-blocking
notification when a download completes”; it does not open a blocking dialog.
The main-process OS notification is the hidden-window fallback and fails closed
when native notifications are unsupported. Turning the setting off suppresses
both completion paths without changing download completion itself. The Add
download start surface is a dedicated top layer (`z-index: 1300`); the
notification center is above it (`z-index: 1400`) while remaining a corner
toast rather than a modal decision.

## Configuration

Call notify with a factual title, message, and one of the bounded tones
`info`, `success`, `progress`, `warning`, or `error`. Titles are capped at 160
characters and messages at 600 characters; unknown tones normalize to `info`.
Informational, success, and progress toasts auto-dismiss after a short timeout;
warnings and errors remain until dismissed. The Pages history key is
`mdm-site-notification-history-v1`; it is local browser data and is intentionally
not synchronized to a server. A browser storage clear event is treated as an
explicit empty-history reset, including live toast and timer cleanup. Concurrent
same-revision records are merged by ID before being persisted at a newer
revision, preventing one tab from silently discarding another tab's notification.

## Failure modes and security

Unhandled promise rejections become visible error notifications rather than
silent console-only failures. The component does not send notification text
over the network or accept HTML; the app and Pages surface render it as text.
If browser storage is unavailable, the live surface continues to work and the
centre reports that the change is in memory only; it does not claim durable
persistence. Delete confirmation is deliberately scoped to the
selected records and requires both an acknowledgement and the exact word
`DELETE`; the broader universal two-key slider confirmation remains a partial
contract entry outside this slice.

## Verification

The desktop project verifies notification wiring through the renderer build and
cheap headless smoke. The smoke captures the valid Add download form before
submit and the completed-download toast after a real loopback transfer, and
asserts their top-layer ordering. The Pages checks cover the pure record contract (schema,
tone allowlist, text bounds, regex safety rejection, filters, and export
redaction plus pattern and flag metadata) plus source, HTML, and CSS wiring
markers for School/emoji suppression, independent search state, storage-event
clearing and revision merge, selection, timer cleanup, bulk actions, typed
deletion confirmation, focus trapping/return, and error marker colors.
Deliberate negative fixtures remove the cleanup and regex delegation anchors and
must be detected. They do not yet drive a browser to exercise every interaction
end to end; the real capture below supplies visual evidence for the review
panel. A browser smoke for cross-tab storage sync and the complete universal
two-key slider, archive export formats, and full built-artifact capture matrix
remain follow-up work.

## Capture evidence

![Notification centre showing a persisted dismissed record after the safety hardening](../../screenshots/site/notification-centre-hardening.png)

The image above is a real local Pages capture from commit
`cb4db4525677a85e7ce79cc29e45cba36de560c8`, taken at a 945 by 1012 pixel
viewport on an isolated hidden desktop. It shows a real Settings-triggered
toast retained as a dismissed history row, the centre's search and
regex-builder controls, the status filter, the bulk-action controls, and the
localized active-count badge. The checked file is
`docs/screenshots/site/notification-centre-hardening.png` with SHA-256
`a4213067c25b0ef639957dc264d30c6eb78d86db88cdee98de5ef6f73471757c`.

The desktop completion path has its own built-artifact capture. It is a
non-blocking renderer toast, not a modal decision, and its smoke assertion
checks that the notification layer (`z-index: 1400`) remains above the Add
download surface (`z-index: 1300`). The checked file is
`docs/screenshots/notifications/download-complete-toast.png`, a 420 by 108
pixel PNG with SHA-256
`c80c9e0befc81f748178979d1fa48d5677fb94f1db2f9c08b77fe3167c1133c7`.

![Download complete non-blocking toast](../../screenshots/notifications/download-complete-toast.png)

## Suggested articles

- Renderer accessibility: ../accessibility/renderer-accessibility.md
- Destructive-action safety: ../safety/destructive-action-gate.md
