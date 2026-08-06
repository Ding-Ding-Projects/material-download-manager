# Squirrel.Windows packaging and bounded updates

## Behavior

`design/package.json` targets `squirrel` for x64 Windows builds and enables
the supported `squirrelWindows.msi`, `artifactName`, and public HTTPS
`iconUrl` options. It also sets `forceCodeSigning: true`, so a release build
fails closed when the signing certificate is unavailable. MSI is explicitly `false` for the current
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
is never automatic: the renderer banner exposes manual check, release-notes,
`Later`, and `Restart to install update` actions, and the main process only
calls `quitAndInstall()` after a fresh unsaved-work assertion succeeds.
Electron's built-in Squirrel event does not include the version in its initial
`update-available` notification, so the available/downloading state may carry
`version: null` until the downloaded event supplies its release name. The
banner labels that state as the latest version rather than inventing a number.
The shared state validator rejects malformed versions, unsafe release-notes
URLs, and invalid progress values before they reach the renderer.

Checks and downloads use operation leases. A caller timeout marks the lease
stale but keeps it busy until the adapter settles, so a late event cannot start
an overlapping native Squirrel operation or overwrite a ready state. Candidate
versions must be strictly newer than the installed version before download or
installation can proceed.

The release workflow's normal path requires Authenticode signing. A manual
`workflow_dispatch` may explicitly set `skip_signing` for a test-only run; the
workflow restores the committed signing configuration, labels the release
`UNSIGNED`, and publishes it as a prerelease so it cannot become the stable
updater feed. During that route it also removes `CSC_LINK`, `WIN_CSC_LINK`,
and their password variables for the packaging child process, because an empty
certificate variable is still interpreted by electron-builder as a certificate
path. The original environment and package configuration are restored in a
`finally` block. This exception is not production signing evidence.

Every release run reserves its final version tag and, when a published catalog
photo is available, a `refs/tags/release-code-name/<catalog-id>` ref before the
long packaging step. Those refs are created through GitHub's ref API and a
conflict retries the next candidate; other API failures stop the run. The
reservations remain as auditable tombstones if a build fails, so a later run
cannot recycle an identity selected by an earlier run. Release runs therefore
do not rely on branch-scoped concurrency for repository-global tag or code-name
uniqueness.

## Configuration

The service uses the stable public feed URL
`https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest/download/`
unless the main-process-only `MDM_UPDATE_FEED_URL` environment variable
overrides it. It also accepts an optional release-notes base
from `MDM_UPDATE_RELEASE_NOTES_BASE_URL`. Both accept only HTTPS URLs with no
username, password, query, or fragment, and the main process never sends raw
errors or credentials to the renderer. The current repository has no committed
release asset because no signed release feed has been published yet.

Every updater IPC handler checks the sender window and frame. The preload
bridge exposes only typed operations and validates returned state, install
results, and unsaved-work payloads before the renderer consumes them.

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
- Checks and downloads have bounded timeouts, retain stale operation leases until
  adapter settlement, and refuse overlapping checks or downloads.
- Equal, older, malformed, and unverified candidate versions never become
  downloadable or ready.
- The updater only stages an update. The app does not call `quitAndInstall()`
  during startup, active downloads, or background checks.
- Squirrel signing, the public HTTPS feed, the `RELEASES` index, and the
  GitHub Actions release workflow are release dependencies. The workflow
  validates the signed Squirrel artifacts, immutable target commit, timing,
  line-count table, and release metadata before publishing. Until a signed run
  verifies those facts, this repository does not claim a signed production
  installer or stable update release. The unsigned `v0.1.0` test prerelease is
  separate evidence and is excluded from stable update discovery.
- An unsigned prerelease is accepted only when a user explicitly dispatches
  `skip_signing`; it is visibly labeled and excluded from stable update
  discovery. The workflow clears signing environment variables only for that
  child packaging process and restores them afterward. It does not satisfy the
  signed production-release requirement.
- A concurrent release run cannot reuse a version or catalog code name reserved
  by another run. Existing ref conflicts are the only retry path; permission,
  authentication, or other GitHub API failures remain visible failures rather
  than being mistaken for a collision.
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
node --check ../scripts/resolve-release-metadata.mjs
```

The first three checks are local source/build checks. `npm run dist:win` is
the required signed packaging check and must be inspected for the Squirrel
artifacts listed above; a compile-only run is not release evidence. When no
certificate is available, a local artifact-shape check may temporarily set
`forceCodeSigning` to `false`, remove empty `CSC_LINK`/`WIN_CSC_LINK` variables
for the child process, restore the committed value immediately, and report the
resulting files as unsigned shape evidence only—not as a release.

## Suggested articles

- [Download engine reliability](../download-engine/reliable-transfers.md)
- [Notification center](../notifications/notification-center.md)
- [Language and appearance settings](../settings/language-and-appearance.md)
