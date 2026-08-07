(function () {
  "use strict";

  const content = window.MDM_SITE_CONTENT;
  const manifest = window.MDM_RELEASE_MANIFEST || { stable: null, publication: { pages: "unverified" } };
  const root = document.documentElement;
  const STORAGE_KEY = "mdm-site-settings-v1";
  const DEFAULTS = {
    language: "en",
    funnyEn: 3,
    funnyYue: 3,
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
  const SEARCH_IDS = ["features", "changelog", "settings", "palette", "tab-strip", "tab-group", "tab-groups", "tab-master"];
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
    releaseSummary: ["The repository has a verified unsigned test prerelease, but no stable production installer has passed the release gate. This site keeps the download action absent until the manifest proves one.", "倉庫有驗證過嘅未簽名測試預發版，但未有穩定生產安裝程式通過版本閘門；manifest 未證明之前，下載掣唔會出現。"],
    viewReleaseEvidence: ["View release evidence →", "睇版本證據 →"],
    builtAround: ["BUILT AROUND THE WORK", "圍住實際工作起屋"],
    spotlightTitle: ["The useful bits have a paper trail.", "有用嘅嘢，留低晒腳印。"],
    spotlightOne: ["Range transfers and queue schedules stay bounded.", "分段傳輸同隊列時間表有界有數。"],
    spotlightTwo: ["Destructive actions show exact scope before they run.", "破壞性操作行之前先講清楚影響範圍。"],
    spotlightThree: ["Search and history stay local and exportable.", "搜尋同歷史留喺本地，仲可以匯出。"],
    readAllArticles: ["Read all articles", "睇晒啲文章"],
    smallDelight: ["A SMALL DELIGHT", "細細份開心"],
    featureIndex: ["FEATURE INDEX", "功能索引"],
    featureIndexTitle: ["Everything implemented, in one place.", "已經做到嘅功能，一次過睇晒。"],
    featureIndexLede: ["Search the feature articles locally. Plain text is the default; the builder is there when the exact shape matters.", "本地搜尋功能文章；純文字係預設，想精準啲就開正則建構器。"],
    filterByCategory: ["Filter by category", "按分類篩選"],
    regexBuilder: ["Regex builder", "正則建構器"],
    selectArticle: ["Select an article", "揀一篇文章"],
    selectArticleHint: ["Choose a feature card to read behavior, configuration, failure modes, security, verification, and suggested articles.", "揀功能卡片，就可以睇行為、設定、失敗處理、安全、驗證同推薦文章。"],
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

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
      return {
        ...DEFAULTS,
        ...parsed,
        funnyEn: clamp(Number(parsed.funnyEn), 1, 5, DEFAULTS.funnyEn),
        funnyYue: clamp(Number(parsed.funnyYue), 1, 5, DEFAULTS.funnyYue),
        fontScale: clamp(Number(parsed.fontScale), 90, 125, DEFAULTS.fontScale),
        accent: validHex(parsed.accent) ? parsed.accent : DEFAULTS.accent,
        appearanceOverrides: parsed.appearanceOverrides && typeof parsed.appearanceOverrides === "object" ? parsed.appearanceOverrides : {},
        tabOverrides: parsed.tabOverrides && typeof parsed.tabOverrides === "object" ? parsed.tabOverrides : {}
      };
    } catch (_error) {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_error) { /* Private browsing can refuse persistence; the UI still works. */ }
  }

  function clamp(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function validHex(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value); }

  function localized(key) {
    const pair = COPY[key] || [key, key];
    if (settings.language === "yue") return pair[1];
    if (settings.language === "bilingual") return `${pair[0]} · ${pair[1]}`;
    return pair[0];
  }

  function applyTranslations() {
    $$('[data-copy]').forEach((element) => { element.textContent = localized(element.dataset.copy); });
    $$('[data-copy-placeholder]').forEach((element) => { element.placeholder = localized(element.dataset.copyPlaceholder); });
    root.lang = settings.language === "yue" ? "zh-Hant" : "en";
    document.title = `${settings.displayName || DEFAULTS.displayName} · ${settings.language === "yue" ? "文件" : "Documentation"}`;
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
    root.style.setProperty("--font-scale", String(settings.fontScale / 100));
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--accent-strong", settings.accent);
    root.style.setProperty("--accent-soft", `color-mix(in srgb, ${settings.accent} ${luminance > .58 ? 18 : 28}%, var(--surface-container))`);
    root.style.setProperty("--on-accent", luminance > .58 ? "#1d1b20" : "#ffffff");
    const strip = $("#tab-strip");
    strip.setAttribute("aria-orientation", settings.tabPosition === "top" ? "horizontal" : "vertical");
    $("#brand-name").textContent = settings.displayName || DEFAULTS.displayName;
    applyAppearanceOverrides();
    renderSettingsControls();
    applyTranslations();
  }

  function setSetting(key, value, announce = true) {
    settings = { ...settings, [key]: value };
    saveSettings();
    applySettings();
    if (announce) notify("success", "Setting updated", `${key} is now ${String(value)}.`);
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
    renderTonePreview();
    renderAppearanceEditor();
    renderTabAppearanceEditor();
    renderProvenance();
  }

  function renderProvenance() {
    const pairs = {
      language: settings.language !== DEFAULTS.language ? "Persisted in this browser" : "Compiled-in value: English",
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
    if (pattern.length > 2048) return "Pattern is limited to 2,048 characters.";
    if (!/^[gimsuy]*$/.test(flags)) return "Supported flags are g, i, m, s, u, and y.";
    if (new Set(flags.split("")).size !== flags.length) return "Each flag can appear only once.";
    if (/\([^()]*[+*{][^()]*\)(?:[+*]|\{\d)/.test(pattern) || /(?:[+*])\s*[+*]/.test(pattern)) return "Nested quantifiers are rejected before evaluation.";
    try { new RegExp(pattern, flags); } catch (error) { return error instanceof Error ? error.message : "Invalid regular expression."; }
    return null;
  }

  function validateSearchState(id) {
    const state = searchStates[id];
    state.error = state.mode === "regex" ? getRegexError(state.pattern, state.flags) : null;
    return state.error;
  }

  function searchMatches(id, value) {
    const state = searchStates[id];
    const haystack = String(value ?? "");
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
    while ((match = expression.exec(sample)) && matches.length < 200) {
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
    const list = content.features.filter((feature) => (categoryFilter === "All" || feature.category === categoryFilter) && searchMatches("features", `${feature.title} ${feature.summary} ${feature.category} ${feature.tags.join(" ")}`));
    const grid = $("#feature-grid");
    grid.replaceChildren();
    $("#feature-count").textContent = `${list.length} / ${content.features.length} articles`;
    if (!list.length) {
      grid.append(create("div", "release-empty", state.error || "No feature articles match this search."));
      return;
    }
    list.forEach((feature) => {
      const card = create("button", `feature-card${currentArticleId === feature.id ? " is-selected" : ""}`);
      card.type = "button";
      card.setAttribute("aria-label", `Open feature article: ${feature.title}`);
      const top = create("div", "feature-card-top");
      const heading = create("div");
      heading.append(create("span", "feature-category", feature.category));
      heading.append(create("h2", null, feature.title));
      top.append(heading);
      top.append(create("span", "state-icon state-icon-accent", "→"));
      card.append(top);
      card.append(create("p", null, feature.summary));
      const tags = create("div", "tag-line");
      feature.tags.slice(0, 4).forEach((tag) => tags.append(create("span", "tag", tag)));
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
    header.append(create("p", "eyebrow", feature.category.toUpperCase()));
    header.append(create("h2", null, feature.title));
    header.append(create("p", "article-summary", feature.summary));
    const meta = create("div", "article-meta");
    meta.append(create("span", "article-status", "Implemented feature"));
    const source = create("a", null, "Open categorized source article ↗");
    source.href = feature.docsPath;
    source.setAttribute("aria-label", `Open source article for ${feature.title}`);
    meta.append(source);
    header.append(meta);
    detail.append(header);
    const labels = { behavior: "Behavior", configuration: "Configuration", failureModes: "Failure modes and recovery", security: "Security considerations", verification: "Verification" };
    Object.entries(feature.sections).forEach(([key, paragraphs]) => {
      const section = create("section", "article-section");
      section.append(create("h3", null, labels[key] || key));
      paragraphs.forEach((paragraph) => section.append(create("p", null, paragraph)));
      detail.append(section);
    });
    const suggestions = create("section", "article-suggestions");
    suggestions.append(create("h3", null, "Suggested articles"));
    const list = create("ul", "suggestion-list");
    feature.suggested.forEach((suggestedId) => {
      const target = content.features.find((item) => item.id === suggestedId);
      if (!target) return;
      const item = create("li");
      const button = create("button", "chip-button", target.title);
      button.type = "button";
      button.addEventListener("click", () => selectArticle(target.id));
      item.append(button);
      list.append(item);
    });
    suggestions.append(list);
    detail.append(suggestions);
  }

  function releaseIsStableVerified(record) {
    return Boolean(record && record.version && record.verified === true && /^https:\/\//.test(record.installerUrl || "") && Array.isArray(record.assets) && ["Setup.exe", "RELEASES"].every((name) => record.assets.includes(name)));
  }

  function renderReleaseGate() {
    const slot = $("#stable-download-slot");
    slot.replaceChildren();
    const stable = manifest.stable;
    const pagesVerified = ["verified", "workflow-deployed"].includes(manifest.publication?.pages);
    if (releaseIsStableVerified(stable)) {
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
        `The live site is published at ${manifest.publication.url || "the configured Pages URL"}. Its release manifest is supplied by the self-hosted Pages workflow.`,
        `Live site 已經發佈喺 ${manifest.publication.url || "已設定嘅 Pages 網址"}；release manifest 由 self-hosted Pages workflow 提供。`
      ];
      COPY.publicationDetail = ["Publication: verified", "發佈：已驗證"];
    }
    if (releaseIsStableVerified(stable)) {
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
  }

  function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "Not recorded in source"; }

  function renderReleaseList() {
    const state = searchStates.changelog;
    const chosenDate = $("#changelog-date").value;
    const list = content.releases.filter((release) => searchMatches("changelog", `${release.version} ${release.channel} ${release.summary} ${release.notes.join(" ")} ${release.commit}`) && (!chosenDate || !release.releaseDate || release.releaseDate === chosenDate));
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
      card.append(create("p", null, release.summary));
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
      release.notes.forEach((note) => notes.append(create("li", null, note)));
      card.append(notes);
      if (!releaseIsStableVerified(release)) card.append(create("p", "field-help", "Installer action: absent. This recorded release is not eligible for stable download discovery."));
      container.append(card);
    });
  }

  function changelogMarkdown() {
    const chosenDate = $("#changelog-date").value;
    return content.releases.filter((release) => searchMatches("changelog", `${release.version} ${release.channel} ${release.summary} ${release.notes.join(" ")} ${release.commit}`) && (!chosenDate || !release.releaseDate || release.releaseDate === chosenDate)).map((release) => [
      `## v${release.version} · ${release.channel}`,
      `- Release date: ${formatDate(release.releaseDate)}`,
      `- Commit: ${release.commit}`,
      `- Status: ${release.status}`,
      `- ${release.summary}`,
      ...release.notes.map((note) => `- ${note}`)
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
        text.append(create("strong", null, record.label));
        text.append(create("small", null, `${scope} · ${record.group} · ${record.strip}`));
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
      { id: "setting.language", label: "Settings · language mode", description: "Choose English, Cantonese, or bilingual copy", action: () => focusElement("language-mode-buttons", "settings") },
      { id: "setting.funny-en", label: "Settings · English funny level", description: "Adjust English voice from 1 to 5", action: () => focusElement("funny-en", "settings") },
      { id: "setting.funny-yue", label: "Settings · Cantonese funny level", description: "Adjust Cantonese voice from 1 to 5", action: () => focusElement("funny-yue", "settings") },
      { id: "setting.theme", label: "Settings · theme", description: "Choose system, light, or dark", action: () => focusElement("theme-setting", "settings") },
      { id: "setting.accent", label: "Settings · accent", description: "Choose the seed color", action: () => focusElement("accent-setting", "settings") },
      { id: "setting.appearance", label: "Settings · appearance editor", description: "Edit per-surface radius, color, and spacing", action: () => focusElement("appearance-target", "settings") },
      ...content.features.map((feature) => ({ id: `feature.${feature.id}`, label: feature.title, description: `${feature.category} · ${feature.summary}`, action: () => selectArticle(feature.id) }))
    ];
    return commands;
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
      $$(".settings-card").forEach((card) => { card.hidden = Boolean(state.query || state.mode === "regex") && !searchMatches(id, card.dataset.settingSearch); });
    }
    if (id === "changelog") renderReleaseList();
    if (id === "palette" && !$("#command-palette-layer").hidden) renderPalette();
    if (id.startsWith("tab-")) renderTabDiscovery();
  }

  function bindSettings() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-setting]");
      if (!button) return;
      const key = button.dataset.setting;
      if (["language", "density", "tabPosition"].includes(key)) setSetting(key, button.dataset.value);
    });
    $("#funny-en").addEventListener("input", (event) => setSetting("funnyEn", clamp(Number(event.target.value), 1, 5, 3), false));
    $("#funny-yue").addEventListener("input", (event) => setSetting("funnyYue", clamp(Number(event.target.value), 1, 5, 3), false));
    $("#theme-setting").addEventListener("change", (event) => setSetting("theme", event.target.value));
    $("#accent-setting").addEventListener("input", (event) => setSetting("accent", validHex(event.target.value) ? event.target.value.toUpperCase() : DEFAULTS.accent, false));
    $("#font-scale").addEventListener("input", (event) => setSetting("fontScale", clamp(Number(event.target.value), 90, 125, 100), false));
    $("#reduced-motion").addEventListener("change", (event) => setSetting("reducedMotion", Boolean(event.target.checked)));
    $("#display-name").addEventListener("input", (event) => {
      settings = { ...settings, displayName: event.target.value.trim().slice(0, 80) || DEFAULTS.displayName };
      saveSettings();
      $("#brand-name").textContent = settings.displayName;
      document.title = `${settings.displayName} · Documentation`;
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

  function notify(tone, title, message) {
    const region = $("#notification-region");
    const item = create("article", `notification ${tone}`);
    item.setAttribute("role", tone === "error" || tone === "warning" ? "alert" : "status");
    item.append(create("span", "signal-dot", tone === "success" ? "✓" : tone === "error" ? "!" : "·"));
    const copy = create("div");
    copy.append(create("div", "notification-title", title));
    copy.append(create("div", "notification-message", message));
    item.append(copy);
    const close = create("button", "notification-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.addEventListener("click", () => item.remove());
    item.append(close);
    region.append(item);
    if (tone !== "error" && tone !== "warning") setTimeout(() => item.remove(), 5200);
  }

  function maybeShowSurprise() {
    if (Math.random() >= 0.1) return;
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
      if (event.key === "Escape") {
        const openBuilder = $(".builder-popover:not([hidden])");
        if (openBuilder) { openBuilder.hidden = true; const toggle = openBuilder.parentElement.querySelector(".builder-toggle"); if (toggle) toggle.setAttribute("aria-expanded", "false"); return; }
        if (!$("#command-palette-layer").hidden) { closePalette(); return; }
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
    bindChangelogActions();
    bindGlobalKeys();
    setTimeout(maybeShowSurprise, 40);
  }

  let settings = readSettings();
  initialize();
})();
