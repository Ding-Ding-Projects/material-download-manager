import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  makeSettingsExport,
  parseSettingsExport,
  sanitizeSettings,
  validateEndpoint,
} from "./shared/settings.js";
import { appendRegexFragment, evaluateRegex, validateRegex } from "./shared/regex.js";
import { decorateMessage, localize } from "./shared/localization.js";
import { normalizeTotpRegistration, parseTotpUri } from "./shared/totp.js";
import { createQrMatrix, qrMatrixToSvg } from "./shared/qr.js";
import { colorTranslations, parseColorInput } from "./shared/color.js";
import {
  LOGO_STORAGE_KEY,
  LOGO_LIMITS,
  LOGO_PRESETS,
  LOGO_VARIANT_SIZES,
  createCustomLogoRecord,
  createPresetLogoRecord,
  defaultLogoDescriptor,
  inspectLogoBytes,
  logoDisplayDescriptor,
  normalizeLogoRecord,
  presetSourceDataUrl,
} from "./shared/logo.js";

let settings = sanitizeSettings(DEFAULT_SETTINGS);
let activeTab = "connection";
let authenticatorMetadata = [];
let pendingAuthenticator = null;
let authenticatorCodeTimer = null;
let authenticatorCodeRefreshInFlight = false;
let authenticatorStateLoadInFlight = false;
let authenticatorListRegexOpen = false;
let authenticatorListRegexMode = false;
let pendingAuthenticatorRemoval = null;
let logo = defaultLogoDescriptor();
let stagedLogo = null;
let logoSource = { kind: "preset", presetId: logo.presetId };
let logoPresetRegexOpen = false;
let logoPresetRegexMode = false;
const logoUploadFilterRegexState = { open: false, mode: false };
const logoColorRegexState = { open: false, mode: false };
const logoAcceptedUploadTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
let logoPreviewGeneration = 0;
const REQUIRED_SEARCHABLE_SETTING_IDS = Object.freeze([
  "handoff-endpoint",
  "auto-capture-downloads",
  "manager-display-name",
  "school-mode",
  "school-mode-name",
  "show-emojis",
  "narrator-enabled",
  "narrator-language",
  "narrator-sound-mode",
  "narrator-quiet-mode",
  "narrator-respect-reduced-motion",
  "language-mode",
  "funny-level-en",
  "funny-level-yue",
  "logo-preset-search",
  "logo-upload-filter-search",
  "logo-upload",
  "logo-fit",
  "logo-crop-zoom",
  "logo-focal-x",
  "logo-focal-y",
  "logo-background",
  "logo-color-search",
  "authenticator-uri",
  "authenticator-issuer",
  "authenticator-account",
  "authenticator-secret",
  "authenticator-algorithm",
  "authenticator-digits",
  "authenticator-period",
  "authenticator-list-search",
]);

const elements = {
  managerName: document.querySelector("#manager-name"),
  optionsTitle: document.querySelector("#options-title"),
  form: document.querySelector("#settings-form"),
  search: document.querySelector("#settings-search"),
  searchSummary: document.querySelector("#search-summary"),
  regexToggle: document.querySelector("#regex-toggle"),
  regexBuilder: document.querySelector("#regex-builder"),
  regexPattern: document.querySelector("#regex-pattern"),
  regexFlags: document.querySelector("#regex-flags"),
  regexSample: document.querySelector("#regex-sample"),
  regexFeedback: document.querySelector("#regex-feedback"),
  regexMatches: document.querySelector("#regex-matches"),
  regexMode: document.querySelector("#regex-mode"),
  regexApply: document.querySelector("#regex-apply"),
  regexCopy: document.querySelector("#regex-copy"),
  regexExport: document.querySelector("#regex-export"),
  endpoint: document.querySelector("#handoff-endpoint"),
  endpointError: document.querySelector("#endpoint-error"),
  recoveryCard: document.querySelector(".recovery-card"),
  useDefaultEndpoint: document.querySelector("#use-default-endpoint"),
  testConnection: document.querySelector("#test-connection"),
  connectionStatus: document.querySelector("#connection-status"),
  autoCaptureDownloads: document.querySelector("#auto-capture-downloads"),
  managerDisplayName: document.querySelector("#manager-display-name"),
  schoolMode: document.querySelector("#school-mode"),
  schoolModeHeading: document.querySelector("#school-mode-heading"),
  schoolModeLabel: document.querySelector("#school-mode-label"),
  schoolModeName: document.querySelector("#school-mode-name"),
  schoolModeNameLabel: document.querySelector("#school-mode-name-label"),
  schoolModeHelp: document.querySelector("#school-mode-help"),
  schoolModeCredentialStatus: document.querySelector("#school-mode-credential-status"),
  showEmojis: document.querySelector("#show-emojis"),
  narratorEnabled: document.querySelector("#narrator-enabled"),
  narratorLanguage: document.querySelector("#narrator-language"),
  narratorSoundMode: document.querySelector("#narrator-sound-mode"),
  narratorQuietMode: document.querySelector("#narrator-quiet-mode"),
  narratorRespectReducedMotion: document.querySelector("#narrator-respect-reduced-motion"),
  narratorStatus: document.querySelector("#narrator-status"),
  testNarration: document.querySelector("#test-narration"),
  languageMode: document.querySelector("#language-mode"),
  funnyEn: document.querySelector("#funny-level-en"),
  funnyEnOutput: document.querySelector("#funny-level-en-output"),
  funnyYue: document.querySelector("#funny-level-yue"),
  funnyYueOutput: document.querySelector("#funny-level-yue-output"),
  resetManagerName: document.querySelector("#reset-manager-name"),
  saveSettings: document.querySelector("#save-settings"),
  dirtyState: document.querySelector("#dirty-state"),
  exportSettings: document.querySelector("#export-settings"),
  importSettings: document.querySelector("#import-settings"),
  importFile: document.querySelector("#import-file"),
  resetSettings: document.querySelector("#reset-settings"),
  logoCard: document.querySelector("#logo-customization-card"),
  logoFocusSearch: document.querySelector("#logo-focus-search"),
  logoProvenance: document.querySelector("#logo-provenance"),
  logoStatus: document.querySelector("#logo-status"),
  logoPresetSearch: document.querySelector("#logo-preset-search"),
  logoPresetRegexToggle: document.querySelector("#logo-preset-regex-toggle"),
  logoPresetRegex: document.querySelector("#logo-preset-regex"),
  logoPresetRegexPattern: document.querySelector("#logo-preset-regex-pattern"),
  logoPresetRegexFlags: document.querySelector("#logo-preset-regex-flags"),
  logoPresetRegexSample: document.querySelector("#logo-preset-regex-sample"),
  logoPresetRegexFeedback: document.querySelector("#logo-preset-regex-feedback"),
  logoPresetRegexMatches: document.querySelector("#logo-preset-regex-matches"),
  logoPresetRegexApply: document.querySelector("#logo-preset-regex-apply"),
  logoPresetRegexCopy: document.querySelector("#logo-preset-regex-copy"),
  logoPresetRegexExport: document.querySelector("#logo-preset-regex-export"),
  logoPresetRegexMode: document.querySelector("#logo-preset-regex-mode"),
  logoPresetSummary: document.querySelector("#logo-preset-summary"),
  logoPresetList: document.querySelector("#logo-preset-list"),
  logoApplyPreset: document.querySelector("#logo-apply-preset"),
  logoUploadFilterSearch: document.querySelector("#logo-upload-filter-search"),
  logoUploadFilterRegexToggle: document.querySelector("#logo-upload-filter-regex-toggle"),
  logoUploadFilterRegex: document.querySelector("#logo-upload-filter-regex"),
  logoUploadFilterRegexPattern: document.querySelector("#logo-upload-filter-regex-pattern"),
  logoUploadFilterRegexFlags: document.querySelector("#logo-upload-filter-regex-flags"),
  logoUploadFilterRegexSample: document.querySelector("#logo-upload-filter-regex-sample"),
  logoUploadFilterRegexFeedback: document.querySelector("#logo-upload-filter-regex-feedback"),
  logoUploadFilterRegexMatches: document.querySelector("#logo-upload-filter-regex-matches"),
  logoUploadFilterRegexApply: document.querySelector("#logo-upload-filter-regex-apply"),
  logoUploadFilterRegexCopy: document.querySelector("#logo-upload-filter-regex-copy"),
  logoUploadFilterRegexExport: document.querySelector("#logo-upload-filter-regex-export"),
  logoUploadFilterRegexMode: document.querySelector("#logo-upload-filter-regex-mode"),
  logoUploadFilterSummary: document.querySelector("#logo-upload-filter-summary"),
  logoUploadFormatList: document.querySelector("#logo-upload-format-list"),
  logoUploadFormats: [...document.querySelectorAll("[data-logo-upload-format]")],
  logoUpload: document.querySelector("#logo-upload"),
  logoUploadStatus: document.querySelector("#logo-upload-status"),
  logoFit: document.querySelector("#logo-fit"),
  logoFitOptions: [...document.querySelectorAll('input[name="logo-fit"]')],
  logoCropZoom: document.querySelector("#logo-crop-zoom"),
  logoCropZoomOutput: document.querySelector("#logo-crop-zoom-output"),
  logoFocalX: document.querySelector("#logo-focal-x"),
  logoFocalXOutput: document.querySelector("#logo-focal-x-output"),
  logoFocalY: document.querySelector("#logo-focal-y"),
  logoFocalYOutput: document.querySelector("#logo-focal-y-output"),
  logoTransparentBackground: document.querySelector("#logo-transparent-background"),
  logoBackground: document.querySelector("#logo-background"),
  logoBackgroundAlpha: document.querySelector("#logo-background-alpha"),
  logoBackgroundAlphaOutput: document.querySelector("#logo-background-alpha-output"),
  logoColorValue: document.querySelector("#logo-color-value"),
  logoColorStatus: document.querySelector("#logo-color-status"),
  logoColorSearch: document.querySelector("#logo-color-search"),
  logoColorRegexToggle: document.querySelector("#logo-color-regex-toggle"),
  logoColorRegex: document.querySelector("#logo-color-regex"),
  logoColorRegexPattern: document.querySelector("#logo-color-regex-pattern"),
  logoColorRegexFlags: document.querySelector("#logo-color-regex-flags"),
  logoColorRegexSample: document.querySelector("#logo-color-regex-sample"),
  logoColorRegexFeedback: document.querySelector("#logo-color-regex-feedback"),
  logoColorRegexMatches: document.querySelector("#logo-color-regex-matches"),
  logoColorRegexApply: document.querySelector("#logo-color-regex-apply"),
  logoColorRegexCopy: document.querySelector("#logo-color-regex-copy"),
  logoColorRegexExport: document.querySelector("#logo-color-regex-export"),
  logoColorRegexMode: document.querySelector("#logo-color-regex-mode"),
  logoColorSearchSummary: document.querySelector("#logo-color-search-summary"),
  logoColorTranslations: document.querySelector("#logo-color-translations"),
  logoApplyCustom: document.querySelector("#logo-apply-custom"),
  logoApplyCustomHelp: document.querySelector("#logo-apply-custom-help"),
  logoReset: document.querySelector("#logo-reset"),
  logoPreviews: Object.fromEntries(LOGO_VARIANT_SIZES.map((size) => [size, document.querySelector(`#logo-preview-${size}`)])),
  authenticatorUri: document.querySelector("#authenticator-uri"),
  authenticatorParseUri: document.querySelector("#authenticator-parse-uri"),
  authenticatorGenerateSecret: document.querySelector("#authenticator-generate-secret"),
  authenticatorIssuer: document.querySelector("#authenticator-issuer"),
  authenticatorAccount: document.querySelector("#authenticator-account"),
  authenticatorSecret: document.querySelector("#authenticator-secret"),
  authenticatorAlgorithm: document.querySelector("#authenticator-algorithm"),
  authenticatorDigits: document.querySelector("#authenticator-digits"),
  authenticatorPeriod: document.querySelector("#authenticator-period"),
  authenticatorPrepare: document.querySelector("#authenticator-prepare"),
  authenticatorRegisterError: document.querySelector("#authenticator-register-error"),
  authenticatorPairingCard: document.querySelector("#authenticator-pairing-card"),
  authenticatorQr: document.querySelector("#authenticator-qr"),
  authenticatorQrStatus: document.querySelector("#authenticator-qr-status"),
  authenticatorManualSecret: document.querySelector("#authenticator-manual-secret"),
  authenticatorRevealSecret: document.querySelector("#authenticator-reveal-secret"),
  authenticatorCopySecret: document.querySelector("#authenticator-copy-secret"),
  authenticatorPairingFacts: document.querySelector("#authenticator-pairing-facts"),
  authenticatorPairingCode: document.querySelector("#authenticator-pairing-code"),
  authenticatorConfirm: document.querySelector("#authenticator-confirm"),
  authenticatorCancel: document.querySelector("#authenticator-cancel"),
  authenticatorPairingError: document.querySelector("#authenticator-pairing-error"),
  authenticatorExport: document.querySelector("#authenticator-export"),
  authenticatorListSearch: document.querySelector("#authenticator-list-search"),
  authenticatorListRegexToggle: document.querySelector("#authenticator-list-regex-toggle"),
  authenticatorListRegex: document.querySelector("#authenticator-list-regex"),
  authenticatorListRegexPattern: document.querySelector("#authenticator-list-regex-pattern"),
  authenticatorListRegexFlags: document.querySelector("#authenticator-list-regex-flags"),
  authenticatorListRegexSample: document.querySelector("#authenticator-list-regex-sample"),
  authenticatorListRegexFeedback: document.querySelector("#authenticator-list-regex-feedback"),
  authenticatorListRegexMatches: document.querySelector("#authenticator-list-regex-matches"),
  authenticatorListRegexApply: document.querySelector("#authenticator-list-regex-apply"),
  authenticatorListRegexCopy: document.querySelector("#authenticator-list-regex-copy"),
  authenticatorListRegexExport: document.querySelector("#authenticator-list-regex-export"),
  authenticatorListRegexMode: document.querySelector("#authenticator-list-regex-mode"),
  authenticatorListSummary: document.querySelector("#authenticator-list-summary"),
  authenticatorList: document.querySelector("#authenticator-list"),
  authenticatorListStatus: document.querySelector("#authenticator-list-status"),
  authenticatorRemoveCard: document.querySelector("#authenticator-remove-card"),
  authenticatorRemoveTarget: document.querySelector("#authenticator-remove-target"),
  authenticatorRemoveKeyOne: document.querySelector("#authenticator-remove-key-one"),
  authenticatorRemoveKeyTwo: document.querySelector("#authenticator-remove-key-two"),
  authenticatorRemoveSlider: document.querySelector("#authenticator-remove-slider"),
  authenticatorRemoveStatus: document.querySelector("#authenticator-remove-status"),
  authenticatorRemoveConfirm: document.querySelector("#authenticator-remove-confirm"),
  authenticatorRemoveCancel: document.querySelector("#authenticator-remove-cancel"),
  toast: document.querySelector("#toast"),
};

