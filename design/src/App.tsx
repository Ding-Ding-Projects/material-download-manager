import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_QUEUE_ID, type DownloadCategory, type DownloadItem } from "@shared/types";
import type { TabState } from "@shared/tabModel";
import { useAppStore } from "./store/useAppStore";
import { loadTabState, saveTabState } from "./store/tabPreferences";
import { getUiCopy } from "./i18n/ui";
import { chooseDimSum, type DimSumDish } from "./dimSum";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "./utils/category";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import DownloadTable from "./components/DownloadTable";
import StatusBar from "./components/StatusBar";
import AddDownloadDialog from "./components/AddDownloadDialog";
import DownloadDetailsDialog from "./components/DownloadDetailsDialog";
import SettingsDialog from "./components/SettingsDialog";
import QueuesDialog from "./components/QueuesDialog";
import DestructiveActionGate, {
  type DestructiveActionRequest,
} from "./components/DestructiveActionGate";
import NotificationCenter, { notify } from "./components/NotificationCenter";
import RendererAccessibilityBridge from "./components/RendererAccessibilityBridge";
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette";
import UpdaterBanner from "./components/UpdaterBanner";
import TabStrip from "./components/TabStrip";
import DimSumSurprise from "./components/DimSumSurprise";
import HistoryPanel from "./components/HistoryPanel";
import ChangelogPanel from "./components/ChangelogPanel";
import DocumentationPanel from "./components/DocumentationPanel";
import ConverterPanel from "./components/ConverterPanel";
import NarratorController, { requestNarration } from "./narration/NarratorController";
import { setActiveTab } from "@shared/tabModel";
import { useFilteredItems } from "./hooks/useFilteredItems";
import { clearLegacyDisplayName, readLegacyDisplayName } from "./store/displayPreferences";

const DESTRUCTIVE_REQUEST_EVENT = "mdm:request-destructive-action";
const CLOSE_CONTEXT_MENU_EVENT = "mdm:close-context-menus";

