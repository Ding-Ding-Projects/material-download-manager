# Auto-organize downloads

## Behavior

Material Download Manager can route a new download into a fixed category
subfolder when the selected destination is the current default save folder.
Classification happens before the task starts, and existing files are never
moved. An explicitly selected non-default folder is always preserved. The
default save folder must be an absolute Windows drive or UNC path; relative,
blank, whitespace-padded, and NUL-containing values are rejected before they
can become live download state.

The six user-selectable destinations are:

| Destination | Stored category | Folder |
| --- | --- | --- |
| General | `other` | `General` |
| Documents | `document` | `Documents` |
| Videos | `video` | `Videos` |
| Music | `music` | `Music` |
| Programs | `apps` | `Programs` |
| Compressed | `compressed` | `Compressed` |

Built-in image detection remains an internal `image` category and also routes
to `General`; it is not a duplicate destination in the custom-rule picker.
Folders are created only when a matching download task begins.

Custom JavaScript regular-expression rules run before the built-in extension
map. Rules are evaluated from top to bottom. For each rule, the sanitized file
name is checked first and the source URL second; the first matching rule wins.
Move up and Move down actions make precedence keyboard-operable. Turning folder
organization off restores the flat default-folder path, while the same rules
continue to classify items for the sidebar. The switch applies only to new
downloads that use the default folder; it does not move or rewrite an existing
download.

## Configuration

Open **Settings**, select **Downloads**, and use **Organize new downloads into
category folders** to control folder routing for future downloads. The six path
rows are live previews derived from the default save folder; when that base is
empty, the UI shows an explicit prompt instead of a fabricated path.

Use **Add document preset**, **Add archive preset**, or **Add blank rule** to
create an ordered custom rule. Each rule has a name, one of the six destination
categories, a bounded pattern, and supported JavaScript RegExp flags. Its
adjacent **Regex builder** is anchored inside that rule card, stays in regex-only
mode, limits patterns to 512 characters, evaluates sample text locally, and
returns focus to the opening control when closed with Escape. The settings
schema stores at most 50 rules with unique stable identifiers. Each rule is an
exact five-field record: `id`, `name`, `pattern`, `flags`, and `category`.
Identifiers are 1–64 characters, unique, and cannot use an inherited
`Object.prototype` name; names are non-blank and at most 64 characters;
patterns are non-empty and at most 512 characters; flags must be supported,
unique, and in canonical order; and `category` must be one of the six visible
destinations. Extra own keys, duplicate identifiers, or the internal `image`
category invalidate the entire rules patch.

The renderer sends only changed editable setting keys across IPC. The main
process validates and clones the patch, stamps persisted provenance only for
accepted changed keys, saves schema version 3, and records the settings change
in local history. An empty patch is a no-op.
A fresh profile reports compiled-in provenance; untouched keys keep their
existing provenance across a schema-v3 reload. Per-setting Reset actions send
only validated setting-key identifiers over a separate trusted boundary; the
main process restores its own compiled value and compiled-in provenance rather
than accepting renderer-authored provenance. Reset all deliberately preserves
the default save folder while restoring every other setting atomically.

Settings search includes the current default folder and switch state, all six
derived destination paths, and every rule's number, name, pattern, flags, and
destination. Plain text remains the default; opt-in regex search uses the same
bounded worker path as the other search surfaces and returns focus to the exact
matching control or path row.

## Failure modes

- Save is disabled while any rule has a blank name or pattern, unsupported or
  non-canonical flags, an invalid expression, a duplicate identifier, an extra
  field, or a destination outside the six-category contract. Each inline error
  is linked only to the name, pattern, category, or whole rule that owns it.
- Schema-v2 rules are migrated individually: the former internal `image`
  target becomes General, only the five known fields survive, blank names get
  deterministic labels, and reserved or duplicate identifiers are rewritten
  deterministically. A recoverable legacy rule cannot erase valid neighbors;
  an irrecoverable rule is discarded rather than executed.
