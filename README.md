# Material Download Manager

Material Download Manager is a Windows Electron download manager ported from the
AB Download Manager codebase.

## Quick index

- Runnable app: [`design/`](design/)
- Preserved visual prototype: [`prototype/`](prototype/)
- Handoff: [`HANDOFF.md`](HANDOFF.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- CI and release contract: [`CI.md`](CI.md)
- Shared project guidance mirror: [`AGENTS.md`](AGENTS.md)
- Release workflow: [stable Windows release](.github/workflows/release.yml)
- GitHub Pages source: [`site/`](site/)
- Live site: [Material Download Manager on GitHub Pages](https://ding-ding-projects.github.io/material-download-manager/)
- Latest stable release: [view the latest stable GitHub Release](https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest)
- Fresh-machine build: [`build.bat`](build.bat) and [`build-installer.bat`](build-installer.bat)
- Fresh-machine build docs: [`docs/features/build/`](docs/features/build/)
- Chromium extension: [`extension/`](extension/) — catches eligible browser downloads automatically by default through an app-prepared authenticated pairing and is packaged with every stable release as the versioned source/reference ZIP `material-download-manager-extension-<version>.zip`; use **Install browser extension** in the app, then choose its automatically opened paired folder with **Load unpacked** at `chrome://extensions`
- Search feature docs: [`docs/features/search/`](docs/features/search/)
- Navigation feature docs: [`docs/features/navigation/`](docs/features/navigation/)
- Website: [ding-ding-projects.github.io/material-download-manager](https://ding-ding-projects.github.io/material-download-manager/)
- Export feature docs: docs/features/export/
- History feature docs: docs/features/history/
- Accessibility feature docs: docs/features/accessibility/
- Notification feature docs: docs/features/notifications/
- Safety feature docs: docs/features/safety/
- Settings feature docs: docs/features/settings/
- Download engine docs: docs/features/download-engine/
- Browser handoff docs: [`docs/features/integrations/browser-extension.md`](docs/features/integrations/browser-extension.md)
- External editor handoff: [`docs/features/integrations/external-editor.md`](docs/features/integrations/external-editor.md)
  — desktop NotificationCenter, RegexBuilder, AuthenticatorPanel, History, and
  Changelog exports can also open the last successful file in Visual Studio
  Code; browser extension and GitHub Pages exports retain local-download-only
  behavior.
- Progress-window docs: [`docs/features/download-engine/progress-window.md`](docs/features/download-engine/progress-window.md)
- Auto-organize docs: [`docs/features/download-engine/auto-organize-downloads.md`](docs/features/download-engine/auto-organize-downloads.md)
- Distributed SSH worker docs: [`docs/features/download-engine/distributed-ssh-workers.md`](docs/features/download-engine/distributed-ssh-workers.md)
- In-app documentation docs: [`docs/features/documentation/in-app-documentation-browser.md`](docs/features/documentation/in-app-documentation-browser.md)
- Protected display-name history: [`docs/features/history/display-name-mutation-history.md`](docs/features/history/display-name-mutation-history.md)
- Local TOTP/authenticator registration: [`docs/features/security/totp-authenticator-core.md`](docs/features/security/totp-authenticator-core.md)

<details>
<summary>Auto-organize screenshot gallery</summary>

These captures were freshly reproduced from the real built Electron renderer
on a disposable cheap hidden desktop. The displayed base path was deliberately
set to the generic `C:\Downloads` before capture. Source commit
`84da5e1f2b10b6d88e9b946fe1523ad0295ddb2b` was rebuilt with `npm run build`,
and the verified 2026-08-11 capture run passed all 43 required
built-application checks in 13.094 seconds. Its renderer emitted
`index-D6pDySqX.js` (SHA-256
`5E55A622C73485693527C1BFE35981FDD9BDFBBD940A36DDC79D9CE98C1D7C27`)
and `index-DCh-PbGs.css` (SHA-256
`CCA54DDFA9227A90F08E686322973C5358042EE0F7A71B840E8165C85F8AE697`).
Six gallery frames are 1100 × 900 and the narrow frame is 520 × 760; every
image decodes as a 24-bit PNG with a unique SHA-256 hash. The fresh capture
bytes match the seven tracked files exactly, proving that the documented
surfaces remain current without manufacturing binary churn. The disposable
process tree, profile, fixture server, folder window, and hidden desktop were
removed after the run.

### Six future category paths

![Downloads settings showing the enabled auto-organize switch and six category paths](docs/screenshots/auto-organize/01-six-category-paths.png)

### Ordered custom-rule editor

![Two custom regex classification rules with destination selectors and move controls](docs/screenshots/auto-organize/02-ordered-rule-editor.png)

### Anchored regex-only builder

![The rule card's anchored JavaScript regular-expression builder](docs/screenshots/auto-organize/03-anchored-regex-builder.png)

### Inline validation and blocked Save

![A blank custom rule showing its inline error and disabled Save action](docs/screenshots/auto-organize/04-inline-invalid-rule.png)

### Narrow 520 CSS-pixel anchored builder

![The anchored rule regex builder reflowed without horizontal clipping at a 520 CSS-pixel viewport](docs/screenshots/auto-organize/05-narrow-rule-layout.png)

### Bilingual mode

![Auto-organize settings rendered in compact English and Cantonese bilingual mode](docs/screenshots/auto-organize/06-bilingual-category-settings.png)

### Exact command-palette destination

![Command palette result that opens and focuses the auto-organize folder switch](docs/screenshots/auto-organize/07-command-palette-destination.png)

</details>

<details>
<summary>Protected History surface</summary>

The real built desktop capture below shows the first-run History protection
surface: password setup, the operating-system vault explanation, the local-data
folder reset route, and the disabled export action while the tab is locked.

![Locked History setup surface in the built desktop application](docs/screenshots/history/protected-history-locked.png)

This 1150×720 PNG came from the hidden-desktop/CDP capture route at the source
commit documented in [`HANDOFF.md`](HANDOFF.md). SHA-256:
`53DBA85C6FED4704995D5D6D7893F3A51590A6A942E870FE6B074E6F9A5C2361`.

</details>

<details>
<summary>Protected History actions and retention</summary>

Commits [`512aa2c`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/512aa2cfa50ecf06ebe3e47985b0b3c8da31fa73) and
[`8ae3974`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8ae397469594585d5d1e062d0a575d8de352551a)
extends the unlocked History surface with redacted revision diffs, bounded
user labels, append-only restore, and retention pruning. Labels live in a
validated sidecar record; restore rebuilds only public dormant item and queue
fields, drops vault-backed source maps and unknown fields, preserves the live
School-mode credential state, and rolls back the live state if persistence or
the audit commit fails. Diff output masks credential-like keys, URL userinfo,
and full local paths, including paths with spaces. Pruning records tombstones
and keeps label, prune, and display-name audit revisions visible instead of
rewriting Git history. The main/preload boundary validates every request and
result, while the panel uses non-blocking action notifications and reserves
the two-key blocking confirmation for destructive pruning.

![Built History surface with revision actions and retention control](docs/screenshots/history/history-manager-actions.png)

![Built History surface with a redacted revision diff open](docs/screenshots/history/history-manager-actions-diff.png)

These 1150×720 PNGs came from the real built desktop through the Cheap
hidden-desktop route. The actions capture is 78,947 bytes, SHA-256
`845E8EA17410AF2C4CE95CF3531C03CCB100664C768297746F460CE02BC75115`; the diff
capture is 84,295 bytes, SHA-256
`2F7C4290D2809095AC5D463F9DDF4D63C71FF3C3CCAD3A2F7C4CD5D1E6F28930`.
The diff view visibly replaces local paths with `[LOCAL_PATH_REDACTED]`; the
capture probe found no absolute path, username, or user-authored display name.
Local evidence is full Electron **132/132**, engine **102/102**, docs **2/2**,
typecheck/build green, and built UI smoke **45/45**.

</details>

<details>
<summary>Authenticator Settings registration surface</summary>

The bounded authenticator surface now includes a real Settings registration tab
with local QR rendering, an explicit one-time manual-secret reveal, pairing
confirmation before credential-vault storage, and a metadata-only list/export,
plus a restart-safe management list with vault-backed current/next codes, a
numeric countdown, and a copy action. This registration capture comes from the
built Electron renderer at source commit
`9c3274134e6aa4b2d1de6b9f234fdf680b72f16f` through the CDP smoke harness. It
shows the complete registration card with an empty secret field; no QR, manual
secret, URI, metadata record, or live code was photographed.

![Authenticator Settings registration card with local QR pairing controls and an empty secret field](docs/screenshots/authenticator/authenticator-settings-empty.png)

The 524×462 PNG has SHA-256
`92DCE765FF7B8D07854C15D34FAED2708EB5C29C827DA26879E02DEACFD4DDC`. The
same built smoke run verified the management row without recording its current
or next digits; live-code screenshots are intentionally not claimed because
those values are credential-bearing. Reorder/group/bulk management, per-tab
locks, and schedules remain outside this bounded slice.

</details>

<details>
<summary>School mode and dialog emoji settings</summary>

The shared presentation settings are owned by the main process and persisted
in the normal local application-data record. This real built-artifact capture
comes from source commit `ecf9bc65e6f78f08e109abfbed5aa897cbdbb86d`, rebuilt
with `npm run build` from the `design/` directory, and driven on a
named hidden desktop. The renderer assets were `index-9-ppiL__.js` (SHA-256
`AB1C07E2AF56D3A24E084D7EA04FAEBBAA11F6A114816B27B2D41A3149B0732B`) and
`index-CL9UO5Fq.css` (SHA-256
`23FF81988A28774B46E99E5FC38739905D813F8E7098D218325B9AC7974A0D45`). Both
captures are 1150 × 720 PNGs and were inspected after capture.

![Settings with the user-renamable School mode and Show emojis controls visible](docs/screenshots/settings/school-mode-off-emoji-control.png)

![Settings with School mode enabled and language, funny-level, and emoji controls removed](docs/screenshots/settings/school-mode-on-controls-suppressed.png)

The first capture SHA-256 is
`AAC74504311B2B795C8D8FD479750E938E6FB07C042E643DBAC606B60D9E94A8`; the
second is
`60A93B232437B6C9FDE4F38FB9CB6DBD6A554C1FF33204FFCC771EF03E206BED`.
School mode forces English and serious copy, preserves prior choices, removes
playful/dim-sum surfaces, and fails closed when reset credential metadata is
not locally verified. Emoji is decorative only and never enters accessible
names or exports.

</details>

<details>
<summary>School-mode reset credential</summary>

Commit [`3b76509c684a2fc5c795d92400e10cd803c511e3`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/3b76509c684a2fc5c795d92400e10cd803c511e3)
adds the real shared School-mode reset credential path. Enrollment, change,
reset, and turn-off verification run through trusted main-process IPC. The
operating-system credential vault stores only a salted scrypt verifier; the
password never enters settings state, local history, exports, logs, renderer
state, or screenshots. Metadata propagates live to both application windows,
and a deleted app-data profile removes an orphaned verifier before a new setup.
Follow-up hardening commit
[`40fc29123da0c8b83c13176ab4ba526a4d5dcbd8`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/40fc29123da0c8b83c13176ab4ba526a4d5dcbd8)
rejects every direct renderer disable attempt, rolls metadata back when its
settings write fails, and scrubs verifier validation buffers.

![Settings showing the configured School-mode credential and current-value turn-off prompt](docs/screenshots/settings/school-mode-credential-turnoff.png)

This 1150×720 capture came from the real built desktop surface through the
cheap hidden-desktop route. SHA-256:
`1BA68A701556A1957756722A022B6708B32F8D0CAB1C2E71065B5C1DB96F24C1`.

The local checks for this slice are `npm run docs:bundle:check`,
`npm run typecheck`, `npm run build`, `npm run test:docs` (**2/2**),
`npm run test:electron` (**104/104**), and `npm run test:engine`
(**100/100** after hardening). TOTP locks, schedules, narration, appearance editors, signing,
and CRX artifacts remain outside this slice.

</details>

<details>
<summary>Scheduled settings foundation (verified)</summary>

The integrated scheduled-settings slice adds versioned local schedule records
under **Settings → Downloads → Scheduled settings**. The editor uses native
date/time controls, an explicit weekday chooser, inclusive date/time
boundaries, selected IANA timezone rules (including daylight-saving changes),
cross-midnight windows, and deterministic priority resolution. Local, versioned
HTTPS API, loopback-development, and Home Assistant boolean metadata all cross
the main-process validation boundary; no access token can enter the renderer,
settings file, export, log, or history.

![Scheduled settings editor showing native dates/times, weekdays, timezone and priority controls](docs/screenshots/settings/scheduled-settings.png)

This 524 × 738 PNG was captured from the real built desktop renderer after
adding a schedule through `design/ui-tests/smoke.mjs
--scheduled-screenshot`; SHA-256 is
`471166F2C1DBBF3BDDD48603DBF5A4D573E60EDD9032B8E904D5727DF337E4C6`.
Source commit `8b6e5f9c71e72cc5f86d8f85460ea6970b1c20fc` was built and verified
locally, and GitHub Actions run `31493449594` published `v0.1.107` from that
exact commit. The release is unsigned and contains no CRX artifact.

</details>

<details>
<summary>Browser extension automatic capture and installation</summary>

The Manifest V3 extension requests Chrome's `downloads` permission and enables
automatic capture by default. When Chrome creates an eligible HTTP(S)
download, the service worker pauses that browser download and records that it
owns the pause. It first sends only a nonce to `GET /v2/challenge`; the app must
prove the app-prepared pairing with HMAC-SHA-256 before the extension sends any
download URL. The authenticated one-use POST is successful only after the app
proves the source with a credential-free ranged GET, durably persists and
starts the manager record, and returns an authenticated final `202`. Only then
does the extension cancel the original browser download and erase its cancelled
history row. An unpaired copy, rejection, overload, invalid proof, source-read
failure, client-disconnect rollback, timeout, offline app, or local processing
failure resumes and retains the exact download the extension paused. Manual
popup and context-menu handoffs remain available.

Automatic handoff sends the credential-free URL and, when one can be derived
safely, a basename from the URL path. It never forwards cookies,
authorization headers, referrers, browser request headers, or the absolute
browser download path. Query-bearing URLs that the app accepts persist only in
the operating-system credential vault, are redacted from ordinary state and
history, and are removed on terminal cleanup. The persisted **Automatically
send browser downloads to the local manager** option can turn this behavior off
without removing manual handoff actions.

The desktop app's **Install browser extension** action creates the paired
private copy in its stable application-data folder: the app-side capability is
kept in the operating-system credential vault and its match is written only to
that staged extension. The app automatically opens the exact folder. The
existing **Open extension folder** action remains available if the file manager
could not be opened or the folder needs to be shown again. Chrome still
requires **Developer mode → Load unpacked** for this off-store installation.

![Downloads Settings showing automatic browser-extension installation, the automatic folder-open status, and the manual fallback](docs/screenshots/browser-extension/settings-install-and-reveal.png)

This is a fresh built-artifact crop of the install-and-reveal card. The
temporary staging path uses a generic system temporary folder so no user name
is present in the published image. It came from the same landed 42/42 smoke
run as the gallery; the 524×233 PNG has SHA-256
`B465ABCB5A4B4BBB605B5289A27E75BF2DB473408481C1AE32EEB9997BE08785`.

Each stable extension ZIP receives the reserved release version in its staged
`manifest.json`. Packaging validates that the archive has its manifest and
manifest-referenced entry points at the archive root, requires the pairing
module to be empty, bounds its entry count and uncompressed size, rejects
embedded capabilities, CRX magic, private-key or certificate markers, and
nested signing material, and records the ZIP's size and SHA-256 for publication
verification. The release manifest requires `extensionArtifact.signed` to be
the explicit Boolean `false`; missing or null values are rejected. The generic
ZIP is versioned source/reference material until the app prepares a private
paired copy; loading it directly into a fresh profile reports an unpaired
state. The project does not publish a `.crx`: a genuine CRX3 is a signed
container, while this repository permanently prohibits signing keys and
signing operations. Renaming a ZIP would not make a valid CRX, and ordinary
off-store Chrome installations still require an unpacked extension unless an
administrator has configured an enterprise installation policy.

</details>

<details>
<summary>Build and test</summary>

The root entry points are the supported fresh-machine path. They install the
declared user-scoped toolchain and project packages, refresh the current
process `PATH`, build the real renderer and main process, and report exact
failures. Use `/s` (or `--silent`, `SILENT=1`, or `MDM_BUILD_SILENT=1`) for a
touchless run from any working directory:

```powershell
build.bat /s
build-installer.bat /s
```

`build-installer.bat` reuses the application build, invokes the supported
unsigned Squirrel.Windows helper and validator, and reports the source commit,
artifact paths, sizes, SHA-256 digests, and `NotSigned` status. It never tags,
publishes, uploads, signs, generates a CRX, or opens an installer. The complete
contract, bootstrap routes, failure behavior, and focused fixture check are in
[`docs/features/build/fresh-machine-build.md`](docs/features/build/fresh-machine-build.md).

From `design/`:

```powershell
npm install
npm run docs:bundle:check
npm run test:docs
npm run typecheck
npm run build
npm run build:electron
npm run test:engine
npm run test:electron
npm run test:ui
```

The Windows packaging command is `npm run dist:win`; the committed application
manifest still describes the application target. The stable release workflow
uses the dedicated unsigned packaging helper because code signing is
prohibited. The helper restores the source manifest byte-for-byte, and the
artifact validator requires an intentionally unsigned `Setup.exe`,
`RELEASES`, every full and delta `.nupkg`, and matching package references.

Local checks run before a change is pushed. GitHub Actions deliberately runs no
tests, lint, type checking, static analysis, coverage, accessibility checks, or
screenshots. The accepted tradeoff is that automated publication does not
protect users from a commit whose local checks were skipped or failed; the
repository therefore records the real local result in the task handoff and
release notes.

The `stable Windows release` workflow builds the application, reserves a
monotonic unique version and public dim-sum code name, then creates one stable,
non-draft release with `isPrerelease=false`, release timing, the line-count table,
the validated Squirrel assets, and a version-stamped validated Chromium
extension ZIP. It has no signing credentials or alternate distribution path.
The historical unsigned test release
[`v0.1.0`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.0)
is retained as prior evidence only. The latest implementation verification
release is [`v0.1.33`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.33),
published from `0050941cd34005b29ab4f31368101c3a9c5de4a6` with `Setup.exe`,
`RELEASES`, and the full Squirrel package. The published record is stable,
non-draft, non-prerelease, and unsigned. The latest-release link above is
deliberately dynamic because every successful push creates a new monotonic
stable record.

The active workflows use the pinned GitHub-hosted Windows image documented in
[`CI.md`](CI.md). The release job bootstraps its declared application and
packaging dependencies; the Pages job builds the dependency-free site and
publishes only verified release metadata. Safe evidence collection runs even
after an earlier build or publication failure without changing that failure's
result.

The updater has a stable default feed at
`https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest/download/`;
`MDM_UPDATE_FEED_URL` remains an optional main-process override. The historical
unsigned `v0.1.0` test release is excluded from the stable feed. A new stable
feed result was verified by the historical self-hosted release run that
published `v0.1.18`; later successful runs advance the same feed without
recycling a tag.

Before the native Squirrel updater downloads or reports a ready update, the
main process validates the bounded HTTPS `RELEASES` index, selects exactly one
matching full package, and carries its Squirrel SHA-1/size metadata plus the
index SHA-256 through the validated IPC state. The ready banner repeats the
localized unsigned-artifact warning: no code signature is present and the
operating system may show an unknown-publisher or SmartScreen warning. These
digests provide package-integrity metadata only; they are not a signature or
authenticity claim.

The release workflow runs on every push and on manual dispatch. It builds,
packages, publishes, and verifies a unique release; it does not run tests or
lint. The Pages workflow builds and deploys the documentation site from `main`
and on manual dispatch.

</details>

<details>
<summary>Repository layout</summary>

`design/` contains the runnable Electron application: the real download engine,
main-process IPC, preload bridge, React renderer, persistence, and engine tests.

`prototype/` preserves the earlier Material Design prototype, its custom
template runtime, screenshots, and reference assets. It is intentionally
separate from the production build so the prototype cannot be mistaken for the
network-backed application or silently replace it.

</details>

<details>
<summary>Current scope and next work</summary>

The handoff reconciles the two previously conflicting trees without discarding
either one. The Electron app now has a real add/probe/segmented-download,
pause/resume, persistence, queue, schedule-clock, header, timeout, settings,
notification, accessibility, safety, search, navigation, export, a browsable
local-history tab, loopback browser handoff, and a separate progress window.
The Settings dialog now has four persisted browser-style tabs with independent
search builders. Its Downloads tab requires an absolute Windows default folder,
previews six category paths, and manages an accessible first-match rule list
without moving existing files or overriding an explicitly selected folder.
Turning folder routing off keeps future default-folder downloads flat while the
rules continue to classify sidebar items. Every user-authored regular
expression—including Add download category preview and final routing—runs
through bounded IPC in a terminable main-process worker; timeouts fail safely
instead of blocking the renderer or Electron event loop. Settings schema v3
validates exact bounded rule records and preserves truthful per-key provenance.
The Chromium extension sends validated page or link URLs through a protocol-2
loopback pairing and automatically catches eligible browser downloads by
default. It pauses before handoff, requires the app to prove its capability
before any download URL is sent, and cancels/erases the browser copy only after
an authenticated final durable acceptance. Every unpaired, rejected, offline,
overloaded, invalid, source-unreadable, disconnected, or timed-out route resumes
and retains its own paused browser item. The automatic payload is limited to a
credential-free URL plus an optional URL-derived safe basename. Protected
query URLs persist only in the operating-system credential vault and are
removed on terminal cleanup. The desktop app prepares a paired extension,
automatically opens the exact staged folder, and retains a manual reveal
action. The generic release ZIP contains no pairing capability and remains a
validated versioned source/reference artifact. A live accepted handoff joins
the same queue the progress window displays. The prototype is never presented
as the download path. The app also
ships an offline Documentation tab that bundles every
categorized feature article, renders Markdown safely, keeps relative article
links inside the app, and provides its own anchored regex search. Remaining
release and product gaps are explicit in [`HANDOFF.md`](HANDOFF.md). The
published site is the live documentation and installer entry point; its runtime
manifest is injected from the latest verified stable release by the Pages
workflow. The v0.1.18 deployment was checked through the live
renderer, including its About publication state and installer link.

</details>

## Shared guidance

[`AGENTS.md`](AGENTS.md) is a sanitized mirror of the shared agent and
contributor guidance. Edit the canonical instructions source rather than this
mirror when changing that policy.
