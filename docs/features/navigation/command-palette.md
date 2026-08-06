# Command palette

## Behavior

`design/src/components/CommandPalette.tsx` provides the global Windows shortcut
`Ctrl+Shift+F`, a modal overlay with focus trapping and opener restoration,
keyboard navigation, accessible combobox/listbox linkage, inline destination
callbacks, and a dedicated search builder. Palette commands carry their label,
description, keywords, and section so selecting a result can take the user to
the exact feature, setting, tab, group, or appearance editor. The production
registry includes every visible toolbar action and derives queue actions from
the active queue; Language mode and Appearance results focus their actual
Settings controls.

## Configuration

The host supplies the complete command list and an `onSelect` callback for each
real command. The component keeps plain text as the default and uses its own
regex state when the user opts into regex mode.

## Failure modes and security

Invalid palette expressions fail closed with an empty result set and an inline
error. Raw search text is preserved, including whitespace. The palette does
not execute a command until the user selects it with Enter or a pointer, and
Escape works from the nested builder as well as the main field. The shortcut
is handled locally and does not send query text to a server.

## Verification

Typecheck and the renderer build cover the component's TypeScript and bundling
surface. The cheap hidden-desktop smoke verified the modal role, focus on the
search field, live command rows, Settings Appearance focus intent, and Escape
from the nested builder. The shared tab model has focused Node tests; a
dedicated DOM test harness still belongs beside the eventual shell wiring.

## Suggested articles

- [Tabbed navigation](tabbed-navigation.md)
- [Regex builder](../search/regex-builder.md)
