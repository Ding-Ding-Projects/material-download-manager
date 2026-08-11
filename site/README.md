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

The top-bar Notification centre now keeps up to 100 text-only toast records in
browser storage. Dismissed messages remain reviewable, with an independent
search/regex builder, status filter, visible-scope selection and inverse
selection, bulk dismiss, typed delete confirmation, and JSON export. The
manifest continues to mark this universal feature partial while the complete
two-key destructive confirmation and full capture matrix remain outstanding.

### Notification centre capture evidence

![Notification centre showing a persisted dismissed record](../docs/screenshots/site/notification-centre-history.png)

This capture was taken from source commit
`a790fe937092c75c0d766365223cc6ed2ea9e95d` at a 1384 by 892 pixel viewport
using the local Pages files on an isolated hidden desktop. The PNG is
`docs/screenshots/site/notification-centre-history.png` and its SHA-256 is
`0fcbb0d1e65eb667bc4b83e3bba20535c518b40196abc16967b054a19872ebce`.
It shows the Settings-triggered toast retained as a dismissed history row,
the local search and regex builder, the status filter, and the bulk controls.

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
