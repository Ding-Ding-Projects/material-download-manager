# Scheduled settings

## Behavior

The desktop Settings → Downloads surface stores versioned schedule records in
the shared local application-data state. Each record has a stable identifier,
label, enabled state, integer priority, optional inclusive start/end dates,
inclusive start/end local times, one or more weekdays, an IANA timezone, and a
data-only source definition.

The editor uses native date and time controls and an explicit weekday chooser.
**Every day** selects all seven weekdays. A window whose end time is earlier
than its start time is a cross-midnight window and continues into the following
local date. Date and time boundaries are inclusive. The selected timezone is
shown beside the controls; daylight-saving transitions follow the platform's
timezone rules rather than a hidden fixed offset.

When more than one enabled record matches, the highest priority wins for a
setting key. Equal priorities use the stable record identifier as a
deterministic tie-breaker. Lower-priority records fill values that the winning
record does not specify. The base settings remain unchanged when no rule
matches or when a source refresh fails.

## Configuration

Open **Settings → Downloads → Scheduled settings**. Add a record, choose its
date/time window, weekdays, timezone, priority, and source, then select **Save
schedules**. Local sources expose bounded theme and density overrides in this
foundation. Versioned HTTPS API sources carry only a credential-free URL;
responses are resolved through the existing main-process schedule resolver.
Home Assistant sources carry only a credential-free base URL, a boolean entity
(`binary_sensor.*` or `input_boolean.*`), and bounded settings. The future
credential provider is a main-process operating-system-vault seam; this editor
cannot enter, display, persist, export, or log an access token.

Loopback HTTP is available only as an explicit local-development checkbox and
is bounded to loopback hosts. Public API URLs must use HTTPS without embedded
credentials, query secrets, or fragments. Home Assistant may use a configured
private HTTPS host because it is an explicitly selected local source; its entity
path remains constrained to boolean entities.

## Failure modes and security

- Malformed records, duplicate identifiers, invalid dates/times, reversed date
  ranges, empty weekdays, invalid timezones, and unsupported source fields are
  rejected at the main-process IPC boundary.
- API URLs are checked for HTTPS, credentials, query strings, fragments,
  redirects, private targets, bounded response sizes, and bounded timeouts by
  the existing resolver. HTTP is accepted only for the explicit loopback
  development route.
- Home Assistant metadata has no token field. The main process obtains a token
  from the operating-system credential vault only when a future resolver call
  needs it, and the resolver never returns it in its result.
- A failed state write restores the previous schedule set. A malformed stored
  schedule set is discarded while the rest of the application state loads.
- Every successful schedule mutation is included in the local Git-backed state
  snapshot history. Secrets are not part of schedule records, settings files,
  exports, logs, or history snapshots.

## Verification

From `design/`:

```powershell
npm run typecheck
npm run build
node --test --test-timeout=30000 dist-electron/electron/__tests__/scheduledSettings.test.js
node --test --test-timeout=60000 dist-electron/electron/download/__tests__/scheduleSources.test.js
npm run test:electron
npm run test:engine
npm run test:ui
```

The focused schedule suite covers record validation, token-field rejection,
timezone and inclusive boundary semantics, cross-midnight windows, deterministic
priority resolution, state persistence and malformed-state recovery, manager
history snapshots, and unsafe external-source rejection. The resolver suite
covers HTTPS/loopback validation, bounded API responses, redirect rejection,
Home Assistant boolean state, missing credentials, private Home Assistant
HTTPS, and stale refresh cancellation.

The Settings surface is covered by a real built-artifact capture when the
desktop smoke is run. The capture must come from the renderer and Electron
build produced by the same source commit; a design mock or static fixture is
not evidence. The current branch capture is
[`scheduled-settings.png`](../../screenshots/settings/scheduled-settings.png),
a 524 × 738 PNG with SHA-256
`471166F2C1DBBF3BDDD48603DBF5A4D573E60EDD9032B8E904D5727DF337E4C6`.

## Suggested articles

- [Persisted language and appearance settings](language-and-appearance.md)
- [Local version history](../history/local-version-history.md)
- [Automatic updates](../updates/squirrel-windows.md)
