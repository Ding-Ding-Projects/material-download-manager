# Changelog

This repository-level changelog records user-visible changes that are awaiting
or have reached a stable release. Published entries must link the exact commit
that completed the change. An Unreleased entry names missing evidence instead
of guessing a commit, release, or date.

## Unreleased — browser-extension download surfaces

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commits:** [`edadf34`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/edadf34d8768e52be78147ce5c50f45764724669), [`05e3347`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/05e3347a483722f463664c29d8c1241d4e2d8fde), and integrated main [`1e58988`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1e5898853c7e82e59bd9a94d2f0944f366747846)
- **Scope:** the Add download form is a dedicated top-layer start surface; a separate progress window exposes the live `Downloading` state; and visible completions use one localized, non-blocking renderer toast above the Add form, with native notification fallback only when the main window is hidden, minimized, or unavailable. Chrome and file-manager requests retain bounded timeout and manual recovery paths.
- **Captures:** Add download before submit (568×431, SHA-256 `120ccdda66856fa057c50c6e7a94eff5dfcf2da2964e6b5809b850b7ae0c183f`), active Downloading progress window (980×640, SHA-256 `cb4145c8e3ecb4c0f2ec9d129e8e73657142bfbf4f5a0de2e7bb3f56836a9a46`), and completion toast (420×108, SHA-256 `c80c9e0befc81f748178979d1fa48d5677fb94f1db2f9c08b77fe3167c1133c7`).
- **Local verification:** Electron **149/149**, browser extension **33/33**, documentation **2/2**, typecheck/build, and real built UI smoke **55/55**. The release-only workflow [31628649158](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31628649158) is still running; no release publication is claimed yet.

## Unreleased — desktop spoken narrator foundation

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`a7adc431`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/a7adc4313c341bd350a95409adca8b7d651fe2ea)
- **Scope:** opt-in local completion/error narration with persisted enabled,
  language-order, quiet-mode, and assistive-technology safety controls;
  independent English/Cantonese funny-level styling; serialized
  debounce/cooldown/replacement; School-mode and reduced-motion suppression;
  explicit screen-reader boundary; speech and Cantonese-voice availability
  handling; and localized user test narration.
- **Capture:** `docs/screenshots/notifications/spoken-narrator.png`, 524×693,
  43,991 bytes, SHA-256
  `28C29158DE84CCA0ED1DCC8BBAA2CE2B0D89BE53EEF1B23A53BE46F0FC8F5C33`.
- **Local verification:** narrator **7/7**, Electron **139/139**, engine
  **102/102**, built UI smoke **46/46**, docs **2/2**, typecheck/build, and
  diff check passed. No GitHub Actions run or release is claimed yet.

## Unreleased — protected local history actions

