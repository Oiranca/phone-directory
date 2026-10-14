import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
const browserSession = `directory-e2e-${process.pid}`;
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

const availablePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => {
      if (!address || typeof address === "string") reject(new Error("Could not allocate a test port"));
      else resolve(address.port);
    });
  });
});

const waitFor = async (label, check) => {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
};

const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit").then(() => true);
  child.kill();
  const exited = await Promise.race([exit, delay(5_000).then(() => false)]);
  if (!exited) child.kill("SIGKILL");
};

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-agent-browser-"));
const csvPath = path.join(workspace, "directory.csv");
const contactsPath = path.join(workspace, "user-data", "data", "contacts.json");
let vite;
let electron;
let connected = false;

try {
  browserCommand("--version");
  execFileSync("pnpm", ["run", "build:electron"], { cwd: repoRootDir, stdio: "inherit" });
  await fs.writeFile(csvPath, [
    "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
    "agent-browser-1,service,Mostrador E2E,Recepción,gestion-administracion,12302,internal,active"
  ].join("\n") + "\n");

  const vitePort = await availablePort();
  vite = spawn(process.execPath, [path.join(repoRootDir, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: repoRootDir,
    stdio: "ignore"
  });
  await waitFor("Vite", async () => {
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${vite.exitCode}`);
    return (await fetch(`http://127.0.0.1:${vitePort}`, { signal: AbortSignal.timeout(2_000) })).ok;
  });

  const debugPort = await availablePort();
  electron = spawn(electronBinary, [`--remote-debugging-port=${debugPort}`, "dist-electron/main/index.js"], {
    cwd: repoRootDir,
    env: {
      ...process.env,
      ELECTRON_E2E: "1",
      ELECTRON_OPEN_DEVTOOLS: "0",
      ELECTRON_RENDERER_URL: `http://127.0.0.1:${vitePort}`,
      ELECTRON_USER_DATA_PATH: path.join(workspace, "user-data"),
      E2E_OPEN_DIALOG_PATHS: JSON.stringify([csvPath])
    },
    stdio: "ignore"
  });
  await waitFor("directory", () => {
    if (electron.exitCode !== null) throw new Error(`Electron exited: ${electron.exitCode}`);
    if (!connected) {
      browserCommand("connect", String(debugPort));
      connected = true;
    }
    return browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true";
  });

  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    browserCommand("set", "viewport", String(width), String(height));
    await waitFor(`${width}px layout`, () => {
      const metrics = JSON.parse(browserCommand("eval", "({width: innerWidth, scrollWidth: document.documentElement.scrollWidth})"));
      return metrics.width === width && metrics.scrollWidth <= width + 1;
    });
  }
  console.log("[agent-browser-e2e] Layouts: 390, 768, 1440 px passed");

  browserCommand("find", "role", "link", "click", "--name", "Configuración");
  await waitFor("settings", () => browserCommand("eval", 'document.body.innerText.includes("Datos e importación")') === "true");
  browserCommand("find", "role", "button", "click", "--name", "Importar");
  await waitFor("file picker confirmation", () => browserCommand("eval", 'Boolean(document.querySelector("dialog[open]"))') === "true");
  browserCommand("find", "role", "button", "click", "--name", "Elegir archivo");
  await waitFor("CSV preview", () => browserCommand("is", "visible", '[aria-label="Vista previa de importación"]') === "true");
  console.log("[agent-browser-e2e] CSV preview visible");
  browserCommand("find", "role", "button", "click", "--name", "Confirmar importación");
  await waitFor("import confirmation", () => browserCommand("eval", 'Boolean(document.querySelector("dialog[open]"))') === "true");
  browserCommand("click", "dialog[open] button:last-child");
  await waitFor("CSV import", async () => {
    const contacts = JSON.parse(await fs.readFile(contactsPath, "utf8"));
    return contacts.records.some((record) => record.displayName === "Mostrador E2E");
  });
  console.log("[agent-browser-e2e] CSV import persisted");

  browserCommand("find", "role", "link", "click", "--name", "Directorio");
  await waitFor("directory after import", () => browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true");
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Mostrador E2E");
  await waitFor("imported contact", () => browserCommand("eval", 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Mostrador E2E"))') === "true");
  console.log("[agent-browser-e2e] PASS: directory layout and CSV import");
} finally {
  if (connected) {
    try { browserCommand("close"); } catch { /* Electron may have exited. */ }
  }
  await stop(electron);
  await stop(vite);
  await fs.rm(workspace, { recursive: true, force: true });
}
