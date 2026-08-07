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
          "RendererAccessibilityBridge decorates visible shared surfaces with dialog and alert-dialog roles, modal labelling, focus containment and restoration, menu semantics, keyboard navigation/typeahead, sidebar activation, and visible shortcut metadata. The smoke rejects interactive controls nested inside labels and checks the narrow Settings layout for clipping.",
          "Download-table sort headers are real keyboard targets: Enter and Space apply the same action as a click, while aria-sort reports ascending, descending, or none."
        ],
        configuration: [
          "The bridge observes the real renderer DOM and applies only to visible shared surfaces. New dialogs and menus retain class hooks or add equivalent semantic hooks before shipping."
        ],
        failureModes: [
          "Focus is returned only to a still-connected originating control. Nested surfaces can consume Escape before shared dialog handling runs.",
          "The current renderer does not yet have a dedicated DOM test harness; that gap is recorded rather than treated as a pass. The built-artifact smoke supplies the real-process accessibility and narrow-layout evidence."
        ],
        security: [
          "The bridge grants no new IPC privileges and never copies provider-authored text into an executable context."
        ],
        verification: [
          "Typecheck, renderer build, engine tests, Electron tests, and the documented hidden-desktop smoke are the required checks for the bridge."
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
          "Patterns are limited to 2,048 characters, samples to 100,000 characters, and displayed results to 200 matches. Zero-width matches advance safely."
        ],
        configuration: [
          "Each search surface keeps its own builder state and applies its pattern and flags only to that field.",
          "The raw query stays exactly as typed, including leading, trailing, and whitespace-only patterns."
        ],
        failureModes: [
          "Invalid syntax and unsupported flags are reported inline without evaluating the sample.",
          "A conservative nested-quantifier guard rejects risky expressions before synchronous evaluation because JavaScript RegExp has no portable timeout."
        ],
        security: [
          "Evaluation is local and bounded. Patterns and sample text are not sent to a server or written to logs."
        ],
        verification: [
          "Regex tests cover literal escaping, captures, zero-width matches, invalid and adversarial patterns, result bounds, and valid guided fragments."
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
          "Theme, density, accent seed color, UI font family, font size, and weight are validated at the persistence boundary and applied live through CSS variables. Provenance states whether a value was persisted or compiled in.",
          "The Settings dialog has four browser-style tabs—Language, Appearance, Downloads, and Advanced—with one persisted active tab and one independent search/regex-builder state per tab. Results focus the actual control and open closed sections before focus moves; outer action rows use non-interactive containers so buttons are not nested inside labels."
        ],
        configuration: [
          "Authoritative defaults and validators live in the shared settings schema. StateStore migrates state.json and persists changed settings before the main process saves them.",
          "Font stacks use safe installed/bundled fallbacks and do not fetch remote assets."
        ],
        failureModes: [
          "Invalid enum, number, or color values fall back to the compiled-in value. Unknown persisted keys are ignored.",
          "Migration does not execute persisted text as code or send settings over the network."
        ],
        security: [
          "Settings are local state. The site mirrors the same privacy boundary: preferences stay in localStorage and no analytics or third-party assets are loaded."
        ],
        verification: [
          "Persistence tests cover defaults, provenance, legacy migration, malformed input, and round trips. The built-artifact UI smoke checks tab keyboard navigation, independent search, regex construction, Escape focus restoration, label structure, and narrow layout. Product-level gaps remain explicit: localized/funny copy across every renderer message and the full continuous color translator."
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
          "The normal workflow publishes a stable unsigned Squirrel release after tests and artifact validation. Code signing is permanently prohibited; the release notes identify the unsigned status and SmartScreen warning plainly."
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
      summary: "Manifest V3 page and link capture through a credential-free loopback bridge owned by the desktop download manager.",
      docsPath: "../docs/features/integrations/browser-extension.md",
      tags: ["extension", "chromium", "capture", "loopback"],
      sections: {
        behavior: [
          "The extension captures the active page or link from its popup or context menu and sends one validated envelope to the desktop app.",
          "The desktop app owns queue persistence and progress, so an accepted handoff joins the same download state as an in-app URL.",
        ],
        configuration: [
          "Options persist the manager name, loopback endpoint, language mode, independent funny levels, and versioned import/export settings.",
          "The endpoint defaults to http://127.0.0.1:43771/v1/downloads and can be tested from the popup.",
        ],
        failureModes: [
          "The extension times out, rejects credentials and redirects, bounds response bodies, and records an explicit recovery result when the desktop app is unavailable.",
          "The desktop endpoint rejects non-loopback clients, oversized bodies, unsupported protocol versions, and invalid URLs.",
        ],
        security: [
          "The bridge uses loopback-only HTTP, no tokens, no request-body logging, no third-party endpoint, and no arbitrary page-content fetch.",
        ],
        verification: [
          "The extension suite covers the local contract; the compiled Electron suite covers the real loopback status and handoff server; a hidden-desktop run queried /v1/status and submitted a real protocol-v1 envelope that received a 202 accepted/pending response.",
        ],
      },
      suggested: ["reliable-transfers", "local-history", "site-foundation"],
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
