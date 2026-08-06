# Regex builder

## Behavior

The builder uses the JavaScript `RegExp` dialect supplied by Chromium/Electron.
Plain-text search remains the default mode; regex mode is opt-in. The builder
offers raw pattern editing, the supported `g`, `i`, `m`, `s`, `u`, and `y` flags,
guided insertion for literals, character classes, anchors, groups, alternation,
and quantifiers, sample text, live matches, capture groups, copy, and JSON
export.

Evaluation stays local. Patterns are limited to 2,048 characters, samples to
100,000 characters, and the displayed result set to 200 matches. Zero-width
matches advance safely so a pattern cannot loop forever in the renderer. The
builder rejects nested quantifiers inside a repeated group, including
`^(a|a?)+$`, before synchronous JavaScript evaluation because the engine has no
portable regular-expression timeout.

The toolbar keeps the raw query exactly as typed, including leading, trailing,
or whitespace-only patterns. Invalid regex searches fail closed and expose the
engine error beside the field with an accessible error description.

## Configuration

The reusable renderer component is
`design/src/components/RegexBuilder.tsx`; its shared engine is
`design/shared/regex.ts`. Search surfaces should keep their own builder state,
use plain text until the user opts into regex mode, and apply the resulting
pattern and flags to that same field.

## Failure modes and security

Invalid syntax and unsupported flags are reported inline without evaluating the
sample. Input is bounded before compilation. Patterns and sample text remain in
the local renderer and are not sent to a server or written to logs.

The nested-quantifier guard is intentionally conservative. A rejected pattern
can be rewritten into bounded or simpler alternatives; the product must not
silently run an unbounded expression in the UI thread.

## Verification

`design/electron/__tests__/regex.test.ts` covers literal escaping, captures,
zero-width matches, invalid and adversarial patterns, result bounds, and valid
guided fragments. Run:

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
