import { BrowserWindow, app, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { registerContactsIpc } from "./ipc/contacts.ipc.js";
import { registerSettingsIpc } from "./ipc/settings.ipc.js";
import { AppDataService } from "./services/app-data.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_SERVER_URL = env.rendererUrl ?? "http://localhost:5173";

if (env.userDataPath) {
  app.setPath("userData", path.resolve(env.userDataPath));
}

const isAllowedNavigationUrl = (targetUrl: string) => {
  if (isDev) {
    return targetUrl.startsWith(`${DEV_SERVER_URL}/`) || targetUrl === DEV_SERVER_URL;
  }

  return targetUrl.startsWith("file://");
};

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:5173; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173;";
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';";

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
    if (env.openDevTools) {
      window.webContents.openDevTools({ mode: "detach" });
    }
    return;
  }

  void window.loadFile(path.join(__dirname, "../../dist/index.html"));
};

const bootstrap = async () => {
  const service = new AppDataService();
  await service.ensureInitialFiles();
  registerContactsIpc(service);
  registerSettingsIpc(service);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [isDev ? DEV_CSP : PROD_CSP],
      },
    });
  });
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
