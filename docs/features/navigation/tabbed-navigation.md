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
bidirectional group membership, and pinned/dirty bulk-close protection. Run
`npm run build` and `npm run test:electron` from `design/`.

## Suggested articles

- [Regex builder](../search/regex-builder.md)
- [Project handoff](../../../HANDOFF.md)
