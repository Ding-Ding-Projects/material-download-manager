# Personal vocabulary JSON control

## Behavior

The extension Options page always shows a **Personal vocabulary** card in the
Preferences tab. It provides a keyboard-accessible local JSON file picker,
replacement action, status, and clear action. The global settings search indexes
all four controls, and its adjacent anchored regular-expression builder can find
the card without switching away from the settings surface.

The card begins in an explicit no-file state. Until a valid user-selected file
or validated local cache exists, the extension uses its original shipped wording.
Replacing a file validates the entire candidate before changing the active cache;
an invalid candidate leaves the last valid cache active. Clearing is a destructive
action: the extension requires a two-key confirmation plus a full-range slider,
and provides Escape and Cancel as exits before removing the cache and restoring
original wording. The extension never retains the source filename or path.

School mode hides this card and all of its search terms. While School mode is
enabled, the active cache stays locally retained but is not applied. Disabling
School mode restores the prior validated cache without asking the user to select
the file again.

## Neutral JSON contract

The control accepts one local UTF-8 JSON object with exactly these fields:

```json
{
  "schema": "material-download-manager-personal-vocabulary",
  "version": 1,
  "replacements": {
    "Original text": "Approved replacement"
  }
}
```

The generic contract deliberately contains no user-specific vocabulary values.
The extension validates the complete byte payload before caching it:

| Limit | Value |
| --- | ---: |
| File bytes | 65,536 |
| JSON nesting depth | 4 |
| Replacement entries | 256 |
| Replacement key length | 96 characters |
| Replacement value length | 512 characters |

The parser rejects malformed UTF-8 or JSON, duplicate keys, unsafe object keys,
command- or identifier-shaped replacement keys, unexpected fields, unsupported
schema versions, non-string values, excessive depth, excessive entry counts, and
out-of-bound text. Cache data is revalidated against the same canonical byte
limit on every read. A missing, malformed, oversized, or unsupported cache fails
closed to the original extension wording.

## Privacy and security

- Parsing, application, caching, replace, and clear run only in the browser
  extension's local storage. The control makes no network request and needs no
  new host permission.
- The cache is separate from general settings. It is omitted from settings
  export/import, display-name mutation history, handoff records, notifications,
  narration, diagnostics, and runtime message responses.
- Replacement is limited to localized extension template text. URLs, keyboard
  shortcuts, template variables, identifiers, protocol values, paths, and
  user-provided factual values are preserved verbatim.
- The cache is never written to the repository, release archive metadata, logs,
  analytics, or public documentation. This article documents only the neutral
  schema and bounds.

## Failure and recovery

| State | Result | Recovery |
| --- | --- | --- |
| No file | Original wording remains active. | Choose a JSON file. |
| Rejected file | Existing valid cache remains active; no partial update occurs. | Correct the JSON contract and choose it again. |
| Corrupt cache | Original wording remains active. | Choose a valid JSON file or clear the cache. |
| Clear | Cache is purged and original wording returns immediately. | Choose a valid JSON file again if desired. |
| School mode | Cache is retained but not applied. | Leave School mode through its existing reset route. |

## Verification and evidence

`extension/tests/extension.test.mjs` covers valid load, local persistence,
replace rollback, two-key clear confirmation, corrupt/oversized cache, malformed
UTF-8 and JSON, duplicate and unsafe keys, version/size/depth/entry bounds,
School-mode suppression and restoration, template-only replacement, protected
technical text and bare commands, export exclusion, strict runtime-message input,
settings-search inventory, options/popup/worker live-refresh wiring, and an
executable negative inventory check.

Runtime-capture limitation: this task's isolated Chrome extension-manager route
could open the native unpacked-directory picker but did not register the
extension after selection. No synthetic or substitute Options image is published.
The code is covered by the payload-free automated verification above; a future
runtime capture must show the real no-file state without displaying user data.

## Suggested articles

- [Settings foundation](settings-foundation.md) — School mode, language, tone,
  and local settings behavior.
- [Handoff contract](handoff-contract.md) — the bounded local browser-to-desktop
  transfer boundary.
- [Extension authenticator](authenticator.md) — a separate local-storage feature
  with explicit secret-export limits.
