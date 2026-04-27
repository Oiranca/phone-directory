import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rendererUrl = "http://127.0.0.1:4173";

export type E2eWorkspace = {
  workspaceRootDir: string;
  userDataPath: string;
  incomingDir: string;
  exportsDir: string;
};

export const createWorkspace = async (name: string): Promise<E2eWorkspace> => {
  const workspaceRootDir = await fs.mkdtemp(path.join(os.tmpdir(), `phone-directory-${name}-`));
  const userDataPath = path.join(workspaceRootDir, "user-data");
  const incomingDir = path.join(workspaceRootDir, "incoming");
  const exportsDir = path.join(workspaceRootDir, "exports");

  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });

  return {
    workspaceRootDir,
    userDataPath,
    incomingDir,
    exportsDir
  };
};

export const removeWorkspace = async (workspace: E2eWorkspace) => {
  await fs.rm(workspace.workspaceRootDir, { recursive: true, force: true });
};

export const launchElectronApp = async (options: {
  userDataPath: string;
  openDialogPaths?: string[];
  saveDialogPaths?: string[];
}) => {
  const electronApp = await electron.launch({
    cwd: repoRootDir,
    args: ["dist-electron/main/index.js"],
    timeout: 60_000,
    env: {
      ...process.env,
      ELECTRON_E2E: "1",
      ELECTRON_OPEN_DEVTOOLS: "0",
      ELECTRON_RENDERER_URL: rendererUrl,
      ELECTRON_USER_DATA_PATH: options.userDataPath,
      E2E_OPEN_DIALOG_PATHS: JSON.stringify(options.openDialogPaths ?? []),
      E2E_SAVE_DIALOG_PATHS: JSON.stringify(options.saveDialogPaths ?? [])
    }
  });
  const page = await electronApp.firstWindow();

  return {
    electronApp,
    page
  };
};

export const closeElectronApp = async (electronApp: ElectronApplication) => {
  await electronApp.close();
};

export const waitForDirectory = async (page: Page) => {
  await expect(page.getByRole("heading", { name: "Directorio" })).toBeVisible();
};

export const readContactsFile = async (userDataPath: string) => {
  const source = await fs.readFile(path.join(userDataPath, "data", "contacts.json"), "utf-8");
  return JSON.parse(source) as {
    records: Array<{ displayName: string; externalId?: string }>;
  };
};

export const listBackupFiles = async (userDataPath: string) => {
  const backupDir = path.join(userDataPath, "backups");
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
};
