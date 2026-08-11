# Spoken narrator

## Behavior

The extension's spoken narrator is off by default and is enabled from the
options page. Production event speech is owned by the Manifest V3 service
worker through Chrome's local `tts` API, so automatic-download and handoff
events can be narrated even when the popup or options page is closed. The
worker queue is the only production speech queue; each call sets
`enqueue: false` so Chrome does not create a second hidden queue.

Narration settings are persisted in the existing sanitized settings record:

- `narratorEnabled` — opt-in switch, default `false`;
- `narratorLanguage` — `en`, `yue`, or `both` (English followed by Cantonese);
- `narratorSoundMode` — `normal`, `reduced`, or `muted`;
- `narratorQuietMode` — an immediate local mute switch; quiet-hours schedules
  are deliberately outside this slice; and
- `narratorRespectReducedMotion` — a conservative preference that suppresses
  speech when the host supplies a reduced-motion signal; and
- `narratorReducedMotionActive` — the last bounded media-query observation made
  by the options page. The service worker also accepts an injected host signal
  in tests, but it does not invent one when the browser does not expose it; the
  observation is intentionally omitted from settings exports.

Each event waits 250 ms before starting. A pending event is replaced by the
latest pending event, and category cooldowns prevent a burst of duplicate
status speech (progress 30 seconds, informational 10 seconds, success or
warning 5 seconds, and errors 0 seconds). Pending errors take priority over
new non-error status speech. One active utterance runs at a time. Both-language
events use two immutable segments and advance only after the English segment's
final event. Late `end`, `interrupted`, `cancelled`, or `error` callbacks from
an older queue generation cannot advance a newer event.

Funny-level settings style voice rate and pitch only; the localized message
facts, affected data, and recovery choices remain unchanged. The narrator maps
result codes to allowlisted localization keys and never speaks raw result
details, URLs, query strings, filenames, selection text, capabilities, or
credentials. The adapter enumerates available voices, rejects `remote: true`
voices, requires final-event support, and requires an exact `zh-HK`/`yue`
locale for the Cantonese segment. It does not silently claim a Mandarin voice
is Cantonese.

## Configuration and recovery

Use **Test narration** after enabling the narrator and choosing a language.
If the browser has no final-event TTS support, narration stays unavailable and
the on-screen options status remains the recovery surface. Turning the
narrator off, selecting Quiet mode, or selecting Muted stops active speech and
clears pending work without changing the persisted handoff result or blocking
downloads.

The popup and options surfaces do not own a second production speech queue.
They can display the localized status and send the user-initiated test request
to the service worker. A worker restart does not replay the persisted
`lastResult`; only newly recorded events are eligible for narration.

Chrome does not expose a portable screen-reader-active signal to this service
worker. The narrator therefore does not claim that it can detect or duck an
assistive technology in production; the testable signal hook is reserved for a
future trusted host bridge. Users can always use Quiet mode or Muted sound,
and visible on-screen messages remain authoritative.

## Security and privacy

- Chrome's `tts` permission is the only new manifest permission.
- No audio asset, remote voice service, analytics, or arbitrary host access is
  added.
- Narration text is derived from local allowlisted localization keys.
- Narration failures are swallowed at the worker boundary so handoff,
  settings persistence, and browser-download recovery remain authoritative.
- The narrator is a user-experience aid, not a security boundary.

## Verification

From `extension/`:

```powershell
npm test
```

The focused tests cover opt-in defaults, language and funny-level parts,
serialized English-then-Cantonese speech, debounce, cooldown, replacement,
generation-safe late events, quiet/muted/reduced-motion/screen-reader
suppression, Chrome TTS final-event handling, manifest permission scope,
allowlisted worker wiring, and localized options controls.

## Suggested articles

- [Settings foundation](settings-foundation.md) — shared settings, School
  mode, emoji preference, and redacted display-name history.
- [Handoff contract](handoff-contract.md) — automatic capture and failure
  recovery events that can be narrated.
- [Electron integration seam](electron-integration-seam.md) — the trusted
  desktop boundary behind the local handoff.
