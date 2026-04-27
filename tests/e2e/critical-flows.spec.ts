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

  test("exports JSON, re-imports it, and creates a backup on disk", async () => {
    const workspace = await createWorkspace("export-import-backup");
    const exportPath = path.join(workspace.exportsDir, "contacts-export.json");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      saveDialogPaths: [exportPath],
      openDialogPaths: [exportPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Importar/Exportar" }).click();
      await expect(page.getByRole("heading", { name: "Importar y exportar datos" })).toBeVisible();

      await page.getByRole("button", { name: /Exportar JSON/i }).click();
      await expect(page.getByText("Exportación completada.")).toBeVisible();
      await expect(fs.access(exportPath)).resolves.toBeUndefined();

      await page.getByRole("button", { name: /Crear backup/i }).click();
      await expect(page.getByText("Backup creado.")).toBeVisible();
      await expect(listBackupFiles(workspace.userDataPath)).resolves.toHaveLength(1);

      await page.getByRole("button", { name: /Importar JSON/i }).click();
      const importJsonDialog = page.getByRole("dialog", { name: "Confirmar importación JSON" });
      await expect(importJsonDialog).toBeVisible();
      await importJsonDialog.getByRole("button", { name: "Importar JSON" }).click();
      await expect(page.getByText("Importación completada.")).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("imports a valid CSV with preview and confirm", async () => {
    const workspace = await createWorkspace("csv-import");
    const csvPath = path.join(workspace.incomingDir, "directory.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
        "example-1,service,Admisión General Actualizada,Admisión,especialidades,12345,internal,active",
        "legacy-e2e,service,Mostrador E2E,Recepción,especialidades,55555,internal,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Importar/Exportar" }).click();
      await expect(page.getByRole("heading", { name: "Importar y exportar datos" })).toBeVisible();

      await page.getByRole("button", { name: /Preparar agenda/i }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();
      await expect(page.getByRole("heading", { name: "directory.csv" })).toBeVisible();
      await expect(page.getByText("Altas", { exact: true })).toBeVisible();
      await expect(page.getByText("Actualizaciones", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Confirmar importación" }).click();
      const importCsvDialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(importCsvDialog).toBeVisible();
      await importCsvDialog.getByRole("button", { name: "Confirmar importación" }).click();
      await expect(page.getByText("Importación completada. 1 altas y 1 actualizaciones.")).toBeVisible();

      await page.getByRole("link", { name: "Directorio" }).click();
      await waitForDirectory(page);
      await page.getByLabel("Buscar contactos").fill("Mostrador E2E");
      await expect(page.getByRole("button", { name: /Mostrador E2E/i })).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
