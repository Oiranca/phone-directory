import { Link } from "react-router-dom";
import { EmailsSection } from "../components/contact-form/EmailsSection";
import { IdentitySection } from "../components/contact-form/IdentitySection";
import { OrganizationLocationSection } from "../components/contact-form/OrganizationLocationSection";
import { PhonesSection } from "../components/contact-form/PhonesSection";
import { SocialsSection } from "../components/contact-form/SocialsSection";
import { useContactForm } from "../hooks/useContactForm";

export const ContactFormPage = () => {
  const {
    isEditing,
    isLoading,
    hasContacts,
    hasSettings,
    existingRecordMissing,
    formState,
    setFormState,
    fieldErrors,
    isSubmitting,
    liveMessage,
    setLiveMessage,
    availableAreas,
    displayNameInputRef,
    addPhoneButtonRef,
    addEmailButtonRef,
    phoneNumberInputRefs,
    emailAddressInputRefs,
    setCommaSeparatedField,
    updatePhone,
    removePhone,
    updateEmail,
    removeEmail,
    updateSocial,
    removeSocial,
    setPendingFocusTarget,
    handleSubmit
  } = useContactForm();

  if (isLoading || !hasContacts || !hasSettings) {
    return <section className="rounded-3xl bg-white p-6 shadow-panel">Cargando formulario…</section>;
  }

  if (existingRecordMissing) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">Registro no encontrado</h2>
        <p className="mt-2 text-sm text-slate-600">
          El registro solicitado ya no está disponible o fue eliminado.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
        >
          Volver al directorio
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-panel sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-scs-blueDark">
            {isEditing ? formState.displayName || "Actualizar contacto" : "Alta de contacto"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Completa la ficha operativa con teléfonos, correos, ubicación y notas. La validación usa el mismo esquema compartido del dataset.
          </p>
        </div>
        <Link
          to="/"
          data-keyboard-cancel
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
        >
          Cancelar
        </Link>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      <form className="mt-6 space-y-8" data-keyboard-submit onSubmit={handleSubmit}>
        <div className="grid gap-6 xl:grid-cols-2">
          <IdentitySection
            formState={formState}
            fieldErrors={fieldErrors}
            setFormState={setFormState}
            displayNameInputRef={displayNameInputRef}
          />
          <OrganizationLocationSection
            formState={formState}
            setFormState={setFormState}
            availableAreas={availableAreas}
          />
        </div>

        <PhonesSection
          phones={formState.contactMethods.phones}
          fieldErrors={fieldErrors}
          addPhoneButtonRef={addPhoneButtonRef}
          phoneNumberInputRefs={phoneNumberInputRefs}
          setFormState={setFormState}
          setLiveMessage={setLiveMessage}
          setPendingFocusTarget={setPendingFocusTarget}
          updatePhone={updatePhone}
          removePhone={removePhone}
        />

        <EmailsSection
          emails={formState.contactMethods.emails}
          fieldErrors={fieldErrors}
          addEmailButtonRef={addEmailButtonRef}
          emailAddressInputRefs={emailAddressInputRefs}
          setFormState={setFormState}
          setLiveMessage={setLiveMessage}
          setPendingFocusTarget={setPendingFocusTarget}
          updateEmail={updateEmail}
          removeEmail={removeEmail}
        />

        <SocialsSection
          socials={formState.contactMethods.socials}
          setFormState={setFormState}
          setLiveMessage={setLiveMessage}
          updateSocial={updateSocial}
          removeSocial={removeSocial}
        />

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <h3 className="text-lg font-semibold text-scs-blueDark">Clasificación</h3>
            <div>
              <label htmlFor="aliases" className="text-sm font-medium text-slate-700">
                Alias
              </label>
              <input
                id="aliases"
                value={formState.aliases.join(", ")}
                onChange={(event) => setCommaSeparatedField("aliases", event.target.value)}
                placeholder="mostrador admisión, centralita"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="tags" className="text-sm font-medium text-slate-700">
                Etiquetas
              </label>
              <input
                id="tags"
                value={formState.tags.join(", ")}
                onChange={(event) => setCommaSeparatedField("tags", event.target.value)}
                placeholder="admisión, urgencias"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <label htmlFor="notes" className="text-sm font-medium text-slate-700">
              Notas
            </label>
            <textarea
              id="notes"
              value={formState.notes ?? ""}
              onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
              rows={6}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
            />
          </section>
        </div>

        <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end sm:pt-8">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-scs-blue px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? "Guardando…" : isEditing ? "Guardar cambios" : "Crear registro"}
          </button>
          <Link
            to="/"
            className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 sm:w-auto"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
};
