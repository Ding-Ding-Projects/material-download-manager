# Site control filters and menu regex builders

## Behavior

The Pages documentation surface gives each native setting selector and the tab
context menu its own local, plain-text-first filter. The selector remains backed
by the same setting change path as before: choosing a result updates the native
value, dispatches its ordinary change event, persists through the existing
browser settings record, and immediately updates the rendered surface.

Each filter has a directly adjacent, anchored full JavaScript `RegExp` builder.
The builder offers raw patterns, supported flags, guided tokens, sample text,
live matches and capture groups, copy, and JSON export. Plain text remains the
default. A selector or menu never borrows hidden query state from another
surface.

### Theme selector

The theme picker filters the three available appearance modes locally and
returns focus to its trigger after a selection or close. The selected result
uses the same `theme-setting` change handler as the original control.

### Appearance target selector

The target picker filters Cards, Tabs, Notifications, and Hero locally. Its
selection controls which persisted per-surface appearance record the editor
reads and writes.

### Appearance spacing selector

The spacing picker filters Comfortable, Tight, and Airy locally. Its selection
changes a bounded per-target spacing factor that the selected Cards, Tabs,
Notifications, or Hero surface actually consumes at runtime.

### Notification filter selector

The notification view picker filters its own view choices locally. Selecting a
view keeps the existing local notification-history filtering and persistence
behavior; it does not send history or queries anywhere.

### Tab context menu

The tab context menu focuses its local action filter when opened. Arrow keys
move through the currently visible menu items, Enter activates the focused
action, and Escape first clears an active filter and then closes the menu while
returning focus to the originating tab. Shift+right-click opens the selected
tab's appearance editor directly. Pinning writes the browser-local settings
record, so a pinned tab remains pinned after reload.

### Appearance rendering

Appearance overrides are rendered through exact CSS readers: cards consume card
accent, radius, and spacing; tabs consume tab defaults plus per-tab overrides;
notifications consume their accent, radius, and spacing; and the Hero surface
consumes its accent, radius, and spacing. A saved value is not presented as a
working preference unless a rendered CSS reader uses it.

### Keyboard activation repair

Tab-discovery results are semantic buttons rather than click-only containers.
They preserve the same destination action, work with Enter and Space through
native button behavior, expose an accessible destination name, and retain the
visible focus treatment.

## Keyboard and accessibility

Opening a selector focuses its own local filter. Arrow Down and Arrow Up move
from the filter through matching options; Home and End move to the first and
last option; Enter selects the first current match from the filter; and Escape
clears an active query before closing on the next press. The result count and
no-match state are announced through each control's own live status region.
The menu and selectors are viewport-bounded, scroll internally when needed,
respect reduced motion, remain usable at narrow widths, and keep their visible
labels under English, Cantonese, bilingual, and School-mode presentation.

## Failure modes and privacy

Invalid or bounded-out regex expressions fail closed and show their validation
state beside the control. A no-match state leaves the setting unchanged and
does not hide a menu action's keyboard shortcut or alter the action's meaning.
All option filtering, regex evaluation, selection, and settings persistence
stay in the local browser. No query, setting, or notification record is sent to
a network service.

## Verification

`site/data/interactive-controls-contract.js` is the hand-written per-surface
inventory for these four selectors, the tab menu, appearance readers, and tab
discovery activation. `site/check.mjs` validates the exact implementation,
documentation, registration, test, interaction, and capture anchors. Its
negative fixtures remove every exact source anchor and every named built PNG
capture in memory; each removal must fail before the real source is accepted.

Run:

```powershell
npm --prefix site run check
npm --prefix site run build
```

The built-site captures below come from the locally built Pages artifact on an
isolated headless desktop. They show plain-text-first filtering switched to
Regex mode, an exact one-result count, the anchored builder, and the relevant
control surface:

| Surface | Real built-artifact capture |
| --- | --- |
| Theme selector | [`interactive-controls-theme-picker.png`](../../screenshots/site/interactive-controls-theme-picker.png) |
| Appearance target selector | [`interactive-controls-appearance-target-picker.png`](../../screenshots/site/interactive-controls-appearance-target-picker.png) |
| Appearance spacing selector | [`interactive-controls-appearance-spacing-picker.png`](../../screenshots/site/interactive-controls-appearance-spacing-picker.png) |
| Notification filter selector | [`interactive-controls-notification-filter-picker.png`](../../screenshots/site/interactive-controls-notification-filter-picker.png) |
| Tab context menu | [`interactive-controls-regex-menu.png`](../../screenshots/site/interactive-controls-regex-menu.png) |

The interaction record also verifies arrow, Enter, Escape, focus return, and
the rendered Tab appearance accent/radius/spacing readers. The handoff records
the exact commit and headless capture method.

## Suggested articles

- [Regex builder](regex-builder.md) — JavaScript regex behavior and bounds.
- [Landing and documentation site](../site/landing-and-documentation-site.md) —
  local-site scope and publication boundary.
- [Universal feature coverage](../site/universal-feature-coverage.md) — the
  wider Pages completeness inventory.
