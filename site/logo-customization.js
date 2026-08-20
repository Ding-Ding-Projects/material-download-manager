(function (global) {
  "use strict";

  const contract = global.MDM_SITE_LOGO_CONTRACT;
  if (!contract) throw new Error("Logo customization contract must load before the logo controller.");

  const COPY = Object.freeze({
    customPreview: ["Custom logo preview", "自訂標誌預覽"],
    presetPreview: ["Shipped logo preset", "內置標誌預設"],
    presetSelected: ["Selected", "已選取"],
    scheduleActive: ["The local schedule is active; a shipped preset is temporarily shown.", "本機時間表生效中；暫時顯示內置預設標誌。"],
    scheduleInactive: ["The local schedule is saved and will apply at its next matching time.", "本機時間表已儲存，下一個符合時間會自動套用。"],
    conversionPreset: ["Shipped text-and-CSS mark; no image conversion is needed.", "內置文字同 CSS 標誌；毋須轉換圖片。"],
    conversionCustom: ["Validated locally. The same private browser-local image is rendered at 24, 40, and 64 px; no network request or remote converter is used.", "已喺本機驗證。相同私有瀏覽器本機圖片會以 24、40 同 64 px 顯示；毋須網絡或遙距轉換器。"],
    customAccepted: ["Custom image accepted locally.", "自訂圖片已喺本機接受。"],
    customCleared: ["Custom image cleared. The shipped preset is active again.", "自訂圖片已清除，內置預設標誌再次生效。"],
    reset: ["Logo settings reset to the shipped transfer mark.", "標誌設定已重設為內置傳輸標誌。"],
    exportReady: ["A safe logo configuration export is ready. Image bytes, data URIs, paths, and filenames were omitted.", "安全標誌設定匯出已準備好；已略去圖片位元組、資料 URI、路徑同檔名。"],
    storageUnavailable: ["This browser could not save the logo. The last saved logo remains unchanged after a reload.", "呢個瀏覽器未能儲存標誌；重新載入後仍會保留上次已儲存嘅標誌。"],
    localOnly: ["Local-only: image bytes never leave this browser.", "只限本機：圖片位元組永遠唔會離開呢個瀏覽器。"],
    fillWarning: ["Fill stretches the mark to the target shape. It can distort proportions before you make it active.", "Fill 會將標誌拉伸到目標形狀；啟用前請留意比例可能變形。"],
    cropWarning: ["Crop zoom can hide pixels outside the safe area. The source image stays unchanged.", "裁剪縮放會隱藏安全範圍以外嘅像素；來源圖片保持不變。"],
    transparent: ["Transparent background", "透明背景"],
    colorBackground: ["Selected background color", "已選背景顏色"],
    alphaPreserved: ["Alpha is preserved in the rendered previews.", "顯示預覽會保留透明度。"],
    jpegOpaque: ["This verified JPEG has no alpha channel.", "呢個已驗證 JPEG 冇透明度通道。"],
    shippedDefault: ["Shipped default", "內置預設"],
    shippedPreset: ["Shipped preset", "內置標誌"],
    presetActive: ["is active locally.", "已喺本機啟用。"],
    appearanceUpdated: ["Logo appearance updated locally.", "標誌外觀已喺本機更新。"],
    scheduleOff: ["Schedule is off; the selected logo stays active.", "時間表已關閉；所選標誌會保持生效。"],
    scheduleDisabled: ["Logo schedule turned off.", "標誌時間表已關閉。"],
    scheduleUpdated: ["Local logo schedule updated.", "本機標誌時間表已更新。"],
    scheduleStartUpdated: ["Logo schedule start updated.", "標誌時間表開始時間已更新。"],
    scheduleEndUpdated: ["Logo schedule end updated.", "標誌時間表結束時間已更新。"],
    customAlreadyClear: ["A shipped preset is already active.", "內置預設標誌已經生效。"],
    customRetainFailure: ["The custom image could not be retained after local validation.", "本機驗證後未能保留自訂圖片。"],
    customReadFailure: ["The image could not be read locally. The prior valid logo remains active.", "未能喺本機讀取圖片；之前有效嘅標誌會保持生效。"],
    logoUpdatedTitle: ["Logo updated", "標誌已更新"],
    logoUpdatedMessage: ["The custom image was validated locally and applied to every logo preview.", "自訂圖片已喺本機驗證，並套用到每個標誌預覽。"],
    customValidationPending: ["Saved custom image is being revalidated locally. The shipped fallback stays visible until the isolated decoder confirms it.", "已儲存嘅自訂圖片正喺本機重新驗證。隔離解碼器確認之前會顯示內置後備標誌。"],
    customValidationRejected: ["The saved custom image did not pass local revalidation. The shipped fallback is active and the invalid cached image was cleared.", "已儲存嘅自訂圖片未能通過本機重新驗證。內置後備標誌已生效，而且已清除無效快取圖片。"],
    logoEyebrow: ["APP LOGO", "應用程式標誌"],
    logoTitle: ["Make the mark yours, locally.", "喺本機整到個標誌啱你。"],
    logoDescription: ["Choose a shipped mark or validate one local PNG or JPEG. This changes presentation only; project and release identity stay fixed.", "揀內置標誌，或者驗證一張本機 PNG 或 JPEG。只會改顯示外觀；專案同版本身分保持固定。"],
    presetTitle: ["Shipped presets", "內置預設標誌"],
    presetDescription: ["Every preset is bundled text and CSS, not a network image.", "每個預設都係隨網站附帶嘅文字同 CSS，唔係網絡圖片。"],
    uploadTitle: ["Local custom image", "本機自訂圖片"],
    uploadDescription: ["PNG and JPEG only. Actual bytes, dimensions, animation state, and browser decode are checked before replacement.", "只限 PNG 同 JPEG。更換前會檢查真正位元組、尺寸、動畫狀態同瀏覽器解碼。"],
    chooseImage: ["Choose local image", "揀本機圖片"],
    clearCustom: ["Clear custom image", "清除自訂圖片"],
    resetLogo: ["Reset logo", "重設標誌"],
    previewTitle: ["Live safe-area previews", "即時安全範圍預覽"],
    previewDescription: ["Only the real display targets are previewed. The dashed line is the safe area.", "只預覽真正顯示目標；虛線代表安全範圍。"],
    compactTarget: ["Compact · 24 px", "精簡 · 24 px"],
    navigationTarget: ["Navigation · 40 px", "導覽 · 40 px"],
    featureTarget: ["Feature preview · 64 px", "功能預覽 · 64 px"],
    transformTitle: ["Crop and background", "裁剪同背景"],
    fitLabel: ["Fit mode", "填滿模式"],
    fitContain: ["Contain", "完整放入"],
    fitCover: ["Cover / crop", "鋪滿／裁剪"],
    fitFill: ["Fill / stretch", "填滿／拉伸"],
    focalX: ["Focal X", "焦點 X"],
    focalY: ["Focal Y", "焦點 Y"],
    cropZoom: ["Crop zoom", "裁剪縮放"],
    backgroundTitle: ["Background treatment", "背景處理"],
    backgroundTransparent: ["Transparent", "透明"],
    backgroundColor: ["Color", "顏色"],
    backgroundPicker: ["Continuous background color", "連續背景顏色"],
    backgroundHex: ["Background HEX", "背景 HEX"],
    scheduleTitle: ["Local logo schedule", "本機標誌時間表"],
    scheduleDescription: ["Temporarily show a shipped preset during a local-time window. Equal times mean all day; overnight windows work.", "喺本機時間範圍內暫時顯示內置預設。相同時間代表全日；跨夜時間範圍一樣可用。"],
    scheduleEnabled: ["Use a local logo schedule", "使用本機標誌時間表"],
    scheduleStart: ["Start time", "開始時間"],
    scheduleEnd: ["End time", "結束時間"],
    schedulePreset: ["Preset during the window", "時間範圍內嘅預設標誌"],
    safeExport: ["Export safe configuration", "匯出安全設定"],
    safeExportDescription: ["Exports visual choices only. Custom bytes, data URI, path, and filename are omitted.", "只匯出外觀選擇；會略去自訂位元組、資料 URI、路徑同檔名。"]
  });

  const FAILURES = Object.freeze({
    "empty-image": ["The selected file was empty.", "所選檔案係空白。"],
    "missing-custom-data": ["The saved custom image is missing.", "已儲存嘅自訂圖片遺失咗。"],
    "image-bytes-exceed-limit": [`The selected image is larger than ${Math.floor(contract.MAX_INPUT_BYTES / 1024)} KiB.`, `所選圖片大過 ${Math.floor(contract.MAX_INPUT_BYTES / 1024)} KiB。`],
    "invalid-png-signature": ["The selected file does not contain a valid PNG signature.", "所選檔案冇有效 PNG 簽名。"],
    "invalid-jpeg-signature": ["The selected file does not contain a valid JPEG signature.", "所選檔案冇有效 JPEG 簽名。"],
    "unsupported-image-format": ["Only verified PNG and JPEG images are supported here.", "呢度只支援已驗證 PNG 同 JPEG 圖片。"],
    "animated-png-not-supported": ["Animated PNG files are not supported.", "唔支援動畫 PNG 檔案。"],
    "png-dimensions-exceed-limit": ["The PNG dimensions exceed the local display safety limit.", "PNG 尺寸超出本機顯示安全上限。"],
    "jpeg-dimensions-exceed-limit": ["The JPEG dimensions exceed the local display safety limit.", "JPEG 尺寸超出本機顯示安全上限。"],
    "malformed-png-chunk": ["The PNG byte structure is incomplete or malformed.", "PNG 位元組結構唔完整或者格式錯誤。"],
    "malformed-jpeg-segment": ["The JPEG byte structure is incomplete or malformed.", "JPEG 位元組結構唔完整或者格式錯誤。"],
    "missing-png-header": ["The PNG is missing its required header.", "PNG 缺少必要標頭。"],
    "malformed-png-header": ["The PNG header is malformed.", "PNG 標頭格式錯誤。"],
    "unsupported-png-header": ["The PNG uses an unsupported image layout.", "PNG 使用咗唔支援嘅圖片格式配置。"],
    "malformed-png-transparency": ["The PNG transparency data is malformed.", "PNG 透明度資料格式錯誤。"],
    "malformed-png-end": ["The PNG does not end as a complete still image.", "PNG 未能以完整靜態圖片方式結束。"],
    "incomplete-png": ["The PNG image data is incomplete.", "PNG 圖片資料唔完整。"],
    "missing-jpeg-frame": ["The JPEG is missing its required image frame.", "JPEG 缺少必要圖片影格。"],
    "malformed-jpeg-frame": ["The JPEG image frame is malformed.", "JPEG 圖片影格格式錯誤。"],
    "incomplete-jpeg": ["The JPEG image data is incomplete.", "JPEG 圖片資料唔完整。"],
    "decoder-rejected": ["The browser decoder rejected this image after byte validation.", "位元組驗證後，瀏覽器解碼器拒絕咗呢張圖片。"],
    "isolated-decoder-unavailable": ["This browser cannot start the required local isolated image decoder.", "呢個瀏覽器未能啟動必要嘅本機隔離圖片解碼器。"],
    "decoder-dimensions-mismatch": ["The browser decoder did not agree with the bounded image dimensions.", "瀏覽器解碼器同受限圖片尺寸唔一致。"],
    "custom-data-uri-exceeds-limit": ["The saved custom image exceeds the local safety limit.", "已儲存嘅自訂圖片超出本機安全上限。"],
    "invalid-custom-data-uri": ["The saved custom image record is malformed.", "已儲存嘅自訂圖片紀錄格式錯誤。"],
    "custom-data-uri-mime-mismatch": ["The saved custom image type does not match its verified bytes.", "已儲存嘅自訂圖片類型同已驗證位元組唔一致。"]
  });

  let context = null;
  let importing = false;
  let scheduleTimer = null;
  let lastRenderedScheduleState = null;
  let validatedCustomDataUri = null;
  let validationCandidate = null;
  let validationGeneration = 0;

  function $(selector, scope = document) { return scope.querySelector(selector); }
  function $$(selector, scope = document) { return [...scope.querySelectorAll(selector)]; }

  function language() { return context?.getLanguage?.() || "en"; }
  function funnyLevel() { return Number(context?.getFunnyLevel?.() || 1); }
  function localizedPair(pair) {
    if (language() === "yue") return pair[1];
    if (language() === "bilingual") return `${pair[0]} · ${pair[1]}`;
    return pair[0];
  }
  function localized(key) {
    const pair = COPY[key] || [key, key];
    return localizedPair(pair);
  }

  function presetLabel(preset) {
    return localizedPair([preset.label, preset.labelYue || preset.label]);
  }

  function playfulStatus(text) {
    if (funnyLevel() < 4) return text;
    if (language() === "yue") return `${text} 像素戴咗安全帽，但事實冇走樣。`;
    if (language() === "bilingual") return `${text} · Pixels brought a tiny hard hat; the facts are unchanged. · 像素戴咗安全帽，但事實冇走樣。`;
    return `${text} Pixels brought a tiny hard hat; the facts are unchanged.`;
  }

  function currentLogo() {
    return context?.getLogoState?.() || contract.normalizeLogoSettings(null);
  }

  function fallbackForCustom(logo) {
    return contract.normalizeLogoSettings({
      ...logo,
      selection: { kind: "preset", presetId: logo.lastPresetId || "transfer" },
      lastPresetId: logo.lastPresetId || "transfer"
    });
  }

  function renderableLogo(logo) {
    if (logo.selection.kind !== "custom" || validatedCustomDataUri === logo.selection.dataUri) return logo;
    return fallbackForCustom(logo);
  }

  function primaryScheduleRule(logo) {
    const rule = logo?.schedule?.rules?.[0];
    return rule || contract.normalizeLogoSettings(null).schedule.rules[0];
  }

  function setStatus(message, tone = "info") {
    const status = $("#logo-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function describeFailure(reason) {
    return localizedPair(FAILURES[reason] || ["The image did not pass the local safety checks.", "圖片未能通過本機安全檢查。"]);
  }

  function dataUriFromBytes(bytes, mime) {
    let binary = "";
    const step = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += step) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  }

  async function verifyIsolatedDecode(bytes) {
    if (typeof Worker !== "function") return { ok: false, reason: "isolated-decoder-unavailable" };
    let worker;
    try {
      worker = new Worker("./logo-image-worker.js");
    } catch (_error) {
      return { ok: false, reason: "isolated-decoder-unavailable" };
    }
    const transferred = bytes.slice().buffer;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.terminate();
        resolve(result);
      };
      const timeout = setTimeout(() => finish({ ok: false, reason: "decoder-rejected" }), 3000);
      worker.addEventListener("message", (event) => finish(event.data && typeof event.data === "object" ? event.data : { ok: false, reason: "decoder-rejected" }), { once: true });
      worker.addEventListener("error", () => finish({ ok: false, reason: "decoder-rejected" }), { once: true });
      try {
        worker.postMessage({ kind: "validate-logo-image", bytes: transferred }, [transferred]);
      } catch (_error) {
        finish({ ok: false, reason: "isolated-decoder-unavailable" });
      }
    });
  }

  async function revalidateStoredCustom(rawLogo) {
    if (rawLogo.selection.kind !== "custom") return;
    const dataUri = rawLogo.selection.dataUri;
    if (dataUri === validatedCustomDataUri || dataUri === validationCandidate) return;
    validationCandidate = dataUri;
    const generation = ++validationGeneration;
    setStatus(localized("customValidationPending"), "info");
    const candidate = contract.decodeDataUriCandidate(dataUri);
    const result = candidate.valid ? await verifyIsolatedDecode(candidate.bytes) : { ok: false, reason: candidate.reason };
    const latest = currentLogo();
    if (generation !== validationGeneration || latest.selection.kind !== "custom" || latest.selection.dataUri !== dataUri) return;
    validationCandidate = null;
    if (result.ok) {
      validatedCustomDataUri = dataUri;
      render();
      setStatus(localized("customAccepted"), "success");
      return;
    }
    validatedCustomDataUri = null;
    const persisted = commitLogoSafely(fallbackForCustom(rawLogo));
    render();
    setStatus(persisted ? localized("customValidationRejected") : localized("storageUnavailable"), "error");
  }

  function mergeLogo(patch) {
    const current = currentLogo();
    const { scheduleRule, ...rest } = patch || {};
    const schedule = rest.schedule
      ? { ...current.schedule, ...rest.schedule, rules: Array.isArray(rest.schedule.rules) ? rest.schedule.rules : current.schedule.rules }
      : current.schedule;
    if (scheduleRule && typeof scheduleRule === "object") {
      schedule.rules = [{ ...primaryScheduleRule(current), ...scheduleRule }, ...current.schedule.rules.slice(1)];
    }
    return contract.normalizeLogoSettings({
      ...current,
      ...rest,
      transform: { ...current.transform, ...(rest.transform || {}) },
      schedule
    });
  }

  function updateScheduleRule(patch, message) {
    return commit(mergeLogo({ scheduleRule: patch }), message);
  }

  function commit(logo, message, tone = "success") {
    const persisted = commitLogoSafely(logo);
    render();
    setStatus(persisted ? playfulStatus(message) : localized("storageUnavailable"), persisted ? tone : "warning");
    return persisted;
  }

  function commitLogoSafely(logo) {
    try {
      return context?.commitLogo?.(logo) === true;
    } catch (_error) {
      return false;
    }
  }

  function targetStyle(target, logo) {
    target.style.setProperty("--logo-fit", logo.transform.fit);
    target.style.setProperty("--logo-focal-x", `${logo.transform.focalX}%`);
    target.style.setProperty("--logo-focal-y", `${logo.transform.focalY}%`);
    target.style.setProperty("--logo-crop-zoom", String(logo.transform.cropZoom / 100));
    target.style.setProperty("--logo-background", logo.transform.backgroundMode === "color" ? logo.transform.backgroundColor : "transparent");
    target.dataset.logoFit = logo.transform.fit;
    target.dataset.logoBackground = logo.transform.backgroundMode;
  }

  function renderTarget(target, logo) {
    targetStyle(target, logo);
    const customImage = $("[data-logo-custom-image]", target);
    const glyph = $("[data-logo-glyph]", target);
    const selection = logo.selection;
    if (selection.kind === "custom") {
      if (customImage) {
        customImage.src = selection.dataUri;
        customImage.alt = localized("customPreview");
        customImage.hidden = false;
      }
      if (glyph) glyph.hidden = true;
      target.dataset.logoKind = "custom";
    } else {
      const preset = contract.getPreset(selection.presetId);
      if (glyph) {
        glyph.textContent = preset.glyph;
        glyph.hidden = false;
        glyph.dataset.tone = preset.tone;
      }
      if (customImage) {
        customImage.removeAttribute("src");
        customImage.alt = "";
        customImage.hidden = true;
      }
      target.dataset.logoKind = "preset";
      target.dataset.logoPreset = preset.id;
    }
  }

  function renderTargets(logo) {
    $$('[data-logo-render-target]').forEach((target) => renderTarget(target, logo));
  }

  function selectionDescription(logo) {
    if (logo.selection.kind === "preset") return localized("conversionPreset");
    const selection = logo.selection;
    const transparency = selection.hasAlpha ? localized("alphaPreserved") : localized("jpegOpaque");
    return `${localized("conversionCustom")} ${selection.format.toUpperCase()} · ${selection.width}×${selection.height} · ${selection.byteLength} bytes. ${transparency}`;
  }

  function renderPresetButtons(logo) {
    const list = $("#logo-preset-list");
    if (!list) return;
    list.replaceChildren();
    contract.PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logo-preset";
      button.dataset.logoPreset = preset.id;
      const selected = logo.selection.kind === "preset" && logo.selection.presetId === preset.id && !logo.scheduled;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-label", `${presetLabel(preset)}${selected ? ` · ${localized("presetSelected")}` : ""}`);
      const glyph = document.createElement("span");
      glyph.className = "logo-preset-glyph";
      glyph.dataset.tone = preset.tone;
      glyph.textContent = preset.glyph;
      glyph.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "logo-preset-copy";
      const title = document.createElement("strong");
      title.textContent = presetLabel(preset);
      const description = document.createElement("small");
      description.textContent = preset.id === "transfer" ? localized("shippedDefault") : localized("shippedPreset");
      copy.append(title, description);
      button.append(glyph, copy);
      button.addEventListener("click", () => {
        commit(mergeLogo({ selection: { kind: "preset", presetId: preset.id }, lastPresetId: preset.id }), `${presetLabel(preset)} ${localized("presetActive")}`);
      });
      list.append(button);
    });
  }

  function renderSchedulePresets(logo) {
    const list = $("#logo-schedule-preset-list");
    if (!list) return;
    list.replaceChildren();
    const rule = primaryScheduleRule(logo);
    contract.PRESETS.forEach((preset) => {
      const label = document.createElement("label");
      label.className = "compact-radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "logo-schedule-preset";
      input.value = preset.id;
      input.checked = rule.presetId === preset.id;
      input.addEventListener("change", () => {
        if (input.checked) updateScheduleRule({ presetId: preset.id }, `${presetLabel(preset)} ${localized("presetActive")}`);
      });
      const glyph = document.createElement("span");
      glyph.textContent = preset.glyph;
      glyph.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = presetLabel(preset);
      label.append(input, glyph, text);
      list.append(label);
    });
  }

  function setValue(id, value) {
    const element = $(`#${id}`);
    if (element && document.activeElement !== element) element.value = String(value);
  }

  function renderControls(logo) {
    const rule = primaryScheduleRule(logo);
    setValue("logo-fit", logo.transform.fit);
    setValue("logo-focal-x", logo.transform.focalX);
    setValue("logo-focal-y", logo.transform.focalY);
    setValue("logo-crop-zoom", logo.transform.cropZoom);
    setValue("logo-background-color", logo.transform.backgroundColor);
    setValue("logo-background-hex", logo.transform.backgroundColor);
    setValue("logo-schedule-label", rule.label);
    setValue("logo-schedule-priority", rule.priority);
    setValue("logo-schedule-start-date", rule.startDate);
    setValue("logo-schedule-end-date", rule.endDate);
    setValue("logo-schedule-start", rule.start);
    setValue("logo-schedule-end", rule.end);
    const transparent = $("#logo-background-transparent");
    const color = $("#logo-background-color-mode");
    const enabled = $("#logo-schedule-enabled");
    if (transparent) transparent.checked = logo.transform.backgroundMode === "transparent";
    if (color) color.checked = logo.transform.backgroundMode === "color";
    if (enabled) enabled.checked = rule.enabled;
    $("#logo-schedule-every-day") && ($("#logo-schedule-every-day").checked = rule.everyDay);
    $$("[data-logo-schedule-weekday]").forEach((input) => { input.checked = rule.weekdays.includes(input.value); });
    const timezone = $("#logo-schedule-timezone");
    if (timezone) timezone.textContent = logo.schedule.timezone;
    const focalX = $("#logo-focal-x-output");
    const focalY = $("#logo-focal-y-output");
    const zoom = $("#logo-crop-zoom-output");
    if (focalX) focalX.textContent = `${logo.transform.focalX}%`;
    if (focalY) focalY.textContent = `${logo.transform.focalY}%`;
    if (zoom) zoom.textContent = `${logo.transform.cropZoom}%`;
    const backgroundValue = $("#logo-background-value");
    if (backgroundValue) backgroundValue.textContent = logo.transform.backgroundMode === "color" ? logo.transform.backgroundColor : localized("transparent");
    const conversion = $("#logo-conversion-status");
    if (conversion) conversion.textContent = selectionDescription(logo);
    const notice = $("#logo-loss-notice");
    if (notice) {
      const warnings = [];
      if (logo.transform.fit === "fill") warnings.push(localized("fillWarning"));
      if (logo.transform.cropZoom > 100) warnings.push(localized("cropWarning"));
      notice.textContent = warnings.join(" ");
      notice.hidden = warnings.length === 0;
    }
    const scheduleStatus = $("#logo-schedule-status");
    if (scheduleStatus) scheduleStatus.textContent = rule.enabled ? (logo.scheduled ? localized("scheduleActive") : localized("scheduleInactive")) : localized("scheduleOff");
    $("#logo-background-color")?.toggleAttribute("disabled", logo.transform.backgroundMode !== "color");
    $("#logo-background-hex")?.toggleAttribute("disabled", logo.transform.backgroundMode !== "color");
    $$("#logo-schedule-editor input:not(#logo-schedule-enabled)").forEach((element) => { element.disabled = !rule.enabled; });
  }

  function renderStaticCopy() {
    $$('[data-logo-copy]').forEach((element) => { element.textContent = localized(element.dataset.logoCopy); });
    $$('[data-logo-copy-aria]').forEach((element) => { element.setAttribute("aria-label", localized(element.dataset.logoCopyAria)); });
    $$('[data-logo-copy-placeholder]').forEach((element) => { element.placeholder = localized(element.dataset.logoCopyPlaceholder); });
  }

  function scheduleFingerprint(rawLogo, now = new Date()) {
    const logo = contract.resolveLogo(renderableLogo(rawLogo), now);
    const rule = primaryScheduleRule(logo);
    return `${logo.scheduled}:${rule.enabled}:${logo.schedule.timezone}:${rule.id}:${rule.startDate}:${rule.endDate}:${rule.weekdays.join(",")}:${rule.start}:${rule.end}:${rule.priority}:${logo.selection.kind}:${logo.selection.presetId || "custom"}`;
  }

  function render(options = {}) {
    if (!context) return;
    const rebuild = options.rebuild !== false;
    const rawLogo = currentLogo();
    const logo = contract.resolveLogo(renderableLogo(rawLogo));
    renderStaticCopy();
    renderTargets(logo);
    if (rebuild) {
      renderPresetButtons(logo);
      renderSchedulePresets(logo);
    }
    renderControls(logo);
    const rule = primaryScheduleRule(logo);
    const scheduleState = scheduleFingerprint(rawLogo);
    if (lastRenderedScheduleState !== null && lastRenderedScheduleState !== scheduleState && rule.enabled) setStatus(logo.scheduled ? localized("scheduleActive") : localized("scheduleInactive"));
    lastRenderedScheduleState = scheduleState;
    if (rawLogo.selection.kind === "custom" && validatedCustomDataUri !== rawLogo.selection.dataUri) void revalidateStoredCustom(rawLogo);
  }

  function nextScheduleDelay(now = new Date()) {
    return Math.max(250, 60000 - (now.getSeconds() * 1000) - now.getMilliseconds() + 40);
  }

  function scheduleTick() {
    if (!context) return;
    const rawLogo = currentLogo();
    const nextState = scheduleFingerprint(rawLogo);
    if (nextState !== lastRenderedScheduleState) render();
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(scheduleTick, nextScheduleDelay());
  }

  async function importFile(file) {
    if (!file || importing) return;
    importing = true;
    const input = $("#logo-upload");
    const before = currentLogo();
    try {
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > contract.MAX_INPUT_BYTES) {
        setStatus(describeFailure(file.size > contract.MAX_INPUT_BYTES ? "image-bytes-exceed-limit" : "empty-image"), "error");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const descriptor = contract.inspectImageBytes(bytes);
      if (!descriptor.valid) {
        setStatus(describeFailure(descriptor.reason), "error");
        return;
      }
      const decoded = await verifyIsolatedDecode(bytes);
      if (!decoded.ok) {
        setStatus(describeFailure(decoded.reason), "error");
        return;
      }
      const selection = { kind: "custom", dataUri: dataUriFromBytes(bytes, descriptor.mime) };
      const next = mergeLogo({ selection, lastPresetId: before.lastPresetId || "transfer" });
      if (next.selection.kind !== "custom") {
        setStatus(localized("customRetainFailure"), "error");
        return;
      }
      validatedCustomDataUri = next.selection.dataUri;
      validationCandidate = null;
      validationGeneration += 1;
      const persisted = commit(next, `${localized("customAccepted")} ${selectionDescription(next)}`);
      if (persisted) context?.notify?.("success", localized("logoUpdatedTitle"), localized("logoUpdatedMessage"));
    } catch (_error) {
      setStatus(localized("customReadFailure"), "error");
    } finally {
      importing = false;
      if (input) input.value = "";
    }
  }

  function updateTransform(field, value) {
    commit(mergeLogo({ transform: { [field]: value } }), localized("appearanceUpdated"), "info");
  }

  function bind() {
    $("#logo-upload")?.addEventListener("change", (event) => importFile(event.target.files?.[0]));
    $("#logo-clear-custom")?.addEventListener("click", () => {
      const logo = currentLogo();
      if (logo.selection.kind !== "custom") return setStatus(localized("customAlreadyClear"));
      validatedCustomDataUri = null;
      validationCandidate = null;
      validationGeneration += 1;
      commit(mergeLogo({ selection: { kind: "preset", presetId: logo.lastPresetId || "transfer" } }), localized("customCleared"));
    });
    $("#logo-reset")?.addEventListener("click", () => {
      validatedCustomDataUri = null;
      validationCandidate = null;
      validationGeneration += 1;
      commit(contract.normalizeLogoSettings(null), localized("reset"));
    });
    $("#logo-fit")?.addEventListener("change", (event) => updateTransform("fit", event.target.value));
    $("#logo-focal-x")?.addEventListener("input", (event) => updateTransform("focalX", Number(event.target.value)));
    $("#logo-focal-y")?.addEventListener("input", (event) => updateTransform("focalY", Number(event.target.value)));
    $("#logo-crop-zoom")?.addEventListener("input", (event) => updateTransform("cropZoom", Number(event.target.value)));
    $("#logo-background-transparent")?.addEventListener("change", (event) => { if (event.target.checked) updateTransform("backgroundMode", "transparent"); });
    $("#logo-background-color-mode")?.addEventListener("change", (event) => { if (event.target.checked) updateTransform("backgroundMode", "color"); });
    $("#logo-background-color")?.addEventListener("input", (event) => updateTransform("backgroundColor", event.target.value));
    $("#logo-background-hex")?.addEventListener("change", (event) => updateTransform("backgroundColor", event.target.value));
    $("#logo-schedule-enabled")?.addEventListener("change", (event) => updateScheduleRule({ enabled: Boolean(event.target.checked) }, Boolean(event.target.checked) ? localized("scheduleInactive") : localized("scheduleDisabled")));
    $("#logo-schedule-label")?.addEventListener("change", (event) => updateScheduleRule({ label: event.target.value }, localized("scheduleUpdated")));
    $("#logo-schedule-priority")?.addEventListener("change", (event) => updateScheduleRule({ priority: Number(event.target.value) }, localized("scheduleUpdated")));
    $("#logo-schedule-start-date")?.addEventListener("change", (event) => updateScheduleRule({ startDate: event.target.value }, localized("scheduleUpdated")));
    $("#logo-schedule-end-date")?.addEventListener("change", (event) => updateScheduleRule({ endDate: event.target.value }, localized("scheduleUpdated")));
    $("#logo-schedule-start")?.addEventListener("change", (event) => updateScheduleRule({ start: event.target.value }, localized("scheduleStartUpdated")));
    $("#logo-schedule-end")?.addEventListener("change", (event) => updateScheduleRule({ end: event.target.value }, localized("scheduleEndUpdated")));
    $("#logo-schedule-every-day")?.addEventListener("change", (event) => updateScheduleRule({ weekdays: event.target.checked ? contract.WEEKDAYS : [] }, localized("scheduleUpdated")));
    $$('[data-logo-schedule-weekday]').forEach((input) => input.addEventListener("change", () => {
      const selected = $$('[data-logo-schedule-weekday]').filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
      updateScheduleRule({ weekdays: selected }, localized("scheduleUpdated"));
    }));
    $("#logo-export-safe")?.addEventListener("click", () => {
      const payload = contract.buildSafeExport(currentLogo());
      context?.downloadFile?.("site-logo-configuration-safe.json", `${JSON.stringify(payload, null, 2)}\n`, "application/json");
      setStatus(localized("exportReady"));
    });
  }

  function initialize(options) {
    context = options;
    bind();
    render();
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(scheduleTick, nextScheduleDelay());
    window.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleTick();
    });
    window.addEventListener("focus", scheduleTick);
  }

  function focusUpload() {
    context?.selectSettingsTab?.();
    requestAnimationFrame(() => $("#logo-upload")?.focus());
  }

  function reset() {
    validatedCustomDataUri = null;
    validationCandidate = null;
    validationGeneration += 1;
    commit(contract.normalizeLogoSettings(null), localized("reset"));
  }

  global.MDM_SITE_LOGO_CUSTOMIZATION = Object.freeze({ initialize, render, focusUpload, reset });
})(typeof window === "object" ? window : globalThis);
