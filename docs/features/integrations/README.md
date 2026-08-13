# Browser integrations

- [Chromium extension handoff](./browser-extension.md) — catch eligible browser
  downloads through an app-prepared protocol-3 pairing, prove the app before a
  URL is sent, require a rendered Start-download decision before the pending
  acknowledgement, resume the browser fallback on every failed takeover,
  retain manual page/link capture, and automatically
  reveal the exact private staged folder. The Settings card rechecks that
  folder after remount/restart and can request the fixed Chrome extensions
  manager URL while retaining a manual `chrome://extensions/` fallback.
- [External editor handoff](./external-editor.md) — discover or browse for a
  local Visual Studio Code executable, open exported desktop records from an
  application-owned workspace root, and fail safely when the editor is
  unavailable. Browser-extension and Pages exports remain local downloads.
- [Local Ollama suite manager](../product/ollama-suite-manager.md) — manage
  credential-free loopback providers and refresh installed-model metadata
  through the documented local API.
