# Universal feature inventory contract

This directory holds the independent, hand-written inventory for every
user-facing surface in this repository:

- `universal-feature-registry.json` is the one canonical list of feature IDs.
- `universal-feature-inventories/desktop.json` covers the Windows desktop
  application.
- `universal-feature-inventories/extension.json` covers the Chromium
  extension.
- `universal-feature-inventories/pages.json` covers the GitHub Pages landing
  and documentation site.

The three inventories deliberately do not share evidence. A desktop
interaction check or capture cannot complete an extension row, and a Pages
article cannot complete a desktop row. Every `surface × feature` record must
remain present even while its implementation is missing.

## What this foundation proves

The canonical registry retains the 35 IDs previously declared by the
Pages-only manifest and adds five separately named mandatory contracts:

1. `personal-vocabulary-upload`
2. `app-logo-customization`
3. `universal-file-converter`
4. `ollama-suite-manager`
5. `every-element-locks`

`tab-locks` remains a distinct legacy contract. `every-element-locks` is
broader: it also covers buttons, fields, labels, cards, menus, dialogs,
notifications, appearance values, and the corresponding local Support Tickets
recovery route. The registry therefore has 40 entries, not a list inferred
from currently discovered source files.

The checker keeps a second, exact 40-ID list in
`scripts/check-universal-feature-inventory.mjs`. This duplication is
intentional: a checker derived only from a registry cannot detect the deletion
of a registry entry.

## Evidence model

Every inventory row resolves all seven evidence kinds. A record may be
`missing`, `unverified`, `partial`, or `implemented`, but an `implemented`
record must include at least one exact evidence anchor.

| Evidence kind | Required proof when a row becomes implemented |
| --- | --- |
| `implementation` | Exact full source line or binary digest for the surface-owned implementation. |
| `documentation` | Exact full line in the dedicated categorized feature article explaining behavior, configuration, failure modes, security, and verification. |
| `localization` | Exact full line in the actual localizable-copy resource or the source-owned copy registration. |
| `persistence` | Exact full line in the versioned storage, cache, vault boundary, or browser-storage implementation. |
| `focusedTest` | Exact full line naming the focused local test or assertion that exercises the row. |
| `builtInteraction` | Exact full line in the real built-artifact interaction harness and its check ID. |
| `capture` | A checked image digest plus source commit, dimensions, target locator, and capture-harness metadata. |

Line anchors pair an exact full line with its one-based line number. They are
never substrings, descendant selectors, or partial symbol names. A renamed or
moved symbol such as `registerThingRenamed` therefore cannot satisfy a record
that asserts `registerThing`. Capture evidence normally uses a SHA-256 anchor;
a fixture may use a text line only to exercise the negative-regression
mechanism without committing an image.

## Completing a row

1. Implement the feature on the surface named by the row. Do not delegate its
   user interface to another app or page.
2. Add or update one dedicated categorized documentation article and the
   surface's localized copy.
3. Add the real persistence boundary, including an explicit reset or recovery
   path where the contract requires one.
4. Add a focused local test with a stable, exact assertion name.
5. Drive the packaged or built artifact through the real interaction harness.
   Static source inspection and dependency injection do not prove a runtime
   bridge.
6. Capture the exact user-facing surface through the sanctioned headless
   route. Record its digest, dimensions, source commit, target locator, and
   harness.
7. Replace the row's unverified evidence profile with its own inline evidence
   object, change every evidence state to `implemented`, and then change the
   row status to `implemented`.
8. Run the structural checker, the deliberate-negative regression, and the
   strict completion gate. The strict gate is allowed to stay red only while
   any row is genuinely incomplete; it must never be bypassed or relabelled
   as success.

Use only neutral control IDs and generic private-cache descriptions for the
personal-vocabulary rows. Do not store a supplied mapping, source filename,
path, payload, cache content, or user-specific evidence in this repository.

## Commands

Run from the repository root:

```powershell
node scripts/check-universal-feature-inventory.mjs
node scripts/test-universal-feature-inventory.mjs
node scripts/check-universal-feature-inventory.mjs --require-complete
```

The first command validates the registry and all surface inventories without
pretending their unfinished rows are complete. The second command copies a
fully implemented fixture and deliberately removes a registry row, renames a
surface row, and renames each of the seven exact evidence anchors. Every
deliberate break must turn the checker red. The final command is the
fail-closed completion gate; it is expected to return nonzero at the current
baseline because the inventories truthfully record outstanding work.

## Current baseline

The baseline is structurally complete—40 required rows for each of the three
surfaces—but it is not a completed product matrix. All rows begin with an
explicit profile rather than inherited proof. The known missing new contracts
include the local personal-vocabulary upload, logo customization, full local
converter, full Ollama suite outside the desktop provider foundation, and
every-element locks plus their Support Tickets recovery surface. The extension
also has no real unpacked-options or popup interaction/capture harness yet.

This distinction is intentional: structural inventory validity can be green,
while the mandatory completion gate stays red until every required
implementation and its evidence actually exist.
