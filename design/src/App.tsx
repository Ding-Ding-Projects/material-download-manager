import { useEffect } from "react";
import { useAppStore } from "./store/useAppStore";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import DownloadTable from "./components/DownloadTable";
import StatusBar from "./components/StatusBar";
import AddDownloadDialog from "./components/AddDownloadDialog";
import DownloadDetailsDialog from "./components/DownloadDetailsDialog";
import SettingsDialog from "./components/SettingsDialog";
import QueuesDialog from "./components/QueuesDialog";

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const theme = useAppStore((s) => s.settings?.theme ?? "system");
  const dialogs = useAppStore((s) => s.dialogs);

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

  return (
    <div className="app">
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
    </div>
  );
}