for (const id of REQUIRED_SEARCHABLE_SETTING_IDS) {
  const control = document.getElementById(id);
  const card = control?.closest(".setting-card[data-search]");
  if (!control || !card) throw new Error(`Searchable extension setting is missing from the settings inventory: ${id}`);
}

function localizePage() {
  document.documentElement.lang = !settings.schoolModeEnabled && settings.languageMode === "yue" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-l10n]").forEach((element) => {
    element.textContent = localize(element.dataset.l10n, settings);
  });
  document.querySelectorAll("[data-l10n-aria]").forEach((element) => {
    element.setAttribute("aria-label", localize(element.dataset.l10nAria, settings));
  });
  elements.managerName.textContent = settings.managerName;
  const schoolModeName = settings.schoolModeName;
  elements.optionsTitle.textContent = localize("optionsTitle", settings, { name: settings.managerName });
  document.title = elements.optionsTitle.textContent;
  elements.schoolModeHeading.textContent = localize("schoolModeHeading", settings, { name: schoolModeName });
  elements.schoolModeLabel.textContent = localize("schoolModeLabel", settings, { name: schoolModeName });
  elements.schoolModeNameLabel.textContent = localize("schoolModeNameLabel", settings, { name: schoolModeName });
  elements.schoolModeHelp.textContent = localize("schoolModeHelp", settings, { name: schoolModeName });
  elements.schoolModeCredentialStatus.textContent = localize("schoolModeCredentialStatus", settings, { name: schoolModeName });
  elements.narratorStatus.textContent = localize(settings.narratorEnabled ? "narratorReady" : "narratorDisabled", settings);
  elements.authenticatorList?.setAttribute("aria-label", localize("authenticatorListHeading", settings));
  elements.logoPresetList?.setAttribute("aria-label", localize("logoPresetHeading", settings));
  if (elements.logoPresetSearch) elements.logoPresetSearch.placeholder = localize("logoPresetSearchLabel", settings);
  if (elements.logoPresetRegexSample && !elements.logoPresetRegexSample.value) elements.logoPresetRegexSample.value = localize("logoPresetSearchLabel", settings);
  if (elements.logoUploadFilterSearch) elements.logoUploadFilterSearch.placeholder = localize("logoUploadFilterLabel", settings);
  if (elements.logoUploadFilterRegexSample && !elements.logoUploadFilterRegexSample.value) elements.logoUploadFilterRegexSample.value = localize("logoUploadFilterLabel", settings);
  if (elements.logoColorSearch) elements.logoColorSearch.placeholder = localize("logoColorSearchLabel", settings);
  if (elements.logoColorRegexSample && !elements.logoColorRegexSample.value) elements.logoColorRegexSample.value = localize("logoColorSearchLabel", settings);
  if (elements.authenticatorListSearch) elements.authenticatorListSearch.placeholder = localize("authenticatorListSearchLabel", settings);
  if (elements.authenticatorListRegexSample && !elements.authenticatorListRegexSample.value) elements.authenticatorListRegexSample.value = localize("authenticatorListSearchLabel", settings);
  const schoolModeCard = document.querySelector("#school-mode-card");
  if (schoolModeCard) schoolModeCard.dataset.search = `${schoolModeName} name reset credential local mode`;
  document.querySelectorAll("[data-school-hidden]").forEach((element) => {
    element.hidden = settings.schoolModeEnabled;
  });
  elements.funnyEnOutput.value = String(settings.funnyLevelEn);
  elements.funnyEnOutput.textContent = String(settings.funnyLevelEn);
  elements.funnyYueOutput.value = String(settings.funnyLevelYue);
  elements.funnyYueOutput.textContent = String(settings.funnyLevelYue);
  elements.dirtyState.textContent = "";
  refreshLogoPresentation();
}

function logoPresetKey(id) {
  return id === "download-orbit" ? "logoPresetDownloadOrbit" : id === "handoff-ribbon" ? "logoPresetHandoffRibbon" : "logoPresetMaterialStack";
}

function localizeLogoPreset(id) {
  return localize(logoPresetKey(id), settings);
}

function logoBackgroundWithAlpha() {
  const alpha = Math.round(Math.min(1, Math.max(0, Number(elements.logoBackgroundAlpha.value))) * 255).toString(16).padStart(2, "0");
  return alpha === "ff" ? elements.logoBackground.value.toLowerCase() : `${elements.logoBackground.value.toLowerCase()}${alpha}`;
}

function setLogoBackgroundColor(value) {
  const normalized = parseColorInput(value) ?? "#ffffff";
  const hex = normalized.slice(0, 7);
  const alpha = normalized.length === 9 ? Number.parseInt(normalized.slice(7, 9), 16) / 255 : 1;
  elements.logoBackground.value = hex;
  elements.logoBackgroundAlpha.value = String(alpha);
  elements.logoColorValue.value = normalized.toUpperCase();
}

function logoControls() {
  return {
    fit: elements.logoFitOptions.find((option) => option.checked)?.value ?? "contain",
    cropZoom: Number(elements.logoCropZoom.value),
    focalX: Number(elements.logoFocalX.value),
    focalY: Number(elements.logoFocalY.value),
    background: elements.logoTransparentBackground.checked ? "transparent" : logoBackgroundWithAlpha(),
  };
}

function updateLogoControlOutputs() {
  elements.logoCropZoomOutput.value = `${Number(elements.logoCropZoom.value).toFixed(2)}×`;
  elements.logoCropZoomOutput.textContent = elements.logoCropZoomOutput.value;
  elements.logoFocalXOutput.value = `${Math.round(Number(elements.logoFocalX.value) * 100)}%`;
  elements.logoFocalXOutput.textContent = elements.logoFocalXOutput.value;
  elements.logoFocalYOutput.value = `${Math.round(Number(elements.logoFocalY.value) * 100)}%`;
  elements.logoFocalYOutput.textContent = elements.logoFocalYOutput.value;
  elements.logoBackgroundAlphaOutput.value = `${Math.round(Number(elements.logoBackgroundAlpha.value) * 100)}%`;
  elements.logoBackgroundAlphaOutput.textContent = elements.logoBackgroundAlphaOutput.value;
  const fit = elements.logoFitOptions.find((option) => option.checked)?.value ?? "contain";
  const focalUsable = fit !== "fill" && (fit === "cover" || Number(elements.logoCropZoom.value) > 1);
  elements.logoFitOptions.forEach((option) => { option.disabled = settings.schoolModeEnabled; });
  [elements.logoFocalX, elements.logoFocalY].forEach((control) => { control.disabled = !focalUsable || settings.schoolModeEnabled; });
  elements.logoTransparentBackground.disabled = settings.schoolModeEnabled;
  elements.logoBackground.disabled = settings.schoolModeEnabled || elements.logoTransparentBackground.checked;
  elements.logoBackgroundAlpha.disabled = settings.schoolModeEnabled || elements.logoTransparentBackground.checked;
  elements.logoColorValue.disabled = settings.schoolModeEnabled || elements.logoTransparentBackground.checked;
  elements.logoApplyCustom.disabled = !activeLogoSource() || settings.schoolModeEnabled;
}

