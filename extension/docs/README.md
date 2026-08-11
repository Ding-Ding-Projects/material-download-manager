# Extension documentation

This directory documents the browser extension's local handoff and settings
boundaries. It is a public documentation mirror; it does not contain pairing
capabilities, credentials, or user-specific paths.

- [Handoff contract](handoff-contract.md) — loopback protocol, automatic
  browser-download recovery, and the privacy boundary.
- [Electron integration seam](electron-integration-seam.md) — the desktop
  process boundary that prepares a paired folder and opens it for installation.
- [Settings foundation](settings-foundation.md) — School mode, the emoji
  preference, and the redacted display-name mutation journal introduced in the
  current slice.
