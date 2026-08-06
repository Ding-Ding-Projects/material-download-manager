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
without spreading invalid values.

The Settings dialog has its own local search field. Plain text is the default;
the adjacent Regex button opens the shared bounded JavaScript RegExp builder.
Matches name real setting sections and their result buttons return focus to the
corresponding section anchor.

## Configuration

The authoritative defaults and validators are in design/shared/settings.ts.
StateStore migrates state.json, and useAppStore marks changed keys persisted
before the main process saves them. Font stacks use safe installed/bundled
fallbacks and do not fetch remote assets.

## Failure modes and security

Invalid enum, number, or color values fall back to the compiled-in value.
Unknown persisted keys are ignored. Migration never executes persisted text as
code and does not send settings over the network.

## Verification

design/electron/download/__tests__/persistence.test.ts covers defaults,
provenance, legacy migration, malformed input, and round-trip persistence.
Run npm run test:engine, npm run build, and npm run test:electron from design/.

The remaining product-level work is explicit: apply localized/funny copy to
every renderer message, make settings sections real browser-style tabs, and
replace the current color input with the full continuous translator/editor
required by the product policy.

## Suggested articles

- Regex builder: ../search/regex-builder.md
- Tabbed navigation: ../navigation/tabbed-navigation.md
- Renderer accessibility: ../accessibility/renderer-accessibility.md
