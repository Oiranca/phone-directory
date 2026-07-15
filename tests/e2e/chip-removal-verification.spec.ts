/**
 * Regression coverage for the removal of the redundant
 * "No facilitar a pacientes" display chip.
 *
 * A phone can still be flagged `noPatientSharing: true` in the data model
 * (the field remains part of the schema — see src/shared/schemas/contact.ts),
 * but the UI must only ever surface the "Confidencial" marker. This test
 * seeds a contact with a phone that has BOTH `confidential: true` and
 * `noPatientSharing: true` set, then asserts that "No facilitar"/"No
 * pacientes" text never appears in any of the three places the app renders
 * privacy markers:
 *   1. The detail-header pills (selectedRecordPrivacyFlags in DirectoryPage)
 *   2. The per-phone card badge (DirectoryPage phone list)
 *   3. The edit form's phone-section checkboxes (PhonesSection)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

const DISPLAY_NAME = "Consulta Confidencial OIR-218";

/**
 * Portable screenshot output directory. Screenshots are purely diagnostic
 * (Playwright already captures failure screenshots via the "only-on-failure"
 * config), but we keep a few explicit checkpoints for manual visual review.
 * Uses os.tmpdir() so the path is valid on any machine/CI runner — never a
 * hardcoded, session-specific absolute path.
 */
const screenshotsDir = path.join(os.tmpdir(), "phone-directory-e2e-screenshots");

const buildSeededDataset = () => ({
  version: "1.0.0",
  exportedAt: "2026-04-13T00:00:00Z",
  metadata: {
    recordCount: 1,
    generatedFrom: "oir-218-chip-removal-verification",
    generatedBy: "tests/e2e/chip-removal-verification.spec.ts",
    editorName: "System",
    typeCounts: {
      service: 1
    },
    areaCounts: {
      "sanitaria-asistencial": 1
    }
  },
  catalogs: {
    recordTypes: [
      "person",
      "service",
      "department",
      "control",
      "supervision",
      "room",
      "external-center",
      "other"
    ],
    areas: ["sanitaria-asistencial", "gestion-administracion", "especialidades", "otros"]
  },
  records: [
    {
      id: "cnt_oir218_1",
      externalId: "oir218-chip-removal-1",
      type: "service",
      displayName: DISPLAY_NAME,
      organization: {
        department: "Consultas",
        service: "Consulta Reservada",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_oir218_1",
            label: "Directo",
            number: "80099",
            kind: "internal",
            isPrimary: true,
            confidential: true,
            noPatientSharing: true
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active",
      source: {
        externalId: "oir218-chip-removal-1",
        sheetSlug: "oir-218",
        sheetRow: "1"
      },
      audit: {
        createdAt: "2026-04-13T00:00:00Z",
        updatedAt: "2026-04-13T00:00:00Z",
        createdBy: "System",
        updatedBy: "System"
      }
    }
  ]
});

test.describe("chip removal regression", () => {
  test("only the Confidencial marker appears, never No facilitar/No pacientes", async () => {
    await fs.mkdir(screenshotsDir, { recursive: true });

    const workspace = await createWorkspace("oir218-chip-removal");
    const dataDir = path.join(workspace.userDataPath, "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, "contacts.json"),
      JSON.stringify(buildSeededDataset(), null, 2),
      "utf-8"
    );

    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      await waitForDirectory(page);

      // Filter the results list down to our seeded record and select it.
      await page.getByPlaceholder("Buscar contacto o servicio").fill(DISPLAY_NAME);
      await page.getByRole("button", { name: new RegExp(DISPLAY_NAME) }).click();

      // --- 1. Detail-header pills -----------------------------------------
      const detailHeader = page
        .getByRole("heading", { name: DISPLAY_NAME, level: 4 })
        .locator("..");
      await expect(detailHeader.getByText("Confidencial", { exact: true })).toBeVisible();
      await expect(detailHeader.getByText("No facilitar a pacientes")).toHaveCount(0);
      await expect(detailHeader.getByText(/No pacientes/i)).toHaveCount(0);

      await page.screenshot({ path: path.join(screenshotsDir, "01-detail-header-pills.png") });

      // --- 2. Per-phone card badge -----------------------------------------
      const phoneCard = page.locator("div.rounded-2xl.border.border-slate-200.bg-white.p-4", {
        hasText: "80099"
      });
      await expect(phoneCard.getByText("Confidencial", { exact: true })).toBeVisible();
      await expect(phoneCard.getByText("No facilitar a pacientes")).toHaveCount(0);
      await expect(phoneCard.getByText(/No pacientes/i)).toHaveCount(0);

      await page.screenshot({ path: path.join(screenshotsDir, "02-phone-card.png") });

      // --- 3. Edit form phone-section checkboxes ----------------------------
      await page.getByRole("link", { name: `Editar registro: ${DISPLAY_NAME}` }).click();
      await expect(page.getByRole("heading", { name: DISPLAY_NAME })).toBeVisible();

      const phoneSection = page.locator("li", { has: page.locator("#phone-number-ph_oir218_1") });
      await expect(phoneSection.getByText("Confidencial", { exact: true })).toBeVisible();
      await expect(phoneSection.locator("input#phone-number-ph_oir218_1")).toHaveValue("80099");
      await expect(phoneSection.getByText("No facilitar a pacientes")).toHaveCount(0);
      await expect(phoneSection.getByText(/No pacientes/i)).toHaveCount(0);

      // Only one checkbox label is present: "Principal" and "Confidencial" —
      // no third checkbox for patient-sharing should exist.
      const checkboxLabels = await phoneSection.locator("label").allTextContents();
      expect(checkboxLabels.some((label) => /no facilitar/i.test(label))).toBe(false);
      expect(checkboxLabels.some((label) => /no pacientes/i.test(label))).toBe(false);

      await page.screenshot({ path: path.join(screenshotsDir, "03-edit-form-phone-section.png") });

      // App-wide: the removed copy should never appear anywhere on screen.
      await expect(page.getByText("No facilitar a pacientes")).toHaveCount(0);
      await expect(page.getByText(/No pacientes/i)).toHaveCount(0);
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
