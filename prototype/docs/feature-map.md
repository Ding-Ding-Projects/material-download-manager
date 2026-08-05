# ABDM → Material 3 rewrite — feature map (extracted from source)

Source: locally mounted `ab-download-manager` repo (Kotlin/Compose desktop app, v1.10.1) + `agent-global-memory` global instructions (hui instructions).
All strings: `data/en_US.properties` (copied verbatim from repo). Changelog: `data/CHANGELOG.md` (verbatim). Logo: `assets/app_logo.svg`.

## Decisions (user)
Desktop (Windows) only · Full MD3 re-architecture (nav rail, FAB, MD3 search, list/table hybrid) · seed #6750A4 · follow-system theme · comfortable density · truthful empty state (simulated engine, real add flows) · one build · floating windows inside frame; window strip IS the browser-style tab strip (pin/group/reorder/search/bulk-close) · bilingual default · funny level 5 default both languages · TTS narrator shipped OFF · everything togglable EXCEPT dim-sum surprise (per global instructions).

## Main window (HomePage.kt / HomeComponent.kt)
- Custom title bar (frameless), menu bar: File(New Download ^N, Import From Clipboard ^V, Batch Download, — , Exit ^Q) · Tasks(Start Queue group▸, Stop Queue group▸, —, Stop All, —, Delete▸: All Missing Files / All Finished / All Unfinished / Entire List) · Tools(Download Browser Integration▸ (Chrome/Firefox/Edge/Opera), Per Host Settings, Settings ^⌥S) · Help(Website, Source code, Telegram Channel/Group, —, Third-party libs, Translators, Donate, —, Check for Update, About).
- Search box (grows 180→220 on focus) filters list; compact-top-bar merges into title bar >700px width.
- Sidebar: status filters All/Finished/Unfinished (folder icons), each expandable → type categories (Compressed/Programs/Videos/Music/Pictures/Documents w/ exact extension lists in DefaultCategories.kt); category context menu (add/edit/delete/auto-categorize/reset defaults/open folder); drag downloads into category; reorderable; resizable sidebar 0–500dp.
- Queues section under categories (start/stop, open queue).
- Toolbar: [+ Add URL] then actions: Resume, Pause | Start Queue, Stop Queue, Queues | Stop All | Delete | Settings (labels togglable via showIconLabels).
- Download table columns: ☑, Name(+file icon), Size, Status(text+progress), Speed, Time Left, Date Added; sortable (default DateAdded desc), customizable/reset columns, multi-select (click/ctrl/shift, ctrl-A), row double-click = open file or show properties; context menu (per DesktopDownloadActions): Open File ^O, Open Folder ^F, Resume ^R, Pause ^P, —, Delete Del, Restart Download, —, Move To Queue▸, Move To Category▸, —, Copy▸(link ^C, as JSON, as cURL), Edit Download ^E, File Checksum, Show Properties ^I.
- Footer/status bar: active count, global speed.
- Drag & drop links/files → import overlay ("Drop link or file here", "{n} links will be imported").
- Delete prompt: finished/unfinished counts + "Also delete file from disk" checkbox (finished only).
- Statuses: Added, Downloading, Paused, Error, Completed; job states: IDLE/Preparing File/Resuming/Retrying/Downloading/Waiting/Paused/Error/Finished. Part statuses: IDLE/Connecting/Receiving Data/Disconnected/Finished.

## Add Download — single (AddDownloadPage.kt)
URL field (paste icon) → simulated link check (spinner → file icon+size, resume-support ✓/✗ divider). Use Category ☑ + category select + new-category btn; Download Location (last-used dropdown, remove entries); Name field. Errors: can't write folder / already exists / invalid name. Right column: refresh, more-settings (per-item config: thread count, speed limit, username, password, download page, checksum, user-agent, completion dialog, shutdown on completion), error info btn. Buttons: [Add (→ select queue dialog; long-press fast confirm)] [Download primary] [Cancel]; duplicate flow: Show solutions… (Add numbered / Override / Update link / Show downloaded file) + Change solution + Open File.

## Add Download — multiple (AddMultiItemPage/Table)
"Select Items you want to pick up for download": table ☑/Name/Link/Size sortable; select all/inside/invert; save-to modes: Each item on its own category / All items in one category / All in one location; queue select; per-item settings drawer.

