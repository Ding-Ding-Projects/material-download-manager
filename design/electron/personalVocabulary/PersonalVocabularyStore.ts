import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  PERSONAL_VOCABULARY_MAX_BYTES,
  PERSONAL_VOCABULARY_SCHEMA_VERSION,
  createPersonalVocabularyRuntime,
  parsePersonalVocabularyPayload,
  type PersonalVocabularyReplacement,
  type PersonalVocabularyRuntime,
} from "../../shared/personalVocabulary";

const CACHE_FILE_NAME = "personal-vocabulary-cache.json";

function cloneRuntime(value: PersonalVocabularyRuntime): PersonalVocabularyRuntime {
  return createPersonalVocabularyRuntime(
    value.status.state,
    value.replacements,
  );
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * Read no more than the contract allows, even when the file grows after its
 * initial metadata check. The selected path never leaves this privileged
 * boundary and errors deliberately omit it.
 */
async function readBoundedUtf8File(filePath: string): Promise<{ text: string }> {
  const initial = await fsp.lstat(filePath);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > PERSONAL_VOCABULARY_MAX_BYTES) {
    throw new Error("Personal vocabulary JSON is not an eligible bounded local file");
  }

  const handle = await fsp.open(filePath, "r");
  try {
    const bytes = Buffer.alloc(PERSONAL_VOCABULARY_MAX_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const final = await handle.stat();
    if (!final.isFile() || offset > PERSONAL_VOCABULARY_MAX_BYTES || final.size > PERSONAL_VOCABULARY_MAX_BYTES || final.size !== offset) {
      throw new Error("Personal vocabulary JSON changed or exceeded its bounded size while reading");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
    } catch {
      throw new Error("Personal vocabulary JSON is not valid UTF-8");
    }
    return { text };
  } finally {
    await handle.close();
  }
}

/**
 * Owns the private cache completely outside the application settings and
 * DownloadManager state. It emits only a runtime copy for the local renderer;
 * no source filename, path, file metadata, or parser detail is exposed.
 */
export class PersonalVocabularyStore extends EventEmitter {
  private runtime = createPersonalVocabularyRuntime();
  private initialized = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private lastAttemptWasInvalid = false;

  constructor(private readonly userDataPath: string) {
    super();
  }

  private get cachePath(): string {
    return path.join(this.userDataPath, CACHE_FILE_NAME);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.revalidateCache();
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("Personal vocabulary store is not initialized");
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertInitialized();
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

  private publish(): void {
    this.emit("changed", cloneRuntime(this.runtime));
  }

  private async readValidatedCache(): Promise<PersonalVocabularyRuntime> {
    const loaded = await readBoundedUtf8File(this.cachePath);
    const replacements = parsePersonalVocabularyPayload(loaded.text);
    return createPersonalVocabularyRuntime("loaded", replacements);
  }

  /** Revalidate the local cache before every renderer load and fail closed. */
  private async revalidateCache(): Promise<void> {
    try {
      const loaded = await this.readValidatedCache();
      this.runtime = this.lastAttemptWasInvalid
        ? createPersonalVocabularyRuntime("invalid", loaded.replacements)
        : loaded;
    } catch (error) {
      if (isMissingFile(error)) {
        this.lastAttemptWasInvalid = false;
        this.runtime = createPersonalVocabularyRuntime();
      } else {
        this.lastAttemptWasInvalid = false;
        this.runtime = createPersonalVocabularyRuntime("invalid");
      }
    }
  }

  async getRuntime(): Promise<PersonalVocabularyRuntime> {
    this.assertInitialized();
    await this.revalidateCache();
    return cloneRuntime(this.runtime);
  }

  private async persist(replacements: readonly PersonalVocabularyReplacement[]): Promise<void> {
    const serialized = `${JSON.stringify({
      schemaVersion: PERSONAL_VOCABULARY_SCHEMA_VERSION,
      replacements: Object.fromEntries(replacements.map((replacement) => [replacement.from, replacement.to])),
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > PERSONAL_VOCABULARY_MAX_BYTES) {
      throw new Error("Personal vocabulary JSON exceeds the private cache bound");
    }
    await fsp.mkdir(this.userDataPath, { recursive: true });
    const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await fsp.rename(temporary, this.cachePath);
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Reads and validates a selected local JSON file. A rejected replacement
   * leaves the last valid private cache active unless the user later clears it.
   * The return value intentionally carries no selected source information.
   */
  async replaceFromFile(filePath: string): Promise<PersonalVocabularyRuntime> {
    return this.withMutation(async () => {
      const previous = await this.getRuntime();
      try {
        const selected = await readBoundedUtf8File(filePath);
        const replacements = parsePersonalVocabularyPayload(selected.text);
        await this.persist(replacements);
        this.lastAttemptWasInvalid = false;
        this.runtime = await this.readValidatedCache();
      } catch {
        this.lastAttemptWasInvalid = true;
        this.runtime = createPersonalVocabularyRuntime(
          "invalid",
          previous.replacements,
        );
      }
      this.publish();
      return cloneRuntime(this.runtime);
    });
  }

  async clear(): Promise<PersonalVocabularyRuntime> {
    return this.withMutation(async () => {
      try {
        await fsp.rm(this.cachePath, { force: true });
      } catch {
        this.runtime = createPersonalVocabularyRuntime("invalid");
        this.lastAttemptWasInvalid = false;
        this.publish();
        return cloneRuntime(this.runtime);
      }
      this.lastAttemptWasInvalid = false;
      this.runtime = createPersonalVocabularyRuntime();
      this.publish();
      return cloneRuntime(this.runtime);
    });
  }
}
