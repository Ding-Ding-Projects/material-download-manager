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

The application display name is a main-process-owned setting. Renderer requests
cannot write it through local storage: the validated settings IPC path
canonicalizes the value, persists it, and appends a dedicated
`display-name.json` revision before the IPC call reports success. The dedicated
record contains only a schema version, the previous SHA-256 (or `null` for the
first value), and the next SHA-256. Its action is `display-name-changed` or
`display-name-reset`, so the mutation is searchable without placing the chosen
name in that record.

The History tab is visibly locked until the user sets or enters a local
password. The main process keeps the password verifier and salt in the
operating-system credential vault, exposes only a short-lived per-window unlock
state to the renderer, and clears that state when the window closes or the user
locks the tab again. The password is never written to settings, history,
exports, or renderer state.

Manager shutdown drains asynchronous task-event persistence and the history
mutation queue before returning. This keeps a just-finished transfer from
leaving its local Git files in use while the application data directory is
being closed or removed.

## Configuration

The caller supplies a serialized snapshot and records real actions such as
created, updated, deleted, restored, undone, imported, and settings-changed.
The current manager snapshot is local JSON metadata rather than encrypted
ciphertext; it deliberately excludes custom header values. The dedicated
display-name mutation record is hash-only, but broader `snapshot.json` history
revisions remain plaintext metadata and are not represented as encrypted or
filesystem access control. The app-data directory therefore still needs
ordinary operating-system account and disk protection.

## Failure modes and security

The repository is initialized with local-only Git configuration and never
contacts a remote. Every commit disables hooks, signing, and system Git
configuration, bounds the child process, unstages unrelated index entries,
and commits only `snapshot.json`; an unrelated staged file therefore remains
uncommitted instead of leaking into the history snapshot. Git failures return
an empty read result or a clear null restore result rather than claiming a
revision exists. Revision subjects sanitize newlines. Snapshot encryption remains the caller's responsibility;
the manager currently records non-secret metadata as local JSON. A display-name
mutation is the stricter exception: its dedicated hash record is required before
the settings IPC call succeeds, and a failed required history write rolls the
setting back rather than reporting success.

The vault verifier is intentionally fail-closed: malformed records, invalid
base64 lengths, a missing configured record, a wrong password, or an unavailable
credential store cannot unlock the History tab. The protection is a local user
experience lock, not encryption of the broader history repository; deleting
the app's local application-data folder resets it.

On Windows, test fixtures remove temporary history repositories with a bounded
filesystem retry because the operating system can release a completed Git
child process slightly after its awaited command completes. The retry is
finite and does not hide a persistent lock.

## Verification

`design/electron/__tests__/history.test.ts` covers append-only behavior,
no-op suppression, restore-as-new-revision, action/text/regex filters, diffs,
JSONL export, hook isolation, unrelated-index isolation, and hash-only
display-name records. `historyAccessVault.test.ts` covers verifier setup,
wrong-password rejection, duplicate setup, and corrupt-vault failure;
`historyAccessSession.test.ts` covers locked/unlocked/lock-again renderer
access; the DownloadManager suite covers rollback when the required
display-name commit fails. The built-artifact UI smoke covers the History tab,
its locked setup/unlock state, search/date/export controls,
the four Settings tabs, the anchored regex builder, Escape focus restoration,
the separate progress window, and narrow Settings layout. Run npm run build,
npm run test:engine, npm run test:electron, and npm run test:ui from design/.

## Suggested articles

- Record export: ../export/record-export.md
- Regex builder: ../search/regex-builder.md
