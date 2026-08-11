# Changelog

This repository-level changelog records user-visible changes that are awaiting
or have reached a stable release. Published entries must link the exact commit
that completed the change. An Unreleased entry names missing evidence instead
of guessing a commit, release, or date.

## Unreleased — browser extension authenticator destination

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commits:** [`572d37e`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/572d37e0ddc3abd0eca495c1d97af4e7dde0fef2), [`1c5273d`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1c5273dfc77f23659d8aa2d0ed168c54bd22a04d), [`e0b8c39`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/e0b8c39f55982df59b2690f45c9cd9480b89ec73)
- **Scope:** Chromium extension options destination with local registration and
  browser-local storage; no network, CRX, or signing path was added.

### Added

- RFC 6238 SHA-1/SHA-256/SHA-512 registration with six/eight-digit codes,
  configurable period, current/next code display, countdown, and one-step
  pairing confirmation.
- Local QR matrix rendering with a bounded compact URI and one-time manual
  secret reveal; oversized payloads keep a manual fallback.
- Searchable metadata list with an adjacent full regex builder, metadata-only
  export (`secretOmitted: true`), redacted authenticator mutation history, and
  a two-key/full-slider removal confirmation.
- Separate versioned browser-local metadata and secret records, bounded
  corruption handling, orphan-secret reconciliation, and rollback on storage
  or journal failure.

### Verification boundary

- `npm test` from `extension/` — **33/33 passed**.
- `node --check` for the new TOTP, QR, and browser-local store modules — passed.
- `git diff --check` — passed (with expected LF-to-CRLF normalization notices
  from the Windows checkout).
- The local test suite uses RFC vectors and QR matrix invariants; this checkout has
  no scanner decoder dependency, so no scanner-backed capture is claimed.
- GitHub Actions remains build/package/publication-only and does not run tests
  or lint. No CRX artifact, signing key, or signing operation was added.

## Unreleased — authenticator Settings registration surface

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`385e040`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/385e04030b0eebc6df5afa1370571226b9dd9d56)
- **Scope:** bounded registration UI only. Live code/countdown, reorder/group/bulk
  workflows, per-tab locks, and schedules remain follow-up work.

### Added

- Settings authenticator tab with its own settings search and regex builder,
  issuer/account/secret/algorithm/digits/period form, and local QR matrix
  rendering from `otpauth://totp/` data.
- Explicit one-time manual-secret reveal that clears on cancel or successful
  pairing; pairing confirmation verifies the current code before any vault
  write.
- Validated metadata-only list and ordinary JSON export with
  `secretOmitted: true`; no network request or secret-bearing URI enters
  renderer storage, history, logs, or export.
- Command-palette destination, responsive styling, and built-artifact smoke
  coverage for the real Settings surface.

### Verification boundary

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused TOTP/UI tests — **12/12 passed**.
- Full compiled Electron tests — **100/100 passed**.
- Real built-artifact smoke — **42/42 required checks passed**; the
  secret-free capture is
  [`authenticator-settings-empty.png`](docs/screenshots/authenticator/authenticator-settings-empty.png)
  (524×462 PNG, SHA-256
  `92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`).
- GitHub Actions does not run tests or lint; these local results are the test
  evidence. No signing operation or CRX artifact was added.

## Unreleased — local TOTP and QR registration core

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`ce09797`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ce09797e6c230cbb1fa9d1594fc2660655aa0cdf)
- **Scope:** bounded main-process/model foundation only; the full authenticator
  tab, QR image renderer, per-tab locks, schedules, and list management remain
  follow-up work.

### Added

- RFC 6238 TOTP generation and verification for SHA-1, SHA-256, and SHA-512,
  six/eight-digit output, configurable periods, and bounded clock skew.
- Strict `otpauth://totp/` parsing/building with issuer consistency checks,
  duplicate/unknown query rejection, and a one-time in-memory QR/manual-secret
  registration model.
- Main-process IPC registration, generation, verification, removal, and
  metadata-export seam. Secrets are stored only through the operating-system
  credential vault; ordinary metadata/export records set `secretOmitted: true`
  and contain neither the secret nor an `otpauth://` URI.

### Verification boundary

- `npm run typecheck` — passed.
- `npm run build:electron` — passed.
- Focused TOTP suite — **8/8 passed**.
- Existing Electron suite — **95/95 passed**.
- Documentation bundle and docs tests — **2/2 passed**.
- No visual capture is claimed because this slice exposes no user-facing QR or
  authenticator surface yet.

## Unreleased — shared School mode presentation and dialog emojis

