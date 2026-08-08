# Persisted language and appearance settings

## Behavior

The settings schema provides exactly English, playful Hong Kong-style
Cantonese, and compact bilingual modes. English and Cantonese each have an
independent funny-level slider from 1 through 5. The settings disclosure states
that funny styling applies to every message, including errors and warnings,
while facts and next steps remain exact.

Theme, density, accent seed color, UI font family, font size, and weight are
validated at the persistence boundary, applied live through CSS variables, and
shown with provenance indicating persisted or compiled-in values. Each listed
setting has a reset control; the schema is versioned and legacy state migrates
without spreading invalid values. Schema version 3 starts every untouched
default as compiled-in, marks only an accepted mutation key as persisted, and
preserves a valid per-key provenance map across reloads.
Reset uses a separate allowlisted key list: the main process supplies the
compiled value and compiled-in provenance itself. Resetting a value that already
equals the default still clears a prior persisted override; Reset all preserves
the current default save folder and restores every other setting in one local
history revision.

The Settings dialog has its own local search field. Plain text is the default;
the adjacent Regex button opens the shared bounded JavaScript RegExp builder.
The dialog is divided into four browser-style tabs—Language, Appearance,
Downloads, and Advanced—with one independent search and regex-builder state per
tab. The active tab is persisted. Matches name real setting sections and their
result buttons return focus to the corresponding actual control. Closed
advanced settings are opened before the target control receives focus. The
nested builder consumes Escape to close only itself and returns focus to the
Regex button, leaving Settings open. Custom checkbox buttons expose their
checked state through `role="checkbox"` and `aria-checked`.

The Downloads tab also exposes future category-folder paths and an ordered
custom-classification rule editor. Each rule owns an anchored regex-only
builder, keyboard Move up/Move down actions, inline validation, and Escape
focus restoration. The Settings search index includes live folder, switch,
derived-path, and rule values rather than only static labels. Invalid rules
disable Save; each error describes only the name, pattern, destination, or
whole rule that owns it.

Rule cards form a named ordered list. Inputs, destination selectors, builder
buttons, move controls, and remove controls include their rule number in the
accessible name. Reordering keeps focus on a valid move control for the moved
rule and announces its new position; removal returns focus to the next or
previous rule, or to Add when the list becomes empty.

The dialog's outer layout uses non-interactive containers around reset and
action controls, so controls are never nested inside a form label. At a 520
CSS-pixel viewport the field and funny-level grids collapse to one column and
the smoke check rejects horizontal overflow.

## Configuration

The authoritative defaults and validators are in `design/shared/settings.ts`.
`StateStore` migrates `state.json`. The renderer sends only editable setting
keys, the main process validates and clones accepted values, and persistence
updates provenance per accepted key. The default save folder must be an
absolute Windows drive or UNC path. Font stacks use safe installed/bundled
fallbacks and do not fetch remote assets.

Schema-v2 settings preserve valid provenance while migrating to v3. Recoverable
legacy auto-organize rules are canonicalized one by one, including deterministic
name/identifier repair and `image` to General mapping, so one old rule cannot
erase unrelated valid rules.

## Failure modes and security

Invalid enum, number, color, folder, or exact-shape rule values fail validation
or fall back safely during migration. Unknown persisted keys are ignored.
Migration never executes persisted text as code and does not send settings over
the network. User-authored settings-search and rule-builder expressions run in
terminable main-process workers rather than on the renderer event loop.

## Verification

The verification gate covers defaults, per-key provenance, legacy migration,
malformed input, exact rule shape, absolute folder paths, dynamic plain-text
and regex search, the anchored worker-backed builder, native keyboard reorder,
move/remove focus, field-specific error association, interactive-label
structure, contrast, and narrow bilingual layout. Run `npm run test:engine`,
`npm run build`, `npm run test:electron`, and `npm run test:ui` from `design/`.
Final command results and remote evidence belong in the project handoff.

The remaining product-level work is explicit: apply localized/funny copy to
every renderer message and replace the current color input with the full
continuous translator/editor required by the product policy.

## Suggested articles

- Regex builder: ../search/regex-builder.md
- Tabbed navigation: ../navigation/tabbed-navigation.md
- Renderer accessibility: ../accessibility/renderer-accessibility.md
- Auto-organize downloads: ../download-engine/auto-organize-downloads.md