function setLogoPreviewImage(image, descriptor, size) {
  if (!image) return;
  const source = descriptor?.variants?.[String(size)] ?? logoDisplayDescriptor(descriptor, size).previewDataUrl;
  image.src = source;
  image.alt = descriptor?.kind === "custom"
    ? localize("logoCustomPreviewAlt", settings, { name: settings.managerName, size })
    : localize("logoPreviewAlt", settings, { name: settings.managerName, preset: localizeLogoPreset(descriptor?.presetId ?? "material-stack"), size });
  image.style.backgroundColor = descriptor?.background && descriptor.background !== "transparent" ? descriptor.background : "transparent";
}

function renderLogoPreviews(descriptor = logo) {
  LOGO_VARIANT_SIZES.forEach((size) => setLogoPreviewImage(elements.logoPreviews[size], descriptor, size));
}

function fillLogoControls(descriptor = logo) {
  const resolved = descriptor && typeof descriptor === "object" ? descriptor : defaultLogoDescriptor();
  elements.logoFitOptions.forEach((option) => { option.checked = option.value === (resolved.fit ?? "contain"); });
  elements.logoCropZoom.value = String(resolved.cropZoom ?? 1);
  elements.logoFocalX.value = String(resolved.focalX ?? 0.5);
  elements.logoFocalY.value = String(resolved.focalY ?? 0.5);
  elements.logoTransparentBackground.checked = (resolved.background ?? "transparent") === "transparent";
  setLogoBackgroundColor((resolved.background && resolved.background !== "transparent") ? resolved.background : "#ffffff");
  updateLogoControlOutputs();
  renderLogoColorTranslations();
}

function renderLogoColorTranslations() {
  const translations = colorTranslations(logoBackgroundWithAlpha());
  elements.logoColorTranslations.replaceChildren();
  if (!translations || elements.logoTransparentBackground.checked) {
    elements.logoColorStatus.textContent = elements.logoTransparentBackground.checked ? localize("logoColorTransparent", settings) : localize("logoColorInvalid", settings);
    refreshLogoColorSearchSummary(0, 0);
    return;
  }
  elements.logoColorStatus.textContent = localize("logoColorValid", settings);
  const entries = Object.entries(translations).filter(([key]) => !key.startsWith("contrast"));
  const predicate = logoFilterPredicate(logoColorRegexConfig);
  let visible = 0;
  for (const [format, value] of entries) {
    if (!predicate || !predicate(`${format} ${value}`)) continue;
    visible += 1;
    const row = document.createElement("div");
    row.className = "logo-color-translation";
    const label = document.createElement("strong");
    label.textContent = format;
    const code = document.createElement("code");
    code.textContent = value;
    row.append(label, code);
    elements.logoColorTranslations.append(row);
  }
  if (predicate && predicate(`contrast ${translations.contrastOnWhite} ${translations.contrastOnBlack}`)) {
    const contrast = document.createElement("p");
    contrast.className = "logo-color-contrast";
    contrast.textContent = localize("logoColorContrast", settings, { white: translations.contrastOnWhite, black: translations.contrastOnBlack });
    elements.logoColorTranslations.append(contrast);
  }
  refreshLogoColorSearchSummary(visible, entries.length);
}

function refreshLogoPresentation() {
  if (!elements.logoCard) return;
  const current = logo && typeof logo === "object" ? logo : defaultLogoDescriptor();
  renderLogoPreviews(stagedLogo?.record ?? current);
  const kind = current.kind === "custom" ? localize("logoCustomActive", settings) : localize("logoPresetActive", settings, { preset: localizeLogoPreset(current.presetId ?? "material-stack") });
  elements.logoProvenance.textContent = settings.schoolModeEnabled
    ? localize("logoSchoolModeSuppressed", settings, { name: settings.schoolModeName })
    : localize("logoProvenanceState", settings, { state: kind });
  elements.logoUploadStatus.textContent = stagedLogo?.status ?? "";
  elements.logoApplyPreset.disabled = settings.schoolModeEnabled;
  elements.logoReset.disabled = settings.schoolModeEnabled;
  elements.logoUpload.disabled = settings.schoolModeEnabled;
  document.querySelectorAll("[data-logo-preset]").forEach((button) => {
    const selected = logoSource.kind === "preset" && button.dataset.logoPreset === logoSource.presetId;
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = settings.schoolModeEnabled || button.hidden;
    const preview = button.querySelector("img");
    if (preview) {
      const id = button.dataset.logoPreset;
      preview.src = presetSourceDataUrl(id);
      preview.alt = localize("logoPresetPreviewAlt", settings, { preset: localizeLogoPreset(id) });
    }
  });
  updateLogoControlOutputs();
  elements.logoApplyCustomHelp.textContent = settings.schoolModeEnabled
    ? localize("logoSchoolModeSuppressed", settings, { name: settings.schoolModeName })
    : activeLogoSource()
      ? localize("logoApplyCustomReady", settings)
      : localize("logoApplyCustomHelp", settings);
  refreshLogoPresetSearch();
  refreshLogoUploadFilter();
  renderLogoColorTranslations();
}

function activeLogoSource() {
  if (stagedLogo?.source) return stagedLogo.source;
  if (logo?.kind === "custom" && typeof logo.sourceDataUrl === "string") return logo.sourceDataUrl;
  return null;
}

let logoPreviewTimer = null;
async function regenerateLogoPreview() {
  if (settings.schoolModeEnabled) return;
  const generation = ++logoPreviewGeneration;
  const controls = logoControls();
  try {
    const source = activeLogoSource();
    const record = source
      ? await createCustomLogoRecord(source, controls)
      : await createPresetLogoRecord(logoSource.presetId ?? "material-stack", controls);
    if (generation !== logoPreviewGeneration) return;
    stagedLogo = source ? { ...(stagedLogo ?? {}), source, record, status: localize("logoPreviewUpdated", settings) } : null;
    renderLogoPreviews(record);
    elements.logoStatus.textContent = localize("logoPreviewUpdated", settings);
    updateLogoControlOutputs();
  } catch (error) {
    if (generation !== logoPreviewGeneration) return;
    stagedLogo = stagedLogo ? { ...stagedLogo, record: null, status: logoErrorMessage(error) } : null;
    renderLogoPreviews(logo);
    elements.logoStatus.textContent = logoErrorMessage(error);
    updateLogoControlOutputs();
  }
}

function scheduleLogoPreview() {
  if (logoPreviewTimer !== null) clearTimeout(logoPreviewTimer);
  logoPreviewTimer = window.setTimeout(() => { void regenerateLogoPreview(); }, 180);
}

function logoErrorMessage(error) {
  const code = error?.code ?? "";
  const key = {
    "logo-file-size": "logoFileSizeError",
    "logo-image-bounds": "logoImageBoundsError",
    "logo-animated-image": "logoAnimatedError",
    "logo-type-mismatch": "logoTypeMismatchError",
    "logo-upload-filter": "logoUploadFilterRejected",
    "logo-unsupported-type": "logoUnsupportedError",
    "logo-invalid-png": "logoInvalidError",
    "logo-invalid-jpeg": "logoInvalidError",
    "logo-invalid-webp": "logoInvalidError",
    "logo-output-size": "logoOutputSizeError",
    "logo-output-invalid": "logoConversionFailed",
    "logo-converter-unavailable": "logoConversionFailed",
    "logo-conversion-failed": "logoConversionFailed",
  }[code] ?? "logoConversionFailed";
  return localize(key, settings);
}

async function loadLogo() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_LOGO" });
    if (!response?.ok) throw new Error("worker");
    logo = response.schoolModeSuppressed ? null : normalizeLogoRecord(response.logo);
    logoSource = logo?.kind === "preset" ? { kind: "preset", presetId: logo.presetId } : { kind: "preset", presetId: "material-stack" };
    stagedLogo = null;
    fillLogoControls(logo);
    renderLogoPreviews(logo);
    elements.logoStatus.textContent = response.cacheState === "corrupt-reset" ? localize("logoCacheReset", settings) : "";
    refreshLogoPresentation();
  } catch {
    logo = null;
    stagedLogo = null;
    fillLogoControls(null);
    renderLogoPreviews(null);
    elements.logoStatus.textContent = localize("serviceWorkerUnavailable", settings);
  }
}

async function saveLogoRecord(record) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_LOGO", logo: record });
    if (!response?.ok) {
      const key = response?.result?.code === "logo-school-mode-hidden"
        ? "logoSchoolModeSuppressed"
        : response?.result?.code === "logo-storage-failed" ? "logoStorageFailed" : "logoInvalidError";
      elements.logoStatus.textContent = localize(key, settings, { name: settings.schoolModeName });
      return false;
    }
    logo = normalizeLogoRecord(response.logo);
    stagedLogo = null;
    fillLogoControls(logo);
    renderLogoPreviews(logo);
    elements.logoStatus.textContent = response.actionUpdated ? localize("logoSaved", settings) : localize("logoSavedActionRetry", settings);
    refreshLogoPresentation();
    return true;
  } catch {
    elements.logoStatus.textContent = localize("serviceWorkerUnavailable", settings);
    return false;
  }
}

