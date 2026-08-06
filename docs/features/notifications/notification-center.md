# Notification centre

## Behavior

NotificationCenter renders informational, success, warning, and error events
as corner-anchored non-blocking toasts. Informational and success messages
auto-dismiss; warnings and errors remain until dismissed. Dismissed records
remain reviewable in the session notification history.

Download completion, status changes, errors, and rejected renderer operations
use the same event path. The history surface is intentionally separate from
blocking confirmation dialogs.

The Settings option named `showCompleteDialog` is retained as a compatibility
key, but its user-facing meaning is accurately shown as “Show a non-blocking
notification when a download completes”; it does not open a blocking dialog.

## Configuration

Call notify with a factual title, message, and tone. Use the optional timeout
only for non-error informational work. Error text must name the affected
download and actual failure.

## Failure modes and security

Unhandled promise rejections become visible error notifications rather than
silent console-only failures. The component does not send notification text
over the network or accept HTML; React renders it as text.

## Verification

The current project verifies the notification wiring through the renderer build
and cheap headless smoke. A renderer DOM test harness and bulk notification
history actions remain follow-up work.

## Suggested articles

- Renderer accessibility: ../accessibility/renderer-accessibility.md
- Destructive-action safety: ../safety/destructive-action-gate.md
