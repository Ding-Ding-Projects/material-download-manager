# Handoff: Material Download Manager

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
packaging. Lane E makes the current automation contract explicit: all jobs use
the labelled self-hosted Windows runner documented in [`CI.md`](CI.md), the
dependency inventory is committed, and fresh bootstrap is checked before and
after `npm ci`.

Code signing is prohibited. The stable release workflow clears inherited
signing inputs, temporarily disables `forceCodeSigning` only in the runner copy
of `design/package.json`, restores that file byte-for-byte, verifies
`Setup.exe` is `NotSigned`, and publishes a stable release only when the
published record reports `isPrerelease=false`, after tests and Squirrel
artifact checks pass. There is no alternate distribution path.

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
--test-timeout=30000` because its manager tests intentionally exercise
process-global Windows profile state and a blocked test must fail within a
bounded interval. Both current workflows use the self-hosted runner contract;
the current runner and its fresh bootstrap evidence are recorded below.
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
The current integration candidate is merge commit `ae0822c`; its final
default-branch release remains pending the remote integration run.

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

The prototype under `prototype/` is not loaded by the Electron build. Its
simulated network layer remains reference-only.

The current integration candidate also adds selected-text capture to the
browser extension context menu and an embedded in-app stable changelog viewer.
The viewer currently contains 28 published stable records, each with a full
source commit link, ISO date filtering, anchored regex search, filtered copy,
and Markdown export. The candidate is locally verified at merge commit
`ae0822c`; it is not yet default-branch or release proof until the remote run
publishes and verifies its real stable release.

## Verification evidence

Run from `design/`:

```powershell
npm ci
npm run typecheck
npm run build
npm run test:engine
npm run test:electron
npm run test:ui
# from extension/: npm test
# from site/: npm run check && npm run build
```

On the current verification tree, the following checks passed locally:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed renderer and Electron TypeScript checks. |
| `npm run build` | Passed Vite renderer and Electron main-process compilation. |
| `npm run test:engine` | 31/31 passed locally, including concurrent and cross-instance StateStore saves, failed-write recovery, Range integrity, pause/resume, non-resumable fallback, custom-header persistence and cross-origin header stripping, global queue limits, schedule race handling, manager history hooks, filename sanitization, malformed Range rejection, categories, throttling, and URL redaction. |
| `npm run test:electron` | 43/43 passed for export, local history, hook/index isolation, renderer-boundary history filter normalization, renderer settings validation, regex, tabs, command-palette foundations, compiled renderer-path resolution, secure updater IPC, version monotonicity, timeout/stale-event recovery, native Squirrel download-overlap protection, queue payload validation, Settings Escape handling, completion-notification preference handling, loopback handoff success/failure responses, slow-pending handoff acknowledgement, and the embedded changelog store/IPC path. |
| `npm run test:ui` | 22/22 required checks passed through the built Electron/CDP smoke harness: renderer freshness, real preload bridge, tab shell, History tab controls and honest empty state, a seeded separate progress window with a named progressbar, four Settings tabs, independent search, anchored regex builder, Escape focus restoration, interactive-label structure, narrow layout at 520 CSS pixels and 2× scale, and cleanup. |
| Chromium extension `npm test` | 12/12 passed for MV3 permissions and entrypoints, page/link/selected-text context-menu handoff, bounded link-target precedence, loopback protocol, bounded validation, settings import/export, regex safety, localization, and no remote assets/tracking. |
| GitHub Pages source `npm run check` | 41/41 checks passed, including feature-article coverage, local-only assets, stable-manifest fail-closed behavior, publication-state rendering, prototype sanitization, and the browser-extension/progress-window articles. |
| Hidden-desktop progress capture | Passed through the cheap Lowlevel headless route: a real loopback handoff created a live download, and a dynamically resolved second `Chrome_WidgetWin_1` window rendered the separate 980×640 `Download progress` surface with the fixture filename, source URL, transferred bytes, speed, pause, cancel, and close controls. The capture was retained in the session scratchpad, outside the repository. The disposable desktop, Electron process, and fixture server were cleaned up. |
| Remote GitHub Actions | Default-branch stable release [31178625430](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31178625430), Windows verification [31178625434](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31178625434), and Pages run [31178625512](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31178625512) are green for `d37ad7c`; branch stable release [31178607000](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31178607000) and Windows verification [31178606993](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31178606993) are also green. The `ae0822c` integration run is still pending. |

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

The repository has a Windows push/dispatch workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for validation and a
separate [stable Windows release workflow](.github/workflows/release.yml). Both
use the explicit self-hosted label contract and the committed dependency
inventory. The release workflow validates tests and Squirrel assets, publishes
one stable non-draft, non-prerelease release, records unsigned status, and
verifies release timing and asset identity after publication. A self-hosted
Pages workflow is now present at
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). It validates and
stages the local site before deployment, asks `actions/configure-pages@v5` to
enable Pages when needed, and now has live verification at
https://ding-ding-projects.github.io/material-download-manager/. The site
injects the latest verified stable manifest only after the release asset
inventory is checked. The `v0.1.19` deployment additionally refreshed the
manifest after the stable release was published and verified the rendered
publication state through the live site.

The release branch also passed local static checks for the workflow and helper
contracts: `actionlint -shellcheck=` passed, all 8 PowerShell run blocks parsed,
the line-count table validated, the dim-sum metadata resolved to
`Classic Har Gow · 蝦餃`, and `electron-builder --version` resolved to
`24.13.3`. The current workflow contract also passes local static inspection;
the matching repository runner is registered and the current self-hosted
release and Pages runs are verified above.

## Known follow-up work

These items remain open and are deliberately not hidden by the directory
reconciliation:

1. Compare the runnable renderer with the prototype and decide which Material 3
   visual and interaction changes should be implemented next.
2. Complete the remaining shared-memory product surfaces—full per-element
   appearance editing, complete tab/group management, renderer history,
   advanced changelog date/filter flows, complete bulk actions, scheduled
   external settings, and the in-app documentation browser—without wiring the prototype's simulated
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

This reconciliation and the CI hardening are on `main`; the current main tip
is the source of truth for the verified stable release. The hardening slice is
integrated on `main`. The agent-owned integrated linked checkouts were clean,
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

The main checkout and the user-owned linked checkouts remain registered with
Git. The release-helper checkout holds untracked `scripts/`, and the
release-workflow checkout holds an untracked `.github/workflows/release.yml`;
both are preserved because they contain uncommitted work. Any remaining stash
or linked-checkout state is preserved until its exact ownership and clean,
merged, pushed proof is available.
