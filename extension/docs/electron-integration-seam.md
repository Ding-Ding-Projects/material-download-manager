# Electron integration seam

The integration implementation is `design/electron/extension/HandoffServer.ts`; this document records the exact seam and the failure semantics that the extension targets.

## Existing boundary audited by this lane

- `design/electron/main.ts` owns the `DownloadManager`, registers internal `ipcMain.handle(...)` handlers in `registerIpcHandlers()`, creates the window after `manager.init()` in `app.whenReady()`, and starts `HandoffServer` after manager initialization.
- `design/electron/preload.ts` exposes the renderer-only API through `contextBridge.exposeInMainWorld("api", api)` and currently exposes `addDownload`, `probeUrl`, settings, queues, and window actions.
- `design/shared/types.ts` is the source of the internal IPC channel names.
- The main process validates download URLs through its internal `assertHttpUrl` path and validates `AddDownloadRequest` before calling `manager.addDownload(...)`.
- `design/electron/extension/HandoffServer.ts` binds `127.0.0.1:43771` by default, serves `/v1/status`, validates and accepts `/v1/downloads`, and stops during the existing Electron shutdown paths.

Chrome cannot call that context-isolated renderer bridge. The extension must not receive a copy of the Electron preload object or be granted arbitrary page access as a workaround.

## Implemented seam: main-process loopback adapter

The integration adapter in `design/electron/extension/HandoffServer.ts` implements these responsibilities:

1. Bind an HTTP server to `127.0.0.1:43771` by default. Do not bind `0.0.0.0` and do not accept a public host override.
2. Implement `OPTIONS /v1/downloads` for the CORS preflight described in [`handoff-contract.md`](handoff-contract.md).
3. Implement `GET /v1/status` and return `{ "protocol": 1, "acceptingUrls": true }` only while the manager is initialized and accepting new downloads.
4. Implement `POST /v1/downloads`; bound the request body, parse JSON, require `protocol: 1` and `source: "material-download-manager-extension"`, reject credentials/non-HTTP URLs, and reuse the existing `assertHttpUrl`/`AddDownloadRequest` validation before calling `manager.addDownload(...)`.
5. Map the envelope to a real `AddDownloadRequest` using the app’s configured download folder, a sanitized filename derived from the URL path, the default queue, and `startImmediately: true`.
6. Return `202` after validation and dispatch to `manager.addDownload(...)`. This is an acceptance-for-queueing signal, not a completion signal; a later manager rejection is logged by the adapter and cannot be reported to the extension after the response.
7. Start the listener after `await manager.init()` and stop it during the existing shutdown path. A bind failure is logged and leaves the extension’s connection test in its truthful failure state.

The extension’s Options endpoint must match the resulting `http://127.0.0.1:<port>/v1/downloads` address. If the app uses a random port, provide a user-visible copy action or a stable local configuration file read by the adapter; never make the extension scan ports.

## Optional seam: preload only for in-app configuration

If the desktop UI needs to configure or display the adapter, add narrowly scoped channels to `design/shared/types.ts`, handlers in `design/electron/main.ts`, and typed methods in `design/electron/preload.ts`. Those channels are for the Electron renderer to manage the adapter; they are not the browser handoff itself. The browser path remains the loopback HTTP contract above.

## Acceptance checks for the future Electron change

- The listener is loopback-only and rejects public bind addresses.
- `GET /v1/status` returns protocol 1 only when the manager is ready.
- Invalid JSON, oversized bodies, unsupported protocols, credential-bearing URLs, and malformed metadata are rejected without reaching `DownloadManager`.
- A valid request reaches the same `manager.addDownload(...)` path as the real Add download UI.
- The listener closes on app shutdown and reports bind/parse/manager failures through non-blocking desktop notifications.
- The extension’s existing `npm test` suite remains green, and the Electron process-boundary test proves one valid request plus rejection of credential-bearing input. The extension still covers unavailable-adapter recovery through its status and handoff failure tests.
