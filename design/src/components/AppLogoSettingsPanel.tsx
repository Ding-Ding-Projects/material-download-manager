import { useEffect, useMemo, useRef, useState } from "react";
import {
  APP_LOGO_PRESETS,
  cloneAppLogoSettings,
  isAppLogoSettings,
  isHexColor,
  type AppLogoCrop,
  type AppLogoFocalPoint,
  type AppLogoPreset,
  type AppLogoSettings,
  type AppLogoSnapshot,
} from "@shared/appLogo";
import { createDefaultRegexBuilderState, validateRegexPattern, type RegexBuilderState } from "@shared/regex";
import { useIsolatedRegexBatch } from "../hooks/useIsolatedRegex";
import { getUiCopy } from "../i18n/ui";
import { useUiCopy } from "../i18n/useUiCopy";
import { useAppStore } from "../store/useAppStore";
import { AppLogoPresetMark } from "./AppLogo";
import RegexBuilder from "./RegexBuilder";

const DISPLAY_TARGETS = [16, 20, 24, 32, 40, 48, 64, 128] as const;
const PRESET_COPY: Record<AppLogoPreset, readonly [string, string]> = {
  material: ["Material download", "Material 下載"],
  orbit: ["Orbit transfer", "軌道傳輸"],
  stack: ["Stacked archive", "疊放檔案"],
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function updateCrop(current: AppLogoCrop, key: keyof AppLogoCrop, value: number): AppLogoCrop {
  const next = { ...current, [key]: value };
  next.width = clamp(next.width, 0.05, 1);
  next.height = clamp(next.height, 0.05, 1);
  next.x = clamp(next.x, 0, 1 - next.width);
  next.y = clamp(next.y, 0, 1 - next.height);
  return next;
}

function updateFocalPoint(current: AppLogoFocalPoint, key: keyof AppLogoFocalPoint, value: number): AppLogoFocalPoint {
  return { ...current, [key]: clamp(value) };
}

function previewStatus(snapshot: AppLogoSnapshot | null, text: ReturnType<typeof getUiCopy>["text"]): string {
  if (!snapshot) return text("Loading the local logo state…", "載入本機標誌狀態中…");
  if (snapshot.status === "custom-cache-missing") {
    return text("The private custom-logo cache is unavailable, so the shipped preset is active. Choose a local image again to replace it.", "私人自訂標誌快取而家不可用，所以正使用內置預設；請再揀一次本機圖片去替換。");
  }
  return snapshot.activeSource === "custom"
    ? text("A validated local custom logo is active. Its source name and path are never displayed or exported.", "已啟用驗證過嘅本機自訂標誌；來源名稱同路徑絕不會顯示或者匯出。")
    : text("A shipped logo preset is active.", "已啟用內置標誌預設。");
}

export default function AppLogoSettingsPanel({
  value,
  onChange,
}: {
  value: AppLogoSettings;
  onChange: (next: AppLogoSettings) => void;
}) {
  const appSettings = useAppStore((state) => state.settings);
  const ui = useUiCopy(appSettings);
  const [snapshot, setSnapshot] = useState<AppLogoSnapshot | null>(null);
  const [busy, setBusy] = useState<"pick" | "apply" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [regexOpen, setRegexOpen] = useState(false);
  const regexButtonRef = useRef<HTMLButtonElement>(null);
  const [presetSearch, setPresetSearch] = useState<RegexBuilderState>(() => ({
    ...createDefaultRegexBuilderState(),
    sample: APP_LOGO_PRESETS.map((preset) => PRESET_COPY[preset].join(" ")).join("\n"),
  }));
  const samples = useMemo(() => APP_LOGO_PRESETS.map((preset) => `${preset} ${PRESET_COPY[preset].join(" ")}`), []);
  const syntaxError = presetSearch.mode === "regex" && presetSearch.pattern ? validateRegexPattern(presetSearch.pattern, presetSearch.flags) : null;
  const evaluated = useIsolatedRegexBatch(presetSearch.pattern, presetSearch.flags, samples, presetSearch.mode === "regex" && Boolean(presetSearch.pattern) && !syntaxError);
  const visiblePresets = useMemo(() => {
    if (!presetSearch.pattern) return [...APP_LOGO_PRESETS];
    if (presetSearch.mode === "regex") {
      if (syntaxError || evaluated.pending || evaluated.error || !evaluated.evaluations) return [];
      return APP_LOGO_PRESETS.filter((_, index) => (evaluated.evaluations?.[index]?.matches.length ?? 0) > 0);
    }
    const query = presetSearch.pattern.toLocaleLowerCase();
    return APP_LOGO_PRESETS.filter((preset, index) => samples[index].toLocaleLowerCase().includes(query));
  }, [evaluated.error, evaluated.evaluations, evaluated.pending, presetSearch.mode, presetSearch.pattern, samples, syntaxError]);

  const sourceLabel = value.source === "custom"
    ? ui.text("Source: validated private local cache", "來源：驗證過嘅私人本機快取")
    : ui.text("Source: shipped preset", "來源：內置預設");
  const lossNotice = value.fit === "cover"
    ? ui.text("Cover crops outside the selected focal area before rendering. Apply shows the converted result.", "Cover 會喺轉換前裁走選擇焦點以外嘅部分；套用後會顯示轉換結果。")
    : value.fit === "fill"
      ? ui.text("Fill stretches the selected crop to each square target. Apply shows the converted result.", "Fill 會將選取裁剪拉伸至每個正方形目標；套用後會顯示轉換結果。")
      : value.background === "color"
        ? ui.text("A solid background flattens transparent pixels in generated display variants. Apply shows the converted result.", "實色背景會喺已產生顯示版本合併透明像素；套用後會顯示轉換結果。")
        : ui.text("Contain preserves the selected crop inside each square target. Apply regenerates the validated local variants.", "Contain 會保留選取裁剪喺每個正方形目標入面；套用會重新產生已驗證嘅本機版本。");

  useEffect(() => {
    let active = true;
    void window.api.getAppLogo().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => {
      if (active) setSnapshot(null);
    });
    return () => { active = false; };
  }, []);

  async function chooseLocalImage() {
    setBusy("pick");
    setMessage(null);
    try {
      const next = await window.api.pickAppLogo();
      setSnapshot(next);
      onChange(cloneAppLogoSettings(next.settings));
      setMessage(next.activeSource === "custom"
        ? ui.text("The local image was decoded, bounded, converted, and applied without recording its source name or path.", "本機圖片已解碼、限制、轉換並套用，來源名稱同路徑冇記錄。")
        : previewStatus(next, ui.text));
    } catch {
      setMessage(ui.text("The local image could not be converted safely, and the prior valid logo remains active.", "本機圖片未能安全轉換，之前有效嘅標誌會保持啟用。"));
    } finally {
      setBusy(null);
    }
  }

  async function applyRendering() {
    if (!isAppLogoSettings(value)) {
      setMessage(ui.text("Complete the logo controls with valid values before applying.", "請先完成有效嘅標誌設定再套用。"));
      return;
    }
    setBusy("apply");
    setMessage(null);
    try {
      const next = await window.api.setAppLogo(cloneAppLogoSettings(value));
      setSnapshot(next);
      onChange(cloneAppLogoSettings(next.settings));
      setMessage(ui.text("The logo rendering was converted locally and is now live in the title bars.", "標誌外觀已喺本機轉換，現已喺標題列即時顯示。"));
    } catch {
      setMessage(ui.text("The prior valid logo remains active because conversion did not finish.", "因為轉換未完成，之前有效嘅標誌會保持啟用。"));
    } finally {
      setBusy(null);
    }
  }

  async function resetLogo() {
    setBusy("clear");
    setMessage(null);
    try {
      const next = await window.api.clearAppLogo();
      setSnapshot(next);
      onChange(cloneAppLogoSettings(next.settings));
      setMessage(ui.text("The private custom source and generated variants were cleared; the shipped mark is active.", "私人自訂來源同已產生版本已清除；內置標誌而家啟用。"));
    } catch {
      setMessage(ui.text("The logo reset did not complete, so the current valid logo remains active.", "標誌重設未完成，所以目前有效嘅標誌會保持啟用。"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="app-logo-settings" id="settings-app-logo" tabIndex={-1} aria-labelledby="settings-app-logo-heading">
      <div className="settings-section-heading" id="settings-app-logo-heading">{ui.text("App logo", "程式標誌")}</div>
      <p className="setting-helper">{ui.text("Choose a shipped mark or a local still image. The custom image is processed only on this device; it never changes the package identity, installer, executable name, update feed, or data folder.", "揀一個內置標誌或者本機靜態圖片。自訂圖片只會喺呢部機處理，絕不會改套件身份、安裝程式、執行檔名稱、更新來源或者資料夾。")}</p>
      <p className="setting-helper">{sourceLabel}</p>

      <div className="app-logo-preset-search">
        <label className="field-label" htmlFor="settings-app-logo-preset-search">{ui.text("Search shipped logo presets", "搜尋內置標誌預設")}</label>
        <div className="field-row">
          <input id="settings-app-logo-preset-search" className="input" type="search" value={presetSearch.pattern} onChange={(event) => setPresetSearch({ ...presetSearch, pattern: event.target.value })} aria-invalid={syntaxError ? true : undefined} />
          <button ref={regexButtonRef} type="button" className={`btn btn-ghost btn-sm${regexOpen ? " active" : ""}`} aria-expanded={regexOpen} aria-controls="settings-app-logo-preset-regex" onClick={() => setRegexOpen((open) => !open)}>{ui.text("Regex", "Regex")}</button>
        </div>
        {regexOpen && <div className="settings-search-builder" id="settings-app-logo-preset-regex"><RegexBuilder title={ui.text("App-logo preset regex builder", "程式標誌預設 regex 建構器")} value={presetSearch} onChange={setPresetSearch} text={ui.text} /></div>}
        {syntaxError && <p className="field-error" role="alert">{syntaxError}</p>}
      </div>

      <div className="app-logo-preset-grid" role="list" aria-label={ui.text("Shipped app-logo presets", "內置程式標誌預設")}> 
        {visiblePresets.map((preset) => (
          <div key={preset} role="listitem"><button type="button" className={`app-logo-preset${value.source === "preset" && value.preset === preset ? " selected" : ""}`} aria-pressed={value.source === "preset" && value.preset === preset} onClick={() => onChange({ ...cloneAppLogoSettings(value), source: "preset", preset })}>
            <AppLogoPresetMark preset={preset} size={36} decorative />
            <span>{ui.text(...PRESET_COPY[preset])}</span>
          </button></div>
        ))}
        {visiblePresets.length === 0 && <p className="setting-helper" role="status">{ui.text("No shipped preset matches this search.", "搵唔到相符嘅內置預設。")}</p>}
      </div>

      <div className="field">
        <span className="field-label">{ui.text("Custom local image", "自訂本機圖片")}</span>
        <p className="setting-helper">{ui.text("Accepts PNG, JPEG, or still WebP. File bytes, decoded dimensions, animation markers, and generated outputs are bounded and validated before anything changes.", "接受 PNG、JPEG 或靜態 WebP。檔案位元、解碼尺寸、動畫標記同已產生輸出都會先受限制同驗證，之後先會改動。")}</p>
        <div className="field-row">
          <button type="button" id="settings-app-logo-choose" className="btn btn-secondary" onClick={() => void chooseLocalImage()} disabled={busy !== null}>{busy === "pick" ? ui.text("Choosing…", "揀緊…") : value.source === "custom" ? ui.text("Replace local image", "替換本機圖片") : ui.text("Choose local image…", "揀本機圖片…")}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resetLogo()} disabled={busy !== null}>{busy === "clear" ? ui.text("Clearing…", "清除緊…") : ui.text("Clear and reset", "清除並重設")}</button>
        </div>
      </div>

      <div className="app-logo-controls" aria-label={ui.text("Logo rendering controls", "標誌外觀控制")}> 
        <label className="field"><span className="field-label">{ui.text("Fit", "適應方式")}</span><select className="input select" value={value.fit} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), fit: event.target.value as AppLogoSettings["fit"] })}><option value="contain">{ui.text("Contain", "Contain")}</option><option value="cover">{ui.text("Cover", "Cover")}</option><option value="fill">{ui.text("Fill", "Fill")}</option></select></label>
        <label className="field"><span className="field-label">{ui.text("Background", "背景")}</span><select className="input select" value={value.background} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), background: event.target.value as AppLogoSettings["background"] })}><option value="transparent">{ui.text("Transparent", "透明")}</option><option value="color">{ui.text("Color", "顏色")}</option></select></label>
        <label className="field"><span className="field-label">{ui.text("Background color", "背景顏色")}</span><div className="field-row"><input type="color" value={value.backgroundColor.slice(0, 7)} aria-label={ui.text("Background color picker", "背景顏色選擇器")} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), backgroundColor: event.target.value })} /><input className="input" value={value.backgroundColor} aria-invalid={!isHexColor(value.backgroundColor)} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), backgroundColor: event.target.value })} /></div></label>
      </div>

      <fieldset className="app-logo-coordinate-grid">
        <legend className="field-label">{ui.text("Crop (0–1)", "裁剪（0–1）")}</legend>
        {(["x", "y", "width", "height"] as const).map((key) => <label className="field" key={key}><span>{key}</span><input className="input" type="number" min={key === "width" || key === "height" ? 0.05 : 0} max={1} step={0.01} value={value.crop[key]} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), crop: updateCrop(value.crop, key, Number(event.target.value)) })} /></label>)}
      </fieldset>
      <fieldset className="app-logo-coordinate-grid">
        <legend className="field-label">{ui.text("Focal point (used by Cover)", "焦點（Cover 會用）")}</legend>
        {(["x", "y"] as const).map((key) => <label className="field" key={key}><span>{key}</span><input className="input" type="number" min={0} max={1} step={0.01} value={value.focalPoint[key]} onChange={(event) => onChange({ ...cloneAppLogoSettings(value), focalPoint: updateFocalPoint(value.focalPoint, key, Number(event.target.value)) })} /></label>)}
      </fieldset>
      <p className="setting-helper">{lossNotice}</p>
      <button type="button" id="settings-app-logo-apply" className="btn btn-primary" onClick={() => void applyRendering()} disabled={busy !== null || !isAppLogoSettings(value)}>{busy === "apply" ? ui.text("Converting locally…", "本機轉換緊…") : ui.text("Apply logo rendering", "套用標誌外觀")}</button>

      <div className="app-logo-preview" aria-label={ui.text("Logo previews at each display target", "每個顯示目標嘅標誌預覽")}>
        <span className="field-label">{ui.text("Live display-target previews", "即時顯示目標預覽")}</span>
        <div className="app-logo-preview-targets">
          {DISPLAY_TARGETS.map((size) => <figure key={size}><div className="app-logo-preview-frame" style={{ background: value.background === "color" ? value.backgroundColor : "transparent" }}>{snapshot?.activeSource === "custom" && snapshot.previewDataUrl ? <img src={snapshot.previewDataUrl} width={size} height={size} alt={ui.text(`Custom logo at ${size} pixels`, `自訂標誌 ${size} 像素`)} /> : <AppLogoPresetMark preset={value.preset} size={size} decorative={false} label={ui.text(`${PRESET_COPY[value.preset][0]} logo at ${size} pixels`, `${PRESET_COPY[value.preset][1]} 標誌 ${size} 像素`)} />}</div><figcaption>{size}px</figcaption></figure>)}
        </div>
      </div>
      <p className="setting-helper" role="status" aria-live="polite">{message ?? previewStatus(snapshot, ui.text)}</p>
    </section>
  );
}