function refreshLogoPresetSearch() {
  const query = elements.logoPresetSearch.value.trim();
  let predicate = () => true;
  if (logoPresetRegexMode && query) {
    const validation = validateRegex(elements.logoPresetRegexPattern.value, elements.logoPresetRegexFlags.value);
    if (!validation.valid) {
      elements.logoPresetRegexFeedback.textContent = `${localize("regexInvalid", settings)} ${validation.error}`;
      document.querySelectorAll("[data-logo-preset]").forEach((button) => { button.hidden = true; });
      elements.logoPresetSummary.textContent = localize("searchNoMatches", settings);
      return;
    }
    predicate = (value) => evaluateRegex(elements.logoPresetRegexPattern.value, elements.logoPresetRegexFlags.value, value).matches.length > 0;
  } else if (query) {
    const normalized = query.toLocaleLowerCase();
    predicate = (value) => value.toLocaleLowerCase().includes(normalized);
  }
  let visible = 0;
  LOGO_PRESETS.forEach((preset) => {
    const button = document.querySelector(`[data-logo-preset="${preset.id}"]`);
    if (!button) return;
    const show = predicate(`${preset.id} ${localizeLogoPreset(preset.id)}`);
    button.hidden = !show;
    button.disabled = settings.schoolModeEnabled || !show;
    if (show) visible += 1;
  });
  elements.logoPresetSummary.textContent = query
    ? localize("logoPresetSearchSummary", settings, { visible, total: LOGO_PRESETS.length })
    : "";
  if (!logoPresetRegexMode) elements.logoPresetRegexFeedback.textContent = "";
}

function evaluateLogoPresetRegex() {
  const evaluation = evaluateRegex(elements.logoPresetRegexPattern.value, elements.logoPresetRegexFlags.value, elements.logoPresetRegexSample.value);
  elements.logoPresetRegexMatches.replaceChildren();
  if (!evaluation.valid) {
    elements.logoPresetRegexFeedback.textContent = `${localize("regexInvalid", settings)} ${evaluation.error}`;
    refreshLogoPresetSearch();
    return evaluation;
  }
  elements.logoPresetRegexFeedback.textContent = evaluation.matches.length
    ? localize("regexMatches", settings, { count: evaluation.matches.length })
    : localize("regexNoMatches", settings);
  evaluation.matches.forEach((match) => {
    const item = document.createElement("li");
    const captures = match.captures.length ? ` · captures: ${match.captures.map((capture) => capture ?? "∅").join(", ")}` : "";
    item.textContent = `“${match.text}” at ${match.index}${captures}`;
    elements.logoPresetRegexMatches.append(item);
  });
  refreshLogoPresetSearch();
  return evaluation;
}

function logoFilterPredicate(config) {
  const query = config.search.value.trim();
  if (config.state.mode && query) {
    const validation = validateRegex(config.pattern.value, config.flags.value);
    if (!validation.valid) {
      config.feedback.textContent = `${localize("regexInvalid", settings)} ${validation.error}`;
      return null;
    }
    return (value) => evaluateRegex(config.pattern.value, config.flags.value, value).matches.length > 0;
  }
  if (query) {
    const normalized = query.toLocaleLowerCase();
    return (value) => value.toLocaleLowerCase().includes(normalized);
  }
  if (!config.state.mode) config.feedback.textContent = "";
  return () => true;
}

function evaluateLogoFilterRegex(config, refresh) {
  const evaluation = evaluateRegex(config.pattern.value, config.flags.value, config.sample.value);
  config.matches.replaceChildren();
  if (!evaluation.valid) {
    config.feedback.textContent = `${localize("regexInvalid", settings)} ${evaluation.error}`;
    refresh();
    return evaluation;
  }
  config.feedback.textContent = evaluation.matches.length
    ? localize("regexMatches", settings, { count: evaluation.matches.length })
    : localize("regexNoMatches", settings);
  evaluation.matches.forEach((match) => {
    const item = document.createElement("li");
    const captures = match.captures.length ? ` · captures: ${match.captures.map((capture) => capture ?? "∅").join(", ")}` : "";
    item.textContent = `“${match.text}” at ${match.index}${captures}`;
    config.matches.append(item);
  });
  refresh();
  return evaluation;
}

function wireLogoFilterRegexBuilder(config, refresh) {
  config.search.addEventListener("input", () => {
    if (config.state.mode) config.pattern.value = config.search.value;
    refresh();
  });
  config.toggle.addEventListener("click", () => {
    config.state.open = !config.state.open;
    config.panel.hidden = !config.state.open;
    config.toggle.setAttribute("aria-expanded", String(config.state.open));
    if (config.state.open) config.pattern.focus();
  });
  [config.pattern, config.flags, config.sample].forEach((input) => input.addEventListener("input", () => evaluateLogoFilterRegex(config, refresh)));
  document.querySelectorAll(config.fragmentSelector).forEach((button) => {
    button.addEventListener("click", () => {
      config.pattern.value = appendRegexFragment(config.pattern.value, button.dataset[config.fragmentDataset]);
      config.pattern.focus();
      evaluateLogoFilterRegex(config, refresh);
    });
  });
  config.mode.addEventListener("change", () => {
    config.state.mode = config.mode.checked;
    if (config.state.mode) config.pattern.value = config.search.value;
    refresh();
  });
  config.apply.addEventListener("click", () => {
    const validation = validateRegex(config.pattern.value, config.flags.value);
    if (!validation.valid) { evaluateLogoFilterRegex(config, refresh); return; }
    config.search.value = config.pattern.value;
    config.mode.checked = true;
    config.state.mode = true;
    refresh();
  });
  config.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`/${config.pattern.value}/${config.flags.value}`);
      showToast(localize("regexPatternCopied", settings));
    } catch {
      showToast(localize("copyFailed", settings));
    }
  });
  config.export.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ pattern: config.pattern.value, flags: config.flags.value }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = config.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

const logoUploadFilterRegexConfig = {
  state: logoUploadFilterRegexState,
  search: elements.logoUploadFilterSearch,
  toggle: elements.logoUploadFilterRegexToggle,
  panel: elements.logoUploadFilterRegex,
  pattern: elements.logoUploadFilterRegexPattern,
  flags: elements.logoUploadFilterRegexFlags,
  sample: elements.logoUploadFilterRegexSample,
  feedback: elements.logoUploadFilterRegexFeedback,
  matches: elements.logoUploadFilterRegexMatches,
  mode: elements.logoUploadFilterRegexMode,
  apply: elements.logoUploadFilterRegexApply,
  copy: elements.logoUploadFilterRegexCopy,
  export: elements.logoUploadFilterRegexExport,
  fragmentSelector: "[data-logo-upload-filter-fragment]",
  fragmentDataset: "logoUploadFilterFragment",
  fileName: "material-download-manager-logo-upload-filter-regex.json",
};

const logoColorRegexConfig = {
  state: logoColorRegexState,
  search: elements.logoColorSearch,
  toggle: elements.logoColorRegexToggle,
  panel: elements.logoColorRegex,
  pattern: elements.logoColorRegexPattern,
  flags: elements.logoColorRegexFlags,
  sample: elements.logoColorRegexSample,
  feedback: elements.logoColorRegexFeedback,
  matches: elements.logoColorRegexMatches,
  mode: elements.logoColorRegexMode,
  apply: elements.logoColorRegexApply,
  copy: elements.logoColorRegexCopy,
  export: elements.logoColorRegexExport,
  fragmentSelector: "[data-logo-color-fragment]",
  fragmentDataset: "logoColorFragment",
  fileName: "material-download-manager-logo-color-regex.json",
};

function refreshLogoUploadFilter() {
  const predicate = logoFilterPredicate(logoUploadFilterRegexConfig);
  const query = elements.logoUploadFilterSearch.value.trim();
  let visible = 0;
  elements.logoUploadFormats.forEach((button) => {
    const type = button.dataset.logoUploadFormat;
    const show = predicate ? predicate(`${type} ${button.textContent}`) : false;
    button.hidden = !show;
    button.disabled = settings.schoolModeEnabled || !show;
    button.setAttribute("aria-pressed", String(logoAcceptedUploadTypes.has(type)));
    if (show) visible += 1;
  });
  const selected = [...logoAcceptedUploadTypes];
  elements.logoUpload.accept = selected.join(",");
  elements.logoUpload.disabled = settings.schoolModeEnabled || selected.length === 0;
  elements.logoUploadFilterSummary.textContent = query
    ? localize("logoFilterSearchSummary", settings, { visible, total: elements.logoUploadFormats.length })
    : selected.length ? localize("logoUploadFilterSelected", settings, { count: selected.length }) : localize("logoUploadFilterEmpty", settings);
}

function refreshLogoColorSearchSummary(visible, total) {
  const query = elements.logoColorSearch.value.trim();
  elements.logoColorSearchSummary.textContent = query
    ? localize("logoFilterSearchSummary", settings, { visible, total })
    : "";
}

function formatAuthenticatorSecret(value) {
  return String(value ?? "").replace(/(.{4})/gu, "$1 ").trim();
}

function createGeneratedSecret() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let buffer = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31];
  bytes.fill(0);
  return result;
}

function authenticatorFormInput() {
  const uri = elements.authenticatorUri.value.trim();
  if (uri) return { uri };
  return {
    issuer: elements.authenticatorIssuer.value,
    account: elements.authenticatorAccount.value,
    secret: elements.authenticatorSecret.value,
    algorithm: elements.authenticatorAlgorithm.value,
    digits: Number(elements.authenticatorDigits.value),
    period: Number(elements.authenticatorPeriod.value),
  };
}

function pendingAuthenticatorInput() {
  if (!pendingAuthenticator) return null;
  return {
    issuer: pendingAuthenticator.issuer,
    account: pendingAuthenticator.account,
    secret: pendingAuthenticator.secret,
    algorithm: pendingAuthenticator.algorithm,
    digits: pendingAuthenticator.digits,
    period: pendingAuthenticator.period,
  };
}

function clearPendingAuthenticator() {
  pendingAuthenticator = null;
  elements.authenticatorPairingCard.hidden = true;
  elements.authenticatorQr.replaceChildren();
  elements.authenticatorManualSecret.hidden = true;
  elements.authenticatorManualSecret.textContent = "";
  elements.authenticatorRevealSecret.hidden = false;
  elements.authenticatorRevealSecret.textContent = localize("authenticatorRevealSecret", settings);
  elements.authenticatorRevealSecret.dataset.revealed = "false";
  elements.authenticatorCopySecret.hidden = true;
  elements.authenticatorPairingCode.value = "";
  elements.authenticatorPairingFacts.textContent = "";
  elements.authenticatorPairingError.textContent = "";
  elements.authenticatorQrStatus.textContent = "";
  elements.authenticatorQr.removeAttribute("data-status");
}

function renderAuthenticatorPairing(model) {
  pendingAuthenticator = model;
  elements.authenticatorPairingCard.hidden = false;
  elements.authenticatorPairingFacts.textContent = localize("authenticatorCodeFacts", settings, {
    issuer: model.issuer,
    account: model.account,
    algorithm: model.algorithm,
    digits: model.digits,
    period: model.period,
  });
  try {
    const matrix = createQrMatrix(model.otpauthUri);
    elements.authenticatorQr.innerHTML = qrMatrixToSvg(matrix, localize("authenticatorPairingHeading", settings));
    elements.authenticatorQrStatus.textContent = localize("authenticatorQrRendered", settings);
  } catch {
    elements.authenticatorQr.dataset.status = "unavailable";
    elements.authenticatorQr.textContent = localize("authenticatorQrUnavailable", settings);
    elements.authenticatorQrStatus.textContent = localize("authenticatorQrUnavailable", settings);
  }
  if (activeTab === "authenticator") elements.authenticatorPairingCard.scrollIntoView?.({ block: "nearest" });
}

