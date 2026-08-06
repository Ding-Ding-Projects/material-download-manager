# Local version history

## Behavior

HistoryStore keeps an isolated Git repository beneath the app data directory,
never inside the user's project folder and never on a network path. A changed
snapshot creates one append-only local revision with an action, factual summary,
timestamp, and commit id. An unchanged snapshot records nothing. Restore reads
an earlier snapshot and records restoration as a new revision, so undo remains
possible.

The store supports date range, action, plain-text, and bounded local regex
filters, revision diff, and export through the shared serializer.

## Configuration

The caller supplies a serialized snapshot. The application should pass the
same encrypted representation used by live data when records are sensitive,
and should record real actions such as created, updated, deleted, restored,
undone, imported, and settings-changed.

## Failure modes and security

The repository is initialized with local-only Git configuration and never
contacts a remote. Git failures return an empty read result or a clear null
restore result rather than claiming a revision exists. Revision subjects
sanitize newlines. Snapshot encryption remains the caller's responsibility;
the store does not downgrade ciphertext to plaintext.

## Verification

design/electron/__tests__/history.test.ts covers append-only behavior,
no-op suppression, restore-as-new-revision, action/text/regex filters, diffs,
and JSONL export. Run npm run build and npm run test:electron from design/.

## Suggested articles

- Record export: ../export/record-export.md
- Regex builder: ../search/regex-builder.md
