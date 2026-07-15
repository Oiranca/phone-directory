import { useCallback, useEffect, useRef } from "react";
import { Link, useBlocker } from "react-router-dom";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { StatePanel } from "../components/feedback/StatePanel";
import { CustomFieldsSection } from "../components/contact-form/CustomFieldsSection";
import { EmailsSection } from "../components/contact-form/EmailsSection";
import { IdentitySection } from "../components/contact-form/IdentitySection";
import { OrganizationLocationSection } from "../components/contact-form/OrganizationLocationSection";
import { PhonesSection } from "../components/contact-form/PhonesSection";
import { SocialsSection } from "../components/contact-form/SocialsSection";
import { useContactForm } from "../hooks/useContactForm";

export const RecordFormPage = () => {
  const {
    isEditing,
    isLoading,
    hasContacts,
    hasSettings,
    existingRecordMissing,
    formState,
    setFormState,
    isDirtyRef,
    fieldErrors,
    isSubmitting,
    liveMessage,
    setLiveMessage,
    availableAreas,
    existingCustomFieldKeys,
    displayNameInputRef,
    addPhoneButtonRef,
    addEmailButtonRef,
    addCustomFieldButtonRef,
    phoneNumberInputRefs,
    emailAddressInputRefs,
    customFieldKeyInputRefs,
    clearFieldError,
    updatePhone,
    removePhone,
    updateEmail,
    removeEmail,
    updateSocial,
    removeSocial,
    updateCustomField,
    removeCustomField,
    setPendingFocusTarget,
    handleSubmit
  } = useContactForm();

  /**
   * Block navigation (including the Cancelar links below) when the form has
   * unsaved changes. isDirtyRef is a stable MutableRefObject — the callback
   * reads the current value at navigation time, avoiding stale-closure
   * issues. A clean form navigates away immediately with no extra friction.
   */
  const shouldBlock = useCallback(() => isDirtyRef.current, [isDirtyRef]);
  const blocker = useBlocker(shouldBlock);
  const notFoundTitleRef = useRef<HTMLHeadingElement>(null);

  /**
   * Guard window close / reload / browser unload when the form is dirty.
   * useBlocker only intercepts React Router navigation — it does not cover
   * Electron window close, page reload, or unload triggered outside the
   * router. The native beforeunload prompt covers those remaining paths.
   */
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirtyRef]);

  // Moves focus to the "record not found" heading as soon as it mounts, since
  // this can be reached via direct navigation (e.g. a stale link) with no
  // prior focus context to fall back on.
  useEffect(() => {
    if (existingRecordMissing) {
      notFoundTitleRef.current?.focus();
    }
  }, [existingRecordMissing]);

  if (isLoading || !hasContacts || !hasSettings) {
    return (
      <section role="status" aria-live="polite" className="rounded-3xl bg-white p-6 shadow-panel">
        Cargando formulario…
      </section>
    );
  }

  if (existingRecordMissing) {
    return (
      <StatePanel
        title="Registro no encontrado"
        titleRef={notFoundTitleRef}
        message="El registro solicitado ya no está disponible o fue eliminado."
        action={
          <Link
            to="/"
            className="inline-flex rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
          >
            Volver al directorio
          </Link>
        }
      />
    );
  }

  return (
    <section aria-labelledby="record-form-page-title" className="rounded-3xl bg-white p-5 shadow-panel sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="record-form-page-title" className="text-2xl font-semibold text-scs-blueDark">
            {isEditing ? formState.displayName || "Actualizar contacto" : "Alta de contacto"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Completa los datos del contacto: teléfonos, correos, ubicación y notas.
          </p>
        </div>
        <Link
          to="/"
          data-keyboard-cancel
          aria-label="Cancelar y volver al directorio"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
        >
          Cancelar
        </Link>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </p>

      <form className="mt-6 space-y-8" data-keyboard-submit noValidate onSubmit={handleSubmit}>
        <div className="grid gap-6 xl:grid-cols-2">
          <IdentitySection
            formState={formState}
            fieldErrors={fieldErrors}
            setFormState={setFormState}
            displayNameInputRef={displayNameInputRef}
            clearFieldError={clearFieldError}
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
          clearFieldError={clearFieldError}
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
          clearFieldError={clearFieldError}
        />

        <SocialsSection
          socials={formState.contactMethods.socials}
          setFormState={setFormState}
          setLiveMessage={setLiveMessage}
          updateSocial={updateSocial}
          removeSocial={removeSocial}
        />

        <CustomFieldsSection
          customFields={formState.customFields}
          existingCustomFieldKeys={existingCustomFieldKeys}
          fieldErrors={fieldErrors}
          addCustomFieldButtonRef={addCustomFieldButtonRef}
          customFieldKeyInputRefs={customFieldKeyInputRefs}
          setFormState={setFormState}
          setLiveMessage={setLiveMessage}
          setPendingFocusTarget={setPendingFocusTarget}
          updateCustomField={updateCustomField}
          removeCustomField={removeCustomField}
          clearFieldError={clearFieldError}
        />

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <label htmlFor="notes" className="text-sm font-medium text-slate-700">
              Notas
            </label>
            <textarea
              id="notes"
              value={formState.notes ?? ""}
              onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
              rows={6}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
            />
          </section>
        </div>

        <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:justify-end sm:pt-8">
          <Link
            to="/"
            aria-label="Cancelar sin guardar los cambios"
            className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 sm:w-auto"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-scs-blue px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60 sm:w-auto"
          >
            {isSubmitting ? "Guardando…" : isEditing ? "Guardar cambios" : "Crear registro"}
          </button>
        </div>
      </form>

      {/* Unsaved-changes guard: shown when a Cancelar link (or any other router
          navigation) is attempted while the form is dirty. */}
      <ConfirmDialog
        isOpen={blocker.state === "blocked"}
        title="Cambios sin guardar"
        message="¿Seguro que quieres salir? Los cambios no guardados se perderán."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </section>
  );
};
