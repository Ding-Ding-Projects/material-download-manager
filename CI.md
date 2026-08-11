# Build, release, and Pages contract

This file records the repository's GitHub Actions contract for the Windows
application, stable releases, and GitHub Pages. Automated workflows build,
package, publish, deploy, and retain safe evidence. They do not run tests or
lint.

## Runner contract

The active jobs use the pinned GitHub-hosted `windows-2025` image. Before a
future routing change, inspect repository and organization self-hosted runner
availability, labels, operating system, architecture, capacity, and access. A
compatible online self-hosted runner may be selected only when that live
inventory proves it can accept the job; otherwise the pinned hosted image is
the fallback.

Node.js 22 is provisioned with `actions/setup-node@v4`. The release job also
uses Git, PowerShell 7, GitHub CLI, npm, the lockfile-declared Electron/esbuild
binaries, and electron-builder's Squirrel.Windows target. The Pages job uses
Git, PowerShell 7, Node.js 22, GitHub CLI, `tar.exe`, and the official Pages
actions. The complete job inventory is committed in
[`scripts/self-hosted-dependencies.json`](scripts/self-hosted-dependencies.json),
and [`scripts/verify-self-hosted-bootstrap.ps1`](scripts/verify-self-hosted-bootstrap.ps1)
checks that the workflow and inventory still describe the same jobs and pinned
image.

## Local verification, not an Actions gate

GitHub Actions deliberately runs no tests, lint, type checking, static
analysis, coverage, accessibility checks, or screenshots. Those checks remain
committed and are run locally for the task that changes the code. Their real
results belong in the task handoff and release notes, but their verdict never
blocks or controls a workflow.

The cost is explicit: an automated release can be published from a commit whose
local tests were skipped or failed, and the first person to discover the defect
may be someone running the installer. This repository accepts that tradeoff in
exchange for unconditional build and publication attempts. Documentation must
never describe the workflow itself as having passed tests it did not run.

The usual local application and extension checks are documented in
[`README.md`](README.md) and [`extension/README.md`](extension/README.md).

## Fresh bootstrap

The release job selects Node.js 22, installs the exact dependency graph from
`design/package-lock.json`, and completes the native binary bootstrap:

```powershell
Push-Location design
npm ci --no-audit --no-fund
Pop-Location
pwsh -NoProfile -File scripts/complete-node-binary-bootstrap.ps1
```

The native bootstrap explicitly completes the declared Electron and esbuild
install scripts because npm can leave their package directories present while
withholding the platform binaries. It verifies the lockfile-selected versions,
the executable Electron runtime, the esbuild Windows x64 binary, the
lockfile-installed electron-builder binary, and `lockfileVersion: 3`. Caches
may accelerate downloads but never replace this install path.

The Pages site has no runtime dependencies. Its build runs through
`site/build.mjs` into an isolated runner-temporary directory; no generated site
output is committed.

## Stable release workflow

`.github/workflows/release.yml` runs on every push and on
`workflow_dispatch`. Each successful run publishes exactly one unique,
monotonic, stable, non-draft, non-prerelease GitHub Release. The job:

1. checks out the exact source commit and bootstraps the declared dependencies;
2. builds the Windows application;
3. runs the committed line counter and reserves the next unused version plus an
   unused public dim-sum catalog code name when one is available;
4. builds the intentionally unsigned Squirrel.Windows package;
5. validates `Setup.exe`, `RELEASES`, every full and delta `.nupkg`, package
   references, and the `NotSigned` Authenticode state;
6. packages and validates the Chromium extension ZIP;
7. publishes the exact validated asset inventory, records verified workflow
   start/completion/duration values, and re-downloads the published extension
   ZIP to prove its size and SHA-256; and
8. always collects and uploads bounded safe evidence with seven-day retention,
   even after an earlier build or publication failure. Evidence collection is
   non-blocking and cannot turn the original failure green.

The release job fails only for build, packaging, artifact-contract,
publication, or remote-proof failures—not for a test or lint verdict. A later
failure after a version reservation leaves that identity occupied so the next
run advances monotonically instead of recycling it.

