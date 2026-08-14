(function (global) {
  "use strict";

  // This is deliberately hand-written. It is the Pages site's contract inventory,
  // not a list derived from the feature article catalogue.
  global.MDM_UNIVERSAL_FEATURE_MANIFEST = {
    schemaVersion: 1,
    title: "Universal user-facing feature coverage",
    surface: "GitHub Pages landing and documentation site",
    requiredIds: [
      "language-modes", "funny-levels", "emoji-toggle", "school-mode", "personal-vocabulary", "narration",
      "scheduled-settings", "external-settings-sources", "dim-sum-surprise", "regex-builder",
      "notifications", "appearance-editor", "tabs", "tab-locks", "support-tickets",
      "authenticator", "mutation-history", "landing-and-docs", "command-palette",
      "destructive-confirmation", "local-history", "changelog", "external-editor", "exports",
      "bulk-actions", "accessibility-responsive", "offline-documentation", "overlay-surfaces",
      "rich-controls", "guided-forms", "filter-collapse", "blank-slate-presets",
      "provider-authored-markup", "release-evidence", "local-assets-and-no-signing",
      "captures-and-evidence"
    ],
    features: [
      {
        id: "language-modes",
        title: "English, Hong Kong Cantonese, and bilingual modes",
        category: "language",
        requiredSurfaces: ["landing", "articles", "settings", "dialogs"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["language-mode-control", "language-mode-rendering"],
        runtimeAnchors: ["data-setting=\"language\"", "function localized"]
      },
      {
        id: "funny-levels",
        title: "Independent English and Cantonese funny levels",
        category: "language",
        requiredSurfaces: ["landing", "articles", "settings", "dialogs"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["funny-en-slider", "funny-yue-slider", "funny-copy-wiring"],
        runtimeAnchors: ["funnyEn", "funnyYue", "renderTonePreview"]
      },
      {
        id: "emoji-toggle",
        title: "Show emojis in dialogs and message boxes",
        category: "language",
        requiredSurfaces: ["settings", "notifications", "dialogs"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["show-emojis-control", "notification-emoji-decoration"],
        runtimeAnchors: ["showEmojis", "id=\"show-emojis\""]
      },
      {
        id: "school-mode",
        title: "User-renamable English-only School mode",
        category: "language",
        requiredSurfaces: ["landing", "articles", "settings", "dialogs", "palette"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["school-mode-name", "school-mode-toggle", "school-mode-reset", "school-mode-live-suppression"],
        runtimeAnchors: ["schoolMode", "schoolModeName", "applySchoolModeSurface"]
      },
      {
        id: "personal-vocabulary",
        title: "Local personal-vocabulary JSON control",
        category: "privacy",
        requiredSurfaces: ["settings", "settings search", "command palette", "feature articles", "School mode"],
        docsPath: "../docs/features/site/personal-vocabulary.md",
        status: "partial",
        probes: ["personal-vocabulary-visible-control", "personal-vocabulary-strict-contract", "personal-vocabulary-local-cache", "personal-vocabulary-school-omission", "personal-vocabulary-built-capture"],
        runtimeAnchors: ["id=\"personal-vocabulary-file\"", "function loadPersonalVocabularyFile", "VOCABULARY_CACHE_KEY", "function clearPersonalVocabulary", "function renderUserFacingText", "window.MDM_SITE_USER_TEXT"],
        evidence: {
          implementation: ["id=\"personal-vocabulary-file\"", "function loadPersonalVocabularyFile", "function clearPersonalVocabulary", "window.MDM_SITE_USER_TEXT"],
          localizedCopy: ["personalVocabularyNoFile", "personalVocabularyReplace", "personalVocabularyClear"],
          persistence: ["VOCABULARY_CACHE_KEY", "function readVocabularyCache", "function applyIncomingVocabularyCache"],
          focusedTests: ["personal vocabulary strict contract", "personal vocabulary negative fixtures"],
          interaction: ["personal-vocabulary-upload", "personal-vocabulary-replace", "personal-vocabulary-clear", "setting.personal-vocabulary-upload"],
          capture: {
            path: "../docs/screenshots/site/personal-vocabulary-no-file.png",
            state: "Built Settings no-file state with generic choose, replace, and clear controls",
            width: 827,
            height: 669,
            sha256: "5d141dc04ae81f1fd06a540f3bc2cbc665abbb2e0a26ae4cffbaa72848971e29"
          }
        }
      },
      {
        id: "narration",
        title: "Opt-in spoken narrator",
        category: "accessibility",
        requiredSurfaces: ["landing", "articles", "settings", "notifications"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["narrator-opt-in", "narrator-language", "narrator-queue"],
        runtimeAnchors: []
      },
      {
        id: "scheduled-settings",
        title: "Scheduled language and appearance settings",
        category: "settings",
        requiredSurfaces: ["settings", "appearance editor"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["schedule-editor", "schedule-timezone", "schedule-persistence"],
        runtimeAnchors: []
      },
      {
        id: "external-settings-sources",
        title: "Validated external settings sources",
        category: "settings",
        requiredSurfaces: ["settings", "notifications"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["https-source", "home-assistant-source", "source-failure-notification"],
        runtimeAnchors: []
      },
      {
        id: "dim-sum-surprise",
        title: "Non-blocking dim sum surprise",
        category: "delight",
        requiredSurfaces: ["landing", "notifications"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["ten-percent-draw", "local-dish-asset", "school-suppression"],
        runtimeAnchors: ["function maybeShowSurprise", "dim-sum-surprise"]
      },
      {
        id: "regex-builder",
        title: "Anchored regex builder beside every search",
        category: "search",
        requiredSurfaces: ["search fields", "menus", "dropdowns", "context menus"],
        docsPath: "../docs/features/search/regex-builder.md",
        status: "partial",
        probes: ["guided-tokens", "regex-validation", "live-matches", "search-binding"],
        runtimeAnchors: ["data-builder-pattern", "JavaScript RegExp"]
      },
      {
        id: "notifications",
        title: "Non-blocking notifications and reviewable centre",
        category: "notifications",
        requiredSurfaces: ["landing", "articles", "settings", "dialogs"],
        docsPath: "../docs/features/notifications/notification-center.md",
        status: "partial",
        probes: ["toast-lifecycle", "notification-centre-history", "notification-search-filter", "notification-selection", "notification-bulk-dismiss", "notification-bulk-delete-confirm", "notification-export", "notification-live-sync"],
        runtimeAnchors: ["function notify", "notification-region", "NOTIFICATION_HISTORY_KEY", "function renderNotificationCentre", "notification-bulk-delete", "function exportVisibleNotifications"]
      },
      {
        id: "appearance-editor",
        title: "Material 3 appearance and element editors",
        category: "appearance",
        requiredSurfaces: ["landing", "articles", "settings", "menus", "dialogs"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["element-target", "live-preview", "per-element-reset", "appearance-preset"],
        runtimeAnchors: ["appearanceOverrides", "appearance-target"]
      },
      {
        id: "tabs",
        title: "Tabbed navigation, groups, searches, and bulk close",
        category: "navigation",
        requiredSurfaces: ["landing", "articles", "settings"],
        docsPath: "../docs/features/navigation/tabbed-navigation.md",
        status: "partial",
        probes: ["tablist", "tab-groups", "four-tab-searches", "bulk-close-preview"],
        runtimeAnchors: ["role=\"tablist\"", "function selectTab"]
      },
      {
        id: "tab-locks",
        title: "Per-tab and per-property user-experience locks",
        category: "navigation",
        requiredSurfaces: ["tabs", "groups", "appearance editor", "settings"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["tab-lock", "property-lock", "lock-recovery"],
        runtimeAnchors: []
      },
      {
        id: "support-tickets",
        title: "Local Support Tickets recovery desk",
        category: "support",
        requiredSurfaces: ["unlock prompt", "settings", "help"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["ticket-create", "folder-open", "no-network-disclosure"],
        runtimeAnchors: []
      },
      {
        id: "authenticator",
        title: "Built-in TOTP authenticator with QR pairing",
        category: "security",
        requiredSurfaces: ["authenticator tab", "lock setup", "settings"],
        docsPath: "../docs/features/security/totp-authenticator-core.md",
        status: "planned",
        probes: ["otpauth-qr", "manual-secret", "rfc-6238-vectors", "secret-free-export"],
        runtimeAnchors: []
      },
      {
        id: "mutation-history",
        title: "Protected redacted mutation history",
        category: "history",
        requiredSurfaces: ["history manager", "settings", "authenticator"],
        docsPath: "../docs/features/history/local-version-history.md",
        status: "planned",
        probes: ["append-only-record", "history-password", "redacted-export", "restore-as-new-entry"],
        runtimeAnchors: []
      },
      {
        id: "landing-and-docs",
        title: "Landing page and offline documentation site",
        category: "documentation",
        requiredSurfaces: ["landing", "articles", "about"],
        docsPath: "../docs/features/site/landing-and-documentation-site.md",
        status: "partial",
        probes: ["local-assets", "article-bundle", "feature-index", "publication-state"],
        runtimeAnchors: ["MDM_SITE_CONTENT", "feature-grid"]
      },
      {
        id: "command-palette",
        title: "Ctrl+Shift+F command palette",
        category: "navigation",
        requiredSurfaces: ["landing", "articles", "settings", "palette"],
        docsPath: "../docs/features/navigation/command-palette.md",
        status: "partial",
        probes: ["shortcut", "palette-search", "exact-teleport", "rich-setting-row"],
        runtimeAnchors: ["Ctrl+Shift+F", "function openPalette"]
      },
      {
        id: "destructive-confirmation",
        title: "Two-key destructive-action confirmation",
        category: "safety",
        requiredSurfaces: ["destructive actions", "dialogs", "notifications"],
        docsPath: "../docs/features/safety/destructive-action-gate.md",
        status: "planned",
        probes: ["two-keys", "confirmation-slider", "emergency-exit", "unsaved-work"],
        runtimeAnchors: []
      },
      {
        id: "local-history",
        title: "Local version history and restore",
        category: "history",
        requiredSurfaces: ["history", "records", "settings"],
        docsPath: "../docs/features/history/local-version-history.md",
        status: "planned",
        probes: ["history-repository", "diff", "restore", "retention"],
        runtimeAnchors: []
      },
      {
        id: "changelog",
        title: "In-app changelog viewer",
        category: "documentation",
        requiredSurfaces: ["changelog", "landing", "exports"],
        docsPath: "../docs/features/history/changelog-viewer.md",
        status: "partial",
        probes: ["release-entries", "date-range", "commit-links", "filtered-export"],
        runtimeAnchors: ["id=\"changelog-date\"", "function renderReleaseList"]
      },
      {
        id: "external-editor",
        title: "External editor and Visual Studio Code handoff",
        category: "integration",
        requiredSurfaces: ["exports", "records", "settings"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["editor-discovery", "workspace-open", "missing-editor-recovery"],
        runtimeAnchors: []
      },
      {
        id: "exports",
        title: "Complete coding-format exports",
        category: "export",
        requiredSurfaces: ["records", "lists", "history", "changelog"],
        docsPath: "../docs/features/export/record-export.md",
        status: "partial",
        probes: ["format-inventory", "field-preservation", "filtered-export", "archive-export"],
        runtimeAnchors: ["function downloadFile"]
      },
      {
        id: "bulk-actions",
        title: "Bulk selection, preview, and undo",
        category: "interaction",
        requiredSurfaces: ["lists", "tables", "notifications", "history"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["multi-select", "select-all-scope", "inverse-selection", "bulk-preview"],
        runtimeAnchors: []
      },
      {
        id: "accessibility-responsive",
        title: "Accessibility, contrast, sizing, and responsive layout",
        category: "accessibility",
        requiredSurfaces: ["every surface", "narrow layout", "touch layout"],
        docsPath: "../docs/features/accessibility/renderer-accessibility.md",
        status: "partial",
        probes: ["keyboard-focus", "screen-reader-names", "contrast", "touch-layout"],
        runtimeAnchors: ["name=\"viewport\"", "class=\"skip-link\""]
      },
      {
        id: "offline-documentation",
        title: "Bundled offline documentation browser",
        category: "documentation",
        requiredSurfaces: ["articles", "search", "links"],
        docsPath: "../docs/features/documentation/in-app-documentation-browser.md",
        status: "partial",
        probes: ["offline-bundle", "article-links", "markdown-rendering"],
        runtimeAnchors: ["content.js", "feature-grid"]
      },
      {
        id: "overlay-surfaces",
        title: "Painted, bounded, movable, and resizable overlays",
        category: "interaction",
        requiredSurfaces: ["menus", "dialogs", "popovers", "panels"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "partial",
        probes: ["overlay-surface", "viewport-bound", "keyboard-move", "keyboard-resize"],
        runtimeAnchors: ["builder-popover", "modal-layer"]
      },
      {
        id: "rich-controls",
        title: "Rich controls wherever values are shown",
        category: "interaction",
        requiredSurfaces: ["lists", "tables", "palette", "details"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["inline-control", "shared-validation", "accessible-value"],
        runtimeAnchors: []
      },
      {
        id: "guided-forms",
        title: "Guided forms with real pickers and validation",
        category: "forms",
        requiredSurfaces: ["settings", "imports", "exports", "support"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["browse-control", "suggested-value", "inline-validation"],
        runtimeAnchors: []
      },
      {
        id: "filter-collapse",
        title: "Collapsible filters and statistics",
        category: "interaction",
        requiredSurfaces: ["lists", "tables", "statistics"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["filter-toggle", "persistent-collapse", "active-filter-state"],
        runtimeAnchors: []
      },
      {
        id: "blank-slate-presets",
        title: "Presets for blank-slate editors",
        category: "appearance",
        requiredSurfaces: ["editors", "appearance", "templates"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["real-default-preset", "preset-description", "preset-undo"],
        runtimeAnchors: []
      },
      {
        id: "provider-authored-markup",
        title: "Safe rendering of provider-authored markup",
        category: "documentation",
        requiredSurfaces: ["articles", "release notes", "previews"],
        docsPath: "../docs/features/documentation/in-app-documentation-browser.md",
        status: "partial",
        probes: ["shared-renderer", "text-safety", "relative-links"],
        runtimeAnchors: ["textContent", "Open categorized source article"]
      },
      {
        id: "release-evidence",
        title: "Verified release links and publication state",
        category: "release",
        requiredSurfaces: ["landing", "changelog", "about"],
        docsPath: "../docs/features/site/landing-and-documentation-site.md",
        status: "partial",
        probes: ["verified-installer", "unsigned-warning", "publication-state"],
        runtimeAnchors: ["function releaseIsStableVerified", "release-manifest"]
      },
      {
        id: "local-assets-and-no-signing",
        title: "Local assets and permanent no-signing policy",
        category: "security",
        requiredSurfaces: ["landing", "release", "documentation"],
        docsPath: "../docs/features/site/landing-and-documentation-site.md",
        status: "partial",
        probes: ["no-remote-assets", "no-crx", "unsigned-release-copy"],
        runtimeAnchors: ["no CDN, no analytics", "CRX"]
      },
      {
        id: "captures-and-evidence",
        title: "Real built-artifact captures and evidence",
        category: "verification",
        requiredSurfaces: ["README", "articles", "release notes", "issues"],
        docsPath: "../docs/features/site/universal-feature-coverage.md",
        status: "planned",
        probes: ["capture-manifest", "built-artifact-source", "narrow-capture"],
        runtimeAnchors: []
      }
    ]
  };
})(typeof window === "object" ? window : globalThis);
