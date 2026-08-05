# Material Download Manager

Material Download Manager is a Windows Electron download manager ported from the
AB Download Manager codebase.

## Quick index

- Production app: [`design/`](design/)
- Preserved visual prototype: [`prototype/`](prototype/)
- Handoff: [`HANDOFF.md`](HANDOFF.md)
- Shared project guidance mirror: [`AGENTS.md`](AGENTS.md)
- Website: not published

<details>
<summary>Build and test</summary>

From `design/`:

```powershell
npm install
npm run typecheck
npm run build
npm run build:electron
npm run test:engine
```

The Windows packaging command is `npm run dist:win`. Its installer output still
needs validation on a Windows build host before it is treated as a release
artifact.

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
either one. The core add, probe, segmented-download, pause/resume, persistence,
queue, category, and settings loop is present in the Electron app.

Packaging validation, queue clock scheduling, the remaining product features,
and the future Material 3 reskin remain explicit follow-up work. See
[`HANDOFF.md`](HANDOFF.md) for the evidence and boundaries.

</details>

## Shared guidance

[`AGENTS.md`](AGENTS.md) is a sanitized mirror of the shared agent and
contributor guidance. Edit the canonical instructions source rather than this
mirror when changing that policy.
