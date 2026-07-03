import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { buildStorageKey, DeduplicatePage } from "./DeduplicatePage";
import { useAppStore } from "../store/useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { defaultSettings } from "../../shared/fixtures/defaultSettings";

// Stub HTMLDialogElement.showModal/close since jsdom does not implement them
let dialogPrototype: (HTMLElement & { showModal?: () => void; close?: () => void }) | undefined;
let originalShowModal: (() => void) | undefined;
let originalClose: (() => void) | undefined;

beforeAll(() => {
  if (typeof globalThis.HTMLDialogElement === "undefined") {
    class HTMLDialogElementStub extends HTMLElement {
      open = false;
    }
    vi.stubGlobal("HTMLDialogElement", HTMLDialogElementStub);
  }

  dialogPrototype =
    typeof globalThis.HTMLDialogElement !== "undefined"
      ? globalThis.HTMLDialogElement.prototype
      : HTMLElement.prototype;

  originalShowModal = dialogPrototype.showModal;
  originalClose = dialogPrototype.close;

  dialogPrototype.showModal = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = true;
  });
  dialogPrototype.close = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = false;
  });
});

afterAll(() => {
  if (dialogPrototype) {
    dialogPrototype.showModal = originalShowModal;
    dialogPrototype.close = originalClose;
  }
});

// DuplicateRecordSummary shape — only fields DeduplicatePage renders
const recordA = {
  id: "cnt_0001",
  displayName: "Admisión General",
  department: "Admisión",
  phones: [{ id: "ph_1", number: "70005" }]
};

const recordB = {
  id: "cnt_0002",
  displayName: "Admisión General",
  department: "Admisión",
  phones: [{ id: "ph_2", number: "70006" }]
};

const mockPair = {
  id: "cnt_0001:cnt_0002",
  recordA,
  recordB,
  reasons: ["displayName"],
  score: 0.9
};

const survivorRecord = {
  ...defaultContacts.records[0]!,
  id: "cnt_0001",
  displayName: "Admisión General (fusionado)"
};

const mockDetectDuplicates = vi.fn().mockResolvedValue({
  pairs: [mockPair],
  records: { cnt_0001: recordA, cnt_0002: recordB },
  checkedCount: 2,
  pairCount: 1
});

const mockMergeContacts = vi.fn().mockResolvedValue(survivorRecord);

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <DeduplicatePage />
      </MemoryRouter>
    </ToastProvider>
  );

