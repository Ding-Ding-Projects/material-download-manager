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

On 2026-08-05, the following checks passed on `codex/full-app`:

| Check | Result |
| --- | --- |
| `npm ci` | Installed 396 packages from the lockfile; npm reported 11 audit findings and install-script approval warnings. |
| `npm run typecheck` | Passed renderer and Electron TypeScript checks. |
| `npm run build` | Passed Vite renderer and Electron main-process compilation. |
| `npm run test:engine` | 23/23 passed, including Range integrity, pause/resume, non-resumable fallback, custom-header persistence and origin stripping, global queue limits, schedule race handling, filename sanitization, malformed Range rejection, categories, and throttling. |
| `npm run test:electron` | 15/15 passed for export, local history, regex, tabs, command-palette foundations, and compiled renderer-path resolution. |
| Hidden-desktop smoke | Passed through the cheap hidden-desktop route: direct Electron `v31.7.7` launch opened `Material Download Manager` at 1150×720, rendered the empty state, opened Settings, and returned focus after Escape; the desktop and process were cleaned up. |
| Remote GitHub Actions | No green verdict claimed: the previously observed Windows verification run remained queued, and GitHub Actions had earlier rejected manual dispatch with `Actions has been disabled for this user`. |

The hardening milestone corrected the compiled renderer path and made
unpackaged production launches load the built renderer unless
`NODE_ENV=development` is explicit. Server- or user-supplied filenames are
constrained to one safe Windows path segment, and ranged responses must agree
with their `Content-Range` before bytes are written.

A Windows packaging run (`npm run dist:win`) is still required before publishing
an installer; a compile-only success is not packaging evidence. The current
package configuration still targets NSIS/portable output and does not yet claim
the required Squirrel.Windows setup/update artifacts.

The repository now has a Windows push/dispatch workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the checks above. It
does not claim installer, updater, or release verification. Remote execution
still needs GitHub Actions to be enabled for the authenticated user.

## Known follow-up work

These items remain open and are deliberately not hidden by the directory
reconciliation:

1. Validate the Windows installer and update artifacts on the supported build
   path.
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
   Its current evidence is typecheck/build, existing engine/Electron tests, and
   a cheap headless Settings/Escape/focus smoke; a renderer DOM harness,
   notification bulk actions, deletion history recording, and full-copy
   localization remain open.
10. The settings lane now supplies versioned language, funny-level, appearance,
   and provenance state with persistence tests. The settings surface still needs
   its own search/regex builder and browser-style tabs, full appearance-editor
   depth, and copy wiring across every renderer message.
11. Keep the landing page, changelog viewer, release line counter, and
    sanitized instruction mirror current as the product surfaces are
    implemented.

## Git state and ownership

The reconciliation is merged into `main`, and the original handoff history is
preserved as a parent of the integration commit. The agent-created branch can
be removed only after the pushed ancestry proof; the original handoff branch is
retained unless its ownership is clear. There are no open GitHub issues at the
time this handoff was refreshed. GitHub Discussions are disabled, the wiki
setting is enabled but its wiki repository is not initialized, and GitHub Pages
is not configured. No unverified wiki or site is claimed here.
