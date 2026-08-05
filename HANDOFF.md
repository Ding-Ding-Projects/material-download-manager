<<<<<<< HEAD
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

## Production application

The application under `design/` includes:

- Electron main-process window and IPC setup.
- A typed preload bridge and shared IPC types.
- Real segmented HTTP downloads with Range requests, retry, pause/resume, and
  byte-integrity tests.
- Persistence, categories, queues, speed limiting, add-download probing, and
  React dialogs for the core download loop.

The prototype under `prototype/` is not loaded by the Electron build. Its
simulated network layer remains reference-only.

## Verification evidence

Run from `design/`:

```powershell
npm install
npm run typecheck
npm run build
npm run build:electron
npm run test:engine
```

On 2026-08-05, the following checks passed on
`codex/handoff-reconcile`:

| Check | Result |
| --- | --- |
| `npm ci` | Installed 396 packages from the lockfile; npm reported 11 audit findings and install-script approval warnings. |
| `npm run typecheck` | Passed renderer and Electron TypeScript checks. |
| `npm run build` | Passed Vite renderer and Electron main-process compilation. |
| `npm run test:engine` | 8/8 passed, including Range integrity, pause/resume, non-resumable fallback, filename sanitization, malformed Range rejection, categories, and throttling. |
| `npm run test:electron` | 2/2 passed for compiled renderer-path and launch-mode resolution. |
| Hidden-desktop smoke | Passed: direct Electron `v31.7.7` launch opened `Material Download Manager` at 1150×720 and rendered the empty state; the process and headless desktop were then cleaned up. |
| Remote GitHub Actions | Blocked: `gh workflow run "Windows verification" --ref main` returned HTTP 422, `Actions has been disabled for this user`; no remote run exists to verify. |

The hardening milestone also corrected the compiled renderer path and made
unpackaged production launches load the built renderer unless
`NODE_ENV=development` is explicit. Server- or user-supplied filenames are
constrained to one safe Windows path segment, and ranged responses must agree
with their `Content-Range` before bytes are written.

A Windows packaging run (`npm run dist:win`) is still required before publishing
an installer; a compile-only success is not packaging evidence.

The repository now has a Windows push/dispatch workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the checks above. It
does not claim installer, updater, or release verification. Remote execution
still needs GitHub Actions to be enabled for the authenticated user.

## Known follow-up work

These items remain open and are deliberately not hidden by the directory
reconciliation:

1. Validate the Windows installer and update artifacts on the supported build
   path.
2. Finish clock-based queue scheduling; the current queue UI and data model are
   present, but schedule execution needs a real trigger loop.
3. Compare the runnable renderer with the prototype and decide which Material 3
   visual and interaction changes should be implemented next.
4. Add the remaining product features only after their scope and production
   behavior are defined; do not wire the prototype's simulated engine into the
   app.
5. Pass custom request headers through the real transfer path, enforce the
   global active-download limit across queues, and add redirect/idle timeout
   policy before relying on authenticated or long-lived downloads.
6. Add renderer, IPC, packaging, accessibility, error-notification, and
   destructive-action coverage before calling the application release-ready.

## Git state and ownership

The reconciliation is being developed on `codex/handoff-reconcile` so each
milestone can be reviewed and pushed before it is integrated into `main`.
There are no open GitHub issues at the time this handoff was refreshed. GitHub
Discussions are disabled for this repository, so progress must remain in Git
history and the handoff until that external setting changes.
=======
# Handoff: Material Download Manager (Electron port)

Written by the previous agent for whoever picks this up next. Read this whole
file before touching code — the repo is in a **split-brain state** between two
branches and the first job is reconciling that, not writing more UI.

## TL;DR

- **Goal**: port `vendor/ab-download-manager` (a Kotlin/Compose desktop download
  manager, git submodule) into a **working Windows Electron app**, "100%"
  functional, pushed/merged to `main` incrementally.
- I (previous agent) built a **complete, tested, working** Electron+React+TS
  app with a **real** (non-simulated) segmented multi-connection download
  engine, on branch `claude/submodule-design-folder-port-iyvesh`. It's pushed.
  Verified end-to-end with a real download over HTTP Range requests,
  screenshotted via Playwright/CDP.
