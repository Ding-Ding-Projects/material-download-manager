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

The runnable application is now integrated on `main` at `ad6f44c`. The
original handoff branch remains available as
`origin/claude/submodule-design-folder-port-iyvesh`; it was preserved rather
than rewritten.

The release handoff is staged on
`codex/release-pipeline-20260806` at `d794d24`. It adds the stable updater feed,
the reproducible line-count and dim-sum metadata helpers, and the signed
Windows release workflow. The branch is pushed to the repository, but this
handoff does not call the release published: the protected signing certificate
and password have not been configured, so the workflow cannot produce a
verified installer yet.

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

The prototype under `prototype/` is not loaded by the Electron build. Its
simulated network layer remains reference-only.

## Verification evidence

Run from `design/`:

```powershell
npm ci
npm run typecheck
npm run build
npm run test:engine
npm run test:electron
```

On the final integrated tree (`main` at `ad6f44c`), the following checks
passed:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed renderer and Electron TypeScript checks. |
| `npm run build` | Passed Vite renderer and Electron main-process compilation. |
| `npm run test:engine` | 29/29 passed, including Range integrity, pause/resume, non-resumable fallback, custom-header persistence and cross-origin header stripping, global queue limits, schedule race handling, manager history hooks, filename sanitization, malformed Range rejection, categories, throttling, and URL redaction. |
| `npm run test:electron` | 31/31 passed for export, local history, regex, tabs, command-palette foundations, compiled renderer-path resolution, secure updater IPC, version monotonicity, timeout/stale-event recovery, native Squirrel download-overlap protection, queue payload validation, Settings Escape handling, and completion-notification preference handling. |
| Hidden-desktop smoke | Passed through the cheap hidden-desktop route: direct Electron `v31.7.7` launch opened `Material Download Manager` at 1150×720, rendered the empty state and update state, opened Settings, filtered Settings with its anchored regex builder, and returned focus after Escape. The hidden desktop and process were cleaned up. |
| Remote GitHub Actions | Passed for `ad6f44c`: [Windows verification run 31072760389](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31072760389). |

The hardening milestone corrected the compiled renderer path and made
unpackaged production launches load the built renderer unless
`NODE_ENV=development` is explicit. Server- or user-supplied filenames are
constrained to one safe Windows path segment, and ranged responses must agree
with their `Content-Range` before bytes are written.

A signed Windows packaging run (`npm run dist:win`) is still required before
publishing an installer; a compile-only success is not packaging evidence. The
package configuration now targets Squirrel.Windows x64 with signing enforced,
and the main process has a bounded, fail-closed updater coordinator. The
renderer now receives validated updater state through the secure preload bridge
and shows explicit manual-check, `Later`, release-notes, and
`Restart to install update` actions guarded by a fresh unsaved-work assertion.
This branch does not claim a signed installer, a published `RELEASES` feed, or
a verified update. The updater now has the stable default feed URL described
above, while `MDM_UPDATE_FEED_URL` remains an optional override.
The unsigned local shape attempt produced no artifacts on this host and is not
release evidence.

The repository has a Windows push/dispatch workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the checks above and
a separate [Windows release workflow](.github/workflows/release.yml). The
release workflow is fail-closed on missing signing inputs, validates the
Squirrel artifacts, and publishes only after the signed build succeeds. It has
not published a release yet because those protected inputs are absent.

The release branch also passed local static checks for the workflow and helper
contracts: `actionlint -shellcheck=` passed, all 8 PowerShell run blocks parsed,
the line-count table validated, the dim-sum metadata resolved to
`Classic Har Gow · 蝦餃`, and `electron-builder --version` resolved to
`24.13.3`. These checks do not substitute for the missing signed packaging
run.

## Known follow-up work

These items remain open and are deliberately not hidden by the directory
reconciliation:

1. Configure the protected signing certificate and password, then validate the
   Windows Squirrel installer and update artifacts on the supported build path,
   including signing and the `RELEASES` feed. No release is published until
   that workflow run is green and its immutable assets are verified.
2. Compare the runnable renderer with the prototype and decide which Material 3
   visual and interaction changes should be implemented next.
3. Add the remaining product features only after their scope and production
   behavior are defined; do not wire the prototype's simulated engine into the
   app.
4. Add renderer, IPC, packaging, accessibility, error-notification, and
   destructive-action coverage before calling the application release-ready.
5. The reusable local regex engine and builder foundation now live under
   `design/shared/regex.ts` and `design/src/components/RegexBuilder.tsx`; wire a
   separate anchored instance to every search surface before claiming the
   search requirement complete.
6. The reusable tab state model, tab strip, and `Ctrl+Shift+F` command palette
   now live under `design/shared/tabModel.ts` and `design/src/components/`;
   connect them to persisted app state and the real shell before calling the
   navigation requirements complete.
7. The shared export serializer covers the required coding formats under
   design/shared/export.ts; connect it to filtered records, history, settings,
   and changelog surfaces with visible warning and format controls.
8. The isolated Git-backed HistoryStore is now wired to manager state changes,
   including download creation/completion/error/pause/resume/retry/cancel,
   deletion, queue changes, and settings changes. Connect its browse/restore
   controls to the renderer and extend coverage to every user-managed record
   before calling local history complete.
9. The renderer lane now supplies centralized accessibility semantics,
   non-blocking notification history, and the native destructive-action gate.
   Its current evidence is typecheck/build, 31 Electron tests, and a cheap
   headless Settings/Escape/focus smoke; a renderer DOM harness, notification
   bulk actions, deletion history recording, and full-copy localization remain
   open.
10. The settings lane now supplies versioned language, funny-level, appearance,
    provenance state, a local Settings search, and an anchored regex builder
    with persistence tests. The surface still needs browser-style settings tabs,
    full appearance-editor depth, and copy wiring across every renderer message.
11. Keep the landing page, changelog viewer, release line counter, and
    sanitized instruction mirror current as the product surfaces are
    implemented.

## Git state and ownership

This reconciliation is on `main` at `ad6f44c`, which matches
`origin/main`. The original handoff history is preserved as an ancestor, and
the original handoff branch remains untouched. There are no open GitHub issues
in either scanned repository at the time this handoff was refreshed. GitHub
Discussions are enabled and the rolling handoff thread is
[`#3`](https://github.com/Ding-Ding-Projects/material-download-manager/discussions/3).
The wiki setting is enabled but its wiki repository is not initialized, and
GitHub Pages is not configured. No unverified wiki, site, installer, or
release is claimed here.

Only the main checkout remains registered with Git. Five previously used,
clean checkout directories could not be removed because Windows still held
files open after their Git metadata was removed; they contain no uncommitted
work and are not registered worktrees.
