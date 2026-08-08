# In-app changelog viewer

The Windows Electron app exposes a first-class Changelog tab beside the local
revision History tab. It is an in-app release browser, not a browser-only link.
The panel embeds the currently published stable release records from v0.1.2
through v0.1.44, including each release date, release identity, stable
distribution status, full source commit SHA, and a credential-free link to that
commit in the repository.

## Behavior

- Release records are embedded in electron/history/ChangelogStore.ts. The
  renderer does not fetch release data or release notes at runtime.
- Search is plain-text-first and matches the version, date, title, categories,
  and change text. The adjacent Regex control opens the shared anchored
  RegexBuilder; regex mode uses the bounded local JavaScript RegExp evaluator
  and its flags.
- Native date inputs submit ISO YYYY-MM-DD values. Start and end dates are
  validated by the store and compose with the search predicate.
- Each visible entry renders the full 40-character source SHA as a link to
  https://github.com/Ding-Ding-Projects/material-download-manager/commit/<sha>.
- Copy filtered copies the current filtered view as Markdown. Export filtered
  writes the current filtered view in the selected supported coding format and
  reports the exact record count.
- Empty, loading, validation, and IPC failures are shown in an accessible filter
  status region. Export and clipboard failures use a separate action alert with
  the exact failed action and a matching Retry control. They do not invent
  release data or mark a valid search field invalid.
- Surrounding labels and status copy use the existing English, playful
  Hong Kong-style Cantonese, and bilingual settings. Version names, dates,
  SHAs, URLs, and failure facts remain unchanged.
- The tab uses the existing tablist/tab/tabpanel contract. The entry layout
  wraps full commit links and stacks filters at narrow widths.

## Configuration and security

The repository URL and embedded entries are constants in the main-process
changelog store. Main-process IPC accepts only the bounded request shape
validated by ChangelogStore, and the renderer receives only validated
serializable views and export results through the preload bridge. The main
process performs no network request for the viewer. Commit links are generated
only after the repository URL and 40-character hexadecimal SHA pass the
store's credential-free HTTPS checks.

The IPC handlers still require the same trusted-window and trusted-frame check
as the other application handlers. Renderer code has no filesystem, Node.js,
or direct ipcRenderer capability.

## Failure modes

- An invalid ISO date, reversed date range, overlong search, unsupported flag,
  or invalid regular expression is rejected by the store and displayed as an
  error state.
- A malformed main-process view or export result is rejected by preload before
  renderer code uses it.
- Clipboard access failure leaves the release data unchanged and reports the
  exact copy failure.
- A filter with no matches shows a localized no-match empty state; it is not
  confused with a missing embedded catalog.
- A regex worker timeout or rejection remains a typed filter error. The search
  field becomes invalid, a localized accessible alert names the failure, and
  Retry starts a new bounded evaluation; the panel never relabels that failure
  as zero matching releases. Copy and export preserve the same worker-failure
  facts in their localized action alerts, but their failures remain separate
  from filter state. A successful copy or export clears the stale action error.

## Verification

Focused tests in electron/__tests__/changelog.test.ts cover the 43 embedded
stable releases, verify every referenced commit exists in the full repository
history, and cover full commit URL construction, search/date composition,
validation failures, filtered Markdown export, and the store's IPC-safe
adapter. An injected evaluator regression distinguishes worker failure from a
genuine zero-match result for both view and export. Run them after building the
Electron TypeScript output with:

~~~~powershell
npm run build:electron
npm run test:electron -- --test-name-pattern=changelog
~~~~

The built-application smoke separately forces an export validation failure,
proves the search field remains valid, retries after selecting a valid format,
and observes the action alert clear on success.

The full renderer and Electron typecheck/build remain the preferred final gate.

## Suggested articles

- [History browser panel](renderer-history-panel.md) — compare published
  releases with local state revisions.
- [Search](../search/README.md) — understand the shared search and regex
  builder behavior.
- [Export](../export/README.md) — review supported filtered export formats.
