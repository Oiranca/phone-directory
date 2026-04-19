import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ContactFormPage } from "./ContactFormPage";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { useAppStore } from "../store/useAppStore";

const resetStore = () => {
  useAppStore.setState({
    contacts: null,
    settings: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    showInactive: false,
    isLoading: true
  });
};

const editableSettings = {
  editorName: "Samuel",
  ui: {
    showInactiveByDefault: false
  }
};

const renderWithRoute = (initialEntry: string) => {
  const router = createMemoryRouter(
    [
      { path: "/", element: <div>Directorio</div> },
      { path: "/contacts/new", element: <ContactFormPage /> },
      { path: "/contacts/:id/edit", element: <ContactFormPage /> }
    ],
    { initialEntries: [initialEntry] }
  );

  render(<RouterProvider router={router} />);
  return router;
};

describe("ContactFormPage", () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({
          contacts: defaultContacts,
          settings: editableSettings
        }),
        saveSettings: vi.fn(),
        createBackup: vi.fn(),
        createRecord: vi.fn().mockResolvedValue({
          contacts: defaultContacts,
          settings: editableSettings,
          savedRecordId: "cnt_0009"
        }),
        updateRecord: vi.fn().mockResolvedValue({
          contacts: defaultContacts,
          settings: editableSettings,
          savedRecordId: defaultContacts.records[0].id
        })
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a new record from the dedicated form", async () => {
    const router = renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre visible"), {
      target: { value: "Nuevo Control" }
    });
    fireEvent.change(screen.getByLabelText("Número"), {
      target: { value: "112233" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createRecord).toHaveBeenCalledTimes(1);
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("preserves directory search state after saving", async () => {
    useAppStore.setState({
      contacts: defaultContacts,
      settings: editableSettings,
      selectedRecordId: defaultContacts.records[0].id,
      query: "admisión",
      selectedType: "service",
      selectedArea: "gestion-administracion",
      showInactive: true,
      isLoading: false
    });

    const router = renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre visible"), {
      target: { value: "Nuevo Control" }
    });
    fireEvent.change(screen.getByLabelText("Número"), {
      target: { value: "112233" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createRecord).toHaveBeenCalledTimes(1);
    });

    expect(router.state.location.pathname).toBe("/");
    expect(useAppStore.getState().query).toBe("admisión");
    expect(useAppStore.getState().selectedType).toBe("service");
    expect(useAppStore.getState().selectedArea).toBe("gestion-administracion");
    expect(useAppStore.getState().showInactive).toBe(true);
  });

  it("shows Spanish validation feedback when the form is invalid", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre visible"), {
      target: { value: "" }
    });
    fireEvent.change(screen.getByLabelText("Número"), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

    expect(await screen.findByText("Revisa los campos marcados antes de guardar.")).toBeInTheDocument();
    expect(screen.getByText("El nombre visible es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("El teléfono es obligatorio.")).toBeInTheDocument();
    expect(window.hospitalDirectory.createRecord).not.toHaveBeenCalled();
  });

  it("loads the existing record when editing", async () => {
    renderWithRoute(`/contacts/${defaultContacts.records[0].id}/edit`);

    expect(await screen.findByDisplayValue(defaultContacts.records[0].displayName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
  });

  it("updates an existing record from the edit route", async () => {
    const router = renderWithRoute(`/contacts/${defaultContacts.records[0].id}/edit`);

    expect(await screen.findByDisplayValue(defaultContacts.records[0].displayName)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre visible"), {
      target: { value: "Admisión actualizada" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.updateRecord).toHaveBeenCalledTimes(1);
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps one primary phone when the current primary is unchecked", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir teléfono" }));

    const primaryCheckboxes = screen.getAllByRole("checkbox", { name: "Principal" });
    fireEvent.click(primaryCheckboxes[0]!);

    expect(primaryCheckboxes[0]).not.toBeChecked();
    expect(primaryCheckboxes[1]).toBeChecked();
  });

  it("shows recovery actions when bootstrap loading fails", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("broken file"));

    renderWithRoute("/contacts/new");

    expect(await screen.findByText("No se pudo abrir el formulario")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al directorio" })).toBeInTheDocument();
  });
});
