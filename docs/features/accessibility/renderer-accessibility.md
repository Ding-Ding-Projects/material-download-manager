# Renderer accessibility bridge

## Behavior

RendererAccessibilityBridge decorates the existing Electron UI with dialog and
alert-dialog roles, modal labelling, focus containment and restoration, menu
and menu-item semantics, keyboard navigation/typeahead, and visible shortcut
metadata when a menu item supplies a binding. Sidebar controls own their
Enter/Space activation in the Sidebar component so their click and keyboard
paths remain one action; the bridge keeps cross-surface behavior centralized
without duplicating that activation.
Authored `aria-labelledby` and `aria-describedby` values remain intact, including
the exact warning description on the destructive-action gate. Shared dialog
Escape handling also honours a nested surface that consumes Escape first.

The auto-organize editor uses an explicitly named list of rule cards. Each
field and action includes its rule position in its accessible name. Errors are
associated only with the field that owns them, while a whole-rule error stays
on the card. Native keyboard activation reorders rules, focus follows the moved
rule, removal chooses the next safe destination, and an `aria-live` status
announces the changed position or removal. Search results focus the exact
folder, rule name, pattern, or category target they describe.

History and Changelog keep filter failures separate from copy/export action
failures. Only a filter failure can mark its search field invalid or describe
that field. Action failures use their own named alert and action-specific Retry
control, clear after a successful retry, and localize known bounded-regex worker
failures without hiding the original failure fact.

Download table sort headers are real keyboard targets: Enter and Space apply the
same sort action as a click, `aria-sort` reports ascending/descending/none, and
the shared `:focus-visible` outline makes the active header discoverable.

## Configuration

The bridge observes the real renderer DOM and applies only to visible shared
surfaces. New menus and dialogs should retain the existing class hooks or add
equivalent semantic hooks before they are shipped.

## Failure modes and security

Focus is returned only to a still-connected originating control. A reorder or
removal never attempts to restore focus to a detached node. Escape and
outside-close paths remain cancellation paths. The bridge does not grant new
IPC privileges and never copies provider-authored text into an executable
context.

## Verification

The required gate includes typecheck, renderer build, engine and Electron
tests, and a cheap headless Electron smoke. The smoke uses real key events for
rule reordering; checks unique control names, field-specific `aria-invalid` and
`aria-describedby` wiring, focus after move and removal, invalid-Save blocking,
and Escape focus return; and combines bilingual mode with a 520 CSS-pixel,
2× device-scale viewport to check overflow, clipping, contrast, and minimum
control sizing. The same real-artifact gate forces and recovers from separate
History and Changelog export errors without poisoning either search field.
Final results remain in the project handoff. The current
renderer does not yet have a dedicated DOM test harness; that gap remains
explicit rather than being treated as a pass.

## Suggested articles

- Non-blocking notifications: ../notifications/notification-center.md
- Destructive-action safety: ../safety/destructive-action-gate.md
- Auto-organize downloads: ../download-engine/auto-organize-downloads.md