- **Source issue:** [#16 — Protected display-name history and local history manager](https://github.com/Ding-Ding-Projects/material-download-manager/issues/16)
- **Source commits:** [`512aa2c`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/512aa2cfa50ecf06ebe3e47985b0b3c8da31fa73) and [`8ae3974`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8ae397469594585d5d1e062d0a575d8de352551a)
- **Scope:** redacted revision diff, bounded user labels, append-only restore
  with validated rollback, and bounded retention pruning through audit
  tombstones. Label, prune, and display-name audit revisions remain visible;
  no existing Git commit is rewritten or deleted. The hardening follow-up
  rebuilds restored items and queues from an allowlist, keeps restored work
  dormant, never reuses vault-backed source maps, preserves the live
  School-mode credential state, and canonicalizes the new audit snapshot.
  Diff output also redacts credential-like keys, URL userinfo, and complete
  local paths, including paths with spaces.

### Verification boundary

- Full compiled Electron suite — **132/132 passed**.
- Download-engine suite — **102/102 passed**; documentation tests — **2/2**.
- Typecheck, renderer/main build, documentation bundle, and `git diff --check`
  passed; built UI smoke — **45/45 passed**.
- Real built History captures: `history-manager-actions.png` (1150×720,
  78,947 bytes, SHA-256
  `845E8EA17410AF2C4CE95CF3531C03CCB100664C768297746F460CE02BC75115`) and
  `history-manager-actions-diff.png` (1150×720, 84,295 bytes, SHA-256
  `2F7C4290D2809095AC5D463F9DDF4D63C71FF3C3CCAD3A2F7C4CD5D1E6F28930`).
   The diff capture visibly redacts local paths, and a post-capture probe found
   no absolute path, username, or user-authored display name.
- A distinct post-hardening locked-state capture from source `9344664` is
  `history-hardening-9344664.png` (1150×720, 55,603 bytes, SHA-256
  `803AEC9BF2A9BB041A1E89EEC88F7F32E068753A718C3E1C156DCC2932723AD9`). It
  contains no username, local path, credential, or user-authored display name.
- No remote CI or release result is claimed for this task branch; integration
  into `main` is the next handoff action.

## v0.1.125 — Pan-Fried Radish Cake · 香煎蘿蔔糕

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commits:** [`be14edb`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/be14edbd17b3ba19c4cdc8aa43f567d4bb5d8798), [`78b5184`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/78b5184bf7388f5ed665bc79a76fdde791f597a4), and [`0d16520`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/0d16520860d67903a007fc53dc9e1f9ff132009a)
- **Publication:** [v0.1.125 — Pan-Fried Radish Cake · 香煎蘿蔔糕](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.125), non-draft and non-prerelease, exact final source `0d16520`
- **Scope:** NotificationCenter, RegexBuilder, and AuthenticatorPanel retain their ordinary local downloads and add a safe Visual Studio Code handoff for the last export. Authenticator exports remain metadata-only; secrets and `otpauth://` URIs are omitted. Browser extension and GitHub Pages exports remain local-download-only because they have no privileged operating-system editor bridge.

### Verification boundary

- Full compiled Electron suite — **129/129 passed**.
- Built UI smoke — **45/45 passed**; download engine — **101/101 passed**.
- Documentation tests — **2/2 passed**; site check/build — **94/94**; release package contract — **63 assertions**.
- Typecheck, production build, and diff check passed.
- Fresh built RegexBuilder capture:
  `docs/screenshots/integrations/external-editor-desktop-exports-regex-post-integration.png`
  (1150×720, 98,762 bytes, SHA-256
  `6969fc98bd72787d8213bed44404b557e9ad2f49fd216ff711531ff29dafcf16`).
- GitHub Actions runs [31504097235](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504097235) and [31504141685](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504141685) published exact-source v0.1.124 and v0.1.125. The v0.1.125 workflow duration is **00:04:56**; its release contains Setup.exe, RELEASES, the full `.nupkg`, and the extension ZIP, with no CRX or signing material.
- GitHub Pages run [31504646111](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504646111) verified the live manifest at source `0d16520`, including the unsigned installer and versioned extension ZIP.

## v0.1.119 — external editor export handoff

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commits:** [`37237cd`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/37237cd82ec8b7c259b57a12ba248599ee218f70), [`36fbfb3`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/36fbfb3f0b278bb4d3031912488cc8d8ac15bbaf), [`c463160`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/c46316011a6dc7d244569f99ce7bb3248767a228), and [`209e144`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/209e144478ed4938b4758277201b5e9f23288ae0)
- **Publication:** [v0.1.119 — Orange Chocolate Bao · 香橙朱古力包](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.119), non-draft and non-prerelease, exact final source `209e144`
- **Scope:** Windows desktop discovery and native Browse selection for Visual
  Studio Code, safe app-owned export staging, workspace-root opening, Settings
  persistence/provenance, and History/Changelog export actions.

### Verification boundary

- `design/electron/__tests__/externalEditor.test.ts` — **7/7 passed**.
- `persistence.test.ts` — **13/13 passed**; the combined external-editor and
  persistence subset is **20/20**.
- Full compiled Electron suite passes **126/126** after the source changes.
- The real built Electron app smoke passes **44/44**. The Settings → Advanced
  capture is 534×232 pixels, 21,975 bytes, SHA-256
  `92dd6a25df6e810583878a61c5cec6c98e0acebdc6a7ceb267b898cce8843057`.
- GitHub Actions run [31499381710](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31499381710) published the unsigned release in `00:04:43`; Pages run [31499908812](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31499908812) verified the live manifest at source `209e144`.
- The extension and Pages site keep their honest local-download fallback; no
  native-messaging or browser-to-filesystem bridge was added.

## Unreleased — browser extension authenticator destination

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commits:** [`572d37e`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/572d37e0ddc3abd0eca495c1d97af4e7dde0fef2), [`1c5273d`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1c5273dfc77f23659d8aa2d0ed168c54bd22a04d), [`e0b8c39`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/e0b8c39f55982df59b2690f45c9cd9480b89ec73), [`d3822a7`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/d3822a780776ff00383751407022e013903f6be8), [`94b636c`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/94b636c6f2d3e3c1abe1ccaa30adcc9370325f28), [`e94beb4`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/e94beb486e0290c470b6013718f19043ff5467ec), [`1cd54d0`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1cd54d0176f83a1e92c23f102a4fa03276072a9e), and [`573e8b5`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/573e8b51e5405ff82990f7b8127a80343fa3f13f)
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

## Unreleased — scheduled settings foundation

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`8b6e5f9`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8b6e5f9c71e72cc5f86d8f85460ea6970b1c20fc)
- **Scope:** versioned local schedule records, native date/time and weekday
  editing, timezone and cross-midnight semantics, deterministic priority
  precedence, state/history persistence, live two-window IPC, and safe
  credential-free external-source metadata.

