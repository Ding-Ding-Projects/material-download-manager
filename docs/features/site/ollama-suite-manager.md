# Browser-local Ollama suite manager

## Behavior

The Pages source independently ships a browser-local Ollama suite inside the
Features surface. It is not a link to the desktop application and does not
delegate its runtime, installed-tag browsing, model pull queue, chat, local
history, or browser-only harness to another product.

The suite accepts only the documented local HTTP API at one of these
credential-free origins:

- `http://127.0.0.1:11434`
- `http://localhost:11434`
- `http://[::1]:11434`

It calls only these fixed API routes: `/api/version`, `/api/tags`, `/api/ps`,
`/api/show`, `/api/pull`, `/api/delete`, `/api/copy`, and `/api/chat`. The page
does not accept arbitrary hosts, paths, redirects, userinfo, query strings,
cloud endpoints, credentials, commands, scripts, executable paths, working
directories, or environment expansion.

The Runtime tab reads the local version, installed tags, and running tags.
The Model Store combines that installed-tag inventory with an optional local
catalog snapshot. The Batch Pull tab treats its cart only as a queue of local
Ollama pulls: it has no price, account, checkout, payment, subscription, or
cloud entitlement semantics. The Chat tab streams local `/api/chat` responses
to an installed tag, supports a bounded local session history, editable system
prompt, temperature and context controls, stop, retryable new sessions,
rename, confirmed deletion, and redacted export.

The Harness tab contains allowlisted browser-only profiles for health,
inventory, chat-readiness, and model inspection. They can call only the fixed
local routes above. A static page cannot start Ollama, launch another program,
read a host executable list, inspect an environment, use an operating-system
credential vault, or manage a process. That boundary is rendered before a
profile runs and a failed preflight restores its local selection.

## Catalog and hardware-fit boundary

`/api/tags` is exhaustive for installed local tags when a refresh succeeds.
There is no safe way for a static browser page to authenticate and paginate the
complete official catalog without a locally mediated catalog service. The
Model Store therefore exposes that catalog as unavailable until the user
selects a local JSON snapshot with all of the following exact fields:

- schema version `1` and kind `official-catalog-snapshot`;
- a source revision, refresh timestamp, and positive page count;
- `complete: true`;
- unique, bounded variant/tag records with a family, description, exact blob
  size, optional parameter and quantization metadata, and capabilities.

The parser rejects duplicate JSON keys before parsing, unknown fields,
unsupported versions, unsafe tags, incomplete snapshots, malformed data, and
oversized input. A locally valid snapshot is still labelled as unauthenticated
provenance: this static page never claims it has proved the upstream source or
invented a missing model.

Fit evidence is conservative. It combines a model's verified blob size with
current local `/api/ps` data, browser storage estimates, and the browser's
coarse `deviceMemory` signal only when those signals exist. The outcome is one
of **Runs well**, **Runs with limits**, **Unlikely**, or **Unknown**, and the
row shows the evidence and assumptions. The page does not claim access to the
host's exact free disk, GPU model, usable VRAM, driver, backend support, or a
performance benchmark. Missing evidence remains **Unknown**.

## Configuration and persistence

All suite records stay in browser storage under
`mdm-site-ollama-suite-v1`. The persisted schema is versioned and bounded. It
contains the allowed endpoint, a validated runtime cache, the optional catalog
snapshot, local pull-cart state, up to eight local chat sessions, registered
allowlisted profiles, and redacted operation history. The source filename,
file path, attachment bytes, credentials, raw API bodies, environment values,
and host paths are not persisted.

Each local list has its own plain-text-first search. Its adjacent anchored
JavaScript regular-expression builder owns its own query, pattern, flags,
validation, sample, live matches, capture groups, copy action, and JSON export.
The Model Store, Batch Pull, Chat sessions, Harness profiles, and local history
do not share hidden search state. The suite uses keyboard-reachable tabs,
visible focus, labelled controls, live status regions, bounded overlay cards,
and a two-key plus slider confirmation before it removes a local model, chat
session, or history records.

The suite reads the site's language, funny-level, emoji, and School-mode
settings. English, Hong Kong Cantonese, and bilingual copy are rendered
locally; funny levels change voice but not endpoint, model, count, status, or
failure facts. When School mode is active, the entire suite is omitted from the
rendered Pages surface and its local preferences remain preserved for later.

## Failure modes and recovery

An HTTPS-hosted Pages site can be prevented from requesting the HTTP loopback
API by the browser's mixed-content or CORS policy. The Runtime tab reports that
exact boundary and retains the last valid local cache rather than silently
calling a remote model or claiming success. A malformed, oversized, redirected,
non-loopback, or unsupported response is rejected before it changes state.

Pull streams have a bounded response budget, configurable concurrency from one
through three, cancellation, retry, durable per-item status, and honest
pulled/skipped/cancelled/failed outcomes. A partial batch never turns green.
The page cannot preflight exact host storage capacity, so it reports that
limitation instead of claiming a pull will fit.

Attachments remain visibly disabled until `/api/show` for the selected local
tag reports `vision`. A selected image is bounded to 4 MiB, remains in memory
only for the next local request, and is omitted from browser storage, history,
and exports. If the capability call fails, the control remains disabled with
the recovery action to inspect the local tag.

## Security and privacy

The suite makes no remote catalog, cloud-model, analytics, telemetry, CDN, or
credential request. It never renders provider text as markup. Catalog and API
fields are bounded and inserted as text. Chat and history exports apply
conservative credential and local-path redaction and explicitly omit
attachments, endpoint metadata, raw model payloads, environment values, and
source-file metadata. Browser storage is a convenience, not an encrypted vault;
users should avoid placing secrets in any prompt and review an export before
sharing it.

## Verification

From the repository root, run:

```powershell
npm --prefix site run test:ollama
npm --prefix site run check
npm --prefix site run build
```

`ollama-suite.test.mjs` exercises loopback allowlisting, malformed and
duplicate API tags, complete catalog requirements, duplicate-key JSON rejection,
bounded persistence, conservative fit verdicts, redaction, allowlisted
browser-only profiles, route registration, attachment capability gating, and
exact negative fixtures. `site/check.mjs` independently verifies the
hand-written universal inventory row, HTML and build-runtime registration,
contract anchors, browser-only boundary, and negative fixtures. The build copies
the module and its contract as local assets to a new output directory outside
the repository.

## Capture evidence

A real built-site interaction capture is required through the project's
sanctioned hidden-desktop route. It must show the Features tab, the browser
local-runtime boundary, the locally empty or cached model state, and at least
one interactive suite control from the built output. No mockup, design file, or
source-only preview is accepted as this evidence. Until the capture is
available, this article intentionally makes no visual-proof claim.

## Suggested articles

- [Universal feature coverage](./universal-feature-coverage.md)
- [Landing and documentation site](./landing-and-documentation-site.md)
- [Regex builder](../search/regex-builder.md)
- [Notification centre](../notifications/notification-center.md)
