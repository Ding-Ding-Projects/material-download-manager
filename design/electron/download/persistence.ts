import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AppSettings, DownloadItem, DownloadQueue } from "../../shared/types";
import { DEFAULT_QUEUE_ID } from "../../shared/types";

export interface PersistedState {
  items: DownloadItem[];
  queues: DownloadQueue[];
  settings: AppSettings;
}

export function defaultSettings(defaultSaveFolder: string): AppSettings {
  return {
    defaultSaveFolder,
    maxConnectionsPerDownload: 8,
    maxActiveDownloads: 3,
    globalSpeedLimitBytes: 0,
    showCompleteDialog: true,
    startOnSystemStartup: false,
    theme: "dark",
    minConnectionPartSize: 2 * 1024 * 1024,
  };
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
  private filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "state.json");
  }

  async load(defaultSaveFolder: string): Promise<PersistedState> {
    try {
      const raw = await fsp.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const settings = { ...defaultSettings(defaultSaveFolder), ...(parsed.settings ?? {}) };
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
    const tmp = this.filePath + ".tmp";
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, this.filePath);
  }
}
