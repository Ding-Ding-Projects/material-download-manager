# Local TOTP and QR registration core

The desktop application's bounded authenticator slice implements local RFC 6238
time-based one-time passwords (TOTP) without a network account or cloud sync.
It now includes the Settings authenticator tab, a local QR renderer, one-time
manual-secret reveal, pairing confirmation, and a metadata-only list/export.
This remains a bounded registration surface: it does not claim live code
countdowns, entry reordering/grouping, per-tab locks, or schedules.

## Behavior

- `design/shared/authenticator.ts` validates a registration's issuer, account,
  RFC 4648 base32 secret, hash algorithm (`SHA1`, `SHA256`, or `SHA512`),
  six/eight-digit width, and bounded period.
- `buildTotpUri` creates the standards-compatible
  `otpauth://totp/<label>?secret=...` payload. `parseTotpUri` accepts only the
  `totp` type, rejects duplicate/unknown query parameters, and requires the
  issuer in the label and query to agree when both are present.
- `createTotpQrRegistrationModel` returns the URI and grouped manual secret for
  a one-time in-memory registration surface. The Settings authenticator tab
  renders that model with the bundled `qrcode` matrix generator, shows the
  manual secret only during the pairing step, and clears it on cancel or
  successful pairing. The returned object is secret-bearing and must not be
  persisted, logged, snapshotted, exported, or captured.
- `design/electron/authenticator/TotpEngine.ts` applies RFC 6238 dynamic
  truncation with HMAC-SHA-1, HMAC-SHA-256, or HMAC-SHA-512. Verification uses
  a bounded adjacent-period clock-skew window and constant-time comparison.
- `design/electron/authenticator/TotpRegistrationService.ts` owns registration
  IDs and returns only `TotpRegistrationMetadata` after storage. Its IPC seam
  supports pending-code confirmation, registration, code generation/verification,
  removal, and ordinary metadata export; the confirmation handler verifies the
  current code before the registration handler writes to the vault. No handler
  returns an `otpauth://` URI or secret as ordinary metadata.
- `design/src/components/AuthenticatorPanel.tsx` provides the real Settings
  tab. QR pixels are generated in-process from the one-time URI; the renderer
  makes no network request. Metadata is validated before local profile storage,
  and ordinary export is explicitly marked `secretOmitted: true`.

## Secret storage and ordinary export

`TotpSecretVault` is the only persistence boundary for a registration secret.
It writes a versioned record to the operating-system credential vault under the
`MaterialDownloadManager.Authenticator.v1` service and a stable per-registration
account key. Settings, history snapshots, ordinary exports, logs, and renderer
metadata contain no secret. A missing, corrupt, oversized, or invalid vault
record fails closed and never becomes a usable code.

An ordinary metadata export includes issuer, account, algorithm, digit width,
period, schema version, registration ID, and `secretOmitted: true`. It never
contains the secret or the `otpauth://` URI, because that URI is itself a
credential-bearing value. A deliberate secret export and the remaining full
authenticator surface (live code/countdown, reorder/group, and related locks)
remain follow-up work and must receive their own destructive-action and
accessibility review.

## Failure modes and boundaries

- Malformed schemes, `hotp` URIs, duplicate/unknown parameters, issuer
  mismatches, invalid base32, unsupported algorithms, digit widths, periods,
  timestamps, or skew windows are rejected with bounded field-level errors.
- Verification returns `false` for a malformed candidate or missing vault
  record; it does not reveal the stored secret.
- Vault read/write/delete failures propagate to the main-process caller. The
  renderer receives only the typed result or a generic operation failure, never
  raw credential bytes.
- The ordinary renderer path contains no network request. The QR surface draws
  the one-time model in process and clears it when registration is cancelled or
  completed; only the explicitly user-initiated pairing view can show the
  manual secret. No secret-bearing QR or pairing view is used as a capture
  fixture.

## Verification

From `design/`:

```text
npm run typecheck
npm run build:electron
node --test --test-timeout=30000 dist-electron/electron/__tests__/totp.test.js dist-electron/electron/__tests__/authenticatorSurface.test.js
```

The focused suite covers all published RFC 6238 SHA-1/SHA-256/SHA-512 vectors,
six/eight-digit output, custom periods and skew, URI round trips and malformed
URI cases, QR-model boundaries, pending pairing before vault mutation, the
local/no-network UI seam, Settings-tab wiring, OS-vault adapter behavior, and
secret-free ordinary export. The full live-code, lock, schedule, reorder/group,
and broader authenticator matrix is not part of this bounded slice.

The built registration card was captured without a QR, URI, manual secret, or
metadata record at
[`docs/screenshots/authenticator/authenticator-settings-empty.png`](../../screenshots/authenticator/authenticator-settings-empty.png)
(524×462 PNG, SHA-256
`92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`).

## Suggested articles

- [Protected display-name history](../history/display-name-mutation-history.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)
- [Destructive-action gate](../safety/destructive-action-gate.md)
