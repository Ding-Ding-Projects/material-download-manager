(function () {
  "use strict";

  const content = window.MDM_SITE_CONTENT;
  const settingsContract = window.MDM_SITE_SETTINGS_CONTRACT;
  const notificationContract = window.MDM_SITE_NOTIFICATION_CONTRACT;
  const releaseManifestContract = window.MDM_RELEASE_MANIFEST_CONTRACT;
  const manifest = window.MDM_RELEASE_MANIFEST || { stable: null, publication: { pages: "unverified" } };
  const root = document.documentElement;
  const SETTINGS_SCHEMA_VERSION = 2;
  const STORAGE_KEY = "mdm-site-settings-v2";
  const LEGACY_STORAGE_KEYS = ["mdm-site-settings-v1"];
  const DEFAULT_SCHOOL_MODE_NAME = "School mode";
  const DEFAULTS = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: 0,
    language: "en",
    funnyEn: 3,
    funnyYue: 3,
    showEmojis: true,
    schoolMode: { enabled: false, name: DEFAULT_SCHOOL_MODE_NAME },
    theme: "system",
    density: "comfortable",
    accent: "#6750A4",
    fontScale: 100,
    reducedMotion: false,
    tabPosition: "left",
    displayName: content.product.name,
    appearanceOverrides: {},
    tabOverrides: {}
  };
  const NOTIFICATION_HISTORY_KEY = "mdm-site-notification-history-v1";
  const NOTIFICATION_LIMIT = 100;
  const NOTIFICATION_TONES = notificationContract.tones;
  const NOTIFICATION_FILTERS = notificationContract.filters;
  const NOTIFICATION_DELETE_PHRASE = "DELETE";
  const SEARCH_IDS = ["features", "changelog", "settings", "palette", "notifications", "tab-strip", "tab-group", "tab-groups", "tab-master"];
  const searchStates = Object.fromEntries(SEARCH_IDS.map((id) => [id, {
    mode: "text",
    pattern: "",
    query: "",
    flags: "g",
    sample: "Downloads, settings, regex, history",
    error: null
  }]));
  const COPY = {
    productEyebrow: ["LOCAL DOCUMENTATION", "本地文件，清清楚楚"],
    openPalette: ["Command palette", "指令總匯"],
    sections: ["Sections", "章節"],
    overview: ["Overview", "總覽"],
    features: ["Features", "功能"],
    changelog: ["Changelog", "更新紀錄"],
    settings: ["Settings", "設定"],
    about: ["About", "關於"],
    localAssets: ["Local assets only", "淨係用本地素材"],
    heroEyebrow: ["WINDOWS DOWNLOADS, WITH RECEIPTS", "WINDOWS 下載，有單有據"],
    heroTitle: ["A calmer way to move files.", "搬檔案，都可以淡定啲。"],
    heroLede: ["Explore the real download engine, safety boundaries, local history, and release evidence behind Material Download Manager.", "睇清楚真正嘅下載引擎、安全邊界、本地歷史，同埋版本證據。"],
    exploreFeatures: ["Explore features", "睇功能"],
    customizeSite: ["Customize this site", "整靚呢個網站"],
    shortcutHint: ["opens every feature, setting, and destination.", "一按就搵到功能、設定同目的地。"],
    heroCaption: ["Bounded · local · reviewable", "有界 · 本地 · 查得返"],
    featureArticles: ["feature articles", "篇功能文章"],
    featureArticlesNote: ["embedded offline", "離線都睇到"],
    siteTabs: ["browser-style tabs", "瀏覽器式分頁"],
    siteTabsNote: ["keyboard reachable", "鍵盤用到"],
    remoteAssets: ["remote assets", "遠端素材"],
    remoteAssetsNote: ["no CDN, no analytics", "冇 CDN，冇分析追蹤"],
    stableInstaller: ["stable installer", "穩定版安裝程式"],
    releaseReadiness: ["RELEASE READINESS", "版本準備狀態"],
    releaseTitle: ["Stable means proven.", "穩定版，要有證據先算。"],
    releaseSummary: ["This checkout has no injected stable release record yet. The installer stays hidden until the Pages manifest proves a published, unsigned, non-prerelease release and its real Squirrel assets.", "呢個 checkout 暫時未有注入穩定版本紀錄；要等 Pages manifest 證明已發佈、未簽名、非預發版同埋真實 Squirrel 素材齊晒，安裝掣先會出現。"],
    viewReleaseEvidence: ["View release evidence →", "睇版本證據 →"],
    extensionTitle: ["Browser extension", "瀏覽器擴充功能"],
    extensionSummary: ["Download the verified Manifest V3 ZIP, then use the desktop app to prepare the private paired folder before loading it in your browser.", "下載驗證過嘅 Manifest V3 ZIP，然後用桌面程式準備私密配對資料夾，再喺瀏覽器載入。"],
    extensionDownload: ["Download extension source ZIP", "下載擴充功能來源 ZIP"],
    extensionMetadata: ["Manifest V3 · ZIP · {size} bytes · SHA-256 {sha256}", "Manifest V3 · ZIP · {size} bytes · SHA-256 {sha256}"],
    extensionUnpairedWarning: ["Unpaired ZIP warning: this public ZIP has an empty pairing module. It cannot capture downloads until the desktop app's Install browser extension action prepares the private paired folder.", "未配對 ZIP 提示：呢個公開 ZIP 內置空白配對模組；要等桌面程式嘅「Install browser extension」準備好私密配對資料夾，先可以捕捉下載。"],
    extensionStepOne: ["Download this ZIP and extract it to a local folder.", "下載呢個 ZIP，解壓去本機資料夾。"],
    extensionStepTwo: ["In the desktop app, choose Settings → Downloads → Install browser extension. It prepares the paired folder and opens that exact folder.", "喺桌面程式揀 Settings → Downloads → Install browser extension；程式會準備配對資料夾，同埋開返嗰個資料夾。"],
    extensionStepThree: ["Open your browser's extensions page, enable Developer mode, choose Load unpacked, and select the app-prepared folder.", "開瀏覽器擴充功能頁，開啟 Developer mode，揀 Load unpacked，再揀程式準備好嘅資料夾。"],
    extensionUnavailable: ["The extension action stays hidden because this release does not expose a complete verified ZIP record.", "擴充功能操作暫時隱藏，因為呢個版本未有完整驗證過嘅 ZIP 紀錄。"],
    builtAround: ["BUILT AROUND THE WORK", "圍住實際工作起屋"],
    spotlightTitle: ["The useful bits have a paper trail.", "有用嘅嘢，留低晒腳印。"],
    spotlightOne: ["Range transfers and queue schedules stay bounded.", "分段傳輸同隊列時間表有界有數。"],
    spotlightTwo: ["Destructive actions show exact scope before they run.", "破壞性操作行之前先講清楚影響範圍。"],
    spotlightThree: ["Search and history stay local and exportable.", "搜尋同歷史留喺本地，仲可以匯出。"],
    readAllArticles: ["Read all articles", "睇晒啲文章"],
    smallDelight: ["A SMALL DELIGHT", "細細份開心"],
    featureIndex: ["FEATURE INDEX", "功能索引"],
    featureIndexTitle: ["Feature articles and coverage status.", "功能文章，同覆蓋狀態。"],
    featureIndexLede: ["Search the feature articles locally. Each article keeps its coverage boundary visible; plain text is the default and the builder is there when the exact shape matters.", "本地搜尋功能文章；每篇文章都保留覆蓋範圍，純文字係預設，想精準啲就開正則建構器。"],
    filterByCategory: ["Filter by category", "按分類篩選"],
    regexBuilder: ["Regex builder", "正則建構器"],
    selectArticle: ["Select an article", "揀一篇文章"],
    selectArticleHint: ["Choose a feature card to read behavior, configuration, failure modes, security, verification, and suggested articles.", "揀功能卡片，就可以睇行為、設定、失敗處理、安全、驗證同推薦文章。"],
    articleStatus: ["Feature article", "功能文章"],
    releaseHistory: ["RELEASE HISTORY", "版本歷史"],
    changelogTitle: ["Changelog and release evidence.", "更新紀錄，同版本證據。"],
    changelogLede: ["Only recorded releases appear here. Missing dates and unavailable installers stay visible as missing facts.", "呢度只列有紀錄嘅版本；日期缺失同安裝程式未有，都會老老實實講。"],
    copyView: ["Copy view", "複製畫面"],
    downloadMarkdown: ["Download Markdown", "下載 Markdown"],
    releaseDateFilter: ["Release date filter", "版本日期篩選"],
    releaseDateHelp: ["Entries without a recorded date remain visible and are labelled as unrecorded.", "冇紀錄日期嘅項目照樣顯示，並且標明未有日期。"],
    clearDate: ["Clear date", "清除日期"],
    siteSettings: ["SITE SETTINGS", "網站設定"],
    settingsTitle: ["Make the docs feel like yours.", "將文件頁整到啱你口味。"],
    settingsLede: ["Preferences are local to this browser. Every control states what it changes and where its current value came from.", "偏好只留喺呢個瀏覽器；每個控制都講清楚改乜，同埋個值由邊度嚟。"],
    resetAll: ["Reset all", "全部重設"],
    funnyDisclosure: ["Funny levels style all site messages, including warnings and errors. They change voice, never facts, and can be reset at any time.", "幽默程度會套用到所有網站訊息，包括警告同錯誤；只改語氣，唔改事實，隨時可以重設。"],
    emojiToggleTitle: ["Message decorations", "訊息裝飾"],
    emojiToggleExplanation: ["Show a small decorative emoji in notifications and decision messages. It never changes facts, control labels, or accessible names.", "喺通知同決定訊息加細細個裝飾 emoji；唔會改事實、控制標籤或者無障礙名稱。"],
    emojiToggleLabel: ["Show emojis in messages", "喺訊息顯示 emoji"],
    notificationCentre: ["NOTIFICATION CENTRE", "通知中心"],
    notificationCentreOpen: ["Notification centre", "通知中心"],
    notificationCentreTitle: ["Review notifications", "檢視通知"],
    notificationCentreDescription: ["Dismissed messages stay here until you delete them. Search and filter the local history without sending it anywhere.", "已收起嘅訊息會留喺度，直到你刪除佢哋；搜尋同篩選只喺本機進行，唔會送去任何地方。"],
    notificationCentreClose: ["Close notification centre", "關閉通知中心"],
    notificationCentreBulkActions: ["Notification history bulk actions", "通知紀錄批量操作"],
    notificationHistoryLabel: ["Notification history", "通知紀錄"],
    notificationSelect: ["Select notification", "選取通知"],
    notificationSearchLabel: ["Search notification history", "搜尋通知紀錄"],
    notificationSearchPlaceholder: ["Search notification history", "搜尋通知紀錄"],
    notificationFilter: ["View", "檢視"],
    notificationFilterAll: ["All messages", "全部訊息"],
    notificationFilterActive: ["Active only", "只顯示未收起"],
    notificationFilterDismissed: ["Dismissed only", "只顯示已收起"],
    notificationFilterErrors: ["Warnings and errors", "警告同錯誤"],
    notificationSelectAll: ["Select visible", "選取目前顯示"],
    notificationSelectInverse: ["Invert selection", "反轉選取"],
    notificationBulkDismiss: ["Dismiss selected", "收起選取項目"],
    notificationBulkDelete: ["Delete selected", "刪除選取項目"],
    notificationExport: ["Export visible", "匯出目前顯示"],
    notificationHistoryEmpty: ["No notifications match this view.", "呢個檢視冇符合嘅通知。"],
    notificationActive: ["Active", "未收起"],
    notificationDismissed: ["Dismissed", "已收起"],
    notificationDismiss: ["Dismiss", "收起"],
    notificationSelectedStatus: ["{selected} selected · {visible} visible", "已選 {selected} 項 · 顯示緊 {visible} 項"],
    notificationHistoryCount: ["{count} notifications", "{count} 個通知"],
    notificationActiveCount: ["{count} active notifications", "{count} 個未收起通知"],
    notificationNoSelection: ["Select one or more visible notifications first.", "請先選取一個或者多個目前顯示嘅通知。"],
    notificationDismissedResult: ["{count} notifications dismissed", "已收起 {count} 個通知"],
    notificationDismissedSkipped: ["{count} notifications dismissed; {skipped} were already dismissed.", "已收起 {count} 個通知；另外 {skipped} 個之前已經收起。"],
    notificationDeletedResult: ["{count} notifications deleted", "已刪除 {count} 個通知"],
    notificationDeleteStale: ["The selection changed in another tab. Review it again before deleting.", "另一個分頁改咗選取內容；請重新核對先再刪除。"],
    notificationPersistenceUnavailable: ["Browser storage is unavailable; this change is only in memory.", "瀏覽器儲存用唔到；今次改動只留喺記憶體。"],
    notificationExportedResult: ["The visible notification history was exported locally.", "目前顯示嘅通知紀錄已經喺本機匯出。"],
    notificationDeleteTitle: ["Delete selected notifications?", "刪除選取嘅通知？"],
    notificationDeleteDescription: ["This permanently removes the selected local history records. Review the count before continuing.", "呢個動作會永久刪除選取嘅本機紀錄；繼續之前請核對數量。"],
    notificationDeleteAck: ["I understand these records will be deleted.", "我明白呢啲紀錄會被刪除。"],
    notificationDeletePhrase: ["Type DELETE to continue", "輸入 DELETE 先可以繼續"],
    notificationDeleteRequired: ["Both the acknowledgement and the exact word DELETE are required.", "要同時確認同輸入正確嘅 DELETE。"],
    notificationDeleteCancel: ["Cancel", "取消"],
    notificationDeleteConfirm: ["Delete permanently", "永久刪除"],
    schoolModeTitle: ["School mode", "學校模式"],
    schoolModeNameLabel: ["Mode name", "模式名稱"],
    schoolModeToggleLabel: ["Use this mode", "使用呢個模式"],
    schoolModeExplanation: ["This user-named mode keeps the site in English and removes playful language, Cantonese options, funny-level controls, and the dim sum surprise while it is on. It is a user-experience setting, not a security boundary.", "呢個由你改名嘅模式開啟後會用英文，並移除玩味語氣、粵語選項、幽默程度控制同點心驚喜。佢係使用體驗設定，唔係安全邊界。"],
    schoolModeRecovery: ["To clear a forgotten mode name or reset state, clear this site's browser storage. Nothing is sent anywhere.", "如果忘記模式名稱或者想重設狀態，可以清除呢個網站嘅瀏覽器儲存；資料唔會送去任何地方。"],
    schoolModeReset: ["Reset mode name and state", "重設模式名稱同狀態"],
    schoolModeOn: ["{name} is on", "{name} 已開啟"],
    schoolModeOff: ["{name} is off", "{name} 已關閉"],
    languageModeEyebrow: ["LANGUAGE MODE", "語言模式"],
    languageModeTitle: ["Choose the reading voice.", "揀你想點樣讀。"],
    languageExplanation: ["Controls the primary language of every label on this site. Bilingual mode keeps English prominent and adds a compact Cantonese counterpart.", "控制網站所有標籤嘅主要語言；雙語模式保留英文主標，同時加一行精簡粵語。"],
    themeEyebrow: ["THEME", "主題"],
    themeTitle: ["Choose a surface.", "揀個表面。"],
    themeExplanation: ["Applies a light, dark, or operating-system theme to the site shell, tabs, overlays, and cards.", "將淺色、深色或者跟隨系統套用到網站、分頁、浮層同卡片。"],
    themeLabel: ["Theme", "主題"],
    densityEyebrow: ["DENSITY", "密度"],
    densityTitle: ["Set the breathing room.", "調校留白位。"],
    densityExplanation: ["Changes card padding, tab height, and grid spacing without changing information or control reachability.", "改卡片內距、分頁高度同網格間距，但唔會刪資料或者縮走控制。"],
    accentEyebrow: ["ACCENT", "強調色"],
    accentTitle: ["Tune the signal color.", "調校訊號色。"],
    accentExplanation: ["Sets the seed color used by focus rings, primary actions, links, and highlighted search results.", "設定焦點圈、主要按鈕、連結同搜尋結果嘅種子色。"],
    accentLabel: ["Accent seed color", "強調種子色"],
    typographyEyebrow: ["TYPOGRAPHY", "字體"],
    typographyTitle: ["Keep type comfortable.", "字體睇得舒服。"],
    typographyExplanation: ["Adjusts the site font scale while keeping system and CJK-safe fallbacks local.", "調校網站字體比例，同時保留本地系統及中日韓安全後備字體。"],
    fontScaleLabel: ["Font scale", "字體比例"],
    motionEyebrow: ["ACCESSIBILITY", "無障礙"],
    motionTitle: ["Respect reduced motion.", "尊重減少動態。"],
    motionExplanation: ["Turns decorative transitions off while preserving state, focus, and feedback.", "關閉裝飾性轉場，但保留狀態、焦點同回饋。"],
    reducedMotionLabel: ["Reduce motion", "減少動態"],
    tabDockEyebrow: ["TAB DOCK", "分頁停泊邊"],
    tabDockTitle: ["Choose the strip edge.", "揀分頁條停邊。"],
    tabDockExplanation: ["Docks the site tab strip to the left or top. Keyboard arrow behavior follows the chosen orientation.", "將分頁條放左邊或者上面；鍵盤方向鍵會跟住方向轉。"],
    displayNameEyebrow: ["DISPLAY NAME", "顯示名稱"],
    displayNameTitle: ["Name the site shell.", "幫網站外殼改名。"],
    displayNameExplanation: ["Changes the name shown in this page's brand and notifications only; it never changes repository or release identity.", "只改頁面品牌同通知顯示名稱；唔會改倉庫、資料夾或者版本身份。"],
    displayNameLabel: ["Displayed name", "顯示名稱"],
    appearanceEditorSummary: ["Appearance editor · per-surface preview", "外觀編輯器 · 每個表面有預覽"],
    appearanceEditorExplanation: ["This editor changes the site surfaces it names, persists each choice, and keeps a reset path beside every control.", "呢個編輯器會改指定網站表面、保存每個選擇，亦會喺旁邊保留重設方法。"],
    appearanceTarget: ["Target surface", "目標表面"],
    appearanceSurfaceColor: ["Surface accent", "表面強調色"],
    appearanceRadius: ["Corner radius", "角位半徑"],
    appearanceSpacing: ["Spacing scale", "間距比例"],
    appearancePreview: ["Preview follows the selected target.", "預覽會跟住你揀嘅目標。"],
    resetAppearance: ["Reset appearance overrides", "重設外觀覆寫"],
    tabDiscoverySummary: ["Tab discovery lab · four independent searches", "分頁搜尋實驗室 · 四個獨立搜尋"],
    tabDiscoveryExplanation: ["Each field owns its query, pattern, flags, and builder state. Results identify the strip, group, and pinned state instead of sharing hidden search state.", "每個欄位都有自己嘅查詢、模式、旗標同建構器狀態；結果會講清楚分頁條、群組同釘選狀態。"],
    aboutEyebrow: ["ABOUT THIS SURFACE", "關於呢個表面"],
    aboutTitle: ["A static site that tells the truth.", "一個老實嘅靜態網站。"],
    aboutLede: ["The site is a local documentation artifact, not a claim that GitHub Pages or a stable installer is already published.", "呢個網站係本地文件產物，唔代表 GitHub Pages 或穩定版安裝程式已經發佈。"],
    publicationEyebrow: ["PUBLICATION", "發佈狀態"],
    publicationTitle: ["Pages status is unverified.", "Pages 狀態未驗證。"],
    publicationBody: ["The source checkout carries a fail-closed publication baseline. The Pages workflow injects the verified URL and release manifest into the deployed site.", "source checkout 保持 fail-closed 發佈基線；Pages workflow 會將驗證過嘅網址同 release manifest 注入已部署網站。"],
    publicationDetail: ["Publication: not claimed", "發佈：未確認"],
    verificationEyebrow: ["VERIFICATION", "驗證"],
    verificationTitle: ["Small checks, concrete evidence.", "細細個檢查，實實在在證據。"],
    verificationOne: ["The static check audits local assets and article coverage.", "靜態檢查會數本地素材同文章覆蓋。"],
    verificationTwo: ["The build copies to a temporary directory outside the checkout.", "建置會複製去 checkout 之外嘅暫存目錄。"],
    verificationThree: ["The installer control is created only from verified stable metadata.", "安裝程式控制只會由驗證過嘅穩定 metadata 建立。"],
    reviewSettings: ["Review settings", "檢視設定"],
    docsMapEyebrow: ["DOCUMENTATION MAP", "文件地圖"],
    docsMapTitle: ["Feature articles stay connected.", "功能文章互相接得返。"],
    docsMapBody: ["The feature index mirrors the categorized Markdown under docs/features/. Suggested-article links are local and keep the reader in the same surface.", "功能索引對應 docs/features/ 底下嘅分類 Markdown；推薦文章用本地連結，讀者唔使跳走。"],
    commandPaletteEyebrow: ["COMMAND PALETTE", "指令總匯"],
    commandPaletteTitle: ["Go somewhere useful.", "去一個有用嘅地方。"],
    commandPaletteHelp: ["Search features, tabs, settings, and actions. Enter opens the exact destination.", "搜尋功能、分頁、設定同操作；按 Enter 直達正確位置。"],
    tabAppearanceTitle: ["Edit tab appearance", "編輯分頁外觀"],
    tabAppearanceExplanation: ["Customize the selected tab's accent and shape. The editor stays local to this browser.", "自訂所選分頁嘅強調色同形狀；編輯只留喺呢個瀏覽器。"],
    tabAccent: ["Tab accent", "分頁強調色"],
    tabRadius: ["Tab radius", "分頁角位半徑"],
    resetTabAppearance: ["Reset selected tab", "重設所選分頁"],
    featureSearchPlaceholder: ["Search feature articles", "搜尋功能文章"],
    changelogSearchPlaceholder: ["Search changelog", "搜尋更新紀錄"],
    settingsSearchPlaceholder: ["Search site settings", "搜尋網站設定"],
    paletteSearchPlaceholder: ["Search commands", "搜尋指令"],
    currentStripPlaceholder: ["Current strip", "目前分頁條"],
    insideGroupsPlaceholder: ["Inside groups", "群組內分頁"],
    groupNamesPlaceholder: ["Group names", "群組名稱"],
    masterTabPlaceholder: ["Master tab search", "全部分頁搜尋"]
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase();

  function normalizeLabel(value, fallback, maxLength) {
    return settingsContract.normalizeLabel(value, fallback, maxLength);
  }

  function normalizeSettings(parsed) {
    return settingsContract.normalizeSettingsRecord(parsed, DEFAULTS, DEFAULT_SCHOOL_MODE_NAME, content.product.name);
  }

  function normalizeNotificationText(value, fallback, maxLength) {
    return notificationContract.normalizeText(value, fallback, maxLength);
  }

  function makeNotificationId() {
    try { if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch (_error) { /* fall through to a bounded local id */ }
    notificationCounter += 1;
    return `notification-${Date.now().toString(36)}-${notificationCounter.toString(36)}`;
  }

  function normalizeNotificationRecord(record, index) {
    return notificationContract.normalizeRecord(record, index);
  }

  function readNotificationState() {
    let parsed = null;
    try {
      const raw = localStorage.getItem(NOTIFICATION_HISTORY_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (_error) {
      parsed = null;
    }
    const sourceRecords = Array.isArray(parsed?.records) ? parsed.records : [];
    const records = notificationContract.normalizeRecords(sourceRecords, NOTIFICATION_LIMIT);
    const view = parsed?.view && typeof parsed.view === "object" ? parsed.view : {};
    const mode = view.mode === "regex" ? "regex" : "text";
    const flags = String(view.flags || "g").replace(/[^gimsuy]/g, "").split("").filter((value, index, values) => values.indexOf(value) === index).join("") || "g";
    return {
      schemaVersion: 1,
      revision: Number.isSafeInteger(parsed?.revision) && parsed.revision >= 0 ? parsed.revision : 0,
      records,
      view: {
        filter: NOTIFICATION_FILTERS.includes(view.filter) ? view.filter : "all",
        mode,
        query: String(view.query || "").slice(0, 256),
        pattern: String(view.pattern || "").slice(0, 2048),
        flags
      }
    };
  }

  function saveNotificationState() {
    if (!notificationState) return false;
    notificationState.records = notificationState.records.slice(-NOTIFICATION_LIMIT);
    notificationState.revision = Number(notificationState.revision || 0) + 1;
    try {
      localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify({
        schemaVersion: 1,
        revision: notificationState.revision,
        records: notificationState.records,
        view: notificationState.view
      }));
      return true;
    } catch (_error) {
      // Private browsing can refuse persistence; keep the live surface honest.
      if (notificationCentreOpen) setNotificationStatus(localized("notificationPersistenceUnavailable"));
      return false;
    }
  }

  function readSettings() {
    for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return normalizeSettings(JSON.parse(raw));
      } catch (_error) {
        // A malformed newer record must not prevent a valid older record from migrating.
      }
    }
    return normalizeSettings(null);
  }

  function saveSettings() {
    settings = { ...settings, schemaVersion: SETTINGS_SCHEMA_VERSION, revision: Number(settings.revision || 0) + 1 };
    window.settings = settings;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_error) { /* Private browsing can refuse persistence; the UI still works. */ }
  }

  function clamp(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function validHex(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }

  function isSchoolMode() { return settings.schoolMode?.enabled === true; }
  function schoolModeLabel() { return settings.schoolMode?.name || DEFAULT_SCHOOL_MODE_NAME; }
  function effectiveLanguage() { return isSchoolMode() ? "en" : settings.language; }
  function effectiveShowEmojis() { return !isSchoolMode() && settings.showEmojis === true; }

  function schoolSafeText(value) {
    return settingsContract.filterSchoolCopy(value, settings, schoolModeLabel());
  }

  function localized(key) {
    const pair = COPY[key] || [key, key];
    if (effectiveLanguage() === "yue") return pair[1];
    if (effectiveLanguage() === "bilingual") return `${pair[0]} · ${pair[1]}`;
    return pair[0];
  }

  function applyTranslations() {
    $$('[data-copy]').forEach((element) => { element.textContent = localized(element.dataset.copy); });
    $$('[data-copy-placeholder]').forEach((element) => { element.placeholder = localized(element.dataset.copyPlaceholder); });
    $$('[data-copy-aria]').forEach((element) => { element.setAttribute("aria-label", localized(element.dataset.copyAria)); });
    root.lang = effectiveLanguage() === "yue" ? "zh-Hant" : "en";
    const section = effectiveLanguage() === "yue" ? "文件" : "Documentation";
    document.title = isSchoolMode() ? `${settings.displayName || DEFAULTS.displayName} · ${schoolModeLabel()}` : `${settings.displayName || DEFAULTS.displayName} · ${section}`;
  }

  function hexRgb(hex) {
    const value = hex.replace("#", "");
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  }

  function applySettings() {
    const rgb = hexRgb(settings.accent);
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    root.dataset.theme = settings.theme;
    root.dataset.density = settings.density;
    root.dataset.tabPosition = settings.tabPosition;
    root.dataset.reducedMotion = settings.reducedMotion ? "true" : "false";
    root.dataset.schoolMode = isSchoolMode() ? "true" : "false";
    root.dataset.showEmojis = effectiveShowEmojis() ? "true" : "false";
    root.style.setProperty("--font-scale", String(settings.fontScale / 100));
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--accent-strong", settings.accent);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${settings.accent} ${luminance > .58 ? 18 : 28}%, var(--surface-container))`);
    root.style.setProperty("--on-accent", luminance > .58 ? "#1d1b20" : "#ffffff");
    const strip = $("#tab-strip");
    strip.setAttribute("aria-orientation", settings.tabPosition === "top" ? "horizontal" : "vertical");
    $("#brand-name").textContent = settings.displayName || DEFAULTS.displayName;
    applyAppearanceOverrides();
    renderReleaseGate();
    applyTranslations();
    applySchoolModeSurface();
    renderSettingsControls();
  }

  function setSetting(key, value, announce = true) {
    settings = { ...settings, [key]: value };
    saveSettings();
    applySettings();
    if (announce) notify("success", "Setting updated", `${key} is now ${String(value)}.`);
  }

  function setSchoolMode(enabled, announce = true) {
    settings = { ...settings, schoolMode: { ...settings.schoolMode, enabled: Boolean(enabled) } };
    saveSettings();
    applySettings();
    if (isSchoolMode()) {
      clearNotifications();
      const surprise = $("#dim-sum-surprise");
      if (surprise) surprise.hidden = true;
    }
    if (announce && !isSchoolMode()) notify("success", `${schoolModeLabel()} updated`, `${schoolModeLabel()} is now off. Your saved language and funny-level choices are restored.`);
  }

  function setSchoolModeName(value) {
    const name = normalizeLabel(value, DEFAULT_SCHOOL_MODE_NAME, 48);
    settings = { ...settings, schoolMode: { ...settings.schoolMode, name } };
    saveSettings();
    applySettings();
  }

  function resetSchoolMode() {
    settings = { ...settings, schoolMode: { enabled: false, name: DEFAULT_SCHOOL_MODE_NAME } };
    saveSettings();
    applySettings();
    notify("success", "Mode reset", "The mode name is back to its shipped value and the mode is off.");
  }

  function clearNotificationTimer(id) {
    if (!notificationTimers.has(id)) return;
    clearTimeout(notificationTimers.get(id));
    notificationTimers.delete(id);
  }

  function clearAllNotificationTimers() {
    notificationTimers.forEach((timer) => clearTimeout(timer));
    notificationTimers.clear();
  }

  function removeNotificationToast(id) {
    clearNotificationTimer(id);
    const region = $("#notification-region");
    const toast = region ? $$(".notification", region).find((item) => item.dataset.notificationId === id) : null;
    if (toast) toast.remove();
  }

  function clearNotifications() {
    const region = $("#notification-region");
    const ids = new Set(region ? $$(".notification", region).map((item) => item.dataset.notificationId).filter(Boolean) : []);
    notificationTimers.forEach((_timer, id) => ids.add(id));
    let changed = false;
    ids.forEach((id) => {
      const record = notificationState.records.find((item) => item.id === id);
      if (record && !record.dismissed) { record.dismissed = true; changed = true; }
    });
    clearAllNotificationTimers();
    if (changed) saveNotificationState();
    if (region) region.replaceChildren();
    updateNotificationCount();
    renderNotificationCentre();
  }

  function formatNotificationTime(value) {
    try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch (_error) { return "Time unavailable"; }
  }

  function notificationSearchValue(record) {
    return `${record.title} ${record.message} ${record.tone} ${record.dismissed ? "dismissed" : "active"} ${record.createdAt}`;
  }

  function visibleNotificationRecords() {
    const filter = notificationState.view.filter;
    return notificationState.records.filter((record) => {
      if (filter === "active" && record.dismissed) return false;
      if (filter === "dismissed" && !record.dismissed) return false;
      if (filter === "errors" && !["warning", "error"].includes(record.tone)) return false;
      return searchMatches("notifications", notificationSearchValue(record));
    });
  }

  function setNotificationStatus(message) {
    const status = $("#notification-centre-status");
    if (status) status.textContent = message;
  }

  function notificationStatusCopy(selected, visible) {
    return localized("notificationSelectedStatus").replace("{selected}", String(selected)).replace("{visible}", String(visible));
  }

  function updateNotificationCount() {
    const count = notificationState.records.filter((record) => !record.dismissed).length;
    const badge = $("#notification-centre-count");
    if (badge) {
      badge.textContent = String(count);
      badge.setAttribute("aria-label", localized("notificationActiveCount").replace("{count}", String(count)));
    }
  }

  function selectedVisibleNotificationRecords(records = visibleNotificationRecords()) {
    const visibleIds = new Set(records.map((record) => record.id));
    return notificationState.records.filter((record) => visibleIds.has(record.id) && notificationState.selected.has(record.id));
  }

  function setNotificationSelection(id, selected) {
    if (selected) notificationState.selected.add(id);
    else notificationState.selected.delete(id);
    renderNotificationCentre();
  }

  function selectAllVisibleNotifications() {
    visibleNotificationRecords().forEach((record) => notificationState.selected.add(record.id));
    renderNotificationCentre();
  }

  function invertVisibleNotificationSelection() {
    visibleNotificationRecords().forEach((record) => {
      if (notificationState.selected.has(record.id)) notificationState.selected.delete(record.id);
      else notificationState.selected.add(record.id);
    });
    renderNotificationCentre();
  }

  function dismissNotification(id, announce = false) {
    const record = notificationState.records.find((item) => item.id === id);
    clearNotificationTimer(id);
    if (!record || record.dismissed) return false;
    record.dismissed = true;
    saveNotificationState();
    removeNotificationToast(id);
    updateNotificationCount();
    renderNotificationCentre();
    if (announce) setNotificationStatus(localized("notificationDismissedResult").replace("{count}", "1"));
    return true;
  }

  function bulkDismissNotifications() {
    const visible = visibleNotificationRecords();
    const selected = selectedVisibleNotificationRecords(visible);
    if (!selected.length) { setNotificationStatus(localized("notificationNoSelection")); return; }
    const active = selected.filter((record) => !record.dismissed);
    const skipped = selected.length - active.length;
    if (!active.length) {
      notificationState.selected.clear();
      renderNotificationCentre();
      setNotificationStatus(localized("notificationDismissedSkipped").replace("{count}", "0").replace("{skipped}", String(skipped)));
      return;
    }
    active.forEach((record) => { record.dismissed = true; });
    notificationState.selected.clear();
    saveNotificationState();
    active.forEach((record) => removeNotificationToast(record.id));
    updateNotificationCount();
    renderNotificationCentre();
    const resultKey = skipped ? "notificationDismissedSkipped" : "notificationDismissedResult";
    setNotificationStatus(localized(resultKey).replace("{count}", String(active.length)).replace("{skipped}", String(skipped)));
  }

  function updateNotificationDeleteControls() {
    const acknowledge = $("#notification-delete-ack")?.checked === true;
    const phrase = $("#notification-delete-phrase")?.value === NOTIFICATION_DELETE_PHRASE;
    const confirm = $("#notification-delete-confirm-button");
    if (confirm) confirm.disabled = !(acknowledge && phrase);
  }

  function setNotificationDeleteModalState(active) {
    const centre = $("#notification-centre");
    const dialog = $("#notification-delete-confirm");
    if (!centre || !dialog) return;
    centre.dataset.deleteOpen = active ? "true" : "false";
    $$(":scope > *", centre).forEach((child) => {
      if (child === dialog) return;
      if (active) {
        child.setAttribute("inert", "");
        child.setAttribute("aria-hidden", "true");
      } else {
        child.removeAttribute("inert");
        child.removeAttribute("aria-hidden");
      }
    });
  }

  function closeNotificationDeleteConfirm(restoreFocus = true) {
    const dialog = $("#notification-delete-confirm");
    if (dialog) dialog.hidden = true;
    setNotificationDeleteModalState(false);
    notificationDeleteIds = [];
    notificationDeleteRevision = null;
    if (restoreFocus && notificationDeleteOrigin?.isConnected) notificationDeleteOrigin.focus();
    notificationDeleteOrigin = null;
  }

  function openNotificationDeleteConfirm() {
    const selected = selectedVisibleNotificationRecords();
    if (!selected.length) { setNotificationStatus(localized("notificationNoSelection")); return; }
    notificationDeleteIds = selected.map((record) => record.id);
    notificationDeleteRevision = Number(notificationState.revision || 0);
    notificationDeleteOrigin = document.activeElement;
    const dialog = $("#notification-delete-confirm");
    if (!dialog) return;
    dialog.hidden = false;
    setNotificationDeleteModalState(true);
    $("#notification-delete-ack").checked = false;
    $("#notification-delete-phrase").value = "";
    updateNotificationDeleteControls();
    $("#notification-delete-ack").focus();
  }

  function confirmNotificationDelete() {
    updateNotificationDeleteControls();
    if ($("#notification-delete-confirm-button")?.disabled) return;
    if (notificationDeleteRevision !== null && notificationDeleteRevision !== Number(notificationState.revision || 0)) {
      closeNotificationDeleteConfirm();
      renderNotificationCentre();
      setNotificationStatus(localized("notificationDeleteStale"));
      return;
    }
    const ids = new Set(notificationDeleteIds);
    const deleted = notificationState.records.filter((record) => ids.has(record.id)).length;
    const origin = notificationDeleteOrigin;
    ids.forEach((id) => removeNotificationToast(id));
    notificationState.records = notificationState.records.filter((record) => !ids.has(record.id));
    notificationState.selected.clear();
    saveNotificationState();
    closeNotificationDeleteConfirm(false);
    updateNotificationCount();
    renderNotificationCentre();
    setNotificationStatus(localized("notificationDeletedResult").replace("{count}", String(deleted)));
    if (origin?.isConnected) origin.focus();
    else $("#notification-bulk-delete")?.focus();
  }

  function exportVisibleNotifications() {
    const visible = visibleNotificationRecords();
    const payload = notificationContract.buildExport(visible, notificationState.view);
    downloadFile("notification-history.json", `${JSON.stringify(payload, null, 2)}\n`, "application/json");
    setNotificationStatus(localized("notificationExportedResult"));
  }

  function renderNotificationCentre() {
    const centre = $("#notification-centre");
    const list = $("#notification-list");
    const empty = $("#notification-empty");
    if (!centre || !list || !empty) return;
    updateNotificationCount();
    if (isSchoolMode()) {
      centre.hidden = true;
      notificationCentreOpen = false;
      $("#notification-centre-open")?.setAttribute("aria-expanded", "false");
      list.replaceChildren();
      empty.hidden = true;
      return;
    }
    centre.hidden = !notificationCentreOpen;
    const visible = visibleNotificationRecords();
    const selected = selectedVisibleNotificationRecords(visible).length;
    list.replaceChildren();
    empty.hidden = visible.length > 0;
    visible.forEach((record) => {
      const item = create("li", `notification-record${record.dismissed ? " is-dismissed" : ""}`);
      item.dataset.notificationId = record.id;
      const selectLabel = create("label", "notification-select-row");
      const checkbox = create("input");
      checkbox.type = "checkbox";
      checkbox.className = "notification-select";
      checkbox.checked = notificationState.selected.has(record.id);
      checkbox.setAttribute("aria-label", `${localized("notificationSelect")}: ${record.title}`);
      checkbox.addEventListener("change", () => setNotificationSelection(record.id, checkbox.checked));
      selectLabel.append(checkbox);
      item.append(selectLabel);
      const marker = create("span", `signal-dot ${record.tone}`, effectiveShowEmojis() ? (record.tone === "success" ? "✅" : record.tone === "error" || record.tone === "warning" ? "⚠️" : "💬") : "");
      marker.setAttribute("aria-hidden", "true");
      marker.dataset.decorative = "true";
      item.append(marker);
      const body = create("div", "notification-record-copy");
      const titleId = `notification-title-${record.id}`;
      const messageId = `notification-message-${record.id}`;
      const title = create("strong", "notification-title", schoolSafeText(record.title));
      title.id = titleId;
      const message = create("span", "notification-message", schoolSafeText(record.message));
      message.id = messageId;
      body.append(title, message);
      const meta = create("span", "notification-record-meta", `${formatNotificationTime(record.createdAt)} · ${record.dismissed ? localized("notificationDismissed") : localized("notificationActive")}`);
      body.append(meta);
      item.append(body);
      const actions = create("div", "notification-record-actions");
      if (!record.dismissed) {
        const dismiss = create("button", "text-button", localized("notificationDismiss"));
        dismiss.type = "button";
        dismiss.setAttribute("aria-label", `${localized("notificationDismiss")}: ${record.title}`);
        dismiss.addEventListener("click", () => dismissNotification(record.id, true));
        actions.append(dismiss);
      }
      item.append(actions);
      item.setAttribute("aria-describedby", `${titleId} ${messageId}`);
      list.append(item);
    });
    const status = notificationStatusCopy(selected, visible.length);
    setNotificationStatus(status);
  }

  function openNotificationCentre() {
    if (isSchoolMode()) return;
    notificationCentreOrigin = document.activeElement;
    notificationCentreOpen = true;
    $("#notification-centre-open")?.setAttribute("aria-expanded", "true");
    const centre = $("#notification-centre");
    if (!centre) return;
    centre.hidden = false;
    renderNotificationCentre();
    $("#notifications-search")?.focus();
  }

  function closeNotificationCentre(restoreFocus = true) {
    const centre = $("#notification-centre");
    if (centre) centre.hidden = true;
    notificationCentreOpen = false;
    $("#notification-centre-open")?.setAttribute("aria-expanded", "false");
    closeNotificationDeleteConfirm(false);
    if (restoreFocus && notificationCentreOrigin?.isConnected) notificationCentreOrigin.focus();
    notificationCentreOrigin = null;
  }

  function applyIncomingSettings(raw) {
    try {
      const incoming = normalizeSettings(JSON.parse(raw));
      if (incoming.revision <= Number(settings.revision || 0)) return false;
      settings = incoming;
      window.settings = settings;
      applySettings();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function reconcileLiveNotificationToasts(records) {
    const incomingById = new Map(records.map((record) => [record.id, record]));
    const region = $("#notification-region");
    const liveIds = new Set(notificationTimers.keys());
    if (region) $$(".notification", region).forEach((item) => liveIds.add(item.dataset.notificationId));
    liveIds.forEach((id) => {
      const record = incomingById.get(id);
      if (!record || record.dismissed) removeNotificationToast(id);
    });
  }

  function clearNotificationStateFromStorage() {
    clearAllNotificationTimers();
    $("#notification-region")?.replaceChildren();
    notificationState = {
      ...notificationState,
      revision: Number(notificationState.revision || 0) + 1,
      records: [],
      selected: new Set()
    };
    updateNotificationCount();
    renderNotificationCentre();
  }

  function applyIncomingNotificationState(raw) {
    if (raw === null || raw === undefined) {
      clearNotificationStateFromStorage();
      return true;
    }
    try {
      const incoming = JSON.parse(raw);
      const revision = Number(incoming?.revision);
      if (incoming?.schemaVersion !== undefined && incoming.schemaVersion !== 1) return false;
      if (!Number.isSafeInteger(revision) || revision < Number(notificationState.revision || 0)) return false;
      const records = notificationContract.normalizeRecords(incoming.records, NOTIFICATION_LIMIT);
      const view = incoming.view && typeof incoming.view === "object" ? incoming.view : {};
      if (revision === Number(notificationState.revision || 0)) {
        const recordsById = new Map(notificationState.records.map((record) => [record.id, record]));
        records.forEach((record) => recordsById.set(record.id, record));
        const merged = notificationContract.normalizeRecords([...recordsById.values()], NOTIFICATION_LIMIT);
        if (JSON.stringify(merged) === JSON.stringify(notificationState.records)) return false;
        notificationState.records = merged;
        notificationState.selected = new Set();
        reconcileLiveNotificationToasts(merged);
        saveNotificationState();
        updateNotificationCount();
        renderNotificationCentre();
        return true;
      }
      notificationState = {
        schemaVersion: 1,
        revision,
        records,
        selected: new Set(),
        view: {
          filter: NOTIFICATION_FILTERS.includes(view.filter) ? view.filter : "all",
          mode: view.mode === "regex" ? "regex" : "text",
          query: String(view.query || "").slice(0, 256),
          pattern: String(view.pattern || "").slice(0, 2048),
          flags: String(view.flags || "g").replace(/[^gimsuy]/g, "").split("").filter((value, index, values) => values.indexOf(value) === index).join("") || "g"
        }
      };
      reconcileLiveNotificationToasts(records);
      searchStates.notifications.mode = notificationState.view.mode;
      searchStates.notifications.query = notificationState.view.query;
      searchStates.notifications.pattern = notificationState.view.pattern || notificationState.view.query;
      searchStates.notifications.flags = notificationState.view.flags;
      $("#notification-filter").value = notificationState.view.filter;
      $("#notifications-search").value = notificationState.view.query;
      updateNotificationCount();
      renderNotificationCentre();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function bindSettingsSync() {
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) applyIncomingSettings(event.newValue);
      if (event.key === NOTIFICATION_HISTORY_KEY) applyIncomingNotificationState(event.newValue);
    });
  }

  function applyAppearanceOverrides() {
    ["cards", "tabs", "notifications", "hero"].forEach((target) => {
      const value = settings.appearanceOverrides[target] || {};
      if (validHex(value.color)) root.style.setProperty(`--${target}-accent`, value.color);
      else root.style.removeProperty(`--${target}-accent`);
      if (Number.isFinite(Number(value.radius))) root.style.setProperty(`--${target}-radius`, `${clamp(Number(value.radius), 8, 40, 20)}px`);
      else root.style.removeProperty(`--${target}-radius`);
    });
    const tabOverrides = settings.tabOverrides || {};
    $$(".tab-button").forEach((button) => {
      const value = tabOverrides[button.dataset.tab] || {};
      if (validHex(value.color)) button.style.setProperty("--tab-accent", value.color);
      else button.style.removeProperty("--tab-accent");
      if (Number.isFinite(Number(value.radius))) button.style.setProperty("--tab-radius", `${clamp(Number(value.radius), 8, 32, 18)}px`);
      else button.style.removeProperty("--tab-radius");
    });
  }

  function renderSettingsControls() {
    $$('[data-setting]').forEach((button) => button.classList.toggle("is-active", button.dataset.value === String(settings[button.dataset.setting])));
    $("#funny-en").value = String(settings.funnyEn);
    $("#funny-yue").value = String(settings.funnyYue);
    $("#funny-en-output").textContent = `${settings.funnyEn} / 5`;
    $("#funny-yue-output").textContent = `${settings.funnyYue} / 5`;
    $("#theme-setting").value = settings.theme;
    $("#accent-setting").value = settings.accent;
    $("#accent-value").textContent = settings.accent.toUpperCase();
    $("#font-scale").value = String(settings.fontScale);
    $("#reduced-motion").checked = settings.reducedMotion;
    $("#display-name").value = settings.displayName;
    $("#show-emojis").checked = settings.showEmojis;
    if (document.activeElement !== $("#school-mode-name")) $("#school-mode-name").value = schoolModeLabel();
    $("#school-mode-enabled").checked = isSchoolMode();
    renderSchoolControls();
    renderTonePreview();
    renderAppearanceEditor();
    renderTabAppearanceEditor();
    renderProvenance();
  }

  function renderSchoolControls() {
    const name = schoolModeLabel();
    const title = $("#school-mode-title");
    const eyebrow = $("#school-mode-eyebrow");
    const status = $("#school-mode-status");
    const explanation = $("#school-mode-explanation");
    const nameOutput = $("#school-mode-name-output");
    if (title) title.textContent = name;
    if (eyebrow) eyebrow.textContent = name;
    if (nameOutput) nameOutput.textContent = name;
    if (status) {
      status.textContent = (isSchoolMode() ? localized("schoolModeOn") : localized("schoolModeOff")).replace("{name}", name);
      status.dataset.active = String(isSchoolMode());
    }
    if (explanation) explanation.textContent = `${name}: ${localized("schoolModeExplanation")}`;
  }

  function applySchoolModeSurface() {
    const active = isSchoolMode();
    root.dataset.schoolMode = active ? "true" : "false";
    root.dataset.showEmojis = effectiveShowEmojis() ? "true" : "false";
    if (active) clearNotifications();
    $$('[data-school-optional]').forEach((element) => {
      element.hidden = active;
      element.setAttribute("aria-hidden", String(active));
      if (active) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    });
    $$('[data-school-language-option]').forEach((element) => {
      element.hidden = active;
      element.setAttribute("aria-hidden", String(active));
      if (active) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    });
    const surprise = $("#dim-sum-surprise");
    if (active && surprise) surprise.hidden = true;
    if (active && document.activeElement?.closest?.("[data-school-optional], [data-school-language-option]")) {
      $("#school-mode-enabled")?.focus();
    }
    renderSchoolControls();
    if (typeof renderFeatureGrid === "function" && $("#feature-grid")) renderFeatureGrid();
    if (typeof renderArticle === "function" && $("#article-detail")) renderArticle();
    if (typeof renderReleaseList === "function" && $("#release-list")) renderReleaseList();
    if (typeof renderTabDiscovery === "function" && $("#tab-results")) renderTabDiscovery();
    if (typeof renderPalette === "function" && $("#palette-results")) renderPalette();
    if (typeof renderNotificationCentre === "function" && $("#notification-centre")) renderNotificationCentre();
  }

  function renderProvenance() {
    const pairs = {
      language: settings.language !== DEFAULTS.language ? "Persisted in this browser" : "Compiled-in value: English",
      showEmojis: settings.showEmojis !== DEFAULTS.showEmojis ? "Persisted in this browser" : "Compiled-in value: on",
      schoolMode: isSchoolMode() || schoolModeLabel() !== DEFAULT_SCHOOL_MODE_NAME ? `Persisted in this browser: ${schoolModeLabel()}` : `Compiled-in value: ${DEFAULT_SCHOOL_MODE_NAME} (off)`,
      theme: settings.theme !== DEFAULTS.theme ? `Persisted in this browser: ${settings.theme}` : "Compiled-in value: system",
      density: settings.density !== DEFAULTS.density ? `Persisted in this browser: ${settings.density}` : "Compiled-in value: comfortable",
      accent: settings.accent !== DEFAULTS.accent ? `Persisted in this browser: ${settings.accent}` : `Compiled-in value: ${DEFAULTS.accent}`,
      fontScale: settings.fontScale !== DEFAULTS.fontScale ? `Persisted in this browser: ${settings.fontScale}%` : "Compiled-in value: 100%",
      reducedMotion: settings.reducedMotion ? "Persisted in this browser: on" : "Compiled-in value: off",
      tabPosition: settings.tabPosition !== DEFAULTS.tabPosition ? `Persisted in this browser: ${settings.tabPosition}` : "Compiled-in value: left",
      displayName: settings.displayName !== DEFAULTS.displayName ? "Persisted in this browser" : `Compiled-in value: ${DEFAULTS.displayName}`
    };
    Object.entries(pairs).forEach(([key, value]) => {
      const element = $(`[data-provenance="${key}"]`);
      if (element) element.textContent = value;
    });
  }

  function renderTonePreview() {
    if (isSchoolMode()) {
      $("#tone-preview-en").textContent = "";
      $("#tone-preview-yue").textContent = "";
      return;
    }
    const english = [
      "Facts first. Neat, quiet, no confetti.",
      "A tidy local preview; the facts are still in charge.",
      "The copy is friendly, but the evidence is still wearing a badge.",
      "The copy brought a tiny comedy hat; the facts remain fully accounted for.",
      "Maximum sparkle, zero mystery: the facts still wear a seatbelt."
    ][settings.funnyEn - 1];
    const cantonese = [
      "先講事實，安安靜靜，唔整花臣。",
      "本地預覽企企理理，重點照樣清楚。",
      "字句有少少笑位，但證據仲係坐正。",
      "文字戴咗頂細細頂搞笑帽，事實冇走樣。",
      "玩味開到最大，但資料仍然扣好安全帶。"
    ][settings.funnyYue - 1];
    $("#tone-preview-en").textContent = english;
    $("#tone-preview-yue").textContent = cantonese;
  }

  function getAppearanceTarget() { return $("#appearance-target").value; }

  function renderAppearanceEditor() {
    const target = getAppearanceTarget();
    const value = settings.appearanceOverrides[target] || {};
    const color = validHex(value.color) ? value.color : settings.accent;
    const radius = clamp(Number(value.radius), 8, 40, target === "hero" ? 36 : target === "tabs" ? 18 : 20);
    $("#appearance-surface-color").value = color;
    $("#appearance-surface-value").textContent = color.toUpperCase();
    $("#appearance-radius").value = String(radius);
    $("#appearance-radius-output").textContent = `${radius}px`;
    $("#appearance-spacing").value = value.spacing || "comfortable";
    $("#appearance-preview").style.setProperty("--appearance-preview-color", color);
  }

  function updateAppearanceField(field, value) {
    const target = getAppearanceTarget();
    const next = { ...(settings.appearanceOverrides[target] || {}), [field]: value };
    settings = { ...settings, appearanceOverrides: { ...settings.appearanceOverrides, [target]: next } };
    saveSettings();
    applyAppearanceOverrides();
    renderAppearanceEditor();
  }

  function renderTabAppearanceEditor() {
    const value = settings.tabOverrides[contextTabId] || {};
    const color = validHex(value.color) ? value.color : settings.accent;
    const radius = clamp(Number(value.radius), 8, 32, 18);
    $("#tab-accent-setting").value = color;
    $("#tab-accent-value").textContent = color.toUpperCase();
    $("#tab-radius-setting").value = String(radius);
    $("#tab-radius-output").textContent = `${radius}px`;
  }

  function updateTabAppearance(field, value) {
    if (!contextTabId) return;
    const next = { ...(settings.tabOverrides[contextTabId] || {}), [field]: value };
    settings = { ...settings, tabOverrides: { ...settings.tabOverrides, [contextTabId]: next } };
    saveSettings();
    applyAppearanceOverrides();
    renderTabAppearanceEditor();
  }

  function resetSettings() {
    settings = { ...DEFAULTS };
    saveSettings();
    applySettings();
    notify("success", "Settings reset", "The site is back on its compiled-in values.");
  }

  function resetAppearance() {
    settings = { ...settings, appearanceOverrides: {} };
    saveSettings();
    applyAppearanceOverrides();
    renderAppearanceEditor();
    notify("success", "Appearance reset", "Surface overrides have been cleared.");
  }

  function resetTabAppearance() {
    if (!contextTabId) return;
    const next = { ...settings.tabOverrides };
    delete next[contextTabId];
    settings = { ...settings, tabOverrides: next };
    saveSettings();
    applyAppearanceOverrides();
    renderTabAppearanceEditor();
    notify("success", "Tab appearance reset", "The selected tab is using the site appearance again.");
  }

  let activeTab = "overview";
  let currentArticleId = null;
  let categoryFilter = "All";
  let previousFocus = null;
  let paletteIndex = 0;
  let contextTabId = "overview";
  let contextMenuOpen = false;

  function selectTab(tabId, focusPanel = false) {
    const button = $(`#tab-${tabId}`);
    const panel = $(`#panel-${tabId}`);
    if (!button || !panel) return;
    activeTab = tabId;
    $$(".tab-button").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    $$(".tab-panel").forEach((item) => { item.hidden = item !== panel; item.classList.toggle("is-active", item === panel); });
    if (focusPanel) panel.focus({ preventScroll: true });
    closeContextMenu();
  }

  function bindTabs() {
    $$(".tab-button").forEach((button, index, buttons) => {
      button.addEventListener("click", () => selectTab(button.dataset.tab));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTab(button.dataset.tab, true); return; }
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) { event.preventDefault(); openContextMenu(button, event); return; }
        const vertical = settings.tabPosition !== "top";
        const nextKey = vertical ? "ArrowDown" : "ArrowRight";
        const prevKey = vertical ? "ArrowUp" : "ArrowLeft";
        if (event.key === nextKey || event.key === prevKey || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          let nextIndex = index;
          if (event.key === nextKey) nextIndex = (index + 1) % buttons.length;
          if (event.key === prevKey) nextIndex = (index - 1 + buttons.length) % buttons.length;
          if (event.key === "Home") nextIndex = 0;
          if (event.key === "End") nextIndex = buttons.length - 1;
          buttons[nextIndex].focus();
        }
      });
      button.addEventListener("contextmenu", (event) => { event.preventDefault(); openContextMenu(button, event); });
    });
    $$('[data-open-tab]').forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.openTab)));
  }

  function positionFixed(element, x, y) {
    element.hidden = false;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }

  function openContextMenu(button, event) {
    contextTabId = button.dataset.tab;
    contextMenuOpen = true;
    const pinAction = $('[data-context-action="pin"]');
    const pinned = button.dataset.pinned === "true" || button.classList.contains("is-pinned");
    pinAction.textContent = pinned ? "Unpin tab" : "Pin tab";
    positionFixed($("#tab-context-menu"), event.clientX || button.getBoundingClientRect().left, event.clientY || button.getBoundingClientRect().bottom);
  }

  function closeContextMenu() {
    contextMenuOpen = false;
    $("#tab-context-menu").hidden = true;
  }

  function openTabAppearance(event) {
    closeContextMenu();
    const editor = $("#tab-appearance-editor");
    const anchor = $(`#tab-${contextTabId}`);
    renderTabAppearanceEditor();
    editor.hidden = false;
    const rect = anchor.getBoundingClientRect();
    positionFixed(editor, Math.min(rect.right + 10, window.innerWidth - 360), Math.min(rect.top, window.innerHeight - 360));
    $("#tab-accent-setting").focus();
    if (event) event.stopPropagation();
  }

  function bindContextMenu() {
    document.addEventListener("click", (event) => {
      if (contextMenuOpen && !event.target.closest("#tab-context-menu")) closeContextMenu();
      if (!event.target.closest("#tab-appearance-editor") && !event.target.closest(".tab-button")) $("#tab-appearance-editor").hidden = true;
    });
    $$('[data-context-action]').forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.contextAction === "appearance") openTabAppearance();
      if (button.dataset.contextAction === "pin") {
        const tab = $(`#tab-${contextTabId}`);
        const pinned = tab.dataset.pinned === "true" || tab.classList.contains("is-pinned");
        tab.dataset.pinned = String(!pinned);
        tab.classList.toggle("is-pinned", !pinned);
        const dot = $(".pin-dot", tab);
        if (!pinned && !dot) { const pin = create("span", "pin-dot", "•"); pin.setAttribute("aria-label", "Pinned"); tab.append(pin); }
        if (pinned && dot) dot.remove();
        closeContextMenu();
        notify("success", pinned ? "Tab unpinned" : "Tab pinned", `${tab.querySelector(".tab-label").textContent} updated.`);
      }
    }));
    $("#tab-appearance-close").addEventListener("click", () => { $("#tab-appearance-editor").hidden = true; });
    $("#reset-tab-appearance").addEventListener("click", resetTabAppearance);
  }

  function getRegexError(pattern, flags) {
    return notificationContract.regexSafetyError(pattern, flags);
  }

  function validateSearchState(id) {
    const state = searchStates[id];
    state.error = state.mode === "regex" ? getRegexError(state.pattern, state.flags) : null;
    return state.error;
  }

  function searchMatches(id, value) {
    const state = searchStates[id];
    const haystack = String(value ?? "").slice(0, notificationContract.maxInputLength);
    if (state.mode === "text") return !state.query || normalize(haystack).includes(normalize(state.query));
    if (validateSearchState(id)) return false;
    if (!state.pattern) return true;
    try {
      const flags = state.flags.includes("g") ? state.flags : `${state.flags}g`;
      const expression = new RegExp(state.pattern, flags);
      expression.lastIndex = 0;
      return expression.test(haystack);
    } catch (_error) { return false; }
  }

  function extractMatches(pattern, flags, sample) {
    const error = getRegexError(pattern, flags);
    if (error) return { error, matches: [] };
    if (!pattern) return { error: null, matches: [] };
    const expression = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
    const matches = [];
    let match;
    const boundedSample = String(sample ?? "").slice(0, notificationContract.maxInputLength);
    while ((match = expression.exec(boundedSample)) && matches.length < 200) {
      matches.push({ value: match[0], index: match.index, captures: match.slice(1) });
      if (!match[0]) expression.lastIndex += 1;
    }
    return { error: null, matches };
  }

  function updateSearchStateLabel(id) {
    const row = $(`[data-search-id="${id}"]`);
    const label = $(`#${id}-search-state`, row) || $(".search-state", row);
    if (label) label.textContent = searchStates[id].mode === "regex" ? `Regex · ${searchStates[id].flags || "no flags"}` : "Plain text";
  }

  function builderMarkup(id) {
    const state = searchStates[id];
    return `<div class="builder-heading"><div><p class="eyebrow">LOCAL REGEX</p><h3>Build a pattern beside this search</h3></div><span class="status-chip">JavaScript RegExp</span></div>
      <div class="builder-mode-row" role="group" aria-label="Search mode"><span class="builder-label">Mode</span><button class="builder-mode" type="button" data-builder-mode="text">Plain text</button><button class="builder-mode" type="button" data-builder-mode="regex">Regex</button></div>
      <div class="builder-token-row"><span class="builder-label">Insert</span><button class="builder-token" type="button" data-builder-token="literal">literal</button><button class="builder-token" type="button" data-builder-token="class">[a-z]</button><button class="builder-token" type="button" data-builder-token="anchors">^ · $</button><button class="builder-token" type="button" data-builder-token="group">(group)</button><button class="builder-token" type="button" data-builder-token="alternation">one|two</button><button class="builder-token" type="button" data-builder-token="quantifier">x{1,3}</button></div>
      <div class="builder-fields"><label>Pattern<input data-builder-pattern type="text" maxlength="2048" spellcheck="false"></label><label>Flags<input data-builder-flags type="text" maxlength="6" spellcheck="false" aria-describedby="builder-flags-help"><span id="builder-flags-help">g i m s u y</span></label><label>Sample text<textarea data-builder-sample maxlength="100000" spellcheck="false"></textarea></label></div>
      <p class="builder-error" data-builder-error role="status"></p><div class="builder-output"><strong>Live matches</strong><span data-builder-count>0</span><button class="text-button" type="button" data-builder-copy>Copy pattern</button><button class="text-button" type="button" data-builder-export>Export JSON</button></div><div class="builder-matches" data-builder-matches aria-live="polite"></div>`;
  }

  function renderBuilder(id) {
    const row = $(`[data-search-id="${id}"]`);
    if (!row) return;
    const panel = $(".builder-popover", row);
    panel.dataset.builderId = id;
    panel.innerHTML = builderMarkup(id);
    const state = searchStates[id];
    $("[data-builder-pattern]", panel).value = state.pattern;
    $("[data-builder-flags]", panel).value = state.flags;
    $("[data-builder-sample]", panel).value = state.sample;
    $$('[data-builder-mode]', panel).forEach((button) => button.classList.toggle("is-active", button.dataset.builderMode === state.mode));
    updateBuilderResult(id);
  }

  function updateBuilderResult(id) {
    const state = searchStates[id];
    const row = $(`[data-search-id="${id}"]`);
    const panel = $(".builder-popover", row);
    if (!panel || panel.hidden) return;
    const result = extractMatches(state.pattern, state.flags, state.sample.slice(0, 100000));
    const error = result.error;
    state.error = error;
    $("[data-builder-error]", panel).textContent = error || "";
    $("[data-builder-count]", panel).textContent = error ? "0" : String(result.matches.length);
    const list = $("[data-builder-matches]", panel);
    list.replaceChildren();
    if (error) return;
    if (!result.matches.length) { list.append(create("span", "builder-match", state.pattern ? "No matches" : "Enter a pattern to preview matches.")); return; }
    result.matches.slice(0, 20).forEach((match) => {
      const item = create("div", "builder-match");
      item.textContent = `@${match.index}: ${JSON.stringify(match.value)}${match.captures.length ? ` · captures ${JSON.stringify(match.captures)}` : ""}`;
      list.append(item);
    });
  }

  function closeBuilders(exceptId) {
    $$(".builder-popover").forEach((panel) => {
      if (panel.closest(`[data-search-id="${exceptId}"]`)) return;
      panel.hidden = true;
      const toggle = panel.parentElement.querySelector(".builder-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  }

  function toggleBuilder(id) {
    const row = $(`[data-search-id="${id}"]`);
    const panel = $(".builder-popover", row);
    const toggle = $(".builder-toggle", row);
    const opening = panel.hidden;
    closeBuilders(opening ? id : undefined);
    if (opening) {
      renderBuilder(id);
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    } else {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }
  }

  function insertToken(id, token) {
    const state = searchStates[id];
    const tokens = { literal: "text", class: "[a-z]", anchors: "^$", group: "(text)", alternation: "one|two", quantifier: "x{1,3}" };
    state.mode = "regex";
    state.pattern += tokens[token] || "";
    state.query = state.pattern;
    const input = $(`#${id}-search`);
    if (input) input.value = state.pattern;
    renderBuilder(id);
    updateSearchStateLabel(id);
    runSearch(id);
  }

  function bindSearches() {
    $$(".search-row[data-search-id]").forEach((row) => {
      const id = row.dataset.searchId;
      const input = $("input[type='search']", row);
      const toggle = $(".builder-toggle", row);
      if (input) input.addEventListener("input", () => {
        searchStates[id].query = input.value;
        if (searchStates[id].mode === "text") searchStates[id].pattern = input.value;
        else searchStates[id].pattern = input.value;
        updateSearchStateLabel(id);
        runSearch(id);
        updateBuilderResult(id);
      });
      if (toggle) toggle.addEventListener("click", () => toggleBuilder(id));
    });

    document.addEventListener("input", (event) => {
      const control = event.target;
      const panel = control.closest(".builder-popover");
      if (!panel || !panel.dataset.builderId) return;
      const id = panel.dataset.builderId;
      const state = searchStates[id];
      if (control.matches("[data-builder-pattern]")) { state.pattern = control.value; state.query = control.value; const input = $(`#${id}-search`); if (input) input.value = control.value; }
      if (control.matches("[data-builder-flags]")) state.flags = control.value.replace(/[^gimsuy]/g, "").split("").filter((value, index, values) => values.indexOf(value) === index).join("");
      if (control.matches("[data-builder-sample]")) state.sample = control.value.slice(0, 100000);
      updateSearchStateLabel(id);
      updateBuilderResult(id);
      runSearch(id);
    });

    document.addEventListener("click", async (event) => {
      const modeButton = event.target.closest("[data-builder-mode]");
      if (modeButton) {
        const panel = modeButton.closest(".builder-popover");
        const id = panel.dataset.builderId;
        searchStates[id].mode = modeButton.dataset.builderMode;
        searchStates[id].query = $(`#${id}-search`)?.value || searchStates[id].pattern;
        if (searchStates[id].mode === "text") searchStates[id].pattern = searchStates[id].query;
        renderBuilder(id);
        updateSearchStateLabel(id);
        runSearch(id);
        return;
      }
      const tokenButton = event.target.closest("[data-builder-token]");
      if (tokenButton) { insertToken(tokenButton.closest(".builder-popover").dataset.builderId, tokenButton.dataset.builderToken); return; }
      const copyButton = event.target.closest("[data-builder-copy]");
      if (copyButton) {
        const id = copyButton.closest(".builder-popover").dataset.builderId;
        await copyText(searchStates[id].pattern, "Pattern copied");
        return;
      }
      const exportButton = event.target.closest("[data-builder-export]");
      if (exportButton) {
        const id = exportButton.closest(".builder-popover").dataset.builderId;
        const state = searchStates[id];
        downloadFile(`regex-${id}.json`, JSON.stringify({ dialect: "JavaScript RegExp", mode: state.mode, pattern: state.pattern, flags: state.flags, sample: state.sample }, null, 2), "application/json");
        notify("success", "Regex export ready", "The local pattern JSON is downloading.");
      }
    });
  }

  function renderCategories() {
    const categories = ["All", ...new Set(content.features.map((feature) => feature.category))];
    const container = $("#category-filters");
    container.replaceChildren();
    categories.forEach((category) => {
      const button = create("button", `chip-button${category === categoryFilter ? " is-active" : ""}`, category);
      button.type = "button";
      button.addEventListener("click", () => { categoryFilter = category; renderCategories(); renderFeatureGrid(); });
      container.append(button);
    });
  }

  function renderFeatureGrid() {
    const state = searchStates.features;
    const list = content.features.filter((feature) => {
      const searchable = schoolSafeText(`${feature.title} ${feature.summary} ${feature.category} ${feature.tags.join(" ")}`);
      return (categoryFilter === "All" || feature.category === categoryFilter) && searchMatches("features", searchable);
    });
    const grid = $("#feature-grid");
    grid.replaceChildren();
    $("#feature-metric-count").textContent = String(content.features.length);
    $("#feature-count").textContent = `${list.length} / ${content.features.length} articles`;
    if (!list.length) {
      grid.append(create("div", "release-empty", state.error || "No feature articles match this search."));
      return;
    }
    list.forEach((feature) => {
      const card = create("button", `feature-card${currentArticleId === feature.id ? " is-selected" : ""}`);
      card.type = "button";
      card.setAttribute("aria-label", `Open feature article: ${schoolSafeText(feature.title)}`);
      const top = create("div", "feature-card-top");
      const heading = create("div");
      heading.append(create("span", "feature-category", schoolSafeText(feature.category)));
      heading.append(create("h2", null, schoolSafeText(feature.title)));
      top.append(heading);
      top.append(create("span", "state-icon state-icon-accent", "→"));
      card.append(top);
      card.append(create("p", null, schoolSafeText(feature.summary)));
      const tags = create("div", "tag-line");
      feature.tags.slice(0, 4).forEach((tag) => tags.append(create("span", "tag", schoolSafeText(tag))));
      card.append(tags);
      card.addEventListener("click", () => selectArticle(feature.id));
      grid.append(card);
    });
  }

  function selectArticle(id) {
    currentArticleId = id;
    selectTab("features");
    renderFeatureGrid();
    renderArticle();
    const detail = $("#article-detail");
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({ block: "nearest" });
  }

  function renderArticle() {
    const detail = $("#article-detail");
    detail.replaceChildren();
    const feature = content.features.find((item) => item.id === currentArticleId);
    if (!feature) {
      const empty = create("div", "empty-article-state");
      empty.append(create("span", "empty-icon", "✦"));
      empty.append(create("h2", null, localized("selectArticle")));
      empty.append(create("p", null, localized("selectArticleHint")));
      detail.append(empty);
      return;
    }
    const header = create("header", "article-header");
    header.append(create("p", "eyebrow", schoolSafeText(feature.category).toUpperCase()));
    header.append(create("h2", null, schoolSafeText(feature.title)));
    header.append(create("p", "article-summary", schoolSafeText(feature.summary)));
    const meta = create("div", "article-meta");
    meta.append(create("span", "article-status", localized("articleStatus")));
    const source = create("a", null, "Open categorized source article ↗");
    source.href = feature.docsPath;
    source.setAttribute("aria-label", `Open source article for ${schoolSafeText(feature.title)}`);
    meta.append(source);
    header.append(meta);
    detail.append(header);
    const labels = { behavior: "Behavior", configuration: "Configuration", failureModes: "Failure modes and recovery", security: "Security considerations", verification: "Verification" };
    Object.entries(feature.sections).forEach(([key, paragraphs]) => {
      const section = create("section", "article-section");
      section.append(create("h3", null, labels[key] || key));
      paragraphs.forEach((paragraph) => section.append(create("p", null, schoolSafeText(paragraph))));
      detail.append(section);
    });
    const suggestions = create("section", "article-suggestions");
    suggestions.append(create("h3", null, "Suggested articles"));
    const list = create("ul", "suggestion-list");
    feature.suggested.forEach((suggestedId) => {
      const target = content.features.find((item) => item.id === suggestedId);
      if (!target) return;
      const item = create("li");
      const button = create("button", "chip-button", schoolSafeText(target.title));
      button.type = "button";
      button.addEventListener("click", () => selectArticle(target.id));
      item.append(button);
      list.append(item);
    });
    suggestions.append(list);
    detail.append(suggestions);
  }

  function releaseIsStableVerified(record) {
    return Boolean(manifest.schemaVersion === 1 && releaseManifestContract && typeof releaseManifestContract.isVerifiedStableRecord === "function" && releaseManifestContract.isVerifiedStableRecord(record));
  }

  function renderReleaseGate() {
    const slot = $("#stable-download-slot");
    slot.replaceChildren();
    const extensionSlot = $("#extension-download-slot");
    extensionSlot?.replaceChildren();
    const stable = manifest.stable;
    const pagesVerified = ["verified", "workflow-deployed"].includes(manifest.publication?.pages);
    const stableEligible = pagesVerified && releaseIsStableVerified(stable);
    if (stableEligible) {
      COPY.releaseSummary = [
        `Stable v${stable.version} is verified with a real unsigned installer and release evidence. Download it from the published release record.`,
        `穩定版 v${stable.version} 已經有真實未簽名安裝程式同 release 證據；可以由已發布嘅版本記錄下載。`
      ];
    }
    if (pagesVerified) {
      COPY.aboutLede = [
        "This published site is backed by the verified Pages URL and release manifest recorded in the deployment.",
        "呢個已發布網站由部署記錄入面驗證過嘅 Pages 網址同 release manifest 支持。"
      ];
      COPY.publicationTitle = ["Pages publication verified.", "Pages 發佈已驗證。"];
      COPY.publicationBody = [
        `The live site is published at ${manifest.publication.url || "the configured Pages URL"}. Its release manifest is supplied by the hosted Pages workflow.`,
        `Live site 已經發佈喺 ${manifest.publication.url || "已設定嘅 Pages 網址"}；release manifest 由 hosted Pages workflow 提供。`
      ];
      COPY.publicationDetail = ["Publication: verified", "發佈：已驗證"];
    }
    if (stableEligible) {
      const link = create("a", "button button-filled verified-download", `Download stable installer · v${stable.version}`);
      link.href = stable.installerUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("data-stable-installer", "true");
      slot.append(link);
      $("#release-metric").textContent = `v${stable.version}`;
      $("#release-metric-note").textContent = "verified stable";
      $("#release-state-label").textContent = "Stable asset verified";
      $("#release-state-label").parentElement.style.color = "var(--success)";
    } else {
      $("#release-metric").textContent = "—";
      $("#release-metric-note").textContent = "not proven";
      $("#release-state-label").textContent = "No stable asset verified";
    }
    if (!extensionSlot || !stableEligible) return;
    const descriptor = releaseManifestContract && typeof releaseManifestContract.getVerifiedExtensionDescriptor === "function" ? releaseManifestContract.getVerifiedExtensionDescriptor(stable) : null;
    const extensionReady = Boolean(descriptor);
    if (!extensionReady) {
      extensionSlot.append(create("p", "field-help", localized("extensionUnavailable")));
      return;
    }
    const artifact = stable.extensionArtifact;
    const card = create("section", "extension-install-card");
    const heading = create("div", "extension-install-heading");
    heading.append(create("h3", null, localized("extensionTitle")));
    heading.append(create("span", "release-badge", "Manifest V3 · ZIP"));
    card.append(heading);
    card.append(create("p", "extension-install-summary", localized("extensionSummary")));
    const download = create("a", "button button-tonal verified-extension-download", `${localized("extensionDownload")} · v${artifact.version}`);
    download.href = descriptor.href;
    download.download = descriptor.fileName;
    download.target = "_blank";
    download.rel = "noopener noreferrer";
    download.setAttribute("data-extension-install", "true");
    download.setAttribute("aria-label", `${localized("extensionDownload")} · v${descriptor.version}`);
    card.append(download);
    const metadata = localized("extensionMetadata").replace("{size}", Number(artifact.sizeBytes).toLocaleString()).replace("{sha256}", artifact.sha256);
    card.append(create("p", "extension-install-meta", metadata));
    const warning = create("p", "extension-install-warning", localized("extensionUnpairedWarning"));
    warning.setAttribute("role", "note");
    card.append(warning);
    const steps = create("ol", "extension-install-steps");
    ["extensionStepOne", "extensionStepTwo", "extensionStepThree"].forEach((key) => steps.append(create("li", null, localized(key))));
    card.append(steps);
    extensionSlot.append(card);
  }

  function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "Not recorded in source"; }

  function renderReleaseList() {
    const state = searchStates.changelog;
    const chosenDate = $("#changelog-date").value;
    const list = content.releases.filter((release) => searchMatches("changelog", schoolSafeText(`${release.version} ${release.channel} ${release.summary} ${release.notes.join(" ")} ${release.commit}`)) && (!chosenDate || !release.releaseDate || release.releaseDate === chosenDate));
    const container = $("#release-list");
    container.replaceChildren();
    if (!list.length) { container.append(create("div", "release-empty", state.error || "No recorded releases match this view.")); return; }
    list.forEach((release) => {
      const card = create("article", "release-card-item");
      const header = create("div", "release-header");
      const heading = create("div");
      heading.append(create("p", "eyebrow", "VERSION"));
      heading.append(create("h2", null, `v${release.version}`));
      header.append(heading);
      const badges = create("div", "release-badges");
      badges.append(create("span", "release-badge warning", release.channel));
      badges.append(create("span", "release-badge", release.status));
      header.append(badges);
      card.append(header);
      card.append(create("p", null, schoolSafeText(release.summary)));
      const meta = create("dl", "release-meta");
      const dateTerm = create("dt", null, "Release date");
      const dateValue = create("dd", null, formatDate(release.releaseDate));
      const commitTerm = create("dt", null, "Source commit");
      const commitValue = create("dd");
      const commitLink = create("a", null, release.commit.slice(0, 12));
      commitLink.href = release.commitUrl;
      commitLink.target = "_blank";
      commitLink.rel = "noopener noreferrer";
      commitLink.title = release.commit;
      commitValue.append(commitLink);
      meta.append(dateTerm, dateValue, commitTerm, commitValue);
      card.append(meta);
      const notes = create("ul");
      release.notes.filter((note) => !isSchoolMode() || !/code name|dim sum|shrimp dumpling|har gow|siu mai|dessert/i.test(note)).forEach((note) => notes.append(create("li", null, schoolSafeText(note))));
      card.append(notes);
      if (!releaseIsStableVerified(release)) card.append(create("p", "field-help", "Installer action: absent. This recorded release is not eligible for stable download discovery."));
      container.append(card);
    });
  }

  function changelogMarkdown() {
    const chosenDate = $("#changelog-date").value;
    return content.releases.filter((release) => searchMatches("changelog", schoolSafeText(`${release.version} ${release.channel} ${release.summary} ${release.notes.join(" ")} ${release.commit}`)) && (!chosenDate || !release.releaseDate || release.releaseDate === chosenDate)).map((release) => [
      `## v${release.version} · ${release.channel}`,
      `- Release date: ${formatDate(release.releaseDate)}`,
      `- Commit: ${release.commit}`,
      `- Status: ${release.status}`,
      `- ${schoolSafeText(release.summary)}`,
      ...release.notes.filter((note) => !isSchoolMode() || !/code name|dim sum|shrimp dumpling|har gow|siu mai|dessert/i.test(note)).map((note) => `- ${schoolSafeText(note)}`)
    ].join("\n")).join("\n\n") || "No recorded releases match this view.\n";
  }

  async function copyText(text, title) {
    try {
      await navigator.clipboard.writeText(text);
      notify("success", title, "Copied locally to the clipboard.");
    } catch (_error) { notify("warning", "Copy unavailable", "This browser did not grant clipboard access; the content remains available on screen."); }
  }

  function downloadFile(name, text, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  const tabRecords = [
    { label: "Overview", title: "Landing page", strip: "Main window / Documentation", group: "Core", pinned: true },
    { label: "Features", title: "Feature index", strip: "Main window / Documentation", group: "Core", pinned: false },
    { label: "Changelog", title: "Release evidence", strip: "Main window / Documentation", group: "Release evidence", pinned: false },
    { label: "Settings", title: "Site preferences", strip: "Main window / Documentation", group: "Preferences", pinned: false },
    { label: "About", title: "Publication status", strip: "Main window / Documentation", group: "Preferences", pinned: false }
  ];

  function renderTabDiscovery() {
    const container = $("#tab-results");
    container.replaceChildren();
    const scopes = [
      ["tab-strip", "Current strip", tabRecords],
      ["tab-group", "Inside groups", tabRecords.filter((record) => record.group === "Core")],
      ["tab-groups", "Group names", [...new Map(tabRecords.map((record) => [record.group, { ...record, label: record.group, title: `${record.group} group`, pinned: false }])).values()]],
      ["tab-master", "Master tab search", tabRecords]
    ];
    let visible = 0;
    scopes.forEach(([id, scope, records]) => {
      const state = searchStates[id];
      if (!state.query && state.mode === "text") return;
      records.filter((record) => searchMatches(id, `${record.label} ${record.title} ${record.strip} ${record.group}`)).forEach((record) => {
        visible += 1;
        const row = create("div", "tab-result");
        row.append(create("span", "state-icon state-icon-accent", record.pinned ? "•" : "→"));
        const text = create("div");
        text.append(create("strong", null, schoolSafeText(record.label)));
        text.append(create("small", null, schoolSafeText(`${scope} · ${record.group} · ${record.strip}`)));
        row.append(text);
        row.append(create("small", null, record.pinned ? "Pinned" : "Open"));
        row.addEventListener("click", () => selectTab(record.label.toLocaleLowerCase()));
        container.append(row);
      });
    });
    if (!visible) container.append(create("div", "release-empty", "Type in one of the four fields to inspect tab locations."));
  }

  function buildCommands() {
    const commands = [
      { id: "tab.overview", label: "Overview", description: "Open the landing summary", action: () => selectTab("overview", true) },
      { id: "tab.features", label: "Features", description: "Open the feature index", action: () => selectTab("features", true) },
      { id: "tab.changelog", label: "Changelog", description: "Open recorded release evidence", action: () => selectTab("changelog", true) },
      { id: "tab.settings", label: "Settings", description: "Open language and appearance settings", action: () => selectTab("settings", true) },
      { id: "tab.about", label: "About", description: "Open publication and verification status", action: () => selectTab("about", true) },
      { id: "action.copy-changelog", label: "Copy changelog view", description: "Export the current filtered release view to the clipboard", action: () => copyText(changelogMarkdown(), "Changelog copied") },
      { id: "action.download-changelog", label: "Download changelog Markdown", description: "Download the current filtered release view", action: () => downloadFile("material-download-manager-changelog.md", changelogMarkdown(), "text/markdown") },
      { id: "search.features", label: "Features · search", description: "Focus the feature search field", action: () => focusElement("feature-search", "features") },
      { id: "search.settings", label: "Settings · search", description: "Focus the settings search field", action: () => focusElement("settings-search", "settings") },
      { id: "search.tabs", label: "Tabs · four searches", description: "Open the tab discovery lab", action: () => focusElement("tab-strip-search", "settings") },
      { id: "destination.notifications", label: "Notification centre", description: "Review, filter, export, dismiss, or delete local notification history", action: () => openNotificationCentre(), schoolOptional: true },
      { id: "setting.language", label: "Settings · language mode", description: "Choose English, Cantonese, or bilingual copy", action: () => focusElement("language-mode-buttons", "settings") },
      { id: "setting.funny-en", label: "Settings · English funny level", description: "Adjust English voice from 1 to 5", schoolOptional: true, action: () => focusElement("funny-en", "settings") },
      { id: "setting.funny-yue", label: "Settings · Cantonese funny level", description: "Adjust Cantonese voice from 1 to 5", schoolOptional: true, action: () => focusElement("funny-yue", "settings") },
      { id: "setting.theme", label: "Settings · theme", description: "Choose system, light, or dark", action: () => focusElement("theme-setting", "settings") },
      { id: "setting.accent", label: "Settings · accent", description: "Choose the seed color", action: () => focusElement("accent-setting", "settings") },
      { id: "setting.appearance", label: "Settings · appearance editor", description: "Edit per-surface radius, color, and spacing", action: () => focusElement("appearance-target", "settings") },
      ...content.features.map((feature) => ({ id: `feature.${feature.id}`, label: feature.title, description: `${feature.category} · ${feature.summary}`, action: () => selectArticle(feature.id) }))
    ];
    const stable = manifest.stable;
    const pagesVerified = ["verified", "workflow-deployed"].includes(manifest.publication?.pages);
    if (pagesVerified && releaseIsStableVerified(stable) && releaseManifestContract?.isVerifiedExtensionArtifact?.(stable)) {
      commands.splice(7, 0, {
        id: "action.download-extension",
        label: `${localized("extensionDownload")} · v${stable.extensionArtifact.version}`,
        description: localized("extensionSummary"),
        action: () => document.querySelector('[data-extension-install="true"]')?.click()
      });
    }
    return isSchoolMode()
      ? commands.filter((command) => !command.schoolOptional).map((command) => ({ ...command, label: schoolSafeText(command.label), description: schoolSafeText(command.description) }))
      : commands;
  }

  function renderPalette() {
    const commands = buildCommands();
    const list = commands.filter((command) => searchMatches("palette", `${command.label} ${command.description} ${command.id}`));
    const container = $("#palette-results");
    container.replaceChildren();
    paletteIndex = Math.min(paletteIndex, Math.max(0, list.length - 1));
    if (!list.length) { container.append(create("div", "release-empty", searchStates.palette.error || "No command matches this search.")); return; }
    list.forEach((command, index) => {
      const button = create("button", `palette-result${index === paletteIndex ? " is-active" : ""}`);
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === paletteIndex));
      button.append(create("strong", null, command.label));
      button.append(create("span", null, command.description));
      button.addEventListener("mouseenter", () => { paletteIndex = index; renderPalette(); });
      button.addEventListener("click", () => { closePalette(); command.action(); });
      container.append(button);
    });
  }

  function focusElement(id, tabId) {
    selectTab(tabId || activeTab);
    const element = $(`#${id}`) || $(`[data-setting="${id}"]`);
    if (!element) return;
    element.focus();
    element.scrollIntoView({ block: "center", behavior: settings.reducedMotion ? "auto" : "smooth" });
    element.classList.add("focus-highlight");
    setTimeout(() => element.classList.remove("focus-highlight"), 1200);
  }

  function openPalette() {
    previousFocus = document.activeElement;
    const layer = $("#command-palette-layer");
    layer.hidden = false;
    const input = $("#palette-search");
    input.value = searchStates.palette.query;
    renderBuilder("palette");
    $("#builder-palette").hidden = true;
    $(".builder-toggle", $("[data-search-id='palette']")).setAttribute("aria-expanded", "false");
    renderPalette();
    input.focus();
  }

  function closePalette() {
    $("#command-palette-layer").hidden = true;
    $("#builder-palette").hidden = true;
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  }

  function bindPalette() {
    $("#command-palette-open").addEventListener("click", openPalette);
    $("#command-palette-close").addEventListener("click", closePalette);
    $("#command-palette-layer").addEventListener("click", (event) => { if (event.target === event.currentTarget) closePalette(); });
    $("#palette-search").addEventListener("keydown", (event) => {
      const count = $$(".palette-result", $("#palette-results")).length;
      if (event.key === "ArrowDown" && count) { event.preventDefault(); paletteIndex = (paletteIndex + 1) % count; renderPalette(); }
      if (event.key === "ArrowUp" && count) { event.preventDefault(); paletteIndex = (paletteIndex - 1 + count) % count; renderPalette(); }
      if (event.key === "Enter" && count) { event.preventDefault(); $(".palette-result", $("#palette-results"))[paletteIndex].click(); }
    });
  }

  function runSearch(id) {
    updateSearchStateLabel(id);
    if (id === "features") renderFeatureGrid();
    if (id === "settings") {
      const state = searchStates.settings;
      $$(".settings-card").forEach((card) => {
        card.hidden = isSchoolMode() && card.hasAttribute("data-school-optional")
          ? true
          : Boolean(state.query || state.mode === "regex") && !searchMatches(id, card.dataset.settingSearch);
      });
    }
    if (id === "changelog") renderReleaseList();
    if (id === "palette" && !$("#command-palette-layer").hidden) renderPalette();
    if (id === "notifications") {
      notificationState.view.query = searchStates.notifications.query;
      notificationState.view.pattern = searchStates.notifications.pattern;
      notificationState.view.flags = searchStates.notifications.flags;
      notificationState.view.mode = searchStates.notifications.mode;
      saveNotificationState();
      renderNotificationCentre();
    }
    if (id.startsWith("tab-")) renderTabDiscovery();
  }

  function bindSettings() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-setting]");
      if (!button) return;
      if (isSchoolMode() && button.hasAttribute("data-school-language-option")) return;
      const key = button.dataset.setting;
      if (["language", "density", "tabPosition"].includes(key)) setSetting(key, button.dataset.value);
    });
    $("#funny-en").addEventListener("input", (event) => setSetting("funnyEn", clamp(Number(event.target.value), 1, 5, 3), false));
    $("#funny-yue").addEventListener("input", (event) => setSetting("funnyYue", clamp(Number(event.target.value), 1, 5, 3), false));
    $("#theme-setting").addEventListener("change", (event) => setSetting("theme", event.target.value));
    $("#accent-setting").addEventListener("input", (event) => setSetting("accent", validHex(event.target.value) ? event.target.value.toUpperCase() : DEFAULTS.accent, false));
    $("#font-scale").addEventListener("input", (event) => setSetting("fontScale", clamp(Number(event.target.value), 90, 125, 100), false));
    $("#reduced-motion").addEventListener("change", (event) => setSetting("reducedMotion", Boolean(event.target.checked)));
    $("#show-emojis").addEventListener("change", (event) => setSetting("showEmojis", Boolean(event.target.checked)));
    $("#school-mode-enabled").addEventListener("change", (event) => setSchoolMode(Boolean(event.target.checked)));
    $("#school-mode-name").addEventListener("input", (event) => setSchoolModeName(event.target.value));
    $("#reset-school-mode").addEventListener("click", resetSchoolMode);
    $("#display-name").addEventListener("input", (event) => {
      settings = { ...settings, displayName: normalizeLabel(event.target.value, DEFAULTS.displayName, 80) };
      saveSettings();
      $("#brand-name").textContent = settings.displayName;
      applyTranslations();
      renderProvenance();
    });
    $("#appearance-target").addEventListener("change", renderAppearanceEditor);
    $("#appearance-surface-color").addEventListener("input", (event) => updateAppearanceField("color", event.target.value.toUpperCase()));
    $("#appearance-radius").addEventListener("input", (event) => updateAppearanceField("radius", Number(event.target.value)));
    $("#appearance-spacing").addEventListener("change", (event) => updateAppearanceField("spacing", event.target.value));
    $("#reset-settings").addEventListener("click", resetSettings);
    $("#reset-appearance").addEventListener("click", resetAppearance);
    $("#tab-accent-setting").addEventListener("input", (event) => updateTabAppearance("color", event.target.value.toUpperCase()));
    $("#tab-radius-setting").addEventListener("input", (event) => updateTabAppearance("radius", Number(event.target.value)));
  }

  function bindNotificationCentre() {
    $("#notification-centre-open").addEventListener("click", openNotificationCentre);
    $("#notification-centre-close").addEventListener("click", () => closeNotificationCentre());
    $("#notification-filter").addEventListener("change", (event) => {
      notificationState.view.filter = NOTIFICATION_FILTERS.includes(event.target.value) ? event.target.value : "all";
      saveNotificationState();
      renderNotificationCentre();
    });
    $("#notification-select-all").addEventListener("click", selectAllVisibleNotifications);
    $("#notification-select-inverse").addEventListener("click", invertVisibleNotificationSelection);
    $("#notification-bulk-dismiss").addEventListener("click", bulkDismissNotifications);
    $("#notification-bulk-delete").addEventListener("click", openNotificationDeleteConfirm);
    $("#notification-export").addEventListener("click", exportVisibleNotifications);
    $("#notification-delete-ack").addEventListener("change", updateNotificationDeleteControls);
    $("#notification-delete-phrase").addEventListener("input", updateNotificationDeleteControls);
    $("#notification-delete-cancel").addEventListener("click", () => closeNotificationDeleteConfirm());
    $("#notification-delete-confirm-button").addEventListener("click", confirmNotificationDelete);
    $("#notification-filter").value = notificationState.view.filter;
    searchStates.notifications.mode = notificationState.view.mode;
    searchStates.notifications.query = notificationState.view.query;
    searchStates.notifications.pattern = notificationState.view.pattern || notificationState.view.query;
    searchStates.notifications.flags = notificationState.view.flags;
    $("#notifications-search").value = notificationState.view.query;
    renderNotificationCentre();
  }

  function notify(tone, title, message) {
    const region = $("#notification-region");
    if (!region || isSchoolMode()) return;
    const safeTone = NOTIFICATION_TONES.includes(tone) ? tone : "info";
    const record = {
      id: makeNotificationId(),
      tone: safeTone,
      title: normalizeNotificationText(title, "Notification", 160),
      message: normalizeNotificationText(message, "", 600),
      createdAt: new Date().toISOString(),
      dismissed: false
    };
    notificationState.records.push(record);
    saveNotificationState();
    updateNotificationCount();
    const item = create("article", `notification ${safeTone}`);
    item.dataset.notificationId = record.id;
    item.setAttribute("role", safeTone === "error" || safeTone === "warning" ? "alert" : "status");
    const marker = create("span", `signal-dot ${safeTone}`, effectiveShowEmojis() ? (safeTone === "success" ? "✅" : safeTone === "error" || safeTone === "warning" ? "⚠️" : "💬") : "");
    marker.setAttribute("aria-hidden", "true");
    marker.dataset.decorative = "true";
    item.append(marker);
    const copy = create("div");
    const titleId = `toast-title-${record.id}`;
    const messageId = `toast-message-${record.id}`;
    const titleElement = create("div", "notification-title", record.title);
    titleElement.id = titleId;
    const messageElement = create("div", "notification-message", record.message);
    messageElement.id = messageId;
    copy.append(titleElement, messageElement);
    item.append(copy);
    const close = create("button", "notification-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", `${localized("notificationDismiss")}: ${record.title}`);
    close.addEventListener("click", () => dismissNotification(record.id, true));
    item.append(close);
    item.setAttribute("aria-describedby", `${titleId} ${messageId}`);
    region.append(item);
    if (!["error", "warning"].includes(safeTone)) {
      const timer = setTimeout(() => { notificationTimers.delete(record.id); dismissNotification(record.id); }, 5200);
      notificationTimers.set(record.id, timer);
    }
  }

  function maybeShowSurprise() {
    if (isSchoolMode() || Math.random() >= 0.1) return;
    const card = $("#dim-sum-surprise");
    card.hidden = false;
    const title = $("#surprise-title");
    const copy = $("#surprise-copy");
    title.textContent = settings.language === "yue" ? "蝦餃 · Shrimp dumpling" : settings.language === "bilingual" ? "Shrimp dumpling · 蝦餃" : "Shrimp dumpling · 蝦餃";
    copy.textContent = settings.language === "yue" ? "本地小插畫出現咗，唔會阻住你做嘢。" : "A tiny local illustration appeared. It will not interrupt your work.";
    setTimeout(() => { card.hidden = true; }, 12000);
  }

  function bindGlobalKeys() {
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === "f") { event.preventDefault(); openPalette(); return; }
      const deleteDialog = $("#notification-delete-confirm");
      if (deleteDialog && !deleteDialog.hidden && event.key === "Tab") {
        const focusable = $$('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', deleteDialog).filter((element) => !element.hidden);
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if (event.key === "Escape") {
        const openBuilder = $(".builder-popover:not([hidden])");
        if (openBuilder) { openBuilder.hidden = true; const toggle = openBuilder.parentElement.querySelector(".builder-toggle"); if (toggle) toggle.setAttribute("aria-expanded", "false"); return; }
        if (!( $("#notification-delete-confirm")?.hidden ?? true)) { closeNotificationDeleteConfirm(); return; }
        if (!$("#command-palette-layer").hidden) { closePalette(); return; }
        if (notificationCentreOpen) { closeNotificationCentre(); return; }
        closeContextMenu();
        $("#tab-appearance-editor").hidden = true;
      }
    });
  }

  function bindChangelogActions() {
    $("#changelog-date").addEventListener("change", () => runSearch("changelog"));
    $("#clear-changelog-date").addEventListener("click", () => { $("#changelog-date").value = ""; runSearch("changelog"); });
    $("#copy-changelog").addEventListener("click", () => copyText(changelogMarkdown(), "Changelog copied"));
    $("#download-changelog").addEventListener("click", () => { downloadFile("material-download-manager-changelog.md", changelogMarkdown(), "text/markdown"); notify("success", "Markdown ready", "The filtered changelog view is downloading."); });
  }

  function initialize() {
    window.settings = settings;
    renderCategories();
    renderFeatureGrid();
    renderArticle();
    renderReleaseGate();
    renderReleaseList();
    renderTabDiscovery();
    $("#publication-status").textContent = ["verified", "workflow-deployed"].includes(manifest.publication?.pages) ? "Pages publication verified" : "Local source · Pages publication unverified";
    $("#about-feature-links").replaceChildren(...content.features.map((feature) => { const button = create("button", "chip-button", feature.title); button.type = "button"; button.addEventListener("click", () => selectArticle(feature.id)); return button; }));
    applySettings();
    bindTabs();
    bindContextMenu();
    bindSearches();
    bindPalette();
    bindSettings();
    bindNotificationCentre();
    bindSettingsSync();
    bindChangelogActions();
    bindGlobalKeys();
    setTimeout(maybeShowSurprise, 40);
  }

  let notificationCounter = 0;
  let notificationState = readNotificationState();
  notificationState.selected = new Set();
  let notificationCentreOpen = false;
  let notificationCentreOrigin = null;
  let notificationDeleteOrigin = null;
  let notificationDeleteIds = [];
  let notificationDeleteRevision = null;
  let notificationTimers = new Map();
  let settings = readSettings();
  initialize();
})();
