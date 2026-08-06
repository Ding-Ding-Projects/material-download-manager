# Windows updates

This category documents the production-honest Squirrel.Windows packaging and
main-process update coordinator. The current slice does not claim that a
signed installer, a published `RELEASES` feed, or a GitHub Actions release is
available.

## Articles

- [Squirrel.Windows packaging and bounded updates](squirrel-windows.md)

## Verification

The updater tests run as part of `npm run test:electron`. A real installer
still requires a Windows packaging run with signing and a reachable public
HTTPS feed; the absence of those external assets is reported rather than
treated as a passing release.
