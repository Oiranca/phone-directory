import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ContactFormPage } from "./ContactFormPage";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";

const resetStore = () => {
  resetBootstrapInFlight();
  useAppStore.setState({
    contacts: null,
    settings: null,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    selectedTags: [],
    showInactive: false,
    isLoading: true,
    bootstrapStatus: "idle",
    bootstrapError: "",
    bootstrapHelp: ""
  });
};

const editableSettings = {
  editorName: "Samuel",
  dataFilePath: "/tmp/data/contacts.json",
  backupDirectoryPath: "/tmp/backups",
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

  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
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

    fireEvent.change(screen.getByLabelText(/nombre visible/i), {
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

  it("ignores repeated submit attempts while a save is already running", async () => {
    let resolveCreateRecord: ((value: {
      contacts: typeof defaultContacts;
      settings: typeof editableSettings;
      savedRecordId: string;
    }) => void) | undefined;
    window.hospitalDirectory.createRecord = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreateRecord = resolve;
        })
    );
    const router = renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/nombre visible/i), {
      target: { value: "Nuevo Control" }
    });
    fireEvent.change(screen.getByLabelText("Número"), {
      target: { value: "112233" }
    });

    fireEvent.submit(screen.getByRole("button", { name: "Crear registro" }).closest("form")!);
    fireEvent.submit(screen.getByRole("button", { name: "Guardando…" }).closest("form")!);

    expect(window.hospitalDirectory.createRecord).toHaveBeenCalledTimes(1);

    resolveCreateRecord?.({
      contacts: defaultContacts,
      settings: editableSettings,
      savedRecordId: "cnt_0009"
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
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
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    const router = renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/nombre visible/i), {
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

    fireEvent.change(screen.getByLabelText(/nombre visible/i), {
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

    fireEvent.change(screen.getByLabelText(/nombre visible/i), {
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

  it("announces and focuses the new phone row when adding a phone", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir teléfono" }));

    const phoneInputs = screen.getAllByLabelText("Número");
    expect(phoneInputs).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Teléfono 2 añadido.");
    expect(document.activeElement).toBe(phoneInputs[1]);
  });

  it("returns focus to add phone button and announces removal", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir teléfono" }));

    const removePhoneButtons = screen.getAllByRole("button", { name: "Eliminar" });
    fireEvent.click(removePhoneButtons[1]!);

    expect(screen.getAllByLabelText("Número")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Teléfono 2 eliminado.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Añadir teléfono" }));
  });

  it("announces and focuses the new email row when adding an email", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));

    const emailInputs = screen.getAllByLabelText("Correo electrónico");
    expect(emailInputs).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Correo 1 añadido.");
    expect(document.activeElement).toBe(emailInputs[0]);
  });

  it("returns focus to add email button and announces removal", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" }).at(-1)!);

    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Correo 1 eliminado.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Añadir correo" }));
  });

  it("shows loading state while bootstrap is in progress (direct route entry)", () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockImplementation(
      () => new Promise(() => undefined)
    );

    renderWithRoute("/contacts/new");

    // Page defers to store loading state — no page-level error panel
    expect(screen.getByText("Cargando formulario…")).toBeInTheDocument();
    expect(screen.queryByText("No se pudo abrir el formulario")).not.toBeInTheDocument();
  });

  it("calls ensureBootstrapLoaded on mount and shows form after load (direct route entry)", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByRole("heading", { name: "Alta de contacto" })).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
  });

  it("does not reload bootstrap when store already has data (route transition)", async () => {
    useAppStore.setState({
      contacts: defaultContacts,
      settings: editableSettings,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderWithRoute("/contacts/new");

    expect(await screen.findByRole("heading", { name: "Alta de contacto" })).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).not.toHaveBeenCalled();
  });

  describe("displayName field accessibility attributes", () => {
    it("marks the displayName input as required with required and aria-required attributes", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      const input = screen.getByLabelText(/nombre visible/i);
      expect(input).toBeRequired();
      expect(input).toHaveAttribute("aria-required", "true");
    });
  });

  describe("focus management on validation error", () => {
    it("moves focus to the displayName input when displayName is missing on submit", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Leave displayName empty, clear the phone number too
      fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Número"), { target: { value: "" } });

      fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

      // Wait for the inline error to appear, then check focus
      await screen.findByText("El nombre visible es obligatorio.");
      expect(document.activeElement).toBe(screen.getByLabelText(/nombre visible/i));
    });

    it("does not steal focus from the active element on initial render", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // On initial render no submit has occurred — displayName input must not hold focus
      expect(document.activeElement).not.toBe(screen.getByLabelText(/nombre visible/i));
    });
  });
});
