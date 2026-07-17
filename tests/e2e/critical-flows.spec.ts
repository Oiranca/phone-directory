import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  listBackupFiles,
  readContactsFile,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

test.describe("critical MVP flows", () => {
  test("loads the app and opens a detail from search", async () => {
    const workspace = await createWorkspace("search-detail");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(page);
      await page.getByLabel("Buscar contactos").fill("Centro de Salud Demo");
      const resultButton = page.getByRole("button", { name: /Centro de Salud Demo - Información/i });
      await resultButton.click();

      await expect(page.getByText("Detalle del registro")).toBeVisible();
      await expect(resultButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("link", { name: "Editar registro" })).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("creates and edits a contact with persistence after relaunch", async () => {
    const workspace = await createWorkspace("create-edit");
    const createdName = "Laboratorio E2E";
    const updatedName = "Laboratorio E2E Actualizado";
    let launched = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(launched.page);
      await launched.page.getByRole("link", { name: "Nuevo registro" }).click();
      await expect(launched.page.getByText("Alta de contacto")).toBeVisible();
      await launched.page.getByLabel("Nombre visible").fill(createdName);
      await launched.page.getByLabel("Número").fill("88123");
      await launched.page.getByRole("button", { name: "Crear registro" }).click();

      await waitForDirectory(launched.page);
      await launched.page.getByLabel("Buscar contactos").fill(createdName);
      const createdResultButton = launched.page.getByRole("button", { name: new RegExp(createdName, "i") });
      await expect(createdResultButton).toBeVisible();
      await createdResultButton.click();
      await expect(createdResultButton).toHaveAttribute("aria-pressed", "true");

      await launched.page.getByRole("link", { name: "Editar registro" }).click();
      await launched.page.getByLabel("Nombre visible").fill(updatedName);
      await launched.page.getByRole("button", { name: "Guardar cambios" }).click();

      await waitForDirectory(launched.page);
      await launched.page.getByLabel("Buscar contactos").fill(updatedName);
      await expect(launched.page.getByRole("button", { name: new RegExp(updatedName, "i") })).toBeVisible();

      await closeElectronApp(launched.electronApp);

      launched = await launchElectronApp({
        userDataPath: workspace.userDataPath
      });

      await waitForDirectory(launched.page);
      await launched.page.getByLabel("Buscar contactos").fill(updatedName);
      await expect(launched.page.getByRole("button", { name: new RegExp(updatedName, "i") })).toBeVisible();

      const contacts = await readContactsFile(workspace.userDataPath);
      expect(contacts.records.some((record) => record.displayName === updatedName)).toBe(true);
    } finally {
      await closeElectronApp(launched.electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("creates a local backup on disk and re-imports it", async () => {
    // The "Guardar la copia en otra carpeta…" secondary link/export
    // entry point was removed from the "Copia de seguridad" card entirely
    // (the operator confirmed choosing another destination folder is never
    // needed). This flow now only exercises the single "Crear copia de
    // seguridad" action, then re-imports that same local backup file — the
    // underlying exportDataset()/createBackup() IPC mechanism is unchanged.
    const workspace = await createWorkspace("backup-reimport");
    let launched = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(launched.page);
      await launched.page.getByRole("link", { name: "Configuración" }).click();
      await expect(launched.page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      await expect(launched.page.getByRole("button", { name: /Guardar la copia en otra carpeta/i })).toHaveCount(0);

      await launched.page.getByRole("button", { name: /Crear copia de seguridad/i }).click();
      await expect(launched.page.getByText("Copia de seguridad creada.")).toBeVisible();
      const backupFiles = await listBackupFiles(workspace.userDataPath);
      expect(backupFiles).toHaveLength(1);
      const backupFilePath = path.join(workspace.userDataPath, "backups", backupFiles[0]!.name);

      await closeElectronApp(launched.electronApp);

      // Relaunch with the native file dialog stubbed to return the backup
      // file that was just created, then re-import it via the unified
      // "Importar" entry point (JSON full-replace path).
      launched = await launchElectronApp({
        userDataPath: workspace.userDataPath,
        openDialogPaths: [backupFilePath]
      });

      await waitForDirectory(launched.page);
      await launched.page.getByRole("link", { name: "Configuración" }).click();
      await expect(launched.page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      // Single unified "Importar" entry point — one button, one native
      // dialog (json/csv/ods/xls/xlsx filter), gated by a pre-selection safety
      // confirmation covering both possible outcomes.
      await launched.page.getByRole("button", { name: "Importar" }).click();
      const pickImportDialog = launched.page.getByRole("dialog", { name: "Seleccionar archivo para importar" });
      await expect(pickImportDialog).toBeVisible();
      await pickImportDialog.getByRole("button", { name: "Elegir archivo" }).click();
      await expect(launched.page.getByText("Importación completada.")).toBeVisible();
    } finally {
      await closeElectronApp(launched.electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("imports a valid CSV with preview and confirm (no conflicts)", async () => {
    // Uses externalIds that do not exist in the seed dataset so the import
    // produces only altas with no conflict-resolution step required.
    const workspace = await createWorkspace("csv-import");
    const csvPath = path.join(workspace.incomingDir, "directory.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
        "e2e-critical-1,service,Admisión E2E,Admisión,gestion-administracion,12301,internal,active",
        "e2e-critical-2,service,Mostrador E2E,Recepción,gestion-administracion,12302,internal,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Configuración" }).click();
      await expect(page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      // Single unified "Importar" entry point.
      await page.getByRole("button", { name: "Importar" }).click();
      await page.getByRole("button", { name: "Elegir archivo" }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();
      await expect(page.getByRole("heading", { name: "directory.csv" })).toBeVisible();
      await expect(page.getByText("Altas", { exact: true })).toBeVisible();

      // No conflicts — Confirmar importación should be enabled immediately.
      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const importCsvDialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(importCsvDialog).toBeVisible();
      await importCsvDialog.getByRole("button", { name: "Confirmar importación" }).click();
      await expect(page.getByText("Importación completada. 2 altas y 0 actualizaciones.")).toBeVisible();

      await page.getByRole("link", { name: "Directorio" }).click();
      await waitForDirectory(page);
      await page.getByLabel("Buscar contactos").fill("Mostrador E2E");
      await expect(page.getByRole("button", { name: /Mostrador E2E/i })).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("Directory page has zero page-level vertical scroll at common viewport sizes", async () => {
    // Regression guard for the "sticky filter bar + bounded/paginated
    // results list + bounded detail panel" layout: only the list/detail
    // panel's own internal overflow-y-auto may scroll — the document itself
    // must always fit exactly within the viewport, at any window size.
    const workspace = await createWorkspace("zero-page-scroll");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(page);

      const viewportsToCheck = [
        { width: 1440, height: 768 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 }
      ];

      for (const viewport of viewportsToCheck) {
        await page.setViewportSize(viewport);
        // Let the ResizeObserver-driven --app-header-height /
        // --directory-filterbar-height CSS custom properties settle after
        // the resize before measuring.
        await page.waitForTimeout(150);

        const measurement = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight
        }));

        // 1px epsilon for sub-pixel rounding across browser engines.
        expect(
          measurement.scrollHeight,
          `Directory page produced page-level scroll at ${viewport.width}x${viewport.height}: ` +
            `scrollHeight=${measurement.scrollHeight} innerHeight=${measurement.innerHeight}`
        ).toBeLessThanOrEqual(measurement.innerHeight + 1);
      }
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("Directory page avoids horizontal and vertical page-level scroll at narrow viewport widths", async () => {
    // Regression guard for the icon rail nav (replacing the old top nav):
    // the rail is a fixed-width shell element sitting beside the page
    // content via flexbox, so a narrow window could either force the
    // content column to overflow horizontally (page-level scrollbar) or,
    // like the desktop scenario above, reintroduce document-level vertical
    // scroll. Neither the rail nor the directory content may cause the
    // document itself to exceed the viewport at small widths.
    //
    // "Narrow" here is anchored to what this Electron app can actually be
    // resized to, not generic mobile breakpoints: `src/main/index.ts` sets
    // `minWidth: 1080` / `minHeight: 720` on the BrowserWindow, so no real
    // user session can ever produce a viewport below that floor. Testing
    // arbitrary phone-sized widths (e.g. 320-390px) would exercise a state
    // that is unreachable in production and would just be measuring a
    // pre-existing, unrelated CSS min-content quirk instead of this PR's
    // shell-geometry change.
    const workspace = await createWorkspace("narrow-viewport-scroll");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(page);

      const viewportsToCheck = [
        { width: 1080, height: 720 },
        { width: 1100, height: 750 },
        { width: 1200, height: 800 }
      ];

      for (const viewport of viewportsToCheck) {
        await page.setViewportSize(viewport);
        // Let the ResizeObserver-driven --app-header-height /
        // --directory-filterbar-height CSS custom properties settle after
        // the resize before measuring.
        await page.waitForTimeout(150);

        const measurement = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight
        }));

        // 1px epsilon for sub-pixel rounding across browser engines.
        expect(
          measurement.scrollWidth,
          `Directory page produced horizontal page-level scroll at ${viewport.width}x${viewport.height}: ` +
            `scrollWidth=${measurement.scrollWidth} innerWidth=${measurement.innerWidth}`
        ).toBeLessThanOrEqual(measurement.innerWidth + 1);

        expect(
          measurement.scrollHeight,
          `Directory page produced vertical page-level scroll at ${viewport.width}x${viewport.height}: ` +
            `scrollHeight=${measurement.scrollHeight} innerHeight=${measurement.innerHeight}`
        ).toBeLessThanOrEqual(measurement.innerHeight + 1);
      }
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
