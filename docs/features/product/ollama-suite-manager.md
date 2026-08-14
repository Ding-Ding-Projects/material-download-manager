# Local Ollama suite manager

## Behavior

The desktop application's **Ollama** Settings tab is a local control surface
for a user-installed Ollama runtime. It keeps a credential-free loopback
provider record, refreshes runtime health and model state, manages bounded
local pulls, starts local chat sessions, and runs approved harness profiles.
The renderer never reaches the network directly: the Electron main process
owns every local API request, validates the result, persists bounded state,
and sends validated snapshots through the preload bridge.

The tab contains these real flows:

- Runtime health refresh calls documented local `GET /api/version`,
  `GET /api/tags`, and `GET /api/ps`; it presents the runtime version,
  installed tags, running-model facts, and a specific unavailable/stopped/
  incompatible recovery message.
- Model details refresh calls documented local `POST /api/show` for a selected
  installed tag. The app records reported capabilities, family, quantization,
  parameter text, and context length without retaining unbounded raw model
  data.
- Hardware evidence uses bounded local operating-system facts for RAM, free
  destination disk, architecture, and an optional local GPU/driver probe. A
  model receives **Runs well**, **Runs with limits**, **Unlikely**, or
  **Unknown** with the blob-size, context-overhead, parameter/quantization,
  RAM, disk, VRAM, and driver assumptions shown in the interface. It is an
  estimate, never a promise that a model will run.
- The pull cart is a local batch scheduler, never a payment, subscription,
  account, or checkout flow. It uses documented local `POST /api/pull` with
  bounded parallelism, durable per-item status, byte progress when Ollama
  provides it, cancellation, retry, restart reconciliation, destination-space
  preflight, and honest pulled/skipped/cancelled/failed outcomes.
- Installed models can be copied through documented local `POST /api/copy` or
  deleted through documented local `DELETE /api/delete`. Deletion is protected
  by the application's destructive-action confirmation and refreshes the
  verified local inventory afterwards.
- Local chat sessions use documented local `POST /api/chat` streaming. Sessions
  keep a selected installed model, bounded system prompt and generation
  options, message history, stop, delete, and redacted export. Image controls
  remain visibly disabled until `POST /api/show` has verified the selected
  model reports `vision` capability; selected JPEG, PNG, and WebP bytes are
  bounded, used for one request only, and never persisted with history.
- Harness profiles are either the bundled diagnostics profile or a user-selected
  local `.exe` plus a user-selected working folder. A registered profile accepts
  only the approved `--model`, `--endpoint`, and `--port` placeholders. It
  cannot invoke a shell, script text, command concatenation, arbitrary
  environment expansion, or command interpreter. Preflight records an
  app-managed snapshot; failed launch automatically restores that snapshot;
  manual restore is always available. Restoring never changes an external
  program or an Ollama installation.

## Official catalog boundary

The documented local Ollama API does not expose an exhaustive official catalog
endpoint with variant/tag pagination. Direct cloud API access requires a remote
service and may require authentication, which contradicts this product's strict
local-only, credential-free boundary. Therefore the **Official Model Store
boundary** card fails closed: it records `unavailable-by-policy`, records the
time of the local policy recheck, leaves the installed local inventory usable,
and never invents, guesses, caches, or calls a remote catalog.

The pull cart therefore provides a picker from verified local tags plus a
labelled advanced known-tag field. It does not portray that field as an
official catalog result. The field exists so a person who already knows a
documented tag can schedule a local pull without a hidden network lookup.

## Local endpoint and persistence boundary

Provider URLs must be trimmed `http` or `https` loopback URLs using
`localhost`, `127.0.0.1`, or `::1`. Paths, query strings, fragments, redirects,
userinfo, cloud hosts, and URL credentials are rejected. The following
documented local routes are allowlisted by exact path:

| Operation | Local route | User-visible result |
| --- | --- | --- |
| Runtime version | `GET /api/version` | Version or specific recovery state |
| Installed models | `GET /api/tags` | Verified installed Model Store rows |
| Running models | `GET /api/ps` | Running state and VRAM/context evidence |
| Model details | `POST /api/show` | Capabilities and fit evidence |
| Pull | `POST /api/pull` | Bounded streaming batch progress |
| Copy | `POST /api/copy` | Refreshed verified inventory |
| Delete | `DELETE /api/delete` | Confirmed local model removal |
| Chat | `POST /api/chat` | Bounded streamed local session |

