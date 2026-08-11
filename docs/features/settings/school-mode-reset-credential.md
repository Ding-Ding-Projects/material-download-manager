# School-mode reset credential

## Behavior

The desktop app stores one shared School-mode reset credential for the local
user. The settings surface offers enrollment, change, and reset actions. Turning
School mode off is a separate verification action: the current credential must
match before the main process changes the mode. A wrong value leaves the mode
active and reports the failure without changing the user's saved language,
funny-level, or emoji choices.

The credential is a bounded local PIN/password value (at least eight
characters). It is sent only through the trusted preload bridge for the single
operation and is never returned to the renderer, settings state, local history,
exports, logs, notifications, or screenshots. The main process stores a random
salt and scrypt verifier in the operating-system credential vault under a stable
application key. It never stores the password itself.

Credential metadata in `state.json` contains only the schema, provider, and one
of `unavailable`, `unconfigured`, or `configured`. The metadata is safe to
propagate to both application windows and is updated live through the existing
presentation event. Credential mutations are serialized so a concurrent setup,
change, reset, or disable request cannot race another request.

## Configuration and recovery

Use **Set reset credential** on a fresh profile, **Change reset credential** to
replace an existing value, and **Reset credential** to remove the verifier
after entering the current value. Reset keeps School mode's current on/off
state; the user can enroll a new value immediately afterward.

This is a user-experience lock, not encryption or an account-security boundary.
If the credential is forgotten, close the app and delete the app's local
application-data folder in the platform file manager. Startup detects a deleted
profile and removes an orphaned verifier from the operating-system vault, so a
new profile can enroll again. The app never deletes that folder itself.

## Failure modes and security considerations

- A missing or unavailable credential vault marks metadata `unavailable` and
  keeps School mode fail-closed; turning it off cannot proceed.
- A missing record for a previously configured profile also becomes
  `unavailable`, rather than silently accepting a new value or disabling the
  mode.
- Corrupt verifier bytes, invalid base64 lengths, weak values, mismatched
  confirmation fields, and wrong current values are rejected without changing
  the mode.
- A fresh profile with no prior `state.json` is the deliberate deletion-reset
  path. Any stale verifier found there is removed before the new profile is
  exposed.
- The verifier record contains no plaintext credential. Credential material is
  not included in settings snapshots, local Git history, exports, telemetry,
  release evidence, or the renderer bundle.

## Verification

Focused coverage lives in:

- `design/electron/__tests__/schoolModeResetVault.test.ts` — OS-vault adapter
  contract, salted verifier storage, wrong values, replacement, removal, and
  corrupt-record failure.
- `design/electron/__tests__/schoolModeCredentialService.test.ts` — serialized
  setup, disable verification, change/reset, deleted-profile recovery, and
  fail-closed missing-record behavior.
- `design/electron/__tests__/settings.test.ts` — metadata-only presentation
  validation and English-only School-mode effective settings.

Run the focused tests and the full local build from `design/`:

```powershell
npm run typecheck
npm run build
npm run test:electron -- --test-name-pattern="School mode"
```

The real built desktop smoke captured
[`school-mode-credential-turnoff.png`](../../screenshots/settings/school-mode-credential-turnoff.png)
through the hidden-desktop route after `npm run build`. It shows the checked
School mode control, the configured-vault status, the recovery disclosure, and
the current-credential turn-off prompt without a credential value. SHA-256:
`1BA68A701556A1957756722A022B6708B32F8D0CAB1C2E71065B5C1DB96F24C1`. The
screenshot is evidence of the UI wiring, not proof of vault encryption.

## Suggested articles

- [School mode and dialog emojis](school-mode-and-emoji.md) — presentation
  behavior and live suppression rules.
- [Persisted language and appearance settings](language-and-appearance.md) —
  shared settings schema and provenance.
- [Protected display-name mutation history](../history/display-name-mutation-history.md)
  — a separate local-vault protection flow with redacted history.
