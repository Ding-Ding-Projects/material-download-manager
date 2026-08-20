(function () {
  "use strict";

  const contract = window.OLLAMA_SUITE_CONTRACT;
  const root = document.getElementById("ollama-suite-root");
  if (!contract || !root) return;

  const STATE_KEY = "mdm-site-ollama-suite-v1";
  const SITE_SETTINGS_KEY = "mdm-site-settings-v2";
  const RUNTIME_TIMEOUT_MS = 6000;
  const JSON_LIMIT_BYTES = 1024 * 1024;
  const STREAM_LIMIT_BYTES = 8 * 1024 * 1024;
  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
  const BUILTIN_PROFILES = [
    { id: "health", label: "Local runtime health", kind: "health" },
    { id: "inventory", label: "Installed inventory refresh", kind: "inventory" },
    { id: "chat-readiness", label: "Selected model chat readiness", kind: "chat-readiness" },
    { id: "model-inspect", label: "Selected model capability inspection", kind: "model-inspect" }
  ];
  const TABS = [
    ["runtime", "Runtime", "本機服務"],
    ["store", "Model store", "模型庫"],
    ["cart", "Batch pull", "批量下載"],
    ["chat", "Local chat", "本機對話"],
    ["harness", "Harness", "驗證工具"],
    ["history", "History", "記錄"],
    ["docs", "Documentation", "文件"],
  ];
  const SEARCH_DEFAULTS = {
    store: "models, families, tags, capabilities",
    cart: "queued local pulls",
    chats: "local chat sessions",
    history: "local operation history",
    profiles: "local browser profiles"
  };

  const DEFAULT_STATE = {
    schemaVersion: contract.schemaVersion,
    endpoint: "http://127.0.0.1:11434",
    runtime: null,
    catalog: null,
    cart: [],
    chats: [],
    profiles: [],
    history: []
  };

  const ui = {
    activeTab: "runtime",
    storeFilter: "all",
    fitFilter: "all",
    selectedChatId: null,
    selectedModel: null,
    selectedProfileId: "health",
    attachment: null,
    attachmentCapability: {},
    toasts: [],
    search: Object.fromEntries(Object.entries(SEARCH_DEFAULTS).map(([id, sample]) => [id, { mode: "text", query: "", pattern: "", flags: "g", sample, open: false, error: null }])),
    historySelection: new Set(),
    inFlight: new Map(),
    pullControllers: new Map(),
    parallelism: 1,
    confirm: null,
    browserEvidence: {},
    lastSettingsSignature: ""
  };

  let state = readState();

  function $(selector, scope = root) { return scope.querySelector(selector); }
  function $$(selector, scope = root) { return [...scope.querySelectorAll(selector)]; }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = renderUserText(text);
    return element;
  }

  // The generic site owner supplies this payload-free text-boundary hook. The
  // suite never reads a vocabulary cache, mapping, filename, or source path.
  function renderUserText(value) {
    const raw = String(value ?? "");
    const renderer = window.MDM_SITE_USER_TEXT?.render;
    if (typeof renderer !== "function") return raw;
    try {
      const rendered = renderer(raw);
      return typeof rendered === "string" ? rendered : raw;
    } catch (_error) {
      return raw;
    }
  }

  function button(label, action, className = "button button-outlined") {
    const element = create("button", className, label);
    element.type = "button";
    element.dataset.ollamaAction = action;
    return element;
  }

  function formattedBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let size = bytes / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
  }

  function getSiteSettings() {
    try {
      const raw = localStorage.getItem(SITE_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        language: ["en", "yue", "bilingual"].includes(parsed.language) ? parsed.language : "en",
        funnyEn: Number.isInteger(parsed.funnyEn) ? parsed.funnyEn : 3,
        funnyYue: Number.isInteger(parsed.funnyYue) ? parsed.funnyYue : 3,
        showEmojis: parsed.showEmojis !== false,
        school: Boolean(parsed.schoolMode?.enabled)
      };
    } catch (_error) {
      return { language: "en", funnyEn: 3, funnyYue: 3, showEmojis: true, school: false };
    }
  }

  function localize(english, cantonese) {
    const preferences = getSiteSettings();
    if (preferences.school || preferences.language === "en") return english;
    if (preferences.language === "yue") return cantonese;
    return `${english} · ${cantonese}`;
  }

  function playful(english, cantonese) {
    const preferences = getSiteSettings();
    const level = preferences.language === "yue" ? preferences.funnyYue : preferences.funnyEn;
    if (preferences.school || level <= 2) return localize(english, cantonese);
    if (level >= 5) return localize(`${english} No cloud confetti, just facts.`, `${cantonese} 冇雲端煙花，淨係講事實。`);
    return localize(english, cantonese);
  }

  function statusText(english, cantonese) { return localize(english, cantonese); }

  function safeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function now() { return new Date().toISOString(); }

  function readState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const normalized = contract.normalizeLocalState(JSON.parse(raw));
      return normalized || structuredClone(DEFAULT_STATE);
    } catch (_error) {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function saveState() {
    const normalized = contract.normalizeLocalState(state);
    if (!normalized) {
      toast("error", "Local state was not saved", "The browser rejected an invalid local-only record and kept the last valid state.");
      return false;
    }
    state = normalized;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return true;
    } catch (_error) {
      toast("warning", "Browser storage is unavailable", "The current local-only change remains in memory and may not survive a reload.");
      return false;
    }
  }

  function record(action, detail) {
    const entry = {
      id: safeId("history"),
      action: String(action).slice(0, 80),
      detail: contract.redactText(detail).slice(0, 400) || "Local action recorded.",
      createdAt: now()
    };
    state.history = [...state.history, entry].slice(-contract.maxHistory);
    saveState();
  }

  function toast(tone, title, message) {
    const record = { id: safeId("toast"), tone, title: String(title).slice(0, 160), message: String(message).slice(0, 400) };
    ui.toasts = [...ui.toasts, record].slice(-4);
    renderToastRegion();
    if (tone !== "error" && tone !== "warning") {
      window.setTimeout(() => {
        ui.toasts = ui.toasts.filter((item) => item.id !== record.id);
        renderToastRegion();
      }, 5200);
    }
  }

  function renderToastRegion() {
    const region = $("#ollama-toast-region");
    if (!region) return;
    region.replaceChildren();
    const useEmoji = getSiteSettings().showEmojis;
    const marks = { success: "✓", progress: "…", warning: "!", error: "!", info: "i" };
    ui.toasts.forEach((toastRecord) => {
      const item = create("article", `ollama-toast ${toastRecord.tone}`);
      if (useEmoji) {
        const mark = create("span", "ollama-toast-mark", marks[toastRecord.tone] || "i");
        mark.setAttribute("aria-hidden", "true");
        item.append(mark);
      }
      const copy = create("div", "ollama-toast-copy");
      copy.append(create("strong", null, toastRecord.title), create("span", null, toastRecord.message));
      item.append(copy);
      const dismiss = button("Dismiss", "dismiss-toast", "icon-button");
      dismiss.dataset.toastId = toastRecord.id;
      dismiss.setAttribute("aria-label", `Dismiss: ${toastRecord.title}`);
      item.append(dismiss);
      region.append(item);
    });
  }

  function isSchoolMode() { return getSiteSettings().school; }

  function syncSchoolMode() {
    const preferences = getSiteSettings();
    const signature = JSON.stringify(preferences);
    if (signature === ui.lastSettingsSignature) return false;
    ui.lastSettingsSignature = signature;
    root.hidden = preferences.school;
    if (preferences.school) {
      ui.toasts = [];
      root.setAttribute("aria-hidden", "true");
    } else {
      root.removeAttribute("aria-hidden");
    }
    return true;
  }

  function safeRegexIssue(pattern, flags) {
    if (pattern.length > 256) return "Patterns are limited to 256 characters.";
    if (!/^[gimsuy]*$/.test(flags) || new Set(flags).size !== flags.length) return "Use each JavaScript flag at most once: g i m s u y.";
    if (/(\([^)]*[+*][^)]*\))[+*{]/.test(pattern) || /\([^)]*\|[^)]*\)[+*{]/.test(pattern)) return "This ambiguous quantified pattern is rejected before local evaluation.";
    try { new RegExp(pattern, flags); return null; } catch (error) { return error.message; }
  }

  function searchMatches(id, source) {
    const search = ui.search[id];
    const haystack = String(source ?? "").slice(0, 100000);
    if (search.mode === "text") return !search.query || haystack.toLocaleLowerCase().includes(search.query.toLocaleLowerCase());
    search.error = safeRegexIssue(search.pattern, search.flags);
    if (search.error) return false;
    if (!search.pattern) return true;
    try {
      const expression = new RegExp(search.pattern, search.flags.includes("g") ? search.flags : `${search.flags}g`);
      expression.lastIndex = 0;
      return expression.test(haystack);
    } catch (_error) { return false; }
  }

  function buildSearchControl(id, label, placeholder) {
    const stateForSearch = ui.search[id];
    const wrapper = create("div", "ollama-search-row");
    wrapper.dataset.ollamaSearch = id;
    const fieldLabel = create("label", "search-field");
    fieldLabel.htmlFor = `ollama-search-${id}`;
    fieldLabel.append(create("span", "sr-only", label));
    const input = create("input");
    input.type = "search";
    input.id = `ollama-search-${id}`;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.maxLength = 256;
    input.value = stateForSearch.query;
    input.dataset.ollamaSearchInput = id;
    fieldLabel.append(input);
    const toggle = button("Regex builder", "toggle-builder", "button button-outlined ollama-builder-toggle");
    toggle.dataset.builderId = id;
    toggle.setAttribute("aria-expanded", String(stateForSearch.open));
    toggle.setAttribute("aria-controls", `ollama-builder-${id}`);
    const stateChip = create("span", "status-chip", stateForSearch.mode === "regex" ? `Regex · ${stateForSearch.flags || "no flags"}` : "Plain text");
    const panel = create("div", "ollama-builder-popover");
    panel.id = `ollama-builder-${id}`;
    panel.hidden = !stateForSearch.open;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${label} regular expression builder`);
    panel.dataset.builderId = id;
    const heading = create("div", "ollama-builder-heading");
    heading.append(create("strong", null, "Build beside this search"), create("span", "status-chip", "JavaScript RegExp"));
    panel.append(heading);
    const modes = create("div", "ollama-builder-row");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "Search mode");
    ["text", "regex"].forEach((mode) => {
      const modeButton = button(mode === "text" ? "Plain text" : "Regex", "set-builder-mode", `ollama-builder-mode${stateForSearch.mode === mode ? " is-active" : ""}`);
      modeButton.dataset.builderId = id;
      modeButton.dataset.builderMode = mode;
      modes.append(modeButton);
    });
    panel.append(modes);
    const tokenRow = create("div", "ollama-builder-row");
    tokenRow.append(create("span", "ollama-builder-label", "Insert"));
    [["literal", "literal"], ["class", "[a-z]"], ["anchors", "^ · $"], ["group", "(group)"], ["alternation", "one|two"], ["quantifier", "x{1,3}"]].forEach(([token, labelText]) => {
      const tokenButton = button(labelText, "builder-token", "ollama-builder-token");
      tokenButton.dataset.builderId = id;
      tokenButton.dataset.builderToken = token;
      tokenRow.append(tokenButton);
    });
    panel.append(tokenRow);
    const fields = create("div", "ollama-builder-fields");
    [["Pattern", "pattern", "text", 256], ["Flags", "flags", "text", 6]].forEach(([field, key, type, maximum]) => {
      const inputLabel = create("label", null, field);
      const fieldInput = create("input");
      fieldInput.type = type;
      fieldInput.maxLength = maximum;
      fieldInput.spellcheck = false;
      fieldInput.value = stateForSearch[key];
      fieldInput.dataset.builderField = key;
      fieldInput.dataset.builderId = id;
      inputLabel.append(fieldInput);
      fields.append(inputLabel);
    });
    const sampleLabel = create("label", null, "Sample text");
    const sample = create("textarea");
    sample.maxLength = 100000;
    sample.value = stateForSearch.sample;
    sample.dataset.builderField = "sample";
    sample.dataset.builderId = id;
    sampleLabel.append(sample);
    fields.append(sampleLabel);
    panel.append(fields);
    const matches = evaluateBuilder(id);
    const error = create("p", "ollama-builder-error", matches.error || "");
    error.setAttribute("role", "status");
    panel.append(error);
    const output = create("div", "ollama-builder-output");
    output.append(create("strong", null, `Live matches: ${matches.values.length}`));
    const copy = button("Copy pattern", "copy-builder", "text-button");
    copy.dataset.builderId = id;
    const exportButton = button("Export JSON", "export-builder", "text-button");
    exportButton.dataset.builderId = id;
    output.append(copy, exportButton);
    panel.append(output);
    const matchList = create("div", "ollama-builder-matches");
    if (matches.error) matchList.append(create("span", null, "Correct the pattern before it is used."));
    else if (!matches.values.length) matchList.append(create("span", null, stateForSearch.pattern ? "No matches" : "Enter a pattern to preview matches."));
    else matches.values.forEach((match) => matchList.append(create("span", null, `@${match.index}: ${JSON.stringify(match.value)}${match.captures.length ? ` · captures ${JSON.stringify(match.captures)}` : ""}`)));
    panel.append(matchList);
    wrapper.append(fieldLabel, toggle, stateChip, panel);
    return wrapper;
  }

  function evaluateBuilder(id) {
    const search = ui.search[id];
    const error = safeRegexIssue(search.pattern, search.flags);
    if (error || !search.pattern) return { error, values: [] };
    try {
      const expression = new RegExp(search.pattern, search.flags.includes("g") ? search.flags : `${search.flags}g`);
      const values = [];
      let match;
      const sample = String(search.sample).slice(0, 100000);
      while ((match = expression.exec(sample)) && values.length < 20) {
        values.push({ value: match[0], index: match.index, captures: match.slice(1) });
        if (!match[0]) expression.lastIndex += 1;
      }
      return { error: null, values };
    } catch (error) { return { error: error.message, values: [] }; }
  }

  function tokenText(token) {
    return { literal: "literal", class: "[a-z]", anchors: "^$", group: "(group)", alternation: "one|two", quantifier: "x{1,3}" }[token] || "";
  }

  function downloadFile(name, object) {
    const blob = new Blob([typeof object === "string" ? object : JSON.stringify(object, null, 2)], { type: "application/json;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("success", "Copied locally", "The local browser clipboard now has the selected pattern.");
    } catch (_error) {
      toast("warning", "Copy was unavailable", "The browser denied clipboard access; the pattern remains in the builder.");
    }
  }

  function endpoint() {
    return contract.normalizeEndpoint(state.endpoint);
  }

  function requestInit(method, body, signal) {
    return {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal
    };
  }

  async function localFetch(path, options = {}) {
    const base = endpoint();
    if (!base) throw new Error("Only http://127.0.0.1:11434, http://localhost:11434, and http://[::1]:11434 are accepted.");
    const allowed = new Set(["/api/version", "/api/tags", "/api/ps", "/api/show", "/api/pull", "/api/delete", "/api/copy", "/api/chat"]);
    if (!allowed.has(path)) throw new Error("The browser-only suite rejected an unregistered local API route.");
    const controller = options.controller || new AbortController();
    // Streaming endpoints deliberately opt out with timeout: 0; turning that
    // into setTimeout(..., 0) would abort a truthful pull/chat before it starts.
    const timeoutMs = options.timeout === 0 ? null : (options.timeout ?? RUNTIME_TIMEOUT_MS);
    const timeout = timeoutMs === null ? null : window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, requestInit(options.method || "GET", options.body, controller.signal));
      if (!response.ok) throw new Error(`The local API returned HTTP ${response.status}.`);
      return response;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }

  async function limitedJson(response, limit = JSON_LIMIT_BYTES) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The local API response has no readable body.");
    const decoder = new TextDecoder();
    let result = "";
    let seen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > limit) throw new Error("The local API response exceeded the browser safety limit.");
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return JSON.parse(result);
  }

  function safeFailure(error) {
    if (error?.name === "AbortError") return "The local operation was cancelled or timed out without a success claim.";
    const message = String(error?.message || "");
    if (/HTTP \d+/.test(message)) return message;
    return "The browser could not reach the local API. Confirm that Ollama is running on the selected loopback origin and that this page is served from a compatible local HTTP origin with CORS permission.";
  }

  async function collectBrowserEvidence() {
    const evidence = {};
    if (Number.isFinite(navigator.deviceMemory)) evidence.deviceMemoryGiB = navigator.deviceMemory;
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        evidence.quotaBytes = estimate.quota;
        evidence.usageBytes = estimate.usage;
      } catch (_error) { /* Browser storage evidence is optional. */ }
    }
    ui.browserEvidence = evidence;
  }

  async function refreshRuntime() {
    const base = endpoint();
    if (!base) {
      toast("error", "Loopback endpoint rejected", "Use only a credential-free local Ollama origin on port 11434.");
      render();
      return;
    }
    ui.inFlight.set("runtime", true);
    render();
    try {
      const [versionResponse, tagsResponse, runningResponse] = await Promise.all([
        localFetch("/api/version"), localFetch("/api/tags"), localFetch("/api/ps")
      ]);
      const [versionBody, tagsBody, runningBody] = await Promise.all([
        limitedJson(versionResponse, 32768), limitedJson(tagsResponse), limitedJson(runningResponse)
      ]);
      const version = typeof versionBody?.version === "string" && versionBody.version.length <= 80 ? versionBody.version : null;
      const installed = contract.normalizeTagsResponse(tagsBody);
      const running = contract.normalizeRunningResponse(runningBody);
      if (!version || !installed || !running) throw new Error("The local API response did not match the bounded documented shape.");
      state.runtime = { version, refreshedAt: now(), installed, running };
      saveState();
      record("runtime-refreshed", `Local API version ${version}; ${installed.length} installed tags and ${running.length} running tags.`);
      toast("success", "Local runtime refreshed", `${installed.length} installed tag(s) and ${running.length} running tag(s) were read from the loopback API.`);
    } catch (error) {
      record("runtime-refresh-failed", safeFailure(error));
      toast("warning", "Local runtime remains unavailable", safeFailure(error));
    } finally {
      ui.inFlight.delete("runtime");
      await collectBrowserEvidence();
      render();
    }
  }

  function runtimeFreshness() {
    if (!state.runtime) return localize("No verified local runtime snapshot exists.", "未有已驗證嘅本機服務快照。");
    const age = Math.max(0, Date.now() - Date.parse(state.runtime.refreshedAt));
    const minutes = Math.floor(age / 60000);
    return localize(`Cached local snapshot: ${minutes} minute(s) old.`, `快取本機快照：${minutes} 分鐘前。`);
  }

  function catalogAge() {
    if (!state.catalog) return localize("No catalog snapshot is loaded.", "未有模型目錄快照。 ");
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(state.catalog.refreshedAt)) / 60000));
    return localize(`Local snapshot age: ${minutes} minute(s); ${state.catalog.pageCount} recorded page(s).`, `本機快照：${minutes} 分鐘前；記錄咗 ${state.catalog.pageCount} 頁。`);
  }

  function installedModels() { return state.runtime?.installed || []; }
  function runningModels() { return state.runtime?.running || []; }

  function unifiedModels() {
    const installed = new Map(installedModels().map((model) => [model.name, model]));
    const catalog = state.catalog?.models || [];
    const records = new Map();
    catalog.forEach((model) => records.set(model.tag, {
      tag: model.tag,
      family: model.family,
      description: model.description,
      sizeBytes: model.sizeBytes,
      parameterCount: model.parameterCount,
      quantization: model.quantization,
      capabilities: model.capabilities || [],
      catalog: true,
      installed: installed.has(model.tag),
      running: runningModels().some((running) => running.name === model.tag)
    }));
    installed.forEach((model, name) => {
      const current = records.get(name) || {};
      records.set(name, {
        tag: name,
        family: current.family || model.details?.family || "Local model",
        description: current.description || "Installed tag returned by the local Ollama API.",
        sizeBytes: current.sizeBytes || model.size,
        parameterCount: current.parameterCount || model.details?.parameter_size,
        quantization: current.quantization || model.details?.quantization_level,
        capabilities: current.capabilities || [],
        catalog: Boolean(current.catalog),
        installed: true,
        running: runningModels().some((running) => running.name === name),
        localDetails: model.details || {}
      });
    });
    return [...records.values()].sort((left, right) => left.tag.localeCompare(right.tag));
  }

  function modelFit(model) {
    const running = runningModels();
    const candidate = { name: model.tag, size: model.sizeBytes, tag: model.tag, sizeBytes: model.sizeBytes };
    return contract.estimateFit(candidate, running, ui.browserEvidence);
  }

  function cartItem(tag) { return state.cart.find((item) => item.tag === tag); }

  function addToCart(tag) {
    if (!contract.isSafeModelName(tag)) return;
    if (cartItem(tag)) { toast("info", "Already in the pull cart", `${tag} already has a durable local cart record.`); return; }
    state.cart.push({ tag, status: "queued", detail: "Waiting for a local pull.", updatedAt: now() });
    saveState();
    record("cart-added", `Queued local pull for ${tag}.`);
    toast("success", "Added to local pull cart", `${tag} is queued; this is not a purchase or checkout.`);
    render();
  }

  function updateCart(tag, status, detail) {
    state.cart = state.cart.map((item) => item.tag === tag ? { tag, status, detail: contract.redactText(detail).slice(0, 240) || "Local pull status changed.", updatedAt: now() } : item);
    saveState();
  }

  function removeCart(tag) {
    const controller = ui.pullControllers.get(tag);
    if (controller) controller.abort();
    state.cart = state.cart.filter((item) => item.tag !== tag);
    saveState();
    record("cart-removed", `Removed ${tag} from the local pull cart.`);
    render();
  }

  async function streamPull(tag) {
    const controller = new AbortController();
    ui.pullControllers.set(tag, controller);
    updateCart(tag, "pulling", "Requesting the local Ollama pull stream.");
    render();
    try {
      const response = await localFetch("/api/pull", { method: "POST", body: { model: tag, stream: true }, controller, timeout: 0 });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The local pull stream had no readable body.");
      const decoder = new TextDecoder();
      let buffer = "";
      let seen = 0;
      let finalStatus = "Pull stream ended without a final status.";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        seen += value.byteLength;
        if (seen > STREAM_LIMIT_BYTES) throw new Error("The local pull stream exceeded the browser safety limit.");
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const update = JSON.parse(line);
          const status = typeof update?.status === "string" ? update.status.slice(0, 220) : "Local pull progress received.";
          finalStatus = status;
          updateCart(tag, "pulling", status);
          const progress = $("[data-pull-status='" + CSS.escape(tag) + "']");
          if (progress) progress.textContent = status;
        }
      }
      if (buffer.trim()) {
        const update = JSON.parse(buffer.trim());
        finalStatus = typeof update?.status === "string" ? update.status.slice(0, 220) : finalStatus;
      }
      const success = /success|pulling manifest|verifying|writing manifest/i.test(finalStatus);
      updateCart(tag, success ? "pulled" : "failed", finalStatus);
      record(success ? "pull-completed" : "pull-failed", `${tag}: ${finalStatus}`);
      toast(success ? "success" : "warning", success ? "Local pull completed" : "Local pull ended without success", `${tag}: ${finalStatus}`);
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      updateCart(tag, cancelled ? "cancelled" : "failed", cancelled ? "Cancelled by the user." : safeFailure(error));
      record(cancelled ? "pull-cancelled" : "pull-failed", `${tag}: ${cancelled ? "cancelled" : safeFailure(error)}`);
      toast(cancelled ? "info" : "warning", cancelled ? "Local pull cancelled" : "Local pull failed", `${tag}: ${cancelled ? "Cancelled before completion." : safeFailure(error)}`);
    } finally {
      ui.pullControllers.delete(tag);
      render();
    }
  }

  async function startPullQueue() {
    const candidates = state.cart.filter((item) => ["queued", "failed", "cancelled"].includes(item.status));
    if (!candidates.length) { toast("info", "No local pulls are waiting", "Add a catalog tag or retry a failed cart item first."); return; }
    const parallelism = Math.max(1, Math.min(3, Number(ui.parallelism) || 1));
    let index = 0;
    async function worker() {
      while (index < candidates.length) {
        const item = candidates[index];
        index += 1;
        await streamPull(item.tag);
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallelism, candidates.length) }, worker));
    await refreshRuntime();
  }

  function cancelAllPulls() {
    ui.pullControllers.forEach((controller) => controller.abort());
  }

  async function removeModel(tag) {
    try {
      await localFetch("/api/delete", { method: "DELETE", body: { model: tag } });
      record("model-deleted", `Requested local deletion for ${tag}.`);
      toast("success", "Local tag removed", `${tag} was removed through the loopback API.`);
      await refreshRuntime();
    } catch (error) {
      record("model-delete-failed", `${tag}: ${safeFailure(error)}`);
      toast("error", "Local tag was not removed", safeFailure(error));
      render();
    }
  }

  async function copyModel(tag) {
    const field = $(`[data-copy-destination="${CSS.escape(tag)}"]`);
    const destination = field?.value.trim();
    if (!contract.isSafeModelName(destination)) {
      toast("warning", "Choose a valid destination tag", "Use a bounded tag containing letters, numbers, dots, colons, slashes, underscores, or hyphens.");
      return;
    }
    try {
      await localFetch("/api/copy", { method: "POST", body: { source: tag, destination } });
      record("model-copied", `Requested local copy from ${tag} to ${destination}.`);
      toast("success", "Local tag copied", `${tag} was copied to ${destination}.`);
      await refreshRuntime();
    } catch (error) {
      record("model-copy-failed", `${tag}: ${safeFailure(error)}`);
      toast("error", "Local copy was not completed", safeFailure(error));
      render();
    }
  }

  async function importCatalog(file) {
    if (!file) return;
    if (file.size > contract.maxCatalogBytes) {
      toast("warning", "Catalog snapshot rejected", "The local JSON file exceeds the 2 MiB safety bound.");
      return;
    }
    try {
      const snapshot = contract.parseCatalogSnapshot(await file.text());
      state.catalog = snapshot;
      saveState();
      record("catalog-imported", `Imported a complete-marked local catalog snapshot with ${snapshot.models.length} tags and ${snapshot.pageCount} recorded pages.`);
      toast("success", "Catalog snapshot loaded", `${snapshot.models.length} tag(s) are available locally. Provenance is not authenticated by this static page.`);
    } catch (error) {
      record("catalog-import-failed", "Rejected malformed, incomplete, duplicate-key, or oversized local catalog snapshot.");
      toast("warning", "Catalog snapshot rejected", String(error.message || "The local JSON payload was invalid.").slice(0, 300));
    } finally {
      const picker = $("#ollama-catalog-file");
      if (picker) picker.value = "";
      render();
    }
  }

  function clearCatalog() {
    state.catalog = null;
    saveState();
    record("catalog-cleared", "Cleared the local catalog snapshot without contacting a network service.");
    toast("info", "Catalog snapshot cleared", "Installed tags and local chat records were left untouched.");
    render();
  }

  function createChat(model) {
    if (!contract.isSafeModelName(model)) return;
    if (state.chats.length >= contract.maxChats) {
      toast("warning", "Local chat limit reached", `Keep at most ${contract.maxChats} sessions; delete one through the confirmation surface before creating another.`);
      return;
    }
    const chat = {
      id: safeId("chat"),
      title: "New local session",
      model,
      systemPrompt: "",
      temperature: 0.7,
      contextLength: 4096,
      messages: [],
      updatedAt: now()
    };
    state.chats.push(chat);
    ui.selectedChatId = chat.id;
    ui.selectedModel = model;
    saveState();
    record("chat-created", `Created a local chat session for ${model}.`);
    render();
  }

  function activeChat() { return state.chats.find((chat) => chat.id === ui.selectedChatId) || null; }

  function updateActiveChat(changes) {
    const current = activeChat();
    if (!current) return null;
    const next = { ...current, ...changes, updatedAt: now() };
    state.chats = state.chats.map((chat) => chat.id === current.id ? next : chat);
    saveState();
    return next;
  }

  async function inspectCapabilities(model) {
    if (!contract.isSafeModelName(model)) return null;
    try {
      const response = await localFetch("/api/show", { method: "POST", body: { model }, timeout: RUNTIME_TIMEOUT_MS });
      const body = await limitedJson(response, JSON_LIMIT_BYTES);
      const capabilities = Array.isArray(body?.capabilities) && body.capabilities.length <= 20
        ? body.capabilities.filter((item) => typeof item === "string" && item.length <= 80)
        : [];
      ui.attachmentCapability[model] = capabilities;
      record("model-inspected", `Read bounded capability metadata for ${model}.`);
      render();
      return capabilities;
    } catch (error) {
      ui.attachmentCapability[model] = [];
      toast("warning", "Capabilities remain unknown", safeFailure(error));
      render();
      return null;
    }
  }

  function attachmentAllowed(chat) {
    return Boolean(chat && ui.attachmentCapability[chat.model]?.includes("vision"));
  }

  function readAttachment(file) {
    if (!file || !file.type.startsWith("image/") || file.size > MAX_ATTACHMENT_BYTES) {
      toast("warning", "Attachment was not accepted", "Choose one image up to 4 MiB only after the selected local model reports vision capability.");
      ui.attachment = null;
      render();
      return;
    }
    ui.attachment = file;
    toast("info", "Image kept in memory", "The image is not added to chat history, exports, or browser storage.");
    render();
  }

  function dataUrlBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The selected image could not be read."));
      reader.onload = () => {
        const result = String(reader.result || "");
        const separator = result.indexOf(",");
        resolve(separator >= 0 ? result.slice(separator + 1) : "");
      };
      reader.readAsDataURL(file);
    });
  }

  function renderChatTranscript(chat) {
    const transcript = $("#ollama-chat-transcript");
    if (!transcript || !chat) return;
    transcript.replaceChildren();
    if (!chat.messages.length) {
      transcript.append(create("p", "ollama-empty-state", "This local session has no messages yet."));
      return;
    }
    chat.messages.forEach((message) => {
      const item = create("article", `ollama-message ${message.role}`);
      item.append(create("strong", null, message.role), create("p", null, message.content));
      transcript.append(item);
    });
    transcript.scrollTop = transcript.scrollHeight;
  }

  async function sendChat() {
    const chat = activeChat();
    const input = $("#ollama-chat-input");
    if (!chat || !input) return;
    const prompt = contract.redactText(input.value).trim();
    if (!prompt) { toast("warning", "Enter a local message", "The message stays in this browser and is sent only to the selected loopback API."); return; }
    if (prompt.length > contract.maxMessageLength) { toast("warning", "Message is too long", `Keep one message within ${contract.maxMessageLength} characters.`); return; }
    if (chat.messages.length >= contract.maxMessagesPerChat - 1) { toast("warning", "Session message limit reached", "Create a new local session or export the redacted history before continuing."); return; }
    const temperature = Number($("#ollama-temperature")?.value ?? chat.temperature);
    const contextLength = Number($("#ollama-context-length")?.value ?? chat.contextLength);
    const systemPrompt = contract.redactText($("#ollama-system-prompt")?.value ?? chat.systemPrompt).slice(0, contract.maxMessageLength);
    const userMessage = { role: "user", content: prompt, createdAt: now() };
    const assistantMessage = { role: "assistant", content: "", createdAt: now() };
    const updated = updateActiveChat({ temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.7, contextLength: Number.isInteger(contextLength) ? Math.max(128, Math.min(131072, contextLength)) : 4096, systemPrompt, messages: [...chat.messages, userMessage, assistantMessage] });
    if (!updated) return;
    input.value = "";
    const controller = new AbortController();
    ui.inFlight.set(`chat:${updated.id}`, controller);
    render();
    try {
      const messages = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push(...updated.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: message.content })));
      const body = { model: updated.model, messages, stream: true, options: { temperature: updated.temperature, num_ctx: updated.contextLength } };
      if (ui.attachment && attachmentAllowed(updated)) body.messages[body.messages.length - 1].images = [await dataUrlBase64(ui.attachment)];
      ui.attachment = null;
      const response = await localFetch("/api/chat", { method: "POST", body, controller, timeout: 0 });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The local chat stream had no readable body.");
      let received = 0;
      let buffer = "";
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > STREAM_LIMIT_BYTES) throw new Error("The local chat stream exceeded the browser safety limit.");
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const part = JSON.parse(line);
          const content = typeof part?.message?.content === "string" ? contract.redactText(part.message.content).slice(0, contract.maxMessageLength) : "";
          if (content) {
            const current = activeChat();
            if (!current) continue;
            const latest = current.messages.at(-1);
            latest.content = `${latest.content}${content}`.slice(0, contract.maxMessageLength);
            current.updatedAt = now();
            renderChatTranscript(current);
          }
        }
      }
      saveState();
      record("chat-completed", `Completed a local streamed chat turn with ${updated.model}.`);
      toast("success", "Local response complete", "The streamed response remained in the local session only.");
    } catch (error) {
      const current = activeChat();
      if (current?.messages.at(-1)?.role === "assistant" && !current.messages.at(-1).content) current.messages.pop();
      saveState();
      const message = safeFailure(error);
      record(error?.name === "AbortError" ? "chat-cancelled" : "chat-failed", `${updated.model}: ${message}`);
      toast(error?.name === "AbortError" ? "info" : "error", error?.name === "AbortError" ? "Local response stopped" : "Local chat did not complete", message);
    } finally {
      ui.inFlight.delete(`chat:${updated.id}`);
      render();
    }
  }

  function stopChat() {
    const chat = activeChat();
    const controller = chat && ui.inFlight.get(`chat:${chat.id}`);
    if (controller) controller.abort();
  }

  function exportChat(chat) {
    if (!chat) return;
    downloadFile("material-download-manager-local-chat-redacted.json", {
      schemaVersion: 1,
      exportedAt: now(),
      note: "Local chat export. Conservative credential and path redaction was applied; attachments, endpoint metadata, environment values, and raw model payloads are omitted.",
      session: { title: chat.title, model: chat.model, temperature: chat.temperature, contextLength: chat.contextLength, messages: chat.messages.map((message) => ({ role: message.role, content: contract.redactText(message.content), createdAt: message.createdAt })) }
    });
    record("chat-exported", `Exported redacted local chat session for ${chat.model}.`);
    toast("success", "Redacted local chat exported", "Attachments, endpoint metadata, environment values, and raw payloads were omitted.");
  }

  function renameChat(chat) {
    const input = $(`[data-chat-title="${CSS.escape(chat.id)}"]`);
    const title = input?.value.trim().slice(0, 120);
    if (!title) { toast("warning", "Choose a session name", "A local session name cannot be empty."); return; }
    state.chats = state.chats.map((item) => item.id === chat.id ? { ...item, title: contract.redactText(title).slice(0, 120), updatedAt: now() } : item);
    saveState();
    record("chat-renamed", `Renamed a local session for ${chat.model}.`);
    render();
  }

  function deleteChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId);
    if (!chat) return;
    state.chats = state.chats.filter((item) => item.id !== chatId);
    if (ui.selectedChatId === chatId) ui.selectedChatId = state.chats[0]?.id || null;
    saveState();
    record("chat-deleted", `Deleted a local chat session for ${chat.model}.`);
    toast("success", "Local chat deleted", "The selected local session was removed after confirmation.");
    render();
  }

  function profileRecords() {
    return [...BUILTIN_PROFILES, ...state.profiles];
  }

  function addProfile(kind) {
    const label = $("#ollama-profile-label")?.value.trim();
    if (!label || label.length > 120 || !["health", "inventory", "chat-readiness", "model-inspect"].includes(kind)) {
      toast("warning", "Profile was not added", "Choose one allowlisted browser-only profile and a bounded local label.");
      return;
    }
    const profile = { id: safeId("profile"), label: contract.redactText(label).slice(0, 120), kind };
    if (ui.selectedModel) profile.model = ui.selectedModel;
    state.profiles.push(profile);
    saveState();
    record("profile-registered", `Registered allowlisted browser-only ${kind} profile.`);
    toast("success", "Browser-only profile registered", "It can call only documented local API routes and cannot launch a host process.");
    render();
  }

  async function runProfile(profile) {
    if (!profile || !["health", "inventory", "chat-readiness", "model-inspect"].includes(profile.kind)) return;
    const snapshot = { profileId: profile.id, selectedModel: ui.selectedModel, endpoint: state.endpoint, at: now() };
    ui.harnessSnapshot = snapshot;
    record("profile-preflight", `Saved browser-only preflight snapshot for ${profile.label}.`);
    try {
      if (profile.kind === "health") await refreshRuntime();
      if (profile.kind === "inventory") await refreshRuntime();
      if (profile.kind === "chat-readiness") {
        const model = profile.model || ui.selectedModel;
        if (!model) throw new Error("Select an installed local model before running chat readiness.");
        if (!installedModels().some((item) => item.name === model)) throw new Error("The selected tag is not currently installed according to the local API.");
        await inspectCapabilities(model);
        toast("success", "Local chat preflight completed", `${model} has a bounded local capability record. This does not launch an external process.`);
      }
      if (profile.kind === "model-inspect") {
        const model = profile.model || ui.selectedModel;
        if (!model) throw new Error("Select a model before capability inspection.");
        await inspectCapabilities(model);
      }
      record("profile-completed", `Completed browser-only profile ${profile.label}.`);
    } catch (error) {
      ui.selectedModel = snapshot.selectedModel;
      record("profile-failed", `${profile.label}: ${safeFailure(error)}`);
      toast("warning", "Browser-only preflight failed", `${safeFailure(error)} The local profile selection was restored.`);
      render();
    }
  }

  function restoreHarnessSnapshot() {
    if (!ui.harnessSnapshot) { toast("info", "No browser-only snapshot exists", "Run a profile first; host process launch is intentionally unavailable in this static page."); return; }
    state.endpoint = ui.harnessSnapshot.endpoint;
    ui.selectedModel = ui.harnessSnapshot.selectedModel;
    ui.selectedProfileId = ui.harnessSnapshot.profileId;
    saveState();
    record("profile-restored", "Restored the saved browser-only profile selection without mutating a host process.");
    toast("success", "Browser-only snapshot restored", "No host process, environment, or external application was launched or changed.");
    render();
  }

  function exportHistory(selectedOnly = false) {
    const records = state.history.filter((entry) => !selectedOnly || ui.historySelection.has(entry.id));
    downloadFile("material-download-manager-ollama-history.json", {
      schemaVersion: 1,
      exportedAt: now(),
      note: "Local operation history only. Chat content, attachments, raw model payloads, credentials, environment values, and local paths are omitted.",
      records
    });
    toast("success", "Local history exported", `${records.length} selected local record(s) were exported without chat content or secrets.`);
  }

  function deleteHistory(ids) {
    state.history = state.history.filter((entry) => !ids.includes(entry.id));
    ui.historySelection = new Set();
    saveState();
    toast("success", "Local history records deleted", `${ids.length} selected record(s) were removed after confirmation.`);
    render();
  }

  function openConfirmation(title, detail, execute) {
    ui.confirm = { title, detail, execute, acknowledged: false, reviewed: false, progress: 0 };
    render();
    window.setTimeout(() => $("#ollama-confirm-key-one")?.focus(), 0);
  }

  async function confirmAction() {
    const confirmation = ui.confirm;
    if (!confirmation || !confirmation.acknowledged || !confirmation.reviewed || confirmation.progress < 100) return;
    const action = confirmation.execute;
    ui.confirm = null;
    render();
    await action();
  }

  function currentTabName() { return TABS.find(([id]) => id === ui.activeTab)?.[1] || "Runtime"; }

  function render() {
    syncSchoolMode();
    if (root.hidden) return;
    root.replaceChildren();
    root.append(renderSuiteShell());
    if (ui.confirm) root.append(renderConfirmation());
    renderToastRegion();
  }

  function renderSuiteShell() {
    const shell = create("section", "ollama-suite-shell");
    shell.setAttribute("aria-labelledby", "ollama-suite-title");
    const heading = create("div", "ollama-suite-heading");
    const copy = create("div");
    copy.append(create("p", "eyebrow", "LOCAL OLLAMA SUITE"), create("h2", null, localize("Browser-local Ollama manager", "瀏覽器本機 Ollama 管理器")), create("p", "ollama-suite-lede", playful("A browser-only surface that calls documented loopback APIs when the browser allows it, and names the host capabilities it cannot mediate.", "呢個純瀏覽器表面只會喺瀏覽器容許時呼叫已記錄嘅 loopback API；做唔到嘅主機功能會老老實實列出。")));
    copy.querySelector("h2").id = "ollama-suite-title";
    heading.append(copy);
    const stateChip = create("span", `ollama-runtime-chip${state.runtime ? " ready" : ""}`, state.runtime ? localize("Cached local state", "已有本機快照") : localize("Local runtime unverified", "本機服務未驗證"));
    heading.append(stateChip);
    shell.append(heading);
    const boundary = create("p", "ollama-boundary-callout", localize("Boundary: this static page never contacts a cloud model, never accepts credentials, and never launches programs. It can only request the fixed local HTTP API on port 11434 when browser mixed-content and CORS rules permit it.", "邊界：呢個 static page 永遠唔會聯絡雲端模型、唔會收 credential、亦唔會開程序；只會喺瀏覽器 mixed-content 同 CORS 規則容許時，呼叫固定嘅 port 11434 本機 HTTP API。"));
    shell.append(boundary);
    const tabs = create("div", "ollama-tab-strip");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", localize("Ollama suite sections", "Ollama 管理器章節"));
    TABS.forEach(([id, english, cantonese]) => {
      const tab = button(localize(english, cantonese), "select-tab", `ollama-tab${ui.activeTab === id ? " is-active" : ""}`);
      tab.dataset.ollamaTab = id;
      tab.id = `ollama-tab-${id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(ui.activeTab === id));
      tab.setAttribute("aria-controls", `ollama-panel-${id}`);
      tab.tabIndex = ui.activeTab === id ? 0 : -1;
      tabs.append(tab);
    });
    shell.append(tabs);
    const panel = create("section", "ollama-tab-panel");
    panel.id = `ollama-panel-${ui.activeTab}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `ollama-tab-${ui.activeTab}`);
    panel.tabIndex = 0;
    const renderers = { runtime: renderRuntime, store: renderStore, cart: renderCart, chat: renderChat, harness: renderHarness, history: renderHistory, docs: renderDocs };
    panel.append(renderers[ui.activeTab]());
    shell.append(panel);
    const toasts = create("div", "ollama-toast-region");
    toasts.id = "ollama-toast-region";
    toasts.setAttribute("aria-live", "polite");
    shell.append(toasts);
    return shell;
  }

  function headingCard(eyebrow, title, description) {
    const element = create("div", "ollama-panel-heading");
    element.append(create("p", "eyebrow", eyebrow), create("h3", null, title), create("p", null, description));
    return element;
  }

  function renderRuntime() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("LOOPBACK RUNTIME", localize("Verify the local API", "驗證本機 API"), localize("The endpoint is fixed to a credential-free loopback origin. Refresh reads only version, installed tags, and running tags through documented API routes.", "endpoint 只可以係冇 credential 嘅 loopback origin。刷新只會經已記錄 API 讀取版本、已安裝 tag 同運行中 tag。")));
    const controls = create("div", "ollama-control-card");
    const endpointLabel = create("label", "ollama-field", localize("Loopback endpoint", "Loopback endpoint"));
    const endpointInput = create("input");
    endpointInput.id = "ollama-endpoint";
    endpointInput.value = state.endpoint;
    endpointInput.inputMode = "url";
    endpointInput.maxLength = 160;
    endpointInput.setAttribute("aria-describedby", "ollama-endpoint-help");
    endpointLabel.append(endpointInput);
    controls.append(endpointLabel);
    controls.append(button(ui.inFlight.has("runtime") ? localize("Refreshing local runtime…", "刷新本機服務中…") : localize("Refresh local runtime", "刷新本機服務"), "refresh-runtime", "button button-filled"));
    const help = create("p", "field-help", localize("Allowed: http://127.0.0.1:11434, http://localhost:11434, or http://[::1]:11434. No cloud host, path, query, fragment, or credential is accepted.", "只接受以上三種本機地址；唔接受雲端 host、path、query、fragment 或 credential。"));
    help.id = "ollama-endpoint-help";
    controls.append(help);
    section.append(controls);
    const status = create("article", "ollama-status-card");
    status.append(create("strong", null, state.runtime ? localize(`Local API v${state.runtime.version}`, `本機 API v${state.runtime.version}`) : localize("No successful runtime read yet", "仲未成功讀取本機服務")), create("p", null, runtimeFreshness()));
    if (state.runtime) status.append(create("p", "ollama-evidence", localize(`Evidence: ${state.runtime.installed.length} installed tag(s); ${state.runtime.running.length} running tag(s). Browser fit evidence is conservative and shown per model.`, `證據：${state.runtime.installed.length} 個已安裝 tag；${state.runtime.running.length} 個運行中 tag。每個模型都會顯示保守 fit 證據。`)));
    section.append(status);
    const installedCard = create("article", "ollama-list-card");
    installedCard.append(create("h4", null, localize("Installed local tags", "已安裝嘅本機 tag")));
    if (!installedModels().length) installedCard.append(create("p", "ollama-empty-state", localize("No installed tag is available in the last verified local API snapshot. Refresh the loopback runtime to discover one.", "最後驗證嘅本機 API 快照冇已安裝 tag；刷新 loopback runtime 先可以發現。")));
    else {
      installedModels().forEach((model) => installedCard.append(renderInstalledRow(model)));
    }
    section.append(installedCard);
    return section;
  }

  function renderInstalledRow(model) {
    const row = create("article", "ollama-model-row");
    const copy = create("div", "ollama-model-copy");
    copy.append(create("strong", null, model.name), create("span", null, `${formattedBytes(model.size)} · ${model.details?.family || "family unavailable"} · ${model.details?.quantization_level || "quantization unavailable"}`));
    if (runningModels().some((item) => item.name === model.name)) copy.append(create("span", "status-chip success", localize("Running", "運行中")));
    row.append(copy);
    const actions = create("div", "ollama-row-actions");
    const select = button(localize("Use in chat", "用嚟對話"), "select-model", "text-button");
    select.dataset.model = model.name;
    const inspect = button(localize("Inspect capabilities", "睇功能資料"), "inspect-model", "text-button");
    inspect.dataset.model = model.name;
    actions.append(select, inspect);
    row.append(actions);
    const copyControls = create("div", "ollama-copy-controls");
    const destination = create("input");
    destination.value = `${model.name}-copy`;
    destination.maxLength = 192;
    destination.setAttribute("aria-label", `Copy destination for ${model.name}`);
    destination.dataset.copyDestination = model.name;
    const copyButton = button(localize("Copy local tag", "複製本機 tag"), "copy-model", "text-button");
    copyButton.dataset.model = model.name;
    const deleteButton = button(localize("Remove local tag", "移除本機 tag"), "confirm-delete-model", "text-button danger-action");
    deleteButton.dataset.model = model.name;
    copyControls.append(destination, copyButton, deleteButton);
    row.append(copyControls);
    return row;
  }

  function renderStore() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("MODEL STORE", localize("A truthful local catalog surface", "誠實嘅本機目錄表面"), localize("A static page cannot authenticate or exhaustively refresh the official catalog. Import a complete-marked local snapshot when you have one; installed local tags are independently refreshed from the loopback API.", "static page 無法驗證或者完整刷新官方目錄；有完整標記嘅本機快照先可以匯入。已安裝 tag 會獨立由 loopback API 刷新。")));
    const controls = create("article", "ollama-control-card");
    const picker = create("input");
    picker.id = "ollama-catalog-file";
    picker.type = "file";
    picker.accept = "application/json,.json";
    picker.hidden = true;
    picker.dataset.ollamaCatalogPicker = "true";
    const importButton = button(localize("Import complete catalog snapshot", "匯入完整目錄快照"), "choose-catalog-file", "button button-filled");
    const clearButton = button(localize("Clear local catalog", "清除本機目錄"), "clear-catalog");
    controls.append(importButton, clearButton, picker, create("p", "field-help", catalogAge()));
    controls.append(create("p", "ollama-boundary-note", localize("This page does not fetch a remote catalog, invent sample models, or claim source provenance. A snapshot must declare its page count, source revision, complete flag, and bounded variant-level records; otherwise it stays unavailable.", "呢個頁面唔會抓遠端目錄、唔會發明 sample model、亦唔會聲稱來源可信。快照必須聲明頁數、source revision、complete flag 同有限制嘅 variant 記錄；唔係就保持 unavailable。")));
    section.append(controls);
    section.append(buildSearchControl("store", localize("Search local model store", "搜尋本機模型庫"), localize("Search tags, family, capability, quantization", "搜尋 tag、family、功能、quantization")));
    const filters = create("div", "ollama-filter-row");
    filters.append(create("span", "ollama-builder-label", localize("Show", "顯示")));
    [["all", "All"], ["installed", "Installed"], ["running", "Running"], ["catalog", "Catalog only"]].forEach(([value, label]) => {
      const filter = button(localize(label, ({ All: "全部", Installed: "已安裝", Running: "運行中", "Catalog only": "只睇目錄" }[label] || label)), "set-store-filter", `chip-button${ui.storeFilter === value ? " is-active" : ""}`);
      filter.dataset.storeFilter = value;
      filters.append(filter);
    });
    filters.append(create("span", "ollama-builder-label", localize("Fit", "Fit")));
    ["all", ...contract.fitVerdicts].forEach((value) => {
      const filter = button(value === "all" ? localize("All evidence", "全部證據") : value, "set-fit-filter", `chip-button${ui.fitFilter === value ? " is-active" : ""}`);
      filter.dataset.fitFilter = value;
      filters.append(filter);
    });
    section.append(filters);
    const list = create("div", "ollama-model-grid");
    const models = unifiedModels().filter((model) => {
      if (ui.storeFilter === "installed" && !model.installed) return false;
      if (ui.storeFilter === "running" && !model.running) return false;
      if (ui.storeFilter === "catalog" && (model.installed || !model.catalog)) return false;
      const fit = modelFit(model);
      if (ui.fitFilter !== "all" && fit.verdict !== ui.fitFilter) return false;
      return searchMatches("store", `${model.tag} ${model.family} ${model.description} ${model.parameterCount || ""} ${model.quantization || ""} ${(model.capabilities || []).join(" ")}`);
    });
    if (!models.length) list.append(create("p", "ollama-empty-state", state.catalog || state.runtime ? localize("No local model record matches this view. Filters do not invent missing variants or tags.", "冇本機模型紀錄符合呢個檢視；filters 唔會發明缺少嘅 variant 或 tag。") : localize("Model Store is empty until a loopback runtime is refreshed or a valid complete-marked local catalog snapshot is imported.", "loopback runtime 刷新或者匯入有效 complete-marked 本機目錄快照之前，模型庫係空。")));
    else models.forEach((model) => list.append(renderStoreModel(model)));
    section.append(list);
    return section;
  }

  function renderStoreModel(model) {
    const card = create("article", "ollama-store-model");
    const title = create("div", "card-heading-row");
    const heading = create("div");
    heading.append(create("h4", null, model.tag), create("p", null, `${model.family} · ${formattedBytes(model.sizeBytes)}${model.parameterCount ? ` · ${model.parameterCount}` : ""}${model.quantization ? ` · ${model.quantization}` : ""}`));
    title.append(heading);
    const stateLabel = model.running ? localize("Running", "運行中") : model.installed ? localize("Installed", "已安裝") : localize("Catalog snapshot", "目錄快照");
    title.append(create("span", `status-chip${model.running ? " success" : ""}`, stateLabel));
    card.append(title, create("p", "ollama-model-description", model.description));
    const capabilityText = model.capabilities?.length ? model.capabilities.join(", ") : localize("No verified capability metadata", "冇已驗證功能資料");
    card.append(create("p", "ollama-detail-line", `${localize("Capabilities", "功能")}: ${capabilityText}`));
    const fit = modelFit(model);
    const fitCard = create("div", `ollama-fit ${fit.verdict.toLowerCase().replaceAll(" ", "-")}`);
    fitCard.append(create("strong", null, fit.verdict), create("span", null, fit.evidence.join(" ")));
    const assumptions = create("small", null, fit.assumptions.join(" "));
    fitCard.append(assumptions);
    card.append(fitCard);
    const actions = create("div", "ollama-row-actions");
    if (!model.installed) {
      const add = button(localize("Add to batch pull", "加入批量下載"), "add-cart", "button button-tonal");
      add.dataset.model = model.tag;
      actions.append(add);
    } else {
      const use = button(localize("Use in local chat", "用喺本機對話"), "select-model", "button button-tonal");
      use.dataset.model = model.tag;
      actions.append(use);
    }
    card.append(actions);
    return card;
  }

  function renderCart() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("BATCH PULL", localize("A cart is a queue, never a checkout", "購物車係隊列，永遠唔係結帳"), localize("Every cart item is a local Ollama pull. The page shows exact tags, catalog blob estimates when available, durable per-item outcomes, bounded parallelism, retry, cancellation, and partial results.", "每個 cart item 都係本機 Ollama pull。頁面會顯示精確 tag、目錄 blob 估算、持久每項結果、有限並行、重試、取消同部份結果。")));
    section.append(buildSearchControl("cart", localize("Search local pull cart", "搜尋本機下載隊列"), localize("Search tags and pull outcomes", "搜尋 tag 同下載結果")));
    const totals = state.cart.reduce((sum, item) => sum + (unifiedModels().find((model) => model.tag === item.tag)?.sizeBytes || 0), 0);
    const controls = create("article", "ollama-control-card");
    const parallelLabel = create("label", "ollama-field", localize("Parallel local pulls", "本機並行下載"));
    const parallel = create("input");
    parallel.type = "number";
    parallel.min = "1";
    parallel.max = "3";
    parallel.value = String(ui.parallelism);
    parallel.id = "ollama-parallelism";
    parallelLabel.append(parallel);
    controls.append(parallelLabel, button(localize("Start queued pulls", "開始隊列下載"), "start-pulls", "button button-filled"), button(localize("Cancel active pulls", "取消進行中下載"), "cancel-pulls"));
    controls.append(create("p", "field-help", localize(`Batch estimate: ${formattedBytes(totals)} from catalog metadata when available. Local free disk is not exposed to this static page, so storage capacity is not claimed.`, `批量估算：目錄有資料時係 ${formattedBytes(totals)}。static page 攞唔到本機精確可用磁碟，所以唔會聲稱儲存空間足夠。`)));
    section.append(controls);
    const list = create("div", "ollama-cart-list");
    const visible = state.cart.filter((item) => searchMatches("cart", `${item.tag} ${item.status} ${item.detail}`));
    if (!visible.length) list.append(create("p", "ollama-empty-state", localize("The local pull cart is empty. Add a disclosed tag from the local model store; no prices, payment, account, or subscription exists here.", "本機下載隊列係空。由本機模型庫加入有披露嘅 tag；呢度冇價格、付款、帳戶或者訂閱。")));
    else visible.forEach((item) => list.append(renderCartItem(item)));
    section.append(list);
    return section;
  }

  function renderCartItem(item) {
    const row = create("article", "ollama-cart-item");
    const model = unifiedModels().find((candidate) => candidate.tag === item.tag);
    const heading = create("div", "card-heading-row");
    heading.append(create("strong", null, item.tag), create("span", `status-chip ${item.status}`, item.status));
    row.append(heading, create("p", null, model ? `${formattedBytes(model.sizeBytes)} · ${modelFit(model).verdict}` : localize("Size remains unknown because no verified local record exists.", "未有驗證本機紀錄，所以大小未知。")));
    const progress = create("p", "ollama-cart-progress", item.detail);
    progress.dataset.pullStatus = item.tag;
    row.append(progress, create("small", null, new Date(item.updatedAt).toLocaleString()));
    const actions = create("div", "ollama-row-actions");
    if (["failed", "cancelled"].includes(item.status)) {
      const retry = button(localize("Retry local pull", "重試本機下載"), "retry-pull", "text-button");
      retry.dataset.model = item.tag;
      actions.append(retry);
    }
    if (item.status === "pulling") {
      const cancel = button(localize("Cancel", "取消"), "cancel-pull", "text-button");
      cancel.dataset.model = item.tag;
      actions.append(cancel);
    }
    const remove = button(localize("Remove from cart", "由隊列移除"), "remove-cart", "text-button");
    remove.dataset.model = item.tag;
    actions.append(remove);
    row.append(actions);
    return row;
  }

  function renderChat() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("LOCAL CHAT", localize("Stream only to the selected local model", "只 stream 去選定嘅本機模型"), localize("Sessions, prompts, and redacted responses stay in this browser. Attachments remain disabled until the selected model's local /api/show response reports vision capability.", "sessions、prompt 同經過 redaction 嘅回應只留喺呢個瀏覽器。直到選定模型嘅本機 /api/show 回應話有 vision capability 前，附件會保持 disabled。")));
    const grid = create("div", "ollama-chat-layout");
    const sessions = create("aside", "ollama-chat-sessions");
    sessions.append(buildSearchControl("chats", localize("Search local sessions", "搜尋本機 session"), localize("Search session title or model", "搜尋 session 名稱或模型")));
    const installed = installedModels();
    const newHeading = create("h4", null, localize("Start a session", "開始 session"));
    sessions.append(newHeading);
    if (!installed.length) sessions.append(create("p", "ollama-empty-state", localize("Refresh the local runtime first. A chat model is never invented or selected from a cloud service.", "先刷新本機 runtime。對話模型永遠唔會由雲端服務發明或者選出。")));
    else {
      const picker = create("div", "ollama-model-picker");
      installed.filter((model) => searchMatches("chats", `${model.name} ${model.details?.family || ""}`)).forEach((model) => {
        const start = button(model.name, "new-chat", "chip-button");
        start.dataset.model = model.name;
        picker.append(start);
      });
      sessions.append(picker);
    }
    const list = create("div", "ollama-session-list");
    state.chats.filter((chat) => searchMatches("chats", `${chat.title} ${chat.model}`)).forEach((chat) => {
      const session = button(`${chat.title} · ${chat.model}`, "select-chat", `ollama-session${ui.selectedChatId === chat.id ? " is-active" : ""}`);
      session.dataset.chatId = chat.id;
      session.setAttribute("aria-pressed", String(ui.selectedChatId === chat.id));
      list.append(session);
    });
    sessions.append(list);
    grid.append(sessions);
    grid.append(renderActiveChat());
    section.append(grid);
    return section;
  }

  function renderActiveChat() {
    const chat = activeChat();
    const pane = create("section", "ollama-chat-pane");
    if (!chat) {
      pane.append(create("p", "ollama-empty-state", localize("Choose an installed local tag to create a session. No blank freeform model field is used because the local API is the source of truth.", "揀已安裝嘅本機 tag 先可以開 session。冇 blank freeform model 欄位，因為本機 API 係真相來源。")));
      return pane;
    }
    const heading = create("div", "card-heading-row");
    const titleInput = create("input");
    titleInput.value = chat.title;
    titleInput.maxLength = 120;
    titleInput.dataset.chatTitle = chat.id;
    titleInput.setAttribute("aria-label", localize("Local session name", "本機 session 名稱"));
    const title = create("div", "ollama-chat-title");
    title.append(titleInput, create("span", "status-chip", chat.model));
    heading.append(title);
    const actions = create("div", "ollama-row-actions");
    const rename = button(localize("Rename", "改名"), "rename-chat", "text-button");
    rename.dataset.chatId = chat.id;
    const inspect = button(localize("Inspect model", "檢查模型"), "inspect-model", "text-button");
    inspect.dataset.model = chat.model;
    const exportButton = button(localize("Export redacted", "匯出經過 redaction 嘅資料"), "export-chat", "text-button");
    exportButton.dataset.chatId = chat.id;
    const deletion = button(localize("Delete session", "刪除 session"), "confirm-delete-chat", "text-button danger-action");
    deletion.dataset.chatId = chat.id;
    actions.append(rename, inspect, exportButton, deletion);
    heading.append(actions);
    pane.append(heading);
    const controls = create("div", "ollama-chat-options");
    const system = create("label", "ollama-field", localize("System prompt", "System prompt"));
    const systemInput = create("textarea");
    systemInput.id = "ollama-system-prompt";
    systemInput.maxLength = contract.maxMessageLength;
    systemInput.value = chat.systemPrompt;
    system.append(systemInput);
    const temperature = create("label", "ollama-field", localize("Temperature", "Temperature"));
    const temperatureInput = create("input");
    temperatureInput.id = "ollama-temperature";
    temperatureInput.type = "number";
    temperatureInput.min = "0";
    temperatureInput.max = "2";
    temperatureInput.step = "0.1";
    temperatureInput.value = String(chat.temperature);
    temperature.append(temperatureInput);
    const context = create("label", "ollama-field", localize("Context window", "Context window"));
    const contextInput = create("input");
    contextInput.id = "ollama-context-length";
    contextInput.type = "number";
    contextInput.min = "128";
    contextInput.max = "131072";
    contextInput.step = "128";
    contextInput.value = String(chat.contextLength);
    context.append(contextInput);
    controls.append(system, temperature, context);
    pane.append(controls);
    const capability = ui.attachmentCapability[chat.model] || [];
    const attachment = create("div", "ollama-attachment-row");
    const attachmentLabel = create("label", "ollama-field", localize("Image attachment", "圖像附件"));
    const attachmentInput = create("input");
    attachmentInput.type = "file";
    attachmentInput.accept = "image/*";
    attachmentInput.disabled = !attachmentAllowed(chat);
    attachmentInput.dataset.ollamaAttachment = "true";
    attachmentInput.setAttribute("aria-describedby", "ollama-attachment-help");
    attachmentLabel.append(attachmentInput);
    attachment.append(attachmentLabel);
    const attachmentHelp = create("p", "field-help", attachmentAllowed(chat)
      ? localize("Vision is reported by the selected model. One image up to 4 MiB is held in memory only for the next local request.", "選定模型已回報 vision。最多一張 4 MiB 圖像只會放記憶體，供下一個本機 request 使用。")
      : localize(`Attachments remain disabled: ${capability.length ? "the verified local capability list lacks vision" : "inspect /api/show for this local tag first"}.`, `附件保持 disabled：${capability.length ? "已驗證本機 capability list 冇 vision" : "先為呢個本機 tag 檢查 /api/show"}。`));
    attachmentHelp.id = "ollama-attachment-help";
    attachment.append(attachmentHelp);
    if (ui.attachment) attachment.append(create("span", "status-chip", localize("One image ready in memory", "一張圖已喺記憶體準備好")));
    pane.append(attachment);
    const transcript = create("div", "ollama-chat-transcript");
    transcript.id = "ollama-chat-transcript";
    pane.append(transcript);
    const composer = create("div", "ollama-composer");
    const message = create("textarea");
    message.id = "ollama-chat-input";
    message.maxLength = contract.maxMessageLength;
    message.placeholder = localize("Write a local message", "輸入本機訊息");
    message.setAttribute("aria-label", localize("Local chat message", "本機對話訊息"));
    const send = button(localize("Send to local model", "送去本機模型"), "send-chat", "button button-filled");
    const stop = button(localize("Stop response", "停止回應"), "stop-chat");
    stop.disabled = !ui.inFlight.has(`chat:${chat.id}`);
    composer.append(message, send, stop);
    pane.append(composer);
    window.setTimeout(() => renderChatTranscript(chat), 0);
    return pane;
  }

  function renderHarness() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("ALLOWLISTED BROWSER HARNESS", localize("Preflight without shell execution", "唔駛 shell execution 嘅 preflight"), localize("These profiles can call only fixed documented local API routes. A static Pages site cannot start Ollama, launch an external program, enumerate executables, read environment values, or manage a host credential vault.", "呢啲 profile 只可以呼叫固定已記錄嘅本機 API route。static Pages site 做唔到開 Ollama、開外部程序、列 executable、讀環境值或者管理主機 credential vault。")));
    section.append(buildSearchControl("profiles", localize("Search browser-only profiles", "搜尋純瀏覽器 profile"), localize("Search allowed profile names", "搜尋容許嘅 profile 名稱")));
    const list = create("div", "ollama-profile-list");
    profileRecords().filter((profile) => searchMatches("profiles", `${profile.label} ${profile.kind} ${profile.model || ""}`)).forEach((profile) => {
      const card = create("article", "ollama-profile-card");
      card.append(create("strong", null, profile.label), create("span", "status-chip", profile.kind), create("p", null, profile.model ? `${localize("Model", "模型")}: ${profile.model}` : localize("No model is fixed; the selected installed tag is used when the profile needs one.", "冇固定模型；profile 需要時會用已選嘅本機 tag。")));
      const actions = create("div", "ollama-row-actions");
      const run = button(localize("Run preflight", "執行 preflight"), "run-profile", "button button-tonal");
      run.dataset.profileId = profile.id;
      actions.append(run);
      card.append(actions);
      list.append(card);
    });
    section.append(list);
    const register = create("article", "ollama-control-card");
    register.append(create("h4", null, localize("Register a browser-only profile", "登記純瀏覽器 profile")), create("p", null, localize("A registered profile is an allowlisted local API plan, not a shell command. It never accepts a command line, environment expansion, executable path, or working directory.", "登記嘅 profile 係 allowlisted 本機 API 計劃，唔係 shell command。佢永遠唔接受 command line、環境展開、executable path 或 working directory。")));
    const label = create("label", "ollama-field", localize("Profile label", "Profile 名稱"));
    const labelInput = create("input");
    labelInput.id = "ollama-profile-label";
    labelInput.maxLength = 120;
    label.append(labelInput);
    register.append(label);
    const kinds = create("div", "ollama-row-actions");
    [["health", "Runtime health"], ["inventory", "Inventory refresh"], ["chat-readiness", "Chat readiness"], ["model-inspect", "Model inspection"]].forEach(([kind, labelText]) => {
      const add = button(localize(labelText, labelText), "add-profile", "chip-button");
      add.dataset.profileKind = kind;
      kinds.append(add);
    });
    register.append(kinds, button(localize("Restore local preflight snapshot", "還原本機 preflight 快照"), "restore-harness"));
    section.append(register);
    return section;
  }

  function renderHistory() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("LOCAL OPERATION HISTORY", localize("Review local-only outcomes", "檢視只喺本機嘅結果"), localize("This bounded record contains operation names and redacted details, not credentials, chat content, raw payloads, attachments, environment values, or local file paths.", "呢個有限記錄只會有操作名同經過 redaction 嘅詳情；唔會有 credential、對話內容、原始 payload、附件、環境值或者本機檔案路徑。")));
    section.append(buildSearchControl("history", localize("Search local operation history", "搜尋本機操作記錄"), localize("Search action and safe detail", "搜尋操作同安全詳情")));
    const actions = create("div", "ollama-history-actions");
    actions.append(button(localize("Select visible", "選擇目前顯示"), "history-select-visible"), button(localize("Invert selection", "反轉選擇"), "history-invert"), button(localize("Export selected", "匯出已選取"), "history-export", "button button-tonal"), button(localize("Delete selected", "刪除已選取"), "confirm-delete-history", "button danger-action"));
    section.append(actions);
    const list = create("div", "ollama-history-list");
    const records = state.history.filter((entry) => searchMatches("history", `${entry.action} ${entry.detail} ${entry.createdAt}`)).reverse();
    if (!records.length) list.append(create("p", "ollama-empty-state", localize("No local history record matches this view.", "冇本機記錄符合呢個檢視。")));
    else records.forEach((entry) => {
      const row = create("article", "ollama-history-row");
      const selected = create("label", "ollama-check");
      const checkbox = create("input");
      checkbox.type = "checkbox";
      checkbox.checked = ui.historySelection.has(entry.id);
      checkbox.dataset.historyId = entry.id;
      checkbox.setAttribute("aria-label", `Select history record ${entry.action}`);
      selected.append(checkbox);
      const copy = create("div");
      copy.append(create("strong", null, entry.action), create("p", null, entry.detail), create("small", null, new Date(entry.createdAt).toLocaleString()));
      row.append(selected, copy);
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function renderDocs() {
    const section = create("div", "ollama-panel-stack");
    section.append(headingCard("BROWSER-ONLY OLLAMA DOCUMENTATION", localize("What this site can prove", "呢個網站可以證明乜"), localize("The module is an independent static-site implementation. It does not delegate local runtime, installed-tag browsing, pull, chat, capability inspection, or browser-only preflight to the desktop app.", "呢個模組係獨立 static-site 實作。佢唔會將本機 runtime、已安裝 tag 瀏覽、pull、對話、capability inspection 或純瀏覽器 preflight 委派去桌面程式。")));
    const cards = create("div", "ollama-doc-grid");
    const sections = [
      ["Local mediation", "The only accepted endpoint is a fixed credential-free loopback API on port 11434. The browser uses no proxy, cloud model, token, remote catalog request, or arbitrary URL. HTTPS-hosted Pages can be blocked from HTTP loopback by mixed-content or CORS rules; that state stays visible instead of falling back."],
      ["Catalog boundary", "The local /api/tags response is exhaustive for installed tags at a successful refresh. A static page cannot authenticate an exhaustive official catalog, so the Model Store accepts only a bounded complete-marked local snapshot and labels its provenance as unauthenticated. It never invents a model or hides the unavailable catalog."],
      ["Hardware fit", "The suite combines a verified blob size with local /api/ps evidence, browser storage estimates, and the browser's coarse device-memory signal when available. It never reads an exact GPU model, free VRAM, driver, or free disk from the host. Missing evidence yields Unknown; observed loading or conservative bounds may yield Runs well, Runs with limits, or Unlikely."],
      ["Pull, chat, and recovery", "The cart runs bounded concurrent local /api/pull streams with durable state, retry, cancellation, and partial outcomes. Chat streams /api/chat to an installed model, keeps a bounded local session history, and disables attachments until /api/show reports vision. Browser-only profiles call only allowlisted local routes and never launch a program; failed preflights restore their local selection."],
      ["Privacy and export", "All module state is local browser storage. It accepts no credentials and does not retain source paths or attachment bytes. Export omits attachments, endpoint metadata, raw payloads, environment values, and applies conservative credential/path redaction to history and chat text."],
      ["Verification", "The dedicated contract test deliberately breaks loopback allowlisting, catalog completeness, duplicate-key rejection, arbitrary launcher prevention, attachment capability gating, and inventory anchors. The site build copies the module as a local runtime asset. A real built-site capture is attempted only through the sanctioned hidden route and is never claimed from a static mock."],
    ];
    sections.forEach(([title, description]) => {
      const card = create("article", "ollama-doc-card");
      card.append(create("h4", null, localize(title, title)), create("p", null, description));
      cards.append(card);
    });
    section.append(cards);
    return section;
  }

  function renderConfirmation() {
    const confirmation = ui.confirm;
    const overlay = create("section", "ollama-confirm-layer");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ollama-confirm-title");
    const card = create("div", "ollama-confirm-card");
    card.append(create("p", "eyebrow", "DESTRUCTIVE LOCAL ACTION"), create("h3", null, confirmation.title), create("p", null, confirmation.detail));
    const keyOne = create("label", "switch-row");
    const keyOneInput = create("input");
    keyOneInput.id = "ollama-confirm-key-one";
    keyOneInput.type = "checkbox";
    keyOneInput.checked = confirmation.acknowledged;
    keyOneInput.dataset.confirmKey = "one";
    keyOne.append(keyOneInput, create("span", null, localize("I reviewed the exact affected local data.", "我已核對確實受影響嘅本機資料。")));
    const keyTwo = create("label", "switch-row");
    const keyTwoInput = create("input");
    keyTwoInput.type = "checkbox";
    keyTwoInput.checked = confirmation.reviewed;
    keyTwoInput.dataset.confirmKey = "two";
    keyTwo.append(keyTwoInput, create("span", null, localize("I understand this cannot be undone by this page.", "我明白呢個頁面無法撤銷。")));
    const slider = create("label", "ollama-confirm-slider", localize("Slide to authorize", "拉動以授權"));
    const sliderInput = create("input");
    sliderInput.type = "range";
    sliderInput.min = "0";
    sliderInput.max = "100";
    sliderInput.step = "1";
    sliderInput.value = String(confirmation.progress);
    sliderInput.disabled = !confirmation.acknowledged || !confirmation.reviewed;
    sliderInput.dataset.confirmProgress = "true";
    slider.append(sliderInput, create("output", null, `${confirmation.progress}%`));
    const actions = create("div", "ollama-confirm-actions");
    const exit = button(localize("Emergency exit", "緊急離開"), "close-confirmation");
    const confirm = button(localize("Complete local action", "完成本機操作"), "complete-confirmation", "button button-filled");
    confirm.disabled = !confirmation.acknowledged || !confirmation.reviewed || confirmation.progress < 100;
    actions.append(exit, confirm);
    card.append(keyOne, keyTwo, slider, actions);
    overlay.append(card);
    return overlay;
  }

  function selectTab(tab) {
    if (!TABS.some(([id]) => id === tab)) return;
    ui.activeTab = tab;
    render();
    window.setTimeout(() => $(`#ollama-panel-${tab}`)?.focus(), 0);
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-ollama-action]");
    if (!target) return;
    const action = target.dataset.ollamaAction;
    const model = target.dataset.model;
    if (action === "select-tab") selectTab(target.dataset.ollamaTab);
    if (action === "refresh-runtime") void refreshRuntime();
    if (action === "choose-catalog-file") $("#ollama-catalog-file")?.click();
    if (action === "clear-catalog") clearCatalog();
    if (action === "toggle-builder") { const search = ui.search[target.dataset.builderId]; search.open = !search.open; render(); }
    if (action === "set-builder-mode") { const search = ui.search[target.dataset.builderId]; search.mode = target.dataset.builderMode; search.open = true; render(); }
    if (action === "builder-token") { const search = ui.search[target.dataset.builderId]; search.pattern = `${search.pattern}${tokenText(target.dataset.builderToken)}`.slice(0, 256); search.mode = "regex"; search.open = true; render(); }
    if (action === "copy-builder") void copyText(ui.search[target.dataset.builderId].pattern);
    if (action === "export-builder") downloadFile("material-download-manager-regex.json", { engine: "JavaScript RegExp", ...ui.search[target.dataset.builderId] });
    if (action === "set-store-filter") { ui.storeFilter = target.dataset.storeFilter; render(); }
    if (action === "set-fit-filter") { ui.fitFilter = target.dataset.fitFilter; render(); }
    if (action === "add-cart") addToCart(model);
    if (action === "remove-cart") removeCart(model);
    if (action === "retry-pull") { updateCart(model, "queued", "Queued for retry."); render(); }
    if (action === "start-pulls") { const value = Number($("#ollama-parallelism")?.value); ui.parallelism = Math.max(1, Math.min(3, Number.isInteger(value) ? value : 1)); void startPullQueue(); }
    if (action === "cancel-pulls") cancelAllPulls();
    if (action === "cancel-pull") ui.pullControllers.get(model)?.abort();
    if (action === "select-model") { ui.selectedModel = model; const existing = state.chats.find((chat) => chat.model === model); if (existing) ui.selectedChatId = existing.id; ui.activeTab = "chat"; render(); }
    if (action === "inspect-model") void inspectCapabilities(model);
    if (action === "copy-model") void copyModel(model);
    if (action === "confirm-delete-model") openConfirmation(localize("Remove local model tag?", "移除本機模型 tag？"), localize(`This calls DELETE /api/delete for ${model} on the selected loopback API. It affects local Ollama data and cannot be undone by this page.`, `呢個會喺選定 loopback API 為 ${model} 呼叫 DELETE /api/delete。會影響本機 Ollama 資料，呢個頁面無法撤銷。`), () => removeModel(model));
    if (action === "new-chat") createChat(model);
    if (action === "select-chat") { ui.selectedChatId = target.dataset.chatId; const chat = activeChat(); ui.selectedModel = chat?.model || ui.selectedModel; render(); }
    if (action === "rename-chat") { const chat = state.chats.find((item) => item.id === target.dataset.chatId); if (chat) renameChat(chat); }
    if (action === "export-chat") { const chat = state.chats.find((item) => item.id === target.dataset.chatId); exportChat(chat); }
    if (action === "confirm-delete-chat") { const chat = state.chats.find((item) => item.id === target.dataset.chatId); if (chat) openConfirmation(localize("Delete local chat session?", "刪除本機對話 session？"), localize(`This removes the local browser session “${chat.title}” and its stored redacted messages.`, `呢個會移除本機瀏覽器 session「${chat.title}」同已儲存嘅 redacted 訊息。`), () => deleteChat(chat.id)); }
    if (action === "send-chat") void sendChat();
    if (action === "stop-chat") stopChat();
    if (action === "run-profile") void runProfile(profileRecords().find((profile) => profile.id === target.dataset.profileId));
    if (action === "add-profile") addProfile(target.dataset.profileKind);
    if (action === "restore-harness") restoreHarnessSnapshot();
    if (action === "history-select-visible") { state.history.filter((entry) => searchMatches("history", `${entry.action} ${entry.detail} ${entry.createdAt}`)).forEach((entry) => ui.historySelection.add(entry.id)); render(); }
    if (action === "history-invert") { state.history.filter((entry) => searchMatches("history", `${entry.action} ${entry.detail} ${entry.createdAt}`)).forEach((entry) => ui.historySelection.has(entry.id) ? ui.historySelection.delete(entry.id) : ui.historySelection.add(entry.id)); render(); }
    if (action === "history-export") exportHistory(true);
    if (action === "confirm-delete-history") { const ids = [...ui.historySelection]; if (!ids.length) toast("info", "Choose history records first", "Select one or more visible local records before deleting them."); else openConfirmation(localize("Delete selected local history?", "刪除已選取嘅本機記錄？"), localize(`${ids.length} selected local record(s) will be removed. Chat content and credentials are not present in this history.`, `會移除 ${ids.length} 個已選取本機記錄。呢個 history 冇對話內容同 credential。`), () => deleteHistory(ids)); }
    if (action === "dismiss-toast") { ui.toasts = ui.toasts.filter((item) => item.id !== target.dataset.toastId); renderToastRegion(); }
    if (action === "close-confirmation") { ui.confirm = null; render(); }
    if (action === "complete-confirmation") void confirmAction();
  });

  root.addEventListener("input", (event) => {
    const search = event.target.dataset.ollamaSearchInput;
    if (search) { ui.search[search].query = event.target.value.slice(0, 256); render(); return; }
    const builder = event.target.dataset.builderId;
    if (builder && event.target.dataset.builderField) { ui.search[builder][event.target.dataset.builderField] = event.target.value; ui.search[builder].mode = "regex"; ui.search[builder].open = true; render(); return; }
    if (event.target.id === "ollama-endpoint") {
      state.endpoint = event.target.value.trim().slice(0, 160);
      if (contract.isAllowedEndpoint(state.endpoint)) saveState();
      return;
    }
    if (event.target.dataset.confirmProgress) { ui.confirm.progress = Number(event.target.value); $(".ollama-confirm-slider output")?.replaceChildren(String(ui.confirm.progress) + "%"); const complete = $("[data-ollama-action='complete-confirmation']"); if (complete) complete.disabled = ui.confirm.progress < 100 || !ui.confirm.acknowledged || !ui.confirm.reviewed; }
  });

  root.addEventListener("change", (event) => {
    if (event.target.dataset.ollamaCatalogPicker) { void importCatalog(event.target.files?.[0]); return; }
    if (event.target.dataset.ollamaAttachment) { readAttachment(event.target.files?.[0]); return; }
    if (event.target.dataset.historyId) { event.target.checked ? ui.historySelection.add(event.target.dataset.historyId) : ui.historySelection.delete(event.target.dataset.historyId); return; }
    if (event.target.dataset.confirmKey === "one") { ui.confirm.acknowledged = event.target.checked; render(); return; }
    if (event.target.dataset.confirmKey === "two") { ui.confirm.reviewed = event.target.checked; render(); }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.confirm) { event.preventDefault(); ui.confirm = null; render(); }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && document.activeElement?.id === "ollama-chat-input") { event.preventDefault(); void sendChat(); }
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && event.target.matches(".ollama-tab")) {
      event.preventDefault();
      const index = TABS.findIndex(([id]) => id === ui.activeTab);
      const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
      ui.activeTab = TABS[next][0];
      render();
      window.setTimeout(() => $(`#ollama-tab-${ui.activeTab}`)?.focus(), 0);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STATE_KEY) { state = readState(); render(); }
    if (event.key === SITE_SETTINGS_KEY) { syncSchoolMode(); render(); }
  });

  window.addEventListener("mdm-site-user-text-change", () => render());

  window.setInterval(() => {
    if (syncSchoolMode()) render();
  }, 750);

  void collectBrowserEvidence().then(render);
  syncSchoolMode();
  render();
})();