- A pattern that violates the shared backtracking protections is rejected by
  the same validator used by settings IPC and scheduled setting sources.
- When the default save folder is blank, relative, or otherwise invalid, path
  previews remain empty, Save is disabled, and the UI explains that an absolute
  Windows folder is required. No folder is created merely by opening Settings.
- Disabling folder organization never changes an explicit destination folder
  and never retroactively moves an existing download.

## Security

Patterns and sample text are evaluated locally with bounded pattern, sample,
request, and result sizes. Static validation rejects known unsafe repeated
forms, unsupported flags, and invalid syntax. Every desktop user-authored
expression then runs in a terminable main-process worker rather than on the
renderer or Electron event loop. Worker startup has its own 10-second
contention allowance; only after the ready handshake does the one-second
classification deadline begin. A timeout or worker failure kills that worker;
rule classification falls back to built-in extension detection, and
interactive regex surfaces report the failure without using stale results. A
zero-millisecond classification deadline returns the built-in fallback before
starting worker work.

The Add download category preview reaches the same isolated classification
worker through a trusted-sender IPC call. Its file name is bounded to 512
characters, its URL to 8,192 characters, the preload bridge validates the
returned category, and generation checks prevent an older response from
overwriting a newer preview. Final `addDownload()` routing evaluates the rules
again in the main process, so the preview is informative rather than an
authority. Evaluation never fetches the supplied URL, transmits sample text,
or logs a raw source URL. The main process remains the trusted persistence
boundary and does not accept renderer-authored schema or provenance metadata.

Scheduled auto-organize values pass the same exact rule validator. Generic
HTTPS schedule sources resolve every A/AAAA answer in the privileged process,
reject any private, loopback, link-local, mapped, mixed, or non-routable answer,
and pin the accepted address into the actual connection while preserving TLS
hostname verification. Resolution is repeated for every request, so a later
DNS rebinding answer is rejected. Only the explicit Home Assistant route may
use a configured private HTTPS address; bounded loopback HTTP remains a
development-only opt-in.

## Verification

The verification gate covers the setting-key boundary, exact rule shape,
reserved and duplicate identifiers, name and pattern limits, canonical flags,
valid targets, absolute default folders, schema-v3 provenance, legacy
migration, scheduled values, worker timeout recovery, first-match ordering,
preview/final-routing agreement, raw-URL redaction, DNS rebinding rejection,
nested scheduled-rule cloning, and trusted reset provenance.

The built Electron smoke exercises native-keyboard rule reordering, focus after
move and remove, unique accessible control names, field-specific error wiring,
dynamic plain-text and regex settings search, the 512-character guided-builder
bound, real preload/IPC persistence, narrow bilingual layout, contrast, and
touch-target sizing. Final command results and remote evidence remain recorded
in the project handoff rather than being predicted here.

The current gallery was reproduced from source commit
`84da5e1f2b10b6d88e9b946fe1523ad0295ddb2b` after a fresh `npm run build`.
The real hidden-desktop/CDP run passed 43/43 required checks in 13.094 seconds
and captured all seven documented states: six 1100×900 frames plus the
520×760 narrow frame. Every image decodes as a 24-bit PNG, has a unique hash,
and matches the corresponding tracked file byte for byte. The command-palette
capture shows its search field with the adjacent full regex builder; this
documentation refresh adds or changes no search field. The disposable profile,
fixture server, process tree, folder window, and named hidden desktop were
removed after capture. Exact asset and image hashes are recorded in
[`HANDOFF.md`](../../../HANDOFF.md).

Run from `design/`:

```powershell
npm run docs:bundle:check
npm run typecheck
npm run build
npm run test:engine
npm run test:electron
npm run test:ui
```

## Suggested articles

- [Reliable transfers](reliable-transfers.md)
- [Regex builder](../search/regex-builder.md)
- [Persisted language and appearance settings](../settings/language-and-appearance.md)
- [Renderer accessibility](../accessibility/renderer-accessibility.md)
