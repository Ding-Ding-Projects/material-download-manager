# Landing and documentation site

## Behavior

The `site/` directory is a dependency-free, locally bundled landing and
documentation surface. It presents feature articles, the current release
manifest, changelog entries, settings, browser-style tab navigation, a
command palette on `Ctrl+Shift+F`, independent English and Cantonese funny
levels, and anchored regex builders for its search fields. The site remains
usable without a network connection; a stable installer button appears only
when the release manifest has verified immutable release metadata and the
required Squirrel assets. The injected manifest also records a single verified,
version-matched Chromium extension ZIP with its HTTPS URL, size, SHA-256,
Manifest V3 version, unsigned state, and load-unpacked install method. The site
labels that generic ZIP as versioned source/reference with an empty pairing
module and directs users to the desktop app for the private paired folder that
can authenticate protocol-2 handoff.

The Pages source also carries a hand-written universal feature inventory in
`site/data/universal-feature-manifest.js`. Its required surfaces, article
paths, status, and exact verification probes are checked independently from
the sixteen-item article catalogue. The current source reports partial and
planned entries honestly while each missing implementation is delivered in a
later verified slice.

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
does not enable an installer download or verified extension-asset record.

## Failure modes

The check fails when an article is missing, a suggested article does not
resolve, the JavaScript and JSON release manifests differ, a remote asset or
external font is introduced, the stable installer record is incomplete, or a
generated/dependency directory appears in the source tree. The Pages release
manifest helper fails if the latest stable record is draft/prerelease, lacks
`Setup.exe`, `RELEASES`, a full `.nupkg`, required timing/line-count/unsigned
markers, one version-matched extension ZIP, extension size/SHA-256 metadata, or
the required HTTPS asset URLs. A release containing a CRX is rejected because
the repository has no authorized signing path. Release packaging also rejects
an extension ZIP that embeds a pairing capability instead of the required
empty public module. The build removes
only its explicitly requested staging directory before copying the checked
local files. An unavailable stable release leaves the installer button absent;
it never points at a guessed or prerelease asset.

The browser settings schema now includes a persisted emoji-decoration switch
and a user-renamable School mode. School mode forces English presentation,
removes the playful controls and dim sum surprise, and restores the prior
language and funny-level values when switched off. Clearing this site's browser
storage is the reset route; no credential or secret is stored by this slice.

## Security considerations

The site has no analytics, CDN, third-party script, remote image, or external
font dependency. The release manifest is treated as untrusted data and the
browser checks its schema, stable verification flag, exact release URL, and
required asset names before creating a download link. Extension ZIP metadata is
kept separate from installer metadata and is never inferred from a filename
alone. The site never presents the generic ZIP as a paired client: capability
creation, operating-system credential-vault storage, private staging, and
automatic folder reveal remain desktop-app responsibilities. The site builder stages
only a bounded list of known files and rejects output paths inside the source
site.

## Verification

The `check` and `build` commands are local verification tools; GitHub Actions
does not run tests or lint. `npm run check` validates the required files, article inventory, local assets,
language and settings controls, tab semantics, regex-builder anchors, release
manifest distinction, and absence of remote assets. `npm run build` reruns the
check and verifies the staged HTML includes the local runtime and manifest.
The Pages workflow uses the pinned GitHub-hosted Windows image, builds the site
to isolated staging, injects release metadata with
`scripts/prepare-pages-release-manifest.ps1`, creates the Pages tar archive in
PowerShell because the runner cannot execute the Bash wrapper in
`actions/upload-pages-artifact@v3`, uploads it as `github-pages`, and verifies
the published HTML response.

## Suggested articles

- [Tabbed navigation](../navigation/tabbed-navigation.md)
- [Regex builder](../search/regex-builder.md)
- [Squirrel.Windows releases](../updates/squirrel-windows.md)