function refreshAuthenticatorPresentation() {
  const revealed = pendingAuthenticator && !elements.authenticatorManualSecret.hidden;
  renderAuthenticatorList();
  if (!pendingAuthenticator) return;
  renderAuthenticatorPairing(pendingAuthenticator);
  if (revealed) {
    elements.authenticatorManualSecret.textContent = formatAuthenticatorSecret(pendingAuthenticator.manualSecret);
    elements.authenticatorManualSecret.hidden = false;
    elements.authenticatorCopySecret.hidden = false;
    elements.authenticatorRevealSecret.textContent = localize("authenticatorHideSecret", settings);
    elements.authenticatorRevealSecret.dataset.revealed = "true";
  }
}

function authenticatorMetadataSearchText(item) {
  return `${item.issuer} ${item.account} ${item.algorithm} ${item.digits} ${item.period}`;
}

function renderAuthenticatorList() {
  const query = elements.authenticatorListSearch.value.trim();
  const pattern = elements.authenticatorListRegexPattern.value;
  const flags = elements.authenticatorListRegexFlags.value;
  let predicate = () => true;
  let visible = authenticatorMetadata;
  if (authenticatorListRegexMode && pattern) {
    const validation = validateRegex(pattern, flags);
    if (!validation.valid) {
      elements.authenticatorListRegexFeedback.textContent = `${localize("regexInvalid", settings)} ${validation.error}`;
      visible = [];
    } else {
      predicate = (value) => evaluateRegex(pattern, flags, value).matches.length > 0;
      visible = authenticatorMetadata.filter((item) => predicate(authenticatorMetadataSearchText(item)));
      elements.authenticatorListRegexFeedback.textContent = localize("regexMatches", settings, { count: visible.length });
    }
  } else if (query) {
    const normalized = query.toLocaleLowerCase();
    visible = authenticatorMetadata.filter((item) => authenticatorMetadataSearchText(item).toLocaleLowerCase().includes(normalized));
    elements.authenticatorListRegexFeedback.textContent = "";
  } else {
    elements.authenticatorListRegexFeedback.textContent = "";
  }
  elements.authenticatorList.replaceChildren();
  elements.authenticatorListSummary.textContent = localize("authenticatorListSummary", settings, {
    visible: visible.length,
    total: authenticatorMetadata.length,
    suffix: visible.length === 1 ? "y" : "ies",
  });
  if (authenticatorMetadata.length === 0) {
    const empty = document.createElement("li");
    empty.className = "authenticator-empty";
    empty.textContent = localize("authenticatorNoEntries", settings);
    elements.authenticatorList.append(empty);
    return;
  }
  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "authenticator-empty";
    empty.textContent = localize("authenticatorNoMatches", settings);
    elements.authenticatorList.append(empty);
    return;
  }
  for (const item of visible) {
    const row = document.createElement("li");
    row.className = "authenticator-list-item";
    row.dataset.authenticatorId = item.id;
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.issuer;
    const account = document.createElement("span");
    account.textContent = item.account;
    const facts = document.createElement("small");
    facts.textContent = localize("authenticatorCodeFacts", settings, item);
    details.append(title, account, facts);
    const codeRow = document.createElement("div");
    codeRow.className = "authenticator-code-row";
    const code = document.createElement("span");
    code.className = "authenticator-code";
    code.dataset.authenticatorCode = item.id;
    code.textContent = "—";
    code.setAttribute("aria-label", localize("authenticatorCurrentCode", settings, { code: localize("authenticatorUnavailableValue", settings) }));
    const countdown = document.createElement("span");
    countdown.className = "authenticator-countdown";
    countdown.dataset.authenticatorCountdown = item.id;
    countdown.textContent = "";
    const next = document.createElement("span");
    next.className = "authenticator-countdown";
    next.dataset.authenticatorNext = item.id;
    next.textContent = "";
    codeRow.append(code, countdown, next);
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.textContent = localize("authenticatorRemove", settings);
    remove.addEventListener("click", () => openAuthenticatorRemoval(item.id, remove));
    actions.append(remove);
    row.append(details, codeRow, actions);
    elements.authenticatorList.append(row);
  }
  void refreshAuthenticatorCodes();
}

async function refreshAuthenticatorCodes() {
  if (activeTab !== "authenticator" || authenticatorCodeRefreshInFlight) return;
  authenticatorCodeRefreshInFlight = true;
  try {
    for (const item of authenticatorMetadata) {
      if (activeTab !== "authenticator") return;
      const codeElement = document.querySelector(`[data-authenticator-code="${CSS.escape(item.id)}"]`);
      const countdownElement = document.querySelector(`[data-authenticator-countdown="${CSS.escape(item.id)}"]`);
      const nextElement = document.querySelector(`[data-authenticator-next="${CSS.escape(item.id)}"]`);
      if (!codeElement || !countdownElement || !nextElement) continue;
      try {
        const response = await chrome.runtime.sendMessage({ type: "GET_AUTHENTICATOR_CODE", id: item.id });
        if (activeTab !== "authenticator") return;
        const value = response?.result;
        if (response?.ok && value?.ok) {
          codeElement.textContent = value.code;
          codeElement.setAttribute("aria-label", localize("authenticatorCurrentCode", settings, { code: value.code }));
          countdownElement.textContent = localize("authenticatorCountdown", settings, { seconds: value.remainingSeconds });
          nextElement.textContent = localize("authenticatorCodeNext", settings, { code: value.nextCode });
        } else {
          codeElement.textContent = "—";
          codeElement.setAttribute("aria-label", localize("authenticatorCurrentCode", settings, { code: localize("authenticatorUnavailableValue", settings) }));
          countdownElement.textContent = localize("authenticatorCodeUnavailable", settings);
          nextElement.textContent = "";
        }
      } catch {
        if (activeTab !== "authenticator") return;
        codeElement.textContent = "—";
        codeElement.setAttribute("aria-label", localize("authenticatorCurrentCode", settings, { code: localize("authenticatorUnavailableValue", settings) }));
        countdownElement.textContent = localize("authenticatorCodeUnavailable", settings);
        nextElement.textContent = "";
      }
    }
  } finally {
    authenticatorCodeRefreshInFlight = false;
  }
}

function startAuthenticatorCodeTimer() {
  if (authenticatorCodeTimer !== null) clearInterval(authenticatorCodeTimer);
  authenticatorCodeTimer = setInterval(() => { void refreshAuthenticatorCodes(); }, 1000);
  void refreshAuthenticatorCodes();
}

async function loadAuthenticatorState() {
  if (authenticatorStateLoadInFlight) return;
  authenticatorStateLoadInFlight = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_AUTHENTICATOR_STATE" });
    if (!response?.ok) throw new Error("authenticator-storage");
    authenticatorMetadata = Array.isArray(response?.result?.metadata) ? response.result.metadata : [];
    renderAuthenticatorList();
    startAuthenticatorCodeTimer();
  } catch {
    authenticatorMetadata = [];
    renderAuthenticatorList();
    elements.authenticatorListStatus.textContent = localize("serviceWorkerUnavailable", settings);
  } finally {
    authenticatorStateLoadInFlight = false;
  }
}

function closeAuthenticatorRemoval({ restoreFocus = true } = {}) {
  const trigger = pendingAuthenticatorRemoval?.trigger;
  pendingAuthenticatorRemoval = null;
  elements.authenticatorRemoveCard.hidden = true;
  elements.authenticatorRemoveCard.removeAttribute("data-state");
  elements.authenticatorRemoveKeyOne.value = "";
  elements.authenticatorRemoveKeyTwo.value = "";
  elements.authenticatorRemoveSlider.value = "0";
  elements.authenticatorRemoveConfirm.disabled = true;
  elements.authenticatorRemoveStatus.textContent = "";
  if (restoreFocus) trigger?.focus();
}

function updateAuthenticatorRemovalGate() {
  const target = pendingAuthenticatorRemoval;
  if (!target) return;
  const keysMatch = elements.authenticatorRemoveKeyOne.value.trim() === target.item.issuer
    && elements.authenticatorRemoveKeyTwo.value.trim() === target.item.account;
  const sliderComplete = Number(elements.authenticatorRemoveSlider.value) === 100;
  const sliderMoving = Number(elements.authenticatorRemoveSlider.value) > 0;
  elements.authenticatorRemoveConfirm.disabled = !(keysMatch && sliderComplete);
  elements.authenticatorRemoveCard.dataset.state = keysMatch || sliderMoving ? "arming" : "idle";
  elements.authenticatorRemoveStatus.textContent = keysMatch
    ? localize("authenticatorRemoveReady", settings)
    : localize("authenticatorRemoveIncomplete", settings);
}

function openAuthenticatorRemoval(id, trigger) {
  const item = authenticatorMetadata.find((candidate) => candidate.id === id);
  if (!item) return;
  pendingAuthenticatorRemoval = { id, item, trigger };
  elements.authenticatorRemoveTarget.textContent = `${item.issuer} · ${item.account}`;
  elements.authenticatorRemoveCard.hidden = false;
  elements.authenticatorRemoveKeyOne.value = "";
  elements.authenticatorRemoveKeyTwo.value = "";
  elements.authenticatorRemoveSlider.value = "0";
  updateAuthenticatorRemovalGate();
  elements.authenticatorRemoveKeyOne.focus();
}

async function removeAuthenticator() {
  const target = pendingAuthenticatorRemoval;
  if (!target || elements.authenticatorRemoveConfirm.disabled) return;
  elements.authenticatorRemoveConfirm.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "REMOVE_AUTHENTICATOR", id: target.id });
    if (response?.ok) {
      authenticatorMetadata = authenticatorMetadata.filter((item) => item.id !== target.id);
      elements.authenticatorRemoveCard.dataset.state = "completed";
      elements.authenticatorRemoveStatus.textContent = localize("authenticatorRemoveCompleted", settings);
      renderAuthenticatorList();
      showToast(localize("authenticatorRemoved", settings));
      window.setTimeout(() => closeAuthenticatorRemoval(), 420);
    } else {
      elements.authenticatorRemoveStatus.textContent = response?.result?.code === "authenticator-storage-corrupt"
        ? localize("authenticatorStorageCorrupt", settings)
        : localize("authenticatorStorageFailed", settings);
      updateAuthenticatorRemovalGate();
    }
  } catch {
    elements.authenticatorRemoveStatus.textContent = localize("authenticatorStorageFailed", settings);
    updateAuthenticatorRemovalGate();
  }
}

