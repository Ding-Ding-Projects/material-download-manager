import { create } from "zustand";
import type {
  AddDownloadRequest,
  AppSettings,
  DownloadCategory,
  DownloadItem,
  DownloadQueue,
  NewDownloadInfo,
} from "@shared/types";

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

interface AppState {
  // live data, mirrored from the main process
  items: DownloadItem[];
  queues: DownloadQueue[];
  settings: AppSettings | null;
  ready: boolean;

  // local UI state
  filter: SidebarFilter;
  searchText: string;
  selectedIds: Set<string>;
  sort: SortState;
  dialogs: DialogsState;
  addDownloadPrefillUrl: string;

  // lifecycle
  init: () => () => void;

  // UI actions
  setFilter: (filter: SidebarFilter) => void;
  setSearchText: (text: string) => void;
  setSort: (key: SortKey) => void;
  toggleSelect: (id: string) => void;
  selectOnly: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  openAddDownload: (prefillUrl?: string) => void;
  closeAddDownload: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openQueues: () => void;
  closeQueues: () => void;
  openDetails: (id: string) => void;
  closeDetails: () => void;

  // window.api action wrappers
  addDownload: (req: AddDownloadRequest) => Promise<string>;
  probeUrl: (url: string) => Promise<NewDownloadInfo>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>;
  retryDownload: (id: string) => Promise<void>;
  openFile: (id: string) => Promise<void>;
  openFolder: (id: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
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
  selectedIds: new Set(),
  sort: { key: "dateAdded", direction: "desc" },
  dialogs: { addDownload: false, settings: false, queues: false, detailsItemId: null },
  addDownloadPrefillUrl: "",

  init: () => {
    window.api.getState().then((s) =>
      set({ items: s.items, queues: s.queues, settings: s.settings, ready: true })
    );
    const unsubscribe = window.api.onStateChanged((s) => {
      set({ items: s.items, queues: s.queues, settings: s.settings });
    });
    return unsubscribe;
  },

  setFilter: (filter) => set({ filter, selectedIds: new Set() }),
  setSearchText: (searchText) => set({ searchText }),
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
  openSettings: () => set((state) => ({ dialogs: { ...state.dialogs, settings: true } })),
  closeSettings: () => set((state) => ({ dialogs: { ...state.dialogs, settings: false } })),
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
  pauseDownload: (id) => window.api.pauseDownload(id),
  resumeDownload: (id) => window.api.resumeDownload(id),
  cancelDownload: (id) => window.api.cancelDownload(id),
  removeDownload: (id, deleteFile) => window.api.removeDownload(id, deleteFile),
  retryDownload: (id) => window.api.retryDownload(id),
  openFile: (id) => window.api.openFile(id),
  openFolder: (id) => window.api.openFolder(id),
  getSettings: () => window.api.getSettings(),
  setSettings: async (settings) => {
    const updated = await window.api.setSettings(settings);
    set({ settings: updated });
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