### Verification

- `npm run typecheck` and `npm run build` — passed.
- Scheduled-settings tests — **5/5 passed**; schedule-source resolver —
  **11/11 passed**.
- Full compiled Electron tests — **113/113 passed**; download-engine tests —
  **100/100 passed**; documentation tests — **2/2 passed**.
- Real built-artifact smoke — **43/43 passed**. The Settings capture is
  [`scheduled-settings.png`](docs/screenshots/settings/scheduled-settings.png)
  (524×738 PNG, SHA-256
  `471166F2C1DBBF3BDDD48603DBF5A4D573E60EDD9032B8E904D5727DF337E4C6`).
- GitHub Actions run [31493449594](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31493449594)
  succeeded for the exact source commit and published `v0.1.107`; the release
  is unsigned and contains no CRX artifact.

## Unreleased — authenticator management list and live codes

- **Source issue:** [#18 — Implement the universal feature contract](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
- **Source commit:** [`9c32741`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/9c3274134e6aa4b2d1de6b9f234fdf680b72f16f)
- **Scope:** bounded management follow-up to the authenticator Settings
  registration surface. It adds restart-safe metadata loading, vault-backed
  current/next TOTP codes, a numeric period countdown, copy action, and
  period-boundary request ordering. Reorder/group/bulk management, per-tab
  locks, and schedules remain separate work.

### Added

- Live current and next code rows fed only by the existing main-process
  `generateAuthenticatorCode` IPC method; the renderer never reads a secret.
- Numeric seconds-remaining countdown that refreshes at each period boundary,
  clears stale values when a vault entry is unavailable, and keeps the copy
  action disabled until a current code is ready.
- A real built-artifact smoke check that creates a disposable vault entry,
  reloads the app, verifies the live row, and removes the entry without writing
  its secret or code to evidence.

### Verification boundary

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused TOTP/UI tests — **14/14 passed**.
- Full compiled Electron tests — **110/110 passed**.
- Real built-artifact smoke — **43/43 required checks passed**. The existing
  secret-free registration capture remains
  [`authenticator-settings-empty.png`](docs/screenshots/authenticator/authenticator-settings-empty.png)
  (524×462 PNG, SHA-256
  `92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`). No
  live-code screenshot is claimed because the displayed digits are
  credential-bearing.
- GitHub Actions does not run tests or lint; local results are the test
  evidence. No signing operation or CRX artifact was added.

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

## Unreleased — current auto-organize gallery verification

- **Source commit:** [`84da5e1`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/84da5e1f2b10b6d88e9b946fe1523ad0295ddb2b)
- **Local verification:** `npm run build` passed; the real hidden-desktop/CDP
  smoke passed **43/43 required checks** in `13.094` seconds.
- **Renderer assets:** `index-D6pDySqX.js` SHA-256
  `5E55A622C73485693527C1BFE35981FDD9BDFBBD940A36DDC79D9CE98C1D7C27` and
  `index-DCh-PbGs.css` SHA-256
  `CCA54DDFA9227A90F08E686322973C5358042EE0F7A71B840E8165C85F8AE697`.
- **Gallery:** all seven auto-organize PNGs were freshly captured and copied
  from that run. Six are 1100×900 and one is 520×760; all are 24-bit PNGs with
  unique hashes. Their bytes match the tracked gallery exactly, so the refresh
  produces no artificial binary diff. Per-file hashes are recorded in
  [`HANDOFF.md`](HANDOFF.md).
- **Extension boundary:** the same built-app run verified automatic and manual
  browser-extension folder reveal, the Settings search's adjacent regex
  builder, and the narrow bilingual card without overflow or clipped text. It
  did not create a CRX or introduce signing material.
- **Cleanup:** the disposable app/profile/process tree, fixture server, folder
  window, and named headless desktop were removed; the final desktop inventory
  was zero.

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
