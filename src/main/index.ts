import { BrowserWindow, app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerContactsIpc } from "./ipc/contacts.ipc.js";
import { registerSettingsIpc } from "./ipc/settings.ipc.js";
import { AppDataService } from "./services/app-data.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_SERVER_URL = "http://localhost:5173";

const isAllowedNavigationUrl = (targetUrl: string) => {
  if (isDev) {
    return targetUrl.startsWith(`${DEV_SERVER_URL}/`) || targetUrl === DEV_SERVER_URL;
  }

  return targetUrl.startsWith("file://");
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigationUrl(targetUrl)) {
      event.preventDefault();
    }
  });

  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  void window.loadFile(path.join(__dirname, "../../dist/index.html"));
};

const bootstrap = async () => {
  const service = new AppDataService();
  await service.ensureInitialFiles();
  registerContactsIpc(service);
  registerSettingsIpc(service);
  createWindow();
};

app.whenReady().then(() => {
  void bootstrap();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
