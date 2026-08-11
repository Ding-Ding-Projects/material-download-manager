# Local TOTP and QR registration core

The desktop application's bounded authenticator core implements local RFC 6238
time-based one-time passwords (TOTP) without a network account or cloud sync.
This slice is a main-process/model foundation: it does not claim to ship the
full authenticator tab, per-tab locks, OTP setup UI, schedules, or a QR image
renderer yet.

## Behavior

- `design/shared/authenticator.ts` validates a registration's issuer, account,
  RFC 4648 base32 secret, hash algorithm (`SHA1`, `SHA256`, or `SHA512`),
  six/eight-digit width, and bounded period.
- `buildTotpUri` creates the standards-compatible
  `otpauth://totp/<label>?secret=...` payload. `parseTotpUri` accepts only the
  `totp` type, rejects duplicate/unknown query parameters, and requires the
  issuer in the label and query to agree when both are present.
- `createTotpQrRegistrationModel` returns the URI and grouped manual secret for
  a one-time in-memory registration surface. The returned object is
  secret-bearing and must not be persisted, logged, snapshotted, exported, or
  placed in renderer state.
- `design/electron/authenticator/TotpEngine.ts` applies RFC 6238 dynamic
  truncation with HMAC-SHA-1, HMAC-SHA-256, or HMAC-SHA-512. Verification uses
  a bounded adjacent-period clock-skew window and constant-time comparison.
- `design/electron/authenticator/TotpRegistrationService.ts` owns registration
  IDs and returns only `TotpRegistrationMetadata` after storage. Its IPC seam
  supports registration, code generation/verification, removal, and ordinary
  metadata export; no handler returns an `otpauth://` URI or secret as ordinary
  metadata.

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
credential-bearing value. A deliberate secret export and the full authenticator
surface remain follow-up work and must receive their own destructive-action and
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
- The core does not draw QR pixels or expose a QR URI through the ordinary
  renderer metadata path. A future QR surface must render the one-time model in
  process and clear it when registration is cancelled or completed.

## Verification

From `design/`:

```text
npm run typecheck
npm run build:electron
node --test --test-timeout=30000 dist-electron/electron/__tests__/totp.test.js
```

The focused suite covers all published RFC 6238 SHA-1/SHA-256/SHA-512 vectors,
six/eight-digit output, custom periods and skew, URI round trips and malformed
URI cases, QR-model boundaries, OS-vault adapter behavior, and secret-free
ordinary export. The full UI/locks/schedules/authenticator-list matrix is not
part of this bounded slice.

## Suggested articles

- [Protected display-name history](../history/display-name-mutation-history.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)
- [Destructive-action gate](../safety/destructive-action-gate.md)
