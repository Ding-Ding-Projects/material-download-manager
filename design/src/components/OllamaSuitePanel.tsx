import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultRegexBuilderState, type RegexBuilderState } from "@shared/regex";
import {
  isOllamaEndpoint,
  type OllamaChatAttachment,
  type OllamaChatSession,
  type OllamaInstalledModelRecord,
  type OllamaProviderRecord,
  type OllamaSuiteState,
} from "@shared/ollama";
import { getUiCopy } from "../i18n/ui";
import { useAppStore } from "../store/useAppStore";
import DestructiveActionGate from "./DestructiveActionGate";
import { notify } from "./NotificationCenter";
import RegexBuilder from "./RegexBuilder";

function initialState(): OllamaSuiteState {
  return {
    schemaVersion: 2, providers: [], installedModels: [], runningModels: [], modelDetails: [], hardware: null,
    fitEvidence: [], catalog: { availability: "unavailable-by-policy", checkedAt: null, reason: "The documented local Ollama API does not expose an exhaustive official catalog endpoint. Remote catalog services and credentials are disabled by this app.", cachedAt: null, sourceRevision: null, pageCount: 0, complete: false },
    pullBatches: [], chats: [], harnessProfiles: [], harnessSnapshots: [], updatedAt: null,
  };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function modelSize(value: number | null, text: (english: string, cantonese: string) => string): string {
  if (value === null) return text("Unknown size", "大小未知");
  if (value < 1024 * 1024) return `${value} B`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fitLabel(value: string | undefined, text: (english: string, cantonese: string) => string): string {
  if (value === "runs-well") return text("Runs well", "運行良好");
  if (value === "runs-with-limits") return text("Runs with limits", "可以運行但有限制");
  if (value === "unlikely") return text("Unlikely", "不太可能");
  return text("Unknown", "未知");
}

function statusLabel(value: OllamaProviderRecord["probe"]["state"], text: (english: string, cantonese: string) => string): string {
  if (value === "healthy") return text("Healthy", "健康");
  if (value === "missing-runtime") return text("Compatible runtime missing", "缺少相容 runtime");
  if (value === "stopped") return text("Runtime stopped", "runtime 已停止");
  if (value === "unhealthy") return text("Runtime unhealthy", "runtime 不健康");
  return text("Not checked", "未檢查");
}

function hasSearchMatch(value: string, state: RegexBuilderState): boolean {
  if (!state.pattern) return true;
  if (state.mode === "text") return value.toLocaleLowerCase().includes(state.pattern.toLocaleLowerCase());
  try { return new RegExp(state.pattern, state.flags).test(value); } catch { return false; }
}

async function readLocalImage(file: File): Promise<OllamaChatAttachment> {
  const types = ["image/jpeg", "image/png", "image/webp"] as const;
  if (!types.includes(file.type as (typeof types)[number])) throw new Error("Choose a JPEG, PNG, or WebP image for the local vision-capable model.");
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("Local image attachments must be between 1 byte and 5 MiB.");
  const source = await file.arrayBuffer();
  const bytes = new Uint8Array(source);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name.slice(0, 256), mimeType: file.type as OllamaChatAttachment["mimeType"], dataBase64: btoa(binary) };
}

function downloadExport(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function OllamaSuitePanel() {
  const settings = useAppStore((store) => store.settings);
  const ui = useMemo(() => getUiCopy(settings), [settings]);
  const [state, setState] = useState<OllamaSuiteState>(initialState);
  const [name, setName] = useState("Local Ollama");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModelNames, setSelectedModelNames] = useState<string[]>([]);
  const [manualPullTag, setManualPullTag] = useState("");
  const [copyDestination, setCopyDestination] = useState("");
  const [activeChatId, setActiveChatId] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatAttachments, setChatAttachments] = useState<OllamaChatAttachment[]>([]);
  const [chatSystemPrompt, setChatSystemPrompt] = useState("");
  const [chatTemperature, setChatTemperature] = useState("0.7");
  const [chatNumCtx, setChatNumCtx] = useState("4096");
  const [chatKeepAlive, setChatKeepAlive] = useState("5m");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [modelSearch, setModelSearch] = useState<RegexBuilderState>(createDefaultRegexBuilderState);
  const [showModelRegex, setShowModelRegex] = useState(false);
  const [harnessName, setHarnessName] = useState("");
  const [harnessExecutable, setHarnessExecutable] = useState<string | null>(null);
  const [harnessFolder, setHarnessFolder] = useState<string | null>(null);
  const [selectedHarnessId, setSelectedHarnessId] = useState("");
  const [metadataText, setMetadataText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<OllamaInstalledModelRecord | null>(null);
  const [pendingDeleteChat, setPendingDeleteChat] = useState<OllamaChatSession | null>(null);
  const deleteModelRef = useRef<HTMLButtonElement | null>(null);
  const deleteChatRef = useRef<HTMLButtonElement | null>(null);
  const endpointError = endpoint.trim().length === 0 || isOllamaEndpoint(endpoint)
    ? null
    : ui.text("Use a credential-free loopback URL such as http://127.0.0.1:11434.", "請用冇憑證嘅 loopback URL，例如 http://127.0.0.1:11434。");

  useEffect(() => {
    let alive = true;
    void window.api.getOllamaSuiteState().then((next) => { if (alive) setState(next); }).catch((reason) => { if (alive) setError(errorMessage(reason)); });
    const unsubscribe = window.api.onOllamaSuiteStateChanged((next) => { if (alive) setState(next); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!selectedProviderId && state.providers[0]) setSelectedProviderId(state.providers[0].id);
    if (selectedProviderId && !state.providers.some((provider) => provider.id === selectedProviderId)) setSelectedProviderId(state.providers[0]?.id ?? "");
  }, [selectedProviderId, state.providers]);

  useEffect(() => {
    if (!activeChatId && state.chats[0]) setActiveChatId(state.chats[0].id);
    if (activeChatId && !state.chats.some((chat) => chat.id === activeChatId)) setActiveChatId(state.chats[0]?.id ?? "");
  }, [activeChatId, state.chats]);

  const provider = state.providers.find((candidate) => candidate.id === selectedProviderId) ?? null;
  const providerModels = state.installedModels.filter((model) => model.providerId === provider?.id);
  const filteredModels = providerModels.filter((model) => hasSearchMatch(`${model.name} ${model.details.family ?? ""} ${model.details.parameterSize ?? ""} ${model.details.quantizationLevel ?? ""}`, modelSearch));
  const selectedModel = providerModels.find((model) => selectedModelNames.includes(model.name)) ?? providerModels[0] ?? null;
  const activeChat = state.chats.find((chat) => chat.id === activeChatId) ?? null;
  const activeChatDetails = activeChat ? state.modelDetails.find((detail) => detail.providerId === activeChat.providerId && detail.modelName === activeChat.model) : null;
  const attachmentSupported = Boolean(activeChatDetails?.capabilities.includes("vision"));
  const chatTemperatureValue = Number(chatTemperature);
  const chatNumCtxValue = Number(chatNumCtx);
  const chatParametersValid = Number.isFinite(chatTemperatureValue) && chatTemperatureValue >= 0 && chatTemperatureValue <= 2
    && Number.isSafeInteger(chatNumCtxValue) && chatNumCtxValue >= 128 && chatNumCtxValue <= 16_777_216
    && /^\d+(?:s|m|h)$|^0$/u.test(chatKeepAlive);

  async function act<T extends OllamaSuiteState>(key: string, operation: () => Promise<T>, success?: string): Promise<T | null> {
    setBusy(key); setError(null); setMessage(null);
    try {
      const next = await operation();
      setState(next);
      if (success) setMessage(success);
      return next;
    } catch (reason) {
      const detail = errorMessage(reason);
      setError(detail);
      notify({ title: ui.text("Ollama operation failed", "Ollama 操作失敗"), message: detail, tone: "error" });
      return null;
    } finally { setBusy(null); }
  }

  async function addProvider() {
    const next = await act("add", () => window.api.addOllamaProvider({ name, endpoint }), ui.text("Local provider saved. Refresh it to read the documented runtime health and inventory.", "本機供應者已儲存；而家更新可以讀取已記錄嘅 runtime 健康狀態同清單。"));
    if (next) { setSelectedProviderId(next.providers.find((candidate) => candidate.endpoint === endpoint)?.id ?? ""); setName("Local Ollama"); setEndpoint("http://127.0.0.1:11434"); }
  }

  async function refreshProvider() {
    if (!provider) return;
    await act(`refresh-${provider.id}`, () => window.api.refreshOllamaProvider(provider.id), ui.text("Local runtime health, version, installed models, and running models were refreshed.", "本機 runtime 健康狀態、版本、已安裝模型同運行中模型已更新。"));
  }

  async function refreshDetails(model: OllamaInstalledModelRecord) {
    if (!provider) return;
    await act(`details-${model.id}`, () => window.api.refreshOllamaModelDetails(provider.id, model.name), ui.text("Verified local model details and capability evidence were refreshed.", "已驗證本機模型詳細資料同能力證據已更新。"));
  }

  function toggleModel(nameValue: string) {
    setSelectedModelNames((current) => current.includes(nameValue) ? current.filter((nameItem) => nameItem !== nameValue) : [...current, nameValue]);
  }

  function addManualPullTag() {
    const candidate = manualPullTag.trim();
    if (!candidate) return;
    if (/\s|[\u0000-\u001f]/u.test(candidate) || candidate.length > 256) { setError(ui.text("Enter a bounded model tag without spaces or control characters.", "請輸入有上限、冇空格同控制字元嘅模型 tag。")); return; }
    setSelectedModelNames((current) => current.includes(candidate) ? current : [...current, candidate]);
    setManualPullTag("");
  }

  async function startPull() {
    if (!provider || selectedModelNames.length === 0) return;
    await act("pull", () => window.api.startOllamaPullBatch({ providerId: provider.id, models: selectedModelNames, parallelism: 2 }), ui.text("The local batch pull was queued with bounded parallelism. Progress remains in this panel.", "本機批量拉取已用有上限並行度排隊；進度會留喺呢個面板。"));
  }

  async function copyModel() {
    if (!provider || !selectedModel || !copyDestination.trim()) return;
    const next = await act("copy", () => window.api.copyOllamaModel(provider.id, { source: selectedModel.name, destination: copyDestination }), ui.text("The local model copy completed and the installed inventory was refreshed.", "本機模型複製完成，已安裝清單亦已更新。"));
    if (next) setCopyDestination("");
  }

  async function createChat() {
    if (!provider || !selectedModel) return;
    if (!chatParametersValid) { setError(ui.text("Use temperature from 0 to 2, an integer context from 128 to 16,777,216, and a keep-alive such as 5m.", "請用 0 至 2 嘅 temperature、128 至 16,777,216 嘅整數 context，同埋例如 5m 嘅 keep-alive。")); return; }
    const next = await act("create-chat", () => window.api.createOllamaChat({ providerId: provider.id, model: selectedModel.name, name: selectedModel.name, systemPrompt: chatSystemPrompt, temperature: chatTemperatureValue, numCtx: chatNumCtxValue, keepAlive: chatKeepAlive }), ui.text("A local chat session was created. Select Refresh details before attaching images.", "本機聊天工作階段已建立；附加圖片前請先更新詳細資料。"));
    if (next?.chats[0]) setActiveChatId(next.chats[0].id);
  }

  async function generate() {
    if (!provider || !selectedModel || !generatePrompt.trim()) return;
    if (!chatParametersValid) { setError(ui.text("Correct the generation parameters before starting.", "開始前請更正生成參數。")); return; }
    const next = await act("generate", () => window.api.generateOllama({ providerId: provider.id, model: selectedModel.name, prompt: generatePrompt, systemPrompt: chatSystemPrompt, temperature: chatTemperatureValue, numCtx: chatNumCtxValue, keepAlive: chatKeepAlive }), ui.text("Local generation started and is retained as a redacted-exportable session.", "本機生成已開始，會留做可經遮減匯出嘅工作階段。"));
    if (next?.chats[0]) { setActiveChatId(next.chats[0].id); setGeneratePrompt(""); }
  }

  async function chooseAttachments(files: FileList | null) {
    if (!files) return;
    try {
      const additions = await Promise.all([...files].slice(0, 4).map(readLocalImage));
      setChatAttachments((current) => [...current, ...additions].slice(0, 4));
      setMessage(ui.text("Local image attachment prepared in memory only. It is never saved with chat history.", "本機圖片附件只會暫存在記憶體，唔會跟聊天紀錄儲存。"));
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function sendChat() {
    if (!activeChat || !chatText.trim()) return;
    const next = await act("send-chat", () => window.api.sendOllamaChat({ sessionId: activeChat.id, content: chatText, attachments: chatAttachments }), undefined);
    if (next) { setChatText(""); setChatAttachments([]); }
  }

  async function exportChat() {
    if (!activeChat) return;
    setBusy("export-chat"); setError(null);
    try {
      const result = await window.api.exportOllamaChat(activeChat.id, "json");
      downloadExport(result.content, `ollama-chat-${activeChat.id}.${result.extension}`, result.mimeType);
      setMessage(ui.text("Redacted local chat export downloaded. Attachments, credentials, environment values, and private paths were omitted or redacted.", "經遮減嘅本機聊天匯出已下載；附件、憑證、環境資料同私人路徑已省略或遮減。"));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function exportMetadata() {
    setBusy("export-metadata"); setError(null);
    try {
      const result = await window.api.exportOllamaMetadata("json");
      setMetadataText(result.content);
      setMessage(ui.text("Local suite metadata was prepared. It omits credentials, chats, attachments, harness snapshots, and any official catalog.", "本機套件資料標籤已準備好；會省略憑證、聊天、附件、harness 快照同任何官方目錄。"));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function importMetadata() {
    let parsed: unknown;
    try { parsed = JSON.parse(metadataText); } catch { setError(ui.text("Enter a valid local metadata JSON export before importing.", "匯入前請輸入有效嘅本機資料標籤 JSON 匯出。")); return; }
    const next = await act("import-metadata", () => window.api.importOllamaMetadata(parsed), ui.text("Local suite metadata imported. A fresh local runtime refresh is still required.", "本機套件資料標籤已匯入；仍然要重新更新本機 runtime。"));
    if (next) setMetadataText("");
  }

  async function chooseHarnessExecutable() {
    const selected = await window.api.pickOllamaHarnessExecutable();
    if (selected) setHarnessExecutable(selected);
  }

  async function chooseHarnessFolder() {
    const selected = await window.api.pickOllamaHarnessFolder();
    if (selected) setHarnessFolder(selected);
  }

  async function registerHarness() {
    if (!harnessName.trim() || !harnessExecutable || !harnessFolder) return;
    const next = await act("register-harness", () => window.api.registerOllamaHarness({ name: harnessName, executablePath: harnessExecutable, workingDirectory: harnessFolder, arguments: ["--model", "{model}"] }), ui.text("The selected executable was registered as an allowlisted local harness profile. It will never run through a shell.", "已揀嘅 executable 已註冊做白名單本機 harness profile；永遠唔會經 shell 執行。"));
    if (next) { setHarnessName(""); setHarnessExecutable(null); setHarnessFolder(null); setSelectedHarnessId(next.harnessProfiles[next.harnessProfiles.length - 1]?.id ?? ""); }
  }

  async function preflightHarness(launch: boolean) {
    if (!provider || !selectedModel || !selectedHarnessId) return;
    const input = { profileId: selectedHarnessId, providerId: provider.id, model: selectedModel.name };
    await act(launch ? "launch-harness" : "preflight-harness", () => launch ? window.api.launchOllamaHarness(input) : window.api.preflightOllamaHarness(input), launch
      ? ui.text("The selected harness launch was verified through its allowlisted preflight.", "已透過白名單 preflight 驗證所選 harness 啟動。")
      : ui.text("Harness preflight stored an app-managed snapshot. Restore is available below.", "harness preflight 已儲存 app 管理嘅快照；可以喺下面還原。"));
  }

  if (settings?.schoolModeEnabled) return null;

  return (
    <section className="settings-section ollama-suite-panel" id="settings-ollama-suite" tabIndex={-1} aria-labelledby="ollama-suite-heading">
      <div className="settings-section-heading" id="ollama-suite-heading">{ui.text("Local Ollama suite", "本機 Ollama 管理器")}</div>
      <p className="setting-helper">{ui.funny(
        ["Run, inspect, pull, chat with, and manage your local Ollama runtime here. Every request stays on a credential-free loopback endpoint.", "Your local models get a real control room: health, evidence, pulling, chat, and carefully fenced harnesses.", "This is a local model desk, not a mysterious cloud vending machine."],
        ["喺度管理你本機 Ollama runtime：運行、檢查、拉取、聊天；每個要求都只會留喺冇憑證嘅 loopback endpoint。", "本機模型有真正控制室：健康、證據、拉取、聊天同有圍欄嘅 harness。", "呢度係本機模型工作枱，唔係神秘雲端販賣機。"]
      )}</p>

      <section className="ollama-card ollama-catalog-boundary" aria-labelledby="ollama-catalog-heading">
        <div><h3 id="ollama-catalog-heading">{ui.text("Official Model Store boundary", "官方模型商店界線")}</h3><p>{ui.text("The documented local Ollama API does not enumerate the exhaustive official catalog. This app refuses to invent a catalog, use an undocumented endpoint, or send credentials to a remote service. The installed local inventory remains available below.", "已記錄嘅本機 Ollama API 唔會列出完整官方目錄。呢個 app 拒絕捏造目錄、用未記錄 endpoint 或者將憑證送去遠端服務；已安裝本機清單仍然喺下面可用。")}</p></div>
        <div className="button-row"><button type="button" className="btn btn-ghost" onClick={() => void act("catalog", () => window.api.refreshOllamaCatalogCapability(), ui.text("The strict local-only catalog boundary was rechecked.", "嚴格本機目錄界線已重新檢查。"))} disabled={busy !== null}>{ui.text("Recheck boundary", "重新檢查界線")}</button><span className="status-chip status-warning">{ui.text("Unavailable by policy", "由政策限制不可用")}</span></div>
        <p className="setting-helper">{state.catalog.checkedAt ? ui.text(`Last checked: ${state.catalog.checkedAt}`, `上次檢查：${state.catalog.checkedAt}`) : ui.text("Not checked in this session yet.", "今個工作階段仲未檢查。")}</p>
      </section>

      <section className="ollama-card" aria-labelledby="ollama-provider-heading">
        <div className="ollama-section-header"><div><h3 id="ollama-provider-heading">{ui.text("Local runtime and provider", "本機 runtime 同供應者")}</h3><p>{ui.text("Choose an explicitly saved loopback endpoint. No cloud host, URL credential, redirect, or arbitrary network route is accepted.", "請揀明確儲存嘅 loopback endpoint；唔接受雲端主機、URL 憑證、redirect 或任意網絡路線。")}</p></div></div>
        <div className="ollama-provider-form" aria-label={ui.text("Add local Ollama provider", "加入本機 Ollama 供應者")}>
          <label className="field"><span className="field-label">{ui.text("Provider name", "供應者名稱")}</span><input aria-label={ui.text("Provider name", "供應者名稱")} className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={128} /></label>
          <label className="field"><span className="field-label">{ui.text("Loopback endpoint", "Loopback endpoint")}</span><input aria-label={ui.text("Loopback endpoint", "Loopback endpoint")} className="input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} maxLength={2_048} placeholder="http://127.0.0.1:11434" aria-invalid={endpointError ? true : undefined} aria-describedby={endpointError ? "ollama-endpoint-error" : undefined} /><span id="ollama-endpoint-error" className="field-error" role="alert">{endpointError}</span></label>
          <button type="button" className="btn btn-primary" onClick={() => void addProvider()} disabled={busy !== null || !name.trim() || Boolean(endpointError)}>{busy === "add" ? ui.text("Saving…", "儲存緊…") : ui.text("Add provider", "加入供應者")}</button>
        </div>
        {state.providers.length > 0 && <div className="ollama-toolbar"><label className="field"><span className="field-label">{ui.text("Active local provider", "使用中本機供應者")}</span><select className="input" aria-label={ui.text("Active local provider", "使用中本機供應者")} value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>{state.providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button type="button" className="btn btn-primary" onClick={() => void refreshProvider()} disabled={!provider || busy !== null}>{busy?.startsWith("refresh-") ? ui.text("Refreshing…", "更新緊…") : ui.text("Refresh local runtime", "更新本機 runtime")}</button><button type="button" className="btn btn-ghost" onClick={() => void act("hardware", () => window.api.probeOllamaHardware(), ui.text("Local RAM, disk, and available GPU evidence were refreshed.", "本機 RAM、磁碟同可用 GPU 證據已更新。"))} disabled={busy !== null}>{ui.text("Refresh hardware evidence", "更新硬件證據")}</button></div>}
        {provider && <div className="ollama-runtime-summary" role="status"><strong>{statusLabel(provider.probe.state, ui.text)}</strong><span>{provider.probe.runtimeVersion ? ` · v${provider.probe.runtimeVersion}` : ""}</span><span>{provider.probe.checkedAt ? ` · ${provider.probe.checkedAt}` : ""}</span><p>{provider.probe.detail ?? ui.text(`${provider.probe.modelCount} installed model(s), ${provider.probe.runningModelCount} running model(s).`, `${provider.probe.modelCount} 個已安裝模型、${provider.probe.runningModelCount} 個運行中模型。`)}</p>{provider.probe.state !== "healthy" && <p className="setting-helper">{ui.text("Recovery: install or start the official Ollama runtime for this device, then select Refresh local runtime. This app does not run shell commands or chase browser downloads for you.", "復原方法：為呢部裝置安裝或啟動官方 Ollama runtime，然後撳更新本機 runtime。呢個 app 唔會幫你跑 shell 指令或者亂開瀏覽器下載。")}</p>}</div>}
      </section>

      <section className="ollama-card" aria-labelledby="ollama-models-heading">
        <div className="ollama-section-header"><div><h3 id="ollama-models-heading">{ui.text("Local Model Store", "本機模型商店")}</h3><p>{ui.text("This verified local inventory combines installed tags, running-model facts, saved detail capabilities, and conservative fit evidence. It does not claim to be the official catalog.", "呢個已驗證本機清單結合已安裝 tags、運行中模型資料、已儲存詳細能力同保守適配證據；唔會扮係官方目錄。")}</p></div></div>
        {!provider ? <p className="empty-state">{ui.text("Add a local provider above, then refresh it to populate guided model choices.", "先喺上面加入本機供應者，再更新佢去載入引導式模型選項。")}</p> : <>
          <div className="ollama-search-row"><label className="field"><span className="field-label">{ui.text("Search local models", "搜尋本機模型")}</span><input className="input" aria-label={ui.text("Search local models", "搜尋本機模型")} value={modelSearch.pattern} onChange={(event) => setModelSearch((current) => ({ ...current, pattern: event.target.value, mode: "text" }))} placeholder={ui.text("Plain-text model, family, size, or quantization", "純文字模型、family、大小或 quantization")}/></label><button type="button" className="btn btn-ghost" aria-expanded={showModelRegex} aria-controls="ollama-model-search-regex" onClick={() => setShowModelRegex((current) => !current)}>{ui.text("Regex builder", "Regex 建立器")}</button></div>
          {showModelRegex && <div id="ollama-model-search-regex" className="ollama-anchored-regex"><RegexBuilder value={modelSearch} onChange={setModelSearch} title={ui.text("Local Model Store search regex builder", "本機模型商店搜尋 regex 建立器")} text={ui.text}/></div>}
          <div className="ollama-bulk-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedModelNames(filteredModels.map((model) => model.name))}>{ui.text("Select search results", "選取搜尋結果")}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedModelNames((current) => providerModels.map((model) => model.name).filter((modelName) => !current.includes(modelName)))}>{ui.text("Inverse selection", "反選")}</button><span className="setting-helper">{ui.text(`${selectedModelNames.length} model tag(s) selected`, `已選 ${selectedModelNames.length} 個模型 tag`)}</span></div>
          <div className="ollama-model-list" aria-live="polite">{filteredModels.length === 0 ? <p className="empty-state">{ui.text("No verified local models match this search. Refresh the runtime or clear the search.", "冇已驗證本機模型符合呢個搜尋；請更新 runtime 或清除搜尋。")}</p> : filteredModels.map((model) => {
            const detail = state.modelDetails.find((item) => item.providerId === model.providerId && item.modelName === model.name);
            const fit = state.fitEvidence.find((item) => item.modelName === model.name);
            const running = state.runningModels.some((item) => item.providerId === model.providerId && item.name === model.name);
            return <article className="ollama-model-card" key={model.id}><label className="ollama-model-select"><input type="checkbox" aria-label={ui.text(`Select ${model.name} for local batch pull`, `選取 ${model.name} 做本機批量拉取`)} checked={selectedModelNames.includes(model.name)} onChange={() => toggleModel(model.name)}/><span>{model.name}</span></label><div className="ollama-model-facts"><span>{modelSize(model.sizeBytes, ui.text)}</span><span>{model.details.parameterSize ?? ui.text("parameters unknown", "參數未知")}</span><span>{model.details.quantizationLevel ?? ui.text("quantization unknown", "quantization 未知")}</span><span className={`status-chip status-${fit?.verdict ?? "unknown"}`}>{fitLabel(fit?.verdict, ui.text)}</span>{running && <span className="status-chip status-running">{ui.text("Running", "運行中")}</span>}</div><p className="setting-helper">{detail ? ui.text(`Capabilities: ${detail.capabilities.join(", ") || "none reported"}; context ${detail.contextLength ?? "unknown"}.`, `能力：${detail.capabilities.join(", ") || "冇回報"}；context ${detail.contextLength ?? "未知"}。`) : ui.text("Details not loaded. Refresh details to verify capabilities such as vision before enabling attachments.", "詳細資料未載入；請更新詳細資料以驗證 vision 等能力，先會啟用附件。")}</p><div className="button-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshDetails(model)} disabled={busy !== null}>{ui.text("Refresh details", "更新詳細資料")}</button><button type="button" className="btn btn-ghost btn-sm" onClick={(event) => { deleteModelRef.current = event.currentTarget; setPendingDeleteModel(model); }} disabled={busy !== null}>{ui.text("Delete local model", "刪除本機模型")}</button></div></article>;
          })}</div>
          <div className="ollama-guided-action-grid"><section><h4>{ui.text("Batch pull cart", "批量拉取車")}</h4><p className="setting-helper">{ui.text("A cart schedules local Ollama pulls only. It is never a payment, purchase, account, or subscription flow. Because the official catalog is unavailable under the strict local-only policy, choose verified local tags above or add a known tag explicitly with the boundary disclosed.", "個車只會安排本機 Ollama 拉取；從來唔係付款、購買、帳戶或訂閱流程。由於嚴格本機政策下官方目錄不可用，請喺上面選已驗證本機 tags，或者喺已揭示界線下明確加入已知 tag。")}</p><div className="button-row"><input className="input" list="ollama-known-tags" aria-label={ui.text("Add known local model tag to batch pull", "加入已知本機模型 tag 去批量拉取")} value={manualPullTag} onChange={(event) => setManualPullTag(event.target.value)} maxLength={256}/><datalist id="ollama-known-tags">{providerModels.map((model) => <option value={model.name} key={model.id}/>)}</datalist><button type="button" className="btn btn-ghost" onClick={addManualPullTag} disabled={busy !== null || !manualPullTag.trim()}>{ui.text("Add tag", "加入 tag")}</button><button type="button" className="btn btn-primary" onClick={() => void startPull()} disabled={busy !== null || selectedModelNames.length === 0}>{ui.text("Start local batch pull", "開始本機批量拉取")}</button></div></section><section><h4>{ui.text("Copy installed model", "複製已安裝模型")}</h4><p className="setting-helper">{selectedModel ? ui.text(`Source: ${selectedModel.name}`, `來源：${selectedModel.name}`) : ui.text("Select an installed source model above.", "請喺上面選擇已安裝來源模型。")}</p><div className="button-row"><input className="input" aria-label={ui.text("Local copied model destination", "本機複製模型目的地")} value={copyDestination} onChange={(event) => setCopyDestination(event.target.value)} maxLength={256} placeholder={ui.text("destination-tag", "目的地-tag")}/><button type="button" className="btn btn-ghost" onClick={() => void copyModel()} disabled={busy !== null || !selectedModel || !copyDestination.trim()}>{ui.text("Copy locally", "本機複製")}</button></div></section></div>
          <section className="ollama-generation-card" aria-labelledby="ollama-generate-heading"><h4 id="ollama-generate-heading">{ui.text("Quick local generation", "快速本機生成")}</h4><p className="setting-helper">{selectedModel ? ui.text(`Uses documented /api/generate with ${selectedModel.name}; the streamed result is saved as a local chat session so it can be stopped, searched, exported, or deleted later.`, `會用 ${selectedModel.name} 嘅已記錄 /api/generate；串流結果會儲成可停止、搜尋、匯出或之後刪除嘅本機聊天工作階段。`) : ui.text("Select a verified installed model to enable guided local generation.", "請先選已驗證安裝模型，先會啟用引導式本機生成。")}</p><label className="field"><span className="field-label">{ui.text("Generation prompt", "生成提示")}</span><textarea className="input ollama-import" aria-label={ui.text("Local generation prompt", "本機生成提示")} value={generatePrompt} onChange={(event) => setGeneratePrompt(event.target.value)} maxLength={32_768}/></label><button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={busy !== null || !selectedModel || !generatePrompt.trim() || !chatParametersValid}>{ui.text("Generate locally", "本機生成")}</button></section>
          {state.pullBatches.filter((batch) => batch.providerId === provider.id).length > 0 && <div className="ollama-batches" aria-labelledby="ollama-pulls-heading"><h4 id="ollama-pulls-heading">{ui.text("Local pull progress", "本機拉取進度")}</h4>{state.pullBatches.filter((batch) => batch.providerId === provider.id).map((batch) => <article className="ollama-batch-card" key={batch.id}><div><strong>{batch.state}</strong><span>{` · ${batch.items.filter((item) => item.state === "pulled").length}/${batch.items.length}`}</span><p className="setting-helper">{ui.text(`Storage preflight: ${modelSize(batch.storagePreflightBytes, ui.text)}; verified free space: ${modelSize(batch.availableDiskBytes, ui.text)}.`, `儲存 preflight：${modelSize(batch.storagePreflightBytes, ui.text)}；已驗證空間：${modelSize(batch.availableDiskBytes, ui.text)}。`)}</p></div><div className="button-row">{(batch.state === "running" || batch.state === "queued") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`cancel-pull-${batch.id}`, () => window.api.cancelOllamaPullBatch(batch.id), ui.text("The local pull batch was cancelled. Completed models stay installed.", "本機拉取批次已取消；已完成模型會保留。"))}>{ui.text("Cancel", "取消")}</button>}{(batch.state === "partial" || batch.state === "failed" || batch.state === "cancelled") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`retry-pull-${batch.id}`, () => window.api.retryOllamaPullBatch(batch.id), ui.text("Failed or cancelled local pull items were queued for retry.", "失敗或已取消嘅本機拉取項目已排隊重試。"))}>{ui.text("Retry failed or cancelled", "重試失敗或已取消項目")}</button>}</div><ul>{batch.items.map((item) => <li key={item.id}><span>{item.model}</span><span>{item.status}</span>{item.totalBytes !== null && <progress value={item.completedBytes ?? 0} max={item.totalBytes} aria-label={ui.text(`${item.model} pull progress`, `${item.model} 拉取進度`)}/>}<span>{item.error ?? ""}</span></li>)}</ul></article>)}</div>}
        </>}
      </section>

      <section className="ollama-card" aria-labelledby="ollama-chat-heading">
        <div className="ollama-section-header"><div><h3 id="ollama-chat-heading">{ui.text("Local chat sessions", "本機聊天工作階段")}</h3><p>{ui.text("Responses stream from the selected local model. Histories stay local; ordinary exports redact paths and omit attachments and credentials.", "回覆會由所選本機模型串流；紀錄只留喺本機，普通匯出會遮減路徑並省略附件同憑證。")}</p></div><button type="button" className="btn btn-primary" onClick={() => void createChat()} disabled={!provider || !selectedModel || busy !== null}>{ui.text("New local chat", "新本機聊天")}</button></div>
        {!activeChat ? <p className="empty-state">{ui.text("Choose a verified installed model above and create a local chat session.", "請喺上面選已驗證本機模型，再建立本機聊天工作階段。")}</p> : <><div className="ollama-chat-tabs" role="tablist" aria-label={ui.text("Local chat sessions", "本機聊天工作階段")}>{state.chats.map((chat) => <button type="button" role="tab" aria-selected={chat.id === activeChat.id} className="ollama-chat-tab" key={chat.id} onClick={() => setActiveChatId(chat.id)}>{chat.name}</button>)}</div><article className="ollama-chat-card"><div className="ollama-chat-header"><div><strong>{activeChat.model}</strong><span>{` · ${activeChat.state}`}</span><p className="setting-helper">{activeChat.error ?? ui.text("Local-only session", "只限本機工作階段")}</p></div><div className="button-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportChat()} disabled={busy !== null}>{ui.text("Export redacted JSON", "匯出經遮減 JSON")}</button>{activeChat.state === "streaming" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act("cancel-chat", () => window.api.cancelOllamaChat(activeChat.id), ui.text("The local response was asked to stop.", "已要求停止本機回覆。"))}>{ui.text("Stop", "停止")}</button>}<button type="button" className="btn btn-ghost btn-sm" ref={deleteChatRef} onClick={(event) => { deleteChatRef.current = event.currentTarget; setPendingDeleteChat(activeChat); }} disabled={busy !== null}>{ui.text("Delete session", "刪除工作階段")}</button></div></div><div className="ollama-chat-messages" aria-live="polite">{activeChat.messages.length === 0 ? <p className="empty-state">{ui.text("No messages yet. Enter a local prompt below.", "仲未有訊息；請喺下面輸入本機提示。")}</p> : activeChat.messages.map((chatMessage) => <article key={chatMessage.id} className={`ollama-chat-message ollama-chat-${chatMessage.role}`}><strong>{chatMessage.role}</strong><p>{chatMessage.content || (chatMessage.status === "streaming" ? ui.text("Streaming…", "串流中…") : "")}</p>{chatMessage.thinking && <details><summary>{ui.text("Model thinking", "模型思考")}</summary><pre>{chatMessage.thinking}</pre></details>}</article>)}</div><div className="ollama-chat-compose"><label className="field"><span className="field-label">{ui.text("Message", "訊息")}</span><textarea className="input ollama-import" aria-label={ui.text("Local chat message", "本機聊天訊息")} value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={32_768} disabled={activeChat.state === "streaming"}/></label><label className="field"><span className="field-label">{ui.text("Local image attachments", "本機圖片附件")}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label={ui.text("Local image attachments", "本機圖片附件")} disabled={!attachmentSupported || activeChat.state === "streaming"} onChange={(event) => void chooseAttachments(event.target.files)}/><span className="setting-helper">{attachmentSupported ? ui.text("Verified vision capability is available. Images stay in memory for this request and are never stored in chat history.", "已驗證有 vision 能力；圖片只會為今次要求暫存在記憶體，唔會儲存喺聊天紀錄。") : ui.text("Disabled until Refresh details verifies vision capability for this selected model. Choose another local model or refresh its details in Local Model Store.", "要等更新詳細資料驗證所選模型有 vision 能力先會啟用；請選另一個本機模型或者喺本機模型商店更新詳細資料。")}</span>{chatAttachments.length > 0 && <div className="ollama-attachment-list">{chatAttachments.map((attachment) => <span key={`${attachment.name}-${attachment.dataBase64.length}`}>{attachment.name}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setChatAttachments((current) => current.filter((item) => item !== attachment))}>{ui.text("Remove", "移除")}</button></span>)}</div>}</label><button type="button" className="btn btn-primary" onClick={() => void sendChat()} disabled={busy !== null || activeChat.state === "streaming" || !chatText.trim()}>{activeChat.state === "streaming" ? ui.text("Streaming…", "串流中…") : ui.text("Send local message", "傳送本機訊息")}</button></div></article></>}
      </section>

      <section className="ollama-card" aria-labelledby="ollama-harness-heading">
        <div className="ollama-section-header"><div><h3 id="ollama-harness-heading">{ui.text("Allowlisted harness profiles", "白名單 harness profiles")}</h3><p>{ui.text("Ollama does not launch arbitrary programs. This app can run only a user-selected .exe with approved placeholder arguments after a visible preflight and app-managed snapshot.", "Ollama 唔會啟動任意程式；呢個 app 只會喺可見 preflight 同 app 管理快照後，運行用戶揀嘅 .exe 配合已批准 placeholder 參數。")}</p></div></div>
        <div className="ollama-harness-form"><label className="field"><span className="field-label">{ui.text("Profile name", "Profile 名稱")}</span><input className="input" value={harnessName} onChange={(event) => setHarnessName(event.target.value)} maxLength={128}/></label><div className="button-row"><button type="button" className="btn btn-ghost" onClick={() => void chooseHarnessExecutable()}>{ui.text("Choose executable", "揀 executable")}</button><span>{harnessExecutable ?? ui.text("No executable selected", "未揀 executable")}</span></div><div className="button-row"><button type="button" className="btn btn-ghost" onClick={() => void chooseHarnessFolder()}>{ui.text("Choose working folder", "揀工作資料夾")}</button><span>{harnessFolder ?? ui.text("No working folder selected", "未揀工作資料夾")}</span></div><button type="button" className="btn btn-primary" onClick={() => void registerHarness()} disabled={busy !== null || !harnessName.trim() || !harnessExecutable || !harnessFolder}>{ui.text("Register allowlisted profile", "註冊白名單 profile")}</button></div>
        {state.harnessProfiles.length > 0 && <div className="ollama-harness-actions"><label className="field"><span className="field-label">{ui.text("Harness profile", "Harness profile")}</span><select className="input" aria-label={ui.text("Harness profile", "Harness profile")} value={selectedHarnessId} onChange={(event) => setSelectedHarnessId(event.target.value)}><option value="">{ui.text("Choose a profile", "揀一個 profile")}</option>{state.harnessProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button type="button" className="btn btn-ghost" onClick={() => void preflightHarness(false)} disabled={busy !== null || !provider || !selectedModel || !selectedHarnessId}>{ui.text("Preflight", "Preflight")}</button><button type="button" className="btn btn-primary" onClick={() => void preflightHarness(true)} disabled={busy !== null || !provider || !selectedModel || !selectedHarnessId}>{ui.text("Launch approved harness", "啟動已批准 harness")}</button></div>}
        {state.harnessSnapshots.length > 0 && <div className="ollama-snapshot-list"><h4>{ui.text("Harness snapshots and restore", "Harness 快照同還原")}</h4>{state.harnessSnapshots.slice(0, 8).map((snapshot) => <article key={snapshot.id}><strong>{snapshot.outcome}</strong><span>{` · ${snapshot.model}`}</span><p>{snapshot.detail}</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(`restore-${snapshot.id}`, () => window.api.restoreOllamaHarness(snapshot.id), ui.text("The app-managed harness selection was restored. External processes are never changed by restore.", "app 管理嘅 harness 選擇已還原；還原永遠唔會改動外部程序。"))} disabled={busy !== null}>{ui.text("Restore snapshot", "還原快照")}</button></article>)}</div>}
      </section>

      <section className="ollama-card" aria-labelledby="ollama-metadata-heading"><div><h3 id="ollama-metadata-heading">{ui.text("Local metadata transfer", "本機資料標籤轉移")}</h3><p>{ui.text("Metadata is versioned and local. It never includes credentials, chat messages, attachments, harness snapshots, or an official catalog.", "資料標籤有版本而且只留喺本機；永遠唔包括憑證、聊天訊息、附件、harness 快照或者官方目錄。")}</p></div><div className="button-row"><button type="button" className="btn btn-ghost" onClick={() => void exportMetadata()} disabled={busy !== null}>{ui.text("Prepare JSON metadata", "準備 JSON 資料標籤")}</button><button type="button" className="btn btn-primary" onClick={() => void importMetadata()} disabled={busy !== null || !metadataText.trim()}>{ui.text("Import local metadata", "匯入本機資料標籤")}</button><button type="button" className="btn btn-ghost" onClick={() => void act("reset", () => window.api.resetOllamaSuiteState(), ui.text("Local Ollama suite state was reset. No external runtime data was changed.", "本機 Ollama 套件狀態已重設；冇改動外部 runtime 資料。"))} disabled={busy !== null}>{ui.text("Reset app state", "重設 app 狀態")}</button></div><textarea className="input ollama-import" aria-label={ui.text("Local Ollama metadata JSON", "本機 Ollama 資料標籤 JSON")} value={metadataText} onChange={(event) => setMetadataText(event.target.value)} maxLength={2_097_152} placeholder={ui.text("Prepared or pasted local metadata JSON", "準備好或者貼上嘅本機資料標籤 JSON")}/></section>

      {error && <div className="field-error" role="alert"><p>{error}</p></div>}
      {message && <p className="setting-helper" role="status">{message}</p>}
      {pendingDeleteModel && provider && <DestructiveActionGate request={{ itemIds: [pendingDeleteModel.id], deleteFile: false }} returnFocusRef={deleteModelRef} actionName={ui.text(`delete local Ollama model ${pendingDeleteModel.name}`, `刪除本機 Ollama 模型 ${pendingDeleteModel.name}`)} affectedLabel={ui.text("local model", "本機模型")} onCancel={() => setPendingDeleteModel(null)} onConfirm={() => void act("delete-model", () => window.api.deleteOllamaModel(provider.id, pendingDeleteModel.name), ui.text("The selected local model was deleted and the inventory refreshed.", "所選本機模型已刪除，清單亦已更新。")).then(() => setPendingDeleteModel(null))}/>}
      {pendingDeleteChat && <DestructiveActionGate request={{ itemIds: [pendingDeleteChat.id], deleteFile: false }} returnFocusRef={deleteChatRef} actionName={ui.text(`delete local chat session ${pendingDeleteChat.name}`, `刪除本機聊天工作階段 ${pendingDeleteChat.name}`)} affectedLabel={ui.text("local chat session", "本機聊天工作階段")} onCancel={() => setPendingDeleteChat(null)} onConfirm={() => void act("delete-chat", () => window.api.deleteOllamaChat(pendingDeleteChat.id), ui.text("The local chat session was deleted.", "本機聊天工作階段已刪除。")).then(() => setPendingDeleteChat(null))}/>}
    </section>
  );
}
