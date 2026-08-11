import { create } from "zustand";
import type {
  AddDownloadRequest,
  AppSettings,
  DownloadCategory,
  DownloadItem,
  DownloadQueue,
  NewDownloadInfo,
  PresentationPatch,
  PresentationSettings,
  PresentationSettingKey,
  SettingKey,
  SettingsPatch,
} from "@shared/types";
import { applyAppearanceSettings } from "./settingsAppearance";

export type SidebarFilter =
  | { kind: "all" }
  | { kind: "category"; category: DownloadCategory }
  | { kind: "status"; status: "finished" | "unfinished" }
  | { kind: "queue"; queueId: string };

export type SortKey = "name" | "size" | "status" | "speed" | "eta" | "dateAdded";
export interface SortState {
  key: SortKey;
  direction: "asc" | "desc";
}

interface DialogsState {
  addDownload: boolean;
  settings: boolean;
  queues: boolean;
  /** id of the item whose details dialog is open, or null */
  detailsItemId: string | null;
}

export type SettingsFocus = "language" | "school-mode" | "show-emojis" | "appearance" | "downloads" | "auto-organize" | "auto-organize-rules" | "advanced" | null;

interface AppState {
  // live data, mirrored from the main process
  items: DownloadItem[];
  queues: DownloadQueue[];
  settings: AppSettings | null;
  ready: boolean;

  // local UI state
  filter: SidebarFilter;
  searchText: string;
  searchMode: "text" | "regex";
  searchFlags: string;
  selectedIds: Set<string>;
  sort: SortState;
  dialogs: DialogsState;
  settingsFocus: SettingsFocus;
  addDownloadPrefillUrl: string;

  // lifecycle
  init: () => () => void;

  // UI actions
  setFilter: (filter: SidebarFilter) => void;
  setSearchText: (text: string) => void;
  setSearchMode: (mode: "text" | "regex") => void;
  setSearchFlags: (flags: string) => void;
  setSort: (key: SortKey) => void;
  toggleSelect: (id: string) => void;
  selectOnly: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  openAddDownload: (prefillUrl?: string) => void;
  closeAddDownload: () => void;
  openSettings: (focus?: Exclude<SettingsFocus, null>) => void;
  closeSettings: () => void;
  openQueues: () => void;
  closeQueues: () => void;
  openDetails: (id: string) => void;
  closeDetails: () => void;

  // window.api action wrappers
  addDownload: (req: AddDownloadRequest) => Promise<string>;
  probeUrl: (url: string) => Promise<NewDownloadInfo>;
  previewCategory: (fileName: string, url: string) => Promise<DownloadCategory>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>;
  retryDownload: (id: string) => Promise<void>;
  openFile: (id: string) => Promise<void>;
  openFolder: (id: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: SettingsPatch, resetKeys?: SettingKey[]) => Promise<AppSettings>;
  getPresentationSettings: () => Promise<PresentationSettings>;
  setPresentationSettings: (settings: PresentationPatch, resetKeys?: PresentationSettingKey[]) => Promise<PresentationSettings>;
  createQueue: (queue: Partial<DownloadQueue>) => Promise<DownloadQueue>;
  updateQueue: (queue: DownloadQueue) => Promise<void>;
  deleteQueue: (id: string) => Promise<void>;
  startQueue: (id: string) => Promise<void>;
  stopQueue: (id: string) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;

  // composite actions
  stopAllActive: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  items: [],
  queues: [],
  settings: null,
  ready: false,

  filter: { kind: "all" },
  searchText: "",
  searchMode: "text",
  searchFlags: "g",
  selectedIds: new Set(),
  sort: { key: "dateAdded", direction: "desc" },
  dialogs: { addDownload: false, settings: false, queues: false, detailsItemId: null },
  settingsFocus: null,
  addDownloadPrefillUrl: "",

