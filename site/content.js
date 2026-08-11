window.MDM_SITE_CONTENT = {
  product: {
    name: "Material Download Manager",
    shortName: "MDM",
    description: "A Windows download manager with resumable transfers, queue controls, local history, and a deliberately honest release surface."
  },
  features: [
    {
      id: "reliable-transfers",
      category: "Download engine",
      title: "Reliable transfers",
      summary: "Segmented Range transfers, non-resumable fallback, queue limits, schedules, retries, timeouts, and credential-aware redirects.",
      docsPath: "../docs/features/download-engine/reliable-transfers.md",
      tags: ["downloads", "queue", "network", "retries"],
      sections: {
        behavior: [
          "DownloadManager applies both per-queue concurrency and the global maxActiveDownloads limit. QueueScheduleClock polls local windows while the manager is alive.",
          "DownloadTask splits resumable files into byte ranges, validates Content-Range and Content-Length, writes each range at its own offset, and falls back to one streamed part when the server does not support ranges.",
          "Custom headers remain in the main-process persistence record. They are not copied into DownloadItem or renderer state."
        ],
        configuration: [
          "maxActiveDownloads limits active tasks across all queues.",
          "maxConnectionsPerDownload and minConnectionPartSize control range splitting.",
          "scheduleEnabled, startAt, and endAt define an ordinary or overnight local-time window; equal endpoints mean all day.",
          "Request headers are supplied with the add-download request and remain main-process-only after persistence."
        ],
        failureModes: [
          "Invalid URLs, malformed redirects, excessive redirects, invalid range responses, unexpected status codes, connection timeouts, idle timeouts, total-request timeouts, and exhausted retries become explicit item errors.",
          "A manual resume waits for an automatic schedule pause already in flight, so a scheduled pause cannot overwrite the user's resumed state."
        ],
        security: [
          "Header values are never logged or copied into renderer-facing state.",
          "A redirect that changes origin is treated as a credential boundary: Authorization, cookies, proxy authorization, and similar sensitive headers are stripped."
        ],
        verification: [
          "The engine is covered by typecheck, build, and the serialized Node engine suite. The suite covers Range reconstruction, pause/resume, queue concurrency, StateStore saves, schedules, redirect limits, timeouts, malformed ranges, categories, throttling, and URL redaction."
        ]
      },
      suggested: ["local-history", "notification-center", "destructive-action-gate"]
    },
    {
      id: "auto-organize-downloads",
      category: "Download engine",
      title: "Auto-organize downloads",
      summary: "Six future category paths plus ordered, worker-isolated custom regex rules that preserve explicit folders and never move existing files.",
      docsPath: "../docs/features/download-engine/auto-organize-downloads.md",
      tags: ["downloads", "categories", "folders", "regex", "settings"],
      sections: {
        behavior: [
          "Downloads using the current default folder can be routed to General, Documents, Videos, Music, Programs, or Compressed. Images and uncategorized files share General, while explicit non-default folders are preserved.",
          "Custom JavaScript RegExp rules run from top to bottom before extension detection. Each rule checks the sanitized file name and then the source URL; the first matching rule wins.",
          "Turning folder routing off keeps new default-folder downloads flat but leaves custom classification active for sidebar categories. The switch never moves or rewrites an existing download."
        ],
        configuration: [
          "The Downloads settings tab requires an absolute Windows drive or UNC default folder, derives all six path previews from it, and explains that directories are created only when a matching task starts.",
          "Preset and blank-rule actions create ordered cards with a name, one of six destinations, keyboard reorder controls, field-specific inline validation, and an anchored regex-only builder bounded to 512 characters.",
          "Settings use schema version 3. Each rule is an exact five-field record with bounded name, pattern, flags, category, and unique ID values. The renderer sends only editable setting keys; the main process validates and clones accepted values, marks only accepted mutation keys persisted, and preserves untouched provenance across reloads.",
          "Settings search includes the current folder and switch state, all six derived paths, and every rule's number, name, pattern, flags, and destination. Results focus the exact matching target."
        ],
        failureModes: [
          "Save is disabled for a blank or relative default folder, blank names or patterns, invalid or unsafe expressions, duplicate or reserved IDs, extra rule fields, non-canonical flags, and targets outside the six-category contract.",
          "An invalid default folder produces an honest preview prompt. No path is fabricated and no folder is created merely by opening Settings.",
          "Malformed persisted or scheduled rules fail validation instead of executing or silently changing destination."
        ],
        security: [
          "Patterns and samples remain local and bounded. Static checks reject known unsafe forms; every desktop user expression then runs in a terminable main-process worker with a 250 ms deadline.",
          "The Add download preview reaches the isolated classifier through bounded trusted-sender IPC, generation-checks its result, and final routing evaluates again in the main process. Timeout or worker failure falls back to built-in extension detection.",
          "Raw source URLs are not logged, and renderer-authored schema or provenance metadata is rejected at the trusted boundary."
        ],
        verification: [
          "The required verification matrix covers exact schema bounds, absolute paths, provenance, worker timeout recovery, first-match ordering, preview/final-routing agreement, native-keyboard reorder, focus and accessible names, field-specific errors, dynamic search, guided-builder limits, real IPC persistence, and narrow bilingual layout. Final results are recorded in the project handoff."
        ]
      },
      suggested: ["reliable-transfers", "regex-builder", "language-appearance"]
    },
    {
      id: "record-export",
      category: "Export",
      title: "Record export",
      summary: "Deterministic structured, tabular, markup, SQL, and language-source output with warnings when a format cannot preserve a field shape.",
      docsPath: "../docs/features/export/record-export.md",
      tags: ["export", "json", "csv", "sql", "formats"],
      sections: {
        behavior: [
          "The shared export serializer supports JSON, JSONL/NDJSON, YAML, TOML, XML, CSV, TSV, Markdown, HTML, SQL, JavaScript, TypeScript, Python, Go, Rust, JSON Schema, and Protobuf output.",
          "Structured formats retain all fields. Tabular and presentation formats escape cells and report when nested values are represented as JSON text."
        ],
        configuration: [
          "The host supplies the format and records. An export surface should name the format, UTF-8 encoding, line-ending behavior, and any representational warning before writing.",
          "Filtered views should pass the filtered records rather than silently exporting the whole collection."
        ],
        failureModes: [
          "SQL values are quoted and escaped. XML and HTML output escapes markup.",
          "Protobuf uses a JSON envelope for arbitrary records without a stable schema and warns that field-level typing is not preserved."
        ],
        security: [
          "HTML output is a standalone table with no scripts or external assets. The serializer does not fetch remote assets or log record contents."
        ],
        verification: [
          "The Electron export tests exercise every supported format, representational warnings, markup escaping, and SQL escaping."
        ]
      },
      suggested: ["regex-builder", "tabbed-navigation"]
    },
    {
      id: "local-history",
      category: "History",
      title: "Local version history",
      summary: "Append-only Git-backed snapshots beside application data, with factual actions, restore-as-new-revision, filters, diffs, export, hook isolation, and staged-index isolation.",
      docsPath: "../docs/features/history/local-version-history.md",
      tags: ["history", "git", "restore", "audit"],
      sections: {
        behavior: [
          "HistoryStore keeps an isolated Git repository beneath the app data directory, never inside the user's project folder and never on a network path.",
          "A changed snapshot creates one append-only local revision with an action, factual summary, timestamp, and commit id. An unchanged snapshot records nothing.",
          "Restore reads an earlier snapshot and records restoration as a new revision, so an undo remains possible. Download creation, completion/error, pause/resume/retry/cancel, deletion, queue changes, and settings changes are recorded.",
          "The application exposes the metadata through a History tab with matching counts, a no-match state, a date range, action chips derived from real history, and a filtered export action."
        ],
        configuration: [
          "Callers supply a serialized snapshot and a real action such as created, updated, deleted, restored, undone, imported, or settings-changed.",
          "The current manager snapshot is local JSON metadata. Custom request-header values stay out of renderer state and snapshots.",
          "The History tab keeps plain text as the default search and opens its own bounded JavaScript regex builder; JSON, JSONL, YAML, TOML, CSV, Markdown, and HTML exports use the same filter."
        ],
        failureModes: [
          "Git failures return an empty read result or a clear null restore result rather than claiming a revision exists.",
          "A history write is best effort and does not fail the operation the user actually requested."
        ],
        security: [
          "The history repository has local-only Git configuration and never contacts a remote. Hooks, signing, and system Git configuration are disabled for each child; only snapshot.json is committed, while unrelated staged files remain untouched. Snapshot encryption remains the caller's responsibility; the current manager records non-secret metadata as local JSON."
        ],
        verification: [
          "History tests cover append-only behavior, no-op suppression, restore-as-new-revision, action/text/regex filters, diffs, JSONL export, hook isolation, and unrelated-index isolation. The built-artifact UI smoke checks the History tab, date controls, search, export, separate progress window, and narrow Settings layout."
        ]
      },
      suggested: ["record-export", "regex-builder"]
    },
    {
      id: "command-palette",
      category: "Navigation",
      title: "Command palette",
      summary: "Ctrl+Shift+F discovery with keyboard navigation, accessible list semantics, inline destinations, and a local regex builder.",
      docsPath: "../docs/features/navigation/command-palette.md",
      tags: ["navigation", "keyboard", "palette", "discovery"],
      sections: {
        behavior: [
          "The global Windows shortcut Ctrl+Shift+F opens a modal palette with focus trapping and opener restoration.",
          "Commands carry labels, descriptions, keywords, and sections. Selecting a result can take the user to the exact feature, setting, tab, group, or appearance editor.",
          "The palette supports plain-text search by default and its own opt-in JavaScript regular-expression state."
        ],
        configuration: [
          "The host supplies the complete command list and an onSelect callback for each real command.",
          "The production registry includes visible toolbar actions, queue actions, language mode, and appearance destinations."
        ],
        failureModes: [
          "Invalid palette expressions fail closed with an empty result set and an inline error. Raw search text, including whitespace, is preserved.",
          "Escape closes a nested builder first and then the palette; the palette does not execute a command until the user selects it."
        ],
        security: [
          "Palette queries are evaluated locally and are not sent to a server. The palette does not execute arbitrary text as code."
        ],
        verification: [
          "Typecheck, the renderer build, focused tab-model tests, and the documented hidden-desktop smoke cover the modal role, search focus, live rows, Settings focus intent, and nested Escape handling."
        ]
      },
      suggested: ["tabbed-navigation", "regex-builder", "language-appearance"]
    },
    {
      id: "tabbed-navigation",
      category: "Navigation",
      title: "Tabbed navigation",
      summary: "Browser-style tab state with pinned regions, groups, four independent searches, move-to-group, and protected bulk close.",
      docsPath: "../docs/features/navigation/tabbed-navigation.md",
      tags: ["tabs", "groups", "pinning", "bulk actions"],
      sections: {
        behavior: [
          "The shared tab model tracks browser-style tabs, groups, pinned state, workspace/window/strip location, and dirty-tab protection.",
          "The reusable strip provides a dedicated pinned region and four independent searches: current strip, current group, group names, and every tab.",
          "Move-to-group and both bulk-close predicates are available. Pinned tabs are protected unless explicitly included, and dirty tabs are reported as skipped."
        ],
        configuration: [
          "Persist TabState with the app's versioned settings/history store when the strip is wired into the shell.",
          "Search state belongs to each field; it must not be shared between scopes."
        ],
        failureModes: [
          "Empty queries do not close anything in containing mode. Close previews show the inverse predicate before confirmation.",
          "Invalid patterns fail closed through the bounded shared regex engine, and dirty tabs are never closed by the model."
        ],
        security: [
          "Bulk actions only inspect visible tab labels and titles. Protected or unsaved work is not silently discarded."
        ],
        verification: [
          "The tab-model suite covers scope-specific search, bidirectional group membership, and pinned/dirty bulk-close protection."
        ]
      },
      suggested: ["regex-builder", "command-palette", "local-history"]
    },
    {
      id: "notification-center",
      category: "Notifications",
      title: "Notification centre",
      summary: "Corner-anchored, non-blocking status and error toasts with honest lifetimes and reviewable session history.",
      docsPath: "../docs/features/notifications/notification-center.md",
      tags: ["notifications", "toast", "errors", "history"],
      sections: {
        behavior: [
          "NotificationCenter renders informational, success, warning, and error events as corner-anchored non-blocking toasts.",
          "Informational and success messages auto-dismiss. Warnings and errors remain until dismissed, while dismissed records stay reviewable in session history.",
          "Download completion, status changes, errors, and rejected renderer operations use the same event path."
        ],
        configuration: [
          "notify receives a factual title, message, and tone. An optional timeout is reserved for non-error informational work.",
          "The compatibility setting showCompleteDialog is labelled as a non-blocking completion notification and does not open a dialog."
        ],
        failureModes: [
          "Unhandled promise rejections become visible error notifications instead of silent console-only failures.",
          "Native operating-system notifications fail closed when unsupported without changing download completion."
        ],
        security: [
          "React renders notification text as text. Notification content is not sent over the network and does not accept HTML."
        ],
        verification: [
          "Renderer build and the documented hidden-desktop smoke cover the wiring. A dedicated DOM harness and bulk notification-history actions remain explicitly unverified follow-up work."
        ]
      },
      suggested: ["renderer-accessibility", "destructive-action-gate"]
    },
    {
      id: "destructive-action-gate",
      category: "Safety",
      title: "Destructive-action gate",
      summary: "Two-key authorization, full-range confirmation, cancellation, reduced-motion support, and exact affected-item facts before removal.",
      docsPath: "../docs/features/safety/destructive-action-gate.md",
      tags: ["safety", "delete", "confirmation", "keyboard"],
      sections: {
        behavior: [
          "Removing a download or deleting its file opens the native renderer gate. It names the affected count and action, requires two independently operated authorization keys, and unlocks a full-range slider only after both keys are armed.",
          "The gate shows progress and completion states, offers Emergency exit and Escape cancellation, and does not call removal IPC until authorization completes."
        ],
        configuration: [
          "The gate receives item ids and a delete-file boolean from the real download context-menu path.",
          "The host reports partial failures through the notification centre rather than claiming a batch succeeded."
        ],
        failureModes: [
          "No key or slider shortcut bypasses the gate. Escape and emergency exit cancel, preserve focus return, and leave the operation untouched.",
          "Reduced-motion styles disable decorative animation while keeping facts and controls available."
        ],
        security: [
          "The gate is implemented in the renderer's native UI, not a hosted or detached helper. Focus is contained and controls have screen-reader names."
        ],
        verification: [
          "Typecheck, renderer build, and the documented hidden-desktop smoke cover settings Escape and focus restoration. Dedicated renderer DOM tests and append-only deletion history remain follow-up work."
        ]
      },
      suggested: ["renderer-accessibility", "notification-center", "local-history"]
    },
    {
      id: "renderer-accessibility",
      category: "Accessibility",
      title: "Renderer accessibility bridge",
      summary: "Central dialog, menu, focus, sidebar, keyboard, and sort-header semantics that keep shared surfaces consistent.",
      docsPath: "../docs/features/accessibility/renderer-accessibility.md",
      tags: ["accessibility", "aria", "focus", "keyboard"],
      sections: {
        behavior: [
          "RendererAccessibilityBridge decorates visible shared surfaces with dialog and alert-dialog roles, modal labelling, focus containment and restoration, menu semantics, keyboard navigation/typeahead, sidebar activation, and visible shortcut metadata.",
          "Auto-organize rule cards form a named ordered list. Every control includes its rule position, errors describe only their owning field or card, focus follows reorder/removal, and live status announces the change.",
          "Download-table sort headers are real keyboard targets: Enter and Space apply the same action as a click, while aria-sort reports ascending, descending, or none."
        ],
        configuration: [
          "The bridge observes the real renderer DOM and applies only to visible shared surfaces. New dialogs and menus retain class hooks or add equivalent semantic hooks before shipping."
        ],
        failureModes: [
          "Focus is returned only to a still-connected originating control. Reorder and removal choose a valid surviving target. Nested surfaces can consume Escape before shared dialog handling runs.",
          "The current renderer does not yet have a dedicated DOM test harness; that gap is recorded rather than treated as a pass. The built-artifact smoke supplies the real-process accessibility and narrow-layout evidence."
        ],
        security: [
          "The bridge grants no new IPC privileges and never copies provider-authored text into an executable context."
        ],
        verification: [
          "The required gate covers typecheck, renderer build, engine and Electron tests, plus hidden-desktop smoke with real key events, unique names, field-specific error wiring, focus after reorder/removal, contrast, control sizing, and narrow bilingual layout. Final results are recorded in the project handoff."
        ]
      },
      suggested: ["notification-center", "destructive-action-gate", "command-palette"]
    },
    {
      id: "regex-builder",
      category: "Search",
      title: "Regex builder",
      summary: "Plain-text-first local search with guided JavaScript RegExp construction, flags, captures, safety bounds, and export.",
      docsPath: "../docs/features/search/regex-builder.md",
      tags: ["search", "regex", "captures", "security"],
      sections: {
        behavior: [
          "The builder uses the JavaScript RegExp dialect supplied by Chromium/Electron. Plain text remains the default; regex mode is explicit.",
          "It provides raw pattern editing, supported g/i/m/s/u/y flags, guided insertion for literals, character classes, anchors, groups, alternation, and quantifiers, sample text, live matches, capture groups, copy, and JSON export.",
          "Patterns are limited to 2,048 characters, each sample to 100,000 characters, each local IPC batch to 2,000 samples and 5,000,000 aggregate sample characters, and displayed results to 200 matches. Zero-width matches advance safely.",
          "Every desktop user-authored expression runs in a terminable main-process worker with a 250 ms deadline. Generation checks keep a late response from replacing a newer query."
        ],
        configuration: [
          "Each search surface keeps its own builder state and applies its pattern and flags only to that field.",
          "The raw query stays exactly as typed, including leading, trailing, and whitespace-only patterns."
        ],
        failureModes: [
          "Invalid syntax and unsupported flags are reported inline without evaluating the sample.",
          "Conservative static checks reject known unsafe repeated forms. A timeout or worker failure terminates the worker, returns a bounded failure, and starts the next request in a fresh worker."
        ],
        security: [
          "Evaluation is local and bounded. Patterns and sample text cross only the context-isolated preload/main-process boundary; they are not sent to a network service, persisted, or written to logs."
        ],
        verification: [
          "The required regex matrix covers literal escaping, captures, zero-width matches, invalid and adversarial patterns, IPC and result bounds, timeout termination, post-timeout recovery, stale-result rejection, and guided fragments."
        ]
      },
      suggested: ["tabbed-navigation", "command-palette", "local-history"]
    },
    {
      id: "language-appearance",
      category: "Settings",
      title: "Language and appearance settings",
      summary: "Persisted English, Hong Kong-style Cantonese, or bilingual copy with independent funny levels and live appearance tokens.",
      docsPath: "../docs/features/settings/language-and-appearance.md",
      tags: ["settings", "language", "theme", "appearance"],
      sections: {
        behavior: [
          "The settings schema provides English, playful Hong Kong-style Cantonese, and compact bilingual modes. English and Cantonese each have an independent funny-level slider from 1 through 5.",
          "Theme, density, accent seed color, UI font family, font size, and weight are validated at the persistence boundary and applied live through CSS variables. Schema-v3 provenance starts untouched defaults as compiled in, marks accepted mutation keys persisted, and survives reload per key.",
          "The Settings dialog has four browser-style tabs—Language, Appearance, Downloads, and Advanced—with one persisted active tab and one independent search/regex-builder state per tab. Dynamic results include live folder, path, switch, and rule values, focus the actual control, and open closed sections before focus moves; outer action rows use non-interactive containers so buttons are not nested inside labels."
        ],
        configuration: [
          "Authoritative defaults and validators live in the shared settings schema. StateStore migrates state.json, requires an absolute Windows drive or UNC default folder, validates exact-shape rules, and persists per-key provenance.",
          "Font stacks use safe installed/bundled fallbacks and do not fetch remote assets."
        ],
        failureModes: [
          "Invalid enum, number, color, folder, or exact-shape rule values fail validation or fall back safely during migration. Unknown persisted keys are ignored.",
          "Migration does not execute persisted text as code or send settings over the network."
        ],
        security: [
          "Settings are local state. The site mirrors the same privacy boundary: preferences stay in localStorage and no analytics or third-party assets are loaded."
        ],
        verification: [
          "The required settings matrix covers defaults, per-key provenance, legacy migration, malformed input, exact rule shape, absolute folders, dynamic plain-text and regex search, native-keyboard reorder, focus and error association, contrast, and narrow bilingual layout. Product-level gaps remain explicit: localized/funny copy across every renderer message and the full continuous color translator."
        ]
      },
      suggested: ["regex-builder", "tabbed-navigation", "renderer-accessibility"]
    },
    {
      id: "squirrel-updates",
      category: "Updates",
      title: "Squirrel.Windows packaging and bounded updates",
      summary: "Fail-closed Squirrel packaging, staged background update checks, explicit restart, and honest unsigned-test separation.",
      docsPath: "../docs/features/updates/squirrel-windows.md",
      tags: ["updates", "squirrel", "installer", "release"],
      sections: {
        behavior: [
          "The production package targets Squirrel.Windows x64. A successful build produces Setup.exe, RELEASES, and a full .nupkg under the Squirrel output directory.",
          "The main-process coordinator performs one bounded startup check and bounded background checks. It exposes current, available, downloading, ready, failed, and offline states.",
          "Installation is never automatic: the renderer offers manual check, release notes, Later, and Restart to install update. Restart requires a fresh unsaved-work assertion."
        ],
        configuration: [
          "The stable feed is a public HTTPS latest-release path unless MDM_UPDATE_FEED_URL overrides it in the main process. Release-notes URLs are validated with the same HTTPS, credential-free boundary.",
          "Local task checks are recorded separately. GitHub Actions builds, packages, and publishes the stable unsigned Squirrel release without running tests or lint. Code signing is permanently prohibited; the release notes identify the unsigned status and SmartScreen warning plainly."
        ],
        failureModes: [
          "Missing feed configuration, development launches, unsupported platforms, network failures, malformed candidates, equal/older versions, stale operation leases, and overlapping checks fail closed.",
          "No stable installer is claimed until the stable unsigned workflow proves immutable assets and the feed. The historical v0.1.0 unsigned prerelease is separate evidence and is never promoted."
        ],
        security: [
          "Updater IPC validates the sender window and frame. The renderer receives typed, validated state; raw errors and credentials are not exposed.",
          "The installer gate intentionally does not weaken the repository's no-signing policy for this documentation surface: the site only displays verified release metadata and never fabricates an asset."
        ],
        verification: [
          "Updater tests cover state validation, monotonic versions, timeout/stale-event recovery, native Squirrel overlap protection, unsigned-feed validation, and secure IPC. A signer is never requested or invoked."
        ]
      },
      suggested: ["reliable-transfers", "notification-center", "language-appearance"]
    },
    {
      id: "browser-extension",
      category: "Integration",
      title: "Chromium extension handoff",
      summary: "Default-on automatic browser-download capture through an app-prepared protocol-2 pairing, with final durable acceptance and fail-safe browser recovery.",
      docsPath: "../docs/features/integrations/browser-extension.md",
      tags: ["extension", "chromium", "capture", "loopback", "downloads", "folders"],
      sections: {
        behavior: [
          "Automatic capture defaults on. For an eligible HTTP(S) browser download, the extension pauses the exact item, asks GET /v2/challenge to prove the app-prepared pairing before any download URL is sent, and then submits a one-use authenticated protocol-2 request.",
          "The app performs a credential-free ranged GET, durably creates and starts the manager record, and returns an authenticated final 202. Only then does the extension cancel and erase the browser copy; every unpaired, rejected, overloaded, invalid, disconnected, timed-out, offline, or source-unreadable route resumes and retains the extension-owned item.",
          "The toolbar popup and context menu retain manual page, link, and selection capture. The desktop app owns queue persistence and progress, so a final accepted handoff joins the same download state as an in-app URL.",
          "The desktop Install browser extension action creates a private paired copy beneath stable application data and automatically opens that exact folder; Open extension folder remains the manual fallback."
        ],
        configuration: [
          "Options persist the default-on automatic-capture checkbox, manager name, loopback endpoint, language mode, independent funny levels, and versioned import/export settings. Turning automatic capture off leaves manual handoffs available.",
          "The endpoint defaults to http://127.0.0.1:43771/v1/downloads and can be tested from the popup. Plain-text settings search retains its adjacent anchored full regex builder.",
          "The generic release ZIP is a version-stamped source/reference package with an empty pairing module. Use the app-prepared folder for a working Load unpacked installation; loading the generic ZIP in a fresh profile reports an unpaired state."
        ],
        failureModes: [
          "If Chrome cannot pause the item, no handoff is sent. Failed app proof, expired or reused challenges, rejection, overload, source-read failure, client-disconnect rollback, unreachable app, invalid response, and timeout resume the exact extension-owned item; service-worker restart recovers bounded paused and accepted claims.",
          "The desktop endpoint rejects non-loopback clients, website or malformed browser origins, oversized bodies, unsupported protocol versions, unsafe filename hints, invalid URLs, more than 8 in-flight handoffs, and more than 60 challenge/POST requests per rolling minute. Challenges are one-use, expire after 30 seconds, and occupy at most 64 table entries.",
          "A folder-open failure is reported separately from successful extension staging, so users can retry Open extension folder without copying again."
        ],
        security: [
          "The bridge uses loopback-only HTTP, accepts only exact Chromium extension origins or originless local diagnostics, and authenticates the nonce-only challenge, every request field, and the final accepted response with the app-prepared capability. It logs no request bodies and contacts no third-party endpoint.",
          "Automatic payloads contain only a credential-free URL and optional URL-derived safe basename—never cookies, authorization headers, referrers, browser request headers, or the absolute browser destination path. Accepted query-bearing URLs persist only in the operating-system credential vault, stay redacted elsewhere, and are removed on terminal cleanup.",
          "Releases provide a version-stamped, size/SHA-verified source/reference ZIP whose pairing module is empty. A CRX is not published because genuine CRX3 packages require signing and this repository permanently prohibits signing keys and signing operations."
        ],
        verification: [
          "Local extension tests cover app-prepared pairing, protocol-2 proofs, final-only acceptance, automatic lifecycle, privacy payload, eligibility, restart recovery, and manual capture. Electron tests cover challenges, rate/concurrency bounds, ranged source proof, durable acceptance, disconnect rollback, protected URL cleanup, origin/basename validation, preparation, automatic folder opening, and truthful folder-open failure. GitHub Actions publishes without running tests or lint."
        ],
      },
      suggested: ["reliable-transfers", "squirrel-updates", "site-foundation"],
    },
    {
      id: "local-totp-core",
      category: "Security",
      title: "Local TOTP and QR registration core",
      summary: "A bounded RFC 6238 main-process foundation with otpauth://totp/ parsing, one-time QR registration material, credential-vault storage, and secret-free metadata export.",
      docsPath: "../docs/features/security/totp-authenticator-core.md",
      tags: ["authenticator", "TOTP", "QR", "security", "export"],
      sections: {
        behavior: [
          "The core generates and verifies RFC 6238 codes with SHA-1, SHA-256, or SHA-512, six or eight digits, a bounded period, and a bounded adjacent-period clock-skew window.",
          "The model builds and parses otpauth://totp/ URIs, checks issuer consistency, rejects duplicate or unknown parameters, and creates one-time QR/manual-secret registration material in memory.",
          "The main-process registration service returns stable metadata through typed IPC. The full authenticator tab and QR image renderer are separate follow-up work."
        ],
        configuration: [
          "Registration metadata includes issuer, account, algorithm, digit width, period, schema version, and a stable ID.",
          "TotpSecretVault stores the normalized secret only in the operating-system credential vault under a stable service/account boundary.",
          "Ordinary export is metadata-only and marks secret-free export explicitly with secretOmitted: true."
        ],
        failureModes: [
          "Invalid schemes, hotp URIs, issuer mismatches, malformed base32, unsupported algorithms, invalid digit widths or periods, bad timestamps, and oversized skew windows fail closed.",
          "Missing or corrupt vault records never become usable codes. Malformed candidates return false without revealing credential bytes."
        ],
        security: [
          "Secrets never enter settings, history snapshots, logs, ordinary exports, or renderer metadata. The otpauth URI and manual secret are one-time in-memory registration values, not ordinary state.",
          "The local core performs no network requests and has no cloud account or telemetry path."
        ],
        verification: [
          "The focused suite covers all published RFC 6238 SHA-1/SHA-256/SHA-512 vectors, six/eight-digit output, periods/skew, URI validation, QR-model boundaries, vault behavior, and secret-free export."
        ]
      },
      suggested: ["local-history", "destructive-action-gate", "site-foundation"]
    },
    {
      id: "progress-window",
      category: "Download engine",
      title: "Separate download progress window",
      summary: "A second frameless desktop window with live progress, controls, accessible semantics, and one shared queue state.",
      docsPath: "../docs/features/download-engine/progress-window.md",
      tags: ["progress", "window", "accessibility", "downloads"],
      sections: {
        behavior: [
          "The toolbar and command palette open a separate progress window for an active or stored download. The window has its own title controls and never starts a second engine.",
          "A shared state broadcast updates the main window and progress window, while an item-target channel retargets one existing surface.",
        ],
        configuration: [
          "The renderer uses ?view=progress&progressItem=<id>; the main process validates the id and the requesting frame before opening it.",
          "Pause, resume, cancel, minimize, close, and progress reporting use the typed preload bridge.",
        ],
        failureModes: [
          "A missing target returns false and leaves no orphan window. Closing the progress surface does not remove or stop the download.",
          "Shutdown closes the secondary window before the manager, and late state events are ignored by destroyed windows.",
        ],
        security: [
          "The progress window uses context isolation, disabled Node integration, the same trusted-sender checks, and no remote renderer content.",
        ],
        verification: [
          "Typecheck, build, compiled Electron tests, the dependency-free CDP smoke harness, and a cheap hidden-desktop capture provide the required evidence. The smoke seeds a local fixture through the real preload/main-process seam and fails closed unless the dynamically resolved 980×640 window renders a named progressbar; the latest capture rendered its live progress surface.",
        ],
      },
      suggested: ["browser-extension", "renderer-accessibility", "reliable-transfers"],
    },
    {
      id: "in-app-documentation-browser",
      category: "Documentation",
      title: "In-app documentation browser",
      summary: "Offline bundled Markdown articles with local article links, plain-text-first search, and an anchored regex builder inside the Windows app.",
      docsPath: "../docs/features/documentation/in-app-documentation-browser.md",
      tags: ["documentation", "offline", "markdown", "search"],
      sections: {
        behavior: [
          "The Windows app bundles every categorized Markdown article under docs/features/ and renders it in a Documentation tab through one isolated React renderer.",
          "The article index searches title, source path, and body locally. Relative links to bundled .md articles stay inside the Documentation tab; external links remain external.",
        ],
        configuration: [
          "The Markdown files remain the source of truth. design/scripts/generate-documentation-bundle.mjs emits the checked-in renderer catalog, and the build fails when that catalog is stale.",
          "The Documentation search is plain-text-first and has its own opt-in JavaScript RegExp builder and flags.",
        ],
        failureModes: [
          "A missing or stale bundle fails the build with the exact regeneration command. Invalid regex fails closed and an empty result names the active query.",
          "Unresolvable relative article links remain visible without guessing a local destination.",
        ],
        security: [
          "The renderer does not read the filesystem or fetch documentation at runtime. Markdown becomes React nodes rather than executable HTML, and bounded local regex evaluation protects the renderer.",
        ],
        verification: [
          "The bundle test checks source/catalog completeness, shared tests cover link resolution and search bounds, and the built-artifact smoke exercises the real Documentation tab, command-palette destination, regex search, relative link, code block, empty state, and narrow layout.",
        ],
      },
      suggested: ["regex-builder", "tabbed-navigation", "site-foundation"],
    },
    {
      id: "site-foundation",
      category: "Site",
      title: "Landing and documentation site",
      summary: "Local-asset Material-style tabs, embedded feature articles, settings, accessible search, release gating, and a dependency-free check path.",
      docsPath: "../docs/features/site/landing-and-documentation-site.md",
      tags: ["site", "docs", "material", "offline"],
      sections: {
        behavior: [
          "The site is a static local-asset surface with browser-style tabs for Overview, Features, Changelog, Settings, and About. The tab strip supports horizontal or vertical docking and keyboard navigation that follows its orientation.",
          "Feature articles are embedded in the site build so documentation remains available without a network fetch. Each article exposes behavior, configuration, failure modes, security considerations, verification, and suggested articles.",
          "Settings persist in localStorage and provide theme, density, accent, font scale, reduced motion, tab position, language mode, independent funny levels, and reset actions."
        ],
        configuration: [
          "The site has no runtime dependencies, external fonts, analytics, CDN assets, or network-loaded images. npm scripts invoke only Node built-ins.",
          "The release manifest is the sole input to the installer gate. The UI creates a stable installer button only when a stable record is verified and its asset URL passes the manifest check."
        ],
        failureModes: [
          "Plain-text search remains safe when regex mode is off. Invalid or oversized expressions fail closed, preserve the user's input, and show an inline message.",
          "If no stable release asset is proven, the site shows an honest unavailable state and does not render a disabled or guessed installer button.",
          "The local source keeps a fail-closed publication baseline. The Pages workflow injects the verified release manifest and URL into the deployed site."
        ],
        security: [
          "Search evaluation is local and bounded. Preferences remain in the browser's localStorage. Provider-authored article text is inserted as text nodes rather than interpreted as markup or script.",
          "The site ships a small local SVG illustration instead of generating or copying catalog photography."
        ],
        verification: [
          "site/check.mjs validates the local file inventory, article coverage, release gate, accessibility landmarks, and absence of remote assets. site/build.mjs copies the site to a temporary output directory outside the repository using Node built-ins only."
        ]
      },
      suggested: ["language-appearance", "regex-builder", "squirrel-updates"]
    }
  ],
  releases: [
    {
      version: "0.1.16",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
      summary: "Stable unsigned Squirrel.Windows release with the verified separate progress window, History tab, Settings tabs, browser handoff, and real installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.16/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.16-full.nupkg"],
      notes: [
        "Code name: Mushroom Siu Mai · 北菇燒賣.",
        "Artifacts: Setup.exe, RELEASES, and the full Squirrel package.",
        "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."
      ]
    },
    {
      version: "0.1.15",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
      summary: "Stable unsigned Squirrel.Windows release with the verified History and Settings feature slice and real installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.15/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.15-full.nupkg"],
      notes: ["Code name: Chicken Siu Mai · 雞肉燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.14",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "57a43a2bf303c02ae84183f8b22d366e43c96105",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/57a43a2bf303c02ae84183f8b22d366e43c96105",
      summary: "Stable unsigned Squirrel.Windows release with the verified CI, Pages, updater, and installer contract.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.14/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.14-full.nupkg"],
      notes: ["Code name: Beef Siu Mai · 牛肉燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.13",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "57a43a2bf303c02ae84183f8b22d366e43c96105",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/57a43a2bf303c02ae84183f8b22d366e43c96105",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.13/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.13-full.nupkg"],
      notes: ["Code name: Scallop Siu Mai · 帶子燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.12",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "e6fd63d4227c740c7b73298784d95d0b84b9a869",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/e6fd63d4227c740c7b73298784d95d0b84b9a869",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.12/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.12-full.nupkg"],
      notes: ["Code name: Quail Egg Siu Mai · 鵪鶉蛋燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.11",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "e6fd63d4227c740c7b73298784d95d0b84b9a869",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/e6fd63d4227c740c7b73298784d95d0b84b9a869",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.11/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.11-full.nupkg"],
      notes: ["Code name: Crab Roe Siu Mai · 蟹籽燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.10",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "895bc6e16de223111721457c05b09bfe641c7641",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/895bc6e16de223111721457c05b09bfe641c7641",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.10/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.10-full.nupkg"],
      notes: ["Code name: Classic Siu Mai · 燒賣.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.9",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "895bc6e16de223111721457c05b09bfe641c7641",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/895bc6e16de223111721457c05b09bfe641c7641",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.9/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.9-full.nupkg"],
      notes: ["Code name: Cuttlefish Shrimp Dumpling · 墨魚蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.8",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "a008ce6446e5d25a02574d708401e4075e2253ac",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/a008ce6446e5d25a02574d708401e4075e2253ac",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.8/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.8-full.nupkg"],
      notes: ["Code name: Dried Scallop Shrimp Dumpling · 瑤柱蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.7",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "a008ce6446e5d25a02574d708401e4075e2253ac",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/a008ce6446e5d25a02574d708401e4075e2253ac",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.7/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.7-full.nupkg"],
      notes: ["Code name: Lobster Dumpling · 龍蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.6",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "47e493f0b2448dba24bd755e5a0eb0029b769ed4",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/47e493f0b2448dba24bd755e5a0eb0029b769ed4",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.6/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.6-full.nupkg"],
      notes: ["Code name: Pea Shoot Shrimp Dumpling · 豆苗蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.5",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "47e493f0b2448dba24bd755e5a0eb0029b769ed4",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/47e493f0b2448dba24bd755e5a0eb0029b769ed4",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.5/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.5-full.nupkg"],
      notes: ["Code name: Spinach Shrimp Dumpling · 菠菜蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.4",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "ea038ace72cfb1e36307884a21a8467304a0fefb",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/ea038ace72cfb1e36307884a21a8467304a0fefb",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.4/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.4-full.nupkg"],
      notes: ["Code name: Chive Shrimp Dumpling · 韭菜蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.3",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "ea038ace72cfb1e36307884a21a8467304a0fefb",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/ea038ace72cfb1e36307884a21a8467304a0fefb",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.3/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.3-full.nupkg"],
      notes: ["Code name: Crab Roe Har Gow · 蟹籽蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.2",
      channel: "stable release",
      releaseDate: "2026-08-07",
      commit: "63a8bdcfb5ff577e08fa0d6d030f3d5d9a6b3e2c",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/63a8bdcfb5ff577e08fa0d6d030f3d5d9a6b3e2c",
      summary: "Stable unsigned Squirrel.Windows release with verified CI and installer assets.",
      status: "verified stable release",
      verified: true,
      installerUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/releases/download/v0.1.2/Setup.exe",
      assets: ["Setup.exe", "RELEASES", "material-download-manager-0.1.2-full.nupkg"],
      notes: ["Code name: Bamboo Shoot Har Gow · 筍尖蝦餃.", "Publication state: isDraft=false and isPrerelease=false; signing is intentionally disabled."]
    },
    {
      version: "0.1.0",
      channel: "test prerelease",
      releaseDate: null,
      commit: "2bfbe2921c4c28941ca9b557e284c1d6917e9cb4",
      commitUrl: "https://github.com/Ding-Ding-Projects/material-download-manager/commit/2bfbe2921c4c28941ca9b557e284c1d6917e9cb4",
      summary: "The verified unsigned test prerelease carries CI-built Squirrel assets, but it is not a stable production installer or updater feed.",
      status: "verified test evidence",
      installer: null,
      notes: [
        "Setup.exe, RELEASES, and the full Squirrel package were reported for the test prerelease.",
        "The normal stable path remains fail-closed until the stable unsigned workflow proves the installer and feed.",
        "The source record does not provide a release date for this test prerelease; the viewer leaves the date explicitly unrecorded."
      ]
    }
  ]
};
