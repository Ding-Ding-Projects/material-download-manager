# Command palette

## Behavior

`design/src/components/CommandPalette.tsx` provides the global Windows shortcut
`Ctrl+Shift+F`, keyboard navigation, accessible listbox results, inline
destination callbacks, and a dedicated search builder. Palette commands carry
their label, description, keywords, and section so selecting a result can take
the user to the exact feature, setting, tab, group, or appearance editor.

## Configuration

The host supplies the complete command list and an `onSelect` callback for each
real command. The component keeps plain text as the default and uses its own
regex state when the user opts into regex mode.

## Failure modes and security

Invalid palette expressions fail closed with an empty result set. The palette
does not execute a command until the user selects it with Enter or a pointer.
The shortcut is handled locally and does not send query text to a server.

## Verification

Typecheck and the renderer build cover the component's TypeScript and bundling
surface. The shared tab model has focused Node tests; an integration test still
belongs beside the eventual shell wiring.

## Suggested articles

- [Tabbed navigation](tabbed-navigation.md)
- [Regex builder](../search/regex-builder.md)
