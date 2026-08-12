# Tabbed navigation

## Behavior

`design/shared/tabModel.ts` is the single state model for browser-style tabs,
groups, pinned state, workspace/window/strip location, and dirty-tab protection.
The reusable `TabStrip` exposes a dedicated pinned region and four independent
search surfaces: current strip, current group, group names, and every tab. Each
search starts in plain-text mode and can open its own JavaScript RegExp builder.

The model also provides move-to-group and both bulk-close predicates (containing
and not containing text). Pinned tabs are protected unless explicitly included,
and dirty tabs are reported as skipped so unsaved work is not silently lost.

The strip's trailing **Add download** control is an application action, not a
generic tab factory. It opens the same rendered download form as the toolbar and
command palette, returns focus to the control on cancellation, and does not add
a duplicate `View N` tab that would only render the Downloads fallback. The
actual content destinations stay explicit tabs, so pinning, grouping, ordering,
search, roving focus, and persistence continue to describe real destinations.

## Configuration

Persist `TabState` with the app's versioned settings/history store when the tab
strip is wired into the shell. Search state belongs to each field; it must not
be shared between the four scopes.

## Failure modes and security

Empty queries do not close anything in the containing mode and close previews
must show the inverse predicate before the user confirms. Invalid regex patterns
fail closed through the bounded shared regex engine. Dirty tabs are never
closed by the model's bulk action.

## Verification

`design/electron/__tests__/tabModel.test.ts` covers scope-specific search,
bidirectional group membership, and pinned/dirty bulk-close protection.
`clickableControlsContract.test.ts` rejects a generic tab creation path and
checks that the strip is wired to the same Add Download form action. Run
`npm run build` and `npm run test:electron` from `design/`; built-artifact
interaction proof is recorded separately when the UI harness is run.

## Suggested articles

- [Regex builder](../search/regex-builder.md)
- [Project handoff](../../../HANDOFF.md)
