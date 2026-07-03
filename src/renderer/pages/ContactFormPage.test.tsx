import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ContactFormPage } from "./ContactFormPage";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";

// Stub HTMLDialogElement.showModal/close since jsdom does not implement them.
// Required for ConfirmDialog (used by the unsaved-changes blocker guard).
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
    // Note: /número/i regex used because the label now has an aria-hidden asterisk
    fireEvent.change(screen.getByLabelText(/número/i), {
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
    fireEvent.change(screen.getByLabelText(/número/i), {
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
    fireEvent.change(screen.getByLabelText(/número/i), {
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
    fireEvent.change(screen.getByLabelText(/número/i), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

    expect(await screen.findByText("Revisa los campos marcados antes de guardar.")).toBeInTheDocument();
    expect(screen.getByText("Falta el nombre del contacto.")).toBeInTheDocument();
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

    // /número/i regex because the label has an aria-hidden asterisk span
    const phoneInputs = screen.getAllByLabelText(/número/i);
    expect(phoneInputs).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Teléfono 2 añadido.");
    expect(document.activeElement).toBe(phoneInputs[1]);
  });

  it("returns focus to add phone button and announces removal", async () => {
    renderWithRoute("/contacts/new");

    expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir teléfono" }));

    // Buttons now have contextual aria-labels: "Eliminar teléfono 1" / "Eliminar teléfono 2"
    const removePhoneButtons = screen.getAllByRole("button", { name: /eliminar teléfono/i });
    fireEvent.click(removePhoneButtons[1]!);

    expect(screen.getAllByLabelText(/número/i)).toHaveLength(1);
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
    // Button now has contextual aria-label: "Eliminar email 1" (empty address → position)
    fireEvent.click(screen.getByRole("button", { name: /eliminar email/i }));

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

  describe("phone number field accessibility attributes", () => {
    it("marks the phone number input as required with required and aria-required attributes", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // /número/i because the label has an aria-hidden asterisk span
      const input = screen.getByLabelText(/número/i);
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
      fireEvent.change(screen.getByLabelText(/número/i), { target: { value: "" } });

      fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

      // Wait for the inline error to appear, then check focus
      await screen.findByText("Falta el nombre del contacto.");
      expect(document.activeElement).toBe(screen.getByLabelText(/nombre visible/i));
    });

    it("does not steal focus from the active element on initial render", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // On initial render no submit has occurred — displayName input must not hold focus
      expect(document.activeElement).not.toBe(screen.getByLabelText(/nombre visible/i));
    });
  });

  describe("Fix 1 — field error clears on onChange", () => {
    it("clears the displayName error when the user types in the field after a failed submit", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Submit with empty displayName to trigger the error
      fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));
      await screen.findByText("Falta el nombre del contacto.");

      // Start correcting → error must disappear
      fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: "H" } });
      expect(screen.queryByText("Falta el nombre del contacto.")).not.toBeInTheDocument();
    });

    it("clears the phone number error when the user types in the field after a failed submit", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Submit with displayName filled but empty phone number
      fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: "Test" } });
      fireEvent.change(screen.getByLabelText(/número/i), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));
      await screen.findByText("El teléfono es obligatorio.");

      // Start correcting → error must disappear
      fireEvent.change(screen.getByLabelText(/número/i), { target: { value: "9" } });
      expect(screen.queryByText("El teléfono es obligatorio.")).not.toBeInTheDocument();
    });
  });

  describe("Fix 3 — SocialsSection focus management", () => {
    it("focuses the handle input of the new social row when a social is added", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir red social" }));

      const handleInputs = screen.getAllByLabelText("Handle / usuario");
      expect(handleInputs).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Red social 1 añadida.");
      expect(document.activeElement).toBe(handleInputs[0]);
    });

    it("returns focus to the add button when a social row is removed", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir red social" }));
      expect(screen.getAllByLabelText("Handle / usuario")).toHaveLength(1);

      // Button has contextual aria-label: "Eliminar red social 1" (empty handle/url → position)
      fireEvent.click(screen.getByRole("button", { name: /eliminar red social/i }));

      expect(screen.queryByLabelText("Handle / usuario")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Añadir red social" }));
    });
  });

  describe("Fix 4 — contextual Eliminar aria-labels", () => {
    it("uses position-based aria-label for Eliminar on a phone with no number yet", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Initial phone row has no number → should get position-based label
      expect(screen.getByRole("button", { name: "Eliminar teléfono 1" })).toBeInTheDocument();
    });

    it("includes the phone number in the aria-label when the number is filled in", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/número/i), { target: { value: "612345678" } });

      expect(screen.getByRole("button", { name: "Eliminar teléfono 1: 612345678" })).toBeInTheDocument();
    });

    it("uses position-based aria-label for Eliminar on an email with no address yet", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));

      expect(screen.getByRole("button", { name: "Eliminar email 1" })).toBeInTheDocument();
    });

    it("includes the email address in the aria-label when the address is filled in", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));
      fireEvent.change(screen.getByLabelText("Correo electrónico"), {
        target: { value: "usuario@ejemplo.com" }
      });

      expect(
        screen.getByRole("button", { name: "Eliminar email 1: usuario@ejemplo.com" })
      ).toBeInTheDocument();
    });

    it("uses position-based aria-label for Eliminar on a social row with no handle or url", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir red social" }));

      expect(screen.getByRole("button", { name: "Eliminar red social 1" })).toBeInTheDocument();
    });

    // Red-team regression (PR#109): two rows sharing the same value must not
    // collide on the same aria-label — the index is always part of the label.
    it("keeps Eliminar aria-labels unique when two phones share the same number", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir teléfono" }));

      const phoneInputs = screen.getAllByLabelText(/número/i);
      fireEvent.change(phoneInputs[0]!, { target: { value: "612345678" } });
      fireEvent.change(phoneInputs[1]!, { target: { value: "612345678" } });

      expect(screen.getByRole("button", { name: "Eliminar teléfono 1: 612345678" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Eliminar teléfono 2: 612345678" })).toBeInTheDocument();
    });

    it("keeps Eliminar aria-labels unique when two emails share the same address", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));
      fireEvent.click(screen.getByRole("button", { name: "Añadir correo" }));

      const emailInputs = screen.getAllByLabelText("Correo electrónico");
      fireEvent.change(emailInputs[0]!, { target: { value: "usuario@ejemplo.com" } });
      fireEvent.change(emailInputs[1]!, { target: { value: "usuario@ejemplo.com" } });

      expect(screen.getByRole("button", { name: "Eliminar email 1: usuario@ejemplo.com" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Eliminar email 2: usuario@ejemplo.com" })).toBeInTheDocument();
    });

    it("keeps Eliminar aria-labels unique when two social rows share the same handle", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Añadir red social" }));
      fireEvent.click(screen.getByRole("button", { name: "Añadir red social" }));

      const handleInputs = screen.getAllByLabelText("Handle / usuario");
      fireEvent.change(handleInputs[0]!, { target: { value: "misma_cuenta" } });
      fireEvent.change(handleInputs[1]!, { target: { value: "misma_cuenta" } });

      expect(screen.getByRole("button", { name: "Eliminar red social 1: misma_cuenta" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Eliminar red social 2: misma_cuenta" })).toBeInTheDocument();
    });
  });

  describe("Fix 5 — unsaved-changes navigation guard (useBlocker)", () => {
    it("does not show the guard dialog when the form is clean (no changes made)", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Navigate away without touching the form — no dialog should appear
      fireEvent.click(screen.getAllByRole("link", { name: "Cancelar" })[0]!);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows the unsaved-changes dialog when navigating away with a dirty form", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      // Make the form dirty
      fireEvent.change(screen.getByLabelText(/nombre visible/i), {
        target: { value: "Hospital Norte" }
      });

      // Try to navigate away via the top Cancelar link
      fireEvent.click(screen.getAllByRole("link", { name: "Cancelar" })[0]!);

      // Blocker dialog must appear
      expect(
        await screen.findByText("¿Seguro que quieres salir? Los cambios no guardados se perderán.")
      ).toBeInTheDocument();
    });

    it("cancels navigation when the user clicks Seguir editando in the blocker dialog", async () => {
      const router = renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/nombre visible/i), {
        target: { value: "Hospital Norte" }
      });
      fireEvent.click(screen.getAllByRole("link", { name: "Cancelar" })[0]!);
      await screen.findByText("¿Seguro que quieres salir? Los cambios no guardados se perderán.");

      fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));

      // Dialog gone, still on the form page
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/contacts/new");
    });

    it("allows navigation when the user confirms leaving in the blocker dialog", async () => {
      const router = renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/nombre visible/i), {
        target: { value: "Hospital Norte" }
      });
      fireEvent.click(screen.getAllByRole("link", { name: "Cancelar" })[0]!);
      await screen.findByText("¿Seguro que quieres salir? Los cambios no guardados se perderán.");

      fireEvent.click(screen.getByRole("button", { name: "Salir sin guardar" }));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    });

    it("does not block navigation after a successful form submission", async () => {
      const router = renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/nombre visible/i), {
        target: { value: "Nuevo Control" }
      });
      fireEvent.change(screen.getByLabelText(/número/i), { target: { value: "112233" } });
      fireEvent.click(screen.getByRole("button", { name: "Crear registro" }));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
      // No dialog should have appeared
      expect(
        screen.queryByText("¿Seguro que quieres salir? Los cambios no guardados se perderán.")
      ).not.toBeInTheDocument();
    });
  });

  describe("Fix 6 — beforeunload guard outside the router (window close/reload)", () => {
    it("does not warn on unload when the form is clean", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      const event = new Event("beforeunload", { cancelable: true });
      const notCanceled = window.dispatchEvent(event);

      expect(notCanceled).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });

    it("warns on unload when the form is dirty", async () => {
      renderWithRoute("/contacts/new");
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/nombre visible/i), {
        target: { value: "Hospital Norte" }
      });

      const event = new Event("beforeunload", { cancelable: true });
      const notCanceled = window.dispatchEvent(event);

      expect(notCanceled).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it("removes the beforeunload listener on unmount", async () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
      const { unmount } = render(
        <ToastProvider>
          <RouterProvider
            router={createMemoryRouter(
              [{ path: "/contacts/new", element: <ContactFormPage /> }],
              { initialEntries: ["/contacts/new"] }
            )}
          />
        </ToastProvider>
      );
      expect(await screen.findByText("Alta de contacto")).toBeInTheDocument();

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });
});