- **Source commit:** [`ecf9bc6`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ecf9bc65e6f78f08e109abfbed5aa897cbdbb86d)
- **Added:** schema-v5 shared local application-data presentation settings,
  user-renamable English-only School mode, persisted dialog/message-box emoji
  decoration, canonical main-process IPC, and live propagation to the main and
  progress windows.
- **Suppression:** School mode removes language, bilingual, funny-level, and
  emoji controls from Settings and the command palette, filters playful/dim-sum
  article and release surfaces, clears the startup surprise, and suppresses
  decorative notification emoji while preserving the user's prior choices.
- **Fail-closed boundary:** leaving School mode requires `configured` reset
  credential metadata; this slice does not enroll passwords or TOTP and points
  to deliberate local application-data deletion for recovery.
- **Local verification:** `npm run docs:bundle:check`, `npm run typecheck`, and
  `npm run build` passed; compiled Electron checks passed **88/88** and engine
  checks passed **99/99**. Real built-artifact captures are recorded in
  [`HANDOFF.md`](HANDOFF.md), with no signing operation or CRX artifact.

## Unreleased — shared School-mode reset credential

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`3b76509c684a2fc5c795d92400e10cd803c511e3`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/3b76509c684a2fc5c795d92400e10cd803c511e3)
- **Added:** main-process setup, change, reset, and turn-off verification
  for the shared School-mode reset credential, with serialized operations and
  live metadata propagation to both windows.
- **Storage boundary:** the operating-system vault stores only a versioned
  salted scrypt verifier. The credential value is absent from settings,
  history, exports, logs, notifications, renderer state, and screenshots.
- **Recovery:** deleting the app-data profile removes an orphaned verifier on
  startup; a missing verifier for an existing configured profile becomes an
  `unavailable` fail-closed state. Reset restores the verifier if the metadata
  write fails.
- **Built-artifact evidence:** the real Settings capture
  [`school-mode-credential-turnoff.png`](docs/screenshots/settings/school-mode-credential-turnoff.png)
  is 1150×720 with SHA-256
  `1BA68A701556A1957756722A022B6708B32F8D0CAB1C2E71065B5C1DB96F24C1`.
- **Local verification:** docs bundle, typecheck, build, docs **2/2**,
  Electron **104/104**, and engine **99/99** passed. This slice does not add
  TOTP locks, schedules, narration, appearance editors, signing, or CRX
  artifacts.
- **Boundary hardening:** follow-up commit [`40fc29123da0c8b83c13176ab4ba526a4d5dcbd8`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/40fc29123da0c8b83c13176ab4ba526a4d5dcbd8)
  rejects direct renderer disable attempts, rolls metadata back after a failed
  settings write, and scrubs verifier validation buffers. Follow-up engine
  verification is **100/100**; the existing real Settings capture is unchanged.

## Unreleased — built-artifact smoke and gallery refresh

- **Source commit:** [`92dc67a`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/92dc67a17fbad4f7471cda5d7d85c1b4b78c44a5)
- **Local verification:** `npm run build` passed; the real hidden-desktop/CDP
  smoke passed **42/42 required checks** in `10.488` seconds.
- **Renderer assets:** `index-CUWEWH76.js` SHA-256
  `34EF8CF409C1C6B5248E7F345CC9F2F58BD17C1A8022014D275C220F448FFCCC` and
  `index-CL9UO5Fq.css` SHA-256
  `23FF81988A28774B46E99E5FC38739905D813F8E7098D218325B9AC7974A0D45`.
- **Gallery:** all seven auto-organize PNGs were replaced from that run; six
  are 1100×900 and one is 520×760. Per-file hashes are recorded in
  [`HANDOFF.md`](HANDOFF.md).
- **Install/reveal capture:** the browser-extension card was recaptured from
  the same run as a 524×233 PNG, SHA-256
  `B465ABCB5A4B4BBB605B5289A27E75BF2DB473408481C1AE32EEB9997BE08785`, with
  a generic temporary staging path and no user name in the image.
- **Cleanup:** the disposable app/profile/process tree and named headless
  desktop were removed; the final desktop inventory was zero.

## Unreleased — protected display-name mutation history

