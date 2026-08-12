# Shared Project Guidance Mirror

This file is a sanitized mirror of the shared agent and contributor guidance.
It is provided so work in this repository has the same safety and quality
baseline as the canonical instructions. Change the canonical source first;
refresh this mirror afterward. This mirror deliberately omits machine-specific
paths, credentials, hosts, and private conversational vocabulary.

## Repository safety

- Read this file and the relevant handoff or feature documentation before
  editing.
- Preserve unrelated user work. Inspect status, diffs, branches, linked
  checkouts, and stashes before changing Git state.
- Use the Git CLI for local history and the GitHub CLI for GitHub operations.
  Never force-update history or delete work that is uncommitted, unmerged, or
  not present on the remote.
- Do not place credentials, tokens, private data, generated dependencies, or
  build output in the repository. Never ask for a secret in chat.
- Keep public documentation free of machine-specific information and secrets.

## Windows application scope

- The production surface is the Windows Electron application under `design/`.
- `prototype/` is preserved reference material. Its simulated engine and custom
  template runtime are not the production download path.
- Changes to the application must be tested at the real process boundary when
  they affect IPC, the preload bridge, plugins, or external integrations.
- The browser handoff integration is loopback-only and bounded: validate the
  protocol, URL, metadata size, content type, and queue result before claiming
  acceptance. The progress view is a separate frameless Electron window and
  must be verified as a real second window, not only as a renderer route.
- Keep accessibility, keyboard reachability, visible focus, correct roles and
  names, contrast, reduced motion, and narrow-window layout in scope.
- User-facing UI should use Material Design 3 tokens and components, with
  persisted language, appearance, and accessibility settings where the feature
  requires them.

## Universal cross-surface delivery

- Every user-facing surface, including the desktop application, browser
  extension, Pages/documentation site, settings screen, panel, and dialog,
  independently implements every canonical feature. A feature cannot be
  delegated to another surface, replaced with a placeholder, or treated as
  optional before it is fully implemented.
- Maintain a hand-written, per-surface completeness inventory. Each row links
  the implementation, detailed documentation, localized copy, persistence path
  where relevant, focused test, real built-artifact interaction proof, and real
  capture evidence. A missing, stale, unlocalized, undocumented, untested,
  un-interacted, or uncaptured row fails the delivery gate.
- The inventory explicitly includes the local personal-vocabulary JSON upload,
  app-logo customization, universal local file converter, local Ollama suite
  manager, every-element toy locks and Support Tickets, and browser-extension
  download Start, Downloading, and Download-complete surfaces alongside all
  other canonical features.
- Keep an executable negative regression for the inventory. Deliberately remove
  an exact implementation, registration, article, localized string, focused
  test, interaction proof, or capture record and prove the guard fails; restore
  it and prove the guard passes. A substring or descendant selector is not
  adequate evidence.

## Private local customization and bounded tools

- Every surface owns an always-visible local personal-vocabulary JSON upload
  control. The original wording remains unchanged until a complete user-selected
  file passes the documented bounded schema; parsing, replacement, and caching
  stay local. Do not place mappings, payloads, cache content, source metadata,
  filenames, paths, or user-specific evidence in settings exports, history,
  logs, telemetry, prompts, or repository files.
- Every surface independently provides app-logo presets and a local custom
  upload, with validated bounded local conversion, crop/fit/background choices,
  persistence/reset, and real rendering proof. A custom mark must never change
  an application ID, executable or installer name, update feed, data directory,
  or another stable installed identity.
- Every surface independently provides a real local converter catalog and a
  complete local Ollama suite manager. Enabled converter adapters require
  bundled artifact proof and offline operation; Ollama uses only its documented
  local API, never an arbitrary shell or cloud substitute. Keep unsupported
  capabilities visible with their exact reason rather than simulating success.
- Every rendered element supports its own opt-in toy lock and recovery route.
  The associated Support Tickets surface is a local fictional recovery aid: it
  opens the named application-data folder but never sends data or deletes the
  folder for the user.

## Browser-extension download capture dialogs

- A browser-extension capture opens a real **Start download** dialog before a
  transfer is enqueued. It names the proposed file, source, destination, and
  action that begins the transfer. Confirming starts the same validated queue
  item; cancel leaves the queue unchanged.
- The active transfer has its own IDM-style **Downloading** dialog or real
  secondary progress window. It displays the truthful filename, source,
  destination, transferred bytes, rate, ETA when known, pause/resume/cancel
  state, errors, and completion. Its controls operate the actual transfer
  rather than a simulated row.
- The Start download dialog and non-blocking **Download complete** surface are
  always on top of the originating browser and application windows until the
  user resolves or dismisses them. Topmost behavior must preserve focus,
  screen-reader access, and reduced-motion behavior. Completion never claims
  success before the transfer reaches a successful terminal state.
- Capture the real built artifact through the installed-extension handoff for
  Start, active progress, and completion independently. Source previews, DOM
  injection, mocked IPC, static images, background-only progress rows, and
  non-extension paths are not acceptable evidence. A static site documents its
  closest local equivalent without claiming native extension handoff.

## Documentation and verification

- Keep the README, handoff, roadmap, categorized feature documentation, and
  release-facing notes factual and current.
- Document behavior, configuration, failure modes, security considerations, and
  verification for each shipped feature.
- Do not describe a prototype, mock, simulated network, or unverified package
  as a working release.
- Run the narrowest relevant typecheck, unit test, build, and real-artifact
  smoke test. Report skipped or unavailable checks precisely.
- Never count lines ad hoc when a committed counter exists; keep release
  metadata reproducible from the tagged commit.
- Keep the local Pages source and Chromium extension documentation current with
  the application behavior. A stable installer button or live Pages URL may be
  published only after the immutable release and deployment evidence exists.

## Git handoff completion

- Commit meaningful changes with a concise English subject and a playful,
  natural Hong Kong-style Cantonese body that still states the exact facts.
- Push intended commits after verification, then confirm the remote branch
  contains them. Merge completed task branches into the default branch when the
  repository workflow requires it.
- Prove merged source tips are ancestors of the pushed default branch before
  deleting any task branch or linked checkout. Preserve anything that cannot be
  safely integrated and report why.
- If remote authentication, permissions, branch protection, or CI blocks a
  required step, report the exact blocker and do not claim completion.
- CI and release jobs use the repository's explicitly labelled self-hosted
  runner contract. The Windows release path is Squirrel.Windows and
  intentionally unsigned; it must publish a real non-draft, non-prerelease
  release only after tests, artifact validation, timing, and remote asset proof.

## Product honesty

- Keep real data paths separate from mock or design-only paths.
- Non-blocking information belongs in notifications; reserve blocking dialogs
  for decisions and destructive confirmations.
- Every destructive action must name its exact effect, remain keyboard- and
  screen-reader-operable, support cancellation, and protect unsaved work.
- Do not add third-party tracking or remote assets to a shipped user-facing
  surface. Do not generate or vendor catalog photography in this repository.
