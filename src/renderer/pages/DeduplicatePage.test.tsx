import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { DeduplicatePage } from "./DeduplicatePage";

const mockPair = {
  id: "cnt_0001:cnt_0002",
  recordA: {
    id: "cnt_0001",
    type: "service" as const,
    displayName: "Admisión General",
    organization: { department: "Admisión", area: "gestion-administracion" as const },
    contactMethods: {
      phones: [{ id: "ph_1", number: "70005", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
      emails: []
    },
    aliases: [],
    tags: ["admisión"],
    status: "active" as const,
    audit: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "System", updatedBy: "System" }
  },
  recordB: {
    id: "cnt_0002",
    type: "service" as const,
    displayName: "Admisión General",
    organization: { department: "Admisión", area: "gestion-administracion" as const },
    contactMethods: {
      phones: [{ id: "ph_2", number: "70006", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
      emails: []
    },
    aliases: [],
    tags: [],
    status: "active" as const,
    audit: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "System", updatedBy: "System" }
  },
  reasons: ["displayName"],
  score: 0.9
};

const mockDetectDuplicates = vi.fn().mockResolvedValue({
  pairs: [mockPair],
  checkedCount: 2,
  pairCount: 1
});

const mockMergeContacts = vi.fn().mockResolvedValue(mockPair.recordA);

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

  it("enables Fusionar button after selecting Conservar este on one side", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    expect(screen.queryByRole("button", { name: "Fusionar" })).not.toBeInTheDocument();

    const keepButtons = screen.getAllByRole("button", { name: "Conservar este" });
    fireEvent.click(keepButtons[0]!);

    expect(await screen.findByRole("button", { name: "Fusionar" })).toBeInTheDocument();
  });

  it("calls mergeContacts with correct args and removes the pair from the list", async () => {
    renderPage();

    await screen.findAllByText("Admisión General");

    const keepButtons = screen.getAllByRole("button", { name: "Conservar este" });
    fireEvent.click(keepButtons[0]!);

    const mergeButton = await screen.findByRole("button", { name: "Fusionar" });
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(mockMergeContacts).toHaveBeenCalledWith({
        keepId: mockPair.recordA.id,
        discardId: mockPair.recordB.id
      });
    });

    await waitFor(() => {
      expect(screen.queryAllByText("Admisión General")).toHaveLength(0);
    });

    expect(await screen.findByText("No se encontraron duplicados")).toBeInTheDocument();
  });
});
