# Squirrel.Windows packaging and bounded updates

## Behavior

`design/package.json` targets Squirrel.Windows for x64 builds and explicitly
sets the supported `forceCodeSigning` root control and Windows
`signAndEditExecutable` control to `false`. electron-builder 24.13.3 does not
accept root-level `signExecutable` or `signAndEditExecutable` properties, so
the helper rejects those schema-invalid controls rather than pretending they
disable anything. Code signing is permanently prohibited for this project. A valid
build produces `Setup.exe`, `RELEASES`, the full `.nupkg`, and any generated
delta packages under the Squirrel output directory. The release workflow
collects those real files, verifies that `Setup.exe` reports `NotSigned`, and
publishes one immutable stable GitHub Release after build, package, and artifact
checks. GitHub Actions runs no tests or lint; those checks remain local task
evidence and never control publication. The workflow never publishes a draft or
prerelease as the production path.

`design/electron/updater/UpdateService.ts` is a main-process-only coordinator.
It performs one bounded startup check and bounded background checks. It
exposes `current`, `available`, `downloading`, `ready`, `failed`, and `offline`
states. Downloads are staged in the background. Installation is never
automatic: the renderer exposes manual check, release notes, `Later`, and
`Restart to install update` actions after a fresh unsaved-work assertion.
Because the artifacts are intentionally unsigned, the ready state also shows
an explicit unsigned-artifact warning. HTTPS feed metadata, `RELEASES`, and
package hashes provide transport and package integrity; they are not a
signature claim.

## Configuration

The service uses the stable public feed URL
`https://github.com/Ding-Ding-Projects/material-download-manager/releases/latest/download/`
unless the main-process-only `MDM_UPDATE_FEED_URL` environment variable
overrides it. `MDM_UPDATE_RELEASE_NOTES_BASE_URL` optionally overrides the
release-notes base. Both accept only credential-free HTTPS URLs without query
or fragment components.

The release workflow reserves a monotonic version tag and a unique dim-sum
code-name mapping when the public catalog is available. A catalog outage does
not block a stable release; the notes record that the code name was
unavailable. The historical `v0.1.0` unsigned test prerelease remains a
separate record and is excluded from the stable updater feed.

## Failure modes and security

- Missing feed configuration fails closed and makes no network call.
- Development and unsupported-platform launches fail closed.
- Network failures become `offline`; raw errors, credentials, and URLs are not
  sent to the renderer.
- Bounded timeouts and operation leases prevent overlapping checks or downloads
  and prevent late events from overwriting a ready state.
- Equal, older, malformed, or unverified candidate versions never become
  downloadable or ready.
- The app stages an update and never calls `quitAndInstall()` while active work
  or a stale unsaved-work check remains.
- Any signer invocation or setup executable whose Authenticode state is not
  `NotSigned` fails the release. The project never requests, discovers,
  restores, or uses a signing credential.
- A missing stable release leaves the landing-page installer button absent; no
  guessed or prerelease URL is presented as a production download.

## Verification

Run from `design/`:

```powershell
npm run typecheck
npm run build
npm run test:electron
```

For packaging, run the committed unsigned helper and validator from the
repository root:

```powershell
pwsh -NoProfile -File scripts/build-unsigned-squirrel.ps1 -Version 0.1.1
pwsh -NoProfile -File scripts/validate-squirrel-artifacts.ps1 -OutputDirectory "$env:TEMP\mdm-release-assets" -ManifestPath "$env:TEMP\mdm-release-assets.json" -OwnedOutputRoot "$env:TEMP"
```

The commands above are local checks; GitHub Actions does not run them. The
release workflow verifies the exact commit, stable
`draft=false` and `isPrerelease=false` state, workflow timing, line-count
table, Squirrel release assets, version-stamped Chromium extension ZIP, and the
published asset inventory. The extension ZIP must keep its public pairing
module empty; it is versioned source/reference until the desktop app prepares a
private paired folder for authenticated handoff. A real release is not claimed
from compilation or from the historical test prerelease. The workflow does not
create a CRX because a genuine CRX3 requires signing and signing keys are
permanently prohibited.

## Suggested articles

- [Download engine reliability](../download-engine/reliable-transfers.md)
- [Notification center](../notifications/notification-center.md)
- [Language and appearance settings](../settings/language-and-appearance.md)
- [Landing and documentation site](../site/landing-and-documentation-site.md)
