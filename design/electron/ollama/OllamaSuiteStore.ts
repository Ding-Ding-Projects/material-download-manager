import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  calculateOllamaFit,
  createEmptyCatalogState,
  createEmptyOllamaSuiteState,
  createOllamaMetadataExport,
  exportOllamaMetadata,
  normalizeOllamaChatInput,
  normalizeOllamaEndpoint,
  normalizeOllamaGenerateInput,
  normalizeOllamaModelName,
  normalizeOllamaProvider,
  normalizeOllamaPullInput,
  normalizeOllamaSuiteState,
  parseOllamaMetadataExport,
  parseOllamaPsPayload,
  parseOllamaShowPayload,
  parseOllamaTagsPayload,
  parseOllamaVersionPayload,
  OLLAMA_CATALOG_POLICY_REASON,
  OLLAMA_MAX_CHAT_MESSAGE_CHARS,
  OLLAMA_MAX_RESPONSE_BYTES,
  OLLAMA_MAX_STATE_BYTES,
  OLLAMA_MAX_STREAM_BYTES,
  OLLAMA_PROBE_TIMEOUT_MS,
  type OllamaChatAttachment,
  type OllamaChatSession,
  type OllamaHardwareFacts,
  type OllamaHarnessProfile,
  type OllamaHarnessSnapshot,
  type OllamaInstalledModelRecord,
  type OllamaModelDetailsRecord,
  type OllamaProviderProbeState,
  type OllamaProviderRecord,
  type OllamaPullBatch,
  type OllamaPullItem,
  type OllamaSuiteState,
} from "../../shared/ollama";
import { exportRecords, type ExportFormat, type ExportResult } from "../../shared/export";

const execFileAsync = promisify(execFile);
const STATE_FILE_NAME = "ollama-suite.json";
const MAX_HARNESS_START_WAIT_MS = 1_500;
const STREAM_LINE_MAX_BYTES = 128 * 1024;

type StateListener = (state: OllamaSuiteState) => void;

function now(): string { return new Date().toISOString(); }

