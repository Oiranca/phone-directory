import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  readContactsFile,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

XLSX.set_fs(nodeFs);

/**
 * OIR-223 priority 1 — mandatory end-to-end gate for the "works in preview,
 * breaks on apply" regression.
 *
 * Root cause (contacts.ipc.ts): the pending CSV/ODS import token was
 * invalidated by ANY `did-start-navigation` event on the sender's
 * webContents — but that Electron event also fires for SAME-DOCUMENT
 * navigations (hash/fragment changes, pushState/replaceState, same-page
 * history navigation — see Electron's `isSameDocument` event field). This
 * app routes entirely via createHashRouter, and same-document navigations
 * can happen without the renderer document (or the preview UI holding the
 * token) ever unloading — e.g. a macOS trackpad two-finger swipe firing
 * Chromium's overscroll history navigation while the operator scrolls the
 * (horizontally-overflowing, per OIR-223 priority 3) preview table. The old
 * listener cleared the token anyway, so an entirely valid, still-visible
 * pending import would silently die and only surface as an opaque error on
 * the LATER confirm click — exactly matching the reported symptom (preview
 * looks correct; confirm throws "La importación CSV ya no es válida.").
 *
 * This test drives the full real flow — launch, pick a real 40-row ODS
 * file, preview, a same-document navigation event fires in between (as
 * Electron really emits it for hash-router / overscroll navigation), then
 * confirm — and asserts the import actually lands in contacts.json. Before
 * the fix this test fails with the exact toast reported by the user; after
 * the fix it passes.
 */
test.describe("OIR-223 priority 1 — bulk ODS import survives a same-document navigation between preview and confirm", () => {
  test("large ODS (40 rows) import: pick -> preview -> same-document nav -> confirm -> data present", async () => {
    const workspace = await createWorkspace("large-ods-apply");
    const odsPath = path.join(workspace.incomingDir, "agenda-large.ods");

    const rows: string[][] = [["Servicio", "Número", "Notas"]];
    for (let i = 0; i < 40; i += 1) {
      rows.push([`Servicio Agenda ${i}`, `${20000 + i}`, ""]);
    }

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, "Agenda");
    await fs.mkdir(path.dirname(odsPath), { recursive: true });
    XLSX.writeFile(workbook, odsPath);

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath,
      openDialogPaths: [odsPath]
    });

    try {
      await waitForDirectory(page);
      await page.getByRole("link", { name: "Configuración" }).click();
      await expect(page.getByRole("heading", { name: "Datos e importación" })).toBeVisible();

      // OIR-219: single unified "Importar" entry point.
      await page.getByRole("button", { name: "Importar" }).click();
      await page.getByRole("button", { name: "Elegir archivo" }).click();

      await expect(page.getByText("Vista previa importación")).toBeVisible();
      await expect(page.getByRole("heading", { name: "agenda-large.ods" })).toBeVisible();

      const table = page.getByRole("table", { name: "Filas de importación" });
      await expect(table).toBeVisible();
      await expect(table.getByText("Servicio Agenda 0", { exact: true }).first()).toBeVisible();
      await expect(table.getByText("Servicio Agenda 39", { exact: true }).first()).toBeVisible();

      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();

      // Simulate a real same-document navigation event on the app's actual
      // webContents while the preview is open — the exact Electron event
      // shape that a hash-router transition or an overscroll swipe gesture
      // produces. This must NOT invalidate the still-open, still-valid
      // pending import.
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error("no BrowserWindow found");
        }
        win.webContents.emit("did-start-navigation", {
          url: win.webContents.getURL(),
          isSameDocument: true,
          isMainFrame: true
        });
      });

      await confirmBtn.click();

      const importCsvDialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(importCsvDialog).toBeVisible();
      await importCsvDialog.getByRole("button", { name: "Confirmar importación" }).click();

      // Must NOT see the stale-token error — must see the real success toast.
      await expect(page.getByText("La importación CSV ya no es válida")).not.toBeVisible();
      await expect(page.getByText(/Importación completada/)).toBeVisible();
      await expect(page.getByText("Vista previa importación")).not.toBeVisible();

      // Verify the data actually landed — not just that the UI said so.
      const contacts = await readContactsFile(workspace.userDataPath);
      expect(contacts.records.filter((r) => r.displayName.startsWith("Servicio Agenda")).length).toBe(40);
      expect(contacts.records.some((r) => r.displayName === "Servicio Agenda 0")).toBe(true);
      expect(contacts.records.some((r) => r.displayName === "Servicio Agenda 39")).toBe(true);
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("a REAL cross-document navigation still invalidates the token (security behavior preserved)", async () => {
    const workspace = await createWorkspace("cross-doc-nav-invalidates");
    const csvPath = path.join(workspace.incomingDir, "small.csv");

    await fs.writeFile(
      csvPath,
      [
        "externalId,type,displayName,phone1Number,phone1Kind,status",
        "oir223-crossdoc-1,service,Servicio Cross Doc,12345,internal,active"
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

      await page.getByRole("button", { name: "Importar" }).click();
      await page.getByRole("button", { name: "Elegir archivo" }).click();
      await expect(page.getByText("Vista previa importación")).toBeVisible();

      const confirmBtn = page.getByRole("button", { name: "Confirmar importación" });
      await expect(confirmBtn).toBeEnabled();

      // A genuine cross-document navigation (isSameDocument: false) — the
      // original security intent (OIR-113: "navigation means the import
      // preview UI is gone") must still hold for this case.
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error("no BrowserWindow found");
        }
        win.webContents.emit("did-start-navigation", {
          url: "http://example.invalid/",
          isSameDocument: false,
          isMainFrame: true
        });
      });

      await confirmBtn.click();
      const importCsvDialog = page.getByRole("dialog", { name: "Confirmar importación de agenda" });
      await expect(importCsvDialog).toBeVisible();
      await importCsvDialog.getByRole("button", { name: "Confirmar importación" }).click();

      await expect(page.getByText("La importación CSV ya no es válida")).toBeVisible();
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
