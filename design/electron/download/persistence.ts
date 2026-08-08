import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AppSettings, AutoOrganizeRule, DownloadItem, DownloadQueue } from "../../shared/types";
import { AUTO_ORGANIZE_RULE_LIMIT, AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH, DEFAULT_QUEUE_ID } from "../../shared/types";
import {
  createDefaultSettings,
  isAutoOrganizeRule,
  isAutoOrganizeRules,
  isBoundedNumber,
  isDensityMode,
  isFunnyLevel,
  isHexColor,
  isLanguageMode,
  isValidDefaultSaveFolder,
  isUIFontFamily,
  isUIFontWeight,
  SETTINGS_SCHEMA_VERSION,
} from "../../shared/settings";
import { normalizeRegexFlags } from "../../shared/regex";

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

function migratedV2RuleId(value: unknown, index: number, seenIds: ReadonlySet<string>): string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !(value in Object.prototype) &&
    !seenIds.has(value)
  ) {
    return value;
  }
  const base = `legacy-rule-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (seenIds.has(candidate) || candidate in Object.prototype) {
    const ending = `-${suffix++}`;
    candidate = `${base.slice(0, 64 - ending.length)}${ending}`;
  }
  return candidate;
}

function migrateV2AutoOrganizeRules(value: unknown[]): AutoOrganizeRule[] {
  const migrated: AutoOrganizeRule[] = [];
  const seenIds = new Set<string>();
  for (const [index, rawRule] of value.slice(0, AUTO_ORGANIZE_RULE_LIMIT).entries()) {
    if (!isRecord(rawRule)) continue;
    const id = migratedV2RuleId(rawRule.id, index, seenIds);
    const name = typeof rawRule.name === "string" && rawRule.name.trim().length > 0
      ? rawRule.name.slice(0, AUTO_ORGANIZE_RULE_NAME_MAX_LENGTH)
      : `Rule ${index + 1}`;
    const candidate = {
      id,
      name,
      pattern: rawRule.pattern,
      flags: typeof rawRule.flags === "string" ? normalizeRegexFlags(rawRule.flags) : rawRule.flags,
      category: rawRule.category === "image" ? "other" : rawRule.category,
    };
    if (!isAutoOrganizeRule(candidate)) continue;
    seenIds.add(id);
    migrated.push(candidate);
  }
  return migrated;
}

function normalizeStoredAutoOrganizeRules(value: unknown, settingsVersion: unknown): AppSettings["autoOrganizeRules"] | null {
  if (!Array.isArray(value)) return null;
  const candidate = settingsVersion === 2 ? migrateV2AutoOrganizeRules(value) : value;
  if (!isAutoOrganizeRules(candidate)) return null;
  return candidate.map((rule) => ({
    id: rule.id,
    name: rule.name,
    pattern: rule.pattern,
    flags: rule.flags,
    category: rule.category,
  }));
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
  const provenanceCandidate = isRecord(raw.settingProvenance) ? raw.settingProvenance : null;
  const isSupportedStoredSchema = Number.isInteger(raw.settingsVersion)
    && Number(raw.settingsVersion) >= 2
    && Number(raw.settingsVersion) <= SETTINGS_SCHEMA_VERSION;
  const storedProvenance =
    isSupportedStoredSchema && provenanceCandidate
      ? provenanceCandidate
      : null;

  function adopt<K extends keyof AppSettings>(
    key: K,
    isValid: (value: unknown) => value is AppSettings[K]
  ) {
    if (hasOwn(raw, key) && isValid(raw[key])) {
      const storedSource = storedProvenance?.[key as string];
      if (storedSource === "compiled-in") return;
      settings[key] = raw[key] as AppSettings[K];
      if (key in provenance) {
        provenance[key as keyof typeof provenance] = "persisted";
      }
    }
  }

  adopt("defaultSaveFolder", isValidDefaultSaveFolder);
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
  adopt("autoOrganizeEnabled", (value): value is boolean => typeof value === "boolean");
  if (hasOwn(raw, "autoOrganizeRules")) {
    const normalizedRules = normalizeStoredAutoOrganizeRules(raw.autoOrganizeRules, raw.settingsVersion);
    const storedSource = storedProvenance?.autoOrganizeRules;
    if (normalizedRules && storedSource !== "compiled-in") {
      settings.autoOrganizeRules = normalizedRules;
      provenance.autoOrganizeRules = "persisted";
    }
  }

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
