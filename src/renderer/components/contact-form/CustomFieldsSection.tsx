import type { EditableCustomField } from "../../../shared/types/contact";
import { ComboboxField } from "../inputs/ComboboxField";
import type { ContactFormState, PendingFocusTarget } from "../../hooks/useContactForm";
import { createCustomFieldDraft } from "../../hooks/useContactForm";

type Props = {
  customFields: ContactFormState["customFields"];
  /** Key names already used on OTHER loaded contacts, for the key-name autocomplete. */
  existingCustomFieldKeys: string[];
  fieldErrors: Record<string, string>;
  addCustomFieldButtonRef: React.RefObject<HTMLButtonElement>;
  customFieldKeyInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  setLiveMessage: React.Dispatch<React.SetStateAction<string>>;
  setPendingFocusTarget: React.Dispatch<React.SetStateAction<PendingFocusTarget | null>>;
  updateCustomField: (fieldId: string, patch: Partial<EditableCustomField>) => void;
  removeCustomField: (fieldId: string) => void;
  clearFieldError?: (path: string) => void;
};

export const CustomFieldsSection = ({
  customFields,
  existingCustomFieldKeys,
  fieldErrors,
  addCustomFieldButtonRef,
  customFieldKeyInputRefs,
  setFormState,
  setLiveMessage,
  setPendingFocusTarget,
  updateCustomField,
  removeCustomField,
  clearFieldError
}: Props) => (
  <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-scs-blueDark">Campos personalizados</h3>
        <p className="mt-1 text-sm text-slate-600">
          Añade información que no encaje en el resto del formulario (por ejemplo, «Número extranjero»).
        </p>
      </div>
      <button
        ref={addCustomFieldButtonRef}
        type="button"
        onClick={() => {
          const nextField = createCustomFieldDraft();

          setFormState((current) => ({
            ...current,
            customFields: [...current.customFields, nextField]
          }));
          setLiveMessage(`Campo personalizado ${customFields.length + 1} añadido.`);
          setPendingFocusTarget({ kind: "customField", id: nextField.id, fallback: "add-custom-field" });
        }}
        className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
      >
        Añadir campo
      </button>
    </div>

    <ul className="space-y-4">
      {customFields.map((field, index) => (
        <li key={field.id} className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Campo {index + 1}</h4>
            <button
              type="button"
              onClick={() => removeCustomField(field.id)}
              aria-label={
                field.key.trim()
                  ? `Eliminar campo personalizado ${index + 1}: ${field.key.trim()}`
                  : `Eliminar campo personalizado ${index + 1}`
              }
              className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
            >
              Eliminar
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <ComboboxField
                id={`custom-field-key-${field.id}`}
                label="Nombre del campo"
                value={field.key}
                suggestions={existingCustomFieldKeys}
                placeholder="p. ej. Número extranjero"
                invalid={!!fieldErrors[`customFields.${index}.key`]}
                errorText={fieldErrors[`customFields.${index}.key`]}
                onChange={(value) => {
                  clearFieldError?.(`customFields.${index}.key`);
                  updateCustomField(field.id, { key: value });
                }}
                inputRef={(element) => {
                  if (customFieldKeyInputRefs.current) {
                    customFieldKeyInputRefs.current[field.id] = element;
                  }
                }}
              />
            </div>
            <div>
              <label htmlFor={`custom-field-value-${field.id}`} className="text-sm font-medium text-slate-700">
                Valor
              </label>
              <input
                id={`custom-field-value-${field.id}`}
                value={field.value}
                onChange={(event) => {
                  clearFieldError?.(`customFields.${index}.value`);
                  updateCustomField(field.id, { value: event.target.value });
                }}
                aria-invalid={!!fieldErrors[`customFields.${index}.value`]}
                aria-describedby={fieldErrors[`customFields.${index}.value`] ? `custom-field-value-${field.id}-error` : undefined}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
              />
              {fieldErrors[`customFields.${index}.value`] && (
                <p id={`custom-field-value-${field.id}-error`} role="alert" className="mt-2 text-sm text-red-600">
                  {fieldErrors[`customFields.${index}.value`]}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  </section>
);
