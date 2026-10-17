import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = createRequire(import.meta.url)("electron");
let browserSession = `directory-e2e-${process.pid}`;
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
const invalidCsvPath = path.join(workspace, "invalid.csv");
const mixedCsvPath = path.join(workspace, "mixed.csv");
const warningCsvPath = path.join(workspace, "warning.csv");
const cancelCsvPath = path.join(workspace, "cancel.csv");
const overwriteCsvPath = path.join(workspace, "overwrite.csv");
const skipCsvPath = path.join(workspace, "skip.csv");
const mergeCsvPath = path.join(workspace, "merge.csv");
const bulkCsvPath = path.join(workspace, "bulk.csv");
const bulkPerformanceCsvPath = path.join(workspace, "5000-conflicts.csv");
const odsPath = path.join(workspace, "agenda-large.ods");
const crossDocumentCsvPath = path.join(workspace, "cross-document.csv");
const contactsPath = path.join(workspace, "user-data", "data", "contacts.json");
const visualArtifactDirectory = path.join(repoRootDir, "test-results", "agent-browser");
let vite;
let electron;
let connected = false;
let vitePort;

const hasText = (value) => browserCommand("eval", `document.body.innerText.includes(${JSON.stringify(value)})`) === "true";
const clickRole = (role, name) => browserCommand("find", "role", role, "click", "--name", name);
const importReady = () => browserCommand("eval", `(() => {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Importar');
  return Boolean(button && !button.disabled && !document.querySelector('dialog[open]') &&
    !document.querySelector('[aria-label="Vista previa de importación"]'));
})()`) === "true";
const openPreview = async () => {
  await waitFor("import action ready", importReady);
  clickRole("button", "Importar");
  await waitFor("CSV preview", () => browserCommand("is", "visible", '[aria-label="Vista previa de importación"]') === "true");
};
const previewState = () => JSON.parse(browserCommand("eval", `(() => {
  const panel = document.querySelector('[aria-label="Vista previa de importación"]');
  const confirm = [...panel.querySelectorAll('button')].find(button => button.textContent.includes('Confirmar importación'));
  return { text: panel.innerText, alert: Boolean(panel.querySelector('[role="alert"]')), enabled: !confirm.disabled };
})()`));
const readRecords = async () => (JSON.parse(await fs.readFile(contactsPath, "utf8"))).records;
const confirmPreview = async () => {
  clickRole("button", "Confirmar importación");
  await waitFor("import confirmation", () => browserCommand("eval", 'Boolean(document.querySelector("dialog[open]"))') === "true");
  browserCommand("click", "dialog[open] button:last-child");
  await waitFor("import action restored", importReady);
};
const closeElectron = async () => {
  if (connected) {
    try { browserCommand("close"); } catch { /* Electron may have exited. */ }
    connected = false;
  }
  await stop(electron);
  electron = undefined;
};
const closeAdvancedPaths = () => {
  const closed = browserCommand("eval", `(() => {
    const details = [...document.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent.trim() === "Avanzado");
    if (!details) return false;
    details.open = false;
    return !details.open;
  })()`);
  if (closed !== "true") throw new Error("Advanced path disclosure did not close before screenshot");
};
const launchElectron = async (openDialogPaths, userDataPath = path.join(workspace, "user-data")) => {
  browserSession = `directory-e2e-${process.pid}-${Date.now()}`;
  const debugPort = await availablePort();
  electron = spawn(electronBinary, [`--remote-debugging-port=${debugPort}`, "dist-electron/main/index.js"], {
    cwd: repoRootDir,
    env: {
      ...process.env,
      ELECTRON_E2E: "1",
      ELECTRON_OPEN_DEVTOOLS: "0",
      ELECTRON_RENDERER_URL: `http://127.0.0.1:${vitePort}`,
      ELECTRON_USER_DATA_PATH: userDataPath,
      E2E_OPEN_DIALOG_PATHS: JSON.stringify(openDialogPaths)
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
};
const failures = [];
const runScenario = async (name, check) => {
  try {
    await check();
  } catch (error) {
    failures.push(error);
    console.error(`[agent-browser-e2e] FAIL ${name}:`, error);
  } finally {
    await closeElectron();
  }
};

try {
  await fs.mkdir(visualArtifactDirectory, { recursive: true });
  browserCommand("--version");
  execFileSync("pnpm", ["run", "build"], { cwd: repoRootDir, stdio: "inherit" });
  const html = await fs.readFile(path.join(repoRootDir, "dist", "index.html"), "utf8");
  const assetRefs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1]).filter((ref) => ref && !ref.startsWith("data:") && !ref.startsWith("#"));
  if (assetRefs.length === 0 || assetRefs.some((ref) => ref.startsWith("/"))) {
    throw new Error("Built renderer has missing or absolute asset paths");
  }
  const compiledMain = await fs.readFile(path.join(repoRootDir, "dist-electron", "main", "index.js"), "utf8");
  if (!compiledMain.includes("loadFile") || !compiledMain.includes("dist/index.html") ||
    /loadURL\s*\(\s*["'`]http:\/\/localhost/.test(compiledMain)) {
    throw new Error("Packaged loadFile wiring is missing");
  }
  console.log("[agent-browser-e2e] Build artifacts and file URL wiring passed");
  await fs.writeFile(csvPath, [
    "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
    "agent-browser-1,service,Mostrador E2E,Recepción,gestion-administracion,12302,internal,active",
    "agent-browser-2,service,Admisión E2E,Recepción,gestion-administracion,12303,internal,active"
  ].join("\n") + "\n");
  await fs.writeFile(invalidCsvPath, [
    "externalId,type,displayName,phone1Number,phone1Kind,status",
    "invalid-1,,Fila sin tipo,12345,internal,active",
    "invalid-2,service,,67890,internal,active"
  ].join("\n") + "\n");
  await fs.writeFile(mixedCsvPath, [
    "externalId,type,displayName,phone1Number,phone1Kind,status",
    "mixed-1,service,Registro Válido,12345,internal,active",
    "mixed-2,,Fila sin tipo,67890,internal,active"
  ].join("\n") + "\n");
  await fs.writeFile(warningCsvPath, [
    "externalId,type,displayName,area,phone1Number,phone1Kind,status",
    "warning-1,service,Urgencias Demo,area-invalida,99999,internal,active"
  ].join("\n") + "\n");
  await fs.writeFile(cancelCsvPath, [
    "externalId,type,displayName,phone1Number,phone1Kind,status",
    "cancel-1,service,Servicio Cerrar,12345,internal,active"
  ].join("\n") + "\n");
  for (const [filePath, name, phone] of [
    [overwriteCsvPath, "Admisión Sobrescrita", "19910"],
    [skipCsvPath, "Admisión Omitida", "19911"],
    [mergeCsvPath, "Admisión Combinada", "19912"]
  ]) {
    await fs.writeFile(filePath, [
      "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
      `example-1,service,${name},Admisión,gestion-administracion,${phone},internal,active`
    ].join("\n") + "\n");
  }
  await fs.writeFile(bulkCsvPath, [
    "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
    "example-1,service,Admisión Bulk,Admisión,gestion-administracion,19920,internal,active",
    "example-2,external-center,Demo Bulk,Centros de salud,otros,19921,internal,active"
  ].join("\n") + "\n");
  await fs.writeFile(bulkPerformanceCsvPath, [
    "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
    ...Array.from({ length: 5_000 }, (_, index) =>
      `example-1,service,Admisión Bulk ${index},Admisión,gestion-administracion,${20_000 + index},internal,active`)
  ].join("\n") + "\n");
  XLSX.set_fs(nodeFs);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Servicio", "Número", "Notas"],
    ...Array.from({ length: 40 }, (_, index) => [`Servicio Agenda ${index}`, `${20_000 + index}`, ""])
  ]), "Agenda");
  XLSX.writeFile(workbook, odsPath);
  await fs.writeFile(crossDocumentCsvPath, [
    "externalId,type,displayName,phone1Number,phone1Kind,status",
    "cross-doc-1,service,Servicio Cross Doc,12345,internal,active"
  ].join("\n") + "\n");

  vitePort = await availablePort();
  vite = spawn(process.execPath, [path.join(repoRootDir, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: repoRootDir,
    stdio: "ignore"
  });
  await waitFor("Vite", async () => {
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${vite.exitCode}`);
    return (await fetch(`http://127.0.0.1:${vitePort}`, { signal: AbortSignal.timeout(2_000) })).ok;
  });

  await runScenario("directory and import workflows", async () => {
  await launchElectron([csvPath, invalidCsvPath, mixedCsvPath, warningCsvPath, cancelCsvPath,
    overwriteCsvPath, skipCsvPath, mergeCsvPath, bulkCsvPath]);
  if (!browserCommand("get", "url").startsWith(`http://127.0.0.1:${vitePort}/`)) {
    throw new Error("ELECTRON_RENDERER_URL did not load the configured dev server");
  }

  browserCommand("eval", "window.resizeTo(390, 844)");
  await waitFor("390px native window", () => {
    const size = JSON.parse(browserCommand("eval", `(() => ({
      outerWidth, innerWidth,
      navPosition: getComputedStyle(document.querySelector('nav[aria-label="Navegación principal"]').parentElement).position
    }))()`));
    return size.outerWidth <= 390 && size.innerWidth < 640 && size.navPosition === "fixed";
  });
  browserCommand("eval", "window.resizeTo(1440, 920)");
  console.log("[agent-browser-e2e] Native 390px window and bottom navigation passed");

  for (const [width, height] of [[390, 844], [768, 1024], [1080, 720], [1100, 750], [1200, 800], [1440, 768], [1440, 900], [1920, 1080]]) {
    browserCommand("set", "viewport", String(width), String(height));
    await waitFor(`${width}px layout`, () => {
      const metrics = JSON.parse(browserCommand("eval", "({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight})"));
      return metrics.width === width && metrics.scrollWidth <= width + 1 &&
        (width < 1080 || metrics.scrollHeight <= height + 1);
    });
  }
  console.log("[agent-browser-e2e] Directory layout: 8 viewports passed");

  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Centro de Salud Demo");
  await waitFor("seeded search result", () => hasText("Centro de Salud Demo"));
  clickRole("button", "Centro de Salud Demo - Información");
  await waitFor("record detail", () => hasText("DETALLE DEL REGISTRO") &&
    browserCommand("eval", 'Boolean(document.querySelector("a[aria-label^=\\"Editar\\"]"))') === "true");
  console.log("[agent-browser-e2e] Search opens record detail");

  clickRole("link", "Configuración");
  await waitFor("settings", () => hasText("Datos e importación"));
  const retentionInput = "#settings-autobackup-retention";
  if (browserCommand("eval", `(() => {
    const input = document.querySelector(${JSON.stringify(retentionInput)});
    const automatic = document.querySelector("#settings-autobackup-enabled");
    return Boolean(input && !input.disabled && automatic && !automatic.checked);
  })()`) !== "true") throw new Error("Retention must be editable while automatic backup is disabled");
  browserCommand("fill", retentionInput, "7");
  clickRole("button", "Guardar configuración");
  await waitFor("retention saved", () => hasText("Configuración guardada."));
  const savedRetention = JSON.parse(browserCommand("eval", "(async () => (await window.hospitalDirectory.getBootstrapData()).settings.ui.autoBackup.retentionCount)()"));
  if (savedRetention !== 7) throw new Error(`Retention was not persisted: ${savedRetention}`);
  console.log("[agent-browser-e2e] Disabled-auto retention saves and persists");
  browserCommand("eval", `([...document.querySelectorAll("summary")].find(item => item.textContent.trim() === "Avanzado"))?.click()`);
  await waitFor("advanced path controls", () => browserCommand("eval", `(() => {
    const details = [...document.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent.trim() === "Avanzado");
    if (!details?.open || !details.querySelector("#settings-data-file-path") || !details.querySelector("#settings-backup-directory-path")) return false;
    const labels = ["Seleccionar archivo de datos", "Seleccionar carpeta de copias de seguridad"];
    return labels.every(label => [...details.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === label));
  })()`) === "true");
  const advancedRecovery = `(() => {
    const buttons = ["Crear copia de seguridad", "Exportar archivo portable", "Importar"];
    const summary = [...document.querySelectorAll("summary")].find(item => item.textContent.trim() === "Recuperación avanzada");
    return Boolean(buttons.every(label => [...document.querySelectorAll("button")].some(item => item.textContent.trim() === label)) && summary && !summary.parentElement.open && (summary.focus(), document.activeElement === summary));
  })()`;
  if (browserCommand("eval", advancedRecovery) !== "true") throw new Error("Routine data controls or closed advanced recovery disclosure missing");
  browserCommand("press", "Enter");
  await waitFor("advanced recovery disclosure", () => browserCommand("eval", `(() => {
    const details = [...document.querySelectorAll("details")].find(item => item.querySelector("summary")?.textContent.trim() === "Recuperación avanzada");
    return Boolean(details?.open && [...details.querySelectorAll("button")].some(item => item.textContent.trim() === "Restablecer registro de auditoría"));
  })()`) === "true");
  browserCommand("set", "viewport", "320", "844");
  browserCommand("eval", "document.documentElement.style.fontSize = '200%'");
  const settingsReflowMetrics = () => JSON.parse(browserCommand("eval", `(() => {
    const advancedPathsOpen = [...document.querySelectorAll("details")].some(item => item.open && item.querySelector("summary")?.textContent.trim() === "Avanzado");
    return { innerWidth, scrollWidth: document.documentElement.scrollWidth, rootFontSize: getComputedStyle(document.documentElement).fontSize, advancedPathsOpen };
  })()`));
  try {
    await waitFor("320px settings reflow", () => {
      const metrics = settingsReflowMetrics();
      return metrics.innerWidth === 320 && metrics.advancedPathsOpen && metrics.scrollWidth <= metrics.innerWidth + 1;
    });
  } catch (error) {
    const failureMetrics = settingsReflowMetrics();
    closeAdvancedPaths();
    browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-320-200-failure.png"));
    throw new Error(`Settings reflow failed: ${JSON.stringify(failureMetrics)}`, { cause: error });
  }
  closeAdvancedPaths();
  browserCommand("eval", `([...document.querySelectorAll("summary")].find(item => item.textContent.trim() === "Recuperación avanzada"))?.scrollIntoView()`);
  browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-320-200.png"));
  await waitFor("initial settings toast dismissal", () => !hasText("Configuración guardada."));
  browserCommand("fill", retentionInput, "8");
  clickRole("button", "Guardar configuración");
  await waitFor("retention resaved", () => hasText("Configuración guardada."));
  const toastOverlap = JSON.parse(browserCommand("eval", `(() => {
    const target = document.querySelector(${JSON.stringify(retentionInput)});
    const toast = document.querySelector('[aria-label="Notificaciones"] [role="status"]');
    if (!target || !toast) return { overlaps: false, targetAtCenter: false };
    target.scrollIntoView({ block: "start" });
    const targetBeforeScroll = target.getBoundingClientRect();
    window.scrollBy(0, targetBeforeScroll.top + targetBeforeScroll.height / 2 - 160);
    const targetRect = target.getBoundingClientRect();
    const toastRect = toast.getBoundingClientRect();
    const dismissRect = toast.querySelector('button[aria-label="Cerrar notificación"]')?.getBoundingClientRect();
    const centerX = targetRect.left + targetRect.width / 2;
    const centerY = targetRect.top + targetRect.height / 2;
    const elementAtCenter = document.elementFromPoint(centerX, centerY);
    return {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overlaps: centerX >= toastRect.left && centerX <= toastRect.right && centerY >= toastRect.top && centerY <= toastRect.bottom,
      outsideDismissButton: !dismissRect || centerX < dismissRect.left || centerX > dismissRect.right || centerY < dismissRect.top || centerY > dismissRect.bottom,
      targetAtCenter: elementAtCenter === target,
      targetCenter: { x: centerX, y: centerY },
      toast: { left: toastRect.left, top: toastRect.top, right: toastRect.right, bottom: toastRect.bottom }
    };
  })()`));
  if (toastOverlap.innerWidth !== 320 || toastOverlap.scrollWidth > toastOverlap.innerWidth + 1 || !toastOverlap.overlaps || !toastOverlap.outsideDismissButton || !toastOverlap.targetAtCenter) throw new Error(`Toast did not allow pointer hit testing: ${JSON.stringify(toastOverlap)}`);
  browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-320-200-toast-before-focus.png"));
  if (!hasText("Configuración guardada.")) throw new Error("Toast was not present before the retention input click");
  browserCommand("click", retentionInput);
  if (browserCommand("eval", `document.activeElement?.id === ${JSON.stringify(retentionInput.slice(1))}`) !== "true") throw new Error("Toast blocked the retention input click");
  if (hasText("Configuración guardada.")) throw new Error("Toast was not dismissed by the retention input focus");
  const focusClear = JSON.parse(browserCommand("eval", `(() => {
    const target = document.querySelector(${JSON.stringify(retentionInput)});
    if (!target) return false;
    const targetRect = target.getBoundingClientRect();
    return [...document.querySelectorAll('[aria-label="Notificaciones"] [role]')].every(toast => {
      const toastRect = toast.getBoundingClientRect();
      return targetRect.left >= toastRect.right || targetRect.right <= toastRect.left || targetRect.top >= toastRect.bottom || targetRect.bottom <= toastRect.top;
    });
  })()`));
  if (!focusClear) throw new Error("Focused retention input remained obscured by a toast");
  browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-320-200-toast-after-focus.png"));
  browserCommand("eval", `([...document.querySelectorAll("summary")].find(item => item.textContent.trim() === "Avanzado"))?.click()`);
  const originalDataPath = JSON.parse(browserCommand("eval", `(() => {
    const input = document.querySelector("#settings-data-file-path");
    return input?.value ?? "";
  })()`));
  if (!originalDataPath) throw new Error("Could not retain the original data path for restoration");
  browserCommand("fill", "#settings-data-file-path", "relative/contacts.json");
  clickRole("button", "Guardar configuración");
  await waitFor("relative data path error", () => hasText("La ruta del archivo de datos debe ser absoluta."));
  closeAdvancedPaths();
  browserCommand("eval", `(() => {
    const input = document.querySelector(${JSON.stringify(retentionInput)});
    if (!input) return false;
    input.scrollIntoView({ block: "start" });
    const rect = input.getBoundingClientRect();
    window.scrollBy(0, rect.top + rect.height / 2 - 160);
    return true;
  })()`);
  const persistentToastOverlap = JSON.parse(browserCommand("eval", `(() => {
    const input = document.querySelector(${JSON.stringify(retentionInput)});
    const toast = document.querySelector('[aria-label="Notificaciones"] [role="alert"]');
    if (!input || !toast) return false;
    const inputRect = input.getBoundingClientRect();
    const toastRect = toast.getBoundingClientRect();
    const centerX = inputRect.left + inputRect.width / 2;
    const centerY = inputRect.top + inputRect.height / 2;
    return {
      overlaps: !(inputRect.left >= toastRect.right || inputRect.right <= toastRect.left || inputRect.top >= toastRect.bottom || inputRect.bottom <= toastRect.top),
      inputAtCenter: document.elementFromPoint(centerX, centerY) === input
    };
  })()`));
  if (!persistentToastOverlap.overlaps || !persistentToastOverlap.inputAtCenter) throw new Error("Persistent path error did not cover the retention input before focus");
  browserCommand("click", retentionInput);
  if (browserCommand("eval", `document.activeElement?.id === ${JSON.stringify(retentionInput.slice(1))}`) !== "true") throw new Error("Persistent path error blocked the retention input click");
  const persistentToastClear = JSON.parse(browserCommand("eval", `(() => {
    const input = document.querySelector(${JSON.stringify(retentionInput)});
    const toast = document.querySelector('[aria-label="Notificaciones"] [role="alert"]');
    if (!input || !toast) return false;
    const inputRect = input.getBoundingClientRect();
    const toastRect = toast.getBoundingClientRect();
    return inputRect.left >= toastRect.right || inputRect.right <= toastRect.left || inputRect.top >= toastRect.bottom || inputRect.bottom <= toastRect.top;
  })()`));
  if (!persistentToastClear) throw new Error("Persistent path error remained over the focused retention input");
  browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-320-200-persistent-toast.png"));
  const persistentToastScrollable = JSON.parse(browserCommand("eval", `(() => {
    const region = document.querySelector('[aria-label="Notificaciones"]');
    const message = region?.querySelector('[role="alert"] p:not(.sr-only)');
    if (!region || !message) return false;
    message.textContent = "Error persistente de prueba. ".repeat(200);
    const rect = region.getBoundingClientRect();
    const before = region.scrollTop;
    region.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + Math.min(32, rect.height / 2), deltaY: 120 }));
    const closeRect = region.querySelector('button[aria-label="Cerrar notificación"]')?.getBoundingClientRect();
    return region.scrollHeight > region.clientHeight && region.scrollTop > before && Boolean(closeRect && closeRect.left >= rect.left && closeRect.right <= rect.right && closeRect.top >= rect.top && closeRect.bottom <= rect.bottom && closeRect.top >= 0 && closeRect.bottom <= innerHeight);
  })()`));
  if (!persistentToastScrollable) throw new Error("Persistent toast did not scroll while keeping its close control");
  const toastRect = JSON.parse(browserCommand("eval", `(() => {
    const rect = document.querySelector('[aria-label="Notificaciones"]').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(200, rect.height - 16) };
  })()`));
  const beforeTouch = Number(browserCommand("eval", `document.querySelector('[aria-label="Notificaciones"]').scrollTop`));
  const streamStatus = JSON.parse(browserCommand("--json", "stream", "status"));
  if (!streamStatus.success || !streamStatus.data?.port) throw new Error("agent-browser touch stream is unavailable");
  const touchSocket = new WebSocket(`ws://127.0.0.1:${streamStatus.data.port}`);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("agent-browser touch stream did not connect")), 3000);
      touchSocket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      touchSocket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("agent-browser touch stream failed")); }, { once: true });
    });
    const touchPoint = (y) => [{ x: toastRect.x, y }];
    touchSocket.send(JSON.stringify({ type: "input_touch", eventType: "touchStart", touchPoints: touchPoint(toastRect.y) }));
    await delay(50);
    touchSocket.send(JSON.stringify({ type: "input_touch", eventType: "touchMove", touchPoints: touchPoint(toastRect.y - 80) }));
    await delay(50);
    touchSocket.send(JSON.stringify({ type: "input_touch", eventType: "touchEnd", touchPoints: [] }));
    await waitFor("persistent toast touch scroll", () => Number(browserCommand("eval", `document.querySelector('[aria-label="Notificaciones"]').scrollTop`)) > beforeTouch);
  } finally {
    touchSocket.close();
  }
  browserCommand("click", '[aria-label="Notificaciones"] [role="alert"] button[aria-label="Cerrar notificación"]');
  await waitFor("persistent toast dismissal", () => browserCommand("eval", 'document.querySelector(\'[aria-label="Notificaciones"] [role="alert"]\') === null') === "true");
  browserCommand("eval", `([...document.querySelectorAll("summary")].find(item => item.textContent.trim() === "Avanzado"))?.click()`);
  await waitFor("advanced data path input", () => browserCommand("eval", 'document.querySelector("#settings-data-file-path") !== null') === "true");
  browserCommand("fill", "#settings-data-file-path", originalDataPath);
  await waitFor("restored pristine settings", () => browserCommand("eval", `(() => {
    const input = document.querySelector("#settings-data-file-path");
    const save = [...document.querySelectorAll("button")].find(item => item.textContent.trim() === "Guardar configuración");
    return Boolean(input?.value === ${JSON.stringify(originalDataPath)} && save?.disabled && !document.body.innerText.includes("La ruta del archivo de datos debe ser absoluta."));
  })()`) === "true");
  if (browserCommand("eval", 'document.querySelector(\'[aria-label="Notificaciones"] [role="alert"]\') === null') !== "true") throw new Error("Path error remained after restoring settings");
  closeAdvancedPaths();
  browserCommand("eval", "document.documentElement.style.fontSize = ''");
  browserCommand("set", "viewport", "1440", "920");
  browserCommand("eval", "window.scrollTo(0, 0)");
  browserCommand("screenshot", path.join(visualArtifactDirectory, "settings-desktop.png"));
  console.log("[agent-browser-e2e] Data controls and advanced recovery reflow passed");
  await openPreview();
  const validPreview = previewState();
  if (!validPreview.enabled || validPreview.alert ||
    !validPreview.text.includes("Mostrador E2E") || !validPreview.text.includes("Admisión E2E") ||
    !validPreview.text.includes("Aceptada") || !validPreview.text.includes("ALTAS")) {
    throw new Error(`Valid CSV preview was incomplete: ${JSON.stringify(validPreview)}`);
  }
  console.log("[agent-browser-e2e] CSV preview visible");
  await confirmPreview();
  await waitFor("CSV import", async () => {
    const contacts = JSON.parse(await fs.readFile(contactsPath, "utf8"));
    return contacts.records.some((record) => record.displayName === "Mostrador E2E");
  });
  console.log("[agent-browser-e2e] CSV import persisted");

  await waitFor("import success", () => hasText("Importación completada. 2 altas y 0 actualizaciones."));
  await openPreview();
  const invalidPreview = previewState();
  if (invalidPreview.enabled || !invalidPreview.alert ||
    !invalidPreview.text.includes("Rechazada") || !invalidPreview.text.includes("filas con errores")) {
    throw new Error(`Invalid CSV was not blocked: ${JSON.stringify(invalidPreview)}`);
  }
  clickRole("button", "Cerrar vista previa");
  await waitFor("preview closed", () => browserCommand("eval", 'document.querySelector("[aria-label=\\"Vista previa de importación\\"]") === null') === "true");

  await openPreview();
  const mixedPreview = previewState();
  if (!mixedPreview.enabled || mixedPreview.alert ||
    !mixedPreview.text.includes("Aceptada") || !mixedPreview.text.includes("Rechazada") ||
    !mixedPreview.text.includes("El tipo es obligatorio.") || !mixedPreview.text.includes("fila rechazada")) {
    throw new Error(`Mixed CSV preview was incorrect: ${JSON.stringify(mixedPreview)}`);
  }
  clickRole("button", "Cerrar vista previa");

  await openPreview();
  const warningPreview = previewState();
  if (!warningPreview.enabled || warningPreview.alert ||
    !warningPreview.text.includes("Advertencia") || !warningPreview.text.includes("advertencia")) {
    throw new Error(`Warning CSV preview was incorrect: ${JSON.stringify(warningPreview)}`);
  }
  clickRole("button", "Cerrar vista previa");

  await openPreview();
  if (!previewState().text.includes("Servicio Cerrar")) throw new Error("Cancellation fixture missing");
  clickRole("button", "Cerrar vista previa");
  const afterCancel = JSON.parse(await fs.readFile(contactsPath, "utf8"));
  if (afterCancel.records.some((record) => record.externalId === "cancel-1")) {
    throw new Error("Closing preview imported the cancelled record");
  }
  console.log("[agent-browser-e2e] Valid, invalid, mixed, warning, and cancelled CSV previews passed");

  for (const [policy, expectedName] of [
    ["Sobrescribir", "Admisión Sobrescrita"],
    ["Omitir", "Admisión Sobrescrita"],
    ["Combinar", "Admisión Sobrescrita"]
  ]) {
    await openPreview();
    if (previewState().enabled || !previewState().text.includes("Conflictos")) {
      throw new Error(`${policy} fixture did not require a conflict policy`);
    }
    clickRole("radio", policy);
    if (!previewState().enabled) throw new Error(`${policy} did not enable import`);
    await confirmPreview();
    await waitFor(`${policy} applied`, async () => {
      const record = (await readRecords()).find((entry) => entry.externalId === "example-1");
      return record?.displayName === expectedName;
    });
    console.log(`[agent-browser-e2e] Conflict policy passed: ${policy}`);
  }

  await openPreview();
  if (previewState().enabled || !previewState().text.includes("Conflictos (2)")) {
    throw new Error("Bulk conflict preview was not blocked");
  }
  browserCommand("eval", `([...document.querySelectorAll('button')].find(button =>
    button.textContent.trim() === 'Omitir a todos')).focus()`);
  browserCommand("press", "Enter");
  if (!previewState().enabled) throw new Error("Bulk skip did not resolve every conflict");
  await confirmPreview();
  await waitFor("bulk skip finished", () => hasText("Importación completada"));
  const afterBulkSkip = await readRecords();
  if (afterBulkSkip.some((record) => record.displayName === "Admisión Bulk" || record.displayName === "Demo Bulk")) {
    throw new Error("Bulk skip changed existing records");
  }
  console.log("[agent-browser-e2e] Overwrite, skip, merge, and bulk conflict policies passed");

  await closeElectron();
  await launchElectron([bulkPerformanceCsvPath], path.join(workspace, "performance-user-data"));
  clickRole("link", "Configuración");
  await waitFor("performance import settings", () => hasText("Datos e importación"));
  await openPreview();
  await waitFor("5000 conflicts", () => previewState().text.includes("Conflictos (5000)"));
  const bulkMetrics = JSON.parse(browserCommand("eval", `(async () => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Omitir a todos');
    const progress = [...document.querySelectorAll('span')].find(item => /de 5000 resueltos$/.test(item.textContent.trim()));
    if (!button || !progress) throw new Error('Bulk conflict controls are unavailable');
    const longTasks = [];
    const measurementStart = performance.now();
    const observer = new PerformanceObserver(entries => longTasks.push(...entries.getEntries()
      .filter(entry => entry.startTime >= measurementStart).map(entry => entry.duration)));
    observer.observe({ entryTypes: ['longtask'] });
    await new Promise(resolve => setTimeout(resolve, 0));
    const startedAt = performance.now();
    const rendered = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { mutation.disconnect(); reject(new Error('5000 conflict policies timed out')); }, 2000);
      const mutation = new MutationObserver(() => {
        if (progress.textContent.trim() !== '5000 de 5000 resueltos') return;
        clearTimeout(timeout); mutation.disconnect(); resolve();
      });
      mutation.observe(progress, { childList: true, characterData: true, subtree: true });
    });
    button.click();
    await rendered;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 0));
    observer.disconnect();
    return { elapsed: performance.now() - startedAt, longestTask: Math.max(0, ...longTasks) };
  })()`));
  if (bulkMetrics.elapsed > 250 || bulkMetrics.longestTask > 50 || !previewState().enabled) {
    throw new Error(`5000-conflict renderer budget exceeded: ${JSON.stringify(bulkMetrics)}`);
  }
  browserCommand("eval", 'document.querySelector("[aria-label=\\"Vista previa de importación\\"] button").click()');
  await waitFor("discard conflict confirmation", () => browserCommand("eval", 'Boolean(document.querySelector("dialog[open]"))') === "true");
  clickRole("button", "Cerrar igualmente");
  await waitFor("import action after discarded conflicts", importReady);
  console.log("[agent-browser-e2e] 5000 conflict policies met renderer budget", bulkMetrics);

  const tokenError = JSON.parse(browserCommand("eval", `(async () => {
    try { await window.hospitalDirectory.importCsvDataset('bogus-token-conflict', []); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  })()`));
  if (!tokenError?.includes("ya no es válida")) throw new Error(`Invalid token was accepted: ${tokenError}`);
  console.log("[agent-browser-e2e] Invalid import token rejected");

  await closeElectron();
  await launchElectron([odsPath, crossDocumentCsvPath]);
  clickRole("link", "Configuración");
  await waitFor("ODS import settings", () => hasText("Datos e importación"));
  await openPreview();
  const odsPreview = previewState();
  if (!odsPreview.enabled || !odsPreview.text.includes("agenda-large.ods") ||
    !odsPreview.text.includes("Servicio Agenda 0") || !odsPreview.text.includes("Servicio Agenda 39")) {
    throw new Error("40-row ODS preview was incomplete");
  }
  browserCommand("eval", "history.pushState(null, '', location.pathname + '?sameDoc=1' + location.hash)");
  if (!previewState().enabled) throw new Error("Same-document navigation dismissed the ODS preview");
  await confirmPreview();
  await waitFor("40 ODS rows persisted", async () =>
    (await readRecords()).filter((record) => record.displayName.startsWith("Servicio Agenda")).length === 40);
  console.log("[agent-browser-e2e] 40-row ODS import survived same-document navigation");

  const crossDocumentToken = JSON.parse(browserCommand("eval", `(async () => {
    const result = await window.hospitalDirectory.pickAndImportDataset();
    if (result.kind !== 'csv-preview') throw new Error('CSV preview missing');
    return result.preview.importToken;
  })()`));
  browserCommand("reload");
  await waitFor("settings after reload", () => hasText("Datos e importación"));
  const crossDocumentError = JSON.parse(browserCommand("eval", `(async () => {
    try { await window.hospitalDirectory.importCsvDataset(${JSON.stringify(crossDocumentToken)}, []); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  })()`));
  if (!crossDocumentError?.includes("La importación CSV ya no es válida")) {
    throw new Error(`Cross-document navigation did not invalidate token: ${crossDocumentError}`);
  }
  console.log("[agent-browser-e2e] Cross-document navigation invalidated import token");

  clickRole("link", "Directorio");
  await waitFor("directory after import", () => browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true");
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Mostrador E2E");
  await waitFor("imported contact", () => browserCommand("eval", 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Mostrador E2E"))') === "true");

  clickRole("link", "Nuevo registro");
  await waitFor("new contact form", () => browserCommand("is", "visible", "#displayName") === "true");
  browserCommand("fill", "#displayName", "Laboratorio E2E");
  browserCommand("fill", 'input[id^="phone-number-"]', "88123");
  clickRole("button", "Crear registro");
  await waitFor("directory after create", () => browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true");
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Laboratorio E2E");
  await waitFor("created contact in search", () => hasText("Laboratorio E2E"));
  clickRole("button", "Laboratorio E2E");
  clickRole("link", "Editar: Laboratorio E2E");
  await waitFor("edit contact form", () => browserCommand("is", "visible", "#displayName") === "true");
  browserCommand("fill", "#displayName", "Laboratorio E2E Actualizado");
  clickRole("button", "Guardar cambios");
  await waitFor("directory after edit", () => browserCommand("is", "visible", 'input[placeholder="Buscar contacto o servicio"]') === "true");
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Laboratorio E2E Actualizado");
  await waitFor("edited contact in search", () => hasText("Laboratorio E2E Actualizado"));
  await closeElectron();
  await launchElectron([]);
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Laboratorio E2E Actualizado");
  await waitFor("edited contact after relaunch", () => hasText("Laboratorio E2E Actualizado"));
  if (!(await readRecords()).some((record) => record.displayName === "Laboratorio E2E Actualizado")) {
    throw new Error("Edited contact was not persisted after relaunch");
  }
  console.log("[agent-browser-e2e] Contact create, edit, and relaunch persistence passed");

  clickRole("link", "Configuración");
  await waitFor("settings after relaunch", () => hasText("Datos e importación"));
  const backupDir = path.join(workspace, "user-data", "backups");
  const backupsBefore = await fs.readdir(backupDir).catch(() => []);
  clickRole("button", "Crear copia de seguridad");
  await waitFor("new local backup", async () => (await fs.readdir(backupDir)).length > backupsBefore.length);
  const backupsAfter = await fs.readdir(backupDir);
  const backupPath = path.join(backupDir, backupsAfter.find((entry) => !backupsBefore.includes(entry)));
  await closeElectron();
  await launchElectron([backupPath]);
  clickRole("link", "Configuración");
  await waitFor("settings for backup restore", () => hasText("Datos e importación"));
  clickRole("button", "Importar");
  await waitFor("backup import confirmation", () => browserCommand("eval", 'Boolean(document.querySelector("dialog[open]"))') === "true");
  clickRole("button", "Importar archivo");
  await waitFor("backup restore", () => hasText("Importación completada."));
  console.log("[agent-browser-e2e] Local backup and re-import passed");
  });

  await runScenario("phone privacy", async () => {
  const privacyUserDataPath = path.join(workspace, "privacy-user-data");
  const privacyContactsPath = path.join(privacyUserDataPath, "data", "contacts.json");
  await launchElectron([], privacyUserDataPath);
  await closeElectron();
  const privateDataset = JSON.parse(await fs.readFile(privacyContactsPath, "utf8"));
  privateDataset.records = [{
    id: "cnt_chip_1", externalId: "chip-removal-1", type: "service", displayName: "Consulta Confidencial ",
    organization: { department: "Consultas", service: "Consulta Reservada", area: "sanitaria-asistencial" },
    contactMethods: { phones: [{ id: "ph_chip_1", label: "Directo", number: "80099", kind: "internal",
      isPrimary: true, confidential: true, noPatientSharing: true }], emails: [], socials: [] },
    aliases: [], tags: [], status: "active",
    source: { externalId: "chip-removal-1", sheetSlug: "chip-removal", sheetRow: "1" },
    audit: { createdAt: "2026-04-13T00:00:00Z", updatedAt: "2026-04-13T00:00:00Z",
      createdBy: "E2E", updatedBy: "E2E" }
  }];
  privateDataset.metadata.recordCount = 1;
  privateDataset.metadata.typeCounts = { service: 1 };
  privateDataset.metadata.areaCounts = { "sanitaria-asistencial": 1 };
  await fs.writeFile(privacyContactsPath, JSON.stringify(privateDataset));
  await launchElectron([], privacyUserDataPath);
  browserCommand("fill", 'input[placeholder="Buscar contacto o servicio"]', "Consulta Confidencial");
  await waitFor("private contact", () => browserCommand("is", "visible", '[data-record-id="cnt_chip_1"]') === "true");
  browserCommand("click", '[data-record-id="cnt_chip_1"]');
  const privacy = JSON.parse(browserCommand("eval", `(() => {
    const card = document.querySelector('[data-record-id="cnt_chip_1"]')?.innerText || '';
    const phone = document.querySelector('[data-testid="contact-phone-ph_chip_1"]')?.innerText || '';
    const header = [...document.querySelectorAll('h4')].find(item => item.textContent.includes('Consulta Confidencial'))?.parentElement?.innerText || '';
    return { card, phone, header };
  })()`));
  if (!privacy.card.includes("Ver teléfono en detalle") || !privacy.card.includes("Confidencial") ||
    !privacy.card.includes("No facilitar a pacientes") || privacy.card.includes("80099") ||
    privacy.card.includes("Contacto restringido") || !privacy.phone.includes("80099") ||
    !privacy.phone.includes("Confidencial") || !privacy.phone.includes("No facilitar a pacientes") ||
    privacy.phone.includes("No pacientes") || !privacy.header.includes("Confidencial") ||
    !privacy.header.includes("No facilitar a pacientes") || privacy.header.includes("No pacientes")) {
    throw new Error(`Phone privacy labels failed: ${JSON.stringify(privacy)}`);
  }
  browserCommand("click", 'a[aria-label^="Editar: Consulta Confidencial"]');
  await waitFor("private contact edit form", () => browserCommand("is", "visible", "#phone-number-ph_chip_1") === "true");
  const editPrivacy = JSON.parse(browserCommand("eval", `(() => {
    const input = document.querySelector('#phone-number-ph_chip_1');
    const section = input?.closest('li');
    return { value: input?.value, text: section?.innerText || '', pageText: document.body.innerText,
      labels: [...(section?.querySelectorAll('label') || [])].map(label => label.innerText) };
  })()`));
  if (editPrivacy.value !== "80099" || !editPrivacy.text.includes("Confidencial") ||
    editPrivacy.pageText.includes("No facilitar a pacientes") || editPrivacy.pageText.includes("No pacientes") ||
    editPrivacy.labels.some((label) => /no facilitar|no pacientes/i.test(label))) {
    throw new Error(`Phone privacy edit controls failed: ${JSON.stringify(editPrivacy)}`);
  }
  console.log("[agent-browser-e2e] Phone privacy labels and edit controls passed");
  });

  await runScenario("search performance", async () => {
  const searchUserDataPath = path.join(workspace, "search-user-data");
  const searchContactsPath = path.join(searchUserDataPath, "data", "contacts.json");
  await launchElectron([], searchUserDataPath);
  await closeElectron();
  const searchDataset = JSON.parse(await fs.readFile(searchContactsPath, "utf8"));
  const searchCount = 5_000;
  searchDataset.records = Array.from({ length: searchCount }, (_, index) => ({
    id: `search-performance-${index}`, type: "service", displayName: `Equipo ${index}`,
    organization: { department: index % 4 === 0 ? "Central" : "Norte", service: "Agenda", area: "otros" },
    contactMethods: { phones: [], emails: [], socials: [] }, beepers: [], aliases: [], tags: [], status: "active",
    source: { externalId: `search-performance-${index}`, sheetSlug: "search-performance", sheetRow: String(index + 1) },
    audit: { createdAt: "2026-08-31T00:00:00Z", updatedAt: "2026-08-31T00:00:00Z",
      createdBy: "E2E", updatedBy: "E2E" }
  }));
  searchDataset.metadata.recordCount = searchCount;
  searchDataset.metadata.typeCounts = { service: searchCount };
  searchDataset.metadata.areaCounts = { otros: searchCount };
  await fs.writeFile(searchContactsPath, JSON.stringify(searchDataset));
  await launchElectron([], searchUserDataPath);
  browserCommand("eval", `(() => {
    const input = document.querySelector('input[placeholder="Buscar contacto o servicio"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const query of ['equipo central', 'equipo norte', 'equipo central']) {
      setter.call(input, query); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("latest rapid search", () => hasText("1250 resultados"));
  await delay(250);
  if (!hasText("1250 resultados")) throw new Error("Rapid search reverted to a stale result");
  const durations = [];
  for (let index = 0; index < 10; index += 1) {
    const query = index % 2 === 0 ? "equipo norte" : "equipo central";
    const expectedCount = index % 2 === 0 ? 3750 : 1250;
    durations.push(Number(browserCommand("eval", `(async () => {
      const input = document.querySelector('input[placeholder="Buscar contacto o servicio"]');
      const status = [...document.querySelectorAll('[role="status"]')].find(item => /\\d+ resultados$/.test(item.textContent.trim()));
      if (!input || !status) throw new Error('Search controls unavailable');
      const startedAt = performance.now();
      const rendered = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Search timed out')); }, 2000);
        const observer = new MutationObserver(() => {
          if (status.textContent.trim() !== '${expectedCount} resultados') return;
          clearTimeout(timeout); observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        observer.observe(status, { childList: true, characterData: true, subtree: true });
      });
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${query}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await rendered; return performance.now() - startedAt;
    })()`)));
  }
  const p95 = [...durations].sort((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1];
  await delay(250);
  const finalSearch = JSON.parse(browserCommand("eval", `(() => ({
    value: document.querySelector('input[placeholder="Buscar contacto o servicio"]')?.value,
    count: document.body.innerText.includes('1250 resultados'),
    card: Boolean(document.querySelector('[data-record-id="search-performance-0"]'))
  }))()`));
  if (p95 > 100 || finalSearch.value !== "equipo central" || !finalSearch.count || !finalSearch.card ||
    browserCommand("is", "visible", '[data-record-id="search-performance-0"]') !== "true") {
    throw new Error(`Search performance failed: ${JSON.stringify({ durations, p95, finalSearch })}`);
  }
  console.log("[agent-browser-e2e] 5000-contact search met 100ms p95 budget", { durations, p95 });
  });

  if (failures.length) throw new AggregateError(failures, `${failures.length} E2E scenario(s) failed`);
  console.log("[agent-browser-e2e] PASS: directory, import, conflict, persistence, privacy, and search flows");
} finally {
  await closeElectron();
  await stop(vite);
  await fs.rm(workspace, { recursive: true, force: true });
}
