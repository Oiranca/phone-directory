import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MergeLossPreview, computeMergeLossPreview } from "./MergeLossPreview";

afterEach(() => cleanup());

// ── Fixtures ────────────────────────────────────────────────────────────────

const keepRecord = {
  id: "cnt_0001",
  displayName: "María López",
  department: "Cardiología",
  phones: [{ id: "ph_1", number: "600001111" }]
};

const discardRecord = {
  id: "cnt_0002",
  displayName: "María López Sánchez",
  department: "UCI",
  phones: [
    { id: "ph_dup", number: "600001111" }, // duplicate — same last-9
    { id: "ph_new", number: "600002222" }  // unique
  ]
};

// ── computeMergeLossPreview ──────────────────────────────────────────────────

describe("computeMergeLossPreview — phonesAdded", () => {
  it("identifies phones from discard that are unique (not in keeper)", () => {
    const { phonesAdded } = computeMergeLossPreview(keepRecord, discardRecord);
    expect(phonesAdded).toHaveLength(1);
    expect(phonesAdded[0]!.number).toBe("600002222");
  });

  it("returns empty phonesAdded when discard has no unique phones", () => {
    const noUniqueDiscard = { ...discardRecord, phones: [{ id: "ph_dup", number: "600001111" }] };
    const { phonesAdded } = computeMergeLossPreview(keepRecord, noUniqueDiscard);
    expect(phonesAdded).toHaveLength(0);
  });

  it("returns all discard phones as added when keeper has no phones", () => {
    const noPhoneKeep = { ...keepRecord, phones: [] };
    const { phonesAdded } = computeMergeLossPreview(noPhoneKeep, discardRecord);
    expect(phonesAdded).toHaveLength(2);
  });

  it("deduplicates via last-9-digit normalisation (matching with punctuation)", () => {
    // Keeper has "600-001-111"; discard has "600001111" — same last 9 digits
    const punctuatedKeep = {
      ...keepRecord,
      phones: [{ id: "ph_1", number: "600-001-111" }]
    };
    const { phonesAdded } = computeMergeLossPreview(punctuatedKeep, discardRecord);
    // Only the truly unique one should remain
    expect(phonesAdded).toHaveLength(1);
    expect(phonesAdded[0]!.number).toBe("600002222");
  });
});

describe("computeMergeLossPreview — fieldConflicts (displayName)", () => {
  it("reports a Nombre conflict when keeper and discard have different displayNames", () => {
    const { fieldConflicts } = computeMergeLossPreview(keepRecord, discardRecord);
    const conflict = fieldConflicts.find((c) => c.field === "Nombre");
    expect(conflict).toBeDefined();
    expect(conflict!.discardValue).toBe("María López Sánchez");
    expect(conflict!.keepValue).toBe("María López");
  });

  it("does not report a Nombre conflict when displayNames are identical", () => {
    const sameNameDiscard = { ...discardRecord, displayName: "María López" };
    const { fieldConflicts } = computeMergeLossPreview(keepRecord, sameNameDiscard);
    expect(fieldConflicts.find((c) => c.field === "Nombre")).toBeUndefined();
  });

  it("does not report a Nombre conflict when keeper has no displayName", () => {
    const noNameKeep = { ...keepRecord, displayName: "" };
    const { fieldConflicts } = computeMergeLossPreview(noNameKeep, discardRecord);
    expect(fieldConflicts.find((c) => c.field === "Nombre")).toBeUndefined();
  });
});

describe("computeMergeLossPreview — fieldConflicts (department)", () => {
  it("reports a Departamento conflict when both have different departments", () => {
    const { fieldConflicts } = computeMergeLossPreview(keepRecord, discardRecord);
    const conflict = fieldConflicts.find((c) => c.field === "Departamento");
    expect(conflict).toBeDefined();
    expect(conflict!.discardValue).toBe("UCI");
    expect(conflict!.keepValue).toBe("Cardiología");
  });

  it("does not report a Departamento conflict when keeper has no department", () => {
    const noDeptKeep = { ...keepRecord, department: undefined };
    const { fieldConflicts } = computeMergeLossPreview(noDeptKeep, discardRecord);
    expect(fieldConflicts.find((c) => c.field === "Departamento")).toBeUndefined();
  });

  it("does not report a Departamento conflict when discard has no department", () => {
    const noDeptDiscard = { ...discardRecord, department: undefined };
    const { fieldConflicts } = computeMergeLossPreview(keepRecord, noDeptDiscard);
    expect(fieldConflicts.find((c) => c.field === "Departamento")).toBeUndefined();
  });

  it("does not report a Departamento conflict when both departments are the same", () => {
    const sameDeptDiscard = { ...discardRecord, department: "Cardiología" };
    const { fieldConflicts } = computeMergeLossPreview(keepRecord, sameDeptDiscard);
    expect(fieldConflicts.find((c) => c.field === "Departamento")).toBeUndefined();
  });
});

// ── MergeLossPreview component ───────────────────────────────────────────────

describe("MergeLossPreview — always-visible content", () => {
  it("renders the union info message (teléfonos, correos y etiquetas)", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/teléfonos, correos y etiquetas/)).toBeInTheDocument();
  });

  it("renders the static note about other fields (notas, ubicación)", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/notas/)).toBeInTheDocument();
    expect(screen.getByText(/ubicación/)).toBeInTheDocument();
  });

  it("renders with role=note and accessible label", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByRole("note", { name: "Resumen de la fusión" })).toBeInTheDocument();
  });
});

describe("MergeLossPreview — unique phones from discard", () => {
  it("shows the phone count when discard has unique phones", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/1 teléfono/)).toBeInTheDocument();
    expect(screen.getByText(/600002222/)).toBeInTheDocument();
  });

  it("shows plural when discard has multiple unique phones", () => {
    const multiPhoneDiscard = {
      ...discardRecord,
      phones: [
        { id: "ph_new1", number: "611111111" },
        { id: "ph_new2", number: "622222222" }
      ]
    };
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={multiPhoneDiscard} />);
    expect(screen.getByText(/2 teléfonos/)).toBeInTheDocument();
  });

  it("does not show phone addition text when there are no unique phones", () => {
    const dupeOnlyDiscard = { ...discardRecord, phones: [{ id: "ph_dup", number: "600001111" }] };
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={dupeOnlyDiscard} />);
    expect(screen.queryByText(/Se añadirán/)).not.toBeInTheDocument();
  });
});

describe("MergeLossPreview — field conflict display", () => {
  it("shows the lost field name when there is a Departamento conflict", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/Departamento/)).toBeInTheDocument();
    expect(screen.getByText(/UCI/)).toBeInTheDocument();
  });

  it("shows the lost field name when there is a Nombre conflict", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/Nombre/)).toBeInTheDocument();
    expect(screen.getByText(/María López Sánchez/)).toBeInTheDocument();
  });

  it("does not render the Se perderán section when there are no field conflicts", () => {
    const identicalDiscard = {
      ...discardRecord,
      displayName: "María López",
      department: "Cardiología"
    };
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={identicalDiscard} />);
    expect(screen.queryByText(/Se perderán/)).not.toBeInTheDocument();
  });

  it("shows the Se perderán section when there is at least one conflict", () => {
    render(<MergeLossPreview keepRecord={keepRecord} discardRecord={discardRecord} />);
    expect(screen.getByText(/Se perderán/)).toBeInTheDocument();
  });
});
