import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createEmptyOllamaSuiteState,
  createOllamaMetadataExport,
  exportOllamaMetadata,
  normalizeOllamaEndpoint,
  normalizeOllamaProvider,
  normalizeOllamaSuiteState,
  parseOllamaMetadataExport,
  parseOllamaTagsPayload,
  OLLAMA_MAX_RESPONSE_BYTES,
  OLLAMA_MAX_STATE_BYTES,
  OLLAMA_PROBE_TIMEOUT_MS,
  type OllamaProviderRecord,
  type OllamaRefreshResult,
  type OllamaSuiteState,
} from "../../shared/ollama";
import { type ExportFormat, type ExportResult } from "../../shared/export";

const STATE_FILE_NAME = "ollama-suite.json";

function providerId(): string {
  return `ollama-provider-${randomUUID()}`;
}

function providerForInput(input: unknown): OllamaProviderRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Invalid Ollama provider input");
  const value = input as Record<string, unknown>;
  return normalizeOllamaProvider({
    id: providerId(),
    name: value.name,
    endpoint: normalizeOllamaEndpoint(value.endpoint),
    credential: { provider: "os-credential-vault", configured: false },
    probe: { state: "never", checkedAt: null, detail: null, modelCount: 0 },
  });
}

function cloneState(value: OllamaSuiteState): OllamaSuiteState {
  return normalizeOllamaSuiteState(JSON.parse(JSON.stringify(value)));
}

export class OllamaSuiteStore {
  private state: OllamaSuiteState = createEmptyOllamaSuiteState();
  private initialized = false;
  private initializationError: Error | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const filePath = path.join(this.userDataPath, STATE_FILE_NAME);
    try {
      const handle = await fsp.open(filePath, "r");
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > OLLAMA_MAX_STATE_BYTES) throw new Error("Saved Ollama suite metadata is too large or is not a regular file");
        const bytes = Buffer.alloc(OLLAMA_MAX_STATE_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > OLLAMA_MAX_STATE_BYTES) throw new Error("Saved Ollama suite metadata is too large");
        const raw = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as unknown;
        this.state = normalizeOllamaSuiteState(raw);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
        this.state = createEmptyOllamaSuiteState();
        return;
      }
      this.state = createEmptyOllamaSuiteState();
      this.initializationError = new Error("The saved Ollama suite metadata is unavailable or corrupt; no changes were applied.");
    }
  }

  private assertReady(): void {
    if (!this.initialized) throw new Error("Ollama suite store is not initialized");
    if (this.initializationError) throw this.initializationError;
  }

  async reset(): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      const empty = createEmptyOllamaSuiteState();
      await this.persist(empty);
      this.initializationError = null;
      return this.getState();
    });
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertReady();
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  getState(): OllamaSuiteState {
    this.assertReady();
    return cloneState(this.state);
  }

  private async persist(next: OllamaSuiteState): Promise<void> {
    const normalized = normalizeOllamaSuiteState(next);
    await fsp.mkdir(this.userDataPath, { recursive: true });
    const filePath = path.join(this.userDataPath, STATE_FILE_NAME);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fsp.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tempPath, filePath);
    this.state = normalized;
  }

  async addProvider(input: unknown): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      const provider = providerForInput(input);
      if (this.state.providers.some((candidate) => candidate.endpoint === provider.endpoint)) {
        throw new Error("An Ollama provider with this endpoint is already registered");
      }
      await this.persist({ ...this.state, providers: [...this.state.providers, provider] });
      return this.getState();
    });
  }

  async removeProvider(id: string): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      if (typeof id !== "string" || id.length === 0 || id.length > 128) throw new Error("Invalid Ollama provider identifier");
      if (!this.state.providers.some((provider) => provider.id === id)) throw new Error("Ollama provider was not found");
      const providers = this.state.providers.filter((provider) => provider.id !== id);
      const installedModels = this.state.installedModels.filter((model) => model.providerId !== id);
      await this.persist({ ...this.state, providers, installedModels });
      return this.getState();
    });
  }

  async refreshProvider(id: string): Promise<OllamaRefreshResult> {
    return this.withMutation(async () => {
      if (typeof id !== "string" || id.length === 0 || id.length > 128) throw new Error("Invalid Ollama provider identifier");
      const provider = this.state.providers.find((candidate) => candidate.id === id);
      if (!provider) throw new Error("Ollama provider was not found");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OLLAMA_PROBE_TIMEOUT_MS);
      const checkedAt = new Date().toISOString();
      try {
      const endpoint = normalizeOllamaEndpoint(provider.endpoint);
      const response = await fetch(`${endpoint}/api/tags`, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`Ollama local API returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) throw new Error("Ollama local API did not return application/json");
      const contentLength = response.headers.get("content-length");
      if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > OLLAMA_MAX_RESPONSE_BYTES)) throw new Error("Ollama local API response is too large");
      if (!response.body) throw new Error("Ollama local API returned no response body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          totalBytes += next.value.byteLength;
          if (totalBytes > OLLAMA_MAX_RESPONSE_BYTES) {
            controller.abort();
            throw new Error("Ollama local API response is too large");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
      const models = parseOllamaTagsPayload(JSON.parse(body) as unknown, provider.id, checkedAt);
      const nextProvider: OllamaProviderRecord = {
        ...provider,
        probe: { state: "healthy", checkedAt, detail: null, modelCount: models.length },
      };
      const nextState = {
        ...this.state,
        providers: this.state.providers.map((candidate) => candidate.id === id ? nextProvider : candidate),
        installedModels: [...this.state.installedModels.filter((model) => model.providerId !== id), ...models],
        updatedAt: checkedAt,
      };
      await this.persist(nextState);
      return { state: this.getState(), providerId: id, modelCount: models.length, completeInstalledInventory: true };
      } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError"
        ? "The local Ollama API did not respond within 1500 ms."
        : error instanceof Error ? error.message : "The local Ollama API could not be read.";
      await this.persist({
        ...this.state,
        providers: this.state.providers.map((candidate) => candidate.id === id
          ? { ...candidate, probe: { ...candidate.probe, state: "unavailable", checkedAt, detail } }
          : candidate),
      });
      throw new Error(detail);
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  exportMetadata(format: ExportFormat): ExportResult {
    this.assertReady();
    return exportOllamaMetadata(this.state, format);
  }

  async importMetadata(value: unknown): Promise<OllamaSuiteState> {
    return this.withMutation(async () => {
      const imported = parseOllamaMetadataExport(value);
      await this.persist(imported);
      return this.getState();
    });
  }

  metadataEnvelope() {
    this.assertReady();
    return createOllamaMetadataExport(this.state);
  }
}