- **Source issue:** [#16 — Protected display-name history](https://github.com/Ding-Ding-Projects/material-download-manager/issues/16)
- **Source commit:** [`afb71fd`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/afb71fd)
- **Publication state:** source and focused local verification are complete on
  `codex/uh-display-history`; the reconciled head
  [`2bbcb59`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/2bbcb5993c001e35fbdacd8a0f9266cc2424f2a4)
  is published as non-draft, non-prerelease
  [`v0.1.59`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.59).

### Added

- Main-process-owned, bounded display-name setting with legacy renderer-storage
  migration and a reset to the shipped name that never changes app identity.
- Required append-only `display-name.json` history records containing only the
  schema version, previous SHA-256, and next SHA-256. The chosen display name
  is absent from the dedicated audit record.
- Operating-system-vault-backed history password verifier with no plaintext
  password in settings, history, exports, renderer state, logs, or Git.
- Visible History setup/unlock/lock states and locked IPC/view/export behavior.
- Fail-closed settings rollback when the required redacted history commit fails.

### Verification boundary

- `npm run typecheck` — passed.
- `npm run build:electron` — passed.
- Focused Node tests — **46/46 passed**, including vault corruption, wrong
  password, locked session, redacted record, migration, validation, and
  required-history rollback cases.
- Real built-artifact capture:
  [`protected-history-locked.png`](docs/screenshots/history/protected-history-locked.png)
  (1150×720 PNG, SHA-256
  `53DBA85C6FED4704995D5D6D7893F3A51590A6A942E870FE6B074E6F9A5C2361`) shows
  the locked History setup form from the hidden-desktop/CDP route.
- Broader `snapshot.json` history revisions remain plaintext local metadata;
  the new UI password is an access lock, not encryption or filesystem access
  control. GitHub Actions run
  [`31483227655`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31483227655)
  completed successfully in `00:03:36` and published unsigned Squirrel and
  extension ZIP assets. The workflow does not run tests; local results above
  are the test evidence.

## Unreleased — authenticated automatic browser download capture

- **Source issue:** [#14 — Automatically hand browser downloads to the app and reveal the extension folder](https://github.com/Ding-Ding-Projects/material-download-manager/issues/14)
- **Publication state:** integrated on main at
  `f9e92db5d39efe7a33f124f8a2fde0b6b3392c76`, published as stable release
  `v0.1.54`, and verified by GitHub Actions run `31464131995` and Pages run
  `31464419316`.

### Added

- Default-on, persisted automatic capture for eligible HTTP(S) Chrome
  downloads, with manual popup and context-menu capture retained.
- App-prepared extension pairing: **Install browser extension** rotates a local
  capability, keeps the app-side value in the operating-system credential
  vault, writes its match only into the private staged extension, and
  automatically opens that exact folder. **Open extension folder** remains the
  manual fallback.
- Protocol-2 authentication: a nonce-only `GET /v2/challenge` proves the app
  with HMAC-SHA-256 before any download URL is sent; the one-use POST proof
  covers every request field, and the final accepted response is authenticated
  independently.
- Final-only acceptance: the app proves the source with a credential-free
  ranged GET, durably persists and starts the manager record, and only then
  returns `202`. There is no provisional acknowledgement.
- Client-disconnect rollback removes a newly created, unacknowledged manager
  record and its protected source before the browser fallback proceeds.
- Fail-safe ownership: pause before handoff, cancel and erase only after final
  authenticated acceptance, and resume/retain the exact extension-owned
  browser download after unpaired state, rejection, overload, invalid proof,
  source-read failure, disconnect, timeout, an offline app, or another handoff
  failure.
- Restart recovery for bounded paused and accepted ownership claims.
- Privacy-bounded automatic payloads containing only a credential-free URL and
  optional URL-derived safe basename; cookies, authorization headers,
  referrers, browser request headers, and absolute browser destination paths are
  never forwarded.
- Accepted query-bearing URLs persist only in the operating-system credential
  vault, remain redacted in state/history/renderer data, and are removed on
  terminal cleanup.
- Fresh built-artifact evidence: the Electron Settings install/reveal card and
  all seven auto-organize gallery states were captured through the hidden-desktop
  smoke harness; the run passed 43/43 checks. The gallery includes 1100×900
  normal frames and a 520×760 narrow frame, with no user name in the published
  browser-extension image.
- Chromium-extension origin validation on the desktop loopback adapter;
  website origins are rejected before queueing.
- Bounded admission: at most 8 simultaneous handoffs and 60 challenge/POST
  requests per rolling minute, plus one-use 30-second challenges in a table
  capped at 64 entries.
- A version-stamped and archive-validated extension ZIP with structured size
  and SHA-256 publication evidence. Its pairing module is intentionally empty,
  so the generic ZIP is source/reference until the app prepares a private
  paired copy.

### Release boundary

- No CRX is published. A genuine CRX3 requires a persistent cryptographic
  signing key, while this repository permanently prohibits signing keys and
  signing operations. The supported off-store route is the app-prepared folder
  with Chrome's **Developer mode → Load unpacked** flow; the release ZIP remains
  an inspectable versioned source/reference artifact.
- GitHub Actions builds, packages, publishes, deploys, and collects safe
  evidence, but runs no tests or lint. Exact local verification results, the
  completing commit, and the resulting release records must be added before
  this entry is marked released.
