import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRootDir = path.join(repoRootDir, "dist-portable");

const args = new Set(process.argv.slice(2));
const getArgValue = (name) => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const currentPlatform = () => {
  if (process.platform === "win32") {
    return "win";
  }
  if (process.platform === "darwin") {
    return "mac";
  }
  if (process.platform === "linux") {
    return "linux";
  }
  throw new Error(`Unsupported host platform: ${process.platform}`);
};

const targetPlatform = getArgValue("--platform") ?? currentPlatform();
const skipBuild = args.has("--skip-build");

if (!["win", "mac", "linux"].includes(targetPlatform)) {
  throw new Error(`Unsupported target platform: ${targetPlatform}`);
}

if (targetPlatform !== currentPlatform()) {
  throw new Error(
    `Packaged startup smoke can only launch the current host platform. ` +
      `Host is ${currentPlatform()}, target is ${targetPlatform}.`
  );
}

const pathExists = async (candidate) => {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
};

const findFirstExecutable = async (dir, predicate) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const candidate = path.join(dir, entry.name);
    if (predicate(entry.name)) {
      return candidate;
    }
  }
  throw new Error(`No packaged executable found in ${dir}`);
};

const findMacExecutable = async () => {
  const preferredDir = process.arch === "arm64" ? "mac-arm64" : "mac";
  const appNames = ["HospiAgenda.app", "Phone Directory.app"];
  const buildDirs = [preferredDir, "mac", "mac-arm64"];

  for (const buildDir of buildDirs) {
    for (const appName of appNames) {
      const executableName = path.basename(appName, ".app");
      const candidate = path.join(
        distRootDir,
        buildDir,
        appName,
        "Contents",
        "MacOS",
        executableName
      );
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  for (const buildDir of buildDirs) {
    const platformDir = path.join(distRootDir, buildDir);
    if (!(await pathExists(platformDir))) {
      continue;
    }
    const appEntries = await fs.readdir(platformDir, { withFileTypes: true });
    for (const appEntry of appEntries) {
      if (!appEntry.isDirectory() || !appEntry.name.endsWith(".app")) {
        continue;
      }
      const macOsDir = path.join(platformDir, appEntry.name, "Contents", "MacOS");
      if (await pathExists(macOsDir)) {
        return findFirstExecutable(macOsDir, () => true);
      }
    }
  }

  throw new Error("No packaged macOS executable found under dist-portable/mac*");
};

const findPackagedExecutable = async () => {
  if (targetPlatform === "mac") {
    return findMacExecutable();
  }
  if (targetPlatform === "win") {
    const portableExecutable = path.join(distRootDir, "HospiAgenda.exe");
    if (!(await pathExists(portableExecutable))) {
      throw new Error("No packaged Windows portable executable found at dist-portable/HospiAgenda.exe");
    }
    return portableExecutable;
  }
  return findFirstExecutable(path.join(distRootDir, "linux-unpacked"), (name) =>
    ["hospiagenda", "phone-directory"].includes(name.toLowerCase())
  );
};

if (!skipBuild) {
  execFileSync("pnpm", ["run", `build:dist:${targetPlatform}`], {
    cwd: repoRootDir,
    stdio: "inherit"
  });
}

const executablePath = await findPackagedExecutable();
const userDataPath = path.join(distRootDir, "portable-data");
const directLaunchEnv = { ...process.env };
delete directLaunchEnv.ELECTRON_PORTABLE_ROOT_PATH;
delete directLaunchEnv.PORTABLE_EXECUTABLE_DIR;
delete directLaunchEnv.APPIMAGE;
let electronApp;

try {
  await fs.rm(userDataPath, { recursive: true, force: true });

  electronApp = await electron.launch({
    executablePath,
    cwd: repoRootDir,
    timeout: 60_000,
    env: {
      ...directLaunchEnv,
      ELECTRON_OPEN_DEVTOOLS: "0"
    }
  });

  const page = await electronApp.firstWindow();
  await page.getByPlaceholder("Buscar contacto o servicio").waitFor({
    state: "visible",
    timeout: 60_000
  });

  const pageUrl = page.url();
  if (!pageUrl.startsWith("file://")) {
    throw new Error(`Expected packaged app to load file:// renderer, got ${pageUrl}`);
  }

  if (!(await pathExists(userDataPath))) {
    throw new Error(`Direct packaged launch did not create portable data at ${userDataPath}`);
  }

  console.log(
    `[packaged-startup-smoke] PASS ${targetPlatform}: direct executable loaded via file:// and created portable-data`
  );
} finally {
  if (electronApp) {
    await electronApp.close();
  }
  await fs.rm(userDataPath, { recursive: true, force: true });
}
