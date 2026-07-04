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

test.describe("OIR-22 critical MVP flows", () => {
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

  test("saves a backup to another folder, re-imports it, and creates a local backup on disk", async () => {
    const workspace = await createWorkspace("export-import-backup");
    const exportPath = path.join(workspace.exportsDir, "contacts-export.json");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      saveDialogPaths: [exportPath],
      openDialogPaths: [exportPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Configuración" }).click();
      await expect(page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      // OIR-223: "Exportar JSON" was removed as a distinct action — saving to
      // another folder is now a de-emphasized secondary option on the single
      // "Copia de seguridad" card, with no "JSON" wording.
      await page.getByRole("button", { name: /Guardar la copia en otra carpeta/i }).click();
      await expect(page.getByText("Exportación completada.")).toBeVisible();
      await expect(fs.access(exportPath)).resolves.toBeUndefined();

      await page.getByRole("button", { name: /Crear copia de seguridad/i }).click();
      await expect(page.getByText("Copia de seguridad creada.")).toBeVisible();
      await expect(listBackupFiles(workspace.userDataPath)).resolves.toHaveLength(1);

      // OIR-219: single unified "Importar" entry point — one button, one native
      // dialog (json/csv/ods/xls/xlsx filter), gated by a pre-selection safety
      // confirmation covering both possible outcomes.
      await page.getByRole("button", { name: "Importar" }).click();
      const pickImportDialog = page.getByRole("dialog", { name: "Seleccionar archivo para importar" });
      await expect(pickImportDialog).toBeVisible();
      await pickImportDialog.getByRole("button", { name: "Elegir archivo" }).click();
      await expect(page.getByText("Importación completada.")).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
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

      // OIR-219: single unified "Importar" entry point.
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

  test("OIR-218: Directory page has zero page-level vertical scroll at common viewport sizes", async () => {
    // Regression guard for OIR-218's "sticky filter bar + bounded/paginated
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
});
