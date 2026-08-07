# Material Download Manager

Material Download Manager is a Windows Electron download manager ported from the
AB Download Manager codebase.

## Quick index

- Runnable app: [`design/`](design/)
- Preserved visual prototype: [`prototype/`](prototype/)
- Handoff: [`HANDOFF.md`](HANDOFF.md)
- Shared project guidance mirror: [`AGENTS.md`](AGENTS.md)
- CI workflow: [Windows verification](.github/workflows/ci.yml)
- Release workflow: [Windows release](.github/workflows/release.yml)
- Landing and documentation site: [`site/`](site/) (local source; Pages publication not verified)
- Search feature docs: [`docs/features/search/`](docs/features/search/)
- Navigation feature docs: [`docs/features/navigation/`](docs/features/navigation/)
- Website: not published
- Export feature docs: docs/features/export/
- History feature docs: docs/features/history/
- Accessibility feature docs: docs/features/accessibility/
- Notification feature docs: docs/features/notifications/
- Safety feature docs: docs/features/safety/
- Settings feature docs: docs/features/settings/
- Download engine docs: docs/features/download-engine/
- Site feature docs: docs/features/site/

<details>
<summary>Build and test</summary>

From `design/`:

```powershell
npm install
npm run typecheck
npm run build
npm run build:electron
npm run test:engine
npm run test:electron
```

The Windows packaging command is `npm run dist:win`. It uses the
Squirrel.Windows x64 target with signing enforced, so it fails closed without
a certificate. The `Windows release` workflow performs the signed build,
validates `Setup.exe`, `RELEASES`, and the full Squirrel packages, then creates
one uniquely tagged release with the CI-produced line-count table and release
metadata. Before packaging, it atomically reserves the version tag and the
catalog code-name ref so concurrent branch runs cannot select duplicate global
release identities. The workflow is present, and manual dispatch produced the
unsigned test prerelease [`v0.1.0`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.0)
from the verified commit. It contains the CI-built `Setup.exe`, `RELEASES`,
and full Squirrel package. This is test evidence only: the protected signing
certificate and password are still absent, so signed production release
publishing remains fail-closed. An explicit manual-dispatch `skip_signing`
input creates an `UNSIGNED` prerelease only; it never becomes the stable
updater feed.

The updater has a stable default feed at
`https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest/download/`;
`MDM_UPDATE_FEED_URL` remains an optional main-process override. The unsigned
`v0.1.0` prerelease is excluded from the stable feed; no signed production
installer or verified stable update feed is claimed until a signed workflow
run proves both.

The Windows verification workflow runs the typecheck, build, downloader tests,
and compiled Electron path tests on every push and on manual dispatch.

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
notification, accessibility, safety, search, navigation, export, and local
history foundation. The remaining release and product gaps are explicit in
[`HANDOFF.md`](HANDOFF.md); the prototype is never presented as the download
path.

</details>

## Shared guidance

[`AGENTS.md`](AGENTS.md) is a sanitized mirror of the shared agent and
contributor guidance. Edit the canonical instructions source rather than this
mirror when changing that policy.
