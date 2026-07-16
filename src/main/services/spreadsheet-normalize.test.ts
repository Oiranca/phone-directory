/**
 * Direct unit tests for spreadsheet-normalize.ts.
 *
 * spreadsheet-import.golden.test.ts exercises several of these helpers only
 * INDIRECTLY (as a side effect of running full ODS/XLSX fixtures through
 * normalizeWorkbookRowsFromFile). This file provides isolated, direct
 * coverage for every exported helper in spreadsheet-normalize.ts, with extra
 * focus on the range/suffix expansion logic and label/type classification
 * that drive PII detection during bulk import.
 */

import { describe, expect, it } from "vitest";
import {
  NO_SHARE_MARKERS,
  CONFIDENTIAL_MARKERS,
  isSerializedPhoneEntry,
  clean,
  stripBom,
  hasLetters,
  normalizeAscii,
  normalizeMarker,
  dedupeKeepOrder,
  expandCompactRange,
  expandCompactSuffix,
  extractNumbers,
  detectPrivacy,
  parseSiNoFlag,
  looksLikeDateValue,
  hasPhoneLikeNumber,
  cleanNoteFragments,
  aliasesFromLabel,
  isExcludedLabel,
  isMeaningfulServiceLabel,
  prettifyLabel,
  inferAreaFromLabel,
} from "./spreadsheet-normalize.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("NO_SHARE_MARKERS / CONFIDENTIAL_MARKERS", () => {
  it("are non-empty arrays of strings", () => {
    expect(Array.isArray(NO_SHARE_MARKERS)).toBe(true);
    expect(NO_SHARE_MARKERS.length).toBeGreaterThan(0);
    expect(Array.isArray(CONFIDENTIAL_MARKERS)).toBe(true);
    expect(CONFIDENTIAL_MARKERS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// isSerializedPhoneEntry
// ---------------------------------------------------------------------------

describe("isSerializedPhoneEntry", () => {
  const validEntry = {
    number: "928123456",
    label: "Principal",
    kind: "landline",
    isPrimary: true,
    confidential: false,
    noPatientSharing: false,
  };

  it("returns true for a well-formed entry", () => {
    expect(isSerializedPhoneEntry(validEntry)).toBe(true);
  });

  it("returns true when the optional notes field is present", () => {
    expect(isSerializedPhoneEntry({ ...validEntry, notes: "extra" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isSerializedPhoneEntry(null)).toBe(false);
  });

  it("returns false for a non-object primitive", () => {
    expect(isSerializedPhoneEntry("not an object")).toBe(false);
    expect(isSerializedPhoneEntry(42)).toBe(false);
    expect(isSerializedPhoneEntry(undefined)).toBe(false);
  });

  it("returns false when a required field is missing", () => {
    const { number, ...rest } = validEntry;
    expect(isSerializedPhoneEntry(rest)).toBe(false);
  });

  it("returns false when a required field has the wrong type (crafted phones column)", () => {
    expect(isSerializedPhoneEntry({ ...validEntry, isPrimary: "true" })).toBe(false);
    expect(isSerializedPhoneEntry({ ...validEntry, number: 928123456 })).toBe(false);
  });

  it("returns false for an array (not a plain object)", () => {
    expect(isSerializedPhoneEntry([validEntry])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String cleaning
// ---------------------------------------------------------------------------

describe("clean", () => {
  it("collapses multiple whitespace into a single space", () => {
    expect(clean("Hola   Mundo")).toBe("Hola Mundo");
  });

  it("trims leading and trailing whitespace", () => {
    expect(clean("  Hola Mundo  ")).toBe("Hola Mundo");
  });

  it("collapses non-breaking spaces", () => {
    expect(clean("Hola Mundo")).toBe("Hola Mundo");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(clean("   ")).toBe("");
  });
});

describe("stripBom", () => {
  it("removes a leading UTF-8 BOM", () => {
    expect(stripBom("﻿Hola")).toBe("Hola");
  });

  it("leaves a string without a BOM unchanged", () => {
    expect(stripBom("Hola")).toBe("Hola");
  });
});

describe("hasLetters", () => {
  it("returns true for strings with plain ASCII letters", () => {
    expect(hasLetters("Urgencias")).toBe(true);
  });

  it("returns true for strings with only accented letters", () => {
    expect(hasLetters("ÑÑÑ")).toBe(true);
  });

  it("returns false for digit-only strings", () => {
    expect(hasLetters("12345")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasLetters("")).toBe(false);
  });
});

describe("normalizeAscii", () => {
  it("lowercases and replaces non-alphanumeric characters with hyphens", () => {
    expect(normalizeAscii("Hoja de Cálculo!")).toBe("hoja-de-calculo");
  });

  it("strips diacritics", () => {
    expect(normalizeAscii("Admisión")).toBe("admision");
  });

  it("falls back to 'sheet' when the result would be empty", () => {
    expect(normalizeAscii("###")).toBe("sheet");
    expect(normalizeAscii("")).toBe("sheet");
  });

  it("strips leading and trailing hyphens", () => {
    expect(normalizeAscii("--Hola--")).toBe("hola");
  });
});

describe("normalizeMarker", () => {
  it("uppercases, strips diacritics, and removes whitespace", () => {
    expect(normalizeMarker("índice agenda")).toBe("INDICEAGENDA");
  });

  it("treats accent variants as equal", () => {
    expect(normalizeMarker("Sí")).toBe(normalizeMarker("SI"));
  });
});

// ---------------------------------------------------------------------------
// Array helpers
// ---------------------------------------------------------------------------

describe("dedupeKeepOrder", () => {
  it("removes duplicates while preserving first-seen order", () => {
    expect(dedupeKeepOrder(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeKeepOrder([])).toEqual([]);
  });

  it("returns the same values (deduped) when there are no repeats", () => {
    expect(dedupeKeepOrder(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// Compact range / suffix expansion — drives PII (phone) detection, so
// correctness here matters most.
// ---------------------------------------------------------------------------

describe("expandCompactRange", () => {
  it("expands a compact range sharing a prefix", () => {
    expect(expandCompactRange("928101-15")).toEqual([
      "928101",
      "928102",
      "928103",
      "928104",
      "928105",
      "928106",
      "928107",
      "928108",
      "928109",
      "928110",
      "928111",
      "928112",
      "928113",
      "928114",
      "928115",
    ]);
  });

  it("expands a single-digit-suffix range", () => {
    expect(expandCompactRange("1234-6")).toEqual(["1234", "1235", "1236"]);
  });

  it("returns null when the value has no hyphen", () => {
    expect(expandCompactRange("928101")).toBeNull();
  });

  it("returns null when the suffix is not shorter than the start (not a compact range)", () => {
    expect(expandCompactRange("12-34")).toBeNull();
  });

  it("returns null when the end is smaller than the start", () => {
    expect(expandCompactRange("928119-10")).toBeNull();
  });

  it("returns null when the expanded range would exceed 20 entries", () => {
    expect(expandCompactRange("928100-99")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(expandCompactRange("abc-def")).toBeNull();
  });

  it("accepts a range at the 20-entry boundary", () => {
    const result = expandCompactRange("928100-20");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(21);
  });
});

describe("expandCompactSuffix", () => {
  it("expands a suffix by borrowing the prefix from the previous number", () => {
    expect(expandCompactSuffix("928101", "02")).toBe("928102");
  });

  it("returns null when there is no previous number", () => {
    expect(expandCompactSuffix(undefined, "02")).toBeNull();
  });

  it("returns null when the current part has no digits", () => {
    expect(expandCompactSuffix("928101", "")).toBeNull();
    expect(expandCompactSuffix("928101", "abc")).toBeNull();
  });

  it("returns null when the current digits are not shorter than the previous number", () => {
    expect(expandCompactSuffix("101", "928102")).toBeNull();
  });

  it("strips non-digit characters from the current part before expanding", () => {
    expect(expandCompactSuffix("928101", " 02 ")).toBe("928102");
  });
});

describe("extractNumbers", () => {
  it("extracts a single plain phone number", () => {
    expect(extractNumbers("928123456")).toEqual(["928123456"]);
  });

  it("extracts slash-separated numbers", () => {
    expect(extractNumbers("928123456 / 928123457")).toEqual(["928123456", "928123457"]);
  });

  it("expands a compact range within a slash-separated list", () => {
    expect(extractNumbers("928101-03")).toEqual(["928101", "928102", "928103"]);
  });

  it("expands a compact suffix chained after a full number", () => {
    expect(extractNumbers("928101 / 02 / 03")).toEqual(["928101", "928102", "928103"]);
  });

  it("dedupes repeated numbers while preserving order", () => {
    expect(extractNumbers("928123456 / 928123456")).toEqual(["928123456"]);
  });

  it("ignores fragments shorter than 4 digits that cannot be expanded", () => {
    expect(extractNumbers("12")).toEqual([]);
  });

  it("returns an empty array for blank input", () => {
    expect(extractNumbers("")).toEqual([]);
    expect(extractNumbers("   ")).toEqual([]);
  });

  it("returns an empty array for non-numeric text", () => {
    expect(extractNumbers("sin telefono")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Privacy detection — critical for PII handling correctness.
// ---------------------------------------------------------------------------

describe("detectPrivacy", () => {
  it("flags confidential when a CONFIDENTIAL_MARKERS phrase is present", () => {
    expect(detectPrivacy("Uso interno - despacho médico")).toEqual({
      confidential: true,
      noPatientSharing: false,
    });
  });

  it("flags noPatientSharing when a NO_SHARE_MARKERS phrase is present", () => {
    expect(detectPrivacy("NO DAR A LA CALLE")).toEqual({
      confidential: false,
      noPatientSharing: true,
    });
  });

  it("is case-insensitive", () => {
    expect(detectPrivacy("no dar a la calle").noPatientSharing).toBe(true);
  });

  it("can flag both confidential and noPatientSharing at once", () => {
    expect(
      detectPrivacy("Internal Use Only. No dar a la calle.")
    ).toEqual({ confidential: true, noPatientSharing: true });
  });

  it("returns both flags false when no marker is present", () => {
    expect(detectPrivacy("Notas normales sin marcadores")).toEqual({
      confidential: false,
      noPatientSharing: false,
    });
  });

  it("returns both flags false for an empty string", () => {
    expect(detectPrivacy("")).toEqual({ confidential: false, noPatientSharing: false });
  });
});

describe("parseSiNoFlag", () => {
  it("returns true for 'Si'", () => {
    expect(parseSiNoFlag("Si")).toBe(true);
  });

  it("returns true for accented/casing variants", () => {
    expect(parseSiNoFlag("sí")).toBe(true);
    expect(parseSiNoFlag(" SÍ ")).toBe(true);
  });

  it("returns false for 'No'", () => {
    expect(parseSiNoFlag("No")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(parseSiNoFlag("")).toBe(false);
  });

  it("returns false for unrelated text", () => {
    expect(parseSiNoFlag("sin especificar")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Label and note helpers
// ---------------------------------------------------------------------------

describe("looksLikeDateValue", () => {
  it("returns true for dd/mm/yyyy", () => {
    expect(looksLikeDateValue("25/12/2024")).toBe(true);
  });

  it("returns true for dashed or dotted dates", () => {
    expect(looksLikeDateValue("2024-12-25")).toBe(true);
    expect(looksLikeDateValue("25.12.2024")).toBe(true);
  });

  it("returns false for a phone number", () => {
    expect(looksLikeDateValue("928123456")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(looksLikeDateValue("")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(looksLikeDateValue("Urgencias")).toBe(false);
  });
});

describe("hasPhoneLikeNumber", () => {
  it("returns true for a value containing a 4-9 digit number", () => {
    expect(hasPhoneLikeNumber("Llamar al 928123")).toBe(true);
  });

  it("returns false for a value that looks like a date", () => {
    expect(hasPhoneLikeNumber("25/12/2024")).toBe(false);
  });

  it("returns false when there is no number", () => {
    expect(hasPhoneLikeNumber("Sin telefono")).toBe(false);
  });

  it("returns false when the only digit run is too short", () => {
    expect(hasPhoneLikeNumber("Ext. 12")).toBe(false);
  });
});

describe("cleanNoteFragments", () => {
  it("trims and filters out blank fragments", () => {
    expect(cleanNoteFragments(["  Hola  ", "", "   ", "Mundo"])).toEqual(["Hola", "Mundo"]);
  });

  it("removes INDICE_AGENDA marker noise", () => {
    expect(cleanNoteFragments(["Índice Agenda", "Nota real", "INDICE AGENDA HOSPITALARIA"])).toEqual([
      "Nota real",
    ]);
  });

  it("returns an empty array when every fragment is noise or blank", () => {
    expect(cleanNoteFragments(["", "Índice Agenda"])).toEqual([]);
  });
});

describe("aliasesFromLabel", () => {
  it("infers 'scanner' from a TAC label", () => {
    expect(aliasesFromLabel("TAC 1")).toBe("scanner");
  });

  it("infers 'radiologia' from an RX label", () => {
    expect(aliasesFromLabel("RX Urgencias")).toBe("radiologia");
  });

  it("infers 'uci' from a UMI label", () => {
    expect(aliasesFromLabel("UMI Planta 3")).toBe("uci");
  });

  it("infers 'secretaria' from a SECRETAR* label", () => {
    expect(aliasesFromLabel("Secretaría Dirección")).toBe("secretaria");
  });

  it("combines multiple aliases and dedupes them", () => {
    expect(aliasesFromLabel("RX y TAC")).toBe("scanner|radiologia");
  });

  it("returns an empty string when no alias pattern matches", () => {
    expect(aliasesFromLabel("Cardiología")).toBe("");
  });
});

describe("isExcludedLabel", () => {
  it("excludes an empty/blank label", () => {
    expect(isExcludedLabel("")).toBe(true);
    expect(isExcludedLabel("   ")).toBe(true);
  });

  it("excludes the INDICE_AGENDA marker", () => {
    expect(isExcludedLabel("Índice Agenda")).toBe(true);
    expect(isExcludedLabel("indice agenda hospitalaria")).toBe(true);
  });

  it("excludes the literal word 'Servicio'", () => {
    expect(isExcludedLabel("Servicio")).toBe(true);
  });

  it("excludes an ALL-CAPS structural label", () => {
    expect(isExcludedLabel("CENTROS DE SALUD")).toBe(true);
  });

  it("does not exclude a real person/department name", () => {
    expect(isExcludedLabel("García Fernández")).toBe(false);
    expect(isExcludedLabel("Admisión General")).toBe(false);
  });

  it("does not exclude an ALL-CAPS label with a long numeric department name", () => {
    // >3 words + contains a digit is treated as a real label, not noise
    expect(isExcludedLabel("PLANTA 4 NORTE MEDICINA INTERNA")).toBe(false);
  });
});

describe("isMeaningfulServiceLabel", () => {
  const isExcludedLabelStub = (label: string) => label === "excluded";

  it("returns true for a normal label with letters", () => {
    expect(isMeaningfulServiceLabel("Admisión", isExcludedLabelStub)).toBe(true);
  });

  it("returns false for a label with no letters", () => {
    expect(isMeaningfulServiceLabel("12345", isExcludedLabelStub)).toBe(false);
  });

  it("returns false when the excluded-label predicate matches", () => {
    expect(isMeaningfulServiceLabel("excluded", isExcludedLabelStub)).toBe(false);
  });

  it("returns false for a value that looks like a date", () => {
    expect(isMeaningfulServiceLabel("25/12/2024", isExcludedLabelStub)).toBe(false);
  });

  it("returns false for a value starting with a digit", () => {
    expect(isMeaningfulServiceLabel("1 Admisión", isExcludedLabelStub)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isMeaningfulServiceLabel("", isExcludedLabelStub)).toBe(false);
  });
});

describe("prettifyLabel", () => {
  it("replaces underscores and hyphens with spaces and title-cases", () => {
    expect(prettifyLabel("admision_general-planta")).toBe("Admision General Planta");
  });

  it("collapses whitespace after replacement", () => {
    expect(prettifyLabel("hola   mundo")).toBe("Hola Mundo");
  });
});

describe("inferAreaFromLabel", () => {
  it("infers 'sanitaria-asistencial' for clinical-care labels", () => {
    expect(inferAreaFromLabel("Urgencias")).toBe("sanitaria-asistencial");
    expect(inferAreaFromLabel("UCI Planta 3")).toBe("sanitaria-asistencial");
  });

  it("infers 'gestion-administracion' for admin labels", () => {
    expect(inferAreaFromLabel("Admisión")).toBe("gestion-administracion");
    expect(inferAreaFromLabel("Secretaría")).toBe("gestion-administracion");
  });

  it("infers 'especialidades' for outpatient/specialty labels", () => {
    expect(inferAreaFromLabel("Consultas Externas")).toBe("especialidades");
  });

  it("returns undefined when no known pattern matches", () => {
    expect(inferAreaFromLabel("Cafetería")).toBeUndefined();
  });
});
