import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { DirectoryDataset } from "../../src/shared/types/contact";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron";

const CONTACT_COUNT = 5_000;

const buildLargeDataset = (): DirectoryDataset => ({
  version: "1.0.0",
  exportedAt: "2026-08-31T00:00:00Z",
  metadata: {
    recordCount: CONTACT_COUNT,
    generatedFrom: "search-performance-e2e",
    generatedBy: "tests/e2e/search-performance.spec.ts",
    editorName: "E2E",
    typeCounts: { service: CONTACT_COUNT },
    areaCounts: { otros: CONTACT_COUNT }
  },
  catalogs: {
    recordTypes: ["service"],
    areas: ["otros"]
  },
  records: Array.from({ length: CONTACT_COUNT }, (_, index) => ({
    id: `search-performance-${index}`,
    type: "service",
    displayName: `Equipo ${index}`,
    organization: {
      department: index % 4 === 0 ? "Central" : "Norte",
      service: "Agenda",
      area: "otros"
    },
    contactMethods: { phones: [], emails: [], socials: [] },
    beepers: [],
    aliases: [],
    tags: [],
    status: "active",
    source: {
      externalId: `search-performance-${index}`,
      sheetSlug: "search-performance",
      sheetRow: String(index + 1)
    },
    audit: {
      createdAt: "2026-08-31T00:00:00Z",
      updatedAt: "2026-08-31T00:00:00Z",
      createdBy: "E2E",
      updatedBy: "E2E"
    }
  }))
});

test("keeps rapid Agenda searches current and within the input-to-paint budget", async () => {
  const workspace = await createWorkspace("search-performance");
  const dataDir = path.join(workspace.userDataPath, "data");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "contacts.json"), JSON.stringify(buildLargeDataset()), "utf-8");

  const { electronApp, page } = await launchElectronApp({ userDataPath: workspace.userDataPath });

  try {
    await waitForDirectory(page);
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Buscar contacto o servicio"]');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

      if (!input || !valueSetter) throw new Error("Agenda search input is unavailable");

      for (const query of ["equipo central", "equipo norte", "equipo central"]) {
        valueSetter.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await expect(page.getByText("1250 resultados", { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await expect(page.getByText("1250 resultados", { exact: true })).toBeVisible();

    const searches = Array.from({ length: 10 }, (_, index) =>
      index % 2 === 0
        ? { query: "equipo norte", expectedCount: 3_750 }
        : { query: "equipo central", expectedCount: 1_250 }
    );
    const durations: number[] = [];

    for (const search of searches) {
      durations.push(await page.evaluate(async ({ query, expectedCount }) => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="Buscar contacto o servicio"]');
        const status = Array.from(document.querySelectorAll<HTMLElement>('[role="status"]'))
          .find((element) => /\d+ resultados$/.test(element.textContent?.trim() ?? ""));

        if (!input || !status) {
          throw new Error("Agenda search controls are unavailable");
        }

        const expectedText = `${expectedCount} resultados`;
        const startedAt = performance.now();
        const rendered = new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timed out waiting for ${expectedText}`));
          }, 2_000);
          const observer = new MutationObserver(() => {
            if (status.textContent?.trim() !== expectedText) return;
            window.clearTimeout(timeout);
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
          observer.observe(status, { childList: true, characterData: true, subtree: true });
        });
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        valueSetter?.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await rendered;
        return performance.now() - startedAt;
      }, search));
    }

    const sortedDurations = [...durations].sort((left, right) => left - right);
    const p95 = sortedDurations[Math.ceil(sortedDurations.length * 0.95) - 1]!;

    expect(p95).toBeLessThanOrEqual(100);
    await expect(page.getByLabel("Buscar contactos")).toHaveValue("equipo central");
    await expect(page.getByText("1250 resultados", { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    await expect(page.getByText("1250 resultados", { exact: true })).toBeVisible();
    await expect(page.locator('[data-record-id="search-performance-0"]')).toBeVisible();
    console.info("Agenda search performance", { durations, p95 });
  } finally {
    await closeElectronApp(electronApp);
    await removeWorkspace(workspace);
  }
});
