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
- Keep accessibility, keyboard reachability, visible focus, correct roles and
  names, contrast, reduced motion, and narrow-window layout in scope.
- User-facing UI should use Material Design 3 tokens and components, with
  persisted language, appearance, and accessibility settings where the feature
  requires them.

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

## Product honesty

- Keep real data paths separate from mock or design-only paths.
- Non-blocking information belongs in notifications; reserve blocking dialogs
  for decisions and destructive confirmations.
- Every destructive action must name its exact effect, remain keyboard- and
  screen-reader-operable, support cancellation, and protect unsaved work.
- Do not add third-party tracking or remote assets to a shipped user-facing
  surface. Do not generate or vendor catalog photography in this repository.
