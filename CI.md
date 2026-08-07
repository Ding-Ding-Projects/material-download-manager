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
withholding install scripts. The post-install phase then requires both native
binaries, the lockfile-installed `electron-builder` binary, and the lockfile's
`lockfileVersion: 3`. A fresh-environment proof is a run on a disposable
Windows x64 runner with an empty npm cache and no `design/node_modules`; a cache
hit may speed it up but is not the proof.

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
the official Pages actions. A stable installer button is absent when no
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

The Pages deployment workflow and source build path are present, but the live
site is not claimed until a matching runner executes the deployment and the
published URL is checked. The repository homepage and the site's stable
installer button remain unchanged until that evidence exists.

The runner inventory was checked on 2026-08-07: the repository-level runner API
returned zero registered runners. The organization-level inventory could not
be read with the current GitHub CLI account because GitHub returned HTTP 403
and required the `admin:org` scope. Therefore no remote workflow, release, or
green CI result is claimed from this lane until the runner contract is
registered and a real run completes.
