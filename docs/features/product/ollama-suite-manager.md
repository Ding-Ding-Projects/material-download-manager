# Local Ollama suite manager

## Behavior

The desktop Settings surface and `Ctrl+Shift+F` command palette expose a local
Ollama suite destination. This first foundation deliberately covers provider
records and installed-model metadata only. It does not pretend to ship the
exhaustive online catalog, chat, attachments, or harness launch described by
the broader product contract; those states remain visibly unavailable instead
of becoming fake controls.

## Provider boundary

Provider records contain a user label, a generated local identifier, and a
credential-free HTTP(S) endpoint restricted to `localhost`, `127.0.0.1`, or
`::1`. URL userinfo, query strings, fragments, paths, redirects, and cloud
hosts are rejected. The record carries only OS-credential-vault metadata; no
API key or token is accepted by the renderer, settings file, export, history,
logs, or source tree.

The provider/model list is intentionally a bounded foundation rather than a
complete universal list surface: its Settings tab has the tab-local search and
regex builder, but per-row search, selection/inverse selection, bulk actions,
and every-format file export remain follow-up work. JSON clipboard transfer is
the only shipped metadata transfer path and reports clipboard failures.

Refreshing calls only `GET /api/tags` through the main process. The request has
a 1,500 ms timeout, rejects redirects, bounds the response at 1 MiB, validates
the JSON shape, and records each installed model's name, digest, size,
timestamp, and API-reported detail fields. A failed refresh preserves the last
verified inventory and reports the localized failure.

## Metadata transfer and failure modes

The JSON metadata envelope is stored with mode `0600` under the app's local
application-data directory and written through a temporary file plus rename.
Exports state their schema and explicitly omit credentials, the cloud catalog,
and chat history. Imports validate the schema, provider references, model
limits, and duplicate identifiers before replacing local metadata. Empty state,
unavailable endpoint, malformed response, timeout, oversized response, and
duplicate-provider states each have an honest in-app message and remain
non-blocking.

## Accessibility and localization

The panel is a real Settings tab with its own search field and anchored regex
builder. Controls use native labels, buttons, live status/error regions, focus
order, and the existing destructive-action super-confirmation gate for
provider removal. Copy runs through the existing English, playful Hong Kong
Cantonese, and bilingual modes; both per-language funny sliders style the
surrounding copy without changing endpoint, model, count, or failure facts.

## Verification

- `design/electron/__tests__/ollamaSuite.test.ts` covers loopback validation,
  metadata parsing, local API refresh, bounded persistence, secret exclusion,
  export/import, and malformed envelopes.
- `npm run typecheck`, `npm run build`, compiled Electron tests, documentation
  bundle checks, and the built UI smoke are the required local checks for this
  slice.
- A built Settings capture is required before integration when the cheap hidden
  route is available; if the route is unavailable, the handoff records that
  evidence boundary rather than claiming a visual verification.

The real built Settings capture is [`ollama-suite-settings.png`](../../screenshots/product/ollama-suite-settings.png), 524×558 pixels, SHA-256
`CFA365286EFF01ED73E07DCCFF0B2DC2DFB7B44F4C17DD1AD20A48B1F9A91024`.
The capture shows the Local Ollama tab, loopback provider form, honest
unavailable-surface disclosure, empty inventory, and the existing notification
surface in the built application.

## Suggested articles

- [Regex builder](../search/regex-builder.md)
- [Record export](../export/record-export.md)
- [Local version history](../history/local-version-history.md)
- [Scheduled settings](../settings/scheduled-settings.md)

[Back to product features](./README.md)