## Download progress window (ProgressDownloadPage.kt)
Tabs: Info / Speed / On Completion. Info = props list (Name, Status, Size, Downloaded, Speed, Time Left, Resume Support). Speed = per-item thread count + speed limit ("Use Global Settings" / n). On Completion = open completion dialog toggle, shutdown-on-completion. Progress bar 14dp w/ status gradients (success/warn/error/info/primary), indeterminate sweep when unknown; check chip at 100%. Parts strip + parts table (#, Status, Downloaded, Total; only-active filter). Actions: parts-info toggle, error info; Resume/Pause (unsupported-resume warning popover "Stop Anyway"), Cancel. Completed window: icon+size, "Download Completed", name marquee, Open / Open Folder / drag-file-out / Close.

## Queues window (QueuesPage.kt, QueueInfoComponent.kt)
Left: queue list (active dot), add/remove (Main queue non-deletable). Right tabs: Config / Items. Config: Name (1–32), Max Concurrent (1–32), On completion: Automatic Stop, Shutdown on completion; Scheduler master toggle: Active Days (Mon..Sun), Enable auto start + time, Enable auto stop + time. Items: numbered rows (active = green #), select (ctrl/shift/ctrl-A), reorder drag / move up/down / remove; keys: Del, ↑/↓, Esc. Bottom: Start/Stop Queue, Close.

## Batch download (BatchDownnload.kt)
Link with wildcard * (placeholder https://example.com/photo-*.png), From/To range, wildcard length Auto/Unspecified/Custom(1-10), first/last link preview, errors (invalid URL, list too large max n), OK/Close.

## Other windows
- Enter new URL (paste field + downloader auto select) → opens Add Download.
- Edit Download (^E): like add-single + "Update from Download Page", size-mismatch warning.
- File Checksum window: algorithm select (MD5/SHA-1/SHA-256/SHA-384/SHA-512), per-file rows: calculated vs saved checksum, statuses Waiting/Downloading…/Done, Matches/Not Matches, copy, Start.
- Per Host Settings: host rows (<New Host>, wildcards) + per-host overrides (username/password/thread count/speed limit/user-agent); "Create or select a new item first!".
- Download Error page: reason title/description + Suggestion + Copy/OK. Error taxonomy (en.properties): HTTP 4xx/401/403/404/407/429/5xx/503/default, ETag changed, size changed, web-page response, no disk space, write error, resume-no-longer-supported, timeout, unknown host, connection reset, SSL verification failed, default.
- About: logo card, version, developed-with-❤️, Donate, website link; credits list (FOSS → source, open-source licenses, translators); social row; Third-Party Libraries window (table + license dialog); Translators window.
- Updater: Update Available + version, release notes, Update/Cancel; menu: Check for update → checking / latest / error notifications.
- Confirm Exit dialog: "Active downloads/queues will be stopped!" + Remember this.
- Power action alert: "System Will Shut Down Soon!" countdown, Shutdown now / Cancel, failure state.
- Tray icon menu: Show Downloads, New Download, Import From Clipboard, Exit.

## Settings (DesktopSettingsComponent.kt + CommonSettings.kt) — sections Appearance / Download Engine / Browser Integration
Appearance: Theme (System/Dark/Light/Obsidian/Deep Ocean/Twilight/Black/Light Gray) + default dark/light theme when system; Language; Font; UI Scale (80–200%); [win: Use Native Menu Bar=mac-only], Compact Top Bar, Show Icon Labels, Relative date/time; Start on Boot, Use System Tray; Size Unit (binary/decimal bytes), Speed Unit (b/B × binary/decimal), Average vs Exact speed; Notification Sound master + general/error/success sounds; Show Download Progress Dialog, Show Completion Dialog; Render API.
Download Engine: Default Download Folder, Use Category By Default; Global Speed Limiter (0=unlimited), Thread Count (max 256, warn >64), Max Concurrent Downloads (0=unlimited), Max Retries, Dynamic Part Creation; Per Host Settings ↗; Proxy (Direct/System/Manual/PAC + auth + exclusion list), Default User-Agent, Ignore SSL Certificates, Use Server Last-Modified; Track Deleted Files, Append .part Extension, Delete Partial File On Cancellation, Sparse File Allocation.
Browser Integration: enabled, port (15151 default), Use API Key, API Key.

## Global-instruction features layered on (agent-global-memory/memory/SHARED_INSTRUCTIONS.md)
MD3 Expressive everywhere · frameless custom Material title bar · language modes EN/playful-HK-Cantonese/Bilingual + two independent funny sliders 1–5 (voice-not-facts, disclosure at first run) · optional TTS narrator (OFF, EN/粵/Both serialized, debounced) · dim-sum surprise 10%/launch, non-optable, non-blocking (assets/dimsum, bilingual names) · release code name "Classic Har Gow · 蝦餃" on About/changelog v1 entry · browser-style tab strip (overflow, reorder, pin, group, 4 tab searches, bulk close containing/not-containing w/ preview, persistence) · regex builder anchored at EVERY search bar (guided construction, flags, sample text, live matches/groups, engine=JS RegExp, plain-text default, bidirectional sync) · settings search on every settings surface · context menus all carry search fields · non-blocking notifications bottom-right + notification centre history · super-confirmation for destructive actions (2 keys + full-range slider + progress/completion animation + Emergency exit) · per-element "Edit appearance…" (right-click) anchored editor w/ Word-depth typography + infinite color picker/translator (named/HEX/HEX8/RGB/HSL/HSV/HWB/LAB/LCH/OKLab/OKLCH/CMYK + contrast + gamut warning) + per-element reset/global reset/presets/export-import; editors theme themselves · appearance controls: theme, density, seed color, font family/size/weight live · bulk actions everywhere (multi-select, select-all page/all-matches, invert, delete/export/move/retry/tag preview counts) · export everything (JSON/JSONL/YAML/TOML/XML/CSV/TSV/Markdown/HTML/SQL per shape) · local version history panel (append-only, restore=new revision, date picker + action filter + regex search) · changelog viewer (every released version from data/CHANGELOG.md, date filter + calendar, search w/ regex, export/copy) · accessibility: keyboard, focus rings, roles, reduced motion, ≥44px targets, no clipping · empty states truthful, no fake data.

## Screen map (source file → built surface)
HomePage/HomeComponent → home surface; DesktopSettings* + CommonSettings → settings window; AddDownloadPage → add-single window; AddMultiItemPage → add-multi window; ProgressDownloadPage/CompletedDownloadPage → download windows; QueuesPage/QueueInfoComponent → queues window; BatchDownnload → batch window; NewCategoryPage → category dialog; NewQueuePage → new-queue dialog; AboutPage → about window; FileChecksumPage → checksum window; PerHostSettingsPage → per-host window; DownloadErrorPage → error window; ConfirmExit → exit dialog; PowerActionAlertWindow → shutdown alert; NewUpdatePage → updater window; Tray.kt → tray flyout; en_US.properties → all copy.
