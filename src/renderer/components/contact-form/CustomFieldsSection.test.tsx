import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableCustomField } from "../../../shared/types/contact";
import type { ContactFormState, PendingFocusTarget } from "../../hooks/useContactForm";
import { CustomFieldsSection } from "./CustomFieldsSection";

/**
 * Minimal stateful harness mirroring how ContactFormPage wires
 * CustomFieldsSection through useContactForm: `setFormState` only needs to
 * update `customFields` for this component's own behavior, so the rest of
 * ContactFormState is stubbed out.
 */
const CustomFieldsSectionHarness = ({
  initialFields = [],
  existingCustomFieldKeys = [],
  fieldErrors = {}
}: {
  initialFields?: EditableCustomField[];
  existingCustomFieldKeys?: string[];
  fieldErrors?: Record<string, string>;
}) => {
  const [customFields, setCustomFields] = useState<EditableCustomField[]>(initialFields);
  const [liveMessage, setLiveMessage] = useState("");
  const addCustomFieldButtonRef = useRef<HTMLButtonElement>(null);
  const customFieldKeyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setFormState: React.Dispatch<React.SetStateAction<ContactFormState>> = (action) => {
    const applied =
      typeof action === "function"
        ? (action as (current: ContactFormState) => ContactFormState)({
            customFields
          } as unknown as ContactFormState)
        : action;
    setCustomFields(applied.customFields);
  };

  const updateCustomField = (fieldId: string, patch: Partial<EditableCustomField>) => {
    setCustomFields((current) => current.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)));
  };

  const removeCustomField = (fieldId: string) => {
    setCustomFields((current) => current.filter((field) => field.id !== fieldId));
  };

  return (
    <div>
      <CustomFieldsSection
        customFields={customFields}
        existingCustomFieldKeys={existingCustomFieldKeys}
        fieldErrors={fieldErrors}
        addCustomFieldButtonRef={addCustomFieldButtonRef}
        customFieldKeyInputRefs={customFieldKeyInputRefs}
        setFormState={setFormState}
        setLiveMessage={setLiveMessage}
        setPendingFocusTarget={vi.fn() as React.Dispatch<React.SetStateAction<PendingFocusTarget | null>>}
        updateCustomField={updateCustomField}
        removeCustomField={removeCustomField}
      />
      <p role="status">{liveMessage}</p>
    </div>
  );
};

describe("CustomFieldsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("adds a new custom field row", () => {
    render(<CustomFieldsSectionHarness />);

    expect(screen.queryByText("Campo 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Añadir campo" }));

    expect(screen.getByText("Campo 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del campo")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor")).toBeInTheDocument();
  });

  it("removes a custom field row", () => {
    render(
      <CustomFieldsSectionHarness
        initialFields={[{ id: "cf_1", key: "Número extranjero", value: "+34 600 000 000" }]}
      />
    );

    expect(screen.getByText("Campo 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Eliminar campo personalizado 1/ }));

    expect(screen.queryByText("Campo 1")).not.toBeInTheDocument();
  });

  it("suggests existing key names from other contacts via the key combobox", () => {
    render(
      <CustomFieldsSectionHarness
        initialFields={[{ id: "cf_1", key: "", value: "" }]}
        existingCustomFieldKeys={["Número extranjero", "DNI"]}
      />
    );

    const keyInput = screen.getByLabelText("Nombre del campo");
    fireEvent.focus(keyInput);

    expect(screen.getByRole("option", { name: "Número extranjero" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "DNI" })).toBeInTheDocument();
  });

  it("allows typing a brand-new key name not present in suggestions", () => {
    render(
      <CustomFieldsSectionHarness
        initialFields={[{ id: "cf_1", key: "", value: "" }]}
        existingCustomFieldKeys={["Número extranjero"]}
      />
    );

    const keyInput = screen.getByLabelText("Nombre del campo");
    fireEvent.change(keyInput, { target: { value: "Turno preferente" } });

    expect(keyInput).toHaveValue("Turno preferente");
  });

  it("updates the value field", () => {
    render(
      <CustomFieldsSectionHarness
        initialFields={[{ id: "cf_1", key: "Número extranjero", value: "" }]}
      />
    );

    const valueInput = screen.getByLabelText("Valor");
    fireEvent.change(valueInput, { target: { value: "+34 600 000 000" } });

    expect(valueInput).toHaveValue("+34 600 000 000");
  });

  it("renders field errors from the parent's fieldErrors map", () => {
    render(
      <CustomFieldsSectionHarness
        initialFields={[{ id: "cf_1", key: "", value: "algo" }]}
        fieldErrors={{ "customFields.0.key": "El nombre del campo es obligatorio." }}
      />
    );

    expect(screen.getByText("El nombre del campo es obligatorio.")).toBeInTheDocument();
  });
});
