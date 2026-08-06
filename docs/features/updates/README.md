# Windows updates

This category documents the production-honest Squirrel.Windows packaging,
main-process update coordinator, secure preload bridge, and renderer update
banner. The current slice does not claim that a signed installer, a published
`RELEASES` feed, or a GitHub Actions release is available.

## Articles

- [Squirrel.Windows packaging and bounded updates](squirrel-windows.md)

## Verification

The updater tests run as part of `npm run test:electron` (29/29 passed on the
reconciled lane), including focused coverage for updater and completion
notification behavior. A real installer still requires a Windows packaging run
with signing and a reachable public HTTPS feed; the absent Squirrel artifacts
from this host's unsigned shape attempt are reported rather than treated as a
passing release.
