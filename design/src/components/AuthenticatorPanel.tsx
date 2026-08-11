import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  createTotpQrRegistrationModel,
  isTotpRegistrationMetadata,
  type TotpAlgorithm,
  type TotpDigits,
  type TotpRegistrationInput,
  type TotpRegistrationMetadata,
  type TotpQrRegistrationModel,
} from "@shared/authenticator";
import { useIsolatedRegexBatch, localizedRegexEvaluationError } from "../hooks/useIsolatedRegex";
import { createDefaultRegexBuilderState, validateRegexPattern, type RegexBuilderState } from "@shared/regex";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import DestructiveActionGate, { type DestructiveActionRequest } from "./DestructiveActionGate";
import RegexBuilder from "./RegexBuilder";
import { notify } from "./NotificationCenter";
import "../styles/authenticator.css";

const METADATA_STORAGE_KEY = "material-download-manager.authenticator.metadata.v1";
const DEFAULT_ISSUER = "Material Download Manager";

interface AuthenticatorDraft {
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  period: number;
}

function initialDraft(): AuthenticatorDraft {
  return { issuer: DEFAULT_ISSUER, account: "", secret: "", algorithm: "SHA1", digits: 6, period: 30 };
}

function loadMetadata(): TotpRegistrationMetadata[] {
  try {
    const raw = window.localStorage.getItem(METADATA_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((item): item is TotpRegistrationMetadata => {
      if (!isTotpRegistrationMetadata(item) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  } catch {
    return [];
  }
}

function saveMetadata(items: readonly TotpRegistrationMetadata[]): void {
  try {
    window.localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A locked-down profile keeps the list for this session only.
  }
}

function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/gu, "$1 ").trim();
}

function createRegistrationInput(model: TotpQrRegistrationModel): TotpRegistrationInput {
  return {
    issuer: model.issuer,
    account: model.account,
    secret: model.secret,
    algorithm: model.algorithm,
    digits: model.digits,
    period: model.period,
  };
}

interface QrCodeSvgProps {
  value: string;
  label: string;
}

function QrCodeSvg({ value, label }: QrCodeSvgProps) {
  const qr = useMemo(() => {
    try {
      return QRCode.create(value, { errorCorrectionLevel: "M" });
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return <p className="field-error" role="alert">Unable to render the local QR code.</p>;
  const size = qr.modules.size;
  const quiet = 4;
  const path = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => (
    qr.modules.get(row, column) ? `M${column + quiet},${row + quiet}h1v1h-1z` : ""
  )).join("")).join("");
  return (
    <svg
      className="authenticator-qr"
      viewBox={`0 0 ${size + quiet * 2} ${size + quiet * 2}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size + quiet * 2} height={size + quiet * 2} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

function metadataSearchText(item: TotpRegistrationMetadata): string {
  return `${item.issuer} ${item.account} ${item.algorithm} ${item.digits} ${item.period}`;
}

export default function AuthenticatorPanel() {
  const settings = useAppStore((state) => state.settings);
  const ui = useMemo(() => getUiCopy(settings), [settings]);
  const [draft, setDraft] = useState<AuthenticatorDraft>(initialDraft);
  const [qrModel, setQrModel] = useState<TotpQrRegistrationModel | null>(null);
  const [manualSecretVisible, setManualSecretVisible] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [metadata, setMetadata] = useState<TotpRegistrationMetadata[]>(loadMetadata);
  const [busy, setBusy] = useState<"prepare" | "confirm" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<TotpRegistrationMetadata | null>(null);
  const [listSearch, setListSearch] = useState<RegexBuilderState>(() => createDefaultRegexBuilderState());
  const [listRegexOpen, setListRegexOpen] = useState(false);

  useEffect(() => saveMetadata(metadata), [metadata]);

  const listSamples = useMemo(() => metadata.map(metadataSearchText), [metadata]);
  const regexEnabled = listSearch.mode === "regex" && listSearch.pattern.length > 0;
  const regexError = regexEnabled ? validateRegexPattern(listSearch.pattern, listSearch.flags) : null;
  const regexBatch = useIsolatedRegexBatch(listSearch.pattern, listSearch.flags, listSamples, regexEnabled);
  const visibleMetadata = useMemo(() => {
    if (!listSearch.pattern) return metadata;
    if (regexEnabled) {
      if (regexError || !regexBatch.evaluations) return [];
      return metadata.filter((_, index) => (regexBatch.evaluations?.[index]?.matches.length ?? 0) > 0);
    }
    const query = listSearch.pattern.toLocaleLowerCase();
    return metadata.filter((item) => metadataSearchText(item).toLocaleLowerCase().includes(query));
  }, [listSearch.pattern, metadata, regexBatch.evaluations, regexEnabled, regexError]);
  const listSearchError = regexError ?? regexBatch.error;

  function updateDraft<K extends keyof AuthenticatorDraft>(key: K, value: AuthenticatorDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setStatus(null);
  }

  function clearQr() {
    setQrModel(null);
    setManualSecretVisible(false);
    setPairingCode("");
    setDraft((current) => ({ ...current, secret: "" }));
    setError(null);
    setStatus(null);
  }

  function prepareQr() {
    setBusy("prepare");
    setError(null);
    setStatus(null);
    try {
      const model = createTotpQrRegistrationModel(draft);
      setQrModel(model);
      setManualSecretVisible(false);
      setPairingCode("");
      setStatus(ui.text("QR ready. Scan it, then enter the current code to confirm pairing.", "QR 準備好喇；掃描之後輸入目前代碼確認配對。"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui.text("Enter a valid registration.", "請輸入有效嘅註冊資料。"));
    } finally {
      setBusy(null);
    }
  }

  async function confirmPairing() {
    if (!qrModel || busy) return;
    if (!/^(?:\d{6}|\d{8})$/u.test(pairingCode)) {
      setError(ui.text("Enter the current six- or eight-digit authenticator code.", "請輸入目前六位或八位 authenticator 代碼。"));
      return;
    }
    setBusy("confirm");
    setError(null);
    setStatus(null);
    try {
      const input = createRegistrationInput(qrModel);
      const confirmed = await window.api.confirmAuthenticatorRegistration(input, pairingCode, Date.now(), 1);
      if (!confirmed) {
        setError(ui.text("That code did not match. The secret was not stored.", "代碼唔相符；secret 未有儲存。"));
        return;
      }
      const saved = await window.api.registerAuthenticator(input);
      setMetadata((current) => [...current, saved]);
      clearQr();
      setStatus(ui.text("Paired and stored in the operating-system credential vault. The list contains metadata only.", "已配對並儲存喺作業系統 credential vault；清單只保留資料標籤。"));
      notify({
        tone: "success",
        title: ui.text("Authenticator paired", "Authenticator 已配對"),
        message: ui.text("The secret stays in the operating-system vault; ordinary exports omit it.", "Secret 留喺作業系統 vault；普通匯出會省略。"),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui.text("Pairing could not be stored.", "未能儲存配對。"));
    } finally {
      setBusy(null);
    }
  }

  async function exportMetadata() {
    if (metadata.length === 0 || busy) return;
    setBusy("export");
    setError(null);
    try {
      const records = await Promise.all(metadata.map((item) => window.api.exportAuthenticatorMetadata(item)));
      const blob = new Blob([JSON.stringify({ schema: "material-download-manager.authenticator-export", schemaVersion: 1, secretOmitted: true, records }, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "authenticator-metadata.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(ui.text("Metadata export created; no secret or otpauth URI was written.", "資料標籤匯出完成；冇有寫入 secret 或 otpauth URI。"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui.text("Metadata export failed.", "資料標籤匯出失敗。"));
    } finally {
      setBusy(null);
    }
  }

  function confirmRemoval(request: DestructiveActionRequest) {
    const candidate = pendingRemoval;
    setPendingRemoval(null);
    if (!candidate || request.itemIds[0] !== candidate.id) return;
    void window.api.removeAuthenticator(candidate).then(() => {
      setMetadata((current) => current.filter((item) => item.id !== candidate.id));
      setStatus(ui.text("Authenticator metadata and its vault entry were removed.", "Authenticator 資料標籤同 vault entry 已移除。"));
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : ui.text("The authenticator could not be removed.", "未能移除 authenticator。"));
    });
  }

  return (
    <div className="authenticator-panel" id="settings-authenticator-panel">
      <section className="settings-section" aria-labelledby="authenticator-heading">
        <div className="settings-section-heading" id="authenticator-heading">{ui.text("Authenticator", "Authenticator 驗證器")}</div>
        <p className="setting-helper">{ui.text("Register a local RFC 6238 account. The QR and manual secret are shown once in memory; pairing confirmation happens before the secret enters the operating-system credential vault.", "註冊本機 RFC 6238 帳戶。QR 同 manual secret 只會喺記憶體顯示一次；確認配對之後先會寫入作業系統 credential vault。")}</p>
        <p className="setting-helper">{ui.text("No network request is made. Ordinary metadata exports omit the secret and the otpauth URI.", "唔會發出網絡請求；普通資料標籤匯出會省略 secret 同 otpauth URI。")}</p>
      </section>

      {!qrModel ? (
        <section className="settings-section authenticator-card" aria-labelledby="authenticator-register-heading">
          <div className="settings-section-heading" id="authenticator-register-heading">{ui.text("Register an account", "註冊帳戶")}</div>
          <label className="field"><span className="field-label">{ui.text("Issuer", "Issuer 發行者")}</span><input className="input" id="authenticator-issuer" value={draft.issuer} maxLength={128} onChange={(event) => updateDraft("issuer", event.target.value)} /></label>
          <label className="field"><span className="field-label">{ui.text("Account", "Account 帳戶")}</span><input className="input" id="authenticator-account" value={draft.account} maxLength={128} placeholder="name@example.test" onChange={(event) => updateDraft("account", event.target.value)} /></label>
          <label className="field"><span className="field-label">{ui.text("Base32 secret", "Base32 secret")}</span><input className="input authenticator-secret-input" id="authenticator-secret" type="password" autoComplete="off" value={draft.secret} maxLength={512} onChange={(event) => updateDraft("secret", event.target.value)} /></label>
          <div className="field-pair">
            <label className="field"><span className="field-label">{ui.text("Algorithm", "Algorithm 演算法")}</span><select className="input select" id="authenticator-algorithm" value={draft.algorithm} onChange={(event) => updateDraft("algorithm", event.target.value as TotpAlgorithm)}><option value="SHA1">SHA-1</option><option value="SHA256">SHA-256</option><option value="SHA512">SHA-512</option></select></label>
            <label className="field"><span className="field-label">{ui.text("Digits", "位數")}</span><select className="input select" id="authenticator-digits" value={draft.digits} onChange={(event) => updateDraft("digits", Number(event.target.value) as TotpDigits)}><option value={6}>6</option><option value={8}>8</option></select></label>
            <label className="field"><span className="field-label">{ui.text("Period (seconds)", "週期（秒）")}</span><input className="input" id="authenticator-period" type="number" min={1} max={86400} value={draft.period} onChange={(event) => updateDraft("period", Math.min(86400, Math.max(1, Number(event.target.value) || 30)))} /></label>
          </div>
          <button type="button" className="btn btn-primary" id="authenticator-prepare-qr" disabled={busy !== null} onClick={prepareQr}>{busy === "prepare" ? ui.text("Preparing…", "準備緊…") : ui.text("Prepare QR pairing", "準備 QR 配對")}</button>
        </section>
      ) : (
        <section className="settings-section authenticator-card authenticator-pairing" aria-labelledby="authenticator-pairing-heading">
          <div className="settings-section-heading" id="authenticator-pairing-heading">{ui.text("Scan and confirm pairing", "掃描並確認配對")}</div>
          <div className="authenticator-pairing-grid">
            <div className="authenticator-qr-wrap"><QrCodeSvg value={qrModel.otpauthUri} label={ui.text("One-time TOTP pairing QR code", "一次性 TOTP 配對 QR code")} /><span className="setting-helper">{ui.text("Rendered locally; no network image is used.", "本機繪製；唔會使用網絡圖片。")}</span></div>
            <div className="authenticator-pairing-details">
              <div className="field"><span className="field-label">{ui.text("Manual secret (one-time reveal)", "Manual secret（一次性顯示）")}</span>{manualSecretVisible ? <><code className="authenticator-manual-secret">{formatSecret(qrModel.manualSecret)}</code><button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(qrModel.manualSecret)}>{ui.text("Copy secret", "複製 secret")}</button></> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManualSecretVisible(true)}>{ui.text("Reveal manual secret", "顯示 manual secret")}</button>}</div>
              <dl className="authenticator-facts"><div><dt>{ui.text("Issuer", "Issuer")}</dt><dd>{qrModel.issuer}</dd></div><div><dt>{ui.text("Account", "Account")}</dt><dd>{qrModel.account}</dd></div><div><dt>{ui.text("Parameters", "參數")}</dt><dd>{qrModel.algorithm} · {qrModel.digits} digits · {qrModel.period}s</dd></div></dl>
              <label className="field"><span className="field-label">{ui.text("Current authenticator code", "目前 authenticator 代碼")}</span><input className="input authenticator-pairing-code" id="authenticator-pairing-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\D/gu, "").slice(0, 8))} /></label>
              <div className="field-row"><button type="button" className="btn btn-primary" id="authenticator-confirm-pairing" disabled={busy !== null} onClick={() => void confirmPairing()}>{busy === "confirm" ? ui.text("Confirming…", "確認緊…") : ui.text("Confirm and store", "確認並儲存")}</button><button type="button" className="btn btn-ghost" onClick={clearQr}>{ui.text("Cancel reveal", "取消顯示")}</button></div>
            </div>
          </div>
        </section>
      )}

      <section className="settings-section authenticator-card" aria-labelledby="authenticator-list-heading">
        <div className="authenticator-list-heading"><div className="settings-section-heading" id="authenticator-list-heading">{ui.text("Registered metadata", "已註冊資料標籤")}</div><button type="button" className="btn btn-ghost btn-sm" id="authenticator-export" disabled={metadata.length === 0 || busy !== null} onClick={() => void exportMetadata()}>{busy === "export" ? ui.text("Exporting…", "匯出緊…") : ui.text("Export metadata", "匯出資料標籤")}</button></div>
        <div className="authenticator-list-search-row"><input className="input" type="search" id="authenticator-list-search" placeholder={ui.text("Search issuer, account, or algorithm", "搜尋 issuer、account 或 algorithm")} value={listSearch.pattern} onChange={(event) => setListSearch((current) => ({ ...current, pattern: event.target.value }))} /><button type="button" className="btn btn-ghost btn-sm" aria-expanded={listRegexOpen} aria-controls="authenticator-list-regex" onClick={() => setListRegexOpen((open) => !open)}>{ui.text("Regex", "Regex")}</button></div>
        {listRegexOpen && <div className="authenticator-list-regex" id="authenticator-list-regex"><RegexBuilder title={ui.text("Authenticator list regex builder", "Authenticator 清單 regex 建構器")} value={listSearch} onChange={setListSearch} text={ui.text} /></div>}
        {listSearchError && <p className="field-error" role="alert">{localizedRegexEvaluationError(listSearchError, ui.text)}</p>}
        <p className="setting-helper" role="status">{ui.text(`${visibleMetadata.length} of ${metadata.length} metadata entr${metadata.length === 1 ? "y" : "ies"}`, `${visibleMetadata.length} / ${metadata.length} 個資料標籤`)}</p>
        {metadata.length === 0 ? <div className="authenticator-empty" role="status">{ui.text("No authenticator metadata yet. Prepare a QR pairing above to begin.", "暫時未有 authenticator 資料標籤；喺上面準備 QR 配對先開始。")}</div> : visibleMetadata.length === 0 ? <div className="authenticator-empty" role="status">{ui.text("No registered metadata matches this search.", "冇註冊資料標籤符合呢個搜尋。")}</div> : <ul className="authenticator-list" aria-label={ui.text("Registered authenticator metadata", "已註冊 authenticator 資料標籤")}>{visibleMetadata.map((item) => <li key={item.id} className="authenticator-list-item"><div><strong>{item.issuer}</strong><span>{item.account}</span><small>{item.algorithm} · {item.digits} digits · {item.period}s · secret omitted from metadata</small></div><button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setPendingRemoval(item)}>{ui.text("Remove", "移除")}</button></li>)}</ul>}
        {status && <p className="setting-helper" role="status" aria-live="polite">{status}</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </section>
      {pendingRemoval && <DestructiveActionGate request={{ itemIds: [pendingRemoval.id], deleteFile: false }} actionName={ui.text("remove this authenticator registration", "移除呢個 authenticator 註冊") } affectedLabel={ui.text("authenticator registration", "authenticator 註冊")} onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />}
    </div>
  );
}
