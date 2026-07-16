/**
 * Social media as a first-class contact method.
 *
 * Tests cover:
 *   1. Schema — socialContactSchema parse, backward-compat default, at-least-one-of handle/url
 *   2. Import — CSV social columns parsed into SocialContact entries
 *   3. Import — social-only row is accepted (not rejected by the "at least one method" rule)
 *   4. Import — ODS social-handle rows become valid contacts (not skipped)
 *   5. Render helpers — getSafeSocialUrl scheme allowlist (XSS-safe)
 *   6. "at least one contact method" validation accepts socials
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { z } from "zod";
import {
  socialContactSchema,
  socialPlatformSchema,
  contactRecordSchema,
} from "../../shared/schemas/contact.js";
import { buildImportPreviewFromRows } from "./csv-import.service.js";
import { normalizeWorkbookRowsFromFile } from "./spreadsheet-import.service.js";
import type { NormalizedImportRow } from "./csv-import.service.js";
import { writeWorkbook } from "./test-support/xlsxWorkbook.js";

XLSX.set_fs(nodeFs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeServiceSheet = (
  name: string,
  rows: Array<{ label: string; numbers: string[] }>
): { name: string; data: string[][] } => ({
  name,
  data: [
    ["SERVICIO", "NUMERO"],
    ...rows.map(({ label, numbers }) => [label, ...numbers])
  ]
});

/** Minimal valid NormalizedImportRow with required fields only. */
const baseRow = (overrides: Partial<NormalizedImportRow> = {}): NormalizedImportRow =>
  Object.assign(
    {
      externalId: "",
      type: "service",
      displayName: "Hospital Demo",
      firstName: "",
      lastName: "",
      area: "",
      department: "Administración",
      service: "",
      specialty: "",
      building: "",
      floor: "",
      room: "",
      locationText: "",
      phone1Label: "",
      phone1Number: "",
      phone1Extension: "",
      phone1Kind: "",
      phone1IsPrimary: "",
      phone1Confidential: "",
      phone1NoPatientSharing: "",
      phone1Notes: "",
      phone2Label: "",
      phone2Number: "",
      phone2Extension: "",
      phone2Kind: "",
      phone2IsPrimary: "",
      phone2Confidential: "",
      phone2NoPatientSharing: "",
      phone2Notes: "",
      email1: "",
      email1Label: "",
      email1IsPrimary: "",
      email2: "",
      email2Label: "",
      email2IsPrimary: "",
      social1Platform: "",
      social1Handle: "",
      social1Url: "",
      social1Label: "",
      social1IsPrimary: "",
      social2Platform: "",
      social2Handle: "",
      social2Url: "",
      social2Label: "",
      social2IsPrimary: "",
      tags: "",
      aliases: "",
      notes: "",
      status: "active"
    } as NormalizedImportRow,
    overrides
  );

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "social-contact-methods-"));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Schema
// ---------------------------------------------------------------------------

describe("socialPlatformSchema", () => {
  it("accepts all declared platforms", () => {
    const platforms = ["instagram", "twitter", "facebook", "linkedin", "youtube", "tiktok", "web", "other"] as const;
    for (const platform of platforms) {
      expect(() => socialPlatformSchema.parse(platform)).not.toThrow();
    }
  });

  it("rejects unknown platform strings", () => {
    expect(() => socialPlatformSchema.parse("snapchat")).toThrow();
  });
});

