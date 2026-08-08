# Material Download Manager — Chromium extension

This is a real Chromium Manifest V3 extension for handing a page or link to a locally configured Material Download Manager adapter. It is intentionally self-contained: popup and options pages use local HTML, CSS, and JavaScript only, with no analytics, CDN, remote images, or tracking.

## Local bridge state

The integration Electron app now exposes the bounded loopback adapter in `design/electron/extension/HandoffServer.ts`. It binds `127.0.0.1:43771`, serves `/v1/status`, and accepts `/v1/downloads`. The extension defaults to `http://127.0.0.1:43771/v1/downloads` and never tries to reach the context-isolated renderer IPC bridge from Chrome.

The supported contract is documented in [`docs/handoff-contract.md`](docs/handoff-contract.md), and the exact main-process/preload seam is recorded in [`docs/electron-integration-seam.md`](docs/electron-integration-seam.md). If the desktop app is closed, the port is occupied, the response fails validation, or the endpoint is manually cleared, the extension reports failure and keeps the manual paste recovery path available.

## Load and use

Every stable GitHub Release attaches this extension as
`material-download-manager-extension-<version>.zip`, packaged from the same
source commit as the installer. Download it from the
[latest release](https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest),
extract it to a folder (`manifest.json` sits at the archive root), and load
that folder below — or use this `extension/` directory directly from a
checkout.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the extracted folder or this
   `extension/` directory.
3. Open **Details → Extension options**.
4. The default endpoint is already configured. Use **Test connection** to verify the running local adapter, or use **Use default endpoint** after changing it.
5. Use the toolbar popup or the context menu on a page, link, or selected text. Page captures use the page URL, link captures use the link target, and selection captures include the selected text as bounded metadata. Captured URLs and metadata are validated locally and handed to the app’s real download manager; failures are retained for the popup recovery surface.

The options page includes browser-style tabs, keyboard-operable settings search, an anchored regex builder, English / playful Hong Kong Cantonese / bilingual language modes, separate English and Cantonese funny-level sliders from 1–5, a display-name setting, and versioned JSON settings export/import. A `202` handoff response means the adapter accepted the request for queue dispatch; it is not a completed-download signal.

Funny levels change voice only. Warnings, errors, URLs, affected data, and recovery choices remain explicit at every level.

## Permissions

| Permission | Reason |
| --- | --- |
| `activeTab` | Read the active page URL only after the user opens the popup or invokes the extension action. |
| `contextMenus` | Add the page, link, and selection “Send URL” action. |
| `storage` | Persist local settings and the last handoff result. |
| `http://127.0.0.1/*`, `http://localhost/*` | Permit only the documented loopback HTTP handoff; no arbitrary web-host access is declared. |

The extension does not request `tabs`, `scripting`, `downloads`, `notifications`, or `<all_urls>`.

## Verification

From the repository root:

```powershell
node --test extension/tests/*.test.mjs
```

Or from this directory:

```powershell
npm test
```

The verifier checks the MV3 manifest and minimal permissions, entrypoint wiring for the service worker/popup/options surfaces, the runtime message boundary, URL and endpoint validation, settings export sanitization, regex safety limits, and the accessible UI markers.

## File map

- `manifest.json` — MV3 metadata and minimized permissions.
- `src/service-worker.js` — context menu, message boundary, storage, bounded fetch timeout, and recovery result state.
- `src/popup.*` — current-tab URL handoff surface.
- `src/options.*` — connection, preferences, help, settings search, regex builder, and settings export/import.
- `src/shared/` — pure validation, handoff envelope, regex, settings, and localization logic.
- `docs/handoff-contract.md` — adapter contract and security boundary.
- `docs/electron-integration-seam.md` — implemented Electron seam and truthful failure behavior.
- `tests/extension.test.mjs` — automated static and pure-logic verifier.
