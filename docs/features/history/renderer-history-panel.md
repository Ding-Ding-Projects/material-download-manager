# History browser panel

## Behavior

The Windows application presents local revision metadata in a first-class
History tab beside Downloads, Queues, and Settings. Each row shows the factual
action, summary, timestamp, and short revision identifier. The panel reports
the matching count and distinguishes an empty history from a no-match filter.

The search field is plain-text-first and has an adjacent full JavaScript regex
builder. A date range and action chips compose with the search instead of
replacing it. Action chips come from the actions present in the filtered view,
so the UI does not promise an action that the local history does not contain.

## Configuration

The active app tab is persisted through the existing versioned tab state. The
renderer requests a bounded `HistoryView` through the validated preload bridge;
the main process normalizes the filter before asking `HistoryStore` for data.
Export format is selected in the panel and the same normalized filter is sent
to the serializer, keeping the file aligned with the visible result.

## Failure modes

An unavailable local history repository becomes an explicit non-blocking panel
state and exposes no revision data. Invalid date ranges, oversized searches,
unknown actions, invalid flags, and unsafe regular expressions are rejected at
the IPC boundary. Export failures remain visible as an error state and never
claim that a file was written.

## Security considerations

The panel receives revision metadata only; raw snapshots and custom request
headers never cross into the renderer. Search evaluation is bounded and local.
Export uses the shared escaping and representational-limit warnings, and the
history repository remains isolated from user projects and GitHub remotes.

## Verification

`npm run typecheck`, `npm run build`, `npm run test:engine`, and
`npm run test:electron` pass from `design/`. The built-artifact UI smoke records
the History tab, two native date controls, search, export, tab activation, and
the separate Settings-tab checks. A cheap Lowlevel hidden-desktop capture also
verified the real application shell after the tab was added.

## Suggested articles

- [Local version history](local-version-history.md)
- [Record export](../export/record-export.md)
- [Regex builder](../search/regex-builder.md)