The suite writes its own versioned JSON state atomically below application data.
It persists only locally managed metadata, model facts, fit evidence, pull
outcomes, chat history, profile configuration, and snapshot status. A restart
converts in-flight pull/chat entries to truthful interrupted states rather than
claiming they completed. It never persists provider credentials, attachment
bytes, environment values, raw model payloads, or an official catalog.

Ordinary suite metadata exports intentionally omit credentials, chat history,
attachments, harness snapshots, and the unavailable official catalog. Ordinary
chat exports redact path-shaped and common credential-shaped text and state that
attachments, credentials, environment values, and private paths are omitted or
redacted.

## Guided controls, search, and accessibility

The provider picker, installed-model checkboxes, batch progress, chat tabs,
harness picker, restore controls, and all failure/recovery states are keyboard
operable. The Model Store has a plain-text-first local search and an adjacent
anchored JavaScript regular-expression builder. Its checkboxes support select
matching results and inverse selection. Live regions announce runtime, pull,
and chat changes without blocking the rest of Settings.

The local image attachment control names the missing capability and the next
in-app action when disabled: refresh model details or choose a verified
vision-capable local model. A missing/stopped/unhealthy runtime names the next
action directly in the card: install or start the official runtime for this
device, then refresh the saved local provider. The app does not offer an
arbitrary shell command or a vague "see online docs" dead end.

## Failure modes and recovery

| State | What remains available | Recovery action |
| --- | --- | --- |
| Runtime stopped or unreachable | Saved providers, chats, pull history, profiles, local docs | Start/install the official runtime, then refresh |
| Incompatible loopback service | Saved local data and controls | Point at a compatible local Ollama runtime |
| Model details unavailable | Installed inventory and chat history | Refresh runtime, then refresh the selected model details |
| Insufficient verified disk | Pull cart and exact preflight figure | Free destination space or reduce the batch |
| Unknown fit evidence | Installed inventory and model detail controls | Refresh hardware and model details; do not treat Unknown as success |
| Pull/chat cancellation | Completed model/history data remains intact | Retry a failed/cancelled pull or send another local message |
| Harness launch failure | Snapshot is restored automatically | Review preflight facts, correct the selected `.exe`/folder, then retry |
| Official catalog unavailable | Installed local Model Store and labelled known-tag entry | Keep the local-only boundary; no remote workaround is used |

## Security and privacy

- Only documented loopback endpoints and exact local paths are callable.
- Every response has a content-type, redirect, size, line-size, and stream-size
  boundary. Pull and chat streams are parsed as bounded NDJSON records.
- Runtime operations occur in the main process. The renderer sees validated
  state through a narrow preload API and cannot choose a URL path, redirect,
  header, cloud provider, credential, or shell command.
- The hardware probe is a fixed local operating-system query with a short
  timeout; it is not a user-supplied script and no output is exported publicly.
- Harness registration requires semantic executable and folder pickers. Direct
  `.exe` execution uses `shell: false`, a reduced environment, approved
  placeholders, and no command interpreter.
- Chats, attachment bytes, and model payloads stay local. Captures and ordinary
  exports do not include attachment bytes or credentials.

## Verification

- `design/electron/__tests__/ollamaSuite.test.ts` exercises endpoint rejection,
  documented local version/tags/ps/show/pull/chat routes, streamed pull/chat
  state, capability-gated image input, redacted export, state migration, and
  the no-network catalog boundary.
- `design/electron/__tests__/ollamaContractNegative.test.ts` is the hand-written
  completeness inventory and executable negative regression. It deliberately
  removes an exact local route, changes `shell: false`, removes the strict
  catalog state, removes the guided tag picker, and removes the documentation
  phrase; each mutation must turn the test red before restoration returns green.
- `npm run typecheck`, `npm run build`, `npm run test:electron`, and the built
  UI smoke run locally. The smoke drives real provider add/refresh, model
  actions, pull/chat/harness controls, and records the actual runtime state
  rather than merely checking that a tab exists.
- The capture matrix records healthy, stopped, catalog-boundary, pulling, chat,
  harness-preflight, failed-launch/restore, and narrow-layout states from the
  built desktop artifact. A state requiring a runtime not available on the
  capture host is reported as unavailable rather than simulated as success.

## Suggested articles

- [Regex builder](../search/regex-builder.md)
- [Record export](../export/record-export.md)
- [Destructive action gate](../safety/destructive-action-gate.md)
- [In-app documentation browser](../documentation/in-app-documentation-browser.md)

[Back to product features](./README.md)
