# Roadmap

This roadmap is a factual implementation checklist, not a promise that an
unverified surface has shipped.

## Shipped and verified foundations

- Real Windows Electron download engine with segmented transfers,
  pause/resume, persistence, queues, schedules, and bounded timeouts.
- Separate frameless download-progress window with typed IPC, live state,
  pause/resume/cancel/close controls, and hidden-desktop capture evidence.
- Manifest V3 Chromium extension with page/link/selected-text capture through
  the loopback protocol; accepted captures enter the desktop queue and bounded
  link-target precedence is covered by the extension contract test.
- Persisted language, independent funny levels, appearance provenance, and a
  four-tab Settings dialog with one search and regex-builder state per tab.
- Local Git-backed history plus a History app tab with date/action/text filters
  and filtered coding-format export; local commits disable hooks and isolate
  the snapshot from unrelated staged files.
- Material-style landing and documentation site, stable unsigned Squirrel
  packaging, self-hosted CI, GitHub Pages publication, and monotonic real
  releases.
- Built-artifact UI smoke that fail-closes on the real separate progress window,
  rejects nested interactive labels, and checks narrow Settings layout at 2×
  scale.

## Next global-memory implementation slices

1. Finish full per-element appearance editors, including the continuous color
   translator and Word-depth typography controls.
2. Complete persisted tab overflow, pinning, grouping, four discovery searches,
   and bulk-close review flows in the desktop app.
3. Add the in-app offline documentation browser and the complete renderer
   changelog viewer with validated commit links.
4. Complete bulk actions and notification-history operations, including export,
   reviewable previews, undo/history recording, and accessibility coverage.
5. Add scheduled language/appearance settings with validated HTTPS and Home
   Assistant sources, timezone semantics, fail-safe refresh, and tests.
6. Expand the real-artifact UI, accessibility, localization, and security
   matrix until every user-facing surface has evidence rather than a static
   placeholder.

Each slice must update its categorized documentation, site article, tests,
handoff, and stable release evidence before it is marked complete.
