# Material Download Manager (Electron)

A Windows desktop download manager, ported from the Kotlin/Compose Multiplatform
[AB Download Manager](../vendor/ab-download-manager) (see `vendor/ab-download-manager`
submodule) into an Electron + React + TypeScript application.

The former Material Design click-through prototype is preserved separately in
[`../prototype/`](../prototype/). This directory is the runnable application;
the prototype's simulated engine is not part of the production download path.

## Structure

- `electron/` — main process: window management, IPC handlers, and the
  download engine (`electron/download/`): segmented multi-connection HTTP
  downloads with resume support, speed limiting, queue scheduling, category
  detection, category-folder routing, ordered custom regex rules evaluated in
  terminable workers, and schema-v3 JSON persistence with per-key provenance —
  a TypeScript port of the concepts in
  `downloader/core` from the original Kotlin codebase.
- `electron/preload.ts` — contextBridge-exposed `window.api`, the only surface
  the renderer can use to reach the main process.
- `shared/types.ts` — types and IPC channel names shared by main + renderer.
- `src/` — React renderer: title bar, sidebar (categories/queues), download
  list, add-download / details / settings dialogs, styled to match the
  original app's dark/light UI (see `vendor/ab-download-manager/assets/screenshots`).
- `src/components/SettingsDialog.tsx` — the tabbed settings surface, including
  six future auto-organize paths, dynamic settings search, and an accessible
  ordered rule list whose cards each have an anchored regex-only builder.
- `electron/regex/` and `electron/download/categoryRegexWorker.ts` — bounded,
  terminable main-process workers used for every desktop user-authored regular
  expression, including Add download previews and final category routing.
  Cold-start readiness is timed independently from bounded evaluation, filter
  batches omit captures, and full match details accept one sample only.
- `shared/settings.ts` — the exact settings and rule contract, including the
  absolute Windows default-folder requirement and versioned provenance rules.
- `electron/download/scheduleSources.ts` — bounded local/API/Home Assistant
  setting-source validation with nested rule cloning, private-address policy,
  per-request DNS resolution, and connection-time address pinning.
- `src/components/DocumentationPanel.tsx` and `src/generated/` — the offline
  Documentation tab and its checked-in catalog generated from every
  `docs/features/**/*.md` article. `MarkdownRenderer.tsx` renders provider
  text as isolated React nodes and resolves bundled relative links locally.

## Development

```bash
npm install
npm run docs:bundle:check
npm run test:docs
npm run electron:dev   # vite + tsc --watch + electron, live reload
```

## Build & package for Windows

```bash
npm run build           # renderer (vite) + main process (tsc)
npm run test:engine     # downloader and transfer tests
npm run test:electron   # compiled Electron path/launch-mode tests
npm run test:ui         # built-artifact CDP smoke, including Documentation
npm run dist:win        # electron-builder Windows package (validate before release)
```

`npm run ensure:electron` (also run automatically before `start` and
`test:ui`) verifies `node_modules/electron/dist` actually holds the platform
binary and restores it when it is missing. npm 11's install-script gate can
install the electron package without ever running its install script, and
electron's own `install.js` extracts asynchronously, so on some hosts it exits
0 while `dist/` is still empty. The ensure script is fully synchronous, judges
success only by the binary existing, verifies any archive against the
checksums shipped inside the electron package, and prefers the local
`@electron/get` cache before downloading from the official release URL.

Output lands in `release/`. Packaging still needs a supported Windows build
verification before any installer is treated as a release artifact.
