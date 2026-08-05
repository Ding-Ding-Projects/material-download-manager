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

The hardening milestone also corrected the compiled renderer path and made
unpackaged production launches load the built renderer unless
`NODE_ENV=development` is explicit. Server- or user-supplied filenames are
constrained to one safe Windows path segment, and ranged responses must agree
with their `Content-Range` before bytes are written.

A Windows packaging run (`npm run dist:win`) is still required before publishing
an installer; a compile-only success is not packaging evidence.

The repository now has a Windows push/dispatch workflow at
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the checks above. It
does not claim installer, updater, or release verification.

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