  init: () => {
    window.api.getState().then((s) =>
      set(() => {
        applyAppearanceSettings(s.settings);
        return { items: s.items, queues: s.queues, settings: s.settings, ready: true };
      })
    );
    const unsubscribe = window.api.onStateChanged((s) => {
      set(() => {
        applyAppearanceSettings(s.settings);
        return { items: s.items, queues: s.queues, settings: s.settings };
      });
    });
    const unsubscribePresentation = window.api.onPresentationChanged((presentation) => {
      set((state) => {
        if (!state.settings) return state;
        const nextSettings = { ...state.settings, ...presentation };
        applyAppearanceSettings(nextSettings);
        return { settings: nextSettings };
      });
    });
    return () => {
      unsubscribe();
      unsubscribePresentation();
    };
  },

  setFilter: (filter) => set({ filter, selectedIds: new Set() }),
  setSearchText: (searchText) => set({ searchText }),
  setSearchMode: (searchMode) => set({ searchMode }),
  setSearchFlags: (searchFlags) => set({ searchFlags }),
  setSort: (key) =>
    set((state) => ({
      sort:
        state.sort.key === key
          ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" },
    })),

  toggleSelect: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  selectOnly: (id) => set({ selectedIds: new Set([id]) }),
  selectMany: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() }),

  openAddDownload: (prefillUrl) =>
    set((state) => ({
      dialogs: { ...state.dialogs, addDownload: true },
      addDownloadPrefillUrl: prefillUrl ?? "",
    })),
  closeAddDownload: () =>
    set((state) => ({ dialogs: { ...state.dialogs, addDownload: false }, addDownloadPrefillUrl: "" })),
  openSettings: (focus) => set((state) => ({
    dialogs: { ...state.dialogs, settings: true },
    settingsFocus: focus ?? null,
  })),
  closeSettings: () => set((state) => ({ dialogs: { ...state.dialogs, settings: false }, settingsFocus: null })),
  openQueues: () => set((state) => ({ dialogs: { ...state.dialogs, queues: true } })),
  closeQueues: () => set((state) => ({ dialogs: { ...state.dialogs, queues: false } })),
  openDetails: (id) => set((state) => ({ dialogs: { ...state.dialogs, detailsItemId: id } })),
  closeDetails: () => set((state) => ({ dialogs: { ...state.dialogs, detailsItemId: null } })),

  addDownload: async (req) => {
    const id = await window.api.addDownload(req);
    set((state) => ({ dialogs: { ...state.dialogs, addDownload: false }, addDownloadPrefillUrl: "" }));
    return id;
  },
  probeUrl: (url) => window.api.probeUrl(url),
  previewCategory: (fileName, url) => window.api.previewCategory(fileName, url),
  pauseDownload: (id) => window.api.pauseDownload(id),
  resumeDownload: (id) => window.api.resumeDownload(id),
  cancelDownload: (id) => window.api.cancelDownload(id),
  removeDownload: (id, deleteFile) => window.api.removeDownload(id, deleteFile),
  retryDownload: (id) => window.api.retryDownload(id),
  openFile: (id) => window.api.openFile(id),
  openFolder: (id) => window.api.openFolder(id),
  getSettings: () => window.api.getSettings(),
  setSettings: async (settings, resetKeys = []) => {
    const updated = await window.api.setSettings(settings, resetKeys);
    applyAppearanceSettings(updated);
    set({ settings: updated });
    return updated;
  },
  getPresentationSettings: () => window.api.getPresentationSettings(),
  setPresentationSettings: async (settings, resetKeys = []) => {
    const updated = await window.api.setPresentationSettings(settings, resetKeys);
    set((state) => {
      if (!state.settings) return state;
      const nextSettings = { ...state.settings, ...updated };
      applyAppearanceSettings(nextSettings);
      return { settings: nextSettings };
    });
    return updated;
  },
  createQueue: (queue) => window.api.createQueue(queue),
  updateQueue: (queue) => window.api.updateQueue(queue),
  deleteQueue: (id) => window.api.deleteQueue(id),
  startQueue: (id) => window.api.startQueue(id),
  stopQueue: (id) => window.api.stopQueue(id),
  pickFolder: () => window.api.pickFolder(),
  minimizeWindow: () => window.api.minimizeWindow(),
  maximizeWindow: () => window.api.maximizeWindow(),
  closeWindow: () => window.api.closeWindow(),

  stopAllActive: () => {
    const { items } = get();
    for (const item of items) {
      if (item.status === "downloading" || item.status === "queued") {
        void window.api.pauseDownload(item.id);
      }
    }
  },
}));
