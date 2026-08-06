import { useEffect, useMemo, useRef, useState } from "react";
import type { DownloadCategory, DownloadItem } from "@shared/types";
import { useAppStore } from "./store/useAppStore";
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

const DESTRUCTIVE_REQUEST_EVENT = "mdm:request-destructive-action";
const CLOSE_CONTEXT_MENU_EVENT = "mdm:close-context-menus";

function itemName(item: DownloadItem): string {
  return item.fileName || item.url;
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const theme = useAppStore((s) => s.settings?.theme ?? "system");
  const dialogs = useAppStore((s) => s.dialogs);
  const items = useAppStore((s) => s.items);
  const queues = useAppStore((s) => s.queues);
  const setFilter = useAppStore((s) => s.setFilter);
  const openAddDownload = useAppStore((s) => s.openAddDownload);
  const openSettings = useAppStore((s) => s.openSettings);
  const openQueues = useAppStore((s) => s.openQueues);
  const stopAllActive = useAppStore((s) => s.stopAllActive);
  const [destructiveRequest, setDestructiveRequest] = useState<DestructiveActionRequest | null>(null);
  const observedItems = useRef(false);
  const previousItems = useRef(new Map<string, Pick<DownloadItem, "status" | "error" | "fileName" | "url">>());

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      {
        id: "action.add-url",
        label: "Add URL",
        description: "Open the download form for a new URL",
        keywords: ["download", "new", "create"],
        section: "Actions",
        onSelect: () => openAddDownload(),
      },
      {
        id: "action.stop-all",
        label: "Stop All",
        description: "Pause every active or queued download",
        keywords: ["pause", "downloads", "stop"],
        section: "Actions",
        onSelect: stopAllActive,
      },
      {
        id: "destination.queues",
        label: "Queues",
        description: "Open the queue manager",
        keywords: ["queue", "schedule", "concurrency"],
        section: "Destinations",
        onSelect: openQueues,
      },
      {
        id: "destination.settings",
        label: "Settings",
        description: "Open language, appearance, and download settings",
        keywords: ["preferences", "configuration", "language", "theme", "appearance"],
        section: "Settings",
        onSelect: openSettings,
      },
      {
        id: "settings.language",
        label: "Settings · Language mode",
        description: "Open Settings to adjust language mode and funny levels",
        keywords: ["english", "cantonese", "bilingual", "funny"],
        section: "Settings",
        onSelect: openSettings,
      },
      {
        id: "settings.appearance",
        label: "Settings · Appearance",
        description: "Open Settings to adjust theme, density, accent, and fonts",
        keywords: ["theme", "dark", "light", "density", "font", "accent"],
        section: "Settings",
        onSelect: openSettings,
      },
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

    return [...commands, ...categoryCommands, ...queueCommands];
  }, [openAddDownload, openQueues, openSettings, queues, setFilter, stopAllActive]);

  useEffect(() => {
    const unsubscribe = useAppStore.getState().init();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

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
          notify({ title: "Download error", message: `${itemName(item)}: ${item.error}`, tone: "error" });
        }
        return;
      }

      const name = itemName(item);
      if (item.status === "completed") {
        notify({ title: "Download complete", message: `${name} is ready.`, tone: "success" });
      } else if (item.status === "error") {
        notify({ title: "Download error", message: `${name}: ${item.error || "The manager reported an error."}`, tone: "error" });
      } else {
        const status = item.status.charAt(0).toUpperCase() + item.status.slice(1);
        notify({ title: "Download status", message: `${name}: ${status}.`, tone: "info" });
      }
    });
    previousItems.current = current;
  }, [items, ready]);

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
          title: "Removal incomplete",
          message: `${failed.length} of ${request.itemIds.length} item(s) could not be removed.`,
          tone: "error",
        });
        return;
      }
      notify({
        title: "Removal complete",
        message: `${request.itemIds.length} item(s) removed${request.deleteFile ? " and their files deleted" : " from the list"}.`,
        tone: "success",
      });
    });
  }

  return (
    <div className="app">
      <RendererAccessibilityBridge />
      <CommandPalette commands={paletteCommands} />
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-pane">
          <Toolbar />
          <DownloadTable />
          <StatusBar />
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
