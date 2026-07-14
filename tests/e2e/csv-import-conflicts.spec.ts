/**
 * E2E coverage for the CSV bulk-import conflict-resolution flow.
 *
 * Cases covered:
 *   - no-conflict import (pure altas, no policy step)
 *   - conflict resolved with "overwrite" policy
 *   - conflict resolved with "skip" policy
 *   - conflict resolved with "merge-fields" policy
 *   - cancel (close preview without importing)
 *   - expired / invalid import token
 *   - malformed / unparseable input
 */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  readContactsFile,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CSV with two brand-new records — no collisions with the seed dataset. */
const noConflictCsv = [
  "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
  "oir103-nc-1,service,Servicio Sin Conflicto A,Admisión,gestion-administracion,19901,internal,active",
  "oir103-nc-2,service,Servicio Sin Conflicto B,Urgencias,sanitaria-asistencial,19902,internal,active"
].join("\n") + "\n";

/**
 * CSV with a single row that collides with the seed record "example-1"
 * (Admisión General, phone 70005) via externalId match.
 */
const conflictCsv = (displayName: string, phone: string) =>
  [
    "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
    `example-1,service,${displayName},Admisión,gestion-administracion,${phone},internal,active`
  ].join("\n") + "\n";

/**
 * Navigate to Configuración, drive the unified "Importar" entry point
 * (one button, one native dialog, one pre-selection confirmation)
 * for the given file path, and wait for the CSV preview panel to appear.
 */
