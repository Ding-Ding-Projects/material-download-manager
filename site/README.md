# Material Download Manager site

This directory contains the local-asset landing and documentation surface. It
uses plain browser HTML, CSS, SVG, and JavaScript; it has no runtime package
dependencies, CDN assets, analytics, or network-loaded images.

## Local checks

Run from the repository root:

```powershell
npm --prefix site run check
npm --prefix site run build
```

`check` validates the local asset inventory, article coverage, accessibility
landmarks, regex-builder hooks, release manifest, and stable-installer gate.
`build` runs the same check and copies the serving files to a temporary
directory outside the repository. The output path is printed by the script so
it can be opened by a local static server without adding generated output to
the checkout.

`data/universal-feature-manifest.js` is the hand-written Pages contract
inventory. It is checked separately from the feature article catalogue, keeps
required surfaces and exact verification probes for every contract entry, and
reports planned or partial entries without presenting them as shipped. The
site settings schema also persists the emoji decoration switch and the
user-renamable School mode name/state. School mode is an English-only
user-experience setting: it removes the playful controls and local surprise,
and clearing this site's browser storage is the documented reset route.

The site embeds the categorized feature articles so the documentation remains
available without a fetch. The source Markdown remains authoritative in
`docs/features/`; every site article links back to its category article.

## Release and publication honesty

`data/release-manifest.json` and its browser-loaded JavaScript form fail closed
when no stable production release has been proven. The UI creates a stable
installer link only when a manifest record is marked verified, carries a stable
version, uses an HTTPS asset URL, and lists the required Squirrel assets. The
injected manifest also carries the version-stamped Chromium extension ZIP's
name, size, SHA-256, Manifest V3 version, unsigned state, and load-unpacked
installation method only after the latest release exposes matching verified
metadata. A prerelease is never eligible.

The extension release asset is a generic source/reference ZIP. Its pairing
module is intentionally empty, so a fresh copy cannot authenticate protocol-2
handoff until the desktop app prepares a private paired folder. The site directs
users to **Install browser extension** in the app, then **Developer mode → Load
unpacked** with the automatically revealed folder. The repository does not
create or advertise a CRX because a genuine CRX3 requires signing and the
project permanently prohibits signing keys and signing operations.

GitHub Pages publication is not claimed by this source. A real deployment URL
and built-output verification must be added before the repository advertises a
published site.
