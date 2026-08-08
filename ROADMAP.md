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
- Built-artifact UI smoke that fail-closes on the real separate progress
  window, rejects nested interactive labels, and checks narrow Settings layout
  at 2× scale.

## Auto-organize foundation integrated

- Default-folder auto-organization into six documented category paths, with
  `image` routed to General, no retroactive moves, and the folder-routing
  switch leaving classification active.
- Exact schema-v3 rule and absolute-folder validation, truthful per-key
  provenance, trusted compiled-default resets, canonical schema-v2 migration,
  first-match keyboard reordering, dynamic Settings search, and field-specific
  accessibility wiring.
- Terminable main-process workers with bounded IPC, deadlines, safe fallback,
  readiness handshakes, generation-checked previews, bounded match-only/full
  responses, and DNS-pinned schedule refreshes for user-authored rules.
- Real-artifact coverage passed for add/edit/reorder/remove/invalid/save/
  reopen, builder bounds, focus, contrast, touch targets, bilingual narrow
  layout, command-palette teleport, separate History/Changelog action errors,
  and exact process-tree cleanup. The corresponding issue and immutable release
  record are the source of truth for remote CI, publication, and installer
  evidence; this roadmap never predicts an in-flight workflow result.

## Next global-memory implementation slices

1. Add opt-in distributed SSH downloads: select one or more provisioned worker
   hosts, split only range-capable downloads across them, verify returned parts,
   assemble locally, and automate a least-privilege Docker worker lifecycle
   without exposing credentials to the renderer or repository.
2. Finish full per-element appearance editors, including the continuous color
   translator and Word-depth typography controls.
3. Complete persisted tab overflow, pinning, grouping, four discovery searches,
   and bulk-close review flows in the desktop app.
4. Finish the renderer changelog viewer's advanced locale-aware date range,
   preset, and export flows; the current viewer already embeds 43 published
   stable entries with validated full commit links, and the offline in-app
   Documentation browser is now shipped.
5. Complete bulk actions and notification-history operations, including export,
   reviewable previews, undo/history recording, and accessibility coverage.
6. Add scheduled language/appearance settings with validated HTTPS and Home
   Assistant sources, timezone semantics, fail-safe refresh, and tests.
7. Expand the real-artifact UI, accessibility, localization, and security
   matrix until every user-facing surface has evidence rather than a static
   placeholder.

Each slice must update its categorized documentation, site article, tests,
handoff, and stable release evidence before it is marked complete.