[elements.authenticatorRemoveKeyOne, elements.authenticatorRemoveKeyTwo, elements.authenticatorRemoveSlider].forEach((control) => {
  control.addEventListener("input", updateAuthenticatorRemovalGate);
});
elements.authenticatorRemoveConfirm.addEventListener("click", () => void removeAuthenticator());
elements.authenticatorRemoveCancel.addEventListener("click", () => closeAuthenticatorRemoval());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pendingAuthenticatorRemoval) {
    event.preventDefault();
    closeAuthenticatorRemoval();
  }
});

function fillForm() {
  elements.endpoint.value = settings.handoffEndpoint;
  elements.autoCaptureDownloads.checked = settings.autoCaptureDownloads;
  elements.managerDisplayName.value = settings.managerName;
  elements.schoolMode.checked = settings.schoolModeEnabled;
  elements.schoolModeName.value = settings.schoolModeName;
  elements.showEmojis.checked = settings.showEmojis;
  elements.narratorEnabled.checked = settings.narratorEnabled;
  elements.narratorLanguage.value = settings.narratorLanguage;
  elements.narratorSoundMode.value = settings.narratorSoundMode;
  elements.narratorQuietMode.checked = settings.narratorQuietMode;
  elements.narratorRespectReducedMotion.checked = settings.narratorRespectReducedMotion;
  elements.languageMode.value = settings.languageMode;
  elements.funnyEn.value = String(settings.funnyLevelEn);
  elements.funnyYue.value = String(settings.funnyLevelYue);
  localizePage();
  updateConnectionState();
}

function collectFormSettings() {
  let narratorReducedMotionActive = false;
  try {
    narratorReducedMotionActive = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    narratorReducedMotionActive = false;
  }
  return sanitizeSettings({
    ...settings,
    handoffEndpoint: elements.endpoint.value,
    autoCaptureDownloads: elements.autoCaptureDownloads.checked,
    managerName: elements.managerDisplayName.value,
    schoolModeEnabled: elements.schoolMode.checked,
    schoolModeName: elements.schoolModeName.value,
    showEmojis: elements.showEmojis.checked,
    narratorEnabled: elements.narratorEnabled.checked,
    narratorLanguage: elements.narratorLanguage.value,
    narratorSoundMode: elements.narratorSoundMode.value,
    narratorQuietMode: elements.narratorQuietMode.checked,
    narratorRespectReducedMotion: elements.narratorRespectReducedMotion.checked,
    narratorReducedMotionActive,
    languageMode: elements.languageMode.value,
    funnyLevelEn: Number(elements.funnyEn.value),
    funnyLevelYue: Number(elements.funnyYue.value),
  });
}

function markDirty() {
  elements.dirtyState.textContent = localize("settingsUnsaved", settings);
}

function showToast(text) {
  elements.toast.textContent = decorateMessage(text, settings);
}

function resultMessage(value) {
  const key = {
    "handoff-success": "handoffSuccess",
    "handoff-cleanup-warning": "handoffCleanupWarning",
    "automatic-pause-failed": "automaticPauseFailed",
    "automatic-capacity-full": "automaticCapacityFull",
    "automatic-resumed-failed": "automaticResumedFailed",
    "automatic-resume-failed": "automaticResumeFailed",
    "automatic-cancel-failed-resumed": "automaticCancelFailedResumed",
    "automatic-cancel-failed-original-gone": "automaticCancelFailedOriginalGone",
    "automatic-cancel-failed-already-running": "automaticCancelFailedAlreadyRunning",
    "automatic-cancel-recovery-failed": "automaticCancelRecoveryFailed",
    "automatic-original-gone": "automaticOriginalGone",
    "automatic-original-already-running": "automaticOriginalAlreadyRunning",
    "automatic-ownership-mismatch": "automaticOwnershipMismatch",
    "automatic-restart-resume-failed": "automaticRestartResumeFailed",
    "handoff-disabled": "handoffDisabled",
    "handoff-unpaired": "handoffUnpaired",
    "handoff-failed": "handoffFailed",
    "connection-success": "connectionSuccess",
    "connection-disabled": "connectionDisabled",
    "connection-unpaired": "connectionUnpaired",
    "connection-failed": "connectionFailed",
    "settings-saved": "settingsSaved",
    "settings-imported": "settingsImported",
    "settings-exported": "settingsExported",
    "school-mode-reset-unavailable": "schoolModeCredentialUnavailable",
    "display-name-history-unavailable": "displayNameHistoryUnavailable",
    "settings-save-failed": "settingsSaveFailed",
    "narrator-test-queued": "narratorTestQueued",
    "narrator-disabled": "narratorDisabled",
    "narrator-suppressed": "narratorSuppressed",
    "narrator-queue-full": "narratorQueueFull",
    "narrator-unavailable": "narratorUnavailable",
    "authenticator-storage-corrupt": "authenticatorStorageCorrupt",
    "authenticator-browser-secret-unavailable": "authenticatorBrowserSecretUnavailable",
    "authenticator-code-unavailable": "authenticatorCodeUnavailable",
    "authenticator-storage-failed": "authenticatorStorageFailed",
    "authenticator-invalid-registration": "authenticatorInvalidRegistration",
    "authenticator-capacity-full": "authenticatorCapacityFull",
    "authenticator-id-collision": "authenticatorIdCollision",
    "authenticator-code-mismatch": "authenticatorCodeMismatch",
    "authenticator-not-found": "authenticatorNotFound",
    "authenticator-metadata-export": "authenticatorMetadataExported",
  }[value?.code] ?? "handoffFailed";
  return localize(key, settings, { detail: value?.detail ?? "", name: settings.schoolModeName });
}

function updateConnectionState(value = null) {
  elements.recoveryCard.hidden = Boolean(settings.handoffEndpoint);
  if (value) {
    elements.connectionStatus.textContent = resultMessage(value);
  } else if (!settings.handoffEndpoint) {
    elements.connectionStatus.textContent = localize("connectionDisabled", settings);
  } else {
    elements.connectionStatus.textContent = localize("readyBody", settings);
  }
}

function applyTab(nextTab) {
  activeTab = nextTab;
  document.querySelectorAll("[role=tab]").forEach((tab) => {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[role=tabpanel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== activeTab;
  });
  if (activeTab === "authenticator") {
    void loadAuthenticatorState();
    startAuthenticatorCodeTimer();
    void refreshAuthenticatorCodes();
  }
}

function activateAdjacentTab(direction) {
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.tab === activeTab);
  const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  applyTab(next.dataset.tab);
  next.focus();
}

function refreshSearch() {
  const query = elements.search.value.trim();
  const cards = [...document.querySelectorAll(".setting-card[data-search]")];
  let predicate = () => true;
  if (query && elements.regexMode.checked) {
    const validation = validateRegex(elements.regexPattern.value, elements.regexFlags.value);
    if (!validation.valid) {
      elements.searchSummary.textContent = `${localize("regexInvalid", settings)} ${validation.error}`;
      cards.forEach((card) => { card.hidden = true; });
      return;
    }
    predicate = (value) => {
      const evaluation = evaluateRegex(elements.regexPattern.value, elements.regexFlags.value, value);
      return evaluation.valid && evaluation.matches.length > 0;
    };
  } else if (query) {
    const normalized = query.toLocaleLowerCase();
    predicate = (value) => value.toLocaleLowerCase().includes(normalized);
  }

  const matches = [];
  cards.forEach((card) => {
    if (settings.schoolModeEnabled && card.dataset.schoolHidden !== undefined) {
      card.hidden = true;
      return;
    }
    const value = `${card.dataset.search} ${card.textContent} ${settings.managerName} ${settings.handoffEndpoint}`;
    const isMatch = predicate(value);
    card.hidden = !isMatch;
    if (isMatch && query) matches.push(card);
  });

  if (!query) {
    elements.searchSummary.textContent = "";
    return;
  }
  if (matches.length === 0) {
    elements.searchSummary.textContent = localize("searchNoMatches", settings);
    return;
  }
  const panelLabel = (card) => {
    const panel = card.closest("[role=tabpanel]");
    return panel ? document.querySelector(`[aria-controls="${panel.id}"]`)?.textContent?.trim() ?? panel.dataset.panel : "";
  };
  const tabs = [...new Set(matches.map(panelLabel).filter(Boolean))];
  const activePanelLabel = document.querySelector(`[aria-controls="panel-${activeTab}"]`)?.textContent?.trim();
  const otherTabs = tabs.filter((label) => label !== activePanelLabel);
  const tabNote = otherTabs.length ? ` ${localize("searchOtherTabs", settings, { tabs: otherTabs.join(", ") })}` : "";
  elements.searchSummary.textContent = `${localize("searchMatchCount", settings, { count: matches.length })}${tabNote}`;
}

function evaluateRegexBuilder() {
  const evaluation = evaluateRegex(elements.regexPattern.value, elements.regexFlags.value, elements.regexSample.value);
  elements.regexMatches.replaceChildren();
  if (!evaluation.valid) {
    elements.regexFeedback.textContent = `${localize("regexInvalid", settings)} ${evaluation.error}`;
    refreshSearch();
    return evaluation;
  }
  elements.regexFeedback.textContent = evaluation.matches.length
    ? localize("regexMatches", settings, { count: evaluation.matches.length })
    : localize("regexNoMatches", settings);
  evaluation.matches.forEach((match) => {
    const item = document.createElement("li");
    const captures = match.captures.length ? ` · captures: ${match.captures.map((capture) => capture ?? "∅").join(", ")}` : "";
    item.textContent = `“${match.text}” at ${match.index}${captures}`;
    elements.regexMatches.append(item);
  });
  refreshSearch();
  return evaluation;
}

async function persistSettings(messageKey = "settingsSaved") {
  const endpoint = validateEndpoint(elements.endpoint.value);
  elements.endpointError.textContent = endpoint.valid ? "" : endpoint.error;
  if (!endpoint.valid) return false;
  const previousManagerName = settings.managerName;
  settings = collectFormSettings();
  try {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    if (!response?.ok) {
      showToast(response?.result ? resultMessage(response.result) : localize("settingsSaveFailed", settings));
      await loadState();
      return false;
    }
    settings = sanitizeSettings(response.settings);
    fillForm();
    refreshSearch();
    const message = previousManagerName !== settings.managerName
      ? localize("displayNameHistoryRecorded", settings)
      : localize(messageKey, settings);
    showToast(message);
    return true;
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
    return false;
  }
}

