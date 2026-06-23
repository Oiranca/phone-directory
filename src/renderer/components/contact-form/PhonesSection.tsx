import type { EditablePhoneContact } from "../../../shared/types/contact";
import { SelectField } from "../inputs/SelectField";
import type { ContactFormState, PendingFocusTarget } from "../../hooks/useContactForm";
import { createPhoneDraft, phoneKindOptions } from "../../hooks/useContactForm";

type Props = {
  phones: ContactFormState["contactMethods"]["phones"];
  fieldErrors: Record<string, string>;
  addPhoneButtonRef: React.RefObject<HTMLButtonElement>;
  phoneNumberInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  setLiveMessage: React.Dispatch<React.SetStateAction<string>>;
  setPendingFocusTarget: React.Dispatch<React.SetStateAction<PendingFocusTarget | null>>;
  updatePhone: (phoneId: string, patch: Partial<EditablePhoneContact>) => void;
  removePhone: (phoneId: string) => void;
};

export const PhonesSection = ({
  phones,
  fieldErrors,
  addPhoneButtonRef,
  phoneNumberInputRefs,
  setFormState,
  setLiveMessage,
  setPendingFocusTarget,
  updatePhone,
  removePhone
}: Props) => (
  <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="text-lg font-semibold text-scs-blueDark">Teléfonos</h3>
      <button
        ref={addPhoneButtonRef}
        type="button"
        onClick={() => {
          const nextPhone = {
            ...createPhoneDraft(),
            isPrimary: phones.length === 0
          };

          setFormState((current) => ({
            ...current,
            contactMethods: {
              ...current.contactMethods,
              phones: [
                ...current.contactMethods.phones,
                nextPhone
              ]
            }
          }));
          setLiveMessage(`Teléfono ${phones.length + 1} añadido.`);
          setPendingFocusTarget({ kind: "phone", id: nextPhone.id, fallback: "add-phone" });
        }}
        className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
      >
        Añadir teléfono
      </button>
    </div>

    <div className="space-y-4">
      {phones.map((phone, index) => (
        <div key={phone.id} className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-700">Teléfono {index + 1}</p>
            <button
              type="button"
              onClick={() => removePhone(phone.id)}
              className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
            >
              Eliminar
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div>
              <label htmlFor={`phone-label-${phone.id}`} className="text-sm font-medium text-slate-700">Etiqueta</label>
              <input
                id={`phone-label-${phone.id}`}
                value={phone.label ?? ""}
                onChange={(event) => updatePhone(phone.id, { label: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor={`phone-number-${phone.id}`} className="text-sm font-medium text-slate-700">Número</label>
              <input
                id={`phone-number-${phone.id}`}
                ref={(element) => {
                  if (phoneNumberInputRefs.current) {
                    phoneNumberInputRefs.current[phone.id] = element;
                  }
                }}
                value={phone.number}
                onChange={(event) => updatePhone(phone.id, { number: event.target.value })}
                aria-invalid={!!fieldErrors[`contactMethods.phones.${index}.number`]}
                aria-describedby={fieldErrors[`contactMethods.phones.${index}.number`] ? `phone-number-${phone.id}-error` : undefined}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
              {fieldErrors[`contactMethods.phones.${index}.number`] && (
                <p id={`phone-number-${phone.id}-error`} role="alert" className="mt-2 text-sm text-red-600">
                  {fieldErrors[`contactMethods.phones.${index}.number`]}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`phone-extension-${phone.id}`} className="text-sm font-medium text-slate-700">Extensión</label>
              <input
                id={`phone-extension-${phone.id}`}
                value={phone.extension ?? ""}
                onChange={(event) => updatePhone(phone.id, { extension: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <SelectField
                id={`phone-kind-${phone.id}`}
                label="Tipo de teléfono"
                value={phone.kind}
                onChange={(value) => updatePhone(phone.id, { kind: value })}
                options={phoneKindOptions}
              />
            </div>
            <div>
              <label htmlFor={`phone-notes-${phone.id}`} className="text-sm font-medium text-slate-700">Notas</label>
              <input
                id={`phone-notes-${phone.id}`}
                value={phone.notes ?? ""}
                onChange={(event) => updatePhone(phone.id, { notes: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={phone.isPrimary}
                onChange={(event) => updatePhone(phone.id, { isPrimary: event.target.checked })}
              />
              Principal
            </label>
            <label
              className="flex items-center gap-2 text-sm text-slate-700"
              title="Marcador visual orientativo — no restringe el acceso al número"
            >
              <input
                type="checkbox"
                checked={phone.confidential}
                onChange={(event) => updatePhone(phone.id, { confidential: event.target.checked })}
              />
              Confidencial
            </label>
            <label
              className="flex items-center gap-2 text-sm text-slate-700"
              title="Marcador visual orientativo — no restringe el acceso al número"
            >
              <input
                type="checkbox"
                checked={phone.noPatientSharing}
                onChange={(event) => updatePhone(phone.id, { noPatientSharing: event.target.checked })}
              />
              No facilitar a pacientes
            </label>
          </div>
        </div>
      ))}
    </div>
  </section>
);
