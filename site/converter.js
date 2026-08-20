(function () {
  "use strict";

  const contract = window.MDM_SITE_CONVERTER_CONTRACT;
  if (!contract) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const DB_NAME = "mdm-site-converter-v1";
  const DB_VERSION = 1;
  const RECORD_PAGE_SIZE = 48;
  const HISTORY_PAGE_SIZE = 24;
  const PREVIEW_IMAGE_KINDS = new Set(["png", "jpeg", "webp"]);
  const TEXT_KINDS = new Set(["text", "json", "csv", "base64-text"]);
  const COPY = {
    title: ["Local file converter", "本地檔案轉換器"],
    lede: ["Choose files from this device, inspect their bounded bytes locally, and use only the browser adapters that this page can prove are available.", "喺呢部裝置揀檔案，本機檢查有界位元組，只用呢個頁面證明可用嘅瀏覽器轉換器。"],
    pickTitle: ["Choose source files", "揀來源檔案"],
    pickHelp: ["There is no total-file cap. The queue retains file references, not every source byte, and each conversion reads only one bounded source per worker.", "隊列冇總檔案數上限；只保留檔案參照，唔會預先讀晒所有位元組；每個工作者一次只讀一個有界來源。"],
    privacy: ["Local-only: no file path is exposed by this browser page, no upload occurs, and no converter service is contacted.", "只喺本機：呢個頁面睇唔到檔案路徑，唔會上載，亦唔會聯絡轉換服務。"],
    storageBoundary: ["Browser boundary: destination free space and a chosen filesystem path are unavailable to this static page. It creates a download only after a complete bounded Blob validates; the browser controls the final save location.", "瀏覽器邊界：靜態頁面睇唔到目的地剩餘空間或指定檔案路徑。只有完整、有界而且驗證過嘅 Blob 先會建立下載；最後儲存位置由瀏覽器控制。"],
    queueTitle: ["Bounded queue", "有界隊列"],
    selectAll: ["Select visible", "選取目前顯示"],
    invert: ["Invert selection", "反轉選取"],
    pause: ["Pause new work", "暫停新增工作"],
    resume: ["Resume queue", "繼續隊列"],
    cancel: ["Cancel selected", "取消選取項目"],
    retry: ["Retry failed", "重試失敗項目"],
    export: ["Export safe results", "匯出安全結果"],
    catalogTitle: ["Adapter catalog", "轉換器目錄"],
    catalogLede: ["Every known browser-local route is visible. Disabled formats name the missing bundled adapter instead of pretending a device tool or online service is available.", "每條已知瀏覽器本機路線都會顯示。停用格式會講清楚缺少咩已打包轉換器，唔會扮有裝置工具或者網上服務。"],
    targetTitle: ["Guided target and loss disclosure", "引導式目標同資料損失說明"],
    targetName: ["Download name", "下載名稱"],
    targetHelp: ["For a batch, each source keeps its own base name and uses the selected target extension.", "批量處理時，每個來源會保留自己嘅基本名稱，再套用揀好嘅目標副檔名。"],
    acknowledgeLoss: ["I understand the stated conversion changes before queueing it.", "我明白轉換前面列出嘅改動。"],
    queueSelected: ["Queue selected conversion", "將選取項目加入轉換隊列"],
    unavailableTarget: ["Choose an enabled adapter that matches the selected source.", "請揀一個配合選取來源嘅可用轉換器。"],
    previewTitle: ["Bounded local preview", "有界本機預覽"],
    previewEmpty: ["Select one source to inspect its detected type, bytes, and a small local preview.", "揀一個來源，就可以檢視偵測類型、位元組同細小本機預覽。"],
    historyTitle: ["Result history", "結果歷史"],
    historyEmpty: ["No local converter events are recorded yet.", "暫時未有本機轉換器紀錄。"],
    openEditor: ["Open in external editor", "喺外部編輯器開啟"],
    openEditorBoundary: ["Not available in this static browser surface. Download the validated result, then choose an editor locally.", "靜態瀏覽器介面未能提供呢個功能。請先下載驗證過嘅結果，再喺本機揀編輯器。"],
    ready: ["Ready for local file selection.", "準備好揀本機檔案。"],
    paused: ["Queue paused. In-flight bounded conversions finish before the pause settles.", "隊列已暫停；進行中嘅有界轉換完成後先會完全停低。"],
    noSelection: ["Select one or more source records first.", "請先揀一個或以上來源紀錄。"],
    noCompatible: ["The selected adapter does not support every selected source. Unsupported records stay untouched.", "揀好嘅轉換器唔支援全部選取來源；唔支援嘅紀錄會保持原樣。"],
    lossRequired: ["Confirm the stated conversion changes before queueing a lossy or metadata-changing result.", "請確認列出嘅轉換改動，先可以加入有損失或者會改 metadata 嘅結果。"],
    storageUnavailable: ["Browser persistence is unavailable. This queue works for the current page only and does not claim restart recovery.", "瀏覽器儲存用唔到。呢個隊列只會喺目前頁面運作，唔會聲稱可以重啟復原。"],
    resumeReselect: ["Reloaded records need the original file selected again before they can resume. No source bytes were persisted.", "重新載入嘅紀錄要再揀返原始檔案先可以繼續。冇儲存來源位元組。"],
    converted: ["Validated locally; ready to download.", "已喺本機驗證；可以下載。"],
    download: ["Download validated result", "下載驗證過嘅結果"],
    selected: ["{selected} selected · {visible} visible · {active} active", "已選 {selected} 項 · 顯示 {visible} 項 · 進行中 {active} 項"],
    noMatch: ["No adapters match this local category search.", "呢個本機分類搜尋搵唔到轉換器。"],
    plainText: ["Plain text", "純文字"],
    regex: ["Regex", "正則"],
    regexBuilder: ["Build a pattern beside this category", "喺呢個分類旁邊建立模式"],
    browserAdapter: ["Browser-local", "瀏覽器本機"],
    unavailable: ["Unavailable", "未能提供"],
    enabled: ["Enabled", "可用"],
    status: ["Status", "狀態"],
    noOutputAfterReload: ["The result Blob is intentionally not persisted. Re-run this source after reload to create a new validated download.", "結果 Blob 刻意唔會儲存。重新載入後請再轉換呢個來源，建立新嘅驗證下載。"],
    storageCheck: ["Browser storage estimate", "瀏覽器儲存估算"],
    conversionQueued: ["Conversion queued locally.", "轉換已喺本機排隊。"],
    downloadStarted: ["The browser download was started after local output validation.", "本機輸出驗證完成後，瀏覽器已開始下載。"],
    catalogDeclared: ["{count} declared adapters · {boundary}", "{count} 個已聲明轉換器 · {boundary}"],
    searchLabel: ["Search {category} adapters", "搜尋 {category} 轉換器"],
    searchPlaceholder: ["Search {category}", "搜尋 {category}"],
    openRegex: ["Open {category} regex builder", "開啟 {category} 正則建立器"],
    pattern: ["Pattern", "模式"],
    flags: ["Flags (g i m s u y)", "旗標（g i m s u y）"],
    sampleText: ["Sample text", "範例文字"],
    localMatch: ["Local test: matches sample.", "本機測試：符合範例。"],
    localNoMatch: ["Local test: no sample match.", "本機測試：唔符合範例。"],
    enterPattern: ["Enter a local pattern to test it.", "輸入本機模式嚟測試。"],
    inputDetail: ["Input: {input} · Output: .{output}. {lossiness}", "輸入：{input} · 輸出：.{output}。{lossiness}"],
    target: ["Target: {target} · {adapter}", "目標：{target} · {adapter}"],
    noMime: ["unknown MIME", "未知 MIME"],
    binaryPreview: ["Binary bytes are classified locally but are not rendered as text.", "二進制位元組會喺本機分類，但唔會當文字顯示。"],
    previewDecodeFailure: ["This file cannot be decoded as a bounded UTF-8 preview.", "呢個檔案未能解碼為有界 UTF-8 預覽。"],
    emptyText: ["(empty text file)", "（空文字檔）"],
    sourceAdded: ["{count} source file{plural} added locally.", "已喺本機加入 {count} 個來源檔案。"],
    selectedAdapter: ["{adapter} selected. Review the target and conversion disclosure.", "已揀 {adapter}。請檢閱目標同轉換說明。"],
    cancelled: ["Cancelled before a result was offered.", "提供結果之前已取消。"],
    cancelStatus: ["Selected conversions were cancelled or marked to stop after their current bounded step.", "已取消選取轉換，或者標記為完成目前有界步驟後停止。"],
    retryNone: ["No failed in-session source is available for retry. Reloaded entries need their original file selected again.", "冇失敗嘅本節來源可供重試；重新載入項目要再揀原始檔案。"],
    retryReady: ["{count} failed source{plural} prepared for retry.", "已準備 {count} 個失敗來源重試。"],
    safeExported: ["Safe local conversion metadata was exported. Source and result bytes were omitted.", "已匯出安全本機轉換 metadata；來源同結果位元組已略去。"]
  };
  const CATEGORY_COPY = {
    "Documents/PDF": ["Documents/PDF", "文件／PDF"],
    Images: ["Images", "圖片"],
    Audio: ["Audio", "音訊"],
    Video: ["Video", "影片"],
    Archives: ["Archives", "壓縮檔"],
    "Structured Data/Spreadsheets": ["Structured Data/Spreadsheets", "結構化資料／試算表"],
    "Code/Text": ["Code/Text", "程式碼／文字"],
    "Binary Encodings": ["Binary Encodings", "二進制編碼"]
  };

  const state = {
    records: new Map(),
    history: [],
    runtimeFiles: new Map(),
    outputs: new Map(),
    selected: new Set(),
    activeId: null,
    activeWorkers: 0,
    paused: false,
    selectedAdapterId: null,
    lossAcknowledged: false,
    previewUrl: null,
    storageAvailable: true,
    initialized: false,
    search: Object.fromEntries(contract.categories.map((category) => [category, { mode: "text", query: "", pattern: "", flags: "g", sample: "PNG image\nCSV table\nPDF document", open: false }]))
  };

  function text(key, values = {}) {
    const pair = COPY[key] || [key, key];
    const settings = window.settings || {};
    const school = document.documentElement.dataset.schoolMode === "true" || settings.schoolMode?.enabled === true;
    const language = school ? "en" : settings.language || "en";
    let output = language === "yue" ? pair[1] : language === "bilingual" ? `${pair[0]} · ${pair[1]}` : pair[0];
    for (const [name, value] of Object.entries(values)) output = output.replaceAll(`{${name}}`, String(value));
    if (!school && language === "en" && Number(settings.funnyEn || 3) >= 5 && key === "ready") output += " Local, bounded, and not doing a disappearing act.";
    if (!school && language === "yue" && Number(settings.funnyYue || 3) >= 5 && key === "ready") output += " 本機做嘢，唔會玩失蹤。";
    return output;
  }

  function publicCopy(value) {
    const pair = Array.isArray(value) ? value : [String(value ?? ""), String(value ?? "")];
    const settings = window.settings || {};
    const school = document.documentElement.dataset.schoolMode === "true" || settings.schoolMode?.enabled === true;
    const language = school ? "en" : settings.language || "en";
    return language === "yue" ? pair[1] : language === "bilingual" ? `${pair[0]} · ${pair[1]}` : pair[0];
  }

  function categoryText(category) {
    const pair = CATEGORY_COPY[category] || [category, category];
    const settings = window.settings || {};
    const school = document.documentElement.dataset.schoolMode === "true" || settings.schoolMode?.enabled === true;
    const language = school ? "en" : settings.language || "en";
    return language === "yue" ? pair[1] : language === "bilingual" ? `${pair[0]} · ${pair[1]}` : pair[0];
  }

  function create(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined && value !== null) element.textContent = value;
    return element;
  }

  function makeId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function adapterById(id) { return contract.adapters.find((adapter) => adapter.id === id) || null; }
  function activeRecord() { return state.activeId ? state.records.get(state.activeId) || null : null; }
  function visibleRecords() { return [...state.records.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, RECORD_PAGE_SIZE); }
  function selectedRecords() { return [...state.selected].map((id) => state.records.get(id)).filter(Boolean); }

  function publicRecord(record) {
    return {
      id: record.id,
      source: {
        name: contract.safeFileName(record.source?.name, "source"),
        size: Number(record.source?.size || 0),
        lastModified: Number(record.source?.lastModified || 0),
        kind: contract.cleanText(record.source?.kind, 32),
        label: contract.cleanText(record.source?.label, 96),
        mime: contract.cleanText(record.source?.mime, 96)
      },
      status: ["ready", "queued", "converting", "converted", "failed", "cancelled", "awaiting-reselect"].includes(record.status) ? record.status : "awaiting-reselect",
      adapterId: typeof record.adapterId === "string" ? record.adapterId : null,
      targetName: contract.safeFileName(record.targetName, ""),
      result: record.result ? { name: contract.safeFileName(record.result.name, "converted-file"), bytes: Number(record.result.bytes || 0), mime: contract.cleanText(record.result.mime, 96) } : null,
      error: contract.cleanText(record.error, 320),
      attempt: Math.max(0, Number(record.attempt || 0)),
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
    };
  }

  function publicHistory(entry) {
    return {
      id: contract.cleanText(entry?.id, 100) || makeId("history"),
      recordId: contract.cleanText(entry?.recordId, 120),
      action: contract.cleanText(entry?.action, 60),
      message: contract.cleanText(entry?.message, 320),
      at: typeof entry?.at === "string" ? entry.at : new Date().toISOString()
    };
  }

  class ConverterStore {
    constructor() { this.db = null; }

    async open() {
      if (!window.indexedDB) throw new Error("IndexedDB is not available.");
      this.db = await new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error || new Error("Unable to open browser storage."));
        request.onupgradeneeded = () => {
          const db = request.result;
          const records = db.objectStoreNames.contains("records") ? request.transaction.objectStore("records") : db.createObjectStore("records", { keyPath: "id" });
          if (!records.indexNames.contains("updatedAt")) records.createIndex("updatedAt", "updatedAt");
          const history = db.objectStoreNames.contains("history") ? request.transaction.objectStore("history") : db.createObjectStore("history", { keyPath: "id" });
          if (!history.indexNames.contains("at")) history.createIndex("at", "at");
        };
        request.onsuccess = () => resolve(request.result);
      });
      return this;
    }

    async put(storeName, value) {
      if (!this.db) return;
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value);
        transaction.onerror = () => reject(transaction.error || new Error("Browser storage write failed."));
        transaction.oncomplete = () => resolve();
      });
    }

    async recent(storeName, indexName, maximum) {
      if (!this.db) return [];
      return new Promise((resolve, reject) => {
        const result = [];
        const transaction = this.db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).index(indexName).openCursor(null, "prev");
        request.onerror = () => reject(request.error || new Error("Browser storage read failed."));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || result.length >= maximum) { resolve(result); return; }
          result.push(cursor.value);
          cursor.continue();
        };
      });
    }
  }

  const store = new ConverterStore();

  async function persistRecord(record) {
    const safe = publicRecord(record);
    try { await store.put("records", safe); } catch (_error) { state.storageAvailable = false; }
  }

  async function appendHistory(recordId, action, message) {
    const entry = publicHistory({ id: makeId("history"), recordId, action, message, at: new Date().toISOString() });
    state.history.unshift(entry);
    state.history = state.history.slice(0, HISTORY_PAGE_SIZE);
    try { await store.put("history", entry); } catch (_error) { state.storageAvailable = false; }
    renderHistory();
  }

  function setStatus(message, tone = "neutral") {
    const element = $("#converter-status-message");
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function inputFor(category) { return $(`[data-converter-search-input="${CSS.escape(category)}"]`); }

  function searchError(search) {
    return search.mode === "regex" ? contract.isSafeRegex(search.pattern, search.flags) : null;
  }

  function searchMatches(category, value) {
    const search = state.search[category];
    const haystack = String(value ?? "").slice(0, contract.MAX_REGEX_SAMPLE);
    if (search.mode === "text") return !search.query || haystack.toLocaleLowerCase().includes(search.query.toLocaleLowerCase());
    const error = searchError(search);
    if (error) return false;
    if (!search.pattern) return true;
    try { return new RegExp(search.pattern, search.flags.includes("g") ? search.flags : `${search.flags}g`).test(haystack); } catch (_error) { return false; }
  }

  function renderSearchBuilder(category, host) {
    const search = state.search[category];
    const builder = $(".converter-regex-builder", host);
    if (!builder) return;
    builder.hidden = !search.open;
    if (!search.open) return;
    builder.replaceChildren();
    const heading = create("div");
    heading.append(create("p", "eyebrow", "LOCAL REGEX"));
    heading.append(create("h4", null, text("regexBuilder")));
    builder.append(heading);
    const modes = create("div", "converter-builder-mode");
    ["text", "regex"].forEach((mode) => {
      const button = create("button", search.mode === mode ? "is-active" : "", text(mode === "text" ? "plainText" : "regex"));
      button.type = "button";
      button.dataset.converterBuilderMode = mode;
      button.dataset.converterCategory = category;
      modes.append(button);
    });
    builder.append(modes);
    const tokens = create("div", "converter-builder-tokens");
    const tokenValues = [["literal", "text"], ["class", "[a-z]"], ["anchors", "^$"], ["group", "(text)"], ["alternation", "one|two"], ["quantifier", "x{1,3}"]];
    tokenValues.forEach(([label, value]) => {
      const button = create("button", null, label === "anchors" ? "^ · $" : value);
      button.type = "button";
      button.dataset.converterBuilderToken = value;
      button.dataset.converterCategory = category;
      tokens.append(button);
    });
    builder.append(tokens);
    const fields = create("div", "converter-builder-fields");
    const pattern = create("input"); pattern.type = "text"; pattern.maxLength = contract.MAX_REGEX_LENGTH; pattern.value = search.pattern; pattern.spellcheck = false; pattern.dataset.converterBuilderPattern = category;
    const flags = create("input"); flags.type = "text"; flags.maxLength = 6; flags.value = search.flags; flags.spellcheck = false; flags.dataset.converterBuilderFlags = category;
    const sample = create("textarea"); sample.maxLength = contract.MAX_REGEX_SAMPLE; sample.value = search.sample; sample.spellcheck = false; sample.dataset.converterBuilderSample = category;
    const patternLabel = create("label", null, text("pattern")); patternLabel.append(pattern);
    const flagsLabel = create("label", null, text("flags")); flagsLabel.append(flags);
    const sampleLabel = create("label", null, text("sampleText")); sampleLabel.append(sample);
    fields.append(patternLabel, flagsLabel, sampleLabel);
    builder.append(fields);
    const result = create("p", "converter-builder-status", "");
    result.dataset.converterBuilderResult = category;
    const error = searchError(search);
    result.textContent = error || (search.pattern ? (searchMatches(category, search.sample) ? text("localMatch") : text("localNoMatch")) : text("enterPattern"));
    result.classList.toggle("is-error", Boolean(error));
    builder.append(result);
  }

  function renderCatalog() {
    const catalog = $("#converter-adapter-catalog");
    if (!catalog) return;
    catalog.replaceChildren();
    contract.categories.forEach((category) => {
      const section = create("section", "converter-category");
      section.dataset.converterCategory = category;
      const heading = create("div", "converter-category-heading");
      const headingCopy = create("div");
      headingCopy.append(create("h3", null, categoryText(category)));
      const adapterCount = contract.adapters.filter((adapter) => adapter.category === category).length;
      headingCopy.append(create("p", null, text("catalogDeclared", { count: adapterCount, boundary: text("browserAdapter") })));
      heading.append(headingCopy);
      section.append(heading);

      const searchRow = create("div", "converter-category-search");
      const label = create("label", "sr-only", text("searchLabel", { category: categoryText(category) }));
      const input = create("input");
      input.type = "search";
      input.autocomplete = "off";
      input.placeholder = text("searchPlaceholder", { category: categoryText(category) });
      input.value = state.search[category].query;
      input.dataset.converterSearchInput = category;
      label.htmlFor = `converter-search-${category.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
      input.id = label.htmlFor;
      const builderButton = create("button", "icon-button", ".*");
      builderButton.type = "button";
      builderButton.setAttribute("aria-label", text("openRegex", { category: categoryText(category) }));
      builderButton.setAttribute("aria-expanded", String(state.search[category].open));
      builderButton.dataset.converterBuilderToggle = category;
      searchRow.append(label, input, builderButton);
      section.append(searchRow);
      const builder = create("div", "converter-regex-builder");
      builder.hidden = true;
      section.append(builder);
      renderSearchBuilder(category, section);

      const list = create("div", "converter-adapter-list");
      const adapters = contract.adapters.filter((adapter) => adapter.category === category && searchMatches(category, `${adapter.label} ${adapter.sourceKinds.join(" ")} ${adapter.target.extension} ${adapter.reason} ${adapter.lossiness}`));
      if (!adapters.length) list.append(create("p", "converter-empty", text("noMatch")));
      adapters.forEach((adapter) => {
        const button = create("button", `converter-adapter${state.selectedAdapterId === adapter.id ? " is-selected" : ""}`);
        button.type = "button";
        button.dataset.adapterId = adapter.id;
        button.dataset.enabled = String(adapter.enabled);
        button.disabled = !adapter.enabled;
        const copy = create("span");
        copy.append(create("strong", null, adapter.label));
        const detail = adapter.enabled
          ? text("inputDetail", { input: adapter.sourceKinds.join(", "), output: adapter.target.extension, lossiness: adapter.lossiness })
          : adapter.reason;
        copy.append(create("small", null, detail));
        button.append(copy);
        button.append(create("span", "converter-adapter-badge", adapter.enabled ? text("enabled") : text("unavailable")));
        list.append(button);
      });
      section.append(list);
      catalog.append(section);
    });
  }

  function displayStatus(status) {
    return ({ ready: "ready", queued: "queued", converting: "converting", converted: "converted", failed: "failed", cancelled: "cancelled", "awaiting-reselect": "awaiting reselect" })[status] || "awaiting reselect";
  }

  function renderQueue() {
    const list = $("#converter-record-list");
    if (!list) return;
    const records = visibleRecords();
    list.replaceChildren();
    records.forEach((record) => {
      const item = create("li", `converter-record is-${record.status}${state.activeId === record.id ? " is-active" : ""}`);
      const choice = create("label", "converter-select");
      choice.setAttribute("aria-label", `Select ${record.source.name}`);
      const checkbox = create("input"); checkbox.type = "checkbox"; checkbox.checked = state.selected.has(record.id); checkbox.dataset.converterRecordSelect = record.id;
      choice.append(checkbox);
      const main = create("div", "converter-record-main");
      const title = create("div", "converter-record-title");
      title.append(create("span", null, record.source.name));
      const stateBadge = create("span", "converter-state", displayStatus(record.status)); stateBadge.dataset.state = record.status;
      title.append(stateBadge);
      main.append(title);
      main.append(create("div", "converter-record-meta", `${record.source.label} · ${formatBytes(record.source.size)} · ${record.source.mime || text("noMime")}`));
      if (record.adapterId) main.append(create("div", "converter-record-meta", text("target", { target: record.targetName || contract.makeTargetName(record.source.name, adapterById(record.adapterId)), adapter: record.adapterId })));
      if (record.result) main.append(create("div", "converter-record-meta", `${text("converted")} ${record.result.name} · ${formatBytes(record.result.bytes)}`));
      if (record.error) main.append(create("div", "converter-record-error", record.error));
      if (record.status === "converted") {
        const action = create("button", "text-button", text("download"));
        action.type = "button";
        action.dataset.converterDownload = record.id;
        main.append(action);
      }
      item.append(choice, main);
      item.addEventListener("click", (event) => {
        if (event.target.closest("input")) return;
        state.activeId = record.id;
        renderAll();
      });
      list.append(item);
    });
    if (!records.length) list.append(create("li", "converter-empty", text("previewEmpty")));
    const summary = $("#converter-queue-summary");
    if (summary) summary.textContent = text("selected", { selected: state.selected.size, visible: records.length, active: state.activeWorkers });
  }

  function selectedAdapter() { return adapterById(state.selectedAdapterId); }

  function isLossChanging(adapter) {
    return Boolean(adapter && !/^None; unavailable\.$/i.test(adapter.lossiness) && !/^None\.$/i.test(adapter.lossiness));
  }

  function renderTarget() {
    const adapter = selectedAdapter();
    const record = activeRecord() || selectedRecords()[0] || null;
    const name = $("#converter-target-name");
    const adapterOutput = $("#converter-selected-adapter");
    const loss = $("#converter-loss-notice");
    const lossText = $("#converter-loss-text");
    const acknowledgement = $("#converter-loss-acknowledgement");
    const queue = $("#converter-queue-selected");
    if (adapterOutput) adapterOutput.textContent = adapter ? `${adapter.label} → .${adapter.target.extension}` : text("unavailableTarget");
    if (name) {
      const fallback = record && adapter ? contract.makeTargetName(record.source.name, adapter, record.targetName) : "converted-file";
      if (!name.dataset.touched) name.value = fallback;
      name.disabled = !adapter || !record;
    }
    if (loss && lossText && acknowledgement) {
      const visible = Boolean(adapter && isLossChanging(adapter));
      loss.hidden = !visible;
      lossText.textContent = adapter?.lossiness || "";
      acknowledgement.checked = state.lossAcknowledged;
      acknowledgement.disabled = !visible;
    }
    if (queue) {
      const supported = adapter && adapter.enabled && selectedRecords().length > 0 && selectedRecords().every((candidate) => contract.adapterCanHandle(adapter, candidate.source));
      queue.disabled = !supported || (isLossChanging(adapter) && !state.lossAcknowledged);
      queue.setAttribute("aria-describedby", "converter-target-help");
    }
  }

  async function previewRecord(record) {
    const meta = $("#converter-preview-meta");
    const body = $("#converter-preview-body");
    if (!meta || !body) return;
    body.replaceChildren();
    if (!record) { meta.textContent = text("previewEmpty"); return; }
    const source = record.source;
    meta.textContent = `${source.label} · ${formatBytes(source.size)} · ${source.mime || text("noMime")}. ${text("privacy")}`;
    const file = state.runtimeFiles.get(record.id);
    if (!file) { body.append(create("p", "converter-empty", text("resumeReselect"))); return; }
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
    if (PREVIEW_IMAGE_KINDS.has(source.kind)) {
      const image = create("img", "converter-image-preview");
      image.alt = `Local preview of ${source.name}`;
      state.previewUrl = URL.createObjectURL(file);
      image.src = state.previewUrl;
      body.append(image);
      return;
    }
    if (TEXT_KINDS.has(source.kind)) {
      try {
        const bytes = new Uint8Array(await file.slice(0, contract.MAX_TEXT_PREVIEW_BYTES).arrayBuffer());
        const preview = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        body.append(create("pre", "converter-preview-text", preview || text("emptyText")));
      } catch (_error) { body.append(create("p", "converter-empty", text("previewDecodeFailure"))); }
      return;
    }
    body.append(create("p", "converter-empty", text("binaryPreview")));
  }

  function renderHistory() {
    const list = $("#converter-history-list");
    if (!list) return;
    list.replaceChildren();
    if (!state.history.length) { list.append(create("li", "converter-empty", text("historyEmpty"))); return; }
    state.history.slice(0, HISTORY_PAGE_SIZE).forEach((entry) => {
      const item = create("li", "converter-history-item");
      item.append(create("strong", null, entry.action));
      item.append(create("span", null, entry.message));
      const time = create("time", null, new Date(entry.at).toLocaleString()); time.dateTime = entry.at;
      item.append(time);
      list.append(item);
    });
  }

  async function renderPreview() { await previewRecord(activeRecord() || selectedRecords()[0] || null); }

  async function renderStorageEstimate() {
    const target = $("#converter-storage-estimate");
    if (!target) return;
    if (!navigator.storage?.estimate) { target.textContent = `${text("storageCheck")}: unavailable. ${text("storageBoundary")}`; return; }
    try {
      const estimate = await navigator.storage.estimate();
      target.textContent = `${text("storageCheck")}: ${formatBytes(estimate.usage || 0)} used of ${formatBytes(estimate.quota || 0)} browser storage. ${text("storageBoundary")}`;
    } catch (_error) { target.textContent = `${text("storageCheck")}: unavailable. ${text("storageBoundary")}`; }
  }

  function renderAll() {
    applyLocalizedStaticCopy();
    renderCatalog();
    renderQueue();
    renderTarget();
    renderHistory();
    renderPreview();
    renderStorageEstimate();
    const editor = $("#converter-open-editor");
    if (editor) editor.title = text("openEditorBoundary");
    const persistence = $("#converter-persistence-status");
    if (persistence) persistence.textContent = state.storageAvailable ? contract.queuePolicy.persistence : text("storageUnavailable");
  }

  function applyLocalizedStaticCopy() {
    $$('[data-converter-copy]').forEach((element) => { element.textContent = text(element.dataset.converterCopy); });
    $$('[data-converter-copy-placeholder]').forEach((element) => { element.placeholder = text(element.dataset.converterCopyPlaceholder); });
    $$('[data-converter-copy-aria]').forEach((element) => { element.setAttribute("aria-label", text(element.dataset.converterCopyAria)); });
  }

  async function sniffFile(file) {
    if (file.size > contract.MAX_INPUT_BYTES) throw new Error(`Source exceeds the ${formatBytes(contract.MAX_INPUT_BYTES)} local per-file limit.`);
    const bytes = new Uint8Array(await file.slice(0, contract.MAX_SNIFF_BYTES).arrayBuffer());
    return contract.sniffBytes(bytes, file.name, file.type);
  }

  async function addFile(file) {
    const now = new Date().toISOString();
    const record = {
      id: makeId("conversion"),
      source: { name: contract.safeFileName(file.name, "source"), size: Number(file.size || 0), lastModified: Number(file.lastModified || 0), kind: "binary", label: "Inspecting bounded bytes", mime: contract.cleanText(file.type, 96) },
      status: "ready",
      adapterId: null,
      targetName: "",
      result: null,
      error: "",
      attempt: 0,
      createdAt: now,
      updatedAt: now
    };
    state.records.set(record.id, record);
    state.runtimeFiles.set(record.id, file);
    state.selected.add(record.id);
    state.activeId ||= record.id;
    try {
      const sniff = await sniffFile(file);
      record.source = { name: contract.safeFileName(file.name, "source"), size: Number(file.size || 0), lastModified: Number(file.lastModified || 0), kind: sniff.kind, label: sniff.label, mime: sniff.mime };
      record.updatedAt = new Date().toISOString();
      await appendHistory(record.id, "source selected", `${record.source.label} selected locally (${formatBytes(record.source.size)}).`);
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = new Date().toISOString();
      await appendHistory(record.id, "source rejected", record.error);
    }
    await persistRecord(record);
  }

  async function addFiles(files) {
    let added = 0;
    for (const file of files) {
      if (!(file instanceof File)) continue;
      await addFile(file);
      added += 1;
      renderAll();
    }
    setStatus(added ? `${added} source file${added === 1 ? "" : "s"} added locally.` : text("ready"), added ? "success" : "neutral");
  }

  async function reattachOrAdd(files) {
    for (const file of files) {
      if (!(file instanceof File)) continue;
      const existing = [...state.records.values()].find((record) => record.status === "awaiting-reselect" && record.source.name === contract.safeFileName(file.name, "source") && record.source.size === Number(file.size || 0) && record.source.lastModified === Number(file.lastModified || 0));
      if (existing) {
        state.runtimeFiles.set(existing.id, file);
        existing.status = "ready";
        existing.error = "";
        existing.updatedAt = new Date().toISOString();
        await persistRecord(existing);
        await appendHistory(existing.id, "source reselected", "Original source was selected again locally; it can resume.");
      } else await addFile(file);
    }
    renderAll();
  }

  function requireSelectionAndAdapter() {
    const records = selectedRecords();
    const adapter = selectedAdapter();
    if (!records.length) { setStatus(text("noSelection"), "error"); return null; }
    if (!adapter?.enabled) { setStatus(text("unavailableTarget"), "error"); return null; }
    if (!records.every((record) => contract.adapterCanHandle(adapter, record.source))) { setStatus(text("noCompatible"), "error"); return null; }
    if (isLossChanging(adapter) && !state.lossAcknowledged) { setStatus(text("lossRequired"), "error"); return null; }
    return { records, adapter };
  }

  async function queueSelected() {
    const eligible = requireSelectionAndAdapter();
    if (!eligible) return;
    const requestedName = $("#converter-target-name")?.value || "";
    for (const record of eligible.records) {
      if (!state.runtimeFiles.has(record.id)) {
        record.status = "awaiting-reselect";
        record.error = text("resumeReselect");
        await persistRecord(record);
        continue;
      }
      record.adapterId = eligible.adapter.id;
      record.targetName = contract.makeTargetName(record.source.name, eligible.adapter, eligible.records.length === 1 ? requestedName : "");
      record.status = "queued";
      record.error = "";
      record.cancelRequested = false;
      record.attempt += 1;
      record.updatedAt = new Date().toISOString();
      await persistRecord(record);
      await appendHistory(record.id, "conversion queued", `${eligible.adapter.label} queued for ${record.targetName}.`);
    }
    setStatus(text("conversionQueued"), "success");
    renderAll();
    pumpQueue();
  }

  async function readBoundedFile(file) {
    if (file.size > contract.MAX_INPUT_BYTES) throw new Error(`Source exceeds the ${formatBytes(contract.MAX_INPUT_BYTES)} local per-file limit.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > contract.MAX_INPUT_BYTES) throw new Error("Source bytes exceeded the declared local input bound.");
    return bytes;
  }

  async function canvasBlob(canvas, mime) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`The browser did not produce ${mime}.`)), mime, 0.92);
    });
  }

  async function convertImage(file, adapter) {
    if (typeof window.createImageBitmap !== "function") throw new Error("This browser does not expose ImageBitmap, so the declared local image adapter is unavailable here.");
    const bitmap = await window.createImageBitmap(file);
    try {
      const pixels = bitmap.width * bitmap.height;
      if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 24_000_000) throw new Error("Decoded image exceeds the 24-megapixel local safety bound.");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { alpha: adapter.target.mime !== "image/jpeg", colorSpace: "srgb" });
      if (!context) throw new Error("The browser did not provide a local Canvas 2D context.");
      if (adapter.target.mime === "image/jpeg") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(bitmap, 0, 0);
      const blob = await canvasBlob(canvas, adapter.target.mime);
      if (blob.type !== adapter.target.mime) throw new Error(`The browser produced ${blob.type || "an unknown type"}, not the requested ${adapter.target.mime}.`);
      return blob;
    } finally { bitmap.close?.(); }
  }

  async function outputBlobFor(record, adapter, file) {
    if (adapter.conversion === "canvas") return convertImage(file, adapter);
    const bytes = await readBoundedFile(file);
    const transformed = contract.transform(adapter.id, bytes);
    const blob = new Blob([transformed.kind === "bytes" ? transformed.bytes : transformed.text], { type: transformed.mime });
    return blob;
  }

  async function validateBlob(adapter, blob) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > contract.MAX_OUTPUT_BYTES) throw new Error(`Output is empty or exceeds the ${formatBytes(contract.MAX_OUTPUT_BYTES)} local result limit.`);
    const sample = new Uint8Array(await blob.slice(0, contract.MAX_SNIFF_BYTES).arrayBuffer());
    if (!contract.validateOutput(adapter, sample)) throw new Error("Output validation failed. No browser download was created.");
  }

  async function convertRecord(record) {
    const file = state.runtimeFiles.get(record.id);
    const adapter = adapterById(record.adapterId);
    if (!file) {
      record.status = "awaiting-reselect";
      record.error = text("resumeReselect");
      await persistRecord(record);
      return;
    }
    if (!adapter?.enabled || !contract.adapterCanHandle(adapter, record.source)) throw new Error("The selected adapter no longer matches this source; the source remains unchanged.");
    record.status = "converting";
    record.error = "";
    record.updatedAt = new Date().toISOString();
    await persistRecord(record);
    renderQueue();
    try {
      const blob = await outputBlobFor(record, adapter, file);
      if (record.cancelRequested) throw new Error("Conversion cancelled before a result was offered.");
      await validateBlob(adapter, blob);
      if (record.cancelRequested) throw new Error("Conversion cancelled before a result was offered.");
      state.outputs.set(record.id, blob);
      record.result = { name: record.targetName || contract.makeTargetName(record.source.name, adapter), bytes: blob.size, mime: blob.type };
      record.status = "converted";
      record.error = "";
      record.updatedAt = new Date().toISOString();
      await persistRecord(record);
      await appendHistory(record.id, "conversion validated", `${adapter.label} produced a validated local result (${formatBytes(blob.size)}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = /cancelled/i.test(message) ? "cancelled" : "failed";
      record.error = message;
      record.updatedAt = new Date().toISOString();
      await persistRecord(record);
      await appendHistory(record.id, record.status === "cancelled" ? "conversion cancelled" : "conversion failed", message);
    } finally {
      record.cancelRequested = false;
      renderAll();
    }
  }

  function nextQueuedRecord() {
    return [...state.records.values()].find((record) => record.status === "queued" && state.runtimeFiles.has(record.id));
  }

  function pumpQueue() {
    if (state.paused) return;
    while (!state.paused && state.activeWorkers < contract.queuePolicy.maxConcurrentConversions) {
      const record = nextQueuedRecord();
      if (!record) break;
      state.activeWorkers += 1;
      convertRecord(record).finally(() => {
        state.activeWorkers = Math.max(0, state.activeWorkers - 1);
        renderQueue();
        pumpQueue();
      });
    }
    renderQueue();
  }

  async function cancelSelected() {
    const records = selectedRecords();
    if (!records.length) { setStatus(text("noSelection"), "error"); return; }
    for (const record of records) {
      if (record.status === "converting") { record.cancelRequested = true; continue; }
      if (["queued", "ready", "awaiting-reselect", "failed"].includes(record.status)) {
        record.status = "cancelled";
        record.error = "Cancelled before a result was offered.";
        record.updatedAt = new Date().toISOString();
        await persistRecord(record);
        await appendHistory(record.id, "conversion cancelled", "Cancelled before a result was offered.");
      }
    }
    setStatus("Selected conversions were cancelled or marked to stop after their current bounded step.", "neutral");
    renderAll();
  }

  async function retryFailed() {
    const candidates = [...state.records.values()].filter((record) => record.status === "failed" && state.runtimeFiles.has(record.id));
    for (const record of candidates) {
      record.status = "ready";
      record.error = "";
      record.updatedAt = new Date().toISOString();
      await persistRecord(record);
      state.selected.add(record.id);
    }
    if (!candidates.length) { setStatus("No failed in-session source is available for retry. Reloaded entries need their original file selected again.", "neutral"); return; }
    setStatus(`${candidates.length} failed source${candidates.length === 1 ? "" : "s"} prepared for retry.`, "success");
    renderAll();
  }

  function downloadBlob(record) {
    const blob = state.outputs.get(record.id);
    if (!blob || !record.result) { setStatus(text("noOutputAfterReload"), "error"); return; }
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = record.result.name;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    appendHistory(record.id, "validated result download", `${record.result.name} was handed to the browser only after local validation.`);
    setStatus(text("downloadStarted"), "success");
  }

  function exportSafeResults() {
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope: "Browser-local converter metadata only",
      omissions: ["Source bytes", "Generated result bytes", "Browser file paths", "Object URLs", "File handles", "External editor state"],
      browserBoundary: "This export cannot prove the browser download destination or free destination storage.",
      queuePolicy: contract.queuePolicy,
      records: [...state.records.values()].map((record) => ({
        id: record.id,
        source: { size: record.source.size, kind: record.source.kind, label: record.source.label, mime: record.source.mime },
        status: record.status,
        adapterId: record.adapterId,
        targetName: record.targetName,
        result: record.result,
        error: record.error,
        attempt: record.attempt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })),
      history: state.history.map(publicHistory)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = "material-download-manager-converter-results.json";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Safe local conversion metadata was exported. Source and result bytes were omitted.", "success");
  }

  function bindEvents() {
    $("#converter-file-input")?.addEventListener("change", async (event) => {
      await reattachOrAdd(event.currentTarget.files || []);
      event.currentTarget.value = "";
    });
    $("#converter-select-all")?.addEventListener("click", () => { visibleRecords().forEach((record) => state.selected.add(record.id)); renderAll(); });
    $("#converter-select-inverse")?.addEventListener("click", () => { visibleRecords().forEach((record) => state.selected.has(record.id) ? state.selected.delete(record.id) : state.selected.add(record.id)); renderAll(); });
    $("#converter-pause")?.addEventListener("click", () => { state.paused = true; setStatus(text("paused"), "neutral"); renderQueue(); });
    $("#converter-resume")?.addEventListener("click", () => { state.paused = false; setStatus(text("ready"), "success"); pumpQueue(); renderQueue(); });
    $("#converter-cancel")?.addEventListener("click", () => cancelSelected());
    $("#converter-retry")?.addEventListener("click", () => retryFailed());
    $("#converter-export")?.addEventListener("click", exportSafeResults);
    $("#converter-queue-selected")?.addEventListener("click", () => queueSelected());
    $("#converter-target-name")?.addEventListener("input", (event) => { event.currentTarget.dataset.touched = "true"; });
    $("#converter-loss-acknowledgement")?.addEventListener("change", (event) => { state.lossAcknowledged = Boolean(event.currentTarget.checked); renderTarget(); });
    $("#converter-open-editor")?.addEventListener("click", () => setStatus(text("openEditorBoundary"), "neutral"));

    document.addEventListener("change", (event) => {
      const input = event.target.closest("[data-converter-record-select]");
      if (input) {
        const id = input.dataset.converterRecordSelect;
        input.checked ? state.selected.add(id) : state.selected.delete(id);
        state.activeId = id;
        renderAll();
      }
    });
    document.addEventListener("input", (event) => {
      const searchInput = event.target.closest("[data-converter-search-input]");
      if (searchInput) {
        const category = searchInput.dataset.converterSearchInput;
        const search = state.search[category];
        search.query = searchInput.value;
        if (search.mode === "text") search.pattern = search.query;
        renderCatalog();
        return;
      }
      const pattern = event.target.closest("[data-converter-builder-pattern]");
      const flags = event.target.closest("[data-converter-builder-flags]");
      const sample = event.target.closest("[data-converter-builder-sample]");
      const category = pattern?.dataset.converterBuilderPattern || flags?.dataset.converterBuilderFlags || sample?.dataset.converterBuilderSample;
      if (!category) return;
      const search = state.search[category];
      if (pattern) { search.pattern = pattern.value; search.query = pattern.value; const input = inputFor(category); if (input) input.value = pattern.value; }
      if (flags) search.flags = flags.value.replace(/[^gimsuy]/g, "").split("").filter((value, index, values) => values.indexOf(value) === index).join("");
      if (sample) search.sample = sample.value.slice(0, contract.MAX_REGEX_SAMPLE);
      renderCatalog();
    });
    document.addEventListener("click", (event) => {
      const adapterButton = event.target.closest("[data-adapter-id]");
      if (adapterButton) {
        const adapter = adapterById(adapterButton.dataset.adapterId);
        if (!adapter?.enabled) { setStatus(adapter?.reason || text("unavailableTarget"), "neutral"); return; }
        state.selectedAdapterId = adapter.id;
        state.lossAcknowledged = false;
        const targetInput = $("#converter-target-name");
        if (targetInput) delete targetInput.dataset.touched;
        setStatus(`${adapter.label} selected. Review the target and conversion disclosure.`, "success");
        renderAll();
        return;
      }
      const toggle = event.target.closest("[data-converter-builder-toggle]");
      if (toggle) {
        const category = toggle.dataset.converterBuilderToggle;
        Object.entries(state.search).forEach(([key, search]) => { search.open = key === category ? !search.open : false; });
        renderCatalog();
        return;
      }
      const mode = event.target.closest("[data-converter-builder-mode]");
      if (mode) {
        const category = mode.dataset.converterCategory;
        state.search[category].mode = mode.dataset.converterBuilderMode;
        renderCatalog();
        return;
      }
      const token = event.target.closest("[data-converter-builder-token]");
      if (token) {
        const category = token.dataset.converterCategory;
        const search = state.search[category];
        search.mode = "regex";
        search.pattern += token.dataset.converterBuilderToken;
        search.query = search.pattern;
        renderCatalog();
        return;
      }
      const download = event.target.closest("[data-converter-download]");
      if (download) { const record = state.records.get(download.dataset.converterDownload); if (record) downloadBlob(record); }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const openCategory = Object.values(state.search).find((search) => search.open);
        if (openCategory) { Object.values(state.search).forEach((search) => { search.open = false; }); renderCatalog(); }
      }
    });
    window.addEventListener("mdm-site-converter-focus", (event) => {
      const target = event.detail === "catalog" ? $("#converter-adapter-catalog") : $("#converter-file-input");
      target?.focus?.();
      target?.scrollIntoView?.({ block: "center", behavior: document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth" });
    });
    window.addEventListener("storage", () => renderAll());
    new MutationObserver(() => renderAll()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-school-mode", "data-reduced-motion"] });
  }

  async function hydrate() {
    try {
      await store.open();
      const records = await store.recent("records", "updatedAt", RECORD_PAGE_SIZE);
      for (const raw of records) {
        const record = publicRecord(raw);
        if (["queued", "converting", "ready"].includes(record.status)) {
          record.status = "awaiting-reselect";
          record.error = text("resumeReselect");
          record.updatedAt = new Date().toISOString();
          await persistRecord(record);
        }
        state.records.set(record.id, record);
      }
      const history = await store.recent("history", "at", HISTORY_PAGE_SIZE);
      state.history = history.map(publicHistory);
      if (records.length) setStatus(text("resumeReselect"), "neutral");
    } catch (_error) {
      state.storageAvailable = false;
      setStatus(text("storageUnavailable"), "error");
    }
  }

  async function initialize() {
    bindEvents();
    await hydrate();
    state.initialized = true;
    renderAll();
    window.MDM_SITE_CONVERTER = Object.freeze({
      focus(kind = "source") { window.dispatchEvent(new CustomEvent("mdm-site-converter-focus", { detail: kind })); },
      getContract() { return contract; }
    });
    if (!state.records.size) setStatus(text("ready"), "success");
  }

  initialize();
})();