async function loadState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok) throw new Error("worker");
    settings = sanitizeSettings(response?.settings ?? DEFAULT_SETTINGS);
    fillForm();
    updateConnectionState(response?.lastResult);
    refreshSearch();
    await loadLogo();
    await loadAuthenticatorState();
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
    fillForm();
    await loadLogo();
    await loadAuthenticatorState();
  }
}

document.querySelectorAll("[role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => applyTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); activateAdjacentTab(1); }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); activateAdjacentTab(-1); }
    if (event.key === "Home") { event.preventDefault(); applyTab("connection"); document.querySelector("#tab-connection").focus(); }
    if (event.key === "End") { event.preventDefault(); applyTab("help"); document.querySelector("#tab-help").focus(); }
  });
});

elements.regexToggle.addEventListener("click", () => {
  const open = elements.regexBuilder.hidden;
  elements.regexBuilder.hidden = !open;
  elements.regexToggle.setAttribute("aria-expanded", String(open));
  if (open) elements.regexPattern.focus();
});

document.querySelectorAll("[data-fragment]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.regexPattern.value = appendRegexFragment(elements.regexPattern.value, button.dataset.fragment);
    elements.regexPattern.focus();
    evaluateRegexBuilder();
  });
});

[elements.regexPattern, elements.regexFlags, elements.regexSample].forEach((input) => input.addEventListener("input", evaluateRegexBuilder));
elements.regexMode.addEventListener("change", () => {
  if (elements.regexMode.checked) elements.regexPattern.value = elements.search.value;
  refreshSearch();
});
elements.search.addEventListener("input", () => {
  if (elements.regexMode.checked) elements.regexPattern.value = elements.search.value;
  refreshSearch();
});
elements.regexApply.addEventListener("click", () => {
  const evaluation = validateRegex(elements.regexPattern.value, elements.regexFlags.value);
  if (!evaluation.valid) { evaluateRegexBuilder(); return; }
  elements.search.value = elements.regexPattern.value;
  elements.regexMode.checked = true;
  refreshSearch();
});
elements.regexCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`/${elements.regexPattern.value}/${elements.regexFlags.value}`);
    showToast(localize("regexPatternCopied", settings));
  } catch {
    showToast(localize("copyFailed", settings));
  }
});
elements.regexExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ pattern: elements.regexPattern.value, flags: elements.regexFlags.value }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-download-manager-regex.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

elements.endpoint.addEventListener("input", () => {
  const validation = validateEndpoint(elements.endpoint.value);
  elements.endpointError.textContent = validation.valid ? "" : validation.error;
  markDirty();
});
elements.useDefaultEndpoint.addEventListener("click", () => {
  elements.endpoint.value = DEFAULT_SETTINGS.handoffEndpoint;
  elements.endpointError.textContent = "";
  settings = collectFormSettings();
  updateConnectionState();
  markDirty();
});
[elements.autoCaptureDownloads, elements.managerDisplayName, elements.schoolMode, elements.schoolModeName, elements.showEmojis, elements.narratorEnabled, elements.narratorLanguage, elements.narratorSoundMode, elements.narratorQuietMode, elements.narratorRespectReducedMotion, elements.languageMode, elements.funnyEn, elements.funnyYue].forEach((input) => {
  input.addEventListener("input", () => {
    settings = collectFormSettings();
    localizePage();
    markDirty();
    updateConnectionState();
    refreshSearch();
  });
});
elements.testNarration.addEventListener("click", async () => {
  const saved = await persistSettings();
  if (!saved) return;
  elements.testNarration.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_NARRATION" });
    const value = response?.result ?? { code: "narrator-unavailable" };
    elements.narratorStatus.textContent = resultMessage(value);
    showToast(resultMessage(value));
  } catch {
    elements.narratorStatus.textContent = localize("narratorUnavailable", settings);
    showToast(localize("narratorUnavailable", settings));
  } finally {
    elements.testNarration.disabled = false;
  }
});
elements.resetManagerName.addEventListener("click", () => {
  elements.managerDisplayName.value = DEFAULT_SETTINGS.managerName;
  settings = collectFormSettings();
  localizePage();
  markDirty();
});
elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await persistSettings();
});
elements.testConnection.addEventListener("click", async () => {
  const saved = await persistSettings();
  if (!saved) return;
  if (!settings.handoffEndpoint) {
    updateConnectionState({ code: "connection-disabled" });
    return;
  }
  elements.testConnection.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_HANDOFF" });
    if (!response?.ok) throw new Error("worker");
    updateConnectionState(response.result);
  } catch {
    showToast(localize("serviceWorkerUnavailable", settings));
  } finally {
    elements.testConnection.disabled = false;
  }
});

elements.exportSettings.addEventListener("click", () => {
  settings = collectFormSettings();
  const blob = new Blob([JSON.stringify(makeSettingsExport(settings), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-download-manager-extension-settings.json";
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(localize("settingsExported", settings));
});
elements.importSettings.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    const parsed = parseSettingsExport(JSON.parse(await file.text()));
    settings = parsed;
    fillForm();
    const saved = await persistSettings("settingsImported");
    if (saved) showToast(localize("settingsImported", settings));
  } catch (error) {
    showToast(error instanceof Error ? error.message : localize("handoffFailed", settings));
  } finally {
    elements.importFile.value = "";
  }
});
  elements.resetSettings.addEventListener("click", async () => {
  settings = sanitizeSettings(DEFAULT_SETTINGS);
  fillForm();
  await persistSettings("settingsReset");
});

elements.authenticatorGenerateSecret.addEventListener("click", () => {
  elements.authenticatorUri.value = "";
  elements.authenticatorSecret.value = createGeneratedSecret();
  elements.authenticatorSecret.focus();
  elements.authenticatorRegisterError.textContent = "";
});

elements.authenticatorParseUri.addEventListener("click", () => {
  try {
    const registration = parseTotpUri(elements.authenticatorUri.value.trim());
    elements.authenticatorIssuer.value = registration.issuer;
    elements.authenticatorAccount.value = registration.account;
    elements.authenticatorSecret.value = registration.secret;
    elements.authenticatorAlgorithm.value = registration.algorithm;
    elements.authenticatorDigits.value = String(registration.digits);
    elements.authenticatorPeriod.value = String(registration.period);
    elements.authenticatorUri.value = "";
    elements.authenticatorRegisterError.textContent = "";
    showToast(localize("authenticatorPrepared", settings));
  } catch {
    elements.authenticatorRegisterError.textContent = localize("authenticatorInvalidRegistration", settings);
  }
});

elements.authenticatorPrepare.addEventListener("click", async () => {
  elements.authenticatorRegisterError.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({ type: "PREPARE_AUTHENTICATOR", input: authenticatorFormInput() });
    if (!response?.ok || !response.result?.kind) throw new Error("invalid");
    renderAuthenticatorPairing(response.result);
    // The one-time model now lives only in this page's memory. Clear input
    // controls so a later settings export or DOM inspection cannot reuse it.
    elements.authenticatorUri.value = "";
    elements.authenticatorSecret.value = "";
    showToast(localize("authenticatorPrepared", settings));
  } catch {
    elements.authenticatorRegisterError.textContent = localize("authenticatorInvalidRegistration", settings);
  }
});

elements.authenticatorRevealSecret.addEventListener("click", () => {
  if (!pendingAuthenticator) return;
  const reveal = elements.authenticatorManualSecret.hidden;
  if (reveal) {
    elements.authenticatorManualSecret.textContent = formatAuthenticatorSecret(pendingAuthenticator.manualSecret);
    elements.authenticatorManualSecret.hidden = false;
    elements.authenticatorCopySecret.hidden = false;
    elements.authenticatorRevealSecret.textContent = localize("authenticatorHideSecret", settings);
    elements.authenticatorRevealSecret.dataset.revealed = "true";
  } else {
    elements.authenticatorManualSecret.hidden = true;
    elements.authenticatorManualSecret.textContent = "";
    elements.authenticatorCopySecret.hidden = true;
    elements.authenticatorRevealSecret.textContent = localize("authenticatorRevealSecret", settings);
    elements.authenticatorRevealSecret.dataset.revealed = "false";
  }
});

elements.authenticatorCopySecret.addEventListener("click", async () => {
  if (!pendingAuthenticator) return;
  try {
    await navigator.clipboard.writeText(pendingAuthenticator.manualSecret);
    showToast(localize("authenticatorCopySecret", settings));
  } catch {
    showToast(localize("copyFailed", settings));
  }
});

elements.authenticatorConfirm.addEventListener("click", async () => {
  const input = pendingAuthenticatorInput();
  const code = elements.authenticatorPairingCode.value.trim();
  if (!input || !/^(?:\d{6}|\d{8})$/u.test(code)) {
    elements.authenticatorPairingError.textContent = localize("authenticatorInvalidRegistration", settings);
    return;
  }
  elements.authenticatorPairingError.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({ type: "CONFIRM_AUTHENTICATOR", input, code });
    if (!response?.ok || !response.result?.ok) {
      elements.authenticatorPairingError.textContent = resultMessage(response?.result ?? { code: "authenticator-storage-failed" });
      return;
    }
    clearPendingAuthenticator();
    await loadAuthenticatorState();
    showToast(localize("authenticatorStored", settings));
  } catch {
    elements.authenticatorPairingError.textContent = localize("authenticatorStorageFailed", settings);
  }
});

elements.authenticatorCancel.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CANCEL_AUTHENTICATOR" }).catch(() => {});
  clearPendingAuthenticator();
});

elements.authenticatorListSearch.addEventListener("input", () => {
  if (authenticatorListRegexMode) elements.authenticatorListRegexPattern.value = elements.authenticatorListSearch.value;
  renderAuthenticatorList();
});
elements.authenticatorListRegexToggle.addEventListener("click", () => {
  authenticatorListRegexOpen = !authenticatorListRegexOpen;
  elements.authenticatorListRegex.hidden = !authenticatorListRegexOpen;
  elements.authenticatorListRegexToggle.setAttribute("aria-expanded", String(authenticatorListRegexOpen));
  if (authenticatorListRegexOpen) elements.authenticatorListRegexPattern.focus();
});
[elements.authenticatorListRegexPattern, elements.authenticatorListRegexFlags, elements.authenticatorListRegexSample].forEach((input) => input.addEventListener("input", () => {
  const evaluation = evaluateRegex(elements.authenticatorListRegexPattern.value, elements.authenticatorListRegexFlags.value, elements.authenticatorListRegexSample.value);
  elements.authenticatorListRegexMatches.replaceChildren();
  if (!evaluation.valid) {
    elements.authenticatorListRegexFeedback.textContent = `${localize("regexInvalid", settings)} ${evaluation.error}`;
  } else {
    elements.authenticatorListRegexFeedback.textContent = evaluation.matches.length ? localize("regexMatches", settings, { count: evaluation.matches.length }) : localize("regexNoMatches", settings);
    evaluation.matches.forEach((match) => {
      const item = document.createElement("li");
      const captures = match.captures.length ? ` · captures: ${match.captures.map((capture) => capture ?? "∅").join(", ")}` : "";
      item.textContent = `“${match.text}” at ${match.index}${captures}`;
      elements.authenticatorListRegexMatches.append(item);
    });
  }
  renderAuthenticatorList();
}));
document.querySelectorAll("[data-authenticator-fragment]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.authenticatorListRegexPattern.value = appendRegexFragment(elements.authenticatorListRegexPattern.value, button.dataset.authenticatorFragment);
    elements.authenticatorListRegexPattern.focus();
    elements.authenticatorListRegexPattern.dispatchEvent(new Event("input"));
  });
});

