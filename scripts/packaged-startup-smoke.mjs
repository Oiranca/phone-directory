import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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
    return findFirstExecutable(path.join(distRootDir, "win-unpacked"), (name) =>
      name.toLowerCase() === "hospiagenda.exe"
    );
  }
  return findFirstExecutable(path.join(distRootDir, "linux-unpacked"), (name) =>
    ["hospiagenda", "phone-directory"].includes(name.toLowerCase())
  );
};

const availablePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => {
      if (!address || typeof address === "string") reject(new Error("Could not allocate a debugging port"));
      else resolve(address.port);
    });
  });
});

const browserSession = `packaged-smoke-${process.pid}`;
const browserCommand = (...args) => {
  const result = spawnSync("agent-browser", ["--session", browserSession, ...args], {
    cwd: repoRootDir,
    encoding: "utf8",
    timeout: 10_000,
    shell: process.platform === "win32",
    env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "3000" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `agent-browser exited ${result.status}`);
  return result.stdout.trim();
};

const waitForDirectory = async (port, child) => {
  const deadline = Date.now() + 60_000;
  let lastError;
  let connected = false;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Packaged app exited before the directory loaded: ${child.exitCode ?? child.signalCode}`);
    }
    try {
      if (!connected) {
        browserCommand("connect", String(port));
        connected = true;
      }
      const pageUrl = browserCommand("get", "url");
      if (pageUrl.startsWith("file://") &&
        browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true") {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Packaged directory did not load from file:// within 60 seconds${lastError ? `: ${lastError.message}` : ""}`);
};

browserCommand("--version");

if (!skipBuild) {
  execFileSync("pnpm", ["run", `build:dist:${targetPlatform}`], {
    cwd: repoRootDir,
    stdio: "inherit"
  });
}

const sourceExecutablePath = await findPackagedExecutable();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-packaged-smoke-"));
const sourcePlatformDir = path.join(distRootDir, path.relative(distRootDir, sourceExecutablePath).split(path.sep)[0]);
const targetPlatformDir = path.join(workspace, path.basename(sourcePlatformDir));
const executablePath = path.join(workspace, path.relative(distRootDir, sourceExecutablePath));
const userDataPath = path.join(workspace, "portable-data");
const directLaunchEnv = { ...process.env };
delete directLaunchEnv.ELECTRON_PORTABLE_ROOT_PATH;
delete directLaunchEnv.APPIMAGE;
let child;

try {
  await fs.cp(sourcePlatformDir, targetPlatformDir, { recursive: true, verbatimSymlinks: true });
  const port = await availablePort();
  child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    cwd: repoRootDir,
    env: { ...directLaunchEnv, ELECTRON_OPEN_DEVTOOLS: "0", ELECTRON_BACKGROUND_SMOKE: "1" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let startupError = "";
  child.stderr.on("data", (chunk) => { startupError = `${startupError}${chunk}`.slice(-4_000); });
  try {
    await waitForDirectory(port, child);
  } catch (error) {
    throw new Error(`${error.message}${startupError ? `\n${startupError}` : ""}`);
  }

  if (!(await pathExists(userDataPath))) {
    throw new Error(`Direct packaged launch did not create portable data at ${userDataPath}`);
  }

  console.log(
    `[packaged-startup-smoke] PASS ${targetPlatform}: direct executable loaded via file:// and created portable-data`
  );
} finally {
  try { browserCommand("close"); } catch { /* Browser may not have connected. */ }
  if (child && child.exitCode === null) {
    const exit = once(child, "exit").then(() => true);
    child.kill();
    const exited = await Promise.race([exit, delay(5_000).then(() => false)]);
    if (!exited) {
      child.kill("SIGKILL");
      await exit;
    }
  }
  await fs.rm(workspace, { recursive: true, force: true });
}
