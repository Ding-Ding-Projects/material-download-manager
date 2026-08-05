# Material Download Manager (Electron)

A Windows desktop download manager, ported from the Kotlin/Compose Multiplatform
[AB Download Manager](../vendor/ab-download-manager) (see `vendor/ab-download-manager`
submodule) into an Electron + React + TypeScript application.

## Structure

- `electron/` — main process: window management, IPC handlers, and the
  download engine (`electron/download/`): segmented multi-connection HTTP
  downloads with resume support, speed limiting, queue scheduling, category
  detection, and JSON-file persistence — a TypeScript port of the concepts in
  `downloader/core` from the original Kotlin codebase.
- `electron/preload.ts` — contextBridge-exposed `window.api`, the only surface
  the renderer can use to reach the main process.
- `shared/types.ts` — types and IPC channel names shared by main + renderer.
- `src/` — React renderer: title bar, sidebar (categories/queues), download
  list, add-download / details / settings dialogs, styled to match the
  original app's dark/light UI (see `vendor/ab-download-manager/assets/screenshots`).

## Development

```bash
npm install
npm run electron:dev   # vite + tsc --watch + electron, live reload
```

## Build & package for Windows

```bash
npm run build           # renderer (vite) + main process (tsc)
npm run dist:win        # electron-builder: NSIS installer + portable exe
```

Output lands in `release/`.
