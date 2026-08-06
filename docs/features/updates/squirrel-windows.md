# Squirrel.Windows packaging and bounded updates

## Behavior

`design/package.json` targets `squirrel` for x64 Windows builds and enables
the supported `squirrelWindows.msi`, `artifactName`, and public HTTPS
`iconUrl` options. MSI is explicitly `false` for the current
electron-builder 24.13.3 package because its WiX generator uses the
hyphenated npm package name as an invalid identifier; the required Squirrel
installer path remains enabled. A successful Squirrel build produces
`Setup.exe`, `RELEASES`, and a full `.nupkg` under the Squirrel output
directory. Delta packages are generated only when `remoteReleases` points to a
prior published feed; this repository intentionally does not set that option
until a signed feed exists. `npm run dist:win` is the packaging command;
`npm run dist:win:dir` remains the unpacked smoke-build command.

`design/electron/updater/UpdateService.ts` is a main-process-only coordinator.
It performs one bounded startup check and then bounded background checks. It
exposes these explicit states: `current`, `available`, `downloading`, `ready`,
`failed`, and `offline`. Downloads are staged in the background. Installation
is never automatic: a later UI/IPC surface must explicitly call
`quitAndInstall()` after showing the exact version and the restart action.
Electron's built-in Squirrel event does not include the version in its initial
`update-available` notification, so the available/downloading state may carry
`version: null` until the downloaded event supplies its release name. A future
renderer must show that as an honest pending version rather than inventing one.

## Configuration

The service accepts the public feed URL from the main-process-only
`MDM_UPDATE_FEED_URL` environment variable. It accepts only HTTPS URLs with
no username, password, or query string, and it never sends credentials to the
renderer. The current repository has no committed feed URL because no signed
release feed has been published yet.

The compatibility setting `showCompleteDialog` now truthfully controls the
non-blocking OS completion notification as well as the renderer's setting
label. It never opens a blocking dialog. `completionNotification.ts` keeps the
decision logic injectable for focused tests.

## Failure modes and security

- Missing feed configuration produces `failed` and makes no network call.
- Development and unsupported-platform launches fail closed.
- Network failures produce `offline`; raw error strings are not placed in the
  public state, so URLs and accidental credentials cannot leak through update
  diagnostics.
- Checks and downloads have bounded timeouts and refuse overlapping checks.
- The updater only stages an update. The app does not call `quitAndInstall()`
  during startup, active downloads, or background checks.
- Squirrel signing, the public HTTPS feed, the `RELEASES` index, and the
  GitHub Actions release workflow remain external dependencies. Until those
  exist and are verified on a Windows build host, this repository does not
  claim an installer or update release.
- Enabling MSI requires either a builder upgrade that fixes that WiX
  identifier generation or a deliberate package-name migration; this slice
  does not silently rename the application package to make an optional MSI
  appear green.

## Verification

Run from `design/`:

```powershell
npm run typecheck
npm run build
npm run test:electron
npm run dist:win
```

The first three checks are local source/build checks. `npm run dist:win` is
the required real packaging check and must be inspected for the Squirrel
artifacts listed above; a compile-only run is not release evidence.

## Suggested articles

- [Download engine reliability](../download-engine/reliable-transfers.md)
- [Notification center](../notifications/notification-center.md)
- [Language and appearance settings](../settings/language-and-appearance.md)
