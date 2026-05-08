import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogResult } from "../../shared/types/contact";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { AuditLogPage } from "./AuditLogPage";

const mockGetAuditLog = vi.fn();
const mockExportAuditLog = vi.fn();

const emptyResult: AuditLogResult = { entries: [], totalCount: 0 };

beforeEach(() => {
  Object.defineProperty(window, "hospitalDirectory", {
    configurable: true,
    value: {
      getAuditLog: mockGetAuditLog,
      exportAuditLog: mockExportAuditLog
    }
  });
  mockGetAuditLog.mockResolvedValue(emptyResult);
  mockExportAuditLog.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    </ToastProvider>
  );

describe("AuditLogPage", () => {
  it("shows empty state when audit log has no entries", async () => {
    mockGetAuditLog.mockResolvedValue(emptyResult);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/El registro de auditoría está vacío/i)).toBeTruthy();
    });
  });

  it("renders audit entries with action badges", async () => {
    const result: AuditLogResult = {
      entries: [
        {
          timestamp: "2026-05-01T10:00:00.000Z",
          editor: "Dr. Smith",
          action: "create",
          recordId: "cnt_001",
          recordName: "Admisión General"
        },
        {
          timestamp: "2026-05-01T11:00:00.000Z",
          editor: "Admin",
          action: "bulk-import",
          recordsAffected: 50,
          importSource: "staff-list.csv"
        }
      ],
      totalCount: 2
    };
    mockGetAuditLog.mockResolvedValue(result);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Admisión General")).toBeTruthy();
      // Action badge (there are also option elements in the select, so use getAllByText)
      expect(screen.getAllByText("Alta").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Importación masiva").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("staff-list.csv")).toBeTruthy();
    });
  });

  it("shows 'Ver cambios' button for update entries with changes", async () => {
    const result: AuditLogResult = {
      entries: [
        {
          timestamp: "2026-05-01T12:00:00.000Z",
          editor: "Dr. Smith",
          action: "update",
          recordId: "cnt_001",
          recordName: "John Doe",
          changes: {
            "organization.department": { old: "Cardiology", new: "Neurology" }
          }
        }
      ],
      totalCount: 1
    };
    mockGetAuditLog.mockResolvedValue(result);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ver cambios")).toBeTruthy();
    });
  });

  it("expands change details when clicking 'Ver cambios'", async () => {
    const result: AuditLogResult = {
      entries: [
        {
          timestamp: "2026-05-01T12:00:00.000Z",
          editor: "Dr. Smith",
          action: "update",
          recordId: "cnt_001",
          recordName: "John Doe",
          changes: {
            "organization.department": { old: "Cardiology", new: "Neurology" }
          }
        }
      ],
      totalCount: 1
    };
    mockGetAuditLog.mockResolvedValue(result);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Ver cambios")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Ver cambios"));

    await waitFor(() => {
      expect(screen.getByText("organization.department")).toBeTruthy();
      expect(screen.getByText("Cardiology")).toBeTruthy();
      expect(screen.getByText("Neurology")).toBeTruthy();
    });
  });

  it("applies filters and re-fetches on button click", async () => {
    mockGetAuditLog.mockResolvedValue(emptyResult);
    renderPage();

    await waitFor(() => {
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
    });

    const editorInput = screen.getByPlaceholderText("Nombre del editor");
    fireEvent.change(editorInput, { target: { value: "Smith" } });
    fireEvent.click(screen.getByText("Aplicar filtros"));

    await waitFor(() => {
      expect(mockGetAuditLog).toHaveBeenCalledTimes(2);
      expect(mockGetAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ editor: "Smith" })
      );
    });
  });
});
