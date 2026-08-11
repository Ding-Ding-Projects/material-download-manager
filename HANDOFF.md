# Handoff: Material Download Manager

## Protected local history actions (verified on `codex/uh-history-manager`, 2026-08-11)

Issue [#16](https://github.com/Ding-Ding-Projects/material-download-manager/issues/16)
tracks this bounded Windows desktop history slice. Commit
[`512aa2c`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/512aa2cfa50ecf06ebe3e47985b0b3c8da31fa73)
adds first-class redacted revision diffs, bounded user labels, validated
append-only restore, and retention pruning with tombstones. Hardening commit
[`8ae3974`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8ae397469594585d5d1e062d0a575d8de352551a)
rebuilds restored items and queues from explicit public fields, keeps restored
work dormant, drops vault-backed source maps and unknown fields, preserves the
live School-mode credential state, and writes a canonical audit snapshot.
Labels and prune metadata are bounded, schema-checked sidecars. Restore
validates the complete state envelope and restores the previous live state if
either persistence or the required audit commit fails. Retention prunes only
state revisions; label, prune, and display-name audit revisions remain visible
so the retention decision cannot erase its own audit trail.

### Changed paths

- `design/shared/history.ts`, `design/shared/types.ts`: bounded diff, label,
  restore, prune contracts and IPC constants/validators.
- `design/electron/history/HistoryStore.ts`: redacted diff generation,
  sidecar labels/tombstones, append-only audit commits, and protected audit
  retention semantics. Credential-like keys, URL userinfo, query material,
  absolute Windows/UNC/POSIX paths, including paths with spaces, and
  identity/display metadata are redacted before a diff crosses IPC.
- `design/electron/download/DownloadManager.ts`, `main.ts`, `preload.ts`, and
  `design/src/global.d.ts`: trusted restore/diff/label/prune wiring with
  allowlisted dormant restore, no vault-map reuse, request/result validation,
  display-name audit, and fail-safe rollback.
- `design/src/components/HistoryPanel.tsx` and `design/src/styles/global.css`:
  accessible row actions, inline diff, label editor, retention controls, and
  non-blocking notifications; only destructive prune uses the blocking
  confirmation gate.
- `design/electron/__tests__/history.test.ts`: validator, redaction,
  sidecar-label, append-only restore, tombstone-retention, and audit-presence
  coverage.
- `docs/features/history/`, `design/src/generated/documentationArticles.ts`,
  and the two real built captures below: behavior/security docs and the
  bundled offline article.

### Verification

- `npm run typecheck` and `npm run build` from `design/` — passed.
- Full compiled Electron tests — **132/132 passed**.
- Download-engine tests — **102/102 passed**.
- Documentation tests — **2/2 passed**.
- Built UI smoke — **45/45 passed**.
- `git diff --check` and the public-record vocabulary scan — passed.
- Real built History capture through the Cheap hidden-desktop/CDP route:
  [`history-manager-actions.png`](docs/screenshots/history/history-manager-actions.png),
  1150×720, 78,947 bytes, SHA-256
  `845E8EA17410AF2C4CE95CF3531C03CCB100664C768297746F460CE02BC75115`;
  [`history-manager-actions-diff.png`](docs/screenshots/history/history-manager-actions-diff.png),
  1150×720, 84,295 bytes, SHA-256
  `2F7C4290D2809095AC5D463F9DDF4D63C71FF3C3CCAD3A2F7C4CD5D1E6F28930`.
  The diff visibly shows `[LOCAL_PATH_REDACTED]`; a post-capture text probe
  found no absolute path, username, or user-authored display name.
- The history app process launched for capture was stopped and the hidden
  desktop was closed. No remote CI result is claimed by this handoff; the
  branch tip is dewed and ready for integration into `main`.

## External editor export handoff (published and verified, 2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded desktop slice, integrated into `main` at
[`0d16520`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/0d16520860d67903a007fc53dc9e1f9ff132009a). Commits
[`be14edb`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/be14edbd17b3ba19c4cdc8aa43f567d4bb5d8798) and
[`78b5184`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/78b5184bf7388f5ed665bc79a76fdde791f597a4) add the typed external-editor
contract, schema-v6 Settings selection/provenance, main-process discovery and
native Browse selection, and the export actions. NotificationCenter,
RegexBuilder, AuthenticatorPanel, History, and Changelog now open their last
successful export in Visual Studio Code. Export content is staged into a fresh
application-owned directory and the directory is passed as the workspace root.

The main/preload boundary validates paths, names, content size, result shapes,
and launcher resolution. `.cmd` launchers are converted to adjacent native
`Code.exe`/`Code - Insiders.exe` binaries, and the child process is never
started through a shell. Missing-editor recovery leaves the normal download
available and tells the user how to choose automatic discovery or Browse.

Local evidence:

- full compiled Electron suite **129/129**;
- built UI smoke **45/45**;
- download engine suite **101/101**;
- documentation tests **2/2** and site check/build **94/94**;
- release package contract **63 assertions**;
- typecheck, renderer build, Electron compilation, and documentation bundle
  checks passed;
- real built Electron app smoke **45/45**;
- Settings → Advanced capture: 534×232 pixels, 21,975 bytes, SHA-256
  `92dd6a25df6e810583878a61c5cec6c98e0acebdc6a7ceb267b898cce8843057`,
  stored at `docs/screenshots/integrations/external-editor-settings.png`.
- Fresh RegexBuilder capture: `docs/screenshots/integrations/external-editor-desktop-exports-regex-post-integration.png`, 1150×720 pixels, 98,762 bytes, SHA-256 `6969fc98bd72787d8213bed44404b557e9ad2f49fd216ff711531ff29dafcf16`.
- GitHub Actions runs [`31504097235`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504097235) and [`31504141685`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504141685) published exact-source v0.1.124 and v0.1.125; the final v0.1.125 workflow duration is `00:04:56`. Pages run [`31504646111`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31504646111) verified the live manifest from source `0d16520`.

The extension and GitHub Pages site do not claim a privileged editor bridge because
neither has a native-messaging or operating-system filesystem capability.

## Browser extension authenticator destination (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this extension slice. Commits
[`572d37e`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/572d37e0ddc3abd0eca495c1d97af4e7dde0fef2)
and
[`1c5273d`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1c5273dfc77f23659d8aa2d0ed168c54bd22a04d),
plus the refresh/accessibility hardening in
[`e0b8c39`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/e0b8c39f55982df59b2690f45c9cd9480b89ec73),
and focus/localization cleanup in
[`d3822a7`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/d3822a780776ff00383751407022e013903f6be8),
plus documentation/public-record commits [`94b636c`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/94b636c6f2d3e3c1abe1ccaa30adcc9370325f28), [`e94beb4`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/e94beb486e0290c470b6013718f19043ff5467ec), [`1cd54d0`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/1cd54d0176f83a1e92c23f102a4fa03276072a9e), and [`573e8b5`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/573e8b51e5405ff82990f7b8127a80343fa3f13f),
add the real Chromium extension Authenticator options destination. It accepts
manual or `otpauth://totp/` registration values, draws the QR locally, reveals
the manual secret only on explicit request, verifies a current code before
storage, and displays current/next codes with a readable countdown.

The extension has no operating-system credential-vault API. Metadata and the
validated secret fallback therefore live in separate versioned browser-local
records, plainly documented as not a security boundary, not synced, and not
exported. Clearing this extension's local storage is the reset route. Reads
fail closed on malformed or oversized records and prune orphan secret ids;
storage or redacted-history failure rolls back the mutation where possible.
The metadata list has its own search and full regex builder, metadata-only
export, redacted authenticator mutation entries, and a two-key/full-slider
removal confirmation. URI confirmation reuses the same normalized path as
manual confirmation, including the regression coverage.

Local verification on this branch: `npm test` from `extension/` **33/33 passed**;
new TOTP, QR, and browser-local store modules pass `node --check`; `git diff
--check` passed with expected line-ending normalization notices. The local QR
check is a payload-bound matrix invariant because this checkout has no scanner
decoder dependency; no scanner-backed capture is claimed. The extension keeps
the unsigned ZIP/Load-unpacked path and adds no CRX, signing key, or signing
operation. Image/camera/clipboard QR import, deliberate secret export, reorder,
  groups, and bulk management remain explicit follow-up work.

## Scheduled settings foundation (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded desktop slice. Source commit
[`8b6e5f9`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8b6e5f9c71e72cc5f86d8f85460ea6970b1c20fc)
adds versioned local schedule records, native date/time and weekday editing,
timezone and cross-midnight semantics, deterministic priority resolution,
local persistence/history, and live main-process IPC updates for both windows.
External-source metadata is credential-free in renderer state: HTTPS API,
explicit loopback development, and Home Assistant boolean records cross the
main-process validation boundary, while access tokens remain outside settings,
exports, logs, and history.

### Changed files and verification

- `design/shared/scheduledSettings.ts` and
  `design/src/components/ScheduledSettingsPanel.tsx`: bounded schedule schema,
  editor, timezone/date semantics, precedence, and source metadata.
- `design/electron/download/DownloadManager.ts`, persistence, `main.ts`,
  `preload.ts`, shared types, and Settings wiring: persistence, history, IPC,
  and live two-window propagation.
- `design/electron/__tests__/scheduledSettings.test.ts` and
  `design/ui-tests/smoke.mjs`: schedule/resolver and real built-artifact proof.
- `docs/features/settings/scheduled-settings.md` and
  `docs/screenshots/settings/scheduled-settings.png`: behavior, security,
  failure modes, and the captured Settings surface.

Local evidence:

- `npm run typecheck` and `npm run build` — passed.
- Scheduled settings **5/5**, schedule-source resolver **11/11**, full
  compiled Electron **113/113**, engine **100/100**, documentation **2/2**.
- Real built-artifact smoke **43/43**. The 524×738 Settings capture has
  SHA-256 `471166F2C1DBBF3BDDD48603DBF5A4D573E60EDD9032B8E904D5727DF337E4C6`.
- GitHub Actions run
  [31493449594](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31493449594)
  succeeded for the exact commit and published `v0.1.107`; artifacts remain
  unsigned and no CRX was created.

## Authenticator management list and live codes (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded desktop management slice. Source commit
[`9c32741`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/9c3274134e6aa4b2d1de6b9f234fdf680b72f16f)
extends the existing authenticator Settings tab with a real persisted metadata
list that reloads after restart, vault-backed current and next TOTP code
display, a numeric seconds-remaining countdown, and an explicit clipboard copy
action. The renderer calls only the existing typed
`generateAuthenticatorCode` IPC seam; secrets remain in the operating-system
credential vault and never enter local metadata storage, ordinary exports,
history, logs, or the smoke result.

The row refreshes on initial load and at each period rollover. A per-entry
request generation prevents a delayed vault response from replacing a newer
period. When a vault entry is missing or corrupt, both code fields are cleared
and the row reports that the entry is unavailable rather than offering stale
digits. The list's existing plain-text-first search and anchored regex builder
remain active. Reorder/group/bulk workflows, per-tab locks, and schedules are
not part of this slice. No signing or CRX artifact was added.

### Changed files and verification

- `design/src/components/AuthenticatorPanel.tsx`: live current/next code rows,
  countdown tick, vault-backed refresh, and user-triggered copy.
- `design/src/styles/authenticator.css`: responsive live-code row layout and
  numeric-code typography.
- `design/shared/authenticatorDisplay.ts`: secret-free period-boundary helpers.
- `design/electron/__tests__/totp.test.ts` and
  `design/electron/__tests__/authenticatorSurface.test.ts`: countdown boundary,
  no-network, IPC, copy, and secret-free renderer assertions.
- `design/ui-tests/smoke.mjs`: disposable built-artifact registration, reload,
  live current/next code/countdown/copy checks, and vault cleanup. It returns
  code widths and metadata IDs only, never the generated digits or fixture
  secret.
- `docs/features/security/totp-authenticator-core.md`, `site/content.js`, and
  `design/src/generated/documentationArticles.ts`: categorized behavior,
  security, failure-mode, and verification documentation.

Local evidence for this handoff:

- `npm run typecheck` — passed.
- `npm run build` — passed (renderer and Electron output).
- Focused TOTP/UI tests — **14/14 passed**.
- Full compiled Electron tests — **110/110 passed**.
- Real built-artifact smoke — **43/43 required checks passed**. The new
  `settings-authenticator-live-management` check registered a disposable
  vault entry, reloaded the app, verified six-digit current/next values, a
  numeric countdown, and an enabled copy action, then removed the vault entry
  and metadata. No live-code screenshot is claimed because the displayed
  digits are credential-bearing.
- The secret-free registration capture remains
  [`docs/screenshots/authenticator/authenticator-settings-empty.png`](docs/screenshots/authenticator/authenticator-settings-empty.png)
  (524×462 PNG, SHA-256
  `92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`),
  recaptured from the built renderer during the 43/43 smoke run.
## Current auto-organize gallery verification (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks the universal-feature follow-up that includes this bounded evidence
refresh. Source commit
[`84da5e1`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/84da5e1f2b10b6d88e9b946fe1523ad0295ddb2b)
was rebuilt before the real Electron application was launched on a named cheap
hidden desktop and driven through the committed CDP smoke harness. The run
passed **43/43 required checks** in `13.094` seconds and captured all seven
auto-organize states. Renderer freshness was verified before capture;
`index-D6pDySqX.js` is 565,125 bytes with SHA-256
`5E55A622C73485693527C1BFE35981FDD9BDFBBD940A36DDC79D9CE98C1D7C27`, and
`index-DCh-PbGs.css` is 66,627 bytes with SHA-256
`CCA54DDFA9227A90F08E686322973C5358042EE0F7A71B840E8165C85F8AE697`.

The fresh PNG bytes were copied into the tracked gallery and match the prior
tracked bytes exactly. That byte-for-byte result is evidence that the current
build still renders the documented states; no metadata was injected merely to
force binary churn. Each image was opened at original resolution and inspected:

| Capture | Dimensions | SHA-256 | Inspected state |
| --- | ---: | --- | --- |
| `01-six-category-paths.png` | 1100×900 | `6865326A14705FD4229EFDEA4D2A015F38DD1D36AC4061F31951ADB3C0816013` | Enabled routing and six generic `C:\Downloads` paths |
| `02-ordered-rule-editor.png` | 1100×900 | `FCD9BD786DD2B51297226FE1B336F18BC5FA0A1AB96F123E59B3C18EB9B1BC06` | Two ordered rules with destination and move controls |
| `03-anchored-regex-builder.png` | 1100×900 | `5EC02087A536C3096B96AEDB771EC2AB842321011828B58060250961BD0D6AC1` | Rule-local JavaScript regex builder anchored inside Settings |
| `04-inline-invalid-rule.png` | 1100×900 | `C8C81E557613E3C2C971179CCEABD4A249458854B98F794D9BE6CB061B55711C` | Blank pattern error and disabled Save action |
| `05-narrow-rule-layout.png` | 520×760 | `E48ECF3AD3786EC600C94D8CA7DEBD3C6A666302862370316E48621B5E374A63` | Narrow builder reflow without horizontal clipping |
| `06-bilingual-category-settings.png` | 1100×900 | `9E0C7FD9B8F11C0A6AD0597E81B8D38AA4622833102EF2EDB7DBF133D8E74D82` | English and Cantonese Downloads settings |
| `07-command-palette-destination.png` | 1100×900 | `71324F4523B3D46A47807EE955C8764C2719816016A62D19A6D1C9A1FC6644A5` | Exact auto-organize destination and adjacent full regex builder |

The same run verified both automatic and manual browser-extension folder
reveal, preserved the Settings search's adjacent regex builder, and found no
horizontal overflow or clipped text in the 520 CSS-pixel bilingual extension
card. No search field was added or changed by this refresh. No CRX was created,
and no signing material or signing operation was introduced.

The harness terminated the Electron process tree with zero survivors, closed
the fixture server, and removed its disposable profile. The isolated folder
window opened by the reveal check was then closed through the same cheap
headless route; the named desktop disappeared and the final cheap desktop
inventory reported zero entries. The expected invalid-format diagnostics from
negative History and Changelog export probes did not change the passed result.

## Updater ready-state integrity and unsigned warning (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded desktop updater slice. Source commit
[`0a47393`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/0a473939b6bbee657d199903a9056e53e871c7d4)
verifies Squirrel `RELEASES` metadata before a download enters `ready`:
unsafe redirects, oversized or malformed indexes, invalid SHA-1 entries,
invalid sizes, duplicate full packages, and version mismatches are rejected.
The validated ready state carries the full package name and size, Squirrel
SHA-1, and a SHA-256 digest of the `RELEASES` body; preload validation rejects
malformed integrity metadata before it reaches the renderer.

The ready banner now displays localized unsigned-artifact copy naming the
missing code signature and possible unknown-publisher or SmartScreen warning.
No signer, CRX, or alternate publication path was added. Local verification
recorded **112/112** compiled Electron tests, documentation **2/2**, typecheck,
renderer/Electron build, fresh `build.bat /s`, and UI smoke **42/42**. The live
feed probe verified the full package's SHA-1/size and the index SHA-256; no
updater-ready capture is claimed because unpacked smoke intentionally disables
updates and a packaged run would start a native download.

## Authenticator Settings registration surface (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded desktop UI slice. Source commit
[`385e040`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/385e04030b0eebc6df5afa1370571226b9dd9d56)
adds the real Settings authenticator tab, local QR rendering, explicit
one-time manual-secret reveal, pairing confirmation before vault mutation, and
secret-free metadata list/export. The Settings tab has its own search and
regex-builder state, and the command palette can open it directly.

The QR matrix is rendered in-process from the bundled `qrcode` dependency; the
registration surface makes no network request. A pending registration lives
only in renderer memory until the main-process confirmation handler verifies a
current code. Only then does the existing credential-vault service write the
secret and return metadata. The renderer profile stores validated metadata
only; ordinary export states `secretOmitted: true` and contains neither a
secret nor an `otpauth://` URI. Cancel and successful pairing clear the
secret-bearing model and the manual-reveal state.

This is intentionally not the full authenticator product: live code display and
countdown, reorder/group/bulk management, per-tab locks, and schedules remain
separate follow-up work. No signing or CRX artifact was added.

### Changed files and verification

- `design/src/components/AuthenticatorPanel.tsx` and
  `design/src/styles/authenticator.css`: Settings registration/list/export
  surface, local QR SVG, one-time manual reveal, responsive layout, and
  secret-free empty/list states.
- `design/electron/main.ts`, `preload.ts`, shared IPC types, and
  `TotpRegistrationService.ts`: typed pending-code confirmation that runs
  before vault mutation.
- `design/electron/__tests__/authenticatorSurface.test.ts` and
  `totp.test.ts`: no-network/source-boundary, Settings wiring,
  secret-free export, and wrong-code/no-vault-write coverage.
- `design/ui-tests/smoke.mjs`: built-artifact Authenticator surface check and
  secret-free capture option.

Local evidence from the source commit:

- `npm run typecheck` — passed.
- `npm run build` — passed (renderer and Electron output).
- Focused TOTP/UI list — **12/12 passed**.
- Full compiled Electron list — **100/100 passed**.
- Real built-artifact smoke — **42/42 required checks passed** in `11.119`
  seconds; the new `settings-authenticator-surface` check verified nine
  registration/list controls, hidden pairing/manual-secret state, no URI in
  ordinary text, and an active Authenticator tab.
- Secret-free registration capture:
  [`docs/screenshots/authenticator/authenticator-settings-empty.png`](docs/screenshots/authenticator/authenticator-settings-empty.png)
  (captured from the built app's registration card at 1100×900; 524×462 PNG,
  SHA-256
  `92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`). The
  capture contains no QR, manual secret, URI, metadata entry, or credential
  bytes; the explicit reveal control is visible in the tested pairing flow but
  not photographed.

The GitHub Actions workflow remains a build/package/publication path and does
not run tests or lint; the local results above are the test evidence. The
remote run and release for the pushed branch must be read from their exact
records.

## Local TOTP and QR registration core (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this bounded model/main-process slice. Source commit
[`ce09797`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ce09797e6c230cbb1fa9d1594fc2660655aa0cdf)
is integrated into the default branch through the current merge. The model-only
slice remains deliberately separate from the later authenticator surface work.

The slice adds `design/shared/authenticator.ts`, the RFC 6238 engine and
credential-vault boundary under `design/electron/authenticator/`, focused tests
at `design/electron/__tests__/totp.test.ts`, and typed main/preload IPC channels.
Registration metadata is the only ordinary renderer/export result. The one-time
QR/manual-secret model is main-process memory; it is not persisted, logged,
snapshotted, or returned by metadata export. The operating-system vault is the
only secret persistence boundary.

Verification is complete locally: `npm run typecheck`,
`npm run build:electron`, focused TOTP **8/8**, existing Electron **95/95**,
`npm run docs:bundle:check`, and documentation tests **2/2**. This model-only
slice has no user-facing QR/authenticator surface, so no visual capture is
claimed. The next owner should build the full authenticator tab and QR image
renderer only after preserving the secret-free IPC/export boundary; per-tab
locks, schedules, and authenticator-list workflows remain separate work.

## Shared School mode presentation and dialog emoji settings (2026-08-11)

Source commit [`ecf9bc6`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ecf9bc65e6f78f08e109abfbed5aa897cbdbb86d)
adds the next bounded desktop presentation slice. The main process owns a
schema-v5 local application-data record for a user-renamable School mode label,
its enabled state, a persisted dialog/message-box emoji switch, and reset
credential metadata. The canonical `presentation:get` / `presentation:set`
IPC boundary validates the allowlist and broadcasts `presentation:changed` to
both the main and separate progress windows. Existing settings are migrated
conservatively; malformed metadata becomes `unavailable`.

School mode forces English and serious copy, removes language, bilingual,
funny-level, and emoji controls from Settings and the command palette, filters
playful/dim-sum documentation and changelog surfaces, clears the startup
surprise, and suppresses decorative notification emoji. Stored language,
funny-level, emoji, and mode-name choices remain recoverable. Exiting while the
local reset credential metadata is not `configured` fails closed and leaves the
mode enabled; this slice intentionally does not add password or TOTP
enrollment. Deleting the shared local application-data folder remains the
documented user-directed recovery route.

### Verification and real-artifact evidence

- `npm run docs:bundle:check` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; renderer `index-9-ppiL__.js` SHA-256
  `AB1C07E2AF56D3A24E084D7EA04FAEBBAA11F6A114816B27B2D41A3149B0732B` and
  `index-CL9UO5Fq.css` SHA-256
  `23FF81988A28774B46E99E5FC38739905D813F8E7098D218325B9AC7974A0D45`.
- Compiled Electron checks — **88/88 passed**.
- Downloader/engine checks — **99/99 passed**.
- Cheap Lowlevel hidden-desktop smoke from this source commit opened the real
  Settings surface at 1150×720. The emoji-control state is captured at
  [`docs/screenshots/settings/school-mode-off-emoji-control.png`](docs/screenshots/settings/school-mode-off-emoji-control.png)
  (SHA-256
  `AAC74504311B2B795C8D8FD479750E938E6FB07C042E643DBAC606B60D9E94A8`), and
  the enabled state that removes the language/funny/emoji controls is at
  [`docs/screenshots/settings/school-mode-on-controls-suppressed.png`](docs/screenshots/settings/school-mode-on-controls-suppressed.png)
  (SHA-256
  `60A93B232437B6C9FDE4F38FB9CB6DBD6A554C1FF33204FFCC771EF03E206BED`).
  Both PNGs were opened and inspected after capture; the disposable profile,
  process, and hidden desktop were removed.
- GitHub Actions remains a build/package/publication path and does not run
  tests or lint; the local results above are the test evidence. No signing
  material or CRX artifact was introduced.

## Built-artifact smoke and gallery refresh (2026-08-11)

Commit [`92dc67a`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/92dc67a17fbad4f7471cda5d7d85c1b4b78c44a5)
rebuilt the renderer and Electron main process with `npm run build` before a
fresh hidden-desktop/CDP run of `design/ui-tests/smoke.mjs`. The run passed
**42/42 required checks** in `10.488` seconds from the exact landed source,
including the protected History setup/unlock path, automatic browser-extension
folder reveal, manual reveal fallback, narrow bilingual layout, and all seven
gallery states. The renderer assets were `index-CUWEWH76.js` (SHA-256
`34EF8CF409C1C6B5248E7F345CC9F2F58BD17C1A8022014D275C220F448FFCCC`) and
`index-CL9UO5Fq.css` (SHA-256
`23FF81988A28774B46E99E5FC38739905D813F8E7098D218325B9AC7974A0D45`).

The seven tracked auto-organize gallery images were replaced with the exact
PNG bytes emitted by that run. Six are 1100×900 and the narrow builder frame is
520×760; all decode as 24-bit PNGs and have unique hashes:

| Capture | Dimensions | SHA-256 |
| --- | ---: | --- |
| `01-six-category-paths.png` | 1100×900 | `6865326A14705FD4229EFDEA4D2A015F38DD1D36AC4061F31951ADB3C0816013` |
| `02-ordered-rule-editor.png` | 1100×900 | `FCD9BD786DD2B51297226FE1B336F18BC5FA0A1AB96F123E59B3C18EB9B1BC06` |
| `03-anchored-regex-builder.png` | 1100×900 | `5EC02087A536C3096B96AEDB771EC2AB842321011828B58060250961BD0D6AC1` |
| `04-inline-invalid-rule.png` | 1100×900 | `C8C81E557613E3C2C971179CCEABD4A249458854B98F794D9BE6CB061B55711C` |
| `05-narrow-rule-layout.png` | 520×760 | `E48ECF3AD3786EC600C94D8CA7DEBD3C6A666302862370316E48621B5E374A63` |
| `06-bilingual-category-settings.png` | 1100×900 | `9E0C7FD9B8F11C0A6AD0597E81B8D38AA4622833102EF2EDB7DBF133D8E74D82` |
| `07-command-palette-destination.png` | 1100×900 | `71324F4523B3D46A47807EE955C8764C2719816016A62D19A6D1C9A1FC6644A5` |

The same landed smoke run also recaptured the browser-extension install/reveal
card at [`docs/screenshots/browser-extension/settings-install-and-reveal.png`](docs/screenshots/browser-extension/settings-install-and-reveal.png).
It is a 524×233 PNG with SHA-256
`B465ABCB5A4B4BBB605B5289A27E75BF2DB473408481C1AE32EEB9997BE08785`; its
temporary staging path was rooted at a generic `C:\Temp` folder so no user
name appears in the published image.

The smoke process tree, disposable profile, and named headless desktop were
cleaned after the run; the final desktop inventory reported zero entries. The
negative export probes intentionally emit invalid-format diagnostics while the
overall smoke result remains passed. No signing material or CRX artifact was
introduced.

## Shared School-mode reset credential (2026-08-11)

Issue [#18](https://github.com/Ding-Ding-Projects/material-download-manager/issues/18)
tracks this desktop slice. Commit
[`3b76509c684a2fc5c795d92400e10cd803c511e3`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/3b76509c684a2fc5c795d92400e10cd803c511e3)
is published on `codex/uh-school-credential`.

The main process now owns a serialized School-mode credential service with
setup, change, reset, and turn-off verification handlers. A stable
`MaterialDownloadManager.SchoolMode.v1` operating-system vault record contains
only a versioned random salt and scrypt verifier. Renderer IPC returns
metadata-only `PresentationSettings`; the credential value never enters
`state.json`, local history snapshots, exports, logs, notifications, or the
renderer bundle. Metadata state (`unavailable`, `unconfigured`, `configured`)
propagates through `presentation:changed` to both the main window and the
separate progress window.

If the app-data `state.json` is absent at startup, the service treats that as
the deliberate deletion recovery route and removes an orphaned vault record.
A previously configured profile whose vault record is missing becomes
`unavailable` and cannot disable School mode. Reset rolls the verifier back if
the metadata write fails, keeping the vault and metadata aligned where the
platform allows it; an unrecoverable vault write remains fail-closed.

### Verification and built-artifact evidence

- `npm run docs:bundle:check` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; the renderer emitted `index-kWX_jsfD.js` (SHA-256
  `5844713025366765B73B14AACEBE156668ED49BCCD48FF39FB0803AF2B957EA3`) and
  `index-C-AqvXg_.css` (SHA-256
  `21D729A0A9EC8499337DD4DD6EDCB9FD44CDE434A6D877F544A84766CA2A7F26`).
- `npm run test:docs` — **2/2 passed**.
- `npm run test:electron` — **104/104 passed**.
- `npm run test:engine` — **99/99 passed**.
- Hidden-desktop capture from the real built application at 1150×720:
  [`school-mode-credential-turnoff.png`](docs/screenshots/settings/school-mode-credential-turnoff.png)
  shows checked School mode, configured-vault status, recovery guidance, and
  the current-credential turn-off prompt without a credential value. PNG
  SHA-256:
  `1BA68A701556A1957756722A022B6708B32F8D0CAB1C2E71065B5C1DB96F24C1`.
- The smoke used a named cheap hidden desktop, direct Electron executable,
  background capture, and a disposable profile; all app processes and the
  profile were removed afterward. No signing material or CRX artifact was
  introduced.

The intentionally unimplemented follow-ons are TOTP locks, schedules,
narration, appearance editors, and expansion of the history manager. The
shared browser-extension capture and release no-signing paths were not changed.

### Boundary hardening follow-up

Commit [`40fc29123da0c8b83c13176ab4ba526a4d5dcbd8`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/40fc29123da0c8b83c13176ab4ba526a4d5dcbd8)
is the security follow-up on the same branch. `presentation:set` now rejects a
direct renderer attempt to disable School mode even when metadata is
`configured`; only the credential service's verified main-process method can
perform that transition. `DownloadManager` rolls metadata and settings back
when persistence fails, and verifier validation buffers are scrubbed after
schema checks. The real Settings pixels are unchanged, so the existing
1150×720 capture and hash remain the evidence for the visible surface.

The follow-up checks are `npm run typecheck`, `npm run build:electron`,
`npm run test:electron` (**104/104**), and `npm run test:engine`
(**100/100**).

## Fresh-machine build contract (2026-08-11)

The repository now has root [`build.bat`](build.bat) and
[`build-installer.bat`](build-installer.bat) entry points for a clean Windows
machine. They resolve helper paths from the checkout, accept `/s`,
`--silent`, `SILENT=1`, and `MDM_BUILD_SILENT=1`, return child exit codes, and
never prompt or launch anything in silent mode. The bootstrap checks for the
declared Node.js 22.16.0 runtime, tries a user-scoped `winget` route, verifies
the official Node.js archive checksum when that route is unavailable, refreshes
the current process `PATH`, and installs the locked project packages without
global npm changes.

`build.bat` verifies the renderer, main-process output, native Electron and
esbuild binaries, package-lock bytes, tracked-source status, and current Git
commit. `build-installer.bat` derives a strict semver from `design/package.json`,
invokes the committed unsigned Squirrel helper and validator, stages from
`design/release/squirrel-windows`, and reports the setup executable,
`RELEASES`, full packages, sizes, SHA-256 digests, source commit, and
`NotSigned` status. The local path never creates a release, tag, upload, or
CRX, and never handles signing material. The output states the intentional
unsigned/SmartScreen warning.

The focused contract fixture covers arbitrary working directories and spaces,
help/unknown-argument handling, silent markers, lockfile validation, and the
no-publication guard. The complete behavior and recovery matrix is documented
in [`docs/features/build/fresh-machine-build.md`](docs/features/build/fresh-machine-build.md).

## Protected display-name history (2026-08-11)

Issue [#16](https://github.com/Ding-Ding-Projects/material-download-manager/issues/16)
tracks the first desktop slice of protected local mutation history. Source
commit [`afb71fd`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/afb71fd)
is on branch `codex/uh-display-history`; this handoff documentation is the
follow-up record for that exact source commit.

The application display name is now a versioned setting owned by the main
process. Renderer local storage is used only as a bounded legacy migration
source, and the key is cleared only after the main-process settings write
succeeds. The main process canonicalizes and validates the label, saves it,
then appends `display-name.json` before the settings IPC call reports success.
That dedicated revision stores a schema version, previous SHA-256 (or `null`),
and next SHA-256; it never stores the chosen name. Reset and change actions are
separate searchable history actions.

The History tab is visibly locked until the user creates or enters a password.
The operating-system credential vault stores only a versioned salt and scrypt
verifier. A per-window unlock session is cleared on lock or window close, and
history view/export IPC rejects a locked renderer. Wrong passwords, malformed
vault records, missing credentials, and required history-write failures fail
closed. The setting rolls back when the required redacted history commit fails.

The boundary is intentionally narrow and documented: broader `snapshot.json`
history revisions remain plaintext local metadata, so the UI password is not
claimed as encryption or filesystem access control. The dedicated display-name
record is hash-only; ordinary operating-system account and disk protection
remain required.

### Changed files and verification

- `design/electron/history/HistoryAccessVault.ts` and
  `HistoryAccessSession.ts`: vault verifier and per-window locked/unlocked
  session state.
- `design/electron/history/HistoryStore.ts`: append-only hash-only display-name
  records and `display-name-changed`/`display-name-reset` actions.
- `design/electron/download/DownloadManager.ts`, settings migration, shared
  types, preload, main IPC, display-name consumers, and the History panel:
  canonical mutation, rollback, visible lock state, and stable identity.
- Focused tests cover verifier setup/wrong password/corrupt vault, locked
  session state, redacted record contents, settings migration/validation, and
  required-history rollback.

Local evidence on the branch:

- `npm run typecheck` — passed.
- `npm run build:electron` — passed.
- Focused Node list — **46/46 passed**.
- `git diff --check` — passed before the source commit.

The repository's GitHub Actions workflow is not a test gate; any remote build,
release, and Pages results for the pushed documentation follow-up must be read
from their exact run records. No signing operation or CRX artifact was added.
The real built-artifact locked History surface was captured through the approved
hidden-desktop/CDP route at
[`docs/screenshots/history/protected-history-locked.png`](docs/screenshots/history/protected-history-locked.png).
It shows the password setup form, vault explanation, reset route, and disabled
export state. The image is a 1150×720 PNG with SHA-256
`53DBA85C6FED4704995D5D6D7893F3A51590A6A942E870FE6B074E6F9A5C2361`; the
temporary profile, process, and hidden desktop were cleaned up after capture.

The pushed head `2bbcb5993c001e35fbdacd8a0f9266cc2424f2a4` was built and
published by GitHub Actions run
[`31483227655`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31483227655),
which completed successfully in `00:03:36` from
`2026-08-11T10:40:12.000Z` to `2026-08-11T10:43:48.601Z`. Stable release
[`v0.1.59`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.59)
is non-draft and non-prerelease, targets that exact commit, and carries
`Setup.exe`, `RELEASES`, the full `.nupkg`, and the versioned extension ZIP.
The artifacts are intentionally unsigned and no CRX is attached. The workflow
does not run tests; the local results above remain the test evidence.

## Authenticated automatic browser capture and app-prepared extension (2026-08-11)

Issue [#14](https://github.com/Ding-Ding-Projects/material-download-manager/issues/14)
tracks the current implementation. The task checkout changes the Chromium
extension from manual page/link capture only to default-on automatic browser-
download capture while preserving the manual popup and context-menu paths.

For an eligible new HTTP(S) download, the service worker pauses the exact
Chrome item before handoff and stores a bounded identity claim. It sends only a
fresh nonce to `GET /v2/challenge`; the app must prove the app-prepared pairing
with HMAC-SHA-256 before the extension sends any download URL. The subsequent
protocol-2 POST carries a one-use proof over every request field, and its final
accepted response carries a separate proof over the returned download id.

The app accepts a takeover only after a credential-free ranged GET succeeds
and the real manager record is durably persisted and started. Protocol 2 has no
provisional acknowledgement: only that final state returns authenticated
`202`. If the client disconnects before the response is delivered, the app
rolls the new record and protected source back. An unpaired client, rejection,
overload, invalid proof/response, source-read failure, timeout, offline app, or
another handoff failure resumes and retains the exact item that the extension
paused. Startup recovery finishes accepted claims or resumes paused claims; it
does not inspect and alter unrelated paused downloads.

The automatic request contains only a credential-free URL and, when the URL
path yields one safely, a basename limited to 512 characters. It never forwards
cookies, authorization headers, referrers, browser request headers, or the
absolute Chrome destination path. The desktop adapter validates that optional
basename independently. It also rejects website and malformed browser origins,
echoes only a valid 32-character `chrome-extension://` origin with
`Vary: Origin`, and retains originless loopback access for local process-
boundary diagnostics without granting cross-origin access. Query-bearing URLs
that the app accepts persist only in the operating-system credential vault,
remain redacted in state/history/renderer data, and are removed on terminal
cleanup.

Capacity is finite: at most 8 handoff POSTs may be active and at most 60
challenge/POST requests are admitted per rolling minute. Challenges are
one-use, expire after 30 seconds, and occupy a table capped at 64 entries.

The extension's Options page persists the default-on automatic-capture switch.
Turning it off leaves the manual handoff paths intact. The existing settings
search keeps its adjacent full regex builder; this feature added no unpaired
search field.

The desktop **Install browser extension** action rotates a local pairing
capability, keeps the app-side value in the operating-system credential vault,
writes its match only into the private staged extension beneath the stable
application-data directory, and automatically opens that exact folder.
Preparation and file-manager launch are reported as separate facts, so a
folder-open failure does not undo or misreport a completed copy. **Open
extension folder** remains the manual fallback.

Release automation now stamps the reserved stable version into only the staged
extension `manifest.json`, validates the archive root and manifest entry points,
requires the public pairing module to remain empty, rejects embedded
capabilities plus signing/CRX material, records structured size/SHA-256
metadata, and verifies the published ZIP by downloading it again. The generic
ZIP is a versioned source/reference artifact until the app prepares its private
paired copy. A genuine CRX3 is not published: it requires a persistent signing
key, while this repository permanently prohibits signing keys and signing
operations. The supported ordinary-user route is the app-prepared folder with
Chrome's **Developer mode → Load unpacked** flow.

GitHub Actions no longer runs tests, lint, type checking, static analysis,
coverage, accessibility checks, or screenshots. Local checks remain required
task evidence, while the workflows build, package, publish, deploy, verify
external assets, and retain safe failure evidence. The implementation is
integrated on main at
`f9e92db5d39efe7a33f124f8a2fde0b6b3392c76`. Stable release run
`31464131995`, release `v0.1.54`, and Pages run `31464419316` are verified
green. The release carries the unsigned Squirrel assets and versioned
extension ZIP; no CRX is attached because signing is permanently prohibited.

The final built-artifact capture run passed 43/43 checks on 2026-08-11. The
same local verification pass also recorded 14/14 extension tests, 95/95 engine
tests, 81/81 compiled Electron app tests, 44/44 site checks, and 47/47 release
package assertions. It
replaced all seven auto-organize gallery images with fresh 1100×900 frames (plus
the 520×760 narrow frame) and added a public-safe browser-extension install
and automatic-folder-open capture. The renderer assets were
`index-Chmat1Oe.js` (SHA-256
`E7B0448F42DBA46B86F28428FF15D22CB68437E837F914DC51F985CCD11A6297`) and
`index-BIukjjFo.css` (SHA-256
`5ED0A26C08B504D0D9FBF2EDCFD9ACC5D38012CD4A81F3537F9C63EAAD1C5420`). The
cheap hidden-desktop process tree, temporary profile, and named desktop were
cleaned up; the image status path used a generic system temporary folder so no
user name appears in the published capture.

## CI moved to GitHub-hosted runners (2026-08-08)

The three workflows (`ci.yml`, `pages.yml`, `release.yml`) now run on
`windows-latest` instead of the former four-label self-hosted contract. The
sole registered self-hosted runner `material-download-manager-self-hosted-20260807`
went offline and left every push queued — no verification, release, or Pages
run could complete — so on the repository owner's explicit direction the
project adopted GitHub-hosted runners. This reverses the earlier
self-hosted-only policy; because the repository is public, hosted runners also
remove the self-hosted-on-public-repo execution-surface risk. The self-hosted
bootstrap-assertion steps were dropped from the active workflows; the native
Electron/esbuild binary bootstrap (`complete-node-binary-bootstrap.ps1`) is
retained. `scripts/verify-self-hosted-bootstrap.ps1` and
`scripts/self-hosted-dependencies.json` are kept only as reference for a future
self-hosted re-introduction. Issue #12 tracks the runner decision. Code signing
remains permanently prohibited and unaffected.

## Reconciled state

The repository previously had two incompatible meanings for `design/`:

- `main` at `99fd6e6` held a Material Design prototype and a simulated engine.
- `origin/claude/submodule-design-folder-port-iyvesh` at `d588aac` held a
  runnable Electron + React + TypeScript application with a real download
  engine and tests.

The reconciliation keeps both states without allowing one to overwrite the
other:

- [`design/`](design/) is now the runnable application tree restored from the
  handoff branch.
- [`prototype/`](prototype/) contains the former `main` prototype with its
  relative assets and custom runtime preserved.
- The root README and this handoff identify the boundary explicitly.

This layout is intentionally reversible. It does not claim that the prototype
is production code, and it does not discard the prototype's visual reference
material.

The runnable application is now integrated on `main`. The original handoff
branch remains available as
`origin/claude/submodule-design-folder-port-iyvesh`; it was preserved rather
than rewritten.

The release helpers and workflows preserve the stable updater feed, the
reproducible line-count and dim-sum metadata helpers, and Squirrel.Windows
packaging. The current automation contract is documented in [`CI.md`](CI.md):
the release and Pages jobs use a pinned GitHub-hosted Windows image, the
dependency inventory is committed, and the release path performs a complete
native bootstrap after `npm ci`.

Code signing is prohibited. The stable release workflow clears inherited
signing inputs, temporarily disables `forceCodeSigning` only in the runner copy
of `design/package.json`, restores that file byte-for-byte, verifies
`Setup.exe` is `NotSigned`, and publishes a stable release only when the
published record reports `isPrerelease=false`, after build, package, and
Squirrel artifact checks pass. GitHub Actions runs no tests or lint. There is
no alternate distribution path.

The release workflow reserves a monotonic version tag and, when the public
catalog is available, a unique dim-sum code-name ref through the GitHub ref API.
It retains reservation tombstones after a failed later build so a future run
advances rather than recycling a release identity. A catalog outage does not
block the release; the release notes record that no code name was available.

The latest historical verification exposed a real concurrent StateStore write
race: two saves shared `state.json.tmp`, and one could rename it before the
other. StateStore now serializes saves per store, uses a unique temporary
filename for each atomic write, and cleans up temporary files after success or
failure. The engine test command also runs with `--test-concurrency=1
--test-timeout=60000` because its manager tests intentionally exercise
process-global Windows profile state and Node applies the timeout to each
compiled test file as a whole. The 60-second file budget accommodates the
deliberately serialized cases while still bounding a blocked file. The
self-hosted workflow references below are historical evidence for those exact
commits; they do not describe the current pinned-hosted automation contract.
Historical run
[31129129233](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31129129233)
was canceled after recording the race. The fix was verified by the historical
unsigned dispatch run
[31130475054](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31130475054),
which published the legacy `v0.1.0` test release from the corrected commit with `Setup.exe`,
`RELEASES`, and the full Squirrel package. Post-push verification run
[31131193046](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31131193046)
also passed. Those historical hosted runs do not verify the current
self-hosted workflows.

## Latest verified stable evidence

The earlier hardening handoff recorded main tip
`17cb95cd363b6935b9e9f6343825de51df2524d1` and stable release
[`v0.1.26`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.26).
That is historical evidence; the later default-branch tip is
`d37ad7cacbd7528bc80551375dc683be36c73eec` and the later verified stable
release is [`v0.1.28`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.28),
published from that exact commit with `isDraft=false` and `isPrerelease=false`.
The integration merge `ae0822c` and handoff commit `613869c` are now on the
default branch. Stable [`v0.1.31`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.31)
was the prior integration record. The current verified baseline is stable
[`v0.1.33`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.33),
published from exact `0050941cd34005b29ab4f31368101c3a9c5de4a6` with
`isDraft=false` and `isPrerelease=false`; its release, Windows verification,
and Pages runs are recorded below. The release feed remains dynamic for later
documentation-only refreshes.

The completed handoff branch has its own verified branch-only stable release
[`v0.1.35`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.35)
from exact `a221f31a5479bfb1fda736eae36a37351a923c0d`. It is real,
`isDraft=false`, `isPrerelease=false`, and carries `Setup.exe`, `RELEASES`, and
the full `material-download-manager-0.1.35-full.nupkg`. The release workflow
timing is `00:04:08` from `2026-08-07T18:35:22.000Z` through
`2026-08-07T18:39:30.000Z`; the Windows verification run is
[31188348179](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31188348179)
and the release run is
[31188346937](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31188346937).
Integration history commit `19ff65335e55babd5f2ba8b8be91ff37c5843eff`
contains that exact branch tip and every preserved task checkpoint without
replacing the hardened tree. It passed the local verification matrix below. At
this pre-publication checkpoint, default-branch release and Pages evidence
remain separate pending checks; issue #8 and rolling Discussion #3 carry the
post-push verdicts.

The v0.1.28 record above supersedes the older v0.1.26 release evidence for
current default-branch status.
The README and stable feed use the repository's dynamic latest-release link so
later successful pushes can advance the record without making this evidence
pretend to be timeless.

The replacement self-hosted verification chain is green: branch Windows
[31177366944](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31177366944),
branch stable release
[31177367237](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31177367237),
default-branch stable release
[31177456111](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31177456111),
default-branch Windows
[31177456115](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31177456115),
and default-branch Pages
[31177456127](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31177456127).
The release carries `Setup.exe`, `RELEASES`, and the full
`material-download-manager-0.1.26-full.nupkg`; its measured workflow timing is
`00:02:15`, from `2026-08-07T16:18:52.000Z` through
`2026-08-07T16:21:07.000Z`. The downloaded `Setup.exe` is explicitly
`NotSigned`, as required by the permanent no-signing policy.

The release code name is **Steamed Chicken Feet in Black Bean Sauce · 豉汁蒸鳳爪**,
resolved from the public `dim-sum-photos` catalog and linked to its published
photo asset in the release notes. The CI line-count table reports 36,641
included lines (33,585 non-blank) across source, tests, styles/markup, and
other project code, plus a 42,734-line grand total including excluded tracked
material. The counter reports zero surviving agent-attributed lines under its
automation-identity rule for this release.

At evidence-capture time, the live documentation site
https://ding-ding-projects.github.io/material-download-manager/ reported
`0.1.26`, the exact `17cb95c` source commit, `verified=true`, `unsigned=true`,
and `publication.pages=verified`. The homepage, manifest endpoint, and
immutable installer URL each returned HTTP 200. The live renderer's About view
displayed the verified publication state; the stable feed remains dynamic and
must be rechecked after any later release.

The later verified `v0.1.28` Pages publication reports its exact `d37ad7c`
source commit, `verified=true`, `unsigned=true`, and a stable installer URL;
the next integration release must be checked again because the feed is
intentionally dynamic.

The current verified Pages publication reports stable `0.1.31`, exact source
`613869cdff1e68c35d6b0dda1d60f73ef2aa4271`, `verified=true`, `unsigned=true`,
`publication.pages=verified`, homepage HTTP 200, manifest HTTP 200, and the
immutable installer URL HTTP 200.

## Self-healing electron bootstrap and v0.1.39

A fresh `npm ci` on the Windows verification host left
`node_modules/electron/dist/electron.exe` missing: npm 11's install-script
gate skipped electron's installer, and electron's own `install.js` exits 0 on
the host's Node 26 without extracting anything because its asynchronous
extraction is dropped at process exit. Commit
`0aed1d21d2eda649f3f715ec55d79caa4602fe8d` adds
`design/scripts/ensure-electron-binary.mjs` — a fully synchronous ensure step
that judges success only by the binary on disk, checksum-verifies any archive
against electron's bundled `checksums.json`, and restores from the
`@electron/get` cache or the official release URL — wired as `prestart` and
`pretest:ui`. The guard was verified in both directions: a no-op on a healthy
tree and a real restore after `dist/` was deleted.

The merge `356dc99d0d2124b6b8aea585ac6e3a13ea393525` landed on `main` after
the full local matrix passed (docs 2/2, typecheck, build, engine 38/38,
Electron 54/54, built-artifact UI smoke 25/25 with screenshot evidence). The
default-branch chain is verified green: Windows verification
[31215133820](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31215133820),
stable release
[31215134131](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31215134131),
and Pages
[31215133541](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31215133541).
That release run published stable
[`v0.1.39`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.39)
(code name Salted Caramel Chocolate Dumpling · 海鹽焦糖朱古力餃) from exact
`356dc99d0d2124b6b8aea585ac6e3a13ea393525` with `isDraft=false`,
`isPrerelease=false`, `Setup.exe`, `RELEASES`, and the full
`material-download-manager-0.1.39-full.nupkg`. The branch verification
release `v0.1.38` from `0aed1d2` and the sibling records `v0.1.36`/`v0.1.37`
are captured in the offline changelog, which is current through v0.1.39.

## Current slice: auto-organize downloads

The engine branch `claude/auto-organize-downloads` at
`faf94df12007b205ceb30cf8d05a9d3adbb37a74` is merged into the local task
branch through `a3f9ce2607fadc0b42e0bf59660299f010f0385d`. The Settings surface now
provides the default-enabled folder switch, six derived destination paths,
an accessible ordered custom-rule list, keyboard-operable first-match
precedence, field-specific inline validation, dynamic search over live path and
rule values, and one adjacent regex-only JavaScript builder per rule. General
is stored as `other`; `image` remains an internal built-in classification that
routes to General and is not exposed as a duplicate destination. Turning
folder organization off keeps new default-folder downloads flat but does not
disable classification rules, and existing downloads or files are never moved
retroactively. The default save folder must be an absolute Windows drive or UNC
path; an explicitly selected absolute non-default destination remains intact.

The renderer sends only allowlisted setting keys. The main process validates
and clones accepted values instead of trusting renderer-authored schema or
provenance metadata. Settings schema v3 requires an exact five-field rule
shape, unique non-reserved identifiers, bounded names and patterns, canonical
flags, one of six visible targets, and no extra keys. A fresh profile keeps
compiled-in provenance, an accepted mutation marks only its own keys persisted,
and a valid provenance map survives reload.
Per-setting Reset actions now cross a separate allowlisted key boundary. The
main process supplies compiled values and compiled-in provenance itself; Reset
all preserves the default save folder and restores every other setting in one
history mutation. Schema-v2 migration canonicalizes recoverable rules one by
one (including `image` to General, blank names, reserved or duplicate IDs, and
unknown fields) instead of allowing one legacy record to erase its neighbors.

Every desktop user-authored regular expression now executes in a terminable
main-process worker. Worker startup has an independent 10-second readiness
allowance; evaluation starts only after the ready handshake. Search and builder
requests use a 500 ms evaluation deadline. Classification uses a separate
one-second deadline and falls back to built-in extension detection on timeout
or failure; a zero deadline returns that fallback without starting worker work.
The Add download preview uses bounded IPC, preload result validation,
sanitized filename parity, and generation checks, while final `addDownload()`
routing evaluates independently at the trusted boundary. Collection-filter
responses never return sample, match, or capture text; full match details accept
exactly one sample and cap capture output at 100 groups and 64,000 code units.
A timed-out worker is terminated so a poisoned request cannot block the
Electron event loop or the next request.

Scheduled auto-organize values use the same exact validator and independent
nested clones. Generic API refreshes resolve every DNS answer, reject private,
loopback, link-local, mapped, mixed, and non-routable addresses, and pin the
accepted address into the real connection while retaining TLS hostname
verification. Resolution repeats per connection to reject DNS rebinding. Only
the explicit Home Assistant route may target a configured private HTTPS host.

The latest correctness/security finder and its independent refuter both
returned dry. Final local compiled verification is green: renderer and Electron
typechecks passed, the renderer and main process rebuilt from current sources,
`npm run test:engine` passed 57/57 in 28.4 seconds, and
`npm run test:electron` passed 67/67 in 6.3 seconds. Those suites include
trusted reset provenance, schema-v2 migration, DNS pinning/rebinding, nested
schedule cloning, concurrent cold-worker startup, deterministic zero-deadline
fallback, timeout recovery, bounded match-only/full-result IPC, first-match
manager routing, preview/final parity, raw-URL redaction, and History/Changelog
worker-error propagation.

The final pre-commit built-artifact smoke passed all 38 required checks in 10.528
seconds. It covers native-keyboard reorder, move/remove focus, unique contextual
names, field-specific error wiring, dynamic Settings search, guided-builder
limits, real IPC save/reopen and trusted reset boundaries, preview/final parity,
contrast, 40-pixel controls, four tab-search builders, separate History and
Changelog action errors, command-palette localization and exact destinations,
and combined 520-pixel bilingual layout. Cleanup observed the main process and
four descendants, received the child exit, verified zero exact-profile
survivors, removed the temporary profile, and was followed by a zero-process
external inventory. The independent accessibility/localization pass is dry and
separately passed 38/38 in 11.043 seconds with the same zero-survivor proof.
Documentation bundle checks passed 2/2, the Pages source passed 43/43, and the
Chromium extension passed 12/12.

The final documentation-only renderer rebuild emitted
`index-DYxCKsvA.js` and `index-DLDpdm-j.css`. A seven-image gallery refresh
against those exact assets completed between 2026-08-08T01:39:33Z and
2026-08-08T01:39:36Z. All seven files decode as 24-bit PNGs, have unique
SHA-256 hashes, and use the documented 1100×900 or 520×760 dimensions. The
capture finished with zero same-checkout Electron processes, zero disposable
profiles, and zero headless capture desktops. Commit
`a852a8c96292ed969c3900393945d8a5471fb0fb` was then fast-forwarded into the
local default branch. Remote CI, release, Pages, and issue-resolution verdicts
are recorded on issue #11 for the pushed integration commit; this static
handoff deliberately does not predict those external results.

## Current implementation slice verified and published

The active-download-cap test was corrected after real release run
[31176187879](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31176187879)
exposed a timing race: the old 300 ms response could complete before the
queued-state assertion and the suite ended 30 passed, 1 failed, and 1
cancelled. Commit `17cb95c` adds a promise-controlled response body gate in the
test server and releases it only after the assertion, with cleanup protection.
The engine suite passed 31/31 with 0 failures and 0 cancellations on three
consecutive local runs; the active-cap test took 2.28s, 2.57s, and 2.57s.
This is test infrastructure only; production download code is unchanged.

The earlier UI hardening slice below remains the historical implementation
record that established the separate progress window and extension handoff.

The fresh branch `codex/ui-hardening-20260807` hardens the History and Settings
slice: local-history commits disable hooks and signing, isolate the snapshot
path from unrelated staged files, and bound Git children; renderer settings
patches are fully validated at the IPC edge; interactive controls are no
longer nested inside labels; Settings grids collapse cleanly at narrow widths;
and the built-artifact smoke now seeds and fail-closes on the separate progress
window. Commits `6f6dc22`, `a0c27b6`, and documentation refresh `104a487` are
on `main` and pushed to the GitHub remote. Local verification is currently:
typecheck and build passed; 31/31 engine tests, 39/39 Electron tests, 23/23
built-artifact UI checks, 12/12 extension tests, and 41/41 site checks passed.
The first branch stable-release run
[31172713902](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31172713902)
then failed before packaging on Node `v22.23.2`: 21 smoke checks passed but
`escape-closes-builder-and-restores-focus` observed the Settings regex toggle
before its focus restoration. The follow-up in this checkout adds a
post-commit animation-frame focus pass and makes the smoke wait for the closed,
collapsed, focused state as one condition. The branch Windows verification
run [31172713914](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31172713914)
was green. Replacement branch release [31173473197](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31173473197)
and verification [31173473285](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31173473285)
were green and published stable `v0.1.17`; the default-branch release,
verification, and Pages runs [31173928252](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31173928252),
[31173930281](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31173930281),
and [31173928353](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31173928353)
were also green and published stable `v0.1.18`; documentation refresh release
`v0.1.19` and the post-publication Pages refresh are green as recorded above.

The reusable method is to treat DOM removal and focus restoration as one
observable contract in the built-artifact harness, while scheduling a second
focus pass after the React state commit for older Chromium/Node combinations.
The failed release is a real red verdict, not a release candidate: packaging
did not run and no draft, prerelease, or tag-only release was accepted.

## Current implementation slice: offline in-app documentation browser

The current branch adds a real Documentation tab to the Windows renderer. It
bundles all 30 categorized Markdown files under `docs/features/` through the
checked-in `design/src/generated/documentationArticles.ts` catalog, with a
build-time completeness guard that fails when the catalog is stale. The shared
React Markdown renderer keeps provider-authored text out of HTML injection,
resolves relative `.md` links inside the tab, leaves external links external,
and renders executable or absolute-local protocols as non-actionable text. The
surface has its own plain-text-first search and anchored bounded JavaScript
regex builder, participates in the persisted tab model, and is listed in the
`Ctrl+Shift+F` command palette.

The local verification for this slice is typecheck/build green, the bundle and
shared documentation tests are green, the download engine is 38/38, Electron
is 54/54, the built-artifact smoke is 24/24, and the Pages source check is
42/42. The smoke uses the real
compiled renderer and preload bridge to open the tab, search in both modes,
follow a relative article link, render a fenced code block, verify an honest
empty state, open the command-palette destination, and preserve the existing
separate progress-window, History, Settings, accessibility, and narrow-layout
checks. The full user-facing article catalog is currently source-authored
English while its surrounding app controls follow the selected language mode;
translated article copies remain explicit follow-up work rather than an
unverified claim.

The final integration also recovered 15 previously untracked tests before
cleanup: seven scheduled-source tests cover URL policy, bounded API and Home
Assistant behavior, fail-safe fallback, token isolation, and stale-response
ordering; eight history/export/changelog tests cover concurrent snapshots,
append-only restore and discard records, argument and size bounds, export
metadata and loss warnings, language serialization, commit links, filters, and
unsafe input. Commits `76a5e2b` and `061a56a` preserve that coverage and make
the existing scheduled-pause race deterministic with a promise-gated response
body and protected cleanup.

The offline changelog is current through stable `v0.1.35`: it embeds all 34
stable releases from `v0.1.2` onward with their published names, dates, and
exact tagged source commits. The Electron completeness test now resolves every
embedded SHA through the repository's Git object database; CI checks out full
history so a missing or invented commit fails before shipping. The guard was
proved by substituting a nonexistent 40-character SHA, observing the focused
test fail for that exact entry, restoring the real commit, and rerunning it
green.

The final built-artifact pass also corrected the freshness preflight itself.
Its root-source scan previously recursed into `dist/`, treated the freshly
written `dist/index.html` as source, and then rejected Vite's CSS asset for
being written one millisecond earlier. The preflight now enumerates only the
real root inputs (`index.html` and `vite.config.ts`) alongside `src/` and
`shared/`, so it still fails on stale artifacts without comparing output files
against one another.

The first branch release run [31187148273](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31187148273)
was intentionally red at the new bundle guard. The second branch Windows run
[31187443242](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31187443242)
confirmed the runner's fresh checkout converted tracked generated text to CRLF
while the generator emitted LF; the raw-byte guard therefore failed even after
the locale-dependent ordering was removed. The corrective commit normalizes
line endings before comparison and retains code-point ordering. Stable
`v0.1.34` verified that fix at `2602fdb`; the later handoff-only commit
`a221f31` then produced stable `v0.1.35` with green release and Windows
verification. Integration commit `7f7e7554` contains the complete verified
branch history.

## Runnable application

The application under `design/` includes:

- Electron main-process window and IPC setup.
- A typed preload bridge and shared IPC types.
- Real segmented HTTP downloads with Range requests, retry, pause/resume, and
  byte-integrity tests.
- Persistence, categories, queues, speed limiting, add-download probing, and
  React dialogs for the core download loop.
- Main-process-only custom headers, global active-download limits, schedule
  polling, redirect limits, retry bounds, and connection/idle/request timeout
  policy.
- Versioned language and funny-level settings, appearance persistence,
  non-blocking notification history, destructive-action gating, and renderer
  accessibility semantics.
- Tested foundations for the bounded regex builder, tab model and command
  palette, coding-format exports, and isolated local Git history.
- A first-class History tab exposes bounded revision metadata, date/action/text
  filters, an anchored regex builder, and filtered export without exposing raw
  snapshots.
- The Settings dialog has four persisted browser-style tabs with independent
  search and regex-builder state.
- A separate frameless download-progress window that follows a selected item,
  exposes pause/resume/cancel/close controls, and is opened through the real
  Electron IPC boundary.
- A loopback-only Chromium extension handoff protocol with a popup, context
  menu, settings/options surface, local regex builder, bounded metadata, and
  explicit queue-failure responses.
- An offline Documentation tab with the complete categorized article bundle,
  safe Markdown rendering, local article navigation, plain-text search, and an
  anchored regex builder.

The prototype under `prototype/` is not loaded by the Electron build. Its
simulated network layer remains reference-only.

The integrated main branch adds selected-text capture to the browser extension
context menu, an embedded in-app stable changelog viewer, and the offline
Documentation tab. The viewer currently contains 28 published stable records,
each with a full source commit link, ISO date filtering, anchored regex search,
filtered copy, and Markdown export. The Documentation tab bundles 30
categorized Markdown articles and resolves relative links locally. The stable
baseline before this slice is `v0.1.33` from `0050941`.

## Verification evidence

Run from `design/`:

```powershell
npm ci
npm run docs:bundle:check
npm run test:docs
npm run typecheck
npm run build
npm run test:engine
npm run test:electron
npm run test:ui
# from extension/: npm test
# from site/: npm run check && npm run build
```

The full local matrix was re-run green on integration tip `327b5a2` in a
Linux container on Node `v22.22.2` (2026-08-07): documentation bundle guard
2/2, renderer and Electron typecheck, Vite and Electron builds, engine 38/38,
Electron 54/54, built-artifact UI smoke 24/24 (under an Xvfb virtual display,
since the container has no native X server), Chromium extension 12/12, and
Pages source check 42/42 plus a passing site build. This confirms the
committed suites are reproducible outside the Windows runner; Windows
packaging evidence remains the self-hosted release workflow record below.

On the current verification tree, the following checks passed locally:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed renderer and Electron TypeScript checks. |
| `npm run build` | Passed Vite renderer and Electron main-process compilation. |
| `npm run test:engine` | 38/38 passed locally, including concurrent and cross-instance StateStore saves, failed-write recovery, Range integrity, pause/resume, non-resumable fallback, custom-header persistence and cross-origin header stripping, global queue limits, deterministic schedule race handling, manager history hooks, filename sanitization, malformed Range rejection, categories, throttling, URL redaction, bounded API schedule sources, and Home Assistant boolean sources. |
| `npm run test:electron` | 54/54 passed for export, local history, concurrent and append-only history foundations, hook/index isolation, argument and snapshot bounds, renderer-boundary history filter normalization, renderer settings validation, regex, tabs, documentation-link resolution/search bounds, command-palette foundations, compiled renderer-path resolution, secure updater IPC, version monotonicity, timeout/stale-event recovery, native Squirrel download-overlap protection, queue payload validation, Settings Escape handling, completion-notification preference handling, loopback handoff success/failure responses, the historical provisional acknowledgement behavior now superseded by protocol 2 final-only acceptance, export metadata/loss contracts, and changelog validation/filtering/store/IPC paths. |
| `npm run test:ui` | 24/24 required checks passed through the built Electron/CDP smoke harness: renderer freshness, real preload bridge, tab shell including Documentation, offline article index and Markdown rendering, plain-text and regex article search, relative article navigation, honest empty state, command-palette destination, History tab controls and honest empty state, a seeded separate progress window with a named progressbar, four Settings tabs, independent search, anchored regex builder, Escape focus restoration, interactive-label structure, narrow layout at 520 CSS pixels and 2× scale, and cleanup. |
| Chromium extension `npm test` | 12/12 passed for MV3 permissions and entrypoints, page/link/selected-text context-menu handoff, bounded link-target precedence, loopback protocol, bounded validation, settings import/export, regex safety, localization, and no remote assets/tracking. |
| `npm run test:docs` and bundle guard | 2/2 bundle tests passed; all 30 categorized Markdown files are present in the generated renderer catalog. |
| GitHub Pages source `npm run check` | 42/42 checks passed, including the new in-app documentation article, feature-article coverage, local-only assets, stable-manifest fail-closed behavior, publication-state rendering, prototype sanitization, and the browser-extension/progress-window articles. |
| Branch remote stable release | `31188346937` and Windows verification `31188348179` are green for exact `a221f31`; stable `v0.1.35` is non-draft/non-prerelease with `Setup.exe`, `RELEASES`, full `material-download-manager-0.1.35-full.nupkg`, timing `00:04:08`, and the `Steamed Bean Curd Skin Roll · 鮮竹卷` code name. Integration history commit `19ff653` contains that source tip and every preserved task tip; default-branch and Pages publication remain separate evidence. |
| Hidden-desktop progress capture | Passed through the cheap Lowlevel headless route: a real loopback handoff created a live download, and a dynamically resolved second `Chrome_WidgetWin_1` window rendered the separate 980×640 `Download progress` surface with the fixture filename, source URL, transferred bytes, speed, pause, cancel, and close controls. The capture was retained in the session scratchpad, outside the repository. The disposable desktop, Electron process, and fixture server were cleaned up. |
| Remote GitHub Actions | Default-branch stable release [31182280753](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31182280753), Windows verification [31182280767](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31182280767), and Pages run [31182280754](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31182280754) are green for `613869c`; branch stable release [31181815994](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31181815994) and Windows verification [31181815918](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31181815918) are also green. |

The hardening milestone corrected the compiled renderer path and made
unpackaged production launches load the built renderer unless
`NODE_ENV=development` is explicit. Server- or user-supplied filenames are
constrained to one safe Windows path segment, and ranged responses must agree
with their `Content-Range` before bytes are written.

The packaging command targets Squirrel.Windows x64, and the main process has a
bounded, fail-closed updater coordinator. The renderer receives validated
updater state through the secure preload bridge and shows explicit manual-check,
`Later`, release-notes, and `Restart to install update` actions guarded by a
fresh unsaved-work assertion. A compile-only success is not packaging evidence:
the current release path requires `Setup.exe`, `RELEASES`, every referenced
full or delta `.nupkg`, and `NotSigned` verification. The legacy unsigned
`v0.1.0` prerelease carries the historical CI-built feed and assets, while
`MDM_UPDATE_FEED_URL` remains an optional override. The stable feed was
verified through `v0.1.19` at the evidence-capture point; later successful
releases advance the same dynamic feed.

The repository has a [stable Windows release workflow](.github/workflows/release.yml)
on every push and manual dispatch. It uses the pinned GitHub-hosted Windows
image and committed dependency inventory, builds the app, validates Squirrel
and extension ZIP assets, publishes one stable non-draft/non-prerelease
release, records unsigned status, and verifies release timing and asset identity
after publication. GitHub Actions runs no tests or lint. The
[Pages workflow](.github/workflows/pages.yml) uses the same pinned hosted image
to stage the local site for deployment, asks `actions/configure-pages@v5` to
enable Pages when needed, and now has live verification at
https://ding-ding-projects.github.io/material-download-manager/. The site
injects the latest verified stable manifest only after the release asset
inventory is checked. The `v0.1.19` deployment additionally refreshed the
manifest after the stable release was published and verified the rendered
publication state through the live site.

The historical release branch also passed local static checks for the workflow and helper
contracts: `actionlint -shellcheck=` passed, all 8 PowerShell run blocks parsed,
the line-count table validated, the dim-sum metadata resolved to
`Classic Har Gow · 蝦餃`, and `electron-builder --version` resolved to
`24.13.3`. Those recorded self-hosted release and Pages runs remain historical
evidence only; the current task requires its own pinned-hosted run verdicts.

## Distributed SSH worker handoff

The current task branch adds opt-in distributed range downloads through pinned,
least-privilege Docker-backed SSH workers. The main process owns host identity,
provisioning, source-secret trust, vault records, range planning, retry and
quarantine state; the renderer only chooses local versus SSH and a worker
count. Exact source capability probing, framed worker responses, atomic piece
manifests, local assembly, whole-file digest verification, and safe local
fallback are covered in
[`docs/features/download-engine/distributed-ssh-workers.md`](docs/features/download-engine/distributed-ssh-workers.md).

The worker client enforces an idle deadline and an absolute range wall
deadline. Protected local fallbacks and distributed sources use the operating-
system vault; protected deletion writes a terminal cleanup tombstone before
removing the vault record. SSH inventory mutations are serialized across all
hosts, and the remote provisioner journals prepared/swapped/applied phases plus
an idempotent removal entry point outside the versioned worker root.

The implementation is verified locally by the focused manager/task/protocol,
vault, probe, planner, manifest, and worker tests plus TypeScript/build gates:
the compiled download-engine suite is 90/90, the Electron suite is 67/67, the
worker suite is 48/48, and the built-artifact Electron smoke is 39/39.
The Docker daemon was unavailable on the development machine, so a live image
launch is not claimed; the static Compose/resource contract and worker hostile
tests remain separate evidence. Before any real host is provisioned, recheck
reachability, capacity, active workloads, and the stored host-key pin. Do not
replace an unrelated workload or bypass a pin mismatch.

## Known follow-up work

These items remain open and are deliberately not hidden by the directory
reconciliation:

1. Compare the runnable renderer with the prototype and decide which Material 3
   visual and interaction changes should be implemented next.
2. Complete the remaining shared-memory product surfaces—full per-element
   appearance editing, complete tab/group management, renderer history,
   advanced changelog date/filter flows, complete bulk actions, and scheduled
   external settings—without wiring the prototype's simulated
   engine into the app.
3. Add renderer, IPC, packaging, accessibility, error-notification, and
   destructive-action coverage before calling the application release-ready.
4. The reusable local regex engine and builder foundation now live under
   `design/shared/regex.ts` and `design/src/components/RegexBuilder.tsx`; wire a
   separate anchored instance to every search surface before claiming the
   search requirement complete.
5. The reusable tab state model, tab strip, and `Ctrl+Shift+F` command palette
   now live under `design/shared/tabModel.ts` and `design/src/components/`;
   connect them to persisted app state and the real shell before calling the
   navigation requirements complete.
6. The shared export serializer covers the required coding formats under
   design/shared/export.ts; connect it to filtered records, history, settings,
   and changelog surfaces with visible warning and format controls.
7. The isolated Git-backed HistoryStore is now wired to manager state changes,
   including download creation/completion/error/pause/resume/retry/cancel,
   deletion, queue changes, and settings changes. Connect its browse/restore
   controls to the renderer and extend restore/diff coverage to every
   user-managed record before calling local history complete.
8. The renderer lane now supplies centralized accessibility semantics,
    non-blocking notification history, and the native destructive-action gate.
   Its current evidence is typecheck/build, 39 Electron tests, and a cheap
   headless History/Settings/progress/Escape/focus smoke; a renderer DOM harness, notification
   bulk actions, deletion history recording, and full-copy localization remain
   open.
9. The settings lane now supplies versioned language, funny-level, appearance,
    provenance state, four browser-style Settings tabs, per-tab search, and an
    anchored regex builder with persistence tests. Full appearance-editor depth
    and copy wiring across every renderer message remain open.
10. Keep the landing page, changelog viewer, release line counter, and
    sanitized instruction mirror current as the product surfaces are
    implemented.

## Git state and ownership

This reconciliation, CI hardening, browser capture, and changelog viewer are on
`main`; the pushed default branch is the source of truth for the verified stable
release. The agent-owned integrated linked checkouts were clean,
their tips were proven ancestors of the pushed default branch, and their
branches and directories were removed after that proof. The original
handoff history is preserved as an ancestor, and the original handoff branch
remains untouched. Application issue [#8](https://github.com/Ding-Ding-Projects/material-download-manager/issues/8)
remains open for this continuing handoff. The separate `agent-global-memory` repository
has open issues [#10](https://github.com/Ding-Ding-Projects/agent-global-memory/issues/10)
and [#12](https://github.com/Ding-Ding-Projects/agent-global-memory/issues/12),
which are owned by Status Hub and runner work and were left untouched here. GitHub
Discussions are enabled and the rolling handoff thread is
[`#3`](https://github.com/Ding-Ding-Projects/material-download-manager/discussions/3).
The `v0.1.0` announcement is [`#4`](https://github.com/Ding-Ding-Projects/material-download-manager/discussions/4);
the historical `v0.1.14` release announcement is [`#7`](https://github.com/Ding-Ding-Projects/material-download-manager/discussions/7),
and the previous `v0.1.8` announcement remains in the Discussion history. The
wiki setting is enabled but its wiki repository is not
initialized. GitHub Pages is enabled, deployed, and live at the URL above. The
unsigned `v0.1.0` test release is historical evidence only; the stable feed is
the dynamic latest-release record.

The four linked checkouts that previously held uncommitted work are preserved
as commits `b4a08e0`, `c7b9f62`, `c0b8d1a`, and `02cb473`; the former stash
payload is preserved as `34639e9`. Integration history commit `19ff653`
records every retained task tip as an ancestor without replacing newer files.
Cleanup of merged task branches, linked checkouts, and the redundant stash is
permitted only after the pushed default branch contains the final handoff and
remote release checks report their actual result. Issue #8 and rolling
Discussion #3 are the durable post-push record.
