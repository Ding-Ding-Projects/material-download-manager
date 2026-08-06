import { app, autoUpdater, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
import path from "node:path";
import { IPC } from "../shared/types";
import type { AddDownloadRequest, AppSettings, DownloadItem, DownloadQueue } from "../shared/types";
import { notifyDownloadComplete as showCompletionNotification, type CompletionNotificationPort } from "./completionNotification";
import { DownloadManager } from "./download/DownloadManager";
import { isDevelopmentLaunch, resolveRendererPath } from "./runtimePaths";
import { readUpdateFeedUrl, UpdateService } from "./updater/UpdateService";

const isDev = isDevelopmentLaunch(app.isPackaged);

// Windows/Linux: only one instance of a download manager should ever run at
// once (a second launch — e.g. from a browser's "open with" — should just
// focus the existing window instead of starting a second download engine).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let manager: DownloadManager;
let updater: UpdateService | null = null;

const appIconPath = path.join(__dirname, "../../build/icon.ico");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: "#16171d",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(resolveRendererPath(__dirname));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function broadcastState() {
  if (!mainWindow) return;
  mainWindow.webContents.send(IPC.STATE_CHANGED, manager.getState());
}

function registerIpcHandlers() {
  ipcMain.handle(IPC.GET_STATE, () => manager.getState());

  ipcMain.handle(IPC.PROBE_URL, (_e, url: string) => manager.probeUrl(url));

  ipcMain.handle(IPC.ADD_DOWNLOAD, (_e, req: AddDownloadRequest) => manager.addDownload(req));

  ipcMain.handle(IPC.PAUSE, (_e, id: string) => manager.pause(id));
  ipcMain.handle(IPC.RESUME, (_e, id: string) => manager.resume(id));
  ipcMain.handle(IPC.CANCEL, (_e, id: string) => manager.cancel(id));
  ipcMain.handle(IPC.REMOVE, (_e, id: string, deleteFile: boolean) => manager.remove(id, deleteFile));
  ipcMain.handle(IPC.RETRY, (_e, id: string) => manager.retry(id));

  ipcMain.handle(IPC.OPEN_FILE, (_e, id: string) => manager.openFile(id));
  ipcMain.handle(IPC.OPEN_FOLDER, (_e, id: string) => manager.openFolder(id));

  ipcMain.handle(IPC.SETTINGS_GET, () => manager.getSettings());
  ipcMain.handle(IPC.SETTINGS_SET, (_e, settings: Partial<AppSettings>) => manager.setSettings(settings));

  ipcMain.handle(IPC.QUEUE_CREATE, (_e, queue: Partial<DownloadQueue>) => manager.createQueue(queue));
  ipcMain.handle(IPC.QUEUE_UPDATE, (_e, queue: DownloadQueue) => manager.updateQueue(queue));
  ipcMain.handle(IPC.QUEUE_DELETE, (_e, id: string) => manager.deleteQueue(id));
  ipcMain.handle(IPC.QUEUE_START, (_e, id: string) => manager.startQueue(id));
  ipcMain.handle(IPC.QUEUE_STOP, (_e, id: string) => manager.stopQueue(id));

  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.on(IPC.WINDOW_MINIMIZE, () => mainWindow?.minimize());
  ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, () => mainWindow?.close());
}

const nativeCompletionNotifications: CompletionNotificationPort = {
  isSupported: () => Notification.isSupported(),
  show: (options) => new Notification(options).show(),
};

function notifyDownloadComplete(item: DownloadItem) {
  showCompletionNotification(item, manager.getSettings(), nativeCompletionNotifications, appIconPath);
}

function startUpdater() {
  if (process.platform !== "win32") return;
  updater = new UpdateService({
    adapter: autoUpdater,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    supportedPlatform: true,
    feedUrl: readUpdateFeedUrl(),
  });
  updater.start();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  manager = new DownloadManager(app.getPath("userData"));
  await manager.init();
  manager.on("stateChanged", broadcastState);
  manager.on("itemCompleted", notifyDownloadComplete);
  app.setLoginItemSettings({ openAtLogin: manager.getSettings().startOnSystemStartup });

  registerIpcHandlers();
  createWindow();
  startUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await manager?.shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  updater?.stop();
  if (manager && !manager.isShutDown) {
    e.preventDefault();
    await manager.shutdown();
    app.quit();
  }
});

// Re-export shell for use by DownloadManager without needing its own import cycle issues.
export { shell };
