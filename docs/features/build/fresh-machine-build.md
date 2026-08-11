# Fresh-machine build contract

## Behavior

The repository root contains two Windows entry points:

- `build.bat` bootstraps the user-scoped toolchain and builds the runnable
  application through `design/package.json`'s supported renderer and main-process
  scripts.
- `build-installer.bat` reuses that path, then invokes
  `scripts/build-unsigned-squirrel.ps1` and
  `scripts/validate-squirrel-artifacts.ps1` to produce and validate the
  Squirrel.Windows installer.

Both scripts resolve their helper paths from `%~dp0`, so they work when started
from another directory and when the checkout path contains spaces. They accept
`/s`, `--silent`, `SILENT=1`, and `MDM_BUILD_SILENT=1`. Silent mode reports each
phase but never prompts, pauses, launches the application, opens a folder, or
starts an installer. Unknown arguments return a non-zero exit code with usage
text; the child build exit code is returned to the caller.

## Bootstrap and configuration

The contract derives the package and lockfile from `design/`. It requires the
declared npm lockfile format and the package's real build scripts rather than
guessing a command. The first run checks for the pinned Node.js 22.16.0 runtime
in a user-scoped toolchain directory. It first attempts a non-interactive,
user-scoped `winget` install and, when that route is unavailable or refused,
downloads the matching official Node.js archive and verifies its SHA-256 entry
from the official checksum index. Git is checked only because the build records
the source commit; it is reused when present or installed from the canonical
Git for Windows source into the same user-scoped toolchain area. The process
`PATH` is refreshed immediately after either install.

Project packages are installed with `npm ci --no-audit --no-fund`. There are no
global npm installs, and the committed package-lock bytes are compared before
and after the build. A warm run reuses a valid `node_modules` tree while npm
repairs a partial or interrupted install. Native Electron and esbuild binaries
are checked explicitly and bootstrapped through the project's complete binary
helper when they are absent.

The installer version comes only from the strict `version` field in
`design/package.json`. The helper records the source Git commit and verifies
that the build did not change tracked files. Squirrel output is collected from
`design/release/squirrel-windows`, not from an ambiguous release root. The
validator requires one non-empty setup executable, `RELEASES`, every full
package (and any generated delta packages), matching `RELEASES` references,
stable names, sizes, SHA-256 digests, and Authenticode status `NotSigned`.

## Failure modes

Failures identify the phase, required version, and attempted source. Missing
manifests or locks, an unsupported lockfile, unavailable bootstrap routes,
partial npm installation, missing native binaries, stale output, a changed
source tree, a packaging error, a malformed `RELEASES`, duplicate or empty
artifacts, path escape/reparse traversal, a signer, or any forbidden extension
material is a non-zero result. Previously valid artifacts are not treated as a
fresh success when the current commit did not produce them.

The scripts do not install certificates or signing keys, discover signing
material, invoke a signer, rename an archive to `.crx`, or generate CRX/CRX3
files. Browser-extension support remains the versioned unpacked/ZIP path with
Chrome's **Load unpacked** flow. The installer output states that it is
unsigned and may trigger an unknown-publisher or SmartScreen warning.

Local scripts also never call release, tag, push, upload, or publication
commands and never require a GitHub token or feed secret. They only build and
validate files in bounded, disposable staging directories.

## Verification

Run the focused guard from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/test-build-contract.ps1
```

The guard runs a fresh fixture with a space-containing path, checks help and
unknown-argument handling for both wrappers, and proves that removing the
silent-mode marker or changing `lockfileVersion` fails verification. For a
complete local artifact check, run:

```powershell
build.bat /s
build-installer.bat /s
```

The final report names the renderer and main-process outputs, the source commit,
the unsigned Squirrel assets, and each artifact digest. GitHub Actions remains
responsible for publication; these local scripts never publish.

## Suggested articles

- [Squirrel.Windows packaging and bounded updates](../updates/squirrel-windows.md)
- [CI and release contract](../../../CI.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)
- [Browser integrations](../integrations/browser-extension.md)