elements.logoFocusSearch.addEventListener("click", () => {
    applyTab("appearance");
    elements.search.value = "logo";
    refreshSearch();
    elements.search.focus();
  });
  document.querySelectorAll("[data-logo-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.hidden || settings.schoolModeEnabled) return;
      logoSource = { kind: "preset", presetId: button.dataset.logoPreset };
      stagedLogo = null;
      refreshLogoPresentation();
      scheduleLogoPreview();
    });
  });
  elements.logoApplyPreset.addEventListener("click", async () => {
    if (settings.schoolModeEnabled) return;
    elements.logoApplyPreset.disabled = true;
    try {
      const record = await createPresetLogoRecord(logoSource.presetId ?? "material-stack", logoControls());
      await saveLogoRecord(record);
    } catch (error) {
      elements.logoStatus.textContent = logoErrorMessage(error);
    } finally {
      refreshLogoPresentation();
    }
  });
  elements.logoUpload.addEventListener("change", async () => {
    const file = elements.logoUpload.files?.[0];
    if (!file || settings.schoolModeEnabled) return;
    try {
      if (file.size > LOGO_LIMITS.inputBytes) {
        const error = new Error("logo-file-size");
        error.code = "logo-file-size";
        throw error;
      }
      const inspection = inspectLogoBytes(new Uint8Array(await file.arrayBuffer()));
      if (!logoAcceptedUploadTypes.has(inspection.type)) {
        const error = new Error("logo-upload-filter");
        error.code = "logo-upload-filter";
        throw error;
      }
      stagedLogo = { source: file, record: null, status: localize("logoFileSelected", settings) };
      elements.logoUploadStatus.textContent = stagedLogo.status;
      updateLogoControlOutputs();
      scheduleLogoPreview();
    } catch (error) {
      stagedLogo = null;
      elements.logoUploadStatus.textContent = logoErrorMessage(error);
      updateLogoControlOutputs();
    } finally {
      elements.logoUpload.value = "";
    }
  });
  [...elements.logoFitOptions, elements.logoCropZoom, elements.logoFocalX, elements.logoFocalY].forEach((control) => {
    control.addEventListener("input", () => {
      updateLogoControlOutputs();
      scheduleLogoPreview();
    });
    control.addEventListener("change", () => {
      updateLogoControlOutputs();
      scheduleLogoPreview();
    });
  });
  elements.logoTransparentBackground.addEventListener("change", () => {
    updateLogoControlOutputs();
    renderLogoColorTranslations();
    scheduleLogoPreview();
  });
  elements.logoBackground.addEventListener("input", () => {
    elements.logoColorValue.value = logoBackgroundWithAlpha().toUpperCase();
    renderLogoColorTranslations();
    scheduleLogoPreview();
  });
  elements.logoBackgroundAlpha.addEventListener("input", () => {
    updateLogoControlOutputs();
    elements.logoColorValue.value = logoBackgroundWithAlpha().toUpperCase();
    renderLogoColorTranslations();
    scheduleLogoPreview();
  });
  elements.logoColorValue.addEventListener("input", () => {
    if (elements.logoTransparentBackground.checked) return;
    const normalized = parseColorInput(elements.logoColorValue.value);
    if (!normalized) {
      elements.logoColorStatus.textContent = localize("logoColorInvalid", settings);
      return;
    }
    setLogoBackgroundColor(normalized);
    updateLogoControlOutputs();
    renderLogoColorTranslations();
    scheduleLogoPreview();
  });
  elements.logoApplyCustom.addEventListener("click", async () => {
    if (settings.schoolModeEnabled) return;
    elements.logoApplyCustom.disabled = true;
    try {
      const source = activeLogoSource();
      if (!source) throw new Error("logo-missing-source");
      const record = stagedLogo?.record ?? await createCustomLogoRecord(source, logoControls());
      await saveLogoRecord(record);
    } catch (error) {
      elements.logoStatus.textContent = logoErrorMessage(error);
    } finally {
      refreshLogoPresentation();
    }
  });
  elements.logoReset.addEventListener("click", async () => {
    if (settings.schoolModeEnabled) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "CLEAR_LOGO" });
      if (!response?.ok) throw new Error(response?.result?.code ?? "logo-storage-failed");
      logo = null;
      stagedLogo = null;
      logoSource = { kind: "preset", presetId: "material-stack" };
      fillLogoControls(null);
      renderLogoPreviews(null);
      elements.logoStatus.textContent = response.actionUpdated ? localize("logoResetComplete", settings) : localize("logoSavedActionRetry", settings);
    } catch (error) {
      elements.logoStatus.textContent = error?.message === "logo-school-mode-hidden"
        ? localize("logoSchoolModeSuppressed", settings, { name: settings.schoolModeName })
        : localize("logoStorageFailed", settings);
    } finally {
      refreshLogoPresentation();
    }
  });
  elements.logoPresetSearch.addEventListener("input", () => {
    if (logoPresetRegexMode) elements.logoPresetRegexPattern.value = elements.logoPresetSearch.value;
    refreshLogoPresetSearch();
  });
  elements.logoPresetRegexToggle.addEventListener("click", () => {
    logoPresetRegexOpen = !logoPresetRegexOpen;
    elements.logoPresetRegex.hidden = !logoPresetRegexOpen;
    elements.logoPresetRegexToggle.setAttribute("aria-expanded", String(logoPresetRegexOpen));
    if (logoPresetRegexOpen) elements.logoPresetRegexPattern.focus();
  });
  [elements.logoPresetRegexPattern, elements.logoPresetRegexFlags, elements.logoPresetRegexSample].forEach((input) => input.addEventListener("input", evaluateLogoPresetRegex));
  document.querySelectorAll("[data-logo-fragment]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.logoPresetRegexPattern.value = appendRegexFragment(elements.logoPresetRegexPattern.value, button.dataset.logoFragment);
      elements.logoPresetRegexPattern.focus();
      evaluateLogoPresetRegex();
    });
  });
  elements.logoPresetRegexMode.addEventListener("change", () => {
    logoPresetRegexMode = elements.logoPresetRegexMode.checked;
    if (logoPresetRegexMode) elements.logoPresetRegexPattern.value = elements.logoPresetSearch.value;
    refreshLogoPresetSearch();
  });
  elements.logoPresetRegexApply.addEventListener("click", () => {
    const validation = validateRegex(elements.logoPresetRegexPattern.value, elements.logoPresetRegexFlags.value);
    if (!validation.valid) { evaluateLogoPresetRegex(); return; }
    elements.logoPresetSearch.value = elements.logoPresetRegexPattern.value;
    elements.logoPresetRegexMode.checked = true;
    logoPresetRegexMode = true;
    refreshLogoPresetSearch();
  });
  elements.logoPresetRegexCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`/${elements.logoPresetRegexPattern.value}/${elements.logoPresetRegexFlags.value}`);
      showToast(localize("regexPatternCopied", settings));
    } catch {
      showToast(localize("copyFailed", settings));
    }
  });
  elements.logoPresetRegexExport.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ pattern: elements.logoPresetRegexPattern.value, flags: elements.logoPresetRegexFlags.value }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "material-download-manager-logo-preset-regex.json";
    anchor.click();
    URL.revokeObjectURL(url);
  });
  elements.logoUploadFormats.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.logoUploadFormat;
      if (!type || button.hidden || settings.schoolModeEnabled) return;
      if (logoAcceptedUploadTypes.has(type)) logoAcceptedUploadTypes.delete(type);
      else logoAcceptedUploadTypes.add(type);
      refreshLogoUploadFilter();
    });
  });
  wireLogoFilterRegexBuilder(logoUploadFilterRegexConfig, refreshLogoUploadFilter);
  wireLogoFilterRegexBuilder(logoColorRegexConfig, renderLogoColorTranslations);
  refreshLogoUploadFilter();
elements.authenticatorListRegexMode.addEventListener("change", () => {
  authenticatorListRegexMode = elements.authenticatorListRegexMode.checked;
  if (authenticatorListRegexMode) elements.authenticatorListRegexPattern.value = elements.authenticatorListSearch.value;
  renderAuthenticatorList();
});
elements.authenticatorListRegexApply.addEventListener("click", () => {
  const validation = validateRegex(elements.authenticatorListRegexPattern.value, elements.authenticatorListRegexFlags.value);
  if (!validation.valid) {
    elements.authenticatorListRegexPattern.dispatchEvent(new Event("input"));
    return;
  }
  elements.authenticatorListSearch.value = elements.authenticatorListRegexPattern.value;
  elements.authenticatorListRegexMode.checked = true;
  authenticatorListRegexMode = true;
  renderAuthenticatorList();
});
elements.authenticatorListRegexCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`/${elements.authenticatorListRegexPattern.value}/${elements.authenticatorListRegexFlags.value}`);
    showToast(localize("regexPatternCopied", settings));
  } catch {
    showToast(localize("copyFailed", settings));
  }
});
elements.authenticatorListRegexExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ pattern: elements.authenticatorListRegexPattern.value, flags: elements.authenticatorListRegexFlags.value }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-download-manager-authenticator-regex.json";
  anchor.click();
  URL.revokeObjectURL(url);
});
elements.authenticatorExport.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_AUTHENTICATOR_METADATA" });
    const records = response?.result?.records;
    if (!response?.ok || !Array.isArray(records)) throw new Error("export");
    const blob = new Blob([JSON.stringify({ schema: "material-download-manager.authenticator-export", version: 1, secretOmitted: true, records }, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "material-download-manager-authenticator-metadata.json";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(localize("authenticatorMetadataExported", settings));
  } catch {
    elements.authenticatorListStatus.textContent = localize("authenticatorStorageFailed", settings);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[SETTINGS_KEY]) {
    settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
    fillForm();
    refreshSearch();
    refreshAuthenticatorPresentation();
    void loadLogo();
  }
  if (changes[LOGO_STORAGE_KEY]) void loadLogo();
});

await loadState();
