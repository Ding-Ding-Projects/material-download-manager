# In-app documentation browser

## Behavior

The Windows Electron app exposes a Documentation tab beside Downloads,
History, and Changelog. Every categorized Markdown file under
`docs/features/` is bundled into the renderer at build time, including each
category index. The browser shows an article index, the selected article, its
source path, and the full rendered Markdown body.

The article search is local and plain-text-first. It searches the title, source
path, and body text. Each Documentation search has its own anchored full Regex
Builder for the JavaScript `RegExp` dialect, including flags, syntax feedback,
bounded evaluation, and an explicit opt-in regex mode. Selecting a result
updates the article without leaving the tab.

Markdown is rendered through one isolated React renderer shared by the
Documentation surface. Headings, paragraphs, lists, blockquotes, fenced code,
inline code, emphasis, strong text, and links are rendered as real elements;
provider-authored text is never inserted as HTML. Relative links to another
bundled `.md` article resolve inside the Documentation tab, while external
links remain ordinary external links.

## Configuration

The source of truth remains the categorized Markdown under `docs/features/`.
Run `npm run docs:bundle` from `design/` after changing an article. The
generated `design/src/generated/documentationArticles.ts` is committed so
typecheck and a clean checkout have a complete renderer input. The renderer
build runs `npm run docs:bundle:check` first and fails when the generated
bundle does not exactly match the source inventory.

The Documentation tab is part of the persisted browser-style tab state. The
global `Ctrl+Shift+F` command palette includes the Documentation destination,
and its normal tab activation, keyboard focus, and screen-reader semantics use
the existing tab contract.

## Failure modes

- A missing or stale generated bundle fails the build before Vite emits a
  renderer artifact; the error names `npm run docs:bundle` as the recovery.
- An invalid regex pattern fails closed, preserves the typed query, and shows
  an inline error without evaluating article text.
- A relative link that does not resolve to a bundled article remains visible as
  an ordinary link instead of silently navigating to a guessed local path.
- An empty search result states that no bundled articles match; it is not
  confused with a failed bundle or a network outage.

## Security considerations

The renderer receives a bounded compile-time article catalog and does not read
the filesystem, fetch documentation, or access Node/Electron APIs. Markdown is
converted to React text and element nodes rather than `dangerouslySetInnerHTML`.
External links retain their normal browser behavior and use `rel="noreferrer"`
when opened in a new tab. Executable protocols (`javascript:`, `data:`,
`file:`, `vbscript:`), protocol-relative destinations, and absolute local paths
are rendered as non-actionable text. Search patterns and article text stay
local and are bounded by the shared regex evaluator, including its
catastrophic-backtracking checks and match limit.

## Verification

Run these commands from `design/`:

```powershell
npm run docs:bundle:check
npm run test:docs
npm run typecheck
npm run build
npm run test:electron
npm run test:ui
```

The bundle test checks that the source inventory and generated article catalog
agree. Electron tests cover article-link resolution and bounded search. The
built-artifact UI smoke opens Documentation through the real tab and command
palette paths, searches in plain text and regex mode, opens an article result,
follows a relative article link, renders a fenced code block, verifies the
empty state, and checks the narrow layout.

## Suggested articles

- [Regex builder](../search/regex-builder.md) — understand the search dialect
  and safety bounds used by the browser.
- [Tabbed navigation](../navigation/tabbed-navigation.md) — see how the
  Documentation surface participates in the app's tab contract.
- [Landing and documentation site](../site/landing-and-documentation-site.md)
  — compare the offline app browser with the public static site.
