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

History metadata is visibly protected. On first use the panel asks the user to
create a local password; later launches show an unlock form until the user
enters the matching password. Once unlocked, the panel offers Lock history and
clears its revision view immediately. Export is disabled while locked, and the
panel never requests the history view before the main process reports an
unlocked state. The recovery copy names deletion of the app's local
application-data folder as the reset route.

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
the IPC boundary. A regex worker timeout or rejection is preserved as a typed,
localized filter error, associated with the search field, announced in an
accessible alert, and offered a filter Retry action. It never becomes an
ordinary zero-revision result. Export failures use a separate action alert and
their own Retry export action, never mark the search field invalid, and never
claim that a file was written. A successful retry clears only the action error;
the filter and export paths cannot overwrite one another's state.

## Security considerations

The panel receives revision metadata only; raw snapshots and custom request
headers never cross into the renderer. Display-name mutations are represented
by a dedicated hash-only history record, so the chosen name is absent from that
record. The broader local `snapshot.json` history remains plaintext metadata;
the password protects access through this UI and is not a claim that those
files are encrypted. Search evaluation is bounded and local. Export uses the
shared escaping and representational-limit warnings, and the history repository
remains isolated from user projects and GitHub remotes.

## Verification

`npm run typecheck`, `npm run build`, `npm run test:engine`, and
`npm run test:electron` pass from `design/`. Focused tests also cover the vault
verifier, locked renderer session, redacted display-name record, and rollback
when the required history commit fails. The built-artifact UI smoke records the
History tab, its locked setup/unlock state, two native date controls, search,
export, tab activation, and the separate Settings-tab checks. A cheap Lowlevel
hidden-desktop capture verifies the real application shell and locked History
surface after the protection flow is bundled. The checked-in capture is
[`protected-history-locked.png`](../../screenshots/history/protected-history-locked.png)
and shows the setup form, vault explanation, reset route, and disabled export.
Injected-evaluator tests separately prove genuine zero matches and worker
failures for both views and exports. The built-application smoke also forces an
export validation failure, proves that search remains valid, corrects the
format, retries the exact action, and observes successful recovery.

## Suggested articles

- [Local version history](local-version-history.md)
- [Record export](../export/record-export.md)
- [Regex builder](../search/regex-builder.md)
