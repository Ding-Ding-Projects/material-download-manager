# Settings foundation

## Behavior

The extension keeps one sanitized settings record in `chrome.storage.local`.
The record now includes:

- `schoolModeEnabled`, a persisted user-experience mode that is off by default;
- `schoolModeName`, a bounded user-selected label (80 characters maximum);
- `schoolModeCredentialState`, a non-secret state marker for the future local
  credential-vault bridge; and
- `showEmojis`, the persisted **Show emojis in dialogs and message boxes**
  preference, off by default in this foundation slice.

When the named School mode is on, presentation is forced to serious English,
the previous language and funny-level choices remain stored, and the options
surface removes the alternate-language, funny-level, and emoji controls from
the visible surface and settings search. Turning the mode off is fail-closed
until a locally verified reset credential is available. The current extension
slice deliberately has no credential-vault implementation; it stores only the
state marker and reports the unavailable reset path rather than accepting a
credential into extension storage.

The selected School mode name is used in the heading, labels, accessibility
copy, and search terms. The shipped label is not used after a user rename in
the rendered options surface. The popup and options document titles and main
headings also use the current display name at runtime; the static manifest
identity remains the shipped diagnostic identity.

When enabled, the popup status message and options notification surface add a
decorative status emoji. The same copy remains factual when the preference is
off, and emojis are not placed in buttons, field labels, or accessible names.

## Redacted display-name journal

Every display-name create, change, or reset is preceded by an
append-only entry in `displayNameMutationJournal`. The entry records the
action, timestamp, source, stable identifier, and SHA-256 hashes of the old
and new values. It never stores the display-name text, a credential, a token,
or a usable secret. A malformed journal, unavailable storage API, hash failure,
or retention limit prevents the display-name setting from being written and
returns a visible recovery result.

This is a foundation boundary, not the complete protected history manager.
The full contract still needs the per-app local Git repository, encrypted
snapshots, an operating-system credential-vault verifier, browsing/diff/
restore/prune/export UI, and interrupted-operation recovery. The current
credential abstraction is intentionally capability-free until that trusted
bridge is implemented.

## Configuration and recovery

Settings export/import remains versioned JSON and includes only sanitized
settings. The credential state marker is safe metadata; no credential material
is exported. Deleting this extension's local storage resets the foundation
state, but the app does not delete storage on the user's behalf.

The settings page listens for local-storage changes, so another extension page
that writes the shared record updates the open page without a restart. The
desktop app's shared settings and credential-vault bridge are still a separate
integration boundary.

## Security considerations

- The journal is local-only and never sent to the loopback handoff endpoint.
- Journal entries contain hashes and redaction metadata only.
- The placeholder credential abstraction has no input path, no persistence
  method, and returns `credential-unavailable` for verification, configuration,
  and clearing until a trusted vault bridge exists.
- School mode is a user-experience setting, not a security boundary. The UI
  states the storage-deletion recovery route and does not claim encryption or
  protection.

## Verification

From `extension/`:

```powershell
npm test
```

The local suite covers sanitized School mode defaults and presentation,
emoji-setting persistence, fail-closed credential behavior, display-name
action classification, journal hashing and redaction, malformed-storage
failure, live settings-listener wiring, and the existing automatic handoff
contract. The current local result is 26/26 tests passed, including the
service-worker narrator settings and queue boundary.

## Suggested articles

- [Handoff contract](handoff-contract.md) — automatic browser capture and
  recovery semantics.
- [Spoken narrator](narrator.md) — opt-in spoken event delivery and queue
  safety.
- [Electron integration seam](electron-integration-seam.md) — trusted pairing
  and folder preparation.
- [Root browser-integration feature article](../../docs/features/integrations/browser-extension.md)
  — desktop and extension behavior together.
