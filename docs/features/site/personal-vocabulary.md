# Personal vocabulary

## Behavior

The Pages Settings tab includes a visible, keyboard-accessible local JSON
control for private wording changes. It is present before a file is selected
and exposes a generic no-file status, choose, replace, and clear actions. The
native file input is visually hidden behind real buttons and is reset as soon
as a selection is read, so the page never displays or retains a local file
name.

When a complete record passes validation, its replacement strings apply only
at the site's user-facing copy boundary. Commands, URLs, identifiers, source
article paths, factual release metadata, exports, history, notifications, and
other non-copy values remain unchanged. Clear immediately removes the local
cache and restores shipped wording.

School mode omits the picker, status, replace and clear controls; removes the
feature from Settings search results, the command palette, the feature
catalogue, article routes, and About links; and bypasses private replacements.
It keeps the last valid cache untouched so that turning School mode off can
restore the local wording without asking for the file again.

## Configuration

The one neutral contract uses schema version `1` with exactly two root fields:
`schemaVersion` and `replacements`. The site does not distribute a sample,
template, built-in mapping, source filename, source path, or private default.

The validator enforces all of these limits before showing or caching anything:

| Boundary | Limit |
| --- | ---: |
| UTF-8 input bytes | 65,536 |
| JSON nesting depth | 3 |
| JSON nodes | 1,024 |
| replacement entries | 128 |
| source-key UTF-8 bytes | 96 |
| replacement-value UTF-8 bytes | 384 |
| rendered-copy UTF-8 bytes | 32,768 |

Only string replacements are accepted. Empty replacement values are allowed;
empty source keys are not. The validated cache is a separate local browser
record, not part of ordinary settings, notification history, local version
history, or any export.

## Failure modes and recovery

Malformed UTF-8, malformed JSON, duplicate keys, unknown root fields,
unsupported schema versions, unsafe object keys, unsupported nested values,
oversized input, and bound exhaustion are rejected as a whole. A rejected new
selection does not partially apply and does not overwrite the last valid cache.

On startup and cross-tab storage updates, the cache is revalidated. A missing,
corrupt, stale, or unsupported cache fails closed to shipped wording. If browser
storage is unavailable, a valid selection remains active only until the current
tab closes, and the status says so. Selecting **Clear local JSON** is the reset
route: it purges the local cache immediately and restores shipped wording.

## Security and privacy

This feature is local-only. Parsing, validation, replacement, and storage do
not make a network request. The page never writes local file names, paths,
payloads, cache contents, mappings, or user-specific evidence to source,
exports, history, notifications, diagnostics, logs, analytics, prompts,
captures, or public records.

The parser detects duplicate keys before building an accepted record and
rejects unsafe object keys. It uses a bounded strict JSON parser rather than
trusting a file extension, MIME value, or ordinary JSON parsing alone. The
renderer performs bounded literal replacement on user-facing text only; it does
not interpret supplied text as HTML, script, regular expressions, URLs, or
commands.

## Verification

Run the local Pages checks from the repository root:

```powershell
npm --prefix site run check
npm --prefix site run build
```

The focused check covers the empty control, strict byte decoding, malformed and
duplicate-key input, all schema and size bounds, no partial application, cache
revalidation, replace and clear paths, no-network/source guards, Settings and
palette search anchors, all language copy keys, School-mode omission and
restoration, keyboard-accessible controls, narrow layout selectors, and exact
negative fixtures. It also validates the genuine built no-file capture by
signature, dimensions, and SHA-256 after that evidence is recorded.

## Capture evidence

The real built-site capture is intentionally limited to the generic no-file
state. It does not contain a local filename, mapping, payload, cache contents,
or user-specific wording. The final image path, source commit, dimensions, and
SHA-256 are recorded in this article, the Pages README, and the universal
coverage inventory once the capture is produced.

## Suggested articles

- [Landing and documentation site](./landing-and-documentation-site.md)
- [Language and appearance settings](../settings/language-and-appearance.md)
- [Regex builder](../search/regex-builder.md)
- [Universal feature coverage](./universal-feature-coverage.md)