function providerId(): string { return `ollama-provider-${randomUUID()}`; }
function itemId(): string { return `ollama-item-${randomUUID()}`; }
function batchId(): string { return `ollama-pull-${randomUUID()}`; }
function chatId(): string { return `ollama-chat-${randomUUID()}`; }
function messageId(): string { return `ollama-message-${randomUUID()}`; }
function profileId(): string { return `ollama-harness-${randomUUID()}`; }
function snapshotId(): string { return `ollama-snapshot-${randomUUID()}`; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneState(value: OllamaSuiteState): OllamaSuiteState {
  return normalizeOllamaSuiteState(JSON.parse(JSON.stringify(value)));
}

function providerForInput(input: unknown): OllamaProviderRecord {
  if (!isRecord(input)) throw new Error("Invalid Ollama provider input");
  return normalizeOllamaProvider({
    id: providerId(), name: input.name, endpoint: normalizeOllamaEndpoint(input.endpoint),
    credential: { provider: "os-credential-vault", configured: false },
    probe: { state: "never", checkedAt: null, detail: null, modelCount: 0, runtimeVersion: null, runningModelCount: 0 },
  });
}

function classifyProbeError(error: unknown): { state: OllamaProviderProbeState; detail: string } {
  const message = error instanceof Error ? error.message : "The local Ollama API could not be read.";
  if (error instanceof Error && error.name === "AbortError") return { state: "unhealthy", detail: `The local Ollama API did not respond within ${OLLAMA_PROBE_TIMEOUT_MS} ms.` };
  if (/ECONNREFUSED|fetch failed|network|ENOTFOUND/iu.test(message)) return { state: "stopped", detail: "The local Ollama runtime is not accepting connections. Start or install Ollama, then refresh this local provider." };
  if (/HTTP 404|runtime version/iu.test(message)) return { state: "missing-runtime", detail: "The loopback service does not expose the documented Ollama local API. Install or start a compatible Ollama runtime, then refresh." };
  return { state: "unhealthy", detail: message.slice(0, 512) };
}

function safeInteger(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback; }

function redactedText(value: string): string {
  return value
    .replace(/\b(?:authorization|api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+/giu, "$1: [redacted]")
    .replace(/[A-Za-z]:\\(?:[^\r\n<>:"|?*]+\\)*[^\r\n<>:"|?*]*/gu, "[local-path]")
    .replace(/\/(?:Users|home|var|tmp)\/(?:[^\s/]+\/)*[^\s/]+/gu, "[local-path]");
}

function modelByName(state: OllamaSuiteState, providerIdValue: string, modelName: string): OllamaInstalledModelRecord | undefined {
  return state.installedModels.find((model) => model.providerId === providerIdValue && model.name === modelName);
}

function hasVisionCapability(state: OllamaSuiteState, providerIdValue: string, modelName: string): boolean {
  return state.modelDetails.some((detail) => detail.providerId === providerIdValue && detail.modelName === modelName && detail.capabilities.includes("vision"));
}

function modelDetailsFor(state: OllamaSuiteState, providerIdValue: string, modelName: string): OllamaModelDetailsRecord | null {
  return state.modelDetails.find((detail) => detail.providerId === providerIdValue && detail.modelName === modelName) ?? null;
}

function safeHarnessArgument(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f&|;`$<>]/u.test(value)) throw new Error("Harness arguments must use the approved model, endpoint, and port placeholders only");
  const allowed = new Set(["--model", "--endpoint", "--port", "{model}", "{endpoint}", "{port}"]);
  if (!allowed.has(value)) throw new Error("Harness arguments must use the approved model, endpoint, and port placeholders only");
  return value;
}

function normalizeRegisteredHarnessInput(input: unknown): Omit<OllamaHarnessProfile, "id" | "createdAt" | "updatedAt"> {
  if (!isRecord(input) || typeof input.name !== "string" || typeof input.executablePath !== "string" || typeof input.workingDirectory !== "string" || !Array.isArray(input.arguments)) throw new Error("Choose an executable and working folder for the registered harness profile");
  const name = input.name.trim();
  const executablePath = input.executablePath.trim();
  const workingDirectory = input.workingDirectory.trim();
  if (!name || name.length > 128 || !path.isAbsolute(executablePath) || !path.isAbsolute(workingDirectory)) throw new Error("Harness profile name, executable, and working folder must be valid local selections");
  if (path.extname(executablePath).toLowerCase() !== ".exe") throw new Error("Only a directly selected .exe can be registered; shell scripts and command interpreters are not allowed");
  const executableName = path.basename(executablePath).toLowerCase();
  if (["cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe"].includes(executableName)) throw new Error("Command interpreters cannot be registered as Ollama harnesses");
  const argumentsValue = input.arguments.map(safeHarnessArgument);
  return { name, kind: "registered-executable", executablePath, workingDirectory, arguments: argumentsValue, allowedEnvironmentKeys: [] };
}

function resolveHarnessArguments(profile: OllamaHarnessProfile, provider: OllamaProviderRecord, model: string): string[] {
  const endpoint = new URL(provider.endpoint);
  const port = endpoint.port || (endpoint.protocol === "https:" ? "443" : "80");
  return profile.arguments.map((argument) => argument.replace("{model}", model).replace("{endpoint}", provider.endpoint).replace("{port}", port));
}

export class OllamaSuiteStore {
  private state: OllamaSuiteState = createEmptyOllamaSuiteState();
  private initialized = false;
  private initializationError: Error | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<StateListener>();
  private readonly pullControllers = new Map<string, AbortController>();
  private readonly chatControllers = new Map<string, AbortController>();

  constructor(private readonly userDataPath: string) {}

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const next = this.getState();
    for (const listener of this.listeners) {
      try { listener(next); } catch { /* A renderer listener must never break local persistence. */ }
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const filePath = path.join(this.userDataPath, STATE_FILE_NAME);
    try {
      const handle = await fsp.open(filePath, "r");
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > OLLAMA_MAX_STATE_BYTES) throw new Error("Saved Ollama suite data is too large or is not a regular file");
        const bytes = Buffer.alloc(OLLAMA_MAX_STATE_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > OLLAMA_MAX_STATE_BYTES) throw new Error("Saved Ollama suite data is too large");
        this.state = normalizeOllamaSuiteState(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as unknown);
      } finally { await handle.close(); }
      // A process cannot survive application restart. Persist truthful recovery state.
      const recovered = this.recoverInterruptedState(this.state);
      if (JSON.stringify(recovered) !== JSON.stringify(this.state)) await this.persist(recovered);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") { this.state = createEmptyOllamaSuiteState(); return; }
      this.state = createEmptyOllamaSuiteState();
      this.initializationError = new Error("The saved local Ollama suite data is unavailable or corrupt; no changes were applied.");
    }
  }

  private recoverInterruptedState(state: OllamaSuiteState): OllamaSuiteState {
    return {
      ...state,
      pullBatches: state.pullBatches.map((batch) => ({ ...batch, state: batch.state === "running" || batch.state === "queued" ? "partial" : batch.state, items: batch.items.map((item) => item.state === "running" || item.state === "queued" ? { ...item, state: "cancelled", status: "Interrupted by application restart", updatedAt: now() } : item) })),
      chats: state.chats.map((chat) => chat.state === "streaming" ? { ...chat, state: "cancelled", error: "Local streaming stopped when the application closed.", updatedAt: now(), messages: chat.messages.map((message) => message.status === "streaming" ? { ...message, status: "cancelled" } : message) } : chat),
    };
  }

  private assertReady(): void { if (!this.initialized) throw new Error("Ollama suite store is not initialized"); if (this.initializationError) throw this.initializationError; }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertReady();
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  getState(): OllamaSuiteState { this.assertReady(); return cloneState(this.state); }

  private async persist(next: OllamaSuiteState): Promise<void> {
    const normalized = normalizeOllamaSuiteState({ ...next, updatedAt: now() });
    await fsp.mkdir(this.userDataPath, { recursive: true });
    const filePath = path.join(this.userDataPath, STATE_FILE_NAME);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fsp.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tempPath, filePath);
    this.state = normalized;
    this.notify();
  }

  private provider(providerIdValue: string): OllamaProviderRecord {
    if (typeof providerIdValue !== "string" || providerIdValue.length === 0 || providerIdValue.length > 128) throw new Error("Invalid Ollama provider identifier");
    const provider = this.state.providers.find((candidate) => candidate.id === providerIdValue);
    if (!provider) throw new Error("Ollama provider was not found");
    return provider;
  }

  private async request(provider: OllamaProviderRecord, route: "/api/version" | "/api/tags" | "/api/ps" | "/api/show" | "/api/pull" | "/api/delete" | "/api/copy" | "/api/chat" | "/api/generate", method: "GET" | "POST" | "DELETE", body?: unknown, signal?: AbortSignal): Promise<Response> {
    const endpoint = normalizeOllamaEndpoint(provider.endpoint);
    const controller = signal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), OLLAMA_PROBE_TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${endpoint}${route}`, { method, redirect: "error", signal: signal ?? controller!.signal, headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`Ollama local API returned HTTP ${response.status}`);
      return response;
    } finally { if (timeout) clearTimeout(timeout); }
  }

  private async readJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:json|x-ndjson)(?:\s*;|$)/iu.test(contentType)) throw new Error("Ollama local API did not return JSON");
    const contentLength = response.headers.get("content-length");
    if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > OLLAMA_MAX_RESPONSE_BYTES)) throw new Error("Ollama local API response is too large");
    if (!response.body) throw new Error("Ollama local API returned no response body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > OLLAMA_MAX_RESPONSE_BYTES) throw new Error("Ollama local API response is too large");
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))) as unknown;
  }

  private async readNdjson(response: Response, onValue: (value: Record<string, unknown>) => Promise<void>, signal: AbortSignal): Promise<void> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:x-ndjson|json)(?:\s*;|$)/iu.test(contentType)) throw new Error("Ollama local API did not return a supported streaming response");
    if (!response.body) throw new Error("Ollama local API returned no response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let carry = "";
    let total = 0;
    const consume = async (line: string) => {
      if (!line.trim()) return;
      if (Buffer.byteLength(line, "utf8") > STREAM_LINE_MAX_BYTES) throw new Error("Ollama local API stream line is too large");
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) throw new Error("Ollama local API stream item is invalid");
      await onValue(parsed);
    };
    try {
      while (true) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > OLLAMA_MAX_STREAM_BYTES) throw new Error("Ollama local API stream exceeded the local resource limit");
        carry += decoder.decode(next.value, { stream: true });
        let newline: number;
        while ((newline = carry.indexOf("\n")) >= 0) {
          const line = carry.slice(0, newline).replace(/\r$/u, "");
          carry = carry.slice(newline + 1);
          await consume(line);
        }
        if (Buffer.byteLength(carry, "utf8") > STREAM_LINE_MAX_BYTES) throw new Error("Ollama local API stream line is too large");
      }
      carry += decoder.decode();
      await consume(carry.replace(/\r$/u, ""));
    } finally { reader.releaseLock(); }
  }

  async reset(): Promise<OllamaSuiteState> {
    return this.withMutation(async () => { const empty = createEmptyOllamaSuiteState(); await this.persist(empty); this.initializationError = null; return this.getState(); });
  }

  async addProvider(input: unknown): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      const provider = providerForInput(input);
      if (this.state.providers.some((candidate) => candidate.endpoint === provider.endpoint)) throw new Error("An Ollama provider with this endpoint is already registered");
      await this.persist({ ...this.state, providers: [...this.state.providers, provider] });
      return this.getState();
    });
  }

  async removeProvider(id: string): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      this.provider(id);
      const providers = this.state.providers.filter((provider) => provider.id !== id);
      await this.persist({ ...this.state, providers, installedModels: this.state.installedModels.filter((model) => model.providerId !== id), runningModels: this.state.runningModels.filter((model) => model.providerId !== id), modelDetails: this.state.modelDetails.filter((detail) => detail.providerId !== id), fitEvidence: this.state.fitEvidence.filter((fit) => !this.state.installedModels.some((model) => model.providerId === id && model.name === fit.modelName)), pullBatches: this.state.pullBatches.filter((batch) => batch.providerId !== id), chats: this.state.chats.filter((chat) => chat.providerId !== id), harnessSnapshots: this.state.harnessSnapshots.filter((snapshot) => snapshot.providerId !== id) });
      return this.getState();
    });
  }

  async refreshProvider(id: string): Promise<OllamaSuiteState> {
    this.assertReady();
    const provider = this.provider(id);
    const checkedAt = now();
    try {
      const [versionPayload, tagsPayload, psPayload] = await Promise.all([
        this.request(provider, "/api/version", "GET").then((response) => this.readJson(response)),
        this.request(provider, "/api/tags", "GET").then((response) => this.readJson(response)),
        this.request(provider, "/api/ps", "GET").then((response) => this.readJson(response)),
      ]);
      const version = parseOllamaVersionPayload(versionPayload);
      const installedModels = parseOllamaTagsPayload(tagsPayload, id, checkedAt);
      const runningModels = parseOllamaPsPayload(psPayload, id, checkedAt);
      return this.withMutation(async () => {
        this.provider(id);
        const current = this.state;
        const nextProvider = { ...provider, probe: { state: "healthy" as const, checkedAt, detail: null, modelCount: installedModels.length, runtimeVersion: version, runningModelCount: runningModels.length } };
        const retainedDetails = current.modelDetails.filter((detail) => detail.providerId !== id || installedModels.some((model) => model.name === detail.modelName));
        const nextBase = { ...current, providers: current.providers.map((candidate) => candidate.id === id ? nextProvider : candidate), installedModels: [...current.installedModels.filter((model) => model.providerId !== id), ...installedModels], runningModels: [...current.runningModels.filter((model) => model.providerId !== id), ...runningModels], modelDetails: retainedDetails };
        const fitEvidence = this.recalculateFits(nextBase);
        await this.persist({ ...nextBase, fitEvidence });
        return this.getState();
      });
    } catch (error) {
      const classified = classifyProbeError(error);
      return this.withMutation(async () => {
        const currentProvider = this.provider(id);
        await this.persist({ ...this.state, providers: this.state.providers.map((candidate) => candidate.id === id ? { ...currentProvider, probe: { ...currentProvider.probe, state: classified.state, checkedAt, detail: classified.detail } } : candidate) });
        throw new Error(classified.detail);
      });
    }
  }

  async refreshCatalogCapability(): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      await this.persist({ ...this.state, catalog: { ...createEmptyCatalogState(), checkedAt: now(), reason: OLLAMA_CATALOG_POLICY_REASON } });
      return this.getState();
    });
  }

  async refreshModelDetails(providerIdValue: string, modelNameInput: unknown): Promise<OllamaSuiteState> {
    this.assertReady();
    const modelName = normalizeOllamaModelName(modelNameInput);
    const provider = this.provider(providerIdValue);
    if (!modelByName(this.state, providerIdValue, modelName)) throw new Error("Refresh the installed local model inventory before requesting model details");
    const detailsPayload = await this.request(provider, "/api/show", "POST", { model: modelName, verbose: false }).then((response) => this.readJson(response));
    const details = parseOllamaShowPayload(detailsPayload, providerIdValue, modelName, now());
    return this.withMutation(async () => {
      const nextBase = { ...this.state, modelDetails: [...this.state.modelDetails.filter((item) => !(item.providerId === providerIdValue && item.modelName === modelName)), details] };
      await this.persist({ ...nextBase, fitEvidence: this.recalculateFits(nextBase) });
      return this.getState();
    });
  }

  private async readGpuFacts(): Promise<OllamaHardwareFacts["gpu"] & { diagnostic: string | null }> {
    if (process.platform !== "win32") return { name: null, vramBytes: null, driver: null, backend: "unknown", diagnostic: "GPU discovery is unavailable on this platform." };
    const script = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress";
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 1_500, maxBuffer: 64 * 1024 });
      const parsed: unknown = JSON.parse(stdout.trim() || "[]");
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const first = entries.find(isRecord);
      if (!first) return { name: null, vramBytes: null, driver: null, backend: "unknown", diagnostic: "No local GPU adapter facts were returned." };
      return { name: typeof first.Name === "string" && first.Name.length <= 512 ? first.Name : null, vramBytes: safeInteger(first.AdapterRAM, 0) || null, driver: typeof first.DriverVersion === "string" && first.DriverVersion.length <= 128 ? first.DriverVersion : null, backend: "detected", diagnostic: null };
    } catch { return { name: null, vramBytes: null, driver: null, backend: "unknown", diagnostic: "GPU facts could not be read through the bounded local OS probe." }; }
  }

  async probeHardware(): Promise<OllamaSuiteState> {
    this.assertReady();
    await fsp.mkdir(this.userDataPath, { recursive: true });
    const [gpu, disk] = await Promise.all([this.readGpuFacts(), fsp.statfs(this.userDataPath).catch(() => null)]);
    const freeDiskBytes = disk ? Number(disk.bavail) * Number(disk.bsize) : null;
    const verifiedFreeDiskBytes = typeof freeDiskBytes === "number" && Number.isSafeInteger(freeDiskBytes) && freeDiskBytes >= 0 ? freeDiskBytes : null;
    const hardware: OllamaHardwareFacts = { checkedAt: now(), totalRamBytes: os.totalmem(), freeRamBytes: os.freemem(), freeDiskBytes: verifiedFreeDiskBytes, architecture: `${process.platform}-${process.arch}`, gpu: { name: gpu.name, vramBytes: gpu.vramBytes, driver: gpu.driver, backend: gpu.backend }, diagnostic: gpu.diagnostic };
    return this.withMutation(async () => { const nextBase = { ...this.state, hardware }; await this.persist({ ...nextBase, fitEvidence: this.recalculateFits(nextBase) }); return this.getState(); });
  }

  private recalculateFits(state: OllamaSuiteState) {
    return state.installedModels.map((model) => calculateOllamaFit(model, modelDetailsFor(state, model.providerId, model.name), state.hardware));
  }

  async startPullBatch(inputValue: unknown): Promise<OllamaSuiteState> {
    const input = normalizeOllamaPullInput(inputValue);
    const createdAt = now();
    const next = await this.withMutation(async () => {
      this.provider(input.providerId);
      const availableDiskBytes = this.state.hardware?.freeDiskBytes ?? null;
      const selectedSizes = input.models.map((model) => modelByName(this.state, input.providerId, model)?.sizeBytes ?? 0);
      const storagePreflightBytes = Math.ceil(selectedSizes.reduce((total, size) => total + size, 0) * 1.1);
      if (availableDiskBytes !== null && storagePreflightBytes > 0 && availableDiskBytes < storagePreflightBytes) throw new Error("The selected batch exceeds the currently verified free destination storage. Free space or reduce the batch, then retry.");
      const batch: OllamaPullBatch = { id: batchId(), providerId: input.providerId, createdAt, updatedAt: createdAt, state: "queued", parallelism: input.parallelism, items: input.models.map((model) => ({ id: itemId(), model, state: "queued", status: "Waiting for local Ollama", totalBytes: null, completedBytes: null, error: null, updatedAt: createdAt })), storagePreflightBytes, availableDiskBytes };
      await this.persist({ ...this.state, pullBatches: [batch, ...this.state.pullBatches].slice(0, 128) });
      return batch.id;
    });
    void this.processPullBatch(next).catch(() => undefined);
    return this.getState();
  }

  async retryPullBatch(id: string): Promise<OllamaSuiteState> {
    if (typeof id !== "string" || id.length > 160) throw new Error("Invalid Ollama pull batch identifier");
    await this.withMutation(async () => {
      const batch = this.state.pullBatches.find((candidate) => candidate.id === id);
      if (!batch) throw new Error("Ollama pull batch was not found");
      if (batch.state === "running") throw new Error("Wait for the current local pull batch to finish before retrying it");
      const updated = { ...batch, state: "queued" as const, updatedAt: now(), items: batch.items.map((item) => item.state === "failed" || item.state === "cancelled" ? { ...item, state: "queued" as const, status: "Queued for retry", error: null, completedBytes: null, updatedAt: now() } : item) };
      await this.persist({ ...this.state, pullBatches: this.state.pullBatches.map((candidate) => candidate.id === id ? updated : candidate) });
    });
    void this.processPullBatch(id).catch(() => undefined);
    return this.getState();
  }

  async cancelPullBatch(id: string): Promise<OllamaSuiteState> {
    if (typeof id !== "string" || id.length > 160) throw new Error("Invalid Ollama pull batch identifier");
    this.pullControllers.get(id)?.abort();
    return this.withMutation(async () => {
      const batch = this.state.pullBatches.find((candidate) => candidate.id === id);
      if (!batch) throw new Error("Ollama pull batch was not found");
      const updated = { ...batch, state: "cancelled" as const, updatedAt: now(), items: batch.items.map((item) => item.state === "queued" ? { ...item, state: "cancelled" as const, status: "Cancelled before local transfer began", updatedAt: now() } : item) };
      await this.persist({ ...this.state, pullBatches: this.state.pullBatches.map((candidate) => candidate.id === id ? updated : candidate) });
      return this.getState();
    });
  }

  private async processPullBatch(id: string): Promise<void> {
    if (this.pullControllers.has(id)) return;
    const batch = this.state.pullBatches.find((candidate) => candidate.id === id);
    if (!batch) return;
    const controller = new AbortController();
    this.pullControllers.set(id, controller);
    try {
      await Promise.all(Array.from({ length: batch.parallelism }, () => this.pullWorker(id, controller)));
      const completed = this.state.pullBatches.find((candidate) => candidate.id === id);
      if (completed) await this.refreshProvider(completed.providerId).catch(() => undefined);
      await this.finalizePullBatch(id);
    } finally { this.pullControllers.delete(id); }
  }

  private async pullWorker(id: string, controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      const claimed = await this.claimPullItem(id);
      if (!claimed) return;
      await this.executePullItem(id, claimed, controller).catch(() => undefined);
    }
  }

  private async claimPullItem(batchIdValue: string): Promise<OllamaPullItem | null> {
    return this.withMutation(async () => {
      const batch = this.state.pullBatches.find((candidate) => candidate.id === batchIdValue);
      if (!batch || batch.state === "cancelled") return null;
      const item = batch.items.find((candidate) => candidate.state === "queued");
      if (!item) return null;
      const timestamp = now();
      const updatedBatch = { ...batch, state: "running" as const, updatedAt: timestamp, items: batch.items.map((candidate) => candidate.id === item.id ? { ...candidate, state: "running" as const, status: "Requesting local Ollama pull", updatedAt: timestamp } : candidate) };
      await this.persist({ ...this.state, pullBatches: this.state.pullBatches.map((candidate) => candidate.id === batchIdValue ? updatedBatch : candidate) });
      return updatedBatch.items.find((candidate) => candidate.id === item.id) ?? null;
    });
  }

  private async patchPullItem(batchIdValue: string, itemIdValue: string, update: (item: OllamaPullItem) => OllamaPullItem): Promise<void> {
    await this.withMutation(async () => {
      const batch = this.state.pullBatches.find((candidate) => candidate.id === batchIdValue);
      if (!batch) return;
      const items = batch.items.map((candidate) => candidate.id === itemIdValue ? update(candidate) : candidate);
      await this.persist({ ...this.state, pullBatches: this.state.pullBatches.map((candidate) => candidate.id === batchIdValue ? { ...batch, updatedAt: now(), items } : candidate) });
    });
  }

  private async executePullItem(batchIdValue: string, item: OllamaPullItem, controller: AbortController): Promise<void> {
    const batch = this.state.pullBatches.find((candidate) => candidate.id === batchIdValue);
    if (!batch) return;
    const provider = this.provider(batch.providerId);
    let lastPersist = 0;
    try {
      const response = await this.request(provider, "/api/pull", "POST", { model: item.model, stream: true, insecure: false }, controller.signal);
      await this.readNdjson(response, async (value) => {
        const timestamp = Date.now();
        if (timestamp - lastPersist < 200 && value.done !== true) return;
        lastPersist = timestamp;
        const totalBytes = safeInteger(value.total, 0) || null;
        const completedBytes = safeInteger(value.completed, 0) || null;
        const status = typeof value.status === "string" && value.status.length <= 512 ? value.status : "Receiving local pull progress";
        await this.patchPullItem(batchIdValue, item.id, (current) => ({ ...current, status, totalBytes, completedBytes, updatedAt: now() }));
      }, controller.signal);
      await this.patchPullItem(batchIdValue, item.id, (current) => ({ ...current, state: "pulled", status: "Pulled into the local Ollama runtime", error: null, updatedAt: now() }));
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const detail = cancelled ? "Cancelled by the user" : (error instanceof Error ? error.message.slice(0, 1_024) : "Local Ollama pull failed");
      await this.patchPullItem(batchIdValue, item.id, (current) => ({ ...current, state: cancelled ? "cancelled" : "failed", status: cancelled ? "Cancelled" : "Failed", error: detail, updatedAt: now() }));
    }
  }

  private async finalizePullBatch(id: string): Promise<void> {
    await this.withMutation(async () => {
      const batch = this.state.pullBatches.find((candidate) => candidate.id === id);
      if (!batch) return;
      const states = batch.items.map((item) => item.state);
      const cancelled = states.every((state) => state === "cancelled");
      const failed = states.every((state) => state === "failed");
      const state = cancelled ? "cancelled" : failed ? "failed" : states.every((itemState) => itemState === "pulled" || itemState === "skipped") ? "completed" : "partial";
      await this.persist({ ...this.state, pullBatches: this.state.pullBatches.map((candidate) => candidate.id === id ? { ...batch, state, updatedAt: now() } : candidate) });
    });
  }

  async deleteModel(providerIdValue: string, modelNameInput: unknown): Promise<OllamaSuiteState> {
    const modelName = normalizeOllamaModelName(modelNameInput);
    const provider = this.provider(providerIdValue);
    await this.request(provider, "/api/delete", "DELETE", { model: modelName }).then(async (response) => { if (response.body) await response.body.cancel(); });
    return this.refreshProvider(providerIdValue);
  }

  async copyModel(providerIdValue: string, input: unknown): Promise<OllamaSuiteState> {
    if (!isRecord(input)) throw new Error("Choose an installed source model and a valid local destination name");
    const source = normalizeOllamaModelName(input.source, "copy source");
    const destination = normalizeOllamaModelName(input.destination, "copy destination");
    if (!modelByName(this.state, providerIdValue, source)) throw new Error("Choose a source model from the verified installed inventory");
    const provider = this.provider(providerIdValue);
    await this.request(provider, "/api/copy", "POST", { source, destination }).then(async (response) => { if (response.body) await response.body.cancel(); });
    return this.refreshProvider(providerIdValue);
  }

  async createChatSession(input: unknown): Promise<OllamaSuiteState> {
    if (!isRecord(input) || typeof input.providerId !== "string") throw new Error("Choose a local provider and verified installed model for the chat");
    const providerIdValue = input.providerId;
    const model = normalizeOllamaModelName(input.model);
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 128) : model;
    const systemPrompt = typeof input.systemPrompt === "string" ? input.systemPrompt.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : "";
    const temperature = typeof input.temperature === "number" && Number.isFinite(input.temperature) ? input.temperature : 0.7;
    const numCtx = typeof input.numCtx === "number" && Number.isSafeInteger(input.numCtx) ? input.numCtx : 4096;
    const keepAlive = typeof input.keepAlive === "string" && /^\d+(?:s|m|h)$|^0$/u.test(input.keepAlive) ? input.keepAlive : "5m";
    if (temperature < 0 || temperature > 2 || numCtx < 128 || numCtx > 16_777_216) throw new Error("Chat temperature or context limit is outside the documented local bounds");
    return this.withMutation(async () => {
      this.provider(providerIdValue);
      if (!modelByName(this.state, providerIdValue, model)) throw new Error("Refresh the local installed model inventory and choose one of its models before starting chat");
      if (this.state.chats.length >= 64) throw new Error("The local chat history limit has been reached; export or delete a session before creating another");
      const timestamp = now();
      const chat: OllamaChatSession = { id: chatId(), providerId: providerIdValue, model, name, systemPrompt, options: { temperature, numCtx, keepAlive }, createdAt: timestamp, updatedAt: timestamp, state: "ready", error: null, messages: [] };
      await this.persist({ ...this.state, chats: [chat, ...this.state.chats] });
      return this.getState();
    });
  }

  async generate(inputValue: unknown): Promise<OllamaSuiteState> {
    const input = normalizeOllamaGenerateInput(inputValue);
    let sessionId = "";
    await this.withMutation(async () => {
      this.provider(input.providerId);
      if (!modelByName(this.state, input.providerId, input.model)) throw new Error("Refresh the local installed model inventory and choose one of its models before generating");
      if (this.state.chats.length >= 64) throw new Error("The local chat history limit has been reached; export or delete a session before generating another response");
      const timestamp = now();
      sessionId = chatId();
      const user: OllamaChatSession["messages"][number] = { id: messageId(), role: "user", content: input.prompt, thinking: null, createdAt: timestamp, status: "complete" };
      const assistant: OllamaChatSession["messages"][number] = { id: messageId(), role: "assistant", content: "", thinking: null, createdAt: timestamp, status: "streaming" };
      const chat: OllamaChatSession = { id: sessionId, providerId: input.providerId, model: input.model, name: `Generate · ${input.model}`, systemPrompt: input.systemPrompt, options: { temperature: input.temperature, numCtx: input.numCtx, keepAlive: input.keepAlive }, createdAt: timestamp, updatedAt: timestamp, state: "streaming", error: null, messages: [user, assistant] };
      await this.persist({ ...this.state, chats: [chat, ...this.state.chats] });
    });
    void this.processGenerate(sessionId).catch(() => undefined);
    return this.getState();
  }

  async renameChatSession(id: string, nameInput: unknown): Promise<OllamaSuiteState> {
    if (typeof id !== "string" || typeof nameInput !== "string" || !nameInput.trim() || nameInput.trim().length > 128) throw new Error("Chat name must be between 1 and 128 characters");
    return this.withMutation(async () => { const chat = this.state.chats.find((candidate) => candidate.id === id); if (!chat) throw new Error("Local chat session was not found"); await this.persist({ ...this.state, chats: this.state.chats.map((candidate) => candidate.id === id ? { ...chat, name: nameInput.trim(), updatedAt: now() } : candidate) }); return this.getState(); });
  }

  async deleteChatSession(id: string): Promise<OllamaSuiteState> {
    if (typeof id !== "string") throw new Error("Invalid local chat session identifier");
    this.chatControllers.get(id)?.abort();
    return this.withMutation(async () => { if (!this.state.chats.some((chat) => chat.id === id)) throw new Error("Local chat session was not found"); await this.persist({ ...this.state, chats: this.state.chats.filter((chat) => chat.id !== id) }); return this.getState(); });
  }

  async sendChat(inputValue: unknown): Promise<OllamaSuiteState> {
    const input = normalizeOllamaChatInput(inputValue);
    await this.withMutation(async () => {
      const chat = this.state.chats.find((candidate) => candidate.id === input.sessionId);
      if (!chat) throw new Error("Local chat session was not found");
      if (chat.state === "streaming") throw new Error("Wait for the current local response or choose Stop before sending another message");
      this.provider(chat.providerId);
      if (!modelByName(this.state, chat.providerId, chat.model)) throw new Error("The selected model is no longer installed locally. Refresh the model inventory and choose another model.");
      if (input.attachments.length > 0 && !hasVisionCapability(this.state, chat.providerId, chat.model)) throw new Error("Image attachments stay disabled until Refresh details verifies vision capability for the selected local model.");
      if (chat.messages.length + 2 > 1_000) throw new Error("This local chat reached its bounded history limit; start a new session or export and delete older history.");
      const timestamp = now();
      const user: OllamaChatSession["messages"][number] = { id: messageId(), role: "user", content: input.content, thinking: null, createdAt: timestamp, status: "complete" };
      const assistant: OllamaChatSession["messages"][number] = { id: messageId(), role: "assistant", content: "", thinking: null, createdAt: timestamp, status: "streaming" };
      const updated = { ...chat, state: "streaming" as const, error: null, updatedAt: timestamp, messages: [...chat.messages, user, assistant] };
      await this.persist({ ...this.state, chats: this.state.chats.map((candidate) => candidate.id === chat.id ? updated : candidate) });
    });
    const transientAttachments = input.attachments.map((attachment) => ({ ...attachment }));
    void this.processChat(input.sessionId, transientAttachments).catch(() => undefined);
    return this.getState();
  }

  async cancelChat(id: string): Promise<OllamaSuiteState> {
    if (typeof id !== "string" || id.length > 160) throw new Error("Invalid local chat session identifier");
    this.chatControllers.get(id)?.abort();
    return this.getState();
  }

  private async processChat(id: string, attachments: OllamaChatAttachment[]): Promise<void> {
    if (this.chatControllers.has(id)) return;
    const chat = this.state.chats.find((candidate) => candidate.id === id);
    if (!chat) return;
    const provider = this.provider(chat.providerId);
    const controller = new AbortController();
    this.chatControllers.set(id, controller);
    try {
      const assistantId = chat.messages[chat.messages.length - 1]?.id;
      const requestMessages = [
        ...(chat.systemPrompt ? [{ role: "system", content: chat.systemPrompt }] : []),
        ...chat.messages.filter((message) => message.id !== assistantId).map((message) => ({ role: message.role, content: message.content, ...(message.role === "user" && message.id === chat.messages[chat.messages.length - 2]?.id && attachments.length ? { images: attachments.map((attachment) => attachment.dataBase64) } : {}) })),
      ];
      const response = await this.request(provider, "/api/chat", "POST", { model: chat.model, messages: requestMessages, stream: true, options: { temperature: chat.options.temperature, num_ctx: chat.options.numCtx }, keep_alive: chat.options.keepAlive }, controller.signal);
      let lastPersist = 0;
      let pendingContent = "";
      let pendingThinking = "";
      const flushAssistantDelta = async (done: boolean): Promise<void> => {
        if (!pendingContent && !pendingThinking && !done) return;
        const content = pendingContent;
        const thinking = pendingThinking;
        pendingContent = "";
        pendingThinking = "";
        lastPersist = Date.now();
        await this.patchChat(id, (current) => ({ ...current, updatedAt: now(), messages: current.messages.map((messageRecord) => messageRecord.id !== assistantId ? messageRecord : { ...messageRecord, content: `${messageRecord.content}${content}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS), thinking: thinking ? `${messageRecord.thinking ?? ""}${thinking}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : messageRecord.thinking, status: done ? "complete" : "streaming" }) }));
      };
      await this.readNdjson(response, async (value) => {
        const message = isRecord(value.message) ? value.message : {};
        const content = typeof message.content === "string" ? message.content.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : "";
        const thinking = typeof message.thinking === "string" ? message.thinking.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : null;
        const timestamp = Date.now();
        if (!content && !thinking && value.done !== true) return;
        pendingContent = `${pendingContent}${content}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS);
        pendingThinking = thinking ? `${pendingThinking}${thinking}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : pendingThinking;
        if (value.done === true || timestamp - lastPersist >= 150) await flushAssistantDelta(value.done === true);
      }, controller.signal);
      await flushAssistantDelta(true);
      await this.patchChat(id, (current) => ({ ...current, state: "ready", error: null, updatedAt: now(), messages: current.messages.map((messageRecord) => messageRecord.id === assistantId && messageRecord.status === "streaming" ? { ...messageRecord, status: "complete" } : messageRecord) }));
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const detail = cancelled ? "The local response was stopped." : (error instanceof Error ? error.message.slice(0, 1_024) : "The local chat response failed.");
      await this.patchChat(id, (current) => ({ ...current, state: cancelled ? "cancelled" : "failed", error: detail, updatedAt: now(), messages: current.messages.map((message) => message.status === "streaming" ? { ...message, status: cancelled ? "cancelled" : "failed" } : message) }));
    } finally { this.chatControllers.delete(id); }
  }

  private async processGenerate(id: string): Promise<void> {
    if (this.chatControllers.has(id)) return;
    const chat = this.state.chats.find((candidate) => candidate.id === id);
    if (!chat) return;
    const provider = this.provider(chat.providerId);
    const prompt = chat.messages.find((message) => message.role === "user")?.content;
    const assistantId = chat.messages[chat.messages.length - 1]?.id;
    if (!prompt || !assistantId) return;
    const controller = new AbortController();
    this.chatControllers.set(id, controller);
    try {
      const response = await this.request(provider, "/api/generate", "POST", { model: chat.model, prompt, ...(chat.systemPrompt ? { system: chat.systemPrompt } : {}), stream: true, options: { temperature: chat.options.temperature, num_ctx: chat.options.numCtx }, keep_alive: chat.options.keepAlive }, controller.signal);
      let lastPersist = 0;
      let pendingContent = "";
      let pendingThinking = "";
      const flushAssistantDelta = async (done: boolean): Promise<void> => {
        if (!pendingContent && !pendingThinking && !done) return;
        const content = pendingContent;
        const thinking = pendingThinking;
        pendingContent = "";
        pendingThinking = "";
        lastPersist = Date.now();
        await this.patchChat(id, (current) => ({ ...current, updatedAt: now(), messages: current.messages.map((message) => message.id !== assistantId ? message : { ...message, content: `${message.content}${content}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS), thinking: thinking ? `${message.thinking ?? ""}${thinking}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : message.thinking, status: done ? "complete" : "streaming" }) }));
      };
      await this.readNdjson(response, async (value) => {
        const content = typeof value.response === "string" ? value.response.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : "";
        const thinking = typeof value.thinking === "string" ? value.thinking.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : null;
        const timestamp = Date.now();
        if (!content && !thinking && value.done !== true) return;
        pendingContent = `${pendingContent}${content}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS);
        pendingThinking = thinking ? `${pendingThinking}${thinking}`.slice(0, OLLAMA_MAX_CHAT_MESSAGE_CHARS) : pendingThinking;
        if (value.done === true || timestamp - lastPersist >= 150) await flushAssistantDelta(value.done === true);
      }, controller.signal);
      await flushAssistantDelta(true);
      await this.patchChat(id, (current) => ({ ...current, state: "ready", error: null, updatedAt: now(), messages: current.messages.map((message) => message.id === assistantId && message.status === "streaming" ? { ...message, status: "complete" } : message) }));
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const detail = cancelled ? "The local generation was stopped." : (error instanceof Error ? error.message.slice(0, 1_024) : "The local generation failed.");
      await this.patchChat(id, (current) => ({ ...current, state: cancelled ? "cancelled" : "failed", error: detail, updatedAt: now(), messages: current.messages.map((message) => message.status === "streaming" ? { ...message, status: cancelled ? "cancelled" : "failed" } : message) }));
    } finally { this.chatControllers.delete(id); }
  }

  private async patchChat(id: string, update: (chat: OllamaChatSession) => OllamaChatSession): Promise<void> {
    await this.withMutation(async () => { const chat = this.state.chats.find((candidate) => candidate.id === id); if (!chat) return; await this.persist({ ...this.state, chats: this.state.chats.map((candidate) => candidate.id === id ? update(chat) : candidate) }); });
  }

  exportChat(id: string, format: ExportFormat): ExportResult {
    this.assertReady();
    const chat = this.state.chats.find((candidate) => candidate.id === id);
    if (!chat) throw new Error("Local chat session was not found");
    const record = { schema: "material-download-manager.ollama-chat", schemaVersion: 1, exportedAt: now(), session: { id: chat.id, name: chat.name, model: chat.model, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages.map((message) => ({ role: message.role, content: redactedText(message.content), thinking: message.thinking ? redactedText(message.thinking) : null, createdAt: message.createdAt, status: message.status })) }, omissions: ["attachments", "credentials", "environment", "private-paths"] };
    const result = exportRecords(record, format);
    return { ...result, warnings: [...result.warnings, "Attachments, credentials, environment values, and local paths are omitted or redacted from ordinary local chat exports."] };
  }

  async registerHarnessProfile(input: unknown): Promise<OllamaSuiteState> {
    const normalized = normalizeRegisteredHarnessInput(input);
    const [executable, folder] = await Promise.all([fsp.stat(normalized.executablePath!).catch(() => null), fsp.stat(normalized.workingDirectory!).catch(() => null)]);
    if (!executable?.isFile() || !folder?.isDirectory()) throw new Error("The selected harness executable or working folder is no longer available");
    return this.withMutation(async () => {
      const timestamp = now();
      const profile: OllamaHarnessProfile = { ...normalized, id: profileId(), createdAt: timestamp, updatedAt: timestamp };
      await this.persist({ ...this.state, harnessProfiles: [...this.state.harnessProfiles, profile] });
      return this.getState();
    });
  }

  async removeHarnessProfile(id: string): Promise<OllamaSuiteState> {
    if (typeof id !== "string") throw new Error("Invalid harness profile identifier");
    return this.withMutation(async () => {
      const profile = this.state.harnessProfiles.find((candidate) => candidate.id === id);
      if (!profile) throw new Error("Harness profile was not found");
      if (profile.kind === "built-in-diagnostics") throw new Error("The bundled diagnostics profile cannot be removed");
      await this.persist({ ...this.state, harnessProfiles: this.state.harnessProfiles.filter((candidate) => candidate.id !== id) });
      return this.getState();
    });
  }

  async preflightHarness(input: unknown): Promise<OllamaSuiteState> {
    if (!isRecord(input) || typeof input.profileId !== "string" || typeof input.providerId !== "string") throw new Error("Choose a harness profile, local provider, and installed model");
    const profileIdValue = input.profileId;
    const providerIdValue = input.providerId;
    const model = normalizeOllamaModelName(input.model);
    return this.withMutation(async () => {
      const profile = this.state.harnessProfiles.find((candidate) => candidate.id === profileIdValue);
      if (!profile) throw new Error("Harness profile was not found");
      const provider = this.provider(providerIdValue);
      if (!modelByName(this.state, provider.id, model)) throw new Error("Choose a model from the verified installed local inventory before launching a harness");
      if (profile.kind === "registered-executable") {
        const [executable, folder] = await Promise.all([fsp.stat(profile.executablePath!).catch(() => null), fsp.stat(profile.workingDirectory!).catch(() => null)]);
        if (!executable?.isFile() || !folder?.isDirectory()) throw new Error("The selected harness executable or working folder is unavailable; choose it again in the profile editor");
      }
      const snapshot: OllamaHarnessSnapshot = { id: snapshotId(), profileId: profile.id, providerId: provider.id, model, createdAt: now(), restoredAt: null, outcome: "ready", detail: profile.kind === "built-in-diagnostics" ? "Built-in diagnostics will refresh only the selected local API provider." : `Approved executable: ${path.basename(profile.executablePath!)}; arguments: ${resolveHarnessArguments(profile, provider, model).join(" ") || "(none)"}.` };
      await this.persist({ ...this.state, harnessSnapshots: [snapshot, ...this.state.harnessSnapshots].slice(0, 128) });
      return this.getState();
    });
  }

  async launchHarness(input: unknown): Promise<OllamaSuiteState> {
    await this.preflightHarness(input);
    if (!isRecord(input)) throw new Error("Invalid harness launch");
    const profileIdValue = input.profileId as string;
    const providerIdValue = input.providerId as string;
    const model = normalizeOllamaModelName(input.model);
    const profile = this.state.harnessProfiles.find((candidate) => candidate.id === profileIdValue)!;
    const snapshot = this.state.harnessSnapshots.find((candidate) => candidate.profileId === profileIdValue && candidate.providerId === providerIdValue && candidate.model === model)!;
    try {
      if (profile.kind === "built-in-diagnostics") {
        await this.refreshProvider(providerIdValue);
      } else {
        const provider = this.provider(providerIdValue);
        const args = resolveHarnessArguments(profile, provider, model);
        await new Promise<void>((resolve, reject) => {
          const child = spawn(profile.executablePath!, args, { cwd: profile.workingDirectory!, shell: false, windowsHide: true, detached: true, stdio: "ignore", env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", WINDIR: process.env.WINDIR ?? "", TEMP: process.env.TEMP ?? "", TMP: process.env.TMP ?? "" } });
          const timer = setTimeout(() => { child.removeAllListeners("error"); child.unref(); resolve(); }, MAX_HARNESS_START_WAIT_MS);
          child.once("error", (error) => { clearTimeout(timer); reject(error); });
          child.once("spawn", () => { clearTimeout(timer); child.removeAllListeners("error"); child.unref(); resolve(); });
        });
      }
      await this.updateSnapshot(snapshot.id, "launched", profile.kind === "built-in-diagnostics" ? "Built-in local diagnostics refreshed the selected Ollama provider." : "The approved executable was started without a shell; readiness remains external to Ollama.");
      return this.getState();
    } catch (error) {
      await this.restoreHarnessSnapshot(snapshot.id, true, error instanceof Error ? error.message : "Harness launch failed");
      throw error;
    }
  }

  async restoreHarnessSnapshot(id: string, automatic = false, failureDetail = ""): Promise<OllamaSuiteState> {
    if (typeof id !== "string") throw new Error("Invalid harness snapshot identifier");
    return this.withMutation(async () => {
      const snapshot = this.state.harnessSnapshots.find((candidate) => candidate.id === id);
      if (!snapshot) throw new Error("Harness snapshot was not found");
      const detail = automatic ? `Launch failed and the app-managed harness selection was restored. ${failureDetail.slice(0, 512)}` : "The app-managed harness selection was restored. External executable state is never changed by this restore.";
      await this.persist({ ...this.state, harnessSnapshots: this.state.harnessSnapshots.map((candidate) => candidate.id === id ? { ...snapshot, outcome: "restored", restoredAt: now(), detail } : candidate) });
      return this.getState();
    });
  }

  private async updateSnapshot(id: string, outcome: OllamaHarnessSnapshot["outcome"], detail: string): Promise<void> {
    await this.withMutation(async () => { const snapshot = this.state.harnessSnapshots.find((candidate) => candidate.id === id); if (!snapshot) return; await this.persist({ ...this.state, harnessSnapshots: this.state.harnessSnapshots.map((candidate) => candidate.id === id ? { ...snapshot, outcome, detail: detail.slice(0, 1_024) } : candidate) }); });
  }

  exportMetadata(format: ExportFormat): ExportResult { this.assertReady(); return exportOllamaMetadata(this.state, format); }

  async importMetadata(value: unknown): Promise<OllamaSuiteState> { return this.withMutation(async () => { const imported = parseOllamaMetadataExport(value); await this.persist(imported); return this.getState(); }); }
  metadataEnvelope() { this.assertReady(); return createOllamaMetadataExport(this.state); }
}
