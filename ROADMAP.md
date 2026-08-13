# Roadmap

This roadmap is a factual implementation checklist, not a promise that an
unverified surface has shipped.

## In progress

- Local Ollama suite manager foundation is implemented on this task jer: the
  Settings and command-palette destination records credential-free loopback
  providers, refreshes installed-model metadata through `GET /api/tags` with
  bounded main-process validation, and transfers metadata without credentials.
  The exhaustive catalog, chat, attachments, harness launch, full list bulk
  actions, and local-history integration remain explicit follow-up gaps.
  Focused Ollama tests are **4/4**, UI smoke is **56/56**, typecheck/build and
  docs checks pass. The real built capture is
  [`ollama-suite-settings.png`](docs/screenshots/product/ollama-suite-settings.png),
  524×558, SHA-256
  `CFA365286EFF01ED73E07DCCFF0B2DC2DFB7B44F4C17DD1AD20A48B1F9A91024`.

- Browser-capture hardening is current source work on
  `codex/browser-handoff-hardening`, based on released baseline
  [`06bb011`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/06bb01130884452154a68e1ed07b0c72b8fa3946).
  It changes the user path to an authenticated pending decision with an
  always-on-top Start download window, a segmented background transfer, an
  ordinary non-topmost and reopenable Downloading window, and an app-owned
  always-on-top Download complete window. The source also rolls back the app
  transfer before Chrome may resume after a cancellation failure, preventing
  duplicate copies, and hands the destructive-confirmation callback directly to
  the real removal action after authorization so the gate cannot remain on an
  apparent Applying state. No local verification, capture, or release result is
  claimed for this follow-up; earlier toast captures are historical evidence
  only. See [`HANDOFF.md`](HANDOFF.md) and the
  [browser-extension article](docs/features/integrations/browser-extension.md).

- Desktop spoken narrator is implemented at source commit
  [`a7adc431`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/a7adc4313c341bd350a95409adca8b7d651fe2ea). The opt-in Settings
  surface persists enabled state, English/Cantonese/Both language order, quiet
  mode, and an explicit assistive-technology safety switch. Completion/error
  notifications use a serialized debounce/cooldown/replacement queue with
  School-mode, reduced-motion, screen-reader-signal, speech-availability, and
  Cantonese-voice boundaries. Local verification is narrator **7/7**, Electron
  **139/139**, engine **102/102**, built UI smoke **46/46**, docs **2/2**,
  typecheck/build, and diff check. The built Settings capture is
  `docs/screenshots/notifications/spoken-narrator.png` with SHA-256
  `28C29158DE84CCA0ED1DCC8BBAA2CE2B0D89BE53EEF1B23A53BE46F0FC8F5C33`.
  Release and Pages proof for this commit remains pending.

