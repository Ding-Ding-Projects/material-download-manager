# CI and release contract

This file is the repository-level contract for Windows validation and stable
release automation. The workflows deliberately target a self-hosted runner;
they do not fall back to a GitHub-hosted runner.

## Runner contract

Every job matches all four labels below:

```text
self-hosted
windows
x64
material-download-manager-windows-x64
```

The runner must be a reachable Windows x64 machine with the GitHub Actions
runner service, Git, PowerShell 7, GitHub CLI, and network access to the
canonical package and release services. The exact dependency inventory and
bootstrap commands are committed in
[`scripts/self-hosted-dependencies.json`](scripts/self-hosted-dependencies.json).

The workflow checks `RUNNER_OS` and `RUNNER_ARCH` at runtime. It does not infer
capacity, runner-group access, or network reachability from a label; those are
operator-owned prerequisites that must be checked before dispatching a run.

## Fresh bootstrap

Both workflows select Node.js 22 with `actions/setup-node@v4`, then run the
pre-install check before `npm ci` and the post-install check afterward:

```powershell
pwsh -NoProfile -File scripts/verify-self-hosted-bootstrap.ps1 -Phase preinstall
Push-Location design
npm ci --no-audit --no-fund
Pop-Location
pwsh -NoProfile -File scripts/complete-node-binary-bootstrap.ps1
pwsh -NoProfile -File scripts/verify-self-hosted-bootstrap.ps1 -Phase postinstall
```

The native bootstrap explicitly runs the declared Electron and esbuild install
scripts because npm 11 can leave their package directories present while
withholding install scripts. On Windows x64, esbuild's native executable is
`design/node_modules/@esbuild/win32-x64/esbuild.exe`; the top-level package's
`bin/esbuild` is a JavaScript launcher, not a second root-level executable. The
post-install phase requires that platform binary to execute and match the
lockfile package version, plus the Electron binary, the lockfile-installed
`electron-builder` binary, and `lockfileVersion: 3`. Its PowerShell JSON reader
uses `-AsHashtable` only for `package-lock.json`, whose valid npm schema has an
empty-string package key; the dependency inventory remains normal object JSON.
A fresh-environment proof
is a run on a disposable Windows x64 runner with an empty npm cache and no
`design/node_modules`; a cache hit may speed it up but is not the proof.

## Validation workflow

`.github/workflows/ci.yml` runs on every push and on `workflow_dispatch`. It
typechecks, builds, runs the downloader and Electron integration suites, runs
the dependency-free real Electron/CDP UI smoke, and checks the Chromium
extension contract. Its concurrency group cancels obsolete validation runs
for the same ref.

## GitHub Pages workflow

`.github/workflows/pages.yml` runs on pushes to `main` and on
`workflow_dispatch`. It uses the same four-label self-hosted runner contract,
checks the dependency prerequisites, runs `site/check.mjs`, builds the checked
site to an isolated runner-temporary directory, injects only the latest
verified stable release record from `gh release view`, and deploys it through
the official Pages deployment action. The contracted Windows runner cannot
execute the Bash wrapper in `actions/upload-pages-artifact@v3`, so the workflow
archives the staged directory with PowerShell and `tar.exe`, uploads that
`artifact.tar` as `github-pages` with `actions/upload-artifact@v4`, and then
invokes `actions/deploy-pages@v4`. `actions/configure-pages@v5` requests Pages
enablement when the repository has not been configured yet. A stable installer button is absent when no
non-draft, non-prerelease release with verified Squirrel assets exists.
Deployment is not canceled halfway through: its concurrency group protects the
side effect rather than abandoning a Pages upload. The workflow verifies the
published HTML response after deployment. The source site has no runtime
dependencies or remote assets.

## Stable release workflow

`.github/workflows/release.yml` runs on every push and on
`workflow_dispatch`. The release job performs all tests before reserving a
release identity or building an installer. It then:

1. runs [`scripts/count-lines.mjs`](scripts/count-lines.mjs), publishing source,
   tests, styles/markup, generated, excluded, total, non-blank, and surviving
   `git blame` attribution rows;
2. reserves the next unused monotonic `vMAJOR.MINOR.PATCH` tag and a unique
   public dim-sum catalog code-name ref;
3. builds Squirrel.Windows x64 through
   [`scripts/build-unsigned-squirrel.ps1`](scripts/build-unsigned-squirrel.ps1);
4. validates `Setup.exe`, `RELEASES`, every full and delta `.nupkg`, the
   `RELEASES` references, and the `NotSigned` Authenticode state through
   [`scripts/validate-squirrel-artifacts.ps1`](scripts/validate-squirrel-artifacts.ps1);
5. uploads the validated assets to a draft, publishes one stable non-draft
   release with `isPrerelease=false`, writes verified workflow timing, and re-reads the
   published release and asset inventory through
   [`scripts/publish-stable-release.ps1`](scripts/publish-stable-release.ps1).

There is no alternate distribution path. A test or artifact failure stops
before release creation. A later failure after a tag reservation leaves that
identity occupied so a subsequent run advances monotonically rather than
recycling it.

## Unsigned release policy

Code signing is prohibited for this project. The release workflow does not
accept signing credentials, does not add a signing step, and does not claim
authenticity or signature verification. The packaging helper clears inherited
signing inputs, temporarily changes only the build copy of
`design/package.json`, restores that file byte-for-byte, and requires
`Get-AuthenticodeSignature` to report `NotSigned` for `Setup.exe`.

Every stable release note says that the artifacts are intentionally unsigned
and may trigger a Windows SmartScreen or unknown-publisher warning. Squirrel
integrity remains covered by HTTPS transport, `RELEASES`, package hashes, and
the validated asset set; those checks are not a signature claim.

## Dim-sum code names and photos

The metadata helper resolves English and Traditional Chinese names from the
public [`Ding-Ding-Projects/dim-sum-photos`](https://github.com/Ding-Ding-Projects/dim-sum-photos)
catalog and selects only a dish with a published `catalog-v1*` asset. Release
notes link the public asset and record the catalog release tag. The consumer
repository never generates, downloads, vendors, or attaches a copied catalog
photo. If the catalog is unavailable, the release proceeds with its version
and records that no code name was available.

## Pages and external verification boundary

The Pages deployment workflow and source build path are live and verified at
https://ding-ding-projects.github.io/material-download-manager/. The repository
homepage points to that URL, and the live release manifest supplies the stable
installer button only after the published release inventory is checked. Run
`31155262910` proved the source and staging path but exposed that the repository
had not been enabled for Pages; the workflow now requests enablement directly.

The repository-level runner was registered on 2026-08-07 with the four labels
above. Organization-level inventory still cannot be read with the current
GitHub CLI account because GitHub returned HTTP 403 and required the
`admin:org` scope; this does not block the repository-scoped evidence. Main
verification run `31161445625`, stable release run `31161445627`, and Pages
run `31161445620` are green. At evidence-capture time, the live manifest
reported stable `v0.1.12` from `e6fd63d4227c740c7b73298784d95d0b84b9a869`,
with `publication.pages=verified` and the published installer endpoint
responding with the real `Setup.exe` asset. The repository's latest-release
link remains dynamic for later successful stable runs.
