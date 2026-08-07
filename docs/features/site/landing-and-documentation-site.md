# Landing and documentation site

## Behavior

The `site/` directory is a dependency-free, locally bundled landing and
documentation surface. It presents feature articles, the current release
manifest, changelog entries, settings, browser-style tab navigation, a
command palette on `Ctrl+Shift+F`, independent English and Cantonese funny
levels, and anchored regex builders for its search fields. The site remains
usable without a network connection; a stable installer button appears only
when the release manifest has verified immutable release metadata and the
required Squirrel assets.

## Configuration

Run `npm run check` and `npm run build` from `site/`. The builder accepts an
optional output directory outside the source site, which is how the Pages
workflow stages its deployment artifact. Release data is kept in
`site/data/release-manifest.json` and its browser-readable JavaScript mirror;
the two files must remain identical in source. The Pages workflow copies the
checked site to runner-temporary staging and then uses the GitHub CLI to inject
the latest verified stable release record there, so a release update does not
create a repository push loop. It archives the staging directory with
PowerShell and the runner's `tar.exe`, uploads the archive as the `github-pages`
artifact, and deploys it with the official Pages deployment action. A
historical test prerelease is recorded separately from the stable slot and
does not enable an installer download.

## Failure modes

The check fails when an article is missing, a suggested article does not
resolve, the JavaScript and JSON release manifests differ, a remote asset or
external font is introduced, the stable installer record is incomplete, or a
generated/dependency directory appears in the source tree. The Pages release
manifest helper fails if the latest stable record is draft/prerelease, lacks
`Setup.exe`, `RELEASES`, a full `.nupkg`, required timing/line-count/unsigned
markers, or an HTTPS installer URL. The build removes
only its explicitly requested staging directory before copying the checked
local files. An unavailable stable release leaves the installer button absent;
it never points at a guessed or prerelease asset.

## Security considerations

The site has no analytics, CDN, third-party script, remote image, or external
font dependency. The release manifest is treated as untrusted data and the
browser checks its schema, stable verification flag, exact release URL, and
required asset names before creating a download link. The site builder stages
only a bounded list of known files and rejects output paths inside the source
site.

## Verification

`npm run check` validates the required files, article inventory, local assets,
language and settings controls, tab semantics, regex-builder anchors, release
manifest distinction, and absence of remote assets. `npm run build` reruns the
check and verifies the staged HTML includes the local runtime and manifest.
The Pages workflow repeats both commands on the contracted self-hosted Windows
runner, injects release metadata with
`scripts/prepare-pages-release-manifest.ps1`, creates the Pages tar archive in
PowerShell because the runner cannot execute the Bash wrapper in
`actions/upload-pages-artifact@v3`, uploads it as `github-pages`, and verifies
the published HTML response.

## Suggested articles

- [Tabbed navigation](../navigation/tabbed-navigation.md)
- [Regex builder](../search/regex-builder.md)
- [Squirrel.Windows releases](../updates/squirrel-windows.md)
