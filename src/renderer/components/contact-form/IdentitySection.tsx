import { useState } from "react";
import type { RecordType } from "../../../shared/constants/catalogs";
import { SelectField } from "../inputs/SelectField";
import type { ContactFormState } from "../../hooks/useContactForm";
import { recordTypeOptions } from "../../hooks/useContactForm";

type Props = {
  formState: ContactFormState;
  fieldErrors: Record<string, string>;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  displayNameInputRef?: React.RefObject<HTMLInputElement | null>;
  clearFieldError?: (path: string) => void;
};

export const IdentitySection = ({ formState, fieldErrors, setFormState, displayNameInputRef, clearFieldError }: Props) => {
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/60 p-4 sm:space-y-4 sm:p-5">
      <h3 className="text-lg font-semibold text-scs-blueDark">Identidad</h3>
      <div>
        <label htmlFor="displayName" className="text-sm font-medium text-slate-700">
          Nombre visible<span aria-hidden="true" className="ml-1 text-scs-danger">*</span>
        </label>
        <input
          ref={displayNameInputRef}
          id="displayName"
          value={formState.displayName}
          onChange={(event) => {
            clearFieldError?.("displayName");
            setFormState((current) => ({ ...current, displayName: event.target.value }));
          }}
          required
          aria-required="true"
          aria-invalid={!!fieldErrors.displayName}
          aria-describedby={fieldErrors.displayName ? "displayName-error" : undefined}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
        {fieldErrors.displayName && (
          <p id="displayName-error" role="alert" className="mt-2 text-sm text-scs-danger">
            {fieldErrors.displayName}
          </p>
        )}
      </div>

      <SelectField
        id="type"
        label="Tipo"
        value={formState.type}
        onChange={(value) =>
          setFormState((current) => ({ ...current, type: value as RecordType }))
        }
        options={recordTypeOptions}
      />

      <details
        className="rounded-2xl border border-slate-200 bg-white"
        open={detailsOpen ?? Boolean(formState.externalId || formState.status === "inactive" || formState.person.firstName || formState.person.lastName)}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="focus-ring cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold text-scs-blue">
          Más datos de identidad
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-4">
          <SelectField
            id="status"
            label="Estado"
            value={formState.status}
            onChange={(value) =>
              setFormState((current) => ({
                ...current,
                status: value as "active" | "inactive"
              }))
            }
            options={[
              { value: "active", label: "Activo" },
              { value: "inactive", label: "Inactivo" }
            ]}
          />

          {(formState.type === "person" || formState.person.firstName || formState.person.lastName) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="text-sm font-medium text-slate-700">Nombre</label>
                <input
                  id="firstName"
                  value={formState.person.firstName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      person: { ...current.person, firstName: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="text-sm font-medium text-slate-700">Apellidos</label>
                <input
                  id="lastName"
                  value={formState.person.lastName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      person: { ...current.person, lastName: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="externalId" className="text-sm font-medium text-slate-700">Identificador externo</label>
            <input
              id="externalId"
              value={formState.externalId}
              onChange={(event) => setFormState((current) => ({ ...current, externalId: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
            />
          </div>
        </div>
      </details>
    </section>
  );
};