- Protected local history actions are implemented on
  `codex/uh-history-manager` at hardened source commit
  [`8ae3974`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/8ae397469594585d5d1e062d0a575d8de352551a)
  for issue [#16](https://github.com/Ding-Ding-Projects/material-download-manager/issues/16).
  The History surface now offers main-process redacted revision diffs,
  bounded sidecar labels, validated append-only restore with rollback, and
  retention tombstones that preserve label/prune/display-name audit revisions.
  Restored items and queues are rebuilt from a public allowlist, remain dormant,
  never reuse vault-backed source maps, preserve the live School-mode
  credential state, and produce a canonical audit revision. Local verification
  is full Electron **132/132**, engine **102/102**, docs
  **2/2**, typecheck/build, and built UI smoke **45/45**. Fresh built captures
  are `docs/screenshots/history/history-manager-actions.png` (SHA-256
  `845E8EA17410AF2C4CE95CF3531C03CCB100664C768297746F460CE02BC75115`) and
  `docs/screenshots/history/history-manager-actions-diff.png` (SHA-256
  `2F7C4290D2809095AC5D463F9DDF4D63C71FF3C3CCAD3A2F7C4CD5D1E6F28930`).
  Integration into `main` and remote CI/release evidence remain pending.

- External editor export handoff is complete on `main` at source commit
  [`0d16520`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/0d16520860d67903a007fc53dc9e1f9ff132009a): discovery and native Browse
  selection for Visual Studio Code, schema-v6 persisted choice, safe app-owned
  export staging, workspace-root opening, and export actions for
  NotificationCenter, RegexBuilder, AuthenticatorPanel, History, and Changelog
  are shipped. Full Electron **129/129**, built UI smoke **45/45**, engine
  **101/101**, docs **2/2**, site **94/94**, and release contract **63
  assertions** are green. Fresh post-integration capture:
  `docs/screenshots/integrations/external-editor-desktop-exports-regex-post-integration.png`,
  SHA-256 `6969fc98bd72787d8213bed44404b557e9ad2f49fd216ff711531ff29dafcf16`.
  Release `v0.1.125` and Pages run `31504646111` verify the exact source.

- Scheduled settings foundation is integrated and verified at
  `8b6e5f9c71e72cc5f86d8f85460ea6970b1c20fc`: versioned local records, native
  date/time and weekday editor, timezone and cross-midnight semantics,
  deterministic precedence, state/history persistence, live IPC propagation,
  and credential-free HTTPS/loopback/Home Assistant metadata validation.
  Local suites and the real Settings capture passed; GitHub Actions run
  `31493449594` published `v0.1.107` from the exact commit.

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
- Local TOTP foundation at source commit
  [`ce09797`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/ce09797e6c230cbb1fa9d1594fc2660655aa0cdf): RFC 6238 SHA-1/SHA-256/SHA-512
  generation and verification, strict `otpauth://totp/` parsing, one-time QR
  registration model, OS credential-vault storage, metadata-only IPC, and
  secret-free ordinary export. Local verification is typecheck, Electron build,
  focused 8/8 TOTP tests, existing Electron 95/95 tests, and documentation
  bundle tests 2/2. The full authenticator UI, QR rendering, locks, schedules,
  and list management remain open and are not claimed here.
- Authenticator Settings registration surface at source commit
  [`385e040`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/385e04030b0eebc6df5afa1370571226b9dd9d56): local QR matrix rendering,
  explicit one-time manual-secret reveal, code confirmation before vault
  mutation, responsive Settings tab/search wiring, metadata-only list/export,
  and no-network source/runtime checks. Local evidence is focused **12/12**,
  compiled Electron **100/100**, build/typecheck green, and built-artifact
  smoke **42/42** with a secret-free registration capture at
  `docs/screenshots/authenticator/authenticator-settings-empty.png`.
- Authenticator management list at source commit
  [`9c32741`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/9c3274134e6aa4b2d1de6b9f234fdf680b72f16f): restart-safe metadata reload,
  vault-backed current/next code display, numeric countdown, copy action, and
  period-boundary race protection. Local evidence is focused **14/14**,
  compiled Electron **110/110**, build/typecheck green, and built-artifact
  smoke **43/43**; the smoke verifies a disposable vault row without recording
  its digits and removes the entry before exit. A secret-free registration
  capture remains at `docs/screenshots/authenticator/authenticator-settings-empty.png`;
  live-code screenshots are not claimed because their digits are
  credential-bearing. Reorder/group/bulk workflows, per-tab locks, and
  schedules remain separate follow-up work; no signing or CRX artifact was
  introduced.
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
- Main-process updater integrity hardening: bounded HTTPS `RELEASES` parsing,
  matching full-package SHA-1/size metadata, index SHA-256 evidence, validated
  ready-state IPC, and a localized unsigned/SmartScreen warning in the ready
  banner. The path remains unsigned and does not create CRX artifacts.
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
- Shared School-mode reset credential at source commit
  [`3b76509c684a2fc5c795d92400e10cd803c511e3`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/3b76509c684a2fc5c795d92400e10cd803c511e3): setup, change, reset,
  and turn-off verification through main-process IPC; salted scrypt verifier
  in the operating-system vault; metadata-only settings propagation to both
  windows; deleted-profile recovery; and fail-safe rollback when metadata
  writes fail. Local evidence is docs bundle, typecheck, build, docs **2/2**,
  Electron **104/104**, and engine **99/99**, plus the real Settings capture
  `docs/screenshots/settings/school-mode-credential-turnoff.png`. TOTP locks,
  schedules, narration, appearance editors, signing, and CRX artifacts remain
  separate work.
- Boundary hardening follow-up at commit
  [`40fc29123da0c8b83c13176ab4ba526a4d5dcbd8`](https://github.com/Ding-Ding-Projects/material-download-manager/commit/40fc29123da0c8b83c13176ab4ba526a4d5dcbd8): direct renderer School-mode
  exits are rejected even with configured metadata, persistence failures roll
  metadata back, and verifier validation buffers are scrubbed. Follow-up local
  evidence is Electron **104/104** and engine **100/100**; the visible capture
  is unchanged.

## Authenticated automatic browser capture implemented

> Historical protocol-2 notes follow. The current protocol-3 pending-decision
> design is documented in `HANDOFF.md` and
> [`docs/features/integrations/browser-extension.md`](docs/features/integrations/browser-extension.md).

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
- A current-main recapture from source commit
  `84da5e1f2b10b6d88e9b946fe1523ad0295ddb2b` again passed 43/43 real-app
  checks. All seven fresh auto-organize PNGs matched the tracked bytes exactly,
  so the gallery remains current while only its verification provenance needed
  updating. The run created no CRX and used no signing material.

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
