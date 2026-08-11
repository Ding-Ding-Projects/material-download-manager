# Roadmap

This roadmap is a factual implementation checklist, not a promise that an
unverified surface has shipped.

## Shipped and verified foundations

- Real Windows Electron download engine with segmented transfers,
  pause/resume, persistence, queues, schedules, and bounded timeouts.
- Separate frameless download-progress window with typed IPC, live state,
  pause/resume/cancel/close controls, and hidden-desktop capture evidence.
- Manifest V3 Chromium extension with page/link/selected-text capture through
  the loopback protocol; accepted manual captures enter the desktop queue and
  bounded link-target precedence is covered by the extension contract test.
- Persisted language, independent funny levels, appearance provenance, and a
  four-tab Settings dialog with one search and regex-builder state per tab.
- Local Git-backed history plus a History app tab with date/action/text filters
  and filtered coding-format export; local commits disable hooks and isolate
  the snapshot from unrelated staged files.
- Protected display-name mutation history on branch
  `codex/uh-display-history` at source commit
  [`afb71fd`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/afb71fd):
  main-process canonical writes, required hash-only `display-name.json`
  revisions, OS-vault verifier, visible History lock, and fail-closed rollback
  when the required audit write fails. Broader `snapshot.json` revisions remain
  plaintext local metadata by design; the UI credential is not claimed as
  encryption or filesystem access control. Local focused evidence is 46/46
  tests and the real locked-surface capture is checked in. GitHub Actions run
  [`31483227655`](https://github.com/Ding-Ding-Projects/material-download-manager/actions/runs/31483227655)
  completed successfully and published non-draft, non-prerelease
  [`v0.1.59`](https://github.com/Ding-Ding-Projects/material-download-manager/releases/tag/v0.1.59)
  from source commit `2bbcb5993c001e35fbdacd8a0f9266cc2424f2a4` with unsigned
  Squirrel and extension ZIP assets. The workflow does not run tests; local
  test evidence remains authoritative.
- Material-style landing and documentation site, stable unsigned Squirrel
  packaging, pinned GitHub-hosted build/package/publication automation, GitHub
  Pages publication, and monotonic real releases. GitHub Actions runs no tests
  or lint; local task evidence carries those results.
- Root `build.bat` and `build-installer.bat` now provide a touchless,
  user-scoped fresh-machine path with silent mode, official Node.js checksum
  fallback, locked npm installation, current-commit output checks, and
  unsigned Squirrel artifact validation. The scripts never sign, publish,
  tag, upload, or create a CRX; the focused fixture guard proves both wrappers
  work from paths containing spaces and rejects deliberately broken contracts.
- Built-artifact UI smoke that fail-closes on the real separate progress
  window, rejects nested interactive labels, and checks narrow Settings layout
  at 2× scale.
- Shared School mode presentation slice at source commit
  [`ecf9bc6`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ecf9bc65e6f78f08e109abfbed5aa897cbdbb86d): schema-v5 local
  application-data state, user-renamable English-only mode, persisted dialog
  emoji switch, canonical main-process IPC, live main/progress-window
  propagation, playful/dim-sum surface suppression, and fail-closed reset
  metadata. Local evidence is 88/88 compiled Electron checks and 99/99 engine
  checks. Real built-artifact captures cover the emoji control and the enabled
  suppressed state in `docs/screenshots/settings/`; no password/TOTP
  enrollment, narration, schedules, appearance, or history expansion is part
  of this slice.

## Authenticated automatic browser capture implemented

- Automatic extension capture defaults on for eligible HTTP(S) browser
  downloads. The extension pauses first, records bounded ownership, cancels and
  erases the browser copy only after final authenticated durable acceptance,
  and resumes/retains the exact extension-owned item after every failed
  takeover route.
- **Install browser extension** creates a private paired copy: the app-side
  capability stays in the operating-system credential vault, the matching
  value is written only into the staged extension, and the exact staged folder
  opens automatically. **Open extension folder** remains the manual fallback.
- Protocol 2 sends only a nonce to `GET /v2/challenge` before the app proves the
  pairing with HMAC-SHA-256. The query-bearing download URL is sent only in the
  authenticated one-use POST, and the final `202` carries an authenticated
  accepted response.
- The app accepts only after a credential-free ranged GET succeeds and the real
  queue record is durably persisted and started. Protocol 2 has no provisional
  response; a client disconnect before response delivery rolls the new record
  and protected source back.
- Automatic handoff sends only a credential-free URL and optional URL-derived
  safe basename—never cookies, authorization headers, referrers, browser
  request headers, or an absolute browser destination path. The desktop server
  also rejects website origins before routing. Accepted query-bearing URLs
  persist only in the operating-system credential vault, stay redacted
  elsewhere, and are removed on terminal cleanup.
- Admission is bounded to 8 in-flight handoffs and 60 challenge/POST requests
  per rolling minute. One-use challenges expire after 30 seconds and occupy a
  table capped at 64 entries.
- The Options page persists a default-on automatic-capture switch while keeping
  manual popup and context-menu handoffs. The existing Settings search retains
  its adjacent full regex builder.
- Release automation produces a version-stamped, archive-validated extension
  ZIP with structured size and SHA-256 evidence. The public pairing module is
  empty, so the generic ZIP is source/reference until the app prepares a
  private paired copy. It does not produce a CRX because a genuine CRX3
  requires signing and the repository permanently prohibits signing keys and
  signing operations.
- The final built-artifact evidence is captured and integrated on main at
  `f9e92db5d39efe7a33f124f8a2fde0b6b3392c76`: the real-app smoke passed 43/43
  checks, all seven auto-organize gallery frames were replaced, and a
  public-safe browser-extension install/reveal capture was added. Stable
  release `v0.1.54` and Pages run `31464419316` are verified for that commit.

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

## Distributed SSH downloads integrated

- Opt-in Docker-backed SSH workers are selected by host count, split only after
  an exact range/validator probe, and assembled locally from atomic verified
  pieces.
- The main process owns host pins, provisioning, vault-held source secrets,
  trust consent, retry/quarantine state, and safe local fallback. Renderer
  settings patches cannot author worker identity or trust state.
- The restricted worker container, framed protocol, manifest, range planner,
  vault, source probe, manager seam, settings controls, progress rows, and
  focused hostile tests are shipped. Docker daemon runtime evidence remains an
  external verification boundary when no daemon is available.

## Next global-memory implementation slices

1. Finish full per-element appearance editors, including the continuous color
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