function itemName(item: DownloadItem): string {
  return item.fileName || item.url;
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const theme = useAppStore((s) => s.settings?.theme ?? "system");
  const settings = useAppStore((s) => s.settings);
  const filteredItems = useFilteredItems();
  const dialogs = useAppStore((s) => s.dialogs);
  const items = useAppStore((s) => s.items);
  const queues = useAppStore((s) => s.queues);
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const openAddDownload = useAppStore((s) => s.openAddDownload);
  const openSettings = useAppStore((s) => s.openSettings);
  const openQueues = useAppStore((s) => s.openQueues);
  const startQueue = useAppStore((s) => s.startQueue);
  const stopQueue = useAppStore((s) => s.stopQueue);
  const stopAllActive = useAppStore((s) => s.stopAllActive);
  const [destructiveRequest, setDestructiveRequest] = useState<DestructiveActionRequest | null>(null);
  const [tabState, setTabState] = useState<TabState>(() => loadTabState());
  const [dimSumSurprise, setDimSumSurprise] = useState<DimSumDish | null>(null);
  const dimSumDrawn = useRef(false);
  const displayNameMigrationAttempted = useRef(false);
  const copy = useMemo(
    () => getUiCopy(settings),
    [settings?.funnyLevelCantonese, settings?.funnyLevelEnglish, settings?.languageMode, settings?.schoolModeEnabled, settings?.schoolModeName, settings?.showEmojis]
  );
  const observedItems = useRef(false);
  const previousItems = useRef(new Map<string, Pick<DownloadItem, "status" | "error" | "fileName" | "url">>());
  const activeItems = items.filter((item) => item.status === "added" || item.status === "queued" || item.status === "downloading");
  const hasUnsavedWork = dialogs.addDownload || activeItems.length > 0;
  const unsavedWorkReason = dialogs.addDownload
    ? "The download form is still open; finish or close it before restarting."
    : `${activeItems.length} download${activeItems.length === 1 ? " is" : "s are"} still active; pause or finish it before restarting.`;

  const activeQueueId = filter.kind === "queue" ? filter.queueId : DEFAULT_QUEUE_ID;
  const activeQueue = queues.find((queue) => queue.id === activeQueueId);
  const activeQueueName = activeQueue?.name ?? "Default Queue";
  const visibleTabState = useMemo<TabState>(() => {
    if (!settings?.schoolModeEnabled) return tabState;
    const tabs = tabState.tabs.filter((tab) => tab.id !== "converter");
    const activeTabId = tabState.activeTabId === "converter"
      ? tabs.find((tab) => tab.id === "downloads")?.id ?? tabs[0]?.id ?? null
      : tabState.activeTabId;
    return {
      ...tabState,
      tabs,
      groups: tabState.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== "converter") })),
      activeTabId,
      activeGroupId: tabs.find((tab) => tab.id === activeTabId)?.groupId ?? null,
    };
  }, [settings?.schoolModeEnabled, tabState]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      {
        id: "action.add-url",
        label: copy.text("Add URL", "加入網址"),
        description: copy.text("Open the download form for a new URL", "開啟表格加入新網址"),
        keywords: ["download", "new", "create"],
        section: "Actions",
        onSelect: () => openAddDownload(),
      },
      {
        id: "action.stop-all",
        label: copy.text("Stop All", "全部停止"),
        description: copy.text("Pause every active or queued download", "暫停所有進行中或排隊中嘅下載"),
        keywords: ["pause", "downloads", "stop"],
        section: "Actions",
        onSelect: stopAllActive,
      },
      {
        id: "action.check-for-updates",
        label: "Check for updates",
        description: copy.text("Check the unsigned HTTPS update feed", "檢查未簽名 HTTPS 更新來源"),
        keywords: ["update", "version", "release", "restart"],
        section: "Actions",
        onSelect: () => void window.api.checkForUpdates(),
      },
      {
        id: "action.start-queue",
        label: copy.text("Start Queue", "開始佇列"),
        description: `Start ${activeQueueName}`,
        keywords: ["queue", activeQueueName, "run", "resume"],
        section: "Actions",
        onSelect: () => void startQueue(activeQueueId),
      },
      {
        id: "action.stop-queue",
        label: copy.text("Stop Queue", "停止佇列"),
        description: `Stop ${activeQueueName}`,
        keywords: ["queue", activeQueueName, "pause", "stop"],
        section: "Actions",
        onSelect: () => void stopQueue(activeQueueId),
      },
      {
        id: "destination.queues",
        label: copy.queues,
        description: copy.text("Open the queue manager", "開啟佇列管理器"),
        keywords: ["queue", "schedule", "concurrency"],
        section: "Destinations",
        onSelect: openQueues,
      },
      {
        id: "destination.settings",
        label: copy.settings,
        description: copy.text("Open language, appearance, and download settings", "開啟語言、外觀同下載設定"),
        keywords: ["preferences", "configuration", "language", "theme", "appearance"],
        section: "Settings",
        onSelect: () => openSettings(),
      },
      {
        id: "destination.history",
        label: copy.text("History", "紀錄"),
        description: copy.text("Browse local revision history and export the filtered index", "瀏覽本機修訂紀錄並匯出篩選後索引"),
        keywords: ["history", "revisions", "versions", "export", "undo"],
        section: "Destinations",
        onSelect: () => selectAppTab("history"),
      },
      {
        id: "destination.changelog",
        label: copy.text("Changelog", "更新日誌"),
        description: copy.text("Browse embedded stable release notes and source commits", "瀏覽嵌入嘅穩定版本說明同來源 commit"),
        keywords: ["changelog", "release", "version", "commit", "notes"],
        section: "Destinations",
        onSelect: () => selectAppTab("changelog"),
      },
      {
        id: "destination.documentation",
        label: copy.text("Documentation", "文件"),
        description: copy.text("Browse the offline feature articles bundled with the app", "瀏覽程式內置嘅離線功能文章"),
        keywords: ["documentation", "docs", "help", "articles", "offline", "markdown"],
        section: "Destinations",
        onSelect: () => selectAppTab("documentation"),
      },
      ...(items.length > 0
        ? [{
            id: "action.open-progress-window",
            label: copy.text("Open Progress Window", "開啟進度視窗"),
            description: copy.text("Open a selected download in a separate window", "喺獨立視窗開啟所選下載"),
            keywords: ["progress", "window", "download", "separate"],
            section: "Actions",
            onSelect: () => {
              const target = useAppStore.getState().items.find((item) => ["downloading", "queued", "paused", "added"].includes(item.status)) ?? useAppStore.getState().items[0];
              if (target) void window.api.openProgressWindow(target.id);
            },
          }]
        : []),
      ...(!settings?.schoolModeEnabled ? [{
        id: "settings.language",
        label: copy.text("Settings · Language mode", "設定 · 語言模式"),
        description: copy.text("Open Settings to adjust language mode and funny levels", "開啟設定調整語言模式同搞笑程度"),
        keywords: ["english", "cantonese", "bilingual", "funny"],
        section: "Settings",
        onSelect: () => openSettings("language"),
      }] : []),
      {
        id: "settings.school-mode",
        label: copy.text(`Settings · ${settings?.schoolModeName ?? "School mode"}`, `設定 · ${settings?.schoolModeName ?? "School mode"}`),
        description: copy.text("Open the user-renamable English-only mode and reset metadata", "開啟可改名嘅純英文模式同重設 metadata"),
        keywords: ["school", "mode", "english", "reset", "credential"],
        section: "Settings",
        onSelect: () => openSettings("school-mode"),
      },
      ...(!settings?.schoolModeEnabled ? [{
        id: "settings.show-emojis",
        label: copy.text("Settings · Show emojis", "設定 · 顯示 emoji"),
        description: copy.text("Open the decorative emoji setting for dialogs and message boxes", "開啟對話框同訊息框嘅裝飾 emoji 設定"),
        keywords: ["emoji", "dialogs", "message", "boxes"],
        section: "Settings",
        onSelect: () => openSettings("show-emojis"),
      }] : []),
      ...(!settings?.schoolModeEnabled ? [{
        id: "settings.narrator",
        label: copy.text("Settings · Spoken narrator", "設定 · 語音朗讀器"),
        description: copy.text("Enable English, Cantonese, or serialized bilingual event narration with quiet, screen-reader, and reduced-motion safety", "開啟英文、廣東話或者英粵順序嘅事件朗讀，設有靜音、讀屏同減少動態安全設定"),
        keywords: ["narrator", "speech", "voice", "tts", "cantonese", "bilingual", "quiet", "screen reader", "assistive technology", "reduced motion"],
        section: "Settings",
        onSelect: () => openSettings("narrator"),
      }] : []),
      ...(!settings?.schoolModeEnabled ? [{
        id: "settings.appearance",
        label: copy.text("Settings · Appearance", "設定 · 外觀"),
        description: copy.text("Open Settings to adjust theme, density, accent, and fonts", "開啟設定調整主題、密度、主色同字型"),
        keywords: ["theme", "dark", "light", "density", "font", "accent"],
        section: "Settings",
        onSelect: () => openSettings("appearance"),
      }] : []),
      {
        id: "settings.auto-organize",
        label: copy.text("Settings · Auto-organize folders", "設定 · 自動分類資料夾"),
        description: copy.text("Open the exact category-folder routing switch and six path previews", "直接開啟分類資料夾開關同六個路徑預覽"),
        keywords: ["downloads", "folders", "general", "documents", "videos", "music", "programs", "compressed"],
        section: copy.text("Settings", "設定"),
        onSelect: () => openSettings("auto-organize"),
      },
      {
        id: "settings.auto-organize-rules",
        label: copy.text("Settings · Custom classification rules", "設定 · 自訂分類規則"),
        description: copy.text("Open the ordered regex-rule editor for download classification", "直接開啟下載分類嘅已排序 regex 規則編輯器"),
        keywords: ["downloads", "regex", "rules", "classification", "filename", "url", "reorder"],
        section: copy.text("Settings", "設定"),
        onSelect: () => openSettings("auto-organize-rules"),
      },
      {
        id: "settings.authenticator",
        label: copy.text("Settings · Authenticator", "設定 · Authenticator 驗證器"),
        description: copy.text("Open local TOTP QR pairing and secret-free metadata export", "開啟本機 TOTP QR 配對同無 secret 資料標籤匯出"),
        keywords: ["authenticator", "totp", "qr", "otpauth", "pairing", "metadata", "export"],
        section: copy.text("Settings", "設定"),
        onSelect: () => openSettings("authenticator"),
      },
      {
        id: "destination.ollama-suite",
        label: copy.text("Local Ollama suite", "本機 Ollama 管理器"),
        description: copy.text("Manage loopback providers and verified installed-model metadata", "管理 loopback 供應者同已驗證嘅本機模型資料標籤"),
        keywords: ["ollama", "local", "loopback", "models", "provider", "metadata", "offline"],
        section: copy.text("Destinations", "目的地"),
        onSelect: () => openSettings("ollama"),
      },
      ...(!settings?.schoolModeEnabled ? [{
        id: "destination.file-converter",
        label: copy.text("Local file converter", "本機檔案轉換器"),
        description: copy.text("Choose bounded local adapters, inspect source signatures, and manage a private conversion queue", "選擇有界線嘅本機轉換器、檢查來源簽名，同埋管理私隱轉換佇列"),
        keywords: ["convert", "converter", "file", "json", "csv", "text", "base64", "pdf", "offline"],
        section: copy.text("Destinations", "目的地"),
        onSelect: () => selectAppTab("converter"),
      }] : []),
      {
        id: "destination.all-downloads",
        label: "Downloads · All",
        description: "Show every download in the list",
        keywords: ["downloads", "all", "list"],
        section: "Destinations",
        onSelect: () => setFilter({ kind: "all" }),
      },
      {
        id: "destination.finished",
        label: "Downloads · Finished",
        description: "Show completed downloads",
        keywords: ["downloads", "finished", "completed"],
        section: "Destinations",
        onSelect: () => setFilter({ kind: "status", status: "finished" }),
      },
      {
        id: "destination.unfinished",
        label: "Downloads · Unfinished",
        description: "Show downloads that are not completed",
        keywords: ["downloads", "unfinished", "active", "error"],
        section: "Destinations",
        onSelect: () => setFilter({ kind: "status", status: "unfinished" }),
      },
    ];

    const categoryCommands = CATEGORY_ORDER.map((category: DownloadCategory) => ({
      id: `destination.category.${category}`,
      label: `Downloads · ${CATEGORY_LABELS[category]}`,
      description: `Show ${CATEGORY_LABELS[category].toLocaleLowerCase()} downloads`,
      keywords: ["downloads", "category", category],
      section: "Destinations",
      onSelect: () => setFilter({ kind: "category", category }),
    }));

    const queueCommands = queues.map((queue) => ({
      id: `destination.queue.${queue.id}`,
      label: `Queues · ${queue.name}`,
      description: `${queue.itemIds.length} download${queue.itemIds.length === 1 ? "" : "s"} in this queue`,
      keywords: ["queue", queue.name, queue.isRunning ? "running" : "stopped"],
      section: "Destinations",
      onSelect: () => setFilter({ kind: "queue", queueId: queue.id }),
    }));

    // Item-scoped actions intentionally stay out of this registry: it has no
    // focused/selected-item contract, so an action must never guess a download.
    return [...commands, ...categoryCommands, ...queueCommands];
  }, [activeQueueId, activeQueueName, copy, filter.kind, items, openAddDownload, openQueues, openSettings, queues, setFilter, settings?.schoolModeEnabled, settings?.schoolModeName, startQueue, stopAllActive, stopQueue]);

  useEffect(() => {
    const unsubscribe = useAppStore.getState().init();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!ready || !settings || displayNameMigrationAttempted.current) return;
    const legacyDisplayName = readLegacyDisplayName();
    if (!legacyDisplayName) {
      clearLegacyDisplayName();
      displayNameMigrationAttempted.current = true;
      return;
    }
    if (settings.displayName !== "Material Download Manager") {
      clearLegacyDisplayName();
      displayNameMigrationAttempted.current = true;
      return;
    }
    displayNameMigrationAttempted.current = true;
    void window.api.setSettings({ displayName: legacyDisplayName }).then(() => {
      clearLegacyDisplayName();
    }).catch(() => {
      displayNameMigrationAttempted.current = false;
      notify({
        tone: "error",
        title: copy.text("Display name migration failed", "顯示名稱搬遷失敗"),
        message: copy.text("The previous display name was kept; try saving it again in Settings.", "之前嘅顯示名稱保留住，請喺設定再儲存一次。"),
      });
    });
  }, [copy, ready, settings]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    saveTabState(tabState);
  }, [tabState]);

  useEffect(() => {
    if (!settings?.schoolModeEnabled || tabState.activeTabId !== "converter") return;
    setTabState((current) => setActiveTab(current, "downloads"));
  }, [settings?.schoolModeEnabled, tabState.activeTabId]);

  useEffect(() => {
    if (!ready || dimSumDrawn.current) return;
    dimSumDrawn.current = true;
    const currentSettings = useAppStore.getState().settings;
    const firstRun = currentSettings
      ? Object.values(currentSettings.settingProvenance).every((source) => source === "compiled-in")
      : true;
    if (firstRun || dialogs.addDownload || dialogs.settings || dialogs.queues || activeItems.length > 0) return;
    if (currentSettings?.schoolModeEnabled) return;
    if (Math.random() < 0.1) setDimSumSurprise(chooseDimSum());
  }, [activeItems.length, dialogs.addDownload, dialogs.queues, dialogs.settings, ready]);

  useEffect(() => {
    if (settings?.schoolModeEnabled) setDimSumSurprise(null);
  }, [settings?.schoolModeEnabled]);

  useEffect(() => {
    function handleDestructiveRequest(event: Event) {
      const detail = (event as CustomEvent<DestructiveActionRequest>).detail;
      if (!detail?.itemIds?.length) return;
      setDestructiveRequest({ itemIds: [...detail.itemIds], deleteFile: Boolean(detail.deleteFile) });
    }
    window.addEventListener(DESTRUCTIVE_REQUEST_EVENT, handleDestructiveRequest);
    return () => window.removeEventListener(DESTRUCTIVE_REQUEST_EVENT, handleDestructiveRequest);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const current = new Map(
      items.map((item) => [item.id, { status: item.status, error: item.error, fileName: item.fileName, url: item.url }])
    );
    if (!observedItems.current) {
      observedItems.current = true;
      previousItems.current = current;
      return;
    }

    items.forEach((item) => {
      const previous = previousItems.current.get(item.id);
      if (!previous || previous.status === item.status) {
        if (item.error && item.error !== previous?.error) {
          notify({
            title: copy.text("Download error", "下載錯誤"),
            message: copy.downloadError(itemName(item), item.error),
            tone: "error",
            narration: {
              english: `${itemName(item)}: ${item.error}`,
              cantonese: `${itemName(item)}：${item.error}`,
              category: "download-error",
            },
          });
        }
        return;
      }

      const name = itemName(item);
      if (item.status === "completed") {
        if (settings?.showCompleteDialog) {
          notify({
            title: copy.text("Download complete", "下載完成"),
            message: name,
            tone: "success",
          });
        }
        requestNarration({
          english: `${name} completed.`,
          cantonese: `${name}：完成。`,
          category: "download-completion",
        });
        return;
      } else if (item.status === "error") {
        const error = item.error || copy.text("The manager reported an error.", "管理器回報咗一個錯誤。");
        notify({
          title: copy.text("Download error", "下載錯誤"),
          message: copy.downloadError(name, error),
          tone: "error",
          narration: {
            english: `${name}: ${error}`,
            cantonese: `${name}：${error}`,
            category: "download-error",
          },
        });
      } else {
        const status = item.status.charAt(0).toUpperCase() + item.status.slice(1);
        notify({ title: copy.text("Download status", "下載狀態"), message: copy.downloadStatus(name, status), tone: "info" });
      }
    });
    previousItems.current = current;
  }, [copy, items, ready]);

  function cancelDestructiveAction() {
    window.dispatchEvent(new Event(CLOSE_CONTEXT_MENU_EVENT));
    setDestructiveRequest(null);
  }

  function confirmDestructiveAction(request: DestructiveActionRequest) {
    setDestructiveRequest(null);
    const removeDownload = useAppStore.getState().removeDownload;
    void Promise.allSettled(request.itemIds.map((id) => removeDownload(id, request.deleteFile))).then((results) => {
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        notify({
          title: copy.text("Removal incomplete", "移除未完成"),
          message: copy.removalIncomplete(failed.length, request.itemIds.length),
          tone: "error",
        });
        return;
      }
      notify({
        title: copy.text("Removal complete", "移除完成"),
        message: copy.removalComplete(request.itemIds.length, request.deleteFile),
        tone: "success",
      });
    });
  }

  function activateTab(tabId: string) {
    if (tabId === "downloads") {
      setFilter({ kind: "all" });
      return;
    }
    if (tabId === "queues") {
      openQueues();
      return;
    }
    if (tabId === "settings") {
      openSettings();
    }
    if (tabId === "history") return;
    if (tabId === "changelog") return;
    if (tabId === "documentation") return;
    if (tabId === "converter") return;
  }

  function selectAppTab(tabId: string) {
    if (tabId === "converter" && settings?.schoolModeEnabled) return;
    setTabState((current) => setActiveTab(current, tabId));
  }

  function updateVisibleTabState(next: TabState) {
    if (!settings?.schoolModeEnabled) {
      setTabState(next);
      return;
    }
    setTabState((current) => {
      const hidden = current.tabs.filter((tab) => tab.id === "converter").map((tab) => ({
        ...tab,
        groupId: next.groups.some((group) => group.id === tab.groupId) ? tab.groupId : null,
      }));
      return {
        ...next,
        tabs: [...next.tabs, ...hidden],
        groups: next.groups.map((group) => ({
          ...group,
          tabIds: [...group.tabIds, ...hidden.filter((tab) => tab.groupId === group.id).map((tab) => tab.id)],
        })),
      };
    });
  }

  return (
    <div className="app">
      <RendererAccessibilityBridge />
      <NarratorController />
      <CommandPalette commands={paletteCommands} />
      <TitleBar />
      <TabStrip state={visibleTabState} onChange={updateVisibleTabState} onActivate={activateTab} />
      <UpdaterBanner hasUnsavedWork={hasUnsavedWork} unsavedWorkReason={unsavedWorkReason} copy={copy} />
      <div className="app-body">
        <Sidebar />
        <main className="main-pane" id={`tabpanel-${visibleTabState.activeTabId ?? "downloads"}`} role="tabpanel" aria-labelledby={`app-tab-${visibleTabState.activeTabId ?? "downloads"}`}>
          {visibleTabState.activeTabId === "history" ? (
            <HistoryPanel />
          ) : visibleTabState.activeTabId === "changelog" ? (
            <ChangelogPanel />
          ) : visibleTabState.activeTabId === "documentation" ? (
            <DocumentationPanel />
          ) : visibleTabState.activeTabId === "converter" && !settings?.schoolModeEnabled ? (
            <ConverterPanel />
          ) : (
            <>
              <Toolbar
                searchEvaluationError={filteredItems.regexError}
                searchEvaluationPending={filteredItems.regexPending}
              />
              <DownloadTable
                filteredItems={filteredItems.items}
                regexError={filteredItems.regexError}
                regexPending={filteredItems.regexPending}
              />
              <StatusBar filteredCount={filteredItems.items.length} regexPending={filteredItems.regexPending} />
            </>
          )}
        </main>
      </div>

      {!ready && (
        <div className="boot-overlay">
          <div className="spinner-lg" />
        </div>
      )}

      {dialogs.addDownload && <AddDownloadDialog />}
      {dialogs.detailsItemId && <DownloadDetailsDialog itemId={dialogs.detailsItemId} />}
      {dialogs.settings && <SettingsDialog />}
      {dialogs.queues && <QueuesDialog />}
      <NotificationCenter />
      {!settings?.schoolModeEnabled && dimSumSurprise && <DimSumSurprise dish={dimSumSurprise} onDismiss={() => setDimSumSurprise(null)} />}
      {destructiveRequest && (
        <DestructiveActionGate
          request={destructiveRequest}
          onCancel={cancelDestructiveAction}
          onConfirm={confirmDestructiveAction}
        />
      )}
    </div>
  );
}
