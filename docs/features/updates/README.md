# Windows updates

This category documents the production-honest Squirrel.Windows packaging,
main-process update coordinator, secure preload bridge, renderer update banner,
and the stable GitHub Actions release path. Code signing is permanently
prohibited, so every production artifact is intentionally unsigned and carries
an explicit Windows warning. The historical unsigned test prerelease
[`v0.1.0`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.0)
was published from the verified workflow and is excluded from the stable
updater feed. The normal workflow runs no tests or lint. It builds, validates
`Setup.exe`, `RELEASES`, full packages, `NotSigned`, the version-stamped
Chromium extension ZIP, and immutable release metadata, then publishes one
non-draft, non-prerelease release. The extension ZIP keeps its public pairing
module empty and is a source/reference artifact until the desktop app prepares
a private paired folder. It has no signing route.

## Articles

- [Squirrel.Windows packaging and bounded updates](squirrel-windows.md)

## Verification

The updater tests run locally as part of `npm run test:electron`, including focused
coverage for updater, completion-notification, timeout, stale-event, and
overlap behavior. The release helpers also resolve an unused public catalog
code name when available and produce the reproducible line-count table. The
unsigned `v0.1.0` test release carries historical workflow-built Squirrel
assets. A current production release must come from the stable pinned-hosted
workflow and prove `Setup.exe`, `RELEASES`, the full package, the extension ZIP,
`NotSigned`, and `isPrerelease=false`. Absent artifacts are reported rather
than treated as a successful release. No CRX is produced because the project
permanently prohibits signing keys and signing operations.
