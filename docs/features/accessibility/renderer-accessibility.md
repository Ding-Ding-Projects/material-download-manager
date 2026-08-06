# Renderer accessibility bridge

## Behavior

RendererAccessibilityBridge decorates the existing Electron UI with dialog and
alert-dialog roles, modal labelling, focus containment and restoration, menu
and menu-item semantics, keyboard navigation/typeahead, sidebar keyboard
activation, and visible shortcut metadata when a menu item supplies a binding.
The bridge keeps these behaviors centralized so individual dialogs do not drift.

## Configuration

The bridge observes the real renderer DOM and applies only to visible shared
surfaces. New menus and dialogs should retain the existing class hooks or add
equivalent semantic hooks before they are shipped.

## Failure modes and security

Focus is returned only to a still-connected originating control. Escape and
outside-close paths remain cancellation paths. The bridge does not grant new
IPC privileges and never copies provider-authored text into an executable
context.

## Verification

Typecheck, renderer build, engine tests, Electron tests, and a cheap headless
Electron smoke are required. The current renderer does not yet have a dedicated
DOM test harness; that gap is recorded rather than treated as a pass.

## Suggested articles

- Non-blocking notifications: ../notifications/notification-center.md
- Destructive-action safety: ../safety/destructive-action-gate.md