## Chromium extension release asset

[`scripts/package-extension.ps1`](scripts/package-extension.ps1) creates
`material-download-manager-extension-<version>.zip` after Squirrel artifacts
have been validated. It stages `manifest.json`, `src/`, `README.md`, and `docs/`
at the archive root, writes the reserved release version into only the staged
manifest, and verifies the Manifest V3 service worker, popup, and options entry
points exist in the ZIP.

Packaging rejects embedded manifest keys, private-key/certificate material,
and `.crx` files. It also requires `src/shared/pairing.js` to contain the empty
public capability and rejects any embedded pairing capability. The resulting
ZIP is a versioned, auditable source/reference artifact; the desktop app must
prepare a private paired copy before browser handoff can authenticate. The
packager writes structured extension metadata—format, version, size, SHA-256,
manifest version, load-unpacked install method, and unsigned state—into the
release asset manifest. Publication requires the staged directory, manifest
inventory, GitHub asset inventory, downloaded bytes, size, and SHA-256 to
agree.

The workflow does not publish a CRX. A genuine CRX3 is a signed package that
needs a persistent private key for a stable extension identity, while this
repository permanently prohibits signing keys and signing operations. An
ephemeral key or renamed ZIP would not satisfy that contract. Ordinary
off-store Chrome installation on Windows also remains restricted outside
administrator-managed enterprise policies. Releases therefore document the
generic ZIP as source/reference and direct users to **Install browser
extension** in the app, followed by **Developer mode → Load unpacked** from the
automatically revealed paired folder.

## Unsigned release policy

Code signing is prohibited for this project. The workflow accepts no signing
credential, discovers no certificate, invokes no signer, and claims no
signature-based authenticity. The packaging helper clears inherited signing
inputs, temporarily changes only the build copy of `design/package.json`,
restores that file byte-for-byte, and requires `Get-AuthenticodeSignature` to
report `NotSigned` for `Setup.exe`.

Every stable release note says that the Windows artifacts are intentionally
unsigned and may trigger SmartScreen or an unknown-publisher warning. HTTPS
transport, Squirrel `RELEASES` metadata, package hashes, and rollback checks
provide integrity evidence without being described as a signature.

## GitHub Pages workflow

`.github/workflows/pages.yml` runs on pushes to `main` and on
`workflow_dispatch`. It builds the dependency-free site to an isolated staging
directory, injects only a verified stable release manifest, archives the staged
directory, deploys through the official Pages actions, and verifies the live
HTML response. It does not run tests or lint.

The injected manifest includes the installer and structured extension ZIP only
after the latest non-draft, non-prerelease release exposes the expected asset
set and metadata. The site labels the ZIP as generic source/reference with an
empty pairing module, not as a freshly usable authenticated client; the app-
prepared folder remains the installation route. The public site keeps a
download action absent when the required evidence is missing rather than
guessing an asset URL. Deployment is a side effect, so its concurrency group
does not cancel a deployment halfway through.

The Pages job always collects a bounded run-context record and staged Pages
archive when available, then uploads that safe evidence with seven-day
retention without masking the original deployment result.

## Dim-sum code names and photos

The metadata helper resolves English and Traditional Chinese names from the
public [`Ding-Ding-Projects/dim-sum-photos`](https://github.com/Ding-Ding-Projects/dim-sum-photos)
catalog and selects only a dish with a published `catalog-v1*` asset. Release
notes link the public asset and record the catalog release tag. This repository
does not generate, download, vendor, or attach a copied catalog photo. Catalog
unavailability does not block a release; the notes state that no code name was
available.

## Current external evidence boundary

The published Pages surface remains
<https://ding-ding-projects.github.io/material-download-manager/>, and the
repository homepage points to it. Existing release and Pages run links are
historical evidence for their exact commits. The protocol-2 pairing,
authenticated final acceptance, protected URL vault, and extension-folder
changes in the current task remain unreleased until a completing commit and
matching release and Pages runs report their own final results.
