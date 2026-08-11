# Handoff: Material Download Manager

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
No built-artifact screenshot is claimed in this handoff until the real locked
History surface is captured through the approved hidden-desktop route.

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
