import type { EditableEmailContact } from "../../../shared/types/contact";
import type { ContactFormState, PendingFocusTarget } from "../../hooks/useContactForm";
import { createEmailDraft } from "../../hooks/useContactForm";

type Props = {
  emails: ContactFormState["contactMethods"]["emails"];
  fieldErrors: Record<string, string>;
  addEmailButtonRef: React.RefObject<HTMLButtonElement>;
  emailAddressInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  setLiveMessage: React.Dispatch<React.SetStateAction<string>>;
  setPendingFocusTarget: React.Dispatch<React.SetStateAction<PendingFocusTarget | null>>;
  updateEmail: (emailId: string, patch: Partial<EditableEmailContact>) => void;
  removeEmail: (emailId: string) => void;
  clearFieldError?: (path: string) => void;
};

export const EmailsSection = ({
  emails,
  fieldErrors,
  addEmailButtonRef,
  emailAddressInputRefs,
  setFormState,
  setLiveMessage,
  setPendingFocusTarget,
  updateEmail,
  removeEmail,
  clearFieldError
}: Props) => (
  <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="text-lg font-semibold text-scs-blueDark">Correos electrónicos</h3>
      <button
        ref={addEmailButtonRef}
        type="button"
        onClick={() => {
          const nextEmail = {
            ...createEmailDraft(),
            isPrimary: emails.length === 0
          };

          setFormState((current) => ({
            ...current,
            contactMethods: {
              ...current.contactMethods,
              emails: [
                ...current.contactMethods.emails,
                nextEmail
              ]
            }
          }));
          setLiveMessage(`Correo ${emails.length + 1} añadido.`);
          setPendingFocusTarget({ kind: "email", id: nextEmail.id, fallback: "add-email" });
        }}
        className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
      >
        Añadir correo
      </button>
    </div>

    <ul className="space-y-4">
      {emails.map((email, index) => (
        <li key={email.id} className="rounded-3xl border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Correo {index + 1}</h4>
            <button
              type="button"
              onClick={() => removeEmail(email.id)}
              aria-label={
                email.address.trim()
                  ? `Eliminar email ${index + 1}: ${email.address.trim()}`
                  : `Eliminar email ${index + 1}`
              }
              className="focus-ring rounded-lg p-2 text-sm font-medium text-scs-blue hover:bg-slate-100 hover:text-scs-blueDark"
            >
              Eliminar
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <label htmlFor={`email-label-${email.id}`} className="text-sm font-medium text-slate-700">Etiqueta</label>
              <input
                id={`email-label-${email.id}`}
                value={email.label ?? ""}
                onChange={(event) => updateEmail(email.id, { label: event.target.value })}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
              />
            </div>
            <div>
              <label htmlFor={`email-address-${email.id}`} className="text-sm font-medium text-slate-700">Correo electrónico</label>
              <input
                type="email"
                id={`email-address-${email.id}`}
                ref={(element) => {
                  if (emailAddressInputRefs.current) {
                    emailAddressInputRefs.current[email.id] = element;
                  }
                }}
                value={email.address}
                onChange={(event) => {
                  clearFieldError?.(`contactMethods.emails.${index}.address`);
                  updateEmail(email.id, { address: event.target.value });
                }}
                aria-invalid={!!fieldErrors[`contactMethods.emails.${index}.address`]}
                aria-describedby={fieldErrors[`contactMethods.emails.${index}.address`] ? `email-address-${email.id}-error` : undefined}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
              />
              {fieldErrors[`contactMethods.emails.${index}.address`] && (
                <p id={`email-address-${email.id}-error`} role="alert" className="mt-2 text-sm text-red-600">
                  {fieldErrors[`contactMethods.emails.${index}.address`]}
                </p>
              )}
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={email.isPrimary}
              onChange={(event) => updateEmail(email.id, { isPrimary: event.target.checked })}
            />
            Principal
          </label>
        </li>
      ))}
    </ul>
  </section>
);
