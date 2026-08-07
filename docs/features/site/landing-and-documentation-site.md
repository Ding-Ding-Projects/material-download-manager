# Landing and documentation site

## Behavior

The repository now includes a static landing and documentation surface under
`site/`. It uses browser-style tabs for Overview, Features, Changelog, Settings,
and About. The tab strip can dock to the left or top, persists that choice, and
changes its keyboard arrow behavior with the orientation. The surface keeps
visible focus, a skip link, labeled controls, modal focus restoration, and
narrow-layout overflow behavior.

Feature articles are embedded in `site/content.js` so the documentation browser
does not need a network fetch. The site includes one article for every current
feature entry, including the landing/documentation surface itself. Each article
contains behavior, configuration, failure modes, security considerations,
verification, a categorized Markdown source link, and suggested articles.

The site has a local command palette on `Ctrl+Shift+F`, feature and changelog
search, a settings search, and four tab-discovery searches. Each search owns its
own plain-text-first state and anchored regex builder. The builder uses the
JavaScript RegExp dialect, supports guided tokens, flags, sample text, live
matches, captures, copy, JSON export, bounded input, and fail-closed invalid
patterns.

## Configuration

Preferences are stored in browser `localStorage` under a versioned key. The
Settings tab exposes English, playful Hong Kong-style Cantonese, and bilingual
modes; independent English and Cantonese funny levels from 1 through 5; theme,
density, accent, font scale, reduced motion, tab docking, display name, and a
per-surface appearance editor. Each control has an explanation and a
provenance line. Reset controls restore the compiled-in values.

`data/release-manifest.json` is the release-gate source, with a browser-loaded
JavaScript form kept in sync for offline file usage. The installer action is
created only when a stable record is marked verified, carries a version and
HTTPS asset URL, and lists the required Squirrel assets. The current test
prerelease is explicitly ineligible, so no installer button is rendered.

The site uses only local HTML, CSS, JavaScript, and one small hand-authored SVG
illustration. It does not generate, download, vendor, or attach catalog
photography. No analytics, CDN, external font, or network-loaded image is
required.

## Failure modes and recovery

Invalid or oversized regex patterns remain in the field, show an inline error,
and produce no matches. Clipboard denial becomes a non-blocking notification;
the content remains available in the current view. Browser storage denial does
not prevent the site from working for the current session, although the
provenance line cannot claim persistence.

If the stable manifest is missing, malformed, or unverified, the release card
states that no stable installer is proven and leaves the installer slot empty.
It never falls back to the unsigned test prerelease or a guessed asset URL.
The About tab states that GitHub Pages publication is not verified by this
checkout; a local source page is not presented as a deployed site.

## Security considerations

Search patterns and sample text are evaluated locally with bounded lengths,
supported flags, safe zero-width advancement, and a conservative nested-
quantifier check. Preferences remain local to the browser. Embedded article
content is rendered through text nodes, not interpreted as executable markup.
Release URLs are accepted only from the verified manifest path, and no secret or
credential is used by the site.

## Verification

From the repository root:

```powershell
npm --prefix site run check
npm --prefix site run build
```

`site/check.mjs` verifies required files, article coverage, categorized source
links, accessibility landmarks, keyboard palette and regex-builder hooks,
release metadata, the absent stable-installer gate, local-only assets, and the
dependency-free package manifest. `site/build.mjs` runs the check and copies the
serving files to a temporary directory outside the repository. The build does
not create generated output in the checkout.

## Suggested articles

- [Language and appearance settings](../settings/language-and-appearance.md)
- [Regex builder](../search/regex-builder.md)
- [Squirrel.Windows packaging and bounded updates](../updates/squirrel-windows.md)
