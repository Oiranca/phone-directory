import { BrowserWindow, app, nativeImage, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { registerBuscasIpc } from "./ipc/buscas.ipc.js";
import { registerContactsIpc } from "./ipc/contacts.ipc.js";
import { registerSettingsIpc } from "./ipc/settings.ipc.js";
import { PUSH_CHANNELS } from "../shared/ipc/channels.js";
import { AppDataService } from "./services/app-data.service.js";
import { BuscasService } from "./services/buscas.service.js";
import { assertPathChainIsNotSymlink } from "./utils/path-safety.js";
import { resolvePortableUserDataPath } from "./utils/portable-paths.js";
import {
  buildContentSecurityPolicy,
  denyWindowOpen,
  isAllowedNavigationUrl,
  WINDOW_WEB_PREFERENCES
} from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_SERVER_URL = env.rendererUrl ?? "http://localhost:5173";
// Only available in the source tree (build-resources/ is not bundled into the
// packaged app); packaged builds get their icon from electron-builder's
// win/mac/linux "icon" config instead, so this is a dev-only convenience.
const APP_ICON_PATH = path.join(__dirname, "../../build-resources/icon.png");

const portableUserDataPath = resolvePortableUserDataPath({
  execPath: process.execPath,
  appImagePath: process.env.APPIMAGE,
  isPackaged: app.isPackaged,
  portableMode: env.portableMode,
  portableRootPath: env.portableRootPath
});

if (portableUserDataPath) {
  app.setPath("userData", portableUserDataPath);
} else if (env.userDataPath) {
  app.setPath("userData", path.resolve(env.userDataPath));
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f8fafc",
    ...(isDev ? { icon: APP_ICON_PATH } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      ...WINDOW_WEB_PREFERENCES
    }
  });

  window.webContents.setWindowOpenHandler(denyWindowOpen);
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigationUrl(targetUrl, { isDev, devServerUrl: DEV_SERVER_URL })) {
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
  if (portableUserDataPath) {
    await assertPathChainIsNotSymlink(
      portableUserDataPath,
      "No se pudo preparar la ruta portable de datos.",
      true
    );
  }

  const buscasService = new BuscasService();
  const service = new AppDataService({
    onAutoBackupFailure: (message) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(PUSH_CHANNELS.autoBackupFailed, { message });
      }
    },
    buscasService
  });
  await service.ensureInitialFiles();
  registerContactsIpc(service);
  registerBuscasIpc(buscasService);
  registerSettingsIpc(service);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const filteredHeaders = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([key]) => key.toLowerCase() !== "content-security-policy"
      )
    );
    callback({
      responseHeaders: {
        ...filteredHeaders,
        "Content-Security-Policy": [
          buildContentSecurityPolicy({ isDev, devServerUrl: DEV_SERVER_URL })
        ],
      },
    });
  });
  createWindow();
  void service.startAutoBackup().catch((error) => {
    console.error("[auto-backup] Failed to start auto-backup scheduler.", error);
  });
};

app.whenReady().then(() => {
  // BrowserWindow's `icon` option does not affect the macOS Dock icon, and
  // `pnpm run dev` runs the stock Electron binary rather than a packaged
  // .app with an embedded icon, so the Dock falls back to the Electron
  // logo. Set it explicitly here for a better dev-mode experience; the
  // packaged build already gets the correct icon from electron-builder's
  // "build.mac.icon" config, so this must stay dev-only.
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
  }

  void bootstrap().catch((error) => {
    console.error(error);
    app.quit();
  });

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