describe("DeduplicatePage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        detectDuplicates: mockDetectDuplicates,
        mergeContacts: mockMergeContacts
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders the duplicate pair with both displayNames", async () => {
    renderPage();

    expect(await screen.findAllByText("Admisión General")).toHaveLength(2);
    expect(screen.getByText("Similitud 90%")).toBeInTheDocument();
    expect(screen.getByText("Nombre idéntico")).toBeInTheDocument();
  });

  it("renders department and phone number for each record", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    // Both records share the same department label
    const deptEls = screen.getAllByText("Admisión");
    // Tightened: exactly 2 records in pair, each with same department.
    expect(deptEls).toHaveLength(2);

    // Phone numbers from the flat phones array
    expect(screen.getByText("70005")).toBeInTheDocument();
    expect(screen.getByText("70006")).toBeInTheDocument();
  });

  it("enables Fusionar button after selecting Conservar este on one side", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    expect(screen.queryByRole("button", { name: "Fusionar" })).not.toBeInTheDocument();

    const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
    fireEvent.click(keepButtons[0]!);

    expect(await screen.findByRole("button", { name: "Fusionar" })).toBeInTheDocument();
  });

  describe("OIR-189 P3 follow-up — distinct accessible names for 'Conservar' radios (Finding C)", () => {
    it("gives the two 'Conservar' radios distinct accessible names even when displayName matches", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      expect(keepButtons).toHaveLength(2);

      const names = keepButtons.map((btn) => btn.getAttribute("aria-label"));
      expect(names[0]).not.toEqual(names[1]);
      // Both must still start with "Conservar" so existing /Conservar/ queries keep matching
      expect(names[0]).toMatch(/^Conservar/);
      expect(names[1]).toMatch(/^Conservar/);
    });

    it("falls back to an ordinal suffix when department and phone are also identical", async () => {
      const identicalRecordA = {
        id: "cnt_0021",
        displayName: "Recepción",
        department: "Recepción",
        phones: [{ id: "ph_21", number: "70099" }]
      };
      const identicalRecordB = {
        id: "cnt_0022",
        displayName: "Recepción",
        department: "Recepción",
        phones: [{ id: "ph_22", number: "70099" }]
      };

      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockResolvedValue({
            pairs: [{
              id: "cnt_0021:cnt_0022",
              recordA: identicalRecordA,
              recordB: identicalRecordB,
              reasons: ["displayName"],
              score: 0.95
            }],
            records: { cnt_0021: identicalRecordA, cnt_0022: identicalRecordB },
            checkedCount: 2,
            pairCount: 1
          }),
          mergeContacts: mockMergeContacts
        }
      });

      renderPage();
      await screen.findAllByText("Recepción");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      const names = keepButtons.map((btn) => btn.getAttribute("aria-label"));
      expect(names[0]).not.toEqual(names[1]);
      expect(names[0]).toMatch(/opción 1 de 2/);
      expect(names[1]).toMatch(/opción 2 de 2/);
    });
  });

  describe("OIR-189 P2 follow-up — radiogroup arrow-key navigation (roving tabindex)", () => {
    it("ArrowDown moves focus and selection from the first radio to the second", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      keepButtons[0]!.focus();
      fireEvent.keyDown(keepButtons[0]!, { key: "ArrowDown" });

      expect(keepButtons[1]).toHaveAttribute("aria-checked", "true");
      expect(keepButtons[0]).toHaveAttribute("aria-checked", "false");
      await waitFor(() => expect(keepButtons[1]).toHaveFocus());
    });

    it("ArrowDown wraps from the last radio back to the first", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      keepButtons[1]!.focus();
      fireEvent.keyDown(keepButtons[1]!, { key: "ArrowDown" });

      expect(keepButtons[0]).toHaveAttribute("aria-checked", "true");
      await waitFor(() => expect(keepButtons[0]).toHaveFocus());
    });

    it("ArrowUp wraps from the first radio to the last", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      keepButtons[0]!.focus();
      fireEvent.keyDown(keepButtons[0]!, { key: "ArrowUp" });

      expect(keepButtons[1]).toHaveAttribute("aria-checked", "true");
      await waitFor(() => expect(keepButtons[1]).toHaveFocus());
    });

    it("only the roving tab stop has tabIndex 0 — the first radio before any selection", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      expect(keepButtons[0]).toHaveAttribute("tabindex", "0");
      expect(keepButtons[1]).toHaveAttribute("tabindex", "-1");
    });

    it("moves the roving tab stop to the checked radio after selection", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[1]!);

      expect(keepButtons[1]).toHaveAttribute("tabindex", "0");
      expect(keepButtons[0]).toHaveAttribute("tabindex", "-1");
    });
  });

  it("shows empty state when no pairs returned", async () => {
    mockDetectDuplicates.mockResolvedValueOnce({
      pairs: [],
      records: {},
      checkedCount: 5,
      pairCount: 0
    });

    renderPage();

    expect(await screen.findByText("No se encontraron duplicados")).toBeInTheDocument();
  });

  describe("merge store reconciliation — merge succeeds + refresh succeeds", () => {
    const pairsResult = {
      pairs: [mockPair],
      records: { cnt_0001: recordA, cnt_0002: recordB },
      checkedCount: 2,
      pairCount: 1
    };
    const emptyResult = { pairs: [], records: {}, checkedCount: 2, pairCount: 0 };

    beforeEach(() => {
      // Seed the store with both records so we can assert changes after merge
      useAppStore.setState({
        contacts: {
          ...defaultContacts,
          records: [
            { ...defaultContacts.records[0]!, id: "cnt_0001", displayName: "Admisión General" },
            { ...defaultContacts.records[1]!, id: "cnt_0002", displayName: "Admisión General" }
          ]
        },
        selectedRecordId: "cnt_0001"
      });
      // Override detectDuplicates for this block: first call returns pair, second returns empty
      let callCount = 0;
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockImplementation(() => {
            callCount += 1;
            return Promise.resolve(callCount === 1 ? pairsResult : emptyResult);
          }),
          mergeContacts: mockMergeContacts
        }
      });
    });

    const triggerMerge = async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      // Select record to keep
      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      // Open confirm dialog (page-level Fusionar button)
      fireEvent.click(await screen.findByRole("button", { name: "Fusionar" }));

      // Confirm the merge — at this point both buttons are in the DOM;
      // the dialog confirm button has a destructive style class
      const allFusionar = await screen.findAllByRole("button", { name: "Fusionar" });
      const dialogConfirm = allFusionar[allFusionar.length - 1]!;
      fireEvent.click(dialogConfirm);
    };

    it("removes the discarded record from the store after a successful merge", async () => {
      await triggerMerge();
      await waitFor(() => {
        const records = useAppStore.getState().contacts?.records ?? [];
        expect(records.find((r) => r.id === "cnt_0002")).toBeUndefined();
      });
    });

    it("updates the survivor record in the store with the returned merged fields", async () => {
      await triggerMerge();
      await waitFor(() => {
        const records = useAppStore.getState().contacts?.records ?? [];
        const survivor = records.find((r) => r.id === "cnt_0001");
        expect(survivor).toBeDefined();
        expect(survivor!.displayName).toBe("Admisión General (fusionado)");
      });
    });

    it("shows success toast after merge", async () => {
      await triggerMerge();
      expect(await screen.findByText("Duplicado fusionado correctamente")).toBeInTheDocument();
    });
  });

  describe("merge store reconciliation — merge succeeds + refresh fails (graceful degradation)", () => {
    beforeEach(() => {
      // Seed the store with both records
      useAppStore.setState({
        contacts: {
          ...defaultContacts,
          records: [
            { ...defaultContacts.records[0]!, id: "cnt_0001", displayName: "Admisión General" },
            { ...defaultContacts.records[1]!, id: "cnt_0002", displayName: "Admisión General" }
          ]
        },
        selectedRecordId: "cnt_0001"
      });
      // detectDuplicates: first call (initial load) returns the pair; second call (refresh after
      // merge) rejects to simulate a transient network/IPC failure
      let callCount = 0;
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockImplementation(() => {
            callCount += 1;
            if (callCount === 1) {
              return Promise.resolve({
                pairs: [mockPair],
                records: { cnt_0001: recordA, cnt_0002: recordB },
                checkedCount: 2,
                pairCount: 1
              });
            }
            return Promise.reject(new Error("detectDuplicates failed"));
          }),
          mergeContacts: mockMergeContacts
        }
      });
    });

    const triggerMerge = async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      fireEvent.click(await screen.findByRole("button", { name: "Fusionar" }));

      const allFusionar = await screen.findAllByRole("button", { name: "Fusionar" });
      fireEvent.click(allFusionar[allFusionar.length - 1]!);
    };

    it("shows the success toast (not a merge-failure error) when refresh fails", async () => {
      await triggerMerge();
      // Success toast must appear
      expect(await screen.findByText("Duplicado fusionado correctamente")).toBeInTheDocument();
      // Merge-failure error message must NOT appear
      expect(screen.queryByText(/No se pudo fusionar/)).not.toBeInTheDocument();
    });

    it("shows the warning toast and preserves the pair in the UI when refresh fails (OIR-134: no optimistic filter)", async () => {
      await triggerMerge();
      // Success toast must appear first (merge committed before refresh was attempted)
      expect(await screen.findByText("Duplicado fusionado correctamente")).toBeInTheDocument();
      // The non-fatal warning toast signals that graceful degradation fired
      expect(
        await screen.findByText(/La fusión se completó, pero la lista no pudo actualizarse/)
      ).toBeInTheDocument();
      // OIR-134: the optimistic filter was removed to avoid a misleading partial state.
      // The pair remains visible in the UI; the operator must reload to see the updated list.
      // (The warning toast instructs them to do so.)
      expect(screen.queryByText("Similitud 90%")).toBeInTheDocument();
    });

    it("keeps the store reconciled (survivor upserted, discard removed) when refresh fails", async () => {
      await triggerMerge();
      await waitFor(() => {
        const records = useAppStore.getState().contacts?.records ?? [];
        expect(records.find((r) => r.id === "cnt_0002")).toBeUndefined();
        const survivor = records.find((r) => r.id === "cnt_0001");
        expect(survivor).toBeDefined();
        expect(survivor!.displayName).toBe("Admisión General (fusionado)");
      });
    });
  });

  describe("dismiss pair", () => {
    const recordC = {
      id: "cnt_0003",
      displayName: "Urgencias Generales",
      department: "Urgencias",
      phones: [{ id: "ph_3", number: "70007" }]
    };

    const recordD = {
      id: "cnt_0004",
      displayName: "Urgencias Generales",
      department: "Urgencias",
      phones: [{ id: "ph_4", number: "70008" }]
    };

    const mockPair2 = {
      id: "cnt_0003:cnt_0004",
      recordA: recordC,
      recordB: recordD,
      reasons: ["displayName"],
      score: 0.85
    };

    const twoPairsResult = {
      pairs: [mockPair, mockPair2],
      records: {
        cnt_0001: recordA,
        cnt_0002: recordB,
        cnt_0003: recordC,
        cnt_0004: recordD
      },
      checkedCount: 4,
      pairCount: 2
    };

    beforeEach(() => {
      localStorage.clear();
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockResolvedValue(twoPairsResult),
          mergeContacts: mockMergeContacts
        }
      });
    });

    it("clicking dismiss removes the pair from the UI and keeps the other pair visible", async () => {
      renderPage();
      await screen.findByText("Similitud 90%");
      expect(screen.getByText("Similitud 85%")).toBeInTheDocument();

      const dismissButtons = screen.getAllByRole("button", {
        name: /No son el mismo contacto:/
      });
      fireEvent.click(dismissButtons[0]!);

      await waitFor(() => {
        expect(screen.queryByText("Similitud 90%")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Similitud 85%")).toBeInTheDocument();
    });

    it("persists the dismissed pair id to the scoped localStorage key", async () => {
      renderPage();
      await screen.findByText("Similitud 90%");

      const dismissButtons = screen.getAllByRole("button", {
        name: /No son el mismo contacto:/
      });
      fireEvent.click(dismissButtons[0]!);

      // When store has no settings (dataFilePath = null), buildStorageKey falls back to
      // the bare prefix — same as the pre-scoping global key, keeping backward compat.
      const key = buildStorageKey(null);
      await waitFor(() => {
        const dismissed = JSON.parse(localStorage.getItem(key) || "[]") as string[];
        expect(dismissed).toContain(mockPair.id);
      });
    });

    it("treats a malformed dismissed-pairs value as empty and does not throw", async () => {
      localStorage.setItem(buildStorageKey(null), "this is not json{{{");

      // Rendering must not throw; both pairs must be visible (malformed = empty dismissed list)
      renderPage();
      expect(await screen.findByText("Similitud 90%")).toBeInTheDocument();
      expect(screen.getByText("Similitud 85%")).toBeInTheDocument();
    });

    it("does not throw when localStorage.setItem throws on dismiss", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

      renderPage();
      await screen.findByText("Similitud 90%");

      const dismissButtons = screen.getAllByRole("button", {
        name: /No son el mismo contacto:/
      });
      // Clicking dismiss must not throw even when localStorage.setItem fails
      expect(() => fireEvent.click(dismissButtons[0]!)).not.toThrow();

      setItemSpy.mockRestore();
    });

    it("does not re-show a dismissed pair after remount with the same data", async () => {
      const { unmount } = renderPage();
      await screen.findByText("Similitud 90%");

      const dismissButtons = screen.getAllByRole("button", {
        name: /No son el mismo contacto:/
      });
      fireEvent.click(dismissButtons[0]!);

      await waitFor(() => {
        expect(screen.queryByText("Similitud 90%")).not.toBeInTheDocument();
      });

      unmount();

      // Re-mount: IPC still returns both pairs, but dismissed pair must be filtered
      renderPage();
      await screen.findByText("Similitud 85%");
      expect(screen.queryByText("Similitud 90%")).not.toBeInTheDocument();
    });
  });

  describe("dismiss pair scoping — different datasets do not share dismissals", () => {
    const pathA = "/data/hospital-a/contacts.json";
    const pathB = "/data/hospital-b/contacts.json";

    const twoPairsResult = {
      pairs: [mockPair],
      records: { cnt_0001: recordA, cnt_0002: recordB },
      checkedCount: 2,
      pairCount: 1
    };

    beforeEach(() => {
      localStorage.clear();
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockResolvedValue(twoPairsResult),
          mergeContacts: mockMergeContacts
        }
      });
    });

    it("a pair dismissed under dataset-A key does not disappear when dataset-B is active", async () => {
      // Step 1: mount under dataset A and dismiss the pair
      useAppStore.setState({ settings: { ...defaultSettings(pathA, "/backups") } });
      const { unmount } = renderPage();
      await screen.findByText("Similitud 90%");

      const dismissButtons = screen.getAllByRole("button", {
        name: /No son el mismo contacto:/
      });
      fireEvent.click(dismissButtons[0]!);

      await waitFor(() => {
        expect(screen.queryByText("Similitud 90%")).not.toBeInTheDocument();
      });

      // Confirm that the dismissal was written to the A-scoped key
      const keyA = buildStorageKey(pathA);
      const dismissedA = JSON.parse(localStorage.getItem(keyA) || "[]") as string[];
      expect(dismissedA).toContain(mockPair.id);

      unmount();

      // Step 2: switch to dataset B — pair must be visible again
      useAppStore.setState({ settings: { ...defaultSettings(pathB, "/backups") } });

      renderPage();
      expect(await screen.findByText("Similitud 90%")).toBeInTheDocument();

      // B-scoped key must be empty
      const keyB = buildStorageKey(pathB);
      const dismissedB = JSON.parse(localStorage.getItem(keyB) || "[]") as string[];
      expect(dismissedB).toHaveLength(0);
    });
  });

  describe("merge failure rollback", () => {
    // Fresh isolated mock declared at describe scope so it-callbacks can override it
    let mergeContactsMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mergeContactsMock = vi.fn().mockResolvedValue(survivorRecord);
      useAppStore.setState({
        contacts: {
          ...defaultContacts,
          records: [
            { ...defaultContacts.records[0]!, id: "cnt_0001", displayName: "Admisión General" },
            { ...defaultContacts.records[1]!, id: "cnt_0002", displayName: "Admisión General" }
          ]
        },
        selectedRecordId: "cnt_0001"
      });
      // Use fresh mocks for explicit isolation within this describe block
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockResolvedValue({
            pairs: [mockPair],
            records: { cnt_0001: recordA, cnt_0002: recordB },
            checkedCount: 2,
            pairCount: 1
          }),
          mergeContacts: mergeContactsMock
        }
      });
    });

    it("leaves the store unchanged when the merge IPC rejects", async () => {
      mergeContactsMock.mockRejectedValueOnce(new Error("merge failed"));

      renderPage();
      await screen.findAllByText("Admisión General");

      const recordsBefore = useAppStore.getState().contacts!.records.map((r) => r.id);

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      // Open confirm dialog
      fireEvent.click(await screen.findByRole("button", { name: "Fusionar" }));

      // Click dialog confirm
      const allFusionar = await screen.findAllByRole("button", { name: "Fusionar" });
      fireEvent.click(allFusionar[allFusionar.length - 1]!);

      await waitFor(() => {
        expect(screen.getByText("merge failed")).toBeInTheDocument();
      });

      const recordsAfter = useAppStore.getState().contacts!.records.map((r) => r.id);
      expect(recordsAfter).toEqual(recordsBefore);
    });

    it("shows merge-failure error toast and does NOT remove the pair from the UI when merge IPC rejects", async () => {
      mergeContactsMock.mockRejectedValueOnce(new Error("merge failed"));

      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      fireEvent.click(await screen.findByRole("button", { name: "Fusionar" }));

      const allFusionar = await screen.findAllByRole("button", { name: "Fusionar" });
      fireEvent.click(allFusionar[allFusionar.length - 1]!);

      // Error toast with the IPC message must appear
      await waitFor(() => {
        expect(screen.getByText("merge failed")).toBeInTheDocument();
      });

      // The pair must still be in the list (pair was NOT removed on failure)
      expect(screen.getByText("Similitud 90%")).toBeInTheDocument();

      // Success toast must NOT appear
      expect(screen.queryByText("Duplicado fusionado correctamente")).not.toBeInTheDocument();
    });
  });

  // ── OIR-183 P1 fixes ─────────────────────────────────────────────────────────

  describe("OIR-183 Fix 1 — Fusionar button uses amber/warning styling, not primary blue", () => {
    it("Fusionar button has amber background class after selecting a record", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      const mergeBtn = await screen.findByRole("button", { name: /Fusionar/ });
      expect(mergeBtn).toHaveClass("bg-amber-500");
      expect(mergeBtn).not.toHaveClass("bg-scs-blue");
    });

    it("Fusionar button contains an aria-hidden warning icon svg", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      const mergeBtn = await screen.findByRole("button", { name: /Fusionar/ });
      const icon = mergeBtn.querySelector('svg[aria-hidden="true"]');
      expect(icon).not.toBeNull();
    });
  });

  describe("OIR-183 Fix 2 — ConfirmDialog explicitly names the contact being deleted", () => {
    it("dialog message contains 'Se eliminará el contacto' and the discard record name", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      fireEvent.click(await screen.findByRole("button", { name: /Fusionar/ }));

      // The dialog message must explicitly state which contact is being eliminated
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Se eliminará el contacto");
      // The discard record's displayName (recordB since we kept recordA) must appear
      expect(dialog).toHaveTextContent("Admisión General");
    });

    it("dialog message does not use the ambiguous phrasing '¿Fusionar' alone", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      fireEvent.click(await screen.findByRole("button", { name: /Fusionar/ }));

      const dialog = await screen.findByRole("dialog");
      // Old ambiguous message started with "¿Fusionar" — must not be present
      expect(dialog).not.toHaveTextContent("¿Fusionar");
    });
  });

  describe("OIR-183 Fix 3 — Focus restore after dialog/merge", () => {
    it("page heading has tabIndex=-1 to allow programmatic focus after merge", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const heading = screen.getByRole("heading", { name: "Duplicados detectados" });
      expect(heading).toHaveAttribute("tabindex", "-1");
    });

    it("'Conservar este' buttons have data-keep-btn attribute for focus targeting", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      for (const btn of keepButtons) {
        expect(btn).toHaveAttribute("data-keep-btn");
      }
    });
  });

  describe("OIR-183 Fix 4 — Spinner during detectDuplicates", () => {
    it("shows aria-busy=true on the loading section", async () => {
      // Override detectDuplicates to never resolve so we can inspect loading state
      let resolve: (v: unknown) => void;
      const neverResolve = new Promise((r) => { resolve = r; });
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockReturnValue(neverResolve),
          mergeContacts: mockMergeContacts
        }
      });

      renderPage();

      const statusSection = screen.getByRole("status");
      expect(statusSection).toHaveAttribute("aria-busy", "true");

      // Cleanup: resolve the promise to avoid hanging
      resolve!({ pairs: [], records: {}, checkedCount: 0, pairCount: 0 });
    });

    it("shows the spinner svg with animate-spin class during loading", async () => {
      let resolve: (v: unknown) => void;
      const neverResolve = new Promise((r) => { resolve = r; });
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockReturnValue(neverResolve),
          mergeContacts: mockMergeContacts
        }
      });

      renderPage();

      const statusSection = screen.getByRole("status");
      const spinner = statusSection.querySelector('svg.animate-spin');
      expect(spinner).not.toBeNull();

      resolve!({ pairs: [], records: {}, checkedCount: 0, pairCount: 0 });
    });

    it("shows loading text 'Buscando duplicados…' while loading", async () => {
      let resolve: (v: unknown) => void;
      const neverResolve = new Promise((r) => { resolve = r; });
      Object.defineProperty(window, "hospitalDirectory", {
        configurable: true,
        value: {
          detectDuplicates: vi.fn().mockReturnValue(neverResolve),
          mergeContacts: mockMergeContacts
        }
      });

      renderPage();

      expect(screen.getByText("Buscando duplicados…")).toBeInTheDocument();

      resolve!({ pairs: [], records: {}, checkedCount: 0, pairCount: 0 });
    });
  });

  describe("OIR-183 Fix 5 — 'Conservar este' touch target ≥44px", () => {
    it("'Conservar este' buttons have min-h-[44px] class for WCAG 2.5.5", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      expect(keepButtons.length).toBeGreaterThan(0);
      for (const btn of keepButtons) {
        expect(btn).toHaveClass("min-h-[44px]");
      }
    });

    it("'Conservar este' buttons have min-w-[44px] class for WCAG 2.5.5", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      for (const btn of keepButtons) {
        expect(btn).toHaveClass("min-w-[44px]");
      }
    });
  });

  // ── End OIR-183 P1 fixes ────────────────────────────────────────────────────

  describe("merge loss preview — OIR-175", () => {
    it("does not show the preview panel before any keepId is selected", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      // No record selected yet — preview must not be visible
      expect(screen.queryByRole("note", { name: "Resumen de la fusión" })).not.toBeInTheDocument();
    });

    it("shows the preview panel after selecting a record to keep", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      expect(screen.getByRole("note", { name: "Resumen de la fusión" })).toBeInTheDocument();
    });

    it("shows the union-fields message once the preview is visible", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      expect(screen.getByText(/teléfonos, correos y etiquetas/)).toBeInTheDocument();
    });

    it("shows the static note about other fields once the preview is visible", async () => {
      renderPage();
      await screen.findAllByText("Admisión General");

      const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
      fireEvent.click(keepButtons[0]!);

      expect(screen.getByText(/notas/)).toBeInTheDocument();
    });

    describe("preview with field conflicts", () => {
      const recordWithDeptA = {
        id: "cnt_0011",
        displayName: "Dra. Martínez",
        department: "Cardiología",
        phones: [{ id: "ph_11", number: "600001111" }]
      };

      const recordWithDeptB = {
        id: "cnt_0012",
        displayName: "Dra. Martínez Ruiz",
        department: "UCI",
        phones: [
          { id: "ph_12a", number: "600001111" }, // duplicate
          { id: "ph_12b", number: "600002222" }  // unique
        ]
      };

      beforeEach(() => {
        Object.defineProperty(window, "hospitalDirectory", {
          configurable: true,
          value: {
            detectDuplicates: vi.fn().mockResolvedValue({
              pairs: [{
                id: "cnt_0011:cnt_0012",
                recordA: recordWithDeptA,
                recordB: recordWithDeptB,
                reasons: ["displayName"],
                score: 0.85
              }],
              records: { cnt_0011: recordWithDeptA, cnt_0012: recordWithDeptB },
              checkedCount: 2,
              pairCount: 1
            }),
            mergeContacts: mockMergeContacts
          }
        });
      });

      it("shows the department conflict when keeper and discard have different departments", async () => {
        renderPage();
        await screen.findByText("Dra. Martínez");

        // Select first record (Cardiología) as keeper
        const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
        fireEvent.click(keepButtons[0]!);

        // Scope to preview panel to avoid matching the record card's department text
        const preview = screen.getByRole("note", { name: "Resumen de la fusión" });
        expect(within(preview).getByText(/Departamento/)).toBeInTheDocument();
        expect(within(preview).getByText(/UCI/)).toBeInTheDocument();
      });

      it("shows the name conflict when keeper and discard have different displayNames", async () => {
        renderPage();
        await screen.findByText("Dra. Martínez");

        const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
        fireEvent.click(keepButtons[0]!);

        // Scope to preview panel to avoid matching the record card's name text
        const preview = screen.getByRole("note", { name: "Resumen de la fusión" });
        expect(within(preview).getByText(/Nombre/)).toBeInTheDocument();
        expect(within(preview).getByText(/Martínez Ruiz/)).toBeInTheDocument();
      });

      it("shows unique phone count from the discard record", async () => {
        renderPage();
        await screen.findByText("Dra. Martínez");

        const keepButtons = screen.getAllByRole("radio", { name: /Conservar/ });
        fireEvent.click(keepButtons[0]!);

        // Scope to preview panel to avoid matching phone numbers in the record cards
        const preview = screen.getByRole("note", { name: "Resumen de la fusión" });
        expect(within(preview).getByText(/1 teléfono/)).toBeInTheDocument();
        expect(within(preview).getByText(/600002222/)).toBeInTheDocument();
      });
    });
  });
});
