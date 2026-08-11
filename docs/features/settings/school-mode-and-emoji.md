# School mode and dialog emojis

## Behavior

The desktop app stores a shared presentation record in its normal local
application-data settings file. The record contains a user-renamable School
mode label, the enabled state, and a persisted **Show emojis in dialogs and
message boxes** choice. The main process owns validation and exposes one
canonical `presentation:get` / `presentation:set` IPC boundary. A successful
change emits `presentation:changed` to both the main application window and the
separate progress window, so an already-running window updates without a
restart.

When School mode is enabled, the renderer uses English and the serious funny
level for all copy, removes the language, bilingual, funny-level, and emoji
controls from Settings and the command palette, clears a pending dim-sum
surprise, and filters playful release/article surfaces from local search and
rendering. The user's language, funny-level, emoji, and mode-name choices stay
in the shared record and become effective again after a valid exit.

The mode name is bounded, normalized, and rendered as text. Resetting the name
returns to `School mode` without changing the application identity, data
directory, installer identity, or update feed. Emoji decoration is never part
of a button label, field label, accessible name, or exported value; the
notification decoration is `aria-hidden`.

## Configuration

Open **Settings → Language**. Rename the mode, enable it, or enable the emoji
switch while School mode is off. The Settings search field and the command
palette each target the exact live control. The shared record is schema version
5 and migrates older profiles conservatively; malformed names and metadata
fall back to the compiled values.

The reset credential is represented only by bounded metadata in settings:
`unavailable`, `unconfigured`, or `configured`, with the provider identified as
the operating-system credential vault. This slice does not add password or
TOTP enrollment. Because an unavailable credential cannot prove an intentional
exit, turning School mode off fails closed and leaves it enabled. The recovery
route is deliberate deletion of the shared local application-data folder; the
app does not claim that this experience lock protects data from another person
with control of the machine.

## Failure modes and security

- Invalid IPC keys, reset lists, names, and booleans are rejected before
  persistence.
- A mutation that would exit School mode without `configured` reset metadata is
  rejected and the previous state remains active.
- A malformed stored credential record becomes `unavailable`; credential
  material is never accepted in the settings patch, renderer state, export,
  history, log, or source tree.
- A renderer that is not one of the two trusted windows cannot read or mutate
  the presentation record.
- Local notifications remain non-blocking. Emoji is decorative and omitted
  while School mode is active.

## Verification

From `design/`:

```powershell
npm run typecheck
npm run build
npm run test:electron
npm run test:engine
```

Focused coverage verifies defaults, schema migration, allowlisted presentation
patches and resets, English/serious effective settings, suppression matching,
manager change events, persistence, and fail-closed School-mode exit. The
renderer build is the real artifact used for the hidden-desktop smoke; the
capture records the Settings surface with the renamed mode and emoji switch.

The source commit for the published captures is
`ecf9bc65e6f78f08e109abfbed5aa897cbdbb86d`. `npm run build` emitted
`index-9-ppiL__.js` (SHA-256
`AB1C07E2AF56D3A24E084D7EA04FAEBBAA11F6A114816B27B2D41A3149B0732B`) and
`index-CL9UO5Fq.css` (SHA-256
`23FF81988A28774B46E99E5FC38739905D813F8E7098D218325B9AC7974A0D45`). The
1150×720 capture with the emoji control visible is
[`school-mode-off-emoji-control.png`](../../screenshots/settings/school-mode-off-emoji-control.png)
(SHA-256 `AAC74504311B2B795C8D8FD479750E938E6FB07C042E643DBAC606B60D9E94A8`),
and the 1150×720 enabled-state capture with the language, funny-level, and
emoji controls removed is
[`school-mode-on-controls-suppressed.png`](../../screenshots/settings/school-mode-on-controls-suppressed.png)
(SHA-256 `60A93B232437B6C9FDE4F38FB9CB6DBD6A554C1FF33204FFCC771EF03E206BED`).
Both files were opened and inspected after capture from the real application;
the temporary profile, process, and hidden desktop were then removed.

## Suggested articles

- [Persisted language and appearance settings](language-and-appearance.md)
- [Non-blocking notification centre](../notifications/notification-center.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)
