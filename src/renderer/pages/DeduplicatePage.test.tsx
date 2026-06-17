import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { DeduplicatePage } from "./DeduplicatePage";

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

const mockDetectDuplicates = vi.fn().mockResolvedValue({
  pairs: [mockPair],
  records: { cnt_0001: recordA, cnt_0002: recordB },
  checkedCount: 2,
  pairCount: 1
});

const mockMergeContacts = vi.fn().mockResolvedValue({
  id: "cnt_0001",
  displayName: "Admisión General",
  department: "Admisión",
  phones: []
});

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
  });

  it("renders the duplicate pair with both displayNames", async () => {
    renderPage();

    expect(await screen.findAllByText("Admisión General")).toHaveLength(2);
    expect(screen.getByText("Similitud 90%")).toBeInTheDocument();
    expect(screen.getByText("displayName")).toBeInTheDocument();
  });

  it("renders department and phone number for each record", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    // Both records share the same department label
    const deptEls = screen.getAllByText("Admisión");
    expect(deptEls.length).toBeGreaterThanOrEqual(2);

    // Phone numbers from the flat phones array
    expect(screen.getByText("70005")).toBeInTheDocument();
    expect(screen.getByText("70006")).toBeInTheDocument();
  });

  it("enables Fusionar button after selecting Conservar este on one side", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    expect(screen.queryByRole("button", { name: "Fusionar" })).not.toBeInTheDocument();

    const keepButtons = screen.getAllByRole("button", { name: "Conservar este" });
    fireEvent.click(keepButtons[0]!);

    expect(await screen.findByRole("button", { name: "Fusionar" })).toBeInTheDocument();
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
});
