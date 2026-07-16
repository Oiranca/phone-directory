import { act, cleanup, render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./router";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";

//  /  — smoke test that the lazily-loaded routes (settings,
// deduplicate) still resolve and render their real page content through the
// Suspense boundary, not just the "Cargando…" fallback forever.

const editableSettings = {
  editorName: "Samuel",
  dataFilePath: "/tmp/data/contacts.json",
  backupDirectoryPath: "/tmp/backups",
  ui: {
    showInactiveByDefault: false,
    autoBackup: {
      enabled: false,
      trigger: "launch" as const,
      intervalHours: 2,
      editCountThreshold: 10,
      retentionCount: 5
    }
  }
};

const seedStoreAsBootstrapped = () => {
  resetBootstrapInFlight();
  useAppStore.setState({
    contacts: defaultContacts,
    settings: editableSettings,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    selectedTags: [],
    showInactive: false,
    isLoading: false,
    bootstrapStatus: "success",
    bootstrapError: "",
    bootstrapHelp: ""
  });
};

describe("router — lazy route smoke test", () => {
  beforeEach(() => {
    seedStoreAsBootstrapped();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({ contacts: defaultContacts, settings: editableSettings }),
        getSettingsDefaults: vi.fn().mockResolvedValue({
          editorName: "",
          dataFilePath: "/tmp/default-data/contacts.json",
          backupDirectoryPath: "/tmp/default-backups",
          ui: editableSettings.ui
        }),
        saveSettings: vi.fn(),
        listBackups: vi.fn().mockResolvedValue([]),
        createBackup: vi.fn(),
        detectDuplicates: vi.fn().mockResolvedValue({ pairs: [] }),
        mergeContacts: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    // Return the shared router instance to a known route so subsequent test
    // files/suites that happen to import it start from a clean slate.
    void router.navigate("/");
  });

  it("resolves the lazy settings route and renders SettingsPage content", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    // Index route (DirectoryPage) is eager — should be immediately available.
    expect(await screen.findByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/settings");
    });

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();
  });

  it("resolves the lazy deduplicate route and renders DeduplicatePage content", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    expect(await screen.findByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/deduplicate");
    });

    expect(await screen.findByText("No se encontraron duplicados")).toBeInTheDocument();
    expect(window.hospitalDirectory.detectDuplicates).toHaveBeenCalled();
  });
});