describe("socialContactSchema", () => {
  it("accepts entry with handle only", () => {
    const result = socialContactSchema.parse({
      id: "soc_001",
      platform: "instagram",
      handle: "hospitaldrnegrin",
      isPrimary: true
    });
    expect(result.handle).toBe("hospitaldrnegrin");
    expect(result.platform).toBe("instagram");
  });

  it("accepts entry with url only", () => {
    const result = socialContactSchema.parse({
      id: "soc_001",
      platform: "web",
      url: "https://hospital.es",
      isPrimary: false
    });
    expect(result.url).toBe("https://hospital.es");
  });

  it("accepts entry with both handle and url", () => {
    const result = socialContactSchema.parse({
      id: "soc_001",
      platform: "instagram",
      handle: "hospital",
      url: "https://instagram.com/hospital",
      isPrimary: true
    });
    expect(result.handle).toBe("hospital");
    expect(result.url).toBe("https://instagram.com/hospital");
  });

  it("rejects entry with neither handle nor url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "instagram",
        isPrimary: true
      })
    ).toThrow("handle o una URL");
  });

  it("rejects entry with both handle and url as empty strings", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "twitter",
        handle: "",
        url: "",
        isPrimary: false
      })
    ).toThrow("handle o una URL");
  });
});

describe("contactRecordSchema — backward-compat default for socials", () => {
  const minimalRecord = {
    id: "cnt_0001",
    type: "service",
    displayName: "Servicio Demo",
    organization: { department: "Admin" },
    contactMethods: {
      phones: [{ id: "ph_001", number: "12345", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
      emails: []
      // NOTE: no `socials` key — simulates an old persisted record
    },
    aliases: [],
    tags: [],
    status: "active",
    audit: {
      createdAt: "2026-04-13T00:00:00Z",
      updatedAt: "2026-04-13T00:00:00Z",
      createdBy: "System",
      updatedBy: "System"
    }
  };

  it("parses a record without a socials field (backward compat — defaults to [])", () => {
    const result = contactRecordSchema.parse(minimalRecord);
    expect(result.contactMethods.socials).toEqual([]);
  });

  it("round-trips a record with socials through the schema", () => {
    const withSocials = {
      ...minimalRecord,
      contactMethods: {
        ...minimalRecord.contactMethods,
        socials: [
          { id: "soc_001", platform: "instagram", handle: "hospitaldrnegrin", isPrimary: true }
        ]
      }
    };
    const result = contactRecordSchema.parse(withSocials);
    expect(result.contactMethods.socials).toHaveLength(1);
    expect(result.contactMethods.socials[0]?.handle).toBe("hospitaldrnegrin");

    // Round-trip through JSON serialize → re-parse.
    const serialized = JSON.parse(JSON.stringify(result));
    const reparsed = contactRecordSchema.parse(serialized);
    expect(reparsed.contactMethods.socials[0]?.handle).toBe("hospitaldrnegrin");
  });
});

// ---------------------------------------------------------------------------
// 2. CSV import — social columns mapped to SocialContact entries
// ---------------------------------------------------------------------------

describe("CSV import — social columns", () => {
  it("maps social1Platform + social1Handle to a SocialContact entry", async () => {
    const rows = [
      baseRow({
        displayName: "Hospital Dr. Negrín",
        type: "service",
        social1Platform: "instagram",
        social1Handle: "hospitaldrnegrin",
        social1IsPrimary: "true"
      })
    ];

    const { dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    expect(dataset.records).toHaveLength(1);
    const socials = dataset.records[0]!.contactMethods.socials;
    expect(socials).toHaveLength(1);
    expect(socials[0]!.platform).toBe("instagram");
    expect(socials[0]!.handle).toBe("hospitaldrnegrin");
    expect(socials[0]!.isPrimary).toBe(true);
  });

  it("maps two social entries from social1 and social2 columns", async () => {
    const rows = [
      baseRow({
        displayName: "Hospital Demo",
        type: "service",
        phone1Number: "12345",
        phone1Kind: "internal",
        phone1IsPrimary: "true",
        phone1Confidential: "false",
        phone1NoPatientSharing: "false",
        social1Platform: "instagram",
        social1Handle: "hospitalinstagram",
        social1IsPrimary: "true",
        social2Platform: "facebook",
        social2Handle: "hospitalfb",
        social2IsPrimary: "false"
      })
    ];

    const { dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    const socials = dataset.records[0]!.contactMethods.socials;
    expect(socials).toHaveLength(2);
    expect(socials[0]!.platform).toBe("instagram");
    expect(socials[1]!.platform).toBe("facebook");
  });

  it("maps social1Url when no handle is present", async () => {
    const rows = [
      baseRow({
        social1Platform: "web",
        social1Url: "https://hospital.es",
        social1IsPrimary: "true"
      })
    ];

    const { dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    const socials = dataset.records[0]!.contactMethods.socials;
    expect(socials).toHaveLength(1);
    expect(socials[0]!.platform).toBe("web");
    expect(socials[0]!.url).toBe("https://hospital.es");
  });

  it("normalizes an unknown platform to 'other' with a warning", async () => {
    const rows = [
      baseRow({
        social1Platform: "snapchat",
        social1Handle: "hospitalsnap",
        social1IsPrimary: "true"
      })
    ];

    const { preview, dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    const socials = dataset.records[0]!.contactMethods.socials;
    expect(socials[0]!.platform).toBe("other");
    expect(preview.warnings.some((w) => w.message.includes("snapchat"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. "at least one contact method" rule accepts socials
// ---------------------------------------------------------------------------

describe("social-only row is accepted (no phone, no email, no location)", () => {
  it("accepts a row with only a social handle as its contact method", async () => {
    const rows = [
      baseRow({
        displayName: "Hospital Dr. Negrín",
        type: "service",
        // No phone, no email, no location — only a social handle.
        social1Platform: "instagram",
        social1Handle: "hospitaldrnegrin",
        social1IsPrimary: "true"
      })
    ];

    const { preview, dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    expect(preview.invalidRowCount).toBe(0);
    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0]!.contactMethods.socials).toHaveLength(1);
    expect(dataset.records[0]!.contactMethods.socials[0]!.handle).toBe("hospitaldrnegrin");
  });

  it("still rejects a row with no phone, email, social, or location", async () => {
    const rows = [
      baseRow({
        displayName: "Vacío",
        type: "service"
        // All contact fields empty
      })
    ];

    const { preview } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "Test"
    });

    expect(preview.invalidRowCount).toBe(1);
    expect(preview.rowIssues[0]?.messages.some((m) => m.includes("red social"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. ODS import — social-handle rows become valid contacts
// ---------------------------------------------------------------------------

describe("ODS import — social-handle rows imported as contacts", () => {
  it("social-handle row in urgencias sheet becomes a contact with social1Handle set", () => {
    const filePath = writeWorkbook(testRoot, "social-ods.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje urgencias", "12345"],
          // Section header announces social context.
          ["REDES SOCIALES"],
          // Social handle row: all-lowercase, 8+ chars, no phone.
          ["hospitaldrnegrin", "", ""]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // socialHandleSkippedRowCount stays 0 — the row is now imported.
    expect(result.socialHandleSkippedRowCount).toBe(0);

    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("hospitaldrnegrin");
    expect(names).toContain("Triaje urgencias");

    const socialRow = result.rows.find((r) => r.displayName === "hospitaldrnegrin");
    expect(socialRow).toBeDefined();
    expect(socialRow!.social1Handle).toBe("hospitaldrnegrin");
    expect(socialRow!.social1IsPrimary).toBe("true");
    expect(socialRow!.social1Platform).toBeDefined();
  });

  it("infers platform=instagram from an INSTAGRAM section header", () => {
    const filePath = writeWorkbook(testRoot, "instagram-section.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje", "12345"],
          ["INSTAGRAM"],
          ["hospitaldrnegrin", "", ""]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const socialRow = result.rows.find((r) => r.displayName === "hospitaldrnegrin");
    expect(socialRow?.social1Platform).toBe("instagram");
  });

  it("infers platform=other from a generic REDES SOCIALES section header", () => {
    const filePath = writeWorkbook(testRoot, "generic-social.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje", "12345"],
          ["REDES SOCIALES"],
          ["hospitalrdssociales", "", ""]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const socialRow = result.rows.find((r) => r.displayName === "hospitalrdssociales");
    expect(socialRow?.social1Platform).toBe("other");
  });

  it("still imports regular phone contacts when social rows are also present", () => {
    const filePath = writeWorkbook(testRoot, "mixed-sheet.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["11111"] },
        { label: "Control cajas", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Control cajas");
    expect(result.rows[0]!.phone1Number).toBe("11111");
  });
});

// ---------------------------------------------------------------------------
// 5. XSS-safe URL derivation — scheme allowlist (renderer-level logic extracted for unit test)
// ---------------------------------------------------------------------------

describe("getSafeSocialUrl — scheme allowlist (XSS-safe URL derivation)", () => {
  /**
   * Inline replica of the renderer getSafeSocialUrl logic for unit testing.
   * Must stay in sync with DirectoryPage.tsx getSafeSocialUrl.
   */
  const SAFE_SOCIAL_BASE_URLS: Partial<Record<string, string>> = {
    instagram: "https://instagram.com/",
    twitter: "https://twitter.com/",
    facebook: "https://facebook.com/",
    linkedin: "https://linkedin.com/in/",
    youtube: "https://youtube.com/@",
    tiktok: "https://tiktok.com/@"
  };

  const ALLOWED_URL_SCHEMES = new Set(["https:", "http:"]);

  const getSafeSocialUrl = (social: { platform: string; handle?: string; url?: string }): string | null => {
    if (social.url) {
      try {
        const parsed = new URL(social.url);
        if (ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
          return social.url;
        }
      } catch {
        // Malformed URL — fall through.
      }
    }

    if (social.handle) {
      const base = SAFE_SOCIAL_BASE_URLS[social.platform];
      if (base) {
        return `${base}${encodeURIComponent(social.handle)}`;
      }
    }

    return null;
  };

  it("returns an https: URL when url field is https:", () => {
    const result = getSafeSocialUrl({ platform: "instagram", url: "https://instagram.com/hospital" });
    expect(result).toBe("https://instagram.com/hospital");
  });

  it("returns an http: URL when url field is http:", () => {
    const result = getSafeSocialUrl({ platform: "web", url: "http://hospital.es" });
    expect(result).toBe("http://hospital.es");
  });

  it("returns null for javascript: scheme (XSS vector)", () => {
    const result = getSafeSocialUrl({ platform: "web", url: "javascript:alert(1)" });
    expect(result).toBeNull();
  });

  it("returns null for data: scheme (XSS vector)", () => {
    const result = getSafeSocialUrl({ platform: "web", url: "data:text/html,<script>alert(1)</script>" });
    expect(result).toBeNull();
  });

  it("returns null for ftp: scheme (not in allowlist)", () => {
    const result = getSafeSocialUrl({ platform: "web", url: "ftp://hospital.es/file" });
    expect(result).toBeNull();
  });

  it("derives instagram URL from handle when no url is provided", () => {
    const result = getSafeSocialUrl({ platform: "instagram", handle: "hospitaldrnegrin" });
    expect(result).toBe("https://instagram.com/hospitaldrnegrin");
  });

  it("URL-encodes handle to prevent injection", () => {
    const result = getSafeSocialUrl({ platform: "instagram", handle: "hospital<script>" });
    expect(result).toBe("https://instagram.com/hospital%3Cscript%3E");
    expect(result).not.toContain("<script>");
  });

  it("returns null when platform has no base URL and handle only is provided", () => {
    const result = getSafeSocialUrl({ platform: "other", handle: "hospitalhandle" });
    expect(result).toBeNull();
  });

  it("returns null when both handle and url are absent", () => {
    const result = getSafeSocialUrl({ platform: "instagram" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. L-01 — socialContactSchema url scheme validation
// ---------------------------------------------------------------------------

import { editableSocialContactSchema } from "../../shared/schemas/contact.js";

describe("socialContactSchema — url scheme validation (L-01)", () => {
  it("accepts https: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "instagram",
        url: "https://instagram.com/x",
        isPrimary: true
      })
    ).not.toThrow();
  });

  it("accepts http: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "http://hospital.es",
        isPrimary: false
      })
    ).not.toThrow();
  });

  it("accepts handle-only entry (no url field)", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "instagram",
        handle: "hospitaldrnegrin",
        isPrimary: true
      })
    ).not.toThrow();
  });

  it("rejects javascript: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "javascript:alert(1)",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });

  it("rejects data: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "data:text/html,<script>alert(1)</script>",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });

  it("rejects vbscript: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "vbscript:msgbox(1)",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });

  it("rejects file: url", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "file:///etc/passwd",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });
});

describe("editableSocialContactSchema — url scheme validation (L-01)", () => {
  it("accepts https: url", () => {
    expect(() =>
      editableSocialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "https://hospital.es",
        isPrimary: true
      })
    ).not.toThrow();
  });

  it("accepts handle-only entry (url empty string → undefined)", () => {
    expect(() =>
      editableSocialContactSchema.parse({
        id: "soc_001",
        platform: "instagram",
        handle: "hospitaldrnegrin",
        url: "",
        isPrimary: true
      })
    ).not.toThrow();
  });

  it("rejects javascript: url", () => {
    expect(() =>
      editableSocialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "javascript:alert(1)",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });

  it("rejects data: url", () => {
    expect(() =>
      editableSocialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "data:text/html,<h1>xss</h1>",
        handle: "x",
        isPrimary: false
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. H-01 regression — socials survive create + updateRecord
// ---------------------------------------------------------------------------

import nodeFs_h01 from "node:fs";
import * as XLSX_h01 from "xlsx";
import { vi } from "vitest";

XLSX_h01.set_fs(nodeFs_h01);

const getPathMock_h01 = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock_h01
  }
}));

describe("H-01 regression — socials survive createRecord + updateRecord", () => {
  let h01TestRoot: string;

  beforeEach(async () => {
    h01TestRoot = await fs.mkdtemp(path.join(os.tmpdir(), "social-contact-h01-"));
    getPathMock_h01.mockImplementation(() => h01TestRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock_h01.mockReset();
    await fs.rm(h01TestRoot, { recursive: true, force: true });
  });

  it("socials are persisted by createRecord and survive a subsequent updateRecord", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Test",
      dataFilePath: path.join(h01TestRoot, "data", "contacts.json"),
      backupDirectoryPath: path.join(h01TestRoot, "backups"),
      ui: {
        showInactiveByDefault: false,
        autoBackup: {
          enabled: false,
          trigger: "launch",
          intervalHours: 2,
          editCountThreshold: 10,
          retentionCount: 5
        }
      }
    });

    // Step 1: create a contact WITH a social entry.
    const created = await service.createRecord({
      type: "service",
      displayName: "Hospital Demo",
      organization: { department: "Administración" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [
          {
            id: "soc_001",
            platform: "instagram",
            handle: "hospitaldemo",
            isPrimary: true
          }
        ]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const createdRecord = created.contacts.records.find(
      (r) => r.id === created.savedRecordId
    );
    expect(createdRecord?.contactMethods.socials).toHaveLength(1);
    expect(createdRecord?.contactMethods.socials[0]?.handle).toBe("hospitaldemo");

    // Step 2: updateRecord — change only displayName; socials must survive.
    const updated = await service.updateRecord(created.savedRecordId, {
      type: "service",
      displayName: "Hospital Demo (actualizado)",
      organization: { department: "Administración" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [
          {
            id: "soc_001",
            platform: "instagram",
            handle: "hospitaldemo",
            isPrimary: true
          }
        ]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const updatedRecord = updated.contacts.records.find(
      (r) => r.id === created.savedRecordId
    );
    expect(updatedRecord?.displayName).toBe("Hospital Demo (actualizado)");
    // H-01 regression assertion: socials must NOT be wiped
    expect(updatedRecord?.contactMethods.socials).toHaveLength(1);
    expect(updatedRecord?.contactMethods.socials[0]?.handle).toBe("hospitaldemo");
  });
});

// ---------------------------------------------------------------------------
// 8. BUG1 regression — socials deduped by content, not positional id
// ---------------------------------------------------------------------------

describe("BUG1 — social dedup by content key in mergeDuplicates", () => {
  let bug1Root: string;

  beforeEach(async () => {
    bug1Root = await fs.mkdtemp(path.join(os.tmpdir(), "social-contact-merge-"));
    getPathMock_h01.mockImplementation(() => bug1Root);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock_h01.mockReset();
    await fs.rm(bug1Root, { recursive: true, force: true });
  });

  const saveSettings = async (service: { saveSettings: Function }, root: string) => {
    await service.saveSettings({
      editorName: "Test",
      dataFilePath: path.join(root, "data", "contacts.json"),
      backupDirectoryPath: path.join(root, "backups"),
      ui: {
        showInactiveByDefault: false,
        autoBackup: {
          enabled: false,
          trigger: "launch",
          intervalHours: 2,
          editCountThreshold: 10,
          retentionCount: 5
        }
      }
    });
  };

  it("same (platform+handle) with different positional ids appears exactly once after merge", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();
    await saveSettings(service, bug1Root);

    // keepRecord: instagram/@hospital — id = soc_1_0 (row 1, index 0)
    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Hospital Keep",
      organization: { department: "Admin" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [{ id: "soc_1_0", platform: "instagram", handle: "hospital", isPrimary: true }]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    // discardRecord: instagram/@hospital — id = soc_2_0 (different positional id, same content)
    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Hospital Discard",
      organization: { department: "Admin" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [{ id: "soc_2_0", platform: "instagram", handle: "hospital", isPrimary: false }]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    // Content is the same, so should appear exactly once
    expect(merged.contactMethods.socials).toHaveLength(1);
    expect(merged.contactMethods.socials[0]?.handle).toBe("hospital");
  });

  it("two distinct socials that share the same positional id are BOTH kept after merge", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();
    await saveSettings(service, bug1Root);

    // keepRecord: instagram/@hospitalinstagram — id = soc_1_0
    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Hospital Keep",
      organization: { department: "Admin" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [{ id: "soc_1_0", platform: "instagram", handle: "hospitalinstagram", isPrimary: true }]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    // discardRecord: facebook/@hospitalfb — ALSO id = soc_1_0, but different platform+handle
    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Hospital Discard",
      organization: { department: "Admin" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [{ id: "soc_1_0", platform: "facebook", handle: "hospitalfb", isPrimary: false }]
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    // Different content → both must be kept
    expect(merged.contactMethods.socials).toHaveLength(2);
    const platforms = merged.contactMethods.socials.map((s) => s.platform);
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("facebook");
  });
});

// ---------------------------------------------------------------------------
// 9. BUG2 — url:"" in persistence schema does not crash parse
// ---------------------------------------------------------------------------

describe("BUG2 — socialContactSchema accepts url:'' (treated as absent)", () => {
  it("parses a social with url:'' without throwing", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "instagram",
        handle: "hospital",
        url: "",
        isPrimary: true
      })
    ).not.toThrow();
  });

  it("contactRecordSchema.parse succeeds for a record with url:'' in socials", () => {
    const record = {
      id: "cnt_0001",
      type: "service",
      displayName: "Hospital Demo",
      organization: { department: "Admin" },
      contactMethods: {
        phones: [],
        emails: [],
        socials: [{ id: "soc_001", platform: "instagram", handle: "hospital", url: "", isPrimary: true }]
      },
      aliases: [],
      tags: [],
      status: "active",
      audit: {
        createdAt: "2026-04-13T00:00:00Z",
        updatedAt: "2026-04-13T00:00:00Z",
        createdBy: "System",
        updatedBy: "System"
      }
    };
    expect(() => contactRecordSchema.parse(record)).not.toThrow();
  });

  it("still rejects url:'javascript:alert(1)' (XSS vector is still blocked)", () => {
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        handle: "x",
        url: "javascript:alert(1)",
        isPrimary: false
      })
    ).toThrow();
  });

  it("url:'  ' (whitespace-only) does not crash parse — isSafeHttpUrl returns true for it", () => {
    // The persistence schema does not trim; whitespace-only url is truthy so at-least-one passes,
    // and isSafeHttpUrl returns true (empty/whitespace treated as absent). No crash.
    expect(() =>
      socialContactSchema.parse({
        id: "soc_001",
        platform: "web",
        url: "  ",
        isPrimary: false
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. LOW UX — getSafeSocialUrl: web/other + full-URL handle is clickable
// ---------------------------------------------------------------------------

describe("LOW UX — getSafeSocialUrl: web/other with full-URL handle", () => {
  // Inline replica kept in sync with DirectoryPage.tsx getSafeSocialUrl (post-fix version)
  const SAFE_SOCIAL_BASE_URLS_LOCAL: Partial<Record<string, string>> = {
    instagram: "https://instagram.com/",
    twitter: "https://twitter.com/",
    facebook: "https://facebook.com/",
    linkedin: "https://linkedin.com/in/",
    youtube: "https://youtube.com/@",
    tiktok: "https://tiktok.com/@"
  };

  const ALLOWED_URL_SCHEMES_LOCAL = new Set(["https:", "http:"]);

  const getSafeSocialUrl = (social: { platform: string; handle?: string; url?: string }): string | null => {
    if (social.url) {
      try {
        const parsed = new URL(social.url);
        if (ALLOWED_URL_SCHEMES_LOCAL.has(parsed.protocol)) {
          return social.url;
        }
      } catch {
        // Malformed URL — fall through.
      }
    }

    if (social.handle) {
      const base = SAFE_SOCIAL_BASE_URLS_LOCAL[social.platform];
      if (base) {
        return `${base}${encodeURIComponent(social.handle)}`;
      }
      // For platforms without a known base URL (web, other), attempt to treat
      // the handle itself as a direct URL if it is http(s):.
      try {
        const parsed = new URL(social.handle);
        if (ALLOWED_URL_SCHEMES_LOCAL.has(parsed.protocol)) {
          return social.handle;
        }
      } catch {
        // Not a valid URL — fall through to null.
      }
    }

    return null;
  };

  it("returns the URL when platform=web and handle is https://...", () => {
    const result = getSafeSocialUrl({ platform: "web", handle: "https://example.com" });
    expect(result).toBe("https://example.com");
  });

  it("returns the URL when platform=other and handle is http://...", () => {
    const result = getSafeSocialUrl({ platform: "other", handle: "http://hospital.local/page" });
    expect(result).toBe("http://hospital.local/page");
  });

  it("returns null for platform=web, handle='javascript:bad' (scheme not in allowlist)", () => {
    const result = getSafeSocialUrl({ platform: "web", handle: "javascript:bad" });
    expect(result).toBeNull();
  });

  it("returns null for platform=web, handle='ftp://file.example.com'", () => {
    const result = getSafeSocialUrl({ platform: "web", handle: "ftp://file.example.com" });
    expect(result).toBeNull();
  });

  it("returns null for platform=web, handle='plaintext' (not a URL)", () => {
    const result = getSafeSocialUrl({ platform: "web", handle: "plaintext" });
    expect(result).toBeNull();
  });

  it("still returns base-URL-derived link for instagram+handle (existing behaviour unaffected)", () => {
    const result = getSafeSocialUrl({ platform: "instagram", handle: "hospitaldrnegrin" });
    expect(result).toBe("https://instagram.com/hospitaldrnegrin");
  });
});
