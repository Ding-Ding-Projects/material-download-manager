# Local version history

## Behavior

HistoryStore keeps an isolated Git repository beneath the app data directory,
never inside the user's project folder and never on a network path. A changed
snapshot creates one append-only local revision with an action, factual summary,
timestamp, and commit id. An unchanged snapshot records nothing. Restore reads
an earlier snapshot and records restoration as a new revision, so undo remains
possible.

The download manager now records initial state, download creation, transfer
completion/error, pause/resume/retry/cancel, deletion, queue changes, and
settings changes through this store. Custom request-header values remain out of
the renderer state and out of these snapshots.

The store supports date range, action, plain-text, and bounded local regex
filters, revision diff, and export through the shared serializer.

The renderer exposes this store through the History browser tab. Its action
filters are derived from the actions actually present in the returned history,
and its date inputs cover complete local calendar days. The tab exports the
filtered revision index as JSON, JSONL, YAML, TOML, CSV, Markdown, or HTML; it
does not export raw snapshots through the renderer.

Manager shutdown drains asynchronous task-event persistence and the history
mutation queue before returning. This keeps a just-finished transfer from
leaving its local Git files in use while the application data directory is
being closed or removed.

## Configuration

The caller supplies a serialized snapshot and records real actions such as
created, updated, deleted, restored, undone, imported, and settings-changed.
The current manager snapshot is local JSON metadata rather than encrypted
ciphertext; it deliberately excludes custom header values. The app-data
directory therefore still needs ordinary operating-system account and disk
protection.

## Failure modes and security

The repository is initialized with local-only Git configuration and never
contacts a remote. Git failures return an empty read result or a clear null
restore result rather than claiming a revision exists. Revision subjects
sanitize newlines. Snapshot encryption remains the caller's responsibility;
the manager currently records non-secret metadata as local JSON.

On Windows, test fixtures remove temporary history repositories with a bounded
filesystem retry because the operating system can release a completed Git
child process slightly after its awaited command completes. The retry is
finite and does not hide a persistent lock.

## Verification

design/electron/__tests__/history.test.ts covers append-only behavior,
no-op suppression, restore-as-new-revision, action/text/regex filters, diffs,
and JSONL export. DownloadManager's full 31-test engine suite covers queue
shutdown and local-history cleanup. The 20-check built-artifact UI smoke covers
the History tab, its search/date/export controls, the four Settings tabs, the
anchored regex builder, and Escape focus restoration. Run npm run build,
npm run test:engine, npm run test:electron, and npm run test:ui from design/.

## Suggested articles

- Record export: ../export/record-export.md
- Regex builder: ../search/regex-builder.md