- **While I was working**, a different actor (git author `codingmachineedge
  <jackson.jc43@gmail.com>`, commit `99fd6e6`, "Auto commit 2026-08-05
  22:27:55.286Z") pushed **directly to `main`** — bypassing my branch — and it
  **deleted my entire Electron scaffold** (`design/electron/**`,
  `design/shared/**`, `design/src/**` React app, `package.json`, `tsconfig*`,
  `vite.config.ts`, `build/icon.ico`) and replaced `design/` with a large,
  separate **UI design prototype** (not a working app — see below).
- The user then said "refresh the repo, I updated design folder" and asked me
  to hand off rather than keep building. **I did not merge or reconcile the
  two branches** — that decision needs a human call first (see "Open
  questions" below), so I'm leaving both states intact and documented.

## Branch / commit map

- `main` @ `99fd6e6` — has the **new design prototype** (see next section),
  does **not** have any Electron/Node code, does **not** build or run.
- `claude/submodule-design-folder-port-iyvesh` @ latest pushed commit — has my
  **working Electron app** (engine + React UI), does **not** have the new
  design prototype files.
- These two states conflict on the same paths (`design/**`). There is no
  common merge base that has both — `main`'s commit literally deletes the
  files my branch adds, in the same paths. Expect real conflict resolution,
  not a clean `git merge`.

Check `git log --graph --oneline --all` and `git diff main..claude/submodule-design-folder-port-iyvesh -- design` to see the full extent before deciding anything.

## What's on `main` right now (the new design prototype)

`design/` on `main` contains a **Material Design 3 UI prototype**, not
runnable Electron/Node code:

- `design/AB Download Manager M3.dc.html` (3449 lines) — the actual prototype,
  written in a **declarative templating DSL** (custom tags `<x-dc>`,
  `<sc-for>`, `<sc-if>`, `{{ expr }}` bindings, `data-ak` attrs). It is loaded
  by `design/support.js` (1911 lines) which is that DSL's **runtime/renderer**
  — i.e. this file cannot be opened as plain HTML/JS in a browser or
  `BrowserWindow.loadFile()` and "just work"; it depends on whatever engine
  `support.js` implements to interpret the template bindings. Skim both
  before assuming how to integrate it.
- `design/js/engine.js` — explicitly a **simulated** download engine (first
  comment line: *"ABDM-M3 simulated download system... No real network."*).
  It fakes HEAD requests, progress, speed, errors etc. deterministically from
  a URL hash, purely to drive the mockup's UI states. **This is not something
  to ship** — it's a stand-in the design prototype uses so it can be
  clicked through without a backend.
- `design/js/color.js`, `design/js/i18n.js` — Material color utilities and a
  bilingual (EN / Cantonese) localization helper.
- `design/docs/feature-map.md` — an extremely detailed feature spec, reverse
  engineered from the Kotlin source **plus** a pile of extra scope from a
  file called `agent-global-memory/memory/SHARED_INSTRUCTIONS.md` that **does
  not exist anywhere in this container or repo** (I searched). That extra
  scope includes things like: a browser-style tab strip for multiple windows,
  a regex-builder anchored on every search box, an "infinite" color
  picker/editor on every element, local version history panels, TTS
  narration, two independent "funny level" sliders for bilingual copy, and a
  **non-optable 10%-per-launch "dim-sum surprise"** easter egg (there's a
  `design/assets/dimsum/*.png` folder of food photos backing this).
  **This scope very likely came from a different session/user's global
  config bleeding in, or was never meant for this repo.** Do not assume all
  of `feature-map.md` is in scope — confirm with the user first (see below).
- `design/data/CHANGELOG.md`, `design/data/en_US.properties` — copied
  verbatim from the submodule, for reference/localization strings.
- `design/assets/`, `design/screenshots/`, `design/uploads/` — logo, iteration
  screenshots of the prototype (`01-*`../`04-*` = revision numbers, each named
  after the feature it demos: add-buttons, ctx-fixed, dd-and-clip,
  dialog-drag, md3-controls, regex-bars, regex-menu), and pasted reference
  images. Mostly reference material, not code.
- `design/ABDM Material.dc.html` — only 13 lines, looks like a stub/leftover,
  probably ignorable.
- No `package.json`, no `electron/`, no build tooling of any kind on `main`.

## What's on `claude/submodule-design-folder-port-iyvesh` (my work)

A complete, from-scratch Electron + React + TypeScript app, **already
verified working end-to-end**, structured as:

```
design/
  package.json            # electron-builder config targets Windows (nsis+portable)
  tsconfig.json            # renderer (vite/react) typecheck config
  vite.config.ts
  index.html
  build/icon.ico            # generated placeholder app icon
  shared/types.ts          # types + IPC channel names shared by main <-> renderer
  electron/
    main.ts                 # BrowserWindow (frameless), IPC handlers, single-instance
                             # lock, startup-on-login, download-complete notifications
    preload.ts               # contextBridge -> window.api (typed surface, see below)
    download/
      DownloadManager.ts     # orchestrator: items/queues/settings, persistence, IPC-facing API
      DownloadTask.ts         # REAL segmented multi-connection HTTP downloader:
                               # splits by size into N ranged parts, positional
                               # writes into one file, pause/resume via saved part
                               # state, retries, speed sampling
      HttpProbe.ts             # HEAD-based probe: size / Accept-Ranges / filename
      SpeedLimiter.ts           # token-bucket rate limiter (global + could be per-item)
      categories.ts              # extension -> category mapping
      persistence.ts              # JSON state store (userData/state.json)
      __tests__/
        testServer.ts              # local HTTP server w/ Range support, for tests
        downloadTask.test.ts        # 6 tests, all passing (see below)
  src/                        # React renderer, styled to match the ORIGINAL
                               # ab-download-manager screenshots (not the new M3 prototype)
    App.tsx, main.tsx, global.d.ts, vite-env.d.ts
    store/useAppStore.ts       # zustand store wrapping window.api + local UI state
    hooks/useFilteredItems.ts
    utils/format.ts, category.ts
    styles/theme.css, global.css
    components/ TitleBar, Sidebar, Toolbar, StatusBar, DownloadTable,
                 ContextMenu, Dialog, AddDownloadDialog, DownloadDetailsDialog,
                 SettingsDialog, QueuesDialog, icons.tsx
```

### Verified facts (don't re-derive these, just confirm still true after any changes)

- `npx tsc -p tsconfig.json --noEmit` and `npx tsc -p electron/tsconfig.json --noEmit`
  both pass with zero errors (run from `design/`).
- `npm run build` (vite build + tsc) succeeds; output lands in `dist/` and
  `dist-electron/electron/main.js` (matches `package.json`'s `"main"`).
- `node --test dist-electron/electron/download/__tests__/*.test.js` — **6/6
  pass**: HTTP probing, multi-connection segmented download byte-for-byte
  integrity, pause-then-resume byte-for-byte integrity, non-resumable
  single-connection fallback, category detection, speed-limiter throttling.
  (`npm run test:engine` runs this after a build.)
- I booted the actual Electron app under `xvfb-run ... --no-sandbox
  --remote-debugging-port=9222`, connected Playwright (`chromium.connectOverCDP`)
  from the globally-installed `playwright` package at
  `/opt/node22/lib/node_modules/playwright` (there's no local playwright dep;
  reuse the global one, don't `npm install playwright`), and confirmed
  visually + on-disk:
  - The app UI loads and matches the original app's dark-theme screenshots in
    `vendor/ab-download-manager/assets/screenshots/`.
  - Add Download dialog correctly probes a real local test HTTP server (URL →
    detected size/filename/category icon/resume-support checkmark).
  - Starting the download actually transfers real bytes over 3 concurrent
    Range-request connections and the file on disk is byte-identical
    (`sha256sum` matched) to the source.
  - The download list, status bar counts, context menu (Open File/Open
    Folder/Copy Link/Details/Remove), and the Details dialog's per-part
    progress table all reflect the real, live state.
  - Settings dialog opens and matches all `AppSettings` fields.

### Known rough edges (not blockers, just not polished)

- Light theme exists via CSS vars but wasn't visually tuned as carefully as
  dark (dark was the primary screenshot target).
- Queue scheduling (`scheduleEnabled`/`startAt`/`endAt` on `DownloadQueue`)
  has types and basic queue create/start/stop wired, but no actual clock-based
  auto-start/stop trigger loop was implemented — `QueuesDialog.tsx` is
  "minimal" per the UI agent's own summary.
- `electron-builder` Windows packaging (`npm run dist:win`) was **never
  actually run** in this container (no Windows target build tooling / wine
  verified available in-sandbox) — only `build:renderer` + `build:electron`
  (the compile step) were verified, not the final NSIS/portable packaging.
  That's real remaining risk: confirm `dist:win` actually produces a working
  installer, ideally on a real Windows runner or at least dry-run
  electron-builder's config validation.
- No app icon design — `build/icon.ico` is a placeholder gradient circle I
  generated programmatically (see git history for the generator script if you
  want to swap it for `vendor/ab-download-manager/assets/logo/app_logo_with_background.svg`
  or the new `design/assets/app_logo.svg` from the prototype branch).
- Per-download speed limits, per-host settings, browser extension
  integration, batch/wildcard download, checksum window, tray icon, and most
  of the "Tools" menu are **not implemented** — I scoped to the core
  add/download/pause/resume/cancel/categories/queues/settings loop that's
  visible in the reference screenshots, not the full feature-map.

## The core problem to solve

Two genuinely different things both call themselves "the design for this
app" and neither alone is the finish line:

1. My branch has a **real, working, tested backend** (main process + download
   engine + IPC contract) and a React UI that matches the **original**
   AB Download Manager's actual screenshots reasonably closely — but it does
   not implement the new M3 redesign's expanded interaction language.
2. `main` has a **much more elaborate visual/interaction design** (Material
   Design 3, extra features) but it is a **click-through prototype with a
   fake network layer**, built in a templating DSL that isn't production
   Electron/React code as-is, and (per feature-map.md's own notes) partially
   scoped from instructions that don't seem to belong to this repo.

Neither side is simply "more correct" — reconciling them requires a product
decision, not just an engineering merge.

## Recommended path forward (pick one, don't guess)

**Before writing more code, use `AskUserQuestion` (or just ask in chat) to
confirm which of these the user actually wants**, because they materially
change the amount of work:

1. **Keep my working app as the baseline, restyle it toward the M3 look.**
   Take the M3 prototype's *visual language* (colors, typography, MD3
   controls, screenshots in `design/screenshots/`) as a style reference and
   reskin my already-working React components (`design/src/**`) to match,
   without chasing every feature in `feature-map.md`. This is the
   lowest-risk path to something that's actually "100% working" soon, since
   the hard part (real download engine, real IPC, real persistence) is done
   and tested.
2. **Rebuild the renderer around the M3 prototype**, reimplementing its
   `.dc.html`/`support.js` DSL content as real React (or plain HTML/TS)
   markup + CSS, wiring `js/engine.js`'s *simulated* logic points over to the
   **real** `window.api` calls from my `preload.ts` (the IPC contract in
   `shared/types.ts` is a reasonable target to keep — it's tested and
   reflects the same domain model `feature-map.md` describes: items,
   statuses, parts, queues, categories). This is significantly more work and
   pulls in a large amount of scope from `feature-map.md` that may not be
   wanted.
3. **Scope-check `feature-map.md` explicitly with the user first** — ask
   specifically about the parts that look like scope creep from an unrelated
   config (tab-strip window manager, regex builder on every search box,
   infinite per-element color editor, TTS narrator, dim-sum easter egg) before
   building any of it. Cut what isn't actually wanted, then decide between
   options 1 and 2 for what remains.

Whichever is chosen, **the IPC contract and download engine I built
(`shared/types.ts`, `electron/preload.ts`, `electron/download/**`) should be
preserved and reused** — it's real, tested, working code, independent of
which UI sits on top of it. Don't rewrite the download engine from scratch to
chase the prototype; wire the prototype's UI to it instead.

## How to verify your work (do this before pushing)

From `design/`:

```bash
npm install                      # if node_modules isn't already there
npx tsc -p tsconfig.json --noEmit
npx tsc -p electron/tsconfig.json --noEmit
npm run build                    # vite build + tsc build
npm run build:electron && node --test dist-electron/electron/download/__tests__/*.test.js
```

To visually smoke-test the actual app in this sandboxed container (no real
display): use `xvfb-run -a npx electron . --no-sandbox
--remote-debugging-port=9222` (run in background), then drive it with
Playwright's `chromium.connectOverCDP('http://localhost:9222')` using the
**globally installed** `playwright` package at
`/opt/node22/lib/node_modules/playwright` (no local install needed/available
offline). Take `page.screenshot()`s and `Read` them to eyeball the result —
this is exactly how I confirmed the current app works.

For a real end-to-end download test, spin up a tiny local HTTP server with
Range support (see `design/electron/download/__tests__/testServer.ts` for a
ready-made one, or copy the ad hoc one I used at test time) rather than
hitting the real internet from the sandbox.

## Git hygiene notes

- `git push -u origin claude/submodule-design-folder-port-iyvesh` is already
  set up and current as of this handoff.
- I deliberately **did not merge `main` into my branch or vice versa** — do
  that only after the product decision above is made, since it's a real
  conflict, not a fast-forward.
- Earlier in this session I *had* been merging my branch into `main` after
  each verified increment (per the user's original instruction to "merge to
  main as you go") — that stopped being safe the moment `main` diverged with
  conflicting content. Resume that pattern once reconciliation is resolved,
  but don't blindly `git merge` the two branches as they stand now — it will
  either clobber the working app or the new design, depending on direction.

## Open questions to raise with the user

1. Is the `codingmachineedge` commit on `main` actually theirs / wanted, or
   did it land in the wrong repo? (The `feature-map.md` references config
   files that don't exist in this environment — worth a sanity check.)
2. Given the scope in `feature-map.md` is far beyond the original app (tab
   strip window manager, regex builder everywhere, infinite color editor,
   TTS, bilingual "funny sliders", non-optable dim-sum easter egg) — is all
   of that actually wanted, or should it be trimmed to something closer to
   the original AB Download Manager's real feature set plus an MD3 reskin?
3. OK to reuse the already-built, tested download engine and IPC layer
   (option 1/2 above), or does the user want the engine rebuilt too for some
   reason?
>>>>>>> origin/claude/submodule-design-folder-port-iyvesh
