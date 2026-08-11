# Extension authenticator

The options page includes an **Authenticator** destination for local RFC 6238
TOTP registration and code display. It is deliberately bounded to the browser
extension APIs: no network request, account service, camera permission, or
clipboard-read permission is used.

## Registration

Registration accepts either a pasted `otpauth://totp/` URI or issuer, account,
Base32 secret, algorithm, digit count, and period values. Supported algorithms
are SHA-1, SHA-256, and SHA-512; digits are 6 or 8; the period is 1–86400
seconds. The current code must be entered after pairing and is checked with a
one-step clock-skew window before anything is stored.

The QR is drawn locally by `src/shared/qr.js`, with a dark-on-light quiet zone
and an accessible label. The local encoder supports QR version 5-L payloads up
to 105 UTF-8 bytes. `src/shared/totp.js` keeps default SHA-1, 6-digit, and
30-second URI parameters implicit while retaining the issuer and account in the
label, so normal registrations fit. Long labels or non-default parameters that
exceed the bound fail safely and keep the one-time manual-secret route
available. Image-file, camera, and clipboard QR import are not included in this
bounded browser surface; they require separate permission and capture work.

The QR/manual model lives only in the options-page memory. The form secret and
URI fields are cleared immediately after preparation, the manual value appears
only after an explicit one-time reveal, and cancel or successful confirmation
clears the model and reveal. A worker suspension does not make confirmation
depend on a worker-held pending secret: the options page sends the normalized
registration again for the user-initiated confirmation, and the worker verifies
the code before storage.

## Storage and privacy boundary

The extension has no operating-system credential-vault API. It therefore uses
an explicit browser-local equivalent in two versioned `chrome.storage.local`
records:

- `authenticatorMetadata.v1` contains issuer, account, algorithm, digits,
  period, id, and `secretOmitted: true`.
- `authenticatorSecrets.v1` contains the validated secret separately from the
  metadata.

This browser-local fallback is not a security boundary or an OS vault. It is
not synced, sent over the network, placed in settings export, placed in the
metadata export, or written to logs, screenshots, or public records. Clearing
this extension's local storage is the documented reset route. If either record
is malformed or exceeds the bounded 64-entry limit, the extension fails closed
instead of treating it as an empty list. On every read it prunes a secret id
that has no validated metadata row, which recovers safely from an interrupted
write.

Add and remove operations append a local mutation-journal entry before the
operation is reported complete. The entry contains only a redacted action and
hashes; issuer, account, URI, code, and secret values never enter the journal.
Storage or journal failure rolls the operation back where the browser storage
API permits and leaves the previous state visible as a failure.

## Codes and list behavior

The list shows issuer/account metadata, the current code, a readable seconds
countdown, and the next code. Codes are calculated with WebCrypto in the
extension process. A missing browser-local secret leaves the metadata visible
and reports that the entry must be registered again; it does not claim a code
was generated.

The list has its own plain-text search and adjacent full regex builder. The
builder supports guided fragments, flags, syntax feedback, live matches and
capture groups, applying or copying/exporting the pattern without changing the
list's default plain-text mode. Removing an entry opens the in-page two-key
confirmation and full-range slider; Escape and Cancel return focus without
changing data. The current bounded surface does not yet provide reorder,
groups, bulk actions, QR image import, or a deliberate secret export; those are
follow-up features rather than hidden behavior.

## Verification

From `extension/`, run:

```powershell
npm test
```

The current local suite reports **33/33 passed**. It covers RFC 6238 published
vectors for all three algorithms, six/eight-digit handling, default and
non-default URI round trips, bounded local QR matrix invariants, strict runtime
message validation, separate metadata/secret storage across worker recreation,
corrupt and oversized storage rejection, orphan-secret reconciliation,
duplicate-id rejection, journal-failure rollback, metadata-only export, the
options destination and regex-builder markers, and the in-process removal
confirmation controls. The repository has no local QR decoder dependency, so
the QR check is a standards-shape and payload-bound check; a scanner-backed
artifact check remains a follow-up when a supported local decoder is available.

The extension retains the permanent unsigned ZIP/Load-unpacked installation
path. No CRX file, signing key, signing operation, or signing permission was
added.

## Suggested articles

- [Settings foundation](settings-foundation.md) — shared presentation,
  School mode, and redacted display-name history.
- [Handoff contract](handoff-contract.md) — the loopback protocol and its
  credential-free payload boundary.
- [Spoken narrator](narrator.md) — optional local speech and its queue rules.
