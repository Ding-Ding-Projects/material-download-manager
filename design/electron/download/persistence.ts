import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AppSettings, DownloadItem, DownloadQueue } from "../../shared/types";
import { DEFAULT_QUEUE_ID } from "../../shared/types";
import {
  createDefaultSettings,
  isBoundedNumber,
  isDensityMode,
  isFunnyLevel,
  isHexColor,
  isLanguageMode,
  isUIFontFamily,
  isUIFontWeight,
  SETTINGS_SCHEMA_VERSION,
} from "../../shared/settings";

export interface PersistedState {
  items: DownloadItem[];
  queues: DownloadQueue[];
  settings: AppSettings;
}

export function defaultSettings(defaultSaveFolder: string): AppSettings {
  return createDefaultSettings(defaultSaveFolder);
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Normalize settings at the persistence boundary. Missing or invalid values
 * never get spread into the live settings object, and every value records
 * whether it came from the state file or the compiled-in fallback.
 */
export function migrateSettings(input: unknown, defaultSaveFolder: string): AppSettings {
  const raw = isRecord(input) ? input : {};
  const settings = createDefaultSettings(defaultSaveFolder);
  const provenance = { ...settings.settingProvenance };

  function adopt<K extends keyof AppSettings>(
    key: K,
    isValid: (value: unknown) => value is AppSettings[K]
  ) {
    if (hasOwn(raw, key) && isValid(raw[key])) {
      settings[key] = raw[key] as AppSettings[K];
      if (key in provenance) provenance[key as keyof typeof provenance] = "persisted";
    }
  }

  adopt("defaultSaveFolder", (value): value is string => typeof value === "string");
  adopt("maxConnectionsPerDownload", (value): value is number => isBoundedNumber(value, 1, 32) && Number.isInteger(value));
  adopt("maxActiveDownloads", (value): value is number => isBoundedNumber(value, 1, 32) && Number.isInteger(value));
  adopt("globalSpeedLimitBytes", (value): value is number => isBoundedNumber(value, 0, Number.MAX_SAFE_INTEGER));
  adopt("showCompleteDialog", (value): value is boolean => typeof value === "boolean");
  adopt("startOnSystemStartup", (value): value is boolean => typeof value === "boolean");
  adopt("theme", (value): value is AppSettings["theme"] => value === "dark" || value === "light" || value === "system");
  adopt("minConnectionPartSize", (value): value is number => isBoundedNumber(value, 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(value));
  adopt("languageMode", isLanguageMode);
  adopt("funnyLevelEnglish", isFunnyLevel);
  adopt("funnyLevelCantonese", isFunnyLevel);
  adopt("density", isDensityMode);
  adopt("accentSeedColor", isHexColor);
  adopt("uiFontFamily", isUIFontFamily);
  adopt("uiFontSize", (value): value is number => isBoundedNumber(value, 10, 32));
  adopt("uiFontWeight", isUIFontWeight);

  // A newer file is read conservatively: known keys are still validated, but
  // the in-memory schema is always the current one so the next save upgrades it.
  settings.settingsVersion = SETTINGS_SCHEMA_VERSION;
  settings.settingProvenance = provenance;
  return settings;
}

export function defaultQueues(): DownloadQueue[] {
  return [
    {
      id: DEFAULT_QUEUE_ID,
      name: "Default Queue",
      maxConcurrent: 3,
      isRunning: true,
      itemIds: [],
      scheduleEnabled: false,
      startAt: null,
      endAt: null,
    },
  ];
}

export class StateStore {
  private static readonly saveChains = new Map<string, Promise<void>>();
  private filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.resolve(userDataPath, "state.json");
  }

  async load(defaultSaveFolder: string): Promise<PersistedState> {
    try {
      const raw = await fsp.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as {
        items?: DownloadItem[];
        queues?: DownloadQueue[];
        settings?: unknown;
      };
      const settings = migrateSettings(parsed.settings, defaultSaveFolder);
      const queues = parsed.queues?.length ? parsed.queues : defaultQueues();
      const items = (parsed.items ?? []).map((item) => ({
        ...item,
        // never resurrect a download as actively "downloading"/"queued" after
        // a restart; it should look paused/interrupted until the user resumes it
        status:
          item.status === "downloading" || item.status === "queued"
            ? ("paused" as const)
            : item.status,
        speed: 0,
      }));
      return { items, queues, settings };
    } catch {
      return {
        items: [],
        queues: defaultQueues(),
        settings: defaultSettings(defaultSaveFolder),
      };
    }
  }

  async save(state: PersistedState): Promise<void> {
    const serialized = JSON.stringify(state, null, 2);
    const previousSave = StateStore.saveChains.get(this.filePath) ?? Promise.resolve();
    const saveOperation = previousSave.catch(() => undefined).then(async () => {
      const tmp = `${this.filePath}.${randomUUID()}.tmp`;
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await fsp.writeFile(tmp, serialized);
        await fsp.rename(tmp, this.filePath);
      } finally {
        await fsp.rm(tmp, { force: true }).catch(() => {});
      }
    });
    StateStore.saveChains.set(this.filePath, saveOperation);
    try {
      await saveOperation;
    } finally {
      if (StateStore.saveChains.get(this.filePath) === saveOperation) {
        StateStore.saveChains.delete(this.filePath);
      }
    }
  }
}
