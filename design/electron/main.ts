import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import { IPC } from "../shared/types";
import type { AddDownloadRequest, AppSettings, DownloadQueue } from "../shared/types";
import { DownloadManager } from "./download/DownloadManager";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let manager: DownloadManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 720,
    minWidth: 860,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: "#16171d",
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
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
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

app.whenReady().then(async () => {
  manager = new DownloadManager(app.getPath("userData"));
  await manager.init();
  manager.on("stateChanged", broadcastState);

  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await manager?.shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (e) => {
  if (manager && !manager.isShutDown) {
    e.preventDefault();
    await manager.shutdown();
    app.quit();
  }
});

// Re-export shell for use by DownloadManager without needing its own import cycle issues.
export { shell };
