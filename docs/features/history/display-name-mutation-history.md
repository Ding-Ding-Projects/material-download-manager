# Protected display-name mutation history

## Behavior

The application display name is a renameable label, not an application
identity. Its directory, package identifier, installer identity, update feed,
and repository markers remain derived from fixed product constants. The
renderer sends a bounded `displayName` patch through the main-process settings
IPC path; renderer local storage is only a legacy migration source and is
cleared after a successful migration.

The main process canonicalizes and validates the value, saves the new state,
and then appends a dedicated `display-name.json` revision before the settings
IPC call reports success. The record contains a schema version, `kind`, the
previous SHA-256 (or `null` for the first value), and the next SHA-256. It never
contains the chosen display name. Resetting to the shipped name is recorded as
`display-name-reset`; another accepted value is recorded as
`display-name-changed`.

The History tab shows a password setup or unlock surface before it exposes
revision metadata or export. A successful unlock is held only for the trusted
renderer window and can be ended with Lock history; closing the window clears
it as well.

## Configuration

The display-name setting is part of the versioned `AppSettings` schema and is
validated by `design/shared/settings.ts` with a bounded 64-character canonical
label. Existing state without the field migrates to the compiled shipped name.
The unlock credential uses the operating-system credential vault under a stable
service/account key. The vault stores a versioned salt and scrypt verifier, not
the password. New passwords require at least eight characters; setup is
one-time until the local application-data folder is deleted.

## Failure modes and security considerations

- An invalid, padded, oversized, or control-character display name is rejected
  at the main-process boundary.
- A failure to write the required hash-only history record rolls the state and
  speed/login-item side effects back and rejects the mutation. It never reports
  success for a state that lacks its audit point.
- Wrong passwords, malformed vault records, invalid encoded lengths, and an
  unavailable credential store fail closed. No password is placed in renderer
  state, settings JSON, history records, exports, logs, or Git.
- The dedicated display-name record is redacted, but the existing broader
  `snapshot.json` revisions remain plaintext local metadata. The History tab
  password is a visible UI access lock, not encryption or filesystem access
  control; ordinary operating-system account and disk protection still apply.
- Deleting the app's local application-data folder is the documented local
  reset route.

## Verification

Focused coverage includes:

- `historyAccessVault.test.ts`: verifier setup, matching and wrong passwords,
  duplicate setup, corrupt-record rejection, and secret-free stored bytes.
- `historyAccessSession.test.ts`: locked state, unlock, lock-again, window
  removal, and fail-closed unconfigured state.
- `history.test.ts`: append-only display-name records contain hashes only and
  preserve their action labels.
- `downloadManager.test.ts`: canonical mutation, reset, and rollback when the
  required history write fails before success is reported.
- `persistence.test.ts` and `settings.test.ts`: default, migration, and IPC
  validation behavior for the new setting.

Run `npm run typecheck`, `npm run build:electron`, the focused Node test list,
and the full local engine/electron suites from `design/`. The built-artifact
smoke shows the locked History surface in
[`docs/screenshots/history/protected-history-locked.png`](../../screenshots/history/protected-history-locked.png)
from the hidden-desktop/CDP route. The capture proves the visible lock state,
not vault encryption; the image hash is recorded in the handoff and changelog.

## Suggested articles

- [Local version history](local-version-history.md)
- [History browser panel](renderer-history-panel.md)
- [Persisted language and appearance settings](../settings/language-and-appearance.md)
- [Renderer accessibility](../accessibility/renderer-accessibility.md)
