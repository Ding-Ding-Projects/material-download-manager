# Windows updates

This category documents the production-honest Squirrel.Windows packaging,
main-process update coordinator, secure preload bridge, renderer update banner,
and the signed GitHub Actions release path. The unsigned test prerelease
[`v0.1.0`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.0)
was published from the verified workflow and is excluded from the stable
updater feed. No stable signed release has been published: the normal workflow
is fail-closed until its protected signing certificate and password are
configured and a signed run verifies the assets. An explicit manual-dispatch
`skip_signing` route can publish an `UNSIGNED` prerelease for testing only.

## Articles

- [Squirrel.Windows packaging and bounded updates](squirrel-windows.md)

## Verification

The updater tests run as part of `npm run test:electron` (31/31 passed on the
reconciled lane), including focused coverage for updater and completion
notification behavior. The release helpers also resolve the first unused
published catalog photo and produce the reproducible line-count table. The
unsigned `v0.1.0` test release carries the CI-built Squirrel assets; a signed
production installer still requires a Windows packaging run with signing and a
reachable public HTTPS feed. Absent Squirrel artifacts are reported rather
than treated as a passing release.