const openPreview = async (page: import("@playwright/test").Page) => {
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();
  await page.getByRole("button", { name: "Importar" }).click();
  await page.getByRole("button", { name: "Elegir archivo" }).click();
  await expect(page.getByText("Vista previa importación")).toBeVisible();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("CSV import conflict-resolution flows", () => {
  // -------------------------------------------------------------------------
  // No-conflict import
  // -------------------------------------------------------------------------
  test("no-conflict import: all rows accepted, confirm succeeds without policy step", async () => {
    const workspace = await createWorkspace("oir103-no-conflict");
    const csvPath = path.join(workspace.incomingDir, "no-conflict.csv");
    await fs.writeFile(csvPath, noConflictCsv, "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      // No conflict alert should appear
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      await expect(previewPanel.getByRole("alert")).not.toBeVisible();

      // Confirm button enabled immediately — no policy selection required
      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText("Importación completada. 2 altas y 0 actualizaciones.")).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Conflict — overwrite policy
  // -------------------------------------------------------------------------
  test("conflict with overwrite policy: existing record replaced by imported data", async () => {
    const workspace = await createWorkspace("oir103-overwrite");
    const csvPath = path.join(workspace.incomingDir, "conflict.csv");
    await fs.writeFile(csvPath, conflictCsv("Admisión Sobrescrita", "19910"), "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      // Conflict alert should appear
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      await expect(previewPanel.getByRole("alert")).toBeVisible();

      // Confirm button disabled until policy is resolved
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();

      // Select "overwrite" for the conflict
      await page.getByRole("radio", { name: "Sobrescribir" }).click();

      // Confirm button now enabled
      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText(/Importación completada/)).toBeVisible();

      // Verify the record was overwritten in the contacts file
      const contacts = await readContactsFile(workspace.userDataPath);
      const record = contacts.records.find((r) => r.externalId === "example-1");
      expect(record?.displayName).toBe("Admisión Sobrescrita");
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Conflict — skip policy
  // -------------------------------------------------------------------------
  test("conflict with skip policy: existing record is preserved unchanged", async () => {
    const workspace = await createWorkspace("oir103-skip");
    const csvPath = path.join(workspace.incomingDir, "conflict.csv");
    await fs.writeFile(csvPath, conflictCsv("Admisión Omitida", "19911"), "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();

      // Select "skip" for the conflict
      await page.getByRole("radio", { name: "Omitir" }).click();

      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText(/Importación completada/)).toBeVisible();

      // Verify the original seed record is preserved
      const contacts = await readContactsFile(workspace.userDataPath);
      const record = contacts.records.find((r) => r.externalId === "example-1");
      expect(record?.displayName).toBe("Admisión General");
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Conflict — merge-fields policy
  // -------------------------------------------------------------------------
  test("conflict with merge-fields policy: import completes without error", async () => {
    const workspace = await createWorkspace("oir103-merge-fields");
    const csvPath = path.join(workspace.incomingDir, "conflict.csv");
    await fs.writeFile(csvPath, conflictCsv("Admisión Combinada", "19912"), "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();

      // Select "merge-fields" for the conflict
      await page.getByRole("radio", { name: "Combinar" }).click();

      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText(/Importación completada/)).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Bulk-apply: apply policy to all conflicts at once
  // -------------------------------------------------------------------------
  test("bulk-apply applies policy to all conflicts and enables confirm", async () => {
    const workspace = await createWorkspace("oir103-bulk-apply");
    const csvPath = path.join(workspace.incomingDir, "multi-conflict.csv");
    // Two rows that both conflict with seed data via externalId
    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,status",
        "example-1,service,Admisión Bulk,Admisión,gestion-administracion,19920,internal,active",
        "example-2,external-center,Demo Bulk,Centros de salud,otros,19921,internal,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();

      // Use "Omitir a todos" bulk-apply shortcut
      await page.getByRole("button", { name: "Omitir a todos" }).click();

      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();

      const dialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText(/Importación completada/)).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Cancel — close preview without importing
  // -------------------------------------------------------------------------
  test("cancel: closing preview does not import any records", async () => {
    const workspace = await createWorkspace("oir103-cancel");
    const csvPath = path.join(workspace.incomingDir, "cancel.csv");
    await fs.writeFile(csvPath, noConflictCsv, "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      // Close without confirming
      await page.getByRole("button", { name: "Cerrar vista previa" }).click();
      await expect(page.getByText("Vista previa importación")).not.toBeVisible();

      // Contacts file should still contain only the original seed records
      const contacts = await readContactsFile(workspace.userDataPath);
      const hasImported = contacts.records.some(
        (r) => r.externalId === "oir103-nc-1" || r.externalId === "oir103-nc-2"
      );
      expect(hasImported).toBe(false);
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Expired / invalid import token
  // -------------------------------------------------------------------------
  test("expired or invalid import token: importCsvDataset rejects with an error", async () => {
    // Drive the "token not found" error path directly via the preload bridge.
    // This avoids the 5-minute TTL wait while still exercising the real code path.
    const workspace = await createWorkspace("oir103-expired-token");
    const csvPath = path.join(workspace.incomingDir, "dummy.csv");
    await fs.writeFile(csvPath, noConflictCsv, "utf-8");

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Configuración" }).click();
      await expect(page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      // Invoke importCsvDataset with a bogus token — the IPC handler should
      // reject because no pending import exists for that token.
      const errorMessage = await page.evaluate(async () => {
        try {
          await window.hospitalDirectory.importCsvDataset("bogus-token-oir103", []);
          return null; // Should not reach here
        } catch (err) {
          return err instanceof Error ? err.message : String(err);
        }
      });

      expect(errorMessage).toBeTruthy();
      expect(typeof errorMessage).toBe("string");
      // The IPC handler throws a localized error when the token is not found
      expect(errorMessage).toContain("ya no es válida");
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  // -------------------------------------------------------------------------
  // Malformed / unparseable input
  // -------------------------------------------------------------------------
  test("malformed CSV: preview shows rejected rows and blocks confirm", async () => {
    const workspace = await createWorkspace("oir103-malformed");
    const csvPath = path.join(workspace.incomingDir, "malformed.csv");

    // Rows missing required fields (type is empty, displayName is empty)
    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,phone1Number,phone1Kind,status",
        "bad-row-1,,Sin tipo,19930,internal,active",
        "bad-row-2,service,,19931,internal,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [csvPath]
    });

    try {
      await waitForDirectory(page);
      await openPreview(page);

      // Blocker alert must be present
      const previewPanel = page.getByRole("region", { name: "Vista previa de importación" });
      const alert = previewPanel.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("filas con errores que no se importarán");

      // Row table shows rejected badges
      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table.getByText("Rechazada").first()).toBeVisible();

      // Confirm is blocked
      await expect(page.getByRole("button", { name: "Confirmar importación" })).toBeDisabled();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
