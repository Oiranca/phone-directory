import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

test.describe("OIR-57 bulk import preview UI", () => {
  test("preview shows row table with accepted status for all-valid rows", async () => {
    const workspace = await createWorkspace("preview-all-valid");
    const csvPath = path.join(workspace.incomingDir, "all-valid.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
        "row-1,service,Admisión Central,Admisión,gestion-administracion,12345,internal,active",
        "row-2,service,Urgencias,Urgencias,sanitaria-asistencial,67890,internal,active",
        "row-3,person,Dr. García,Medicina,sanitaria-asistencial,11111,internal,active"
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

      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();

      // Preview panel appears
      await expect(page.getByText("Vista previa importación")).toBeVisible();
      await expect(page.getByRole("heading", { name: "all-valid.csv" })).toBeVisible();

      // Summary stats
      await expect(page.getByText("Filas leídas", { exact: true })).toBeVisible();
      await expect(page.getByText("Altas", { exact: true })).toBeVisible();

      // Row table renders with accepted badges
      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table).toBeVisible();
      await expect(table.getByText("Admisión Central")).toBeVisible();
      await expect(table.getByRole("cell", { name: "Urgencias" }).first()).toBeVisible();
      await expect(table.getByText("Dr. García")).toBeVisible();

      // All rows accepted — at least one "Aceptada" badge visible
      await expect(table.getByText("Aceptada").first()).toBeVisible();

      // No blocker alert inside the preview panel
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      await expect(previewPanel.getByRole("alert")).not.toBeVisible();

      // Confirm button is enabled
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeEnabled();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("preview shows rejected status badges and blocks confirm for all-invalid rows", async () => {
    const workspace = await createWorkspace("preview-all-rejected");
    const csvPath = path.join(workspace.incomingDir, "broken.csv");

    // Rows that are missing required fields (type is empty, displayName is empty)
    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,phone1Number,phone1Kind,status",
        "row-1,,Fila sin tipo,12345,internal,active",
        "row-2,service,,67890,internal,active"
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

      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();

      // Preview panel appears
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      // Blocker alert is rendered inside the preview panel
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      const alert = previewPanel.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("filas con errores");

      // Row table shows rejected badges
      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table).toBeVisible();
      await expect(table.getByText("Rechazada").first()).toBeVisible();

      // Confirm button is disabled
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();

      // Error message toast
      await expect(
        page.getByText("Algunas filas tienen errores. Corrígelas en la agenda original y vuelve a intentarlo.")
      ).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("preview shows mixed accepted and rejected rows", async () => {
    const workspace = await createWorkspace("preview-mixed");
    const csvPath = path.join(workspace.incomingDir, "mixed.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,phone1Number,phone1Kind,status",
        "row-1,service,Registro Válido,12345,internal,active",
        "row-2,,Fila sin tipo,67890,internal,active"
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

      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table).toBeVisible();

      // Both statuses visible
      await expect(table.getByText("Aceptada")).toBeVisible();
      await expect(table.getByText("Rechazada")).toBeVisible();

      // Error message for rejected row is visible in table
      await expect(table.getByText("El tipo es obligatorio.")).toBeVisible();

      // Blocker alert present inside the preview panel
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      await expect(previewPanel.getByRole("alert")).toBeVisible();

      // Confirm blocked
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("preview shows warning badges and allows confirm when warnings only", async () => {
    const workspace = await createWorkspace("preview-warnings");
    const csvPath = path.join(workspace.incomingDir, "warnings.csv");

    // Invalid area triggers a warning but row remains accepted
    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,area,phone1Number,phone1Kind,status",
        "row-1,service,Urgencias Demo,area-invalida,99999,internal,active"
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

      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table).toBeVisible();

      // Warning badge present
      await expect(table.getByText("Advertencia")).toBeVisible();

      // No blocker alert inside the preview panel — only the warning acknowledgement status
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      await expect(previewPanel.getByRole("alert")).not.toBeVisible();
      await expect(previewPanel.getByRole("status")).toContainText("advertencia");

      // Confirm is enabled
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeEnabled();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("confirmed import flow: preview then confirm then success toast", async () => {
    const workspace = await createWorkspace("preview-confirm-flow");
    const csvPath = path.join(workspace.incomingDir, "confirm.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
        "oir57-confirm-1,service,Servicio E2E Preview,Recepción,gestion-administracion,55501,internal,active"
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

      // Step 1: open preview
      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      // Row table shows the new record
      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table.getByText("Servicio E2E Preview")).toBeVisible();

      // Step 2: click Confirm in preview panel
      await page.getByRole("button", { name: "Confirmar importación" }).click();

      // Step 3: dialog appears
      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();

      // Step 4: confirm in dialog
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      // Step 5: success toast
      await expect(page.getByText(/Importación completada/)).toBeVisible();

      // Step 6: preview panel dismissed
      await expect(page.getByText("Vista previa importación")).not.toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("close preview button dismisses the panel without importing", async () => {
    const workspace = await createWorkspace("preview-close");
    const csvPath = path.join(workspace.incomingDir, "close.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,phone1Number,phone1Kind,status",
        "row-1,service,Servicio Cerrar,12345,internal,active"
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

      await page.getByRole("button", { name: /Importar CSV\/ODS/i }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      await page.getByRole("button", { name: "Cerrar vista previa" }).click();

      await expect(page.getByText("Vista previa importación")).not.toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
