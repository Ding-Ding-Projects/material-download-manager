# Regex builder

## Behavior

The builder uses the JavaScript `RegExp` dialect supplied by Chromium/Electron.
Plain-text search remains the default mode; regex mode is opt-in. The builder
offers raw pattern editing, the supported `g`, `i`, `m`, `s`, `u`, and `y` flags,
guided insertion for literals, character classes, anchors, groups, alternation,
and quantifiers, sample text, live matches, capture groups, copy, and JSON
export.

Classification-rule cards reuse the same component in a fixed-regex mode. That
variant removes the plain-text choice, applies the rule schema's 512-character
pattern limit, localizes its controls, and canonicalizes flag order after every
toggle so a visually valid rule cannot be rejected at the IPC boundary.

Evaluation stays local. Patterns are limited to 2,048 characters, each sample
to 100,000 characters, each IPC batch to 50,000 samples and 5,000,000 aggregate
sample characters, and the displayed result set to 200 matches. Zero-width
matches advance safely. Static validation rejects known unsafe nested,
ambiguous-alternative, and overlapping sequential quantifier forms before any
match begins. Collection-filter batches return only a boolean match sentinel;
they never clone sample text, match text, or captures back across IPC. Full
match details accept exactly one sample, at most 100 capture groups, and at
most 64,000 aggregate capture code units.

Every desktop user-authored expression is then sent through a trusted-sender
IPC call to a terminable main-process worker. A separate ready handshake allows
up to 10 seconds for cold startup under host contention; only then does the
500 ms evaluation deadline begin. The renderer never runs a user pattern
synchronously. A timeout or worker failure terminates the worker, returns a
bounded error result, and creates a fresh worker for the next request.
Generation checks prevent a late result for an older query from replacing the
current result. Auto-organize classification uses a separate worker with the
same startup contract and a one-second evaluation deadline; its Add download
preview crosses bounded IPC and final routing evaluates again in the main
process. Collection searches, History, and Changelog expose worker timeouts and
failures beside their own search field instead of silently presenting an empty
list.

The toolbar keeps the raw query exactly as typed, including leading, trailing,
or whitespace-only patterns. Invalid regex searches fail closed and expose the
engine error beside the field with an accessible error description.

## Configuration

The reusable renderer component is
`design/src/components/RegexBuilder.tsx`; its shared engine is
`design/shared/regex.ts`. The renderer hook is
`design/src/hooks/useIsolatedRegex.ts`; main-process execution is owned by
`design/electron/regex/RegexWorkerClient.ts`. Search surfaces should keep their
own builder state, use plain text until the user opts into regex mode, and
apply the resulting pattern and flags to that same field.
Callers with a regex-only data contract provide `fixedRegex`, the applicable
`patternMaxLength`, and the surface's language-aware text function.

## Failure modes and security

Invalid syntax and unsupported flags are reported inline without evaluating the
sample. Input is bounded before compilation. Patterns and sample text cross
only the local context-isolated preload/main-process boundary; they are not
sent to a network service, persisted, or written to logs.

The static backtracking protections are intentionally conservative. A rejected
pattern can be rewritten into bounded or simpler alternatives. The worker
deadline is the final safety boundary for dangerous forms the static checks do
not recognize.

## Verification

The verification gate covers literal escaping, captures, zero-width matches,
invalid and adversarial patterns, IPC and result bounds, timeout termination,
post-timeout recovery, guided-fragment limits, canonical flag normalization,
concurrent cold startup, match-only response size, full-result capture limits,
and stale-result rejection. The built Electron smoke also exercises the
rule-specific fixed mode, synchronized flags, accessible error state, the
512-character guided-insertion boundary, and Escape focus return. Run:

```powershell
cd design
npm run typecheck
npm run build
npm run test:electron
```

## Suggested articles

- [Project handoff](../../../HANDOFF.md) — current production boundaries.
- [Application build](../../../design/README.md) — local build and test entry
  points.
- [Auto-organize downloads](../download-engine/auto-organize-downloads.md) —
  regex-only rule-builder behavior.
