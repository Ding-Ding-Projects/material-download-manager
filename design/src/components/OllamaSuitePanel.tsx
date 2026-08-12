import { useEffect, useMemo, useRef, useState } from "react";
import { isOllamaEndpoint, type OllamaProviderRecord, type OllamaSuiteState } from "@shared/ollama";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import DestructiveActionGate, { type DestructiveActionRequest } from "./DestructiveActionGate";
import { notify } from "./NotificationCenter";

function initialState(): OllamaSuiteState {
  return { schemaVersion: 1, providers: [], installedModels: [], updatedAt: null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportOllamaError(ui: ReturnType<typeof getUiCopy>, reason: unknown): string {
  const detail = errorMessage(reason);
  notify({ title: ui.text("Ollama operation failed", "Ollama 操作失敗"), message: detail, tone: "error" });
  return detail;
}

function modelSize(value: number | null, text: (english: string, cantonese: string) => string): string {
  if (value === null) return text("Unknown size", "大小未知");
  if (value < 1024 * 1024) return `${value} B`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function OllamaSuitePanel() {
  const settings = useAppStore((state) => state.settings);
  const ui = useMemo(() => getUiCopy(settings), [settings]);
  const [state, setState] = useState<OllamaSuiteState>(initialState);
  const [name, setName] = useState("Local Ollama");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<OllamaProviderRecord | null>(null);
  const [pendingReset, setPendingReset] = useState(false);
  const removeButtonRef = useRef<HTMLButtonElement | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement | null>(null);
  const endpointError = endpoint.trim().length === 0 || isOllamaEndpoint(endpoint)
    ? null
    : ui.text("Use a credential-free loopback URL such as http://127.0.0.1:11434.", "請用冇憑證嘅 loopback URL，例如 http://127.0.0.1:11434。");
  const lastRefreshLabel = state.updatedAt
    ? ui.text(`Last verified refresh: ${state.updatedAt}`, `上次驗證更新：${state.updatedAt}`)
    : ui.text("No successful local refresh yet.", "仲未有成功嘅本機更新。");
  const importRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    window.api.getOllamaSuiteState().then((next) => { if (alive) setState(next); }).catch((reason) => { if (alive) setError(errorMessage(reason)); });
    return () => { alive = false; };
  }, []);

  async function addProvider() {
    setBusy("add"); setError(null); setStatus(null);
    try {
      const next = await window.api.addOllamaProvider({ name, endpoint });
      setState(next); setName("Local Ollama"); setEndpoint("http://127.0.0.1:11434");
      setStatus(ui.text("Provider saved locally. Credentials are never accepted in this foundation.", "供應者已儲存喺本機；呢個地基唔接受任何憑證。"));
    } catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); }
  }

  async function refresh(provider: OllamaProviderRecord) {
    setBusy(provider.id); setError(null); setStatus(null);
    try {
      const result = await window.api.refreshOllamaProvider(provider.id);
      setState(result.state);
      setStatus(ui.text(`Read ${result.modelCount} installed model${result.modelCount === 1 ? "" : "s"} from Ollama's local API.`, `喺 Ollama 本機 API 讀到 ${result.modelCount} 個已安裝模型。`));
    } catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); }
  }

  async function removeProvider(provider: OllamaProviderRecord) {
    setBusy(provider.id); setError(null); setStatus(null);
    try { setState(await window.api.removeOllamaProvider(provider.id)); setStatus(ui.text("Provider and its observed local models were removed.", "供應者同佢觀察到嘅本機模型已移除。")); }
    catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); setPendingRemoval(null); }
  }

  async function exportMetadata() {
    setBusy("export"); setError(null); setStatus(null);
    try {
      const result = await window.api.exportOllamaMetadata("json");
      if (!navigator.clipboard?.writeText) throw new Error(ui.text("Clipboard access is unavailable. Copy the JSON from the export result instead.", "剪貼簿未能使用；請由匯出結果手動複製 JSON。"));
      await navigator.clipboard.writeText(result.content);
      setStatus(ui.text("Metadata export copied. It omits credentials, the cloud catalog, and chat history.", "資料標籤匯出已複製；內容省略憑證、雲端目錄同聊天紀錄。"));
    } catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); }
  }

  async function importMetadata() {
    setBusy("import"); setError(null); setStatus(null);
    try {
      const parsed: unknown = JSON.parse(importText);
      setState(await window.api.importOllamaMetadata(parsed));
      setImportText(""); setStatus(ui.text("Metadata imported locally. No credential material was accepted.", "資料標籤已匯入本機；冇接受任何憑證資料。"));
    } catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); }
  }

  async function resetState() {
    setBusy("reset"); setError(null); setStatus(null);
    try {
      setState(await window.api.resetOllamaSuiteState());
      setStatus(ui.text("Local Ollama metadata was reset. No credentials were changed.", "本機 Ollama 資料標籤已重設；冇改動任何憑證。"));
    } catch (reason) { setError(reportOllamaError(ui, reason)); }
    finally { setBusy(null); setPendingReset(false); }
  }

  return (
    <section className="settings-section ollama-suite-panel" id="settings-ollama-suite" tabIndex={-1} aria-labelledby="ollama-suite-heading">
      <div className="settings-section-heading" id="ollama-suite-heading">{ui.text("Local Ollama suite", "本機 Ollama 管理器")}</div>
      <p className="setting-helper">
        {ui.funny(
          ["This foundation keeps Ollama local: it reads installed models only from an explicitly saved loopback endpoint.", "This foundation keeps Ollama local and the paperwork modest.", "No cloud proxy, no arbitrary program launcher, and no model-name guessing live here.", "The local API gets a small, well-labelled cupboard; it does not get the keys to the whole machine.", "The Ollama cupboard is local, bounded, and refuses to dress a cloud service as a localhost friend."],
          ["呢個地基只留喺本機：只會由你明確儲存嘅 loopback endpoint 讀已安裝模型。", "呢個地基留喺本機，文件都唔使寫到咁長。", "冇雲端 proxy、冇任意程式啟動器，亦唔會靠模型名估能力。", "本機 API 有個細細個、有標籤嘅櫃，唔會攞晒部機嘅鎖匙。", "Ollama 個櫃留喺本機、有界線，唔會扮雲端服務係 localhost 老友。"]
        )}
      </p>
      <p className="setting-helper"><strong>{ui.text("Not shipped in this foundation:", "呢個地基未提供：")}</strong> {ui.text("exhaustive cloud catalog, chat, attachments, or harness launch. Those remain honest unavailable states rather than fake controls.", "完整雲端目錄、聊天、附件或者 harness 啟動；呢啲會保持誠實嘅未提供狀態，唔會整假掣。")}</p>

      <div className="ollama-provider-form" aria-label={ui.text("Add local Ollama provider", "加入本機 Ollama 供應者")}>
        <label className="field"><span className="field-label">{ui.text("Provider name", "供應者名稱")}</span><input aria-label={ui.text("Provider name", "供應者名稱")} className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={128} /></label>
        <label className="field"><span className="field-label">{ui.text("Loopback endpoint", "Loopback endpoint")}</span><input aria-label={ui.text("Loopback endpoint", "Loopback endpoint")} className="input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} maxLength={2_048} placeholder="http://127.0.0.1:11434" aria-invalid={endpointError ? true : undefined} aria-describedby={endpointError ? "ollama-endpoint-error" : undefined} /><span id="ollama-endpoint-error" className="field-error" role="alert">{endpointError}</span></label>
        <button type="button" className="btn btn-primary" onClick={() => void addProvider()} disabled={busy !== null || name.trim().length === 0 || Boolean(endpointError)} title={endpointError ?? (busy !== null ? ui.text("Wait for the current Ollama operation to finish.", "請等目前 Ollama 操作完成。") : undefined)}>{ui.text("Add provider", "加入供應者")}</button>
      </div>
      <p className="setting-helper">{ui.text("Only credential-free localhost, 127.0.0.1, or ::1 HTTP(S) endpoints are accepted. No URL credentials, paths, redirects, or cloud hosts.", "只接受冇憑證嘅 localhost、127.0.0.1 或 ::1 HTTP(S) endpoint；唔接受 URL 憑證、路徑、redirect 或雲端主機。")}</p>

      <div className="ollama-provider-list" aria-live="polite">
        {state.providers.length === 0 ? <p className="empty-state">{ui.text("No local Ollama providers yet. Add one above to begin.", "仲未有本機 Ollama 供應者；喺上面加入一個先開始。")}</p> : state.providers.map((provider) => (
          <article className="ollama-provider-card" key={provider.id}>
            <div><h3>{provider.name}</h3><code>{provider.endpoint}</code><p className="setting-helper">{provider.probe.state === "healthy" ? ui.text(`Healthy · ${provider.probe.modelCount} installed model${provider.probe.modelCount === 1 ? "" : "s"}`, `健康 · ${provider.probe.modelCount} 個已安裝模型`) : provider.probe.state === "unavailable" ? `${ui.text("Unavailable", "未可用")}: ${provider.probe.detail ?? ui.text("No detail", "冇詳細資料")}` : ui.text("Not checked yet", "未檢查")}</p></div>
            <div className="ollama-provider-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh(provider)} disabled={busy !== null} title={busy !== null ? ui.text("Wait for the current Ollama operation to finish.", "請等目前 Ollama 操作完成。") : undefined}>{busy === provider.id ? ui.text("Checking…", "檢查緊…") : ui.text("Refresh models", "更新模型")}</button><button type="button" ref={removeButtonRef} className="btn btn-ghost btn-sm" onClick={(event) => { removeButtonRef.current = event.currentTarget; setPendingRemoval(provider); }} disabled={busy !== null} title={busy !== null ? ui.text("Wait for the current Ollama operation to finish.", "請等目前 Ollama 操作完成。") : undefined}>{ui.text("Remove", "移除")}</button></div>
          </article>
        ))}
      </div>
      <p className="setting-helper" role="status">{lastRefreshLabel}</p>

      <div className="ollama-models" aria-labelledby="ollama-models-heading"><h3 id="ollama-models-heading">{ui.text("Installed model inventory", "已安裝模型清單")}</h3>{state.installedModels.length === 0 ? <p className="empty-state">{ui.text("No verified local model inventory yet.", "仲未有已驗證嘅本機模型清單。")}</p> : <ul>{state.installedModels.map((model) => <li key={model.id}><strong>{model.name}</strong><span>{modelSize(model.sizeBytes, ui.text)} · {model.details.parameterSize ?? ui.text("parameters unknown", "參數未知")}</span></li>)}</ul>}</div>

      <div className="ollama-metadata" aria-labelledby="ollama-metadata-heading"><h3 id="ollama-metadata-heading">{ui.text("Metadata transfer", "資料標籤轉移")}</h3><p className="setting-helper">{ui.text("JSON metadata is local and re-importable. It never carries API credentials, the exhaustive cloud catalog, or chat history.", "JSON 資料標籤只喺本機，可重新匯入；永遠唔會帶 API 憑證、完整雲端目錄或者聊天紀錄。")}</p><div className="ollama-metadata-actions"><button type="button" className="btn btn-ghost" onClick={() => void exportMetadata()} disabled={busy !== null}>{ui.text("Copy JSON metadata", "複製 JSON 資料標籤")}</button><button type="button" className="btn btn-ghost" onClick={() => importRef.current?.focus()} disabled={busy !== null}>{ui.text("Focus import", "聚焦匯入")}</button></div><textarea ref={importRef} className="input ollama-import" value={importText} maxLength={2_097_152} onChange={(event) => setImportText(event.target.value)} placeholder={ui.text("Paste a metadata export JSON object", "貼上資料標籤匯出 JSON 物件")} aria-label={ui.text("Metadata import JSON", "資料標籤匯入 JSON")} /><button type="button" className="btn btn-primary" onClick={() => void importMetadata()} disabled={busy !== null || importText.trim().length === 0}>{ui.text("Import metadata", "匯入資料標籤")}</button></div>

      {error && <div className="field-error" role="alert"><p>{ui.funny([error, `${error} The reported detail is unchanged.`, `${error} The local API has filed its objection.`, `${error} Facts first; the endpoint remains the endpoint.`, `${error} The cupboard declines this paperwork, quite accurately.`], [error, `${error}，錯誤原文保持不變。`, `${error}，本機 API 已經正式提出反對。`, `${error}，事實行先，endpoint 仍然係 endpoint。`, `${error}，個櫃好準確咁拒絕呢份文件。`])}</p><button type="button" ref={resetButtonRef} className="btn btn-ghost btn-sm" onClick={(event) => { resetButtonRef.current = event.currentTarget; setPendingReset(true); }} disabled={busy !== null}>{ui.text("Reset local Ollama metadata", "重設本機 Ollama 資料標籤")}</button></div>}
      {status && <p className="setting-helper" role="status">{status}</p>}
      {pendingRemoval && <DestructiveActionGate request={{ itemIds: [pendingRemoval.id], deleteFile: false }} returnFocusRef={removeButtonRef} actionName={ui.text("remove this local Ollama provider and its observed model inventory", "移除呢個本機 Ollama 供應者同佢觀察到嘅模型清單")} affectedLabel={ui.text("provider", "供應者")} onCancel={() => setPendingRemoval(null)} onConfirm={() => void removeProvider(pendingRemoval)} />}
      {pendingReset && <DestructiveActionGate request={{ itemIds: ["ollama-suite-state"], deleteFile: false }} returnFocusRef={resetButtonRef} actionName={ui.text("reset the saved local Ollama metadata", "重設已儲存嘅本機 Ollama 資料標籤")} affectedLabel={ui.text("metadata record", "資料標籤記錄")} onCancel={() => setPendingReset(false)} onConfirm={() => void resetState()} />}
    </section>
  );
}
