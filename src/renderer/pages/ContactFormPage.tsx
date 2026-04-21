import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ZodError } from "zod";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import { editableContactRecordSchema } from "../../shared/schemas/contact";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import type { EditableContactRecord, EditableEmailContact, EditablePhoneContact } from "../../shared/types/contact";
import { normalizePrimaryEntries } from "../../shared/utils/contacts";
import { SelectField } from "../components/inputs/SelectField";
import { useAppStore } from "../store/useAppStore";

type ContactFormState = Omit<EditableContactRecord, "person" | "location"> & {
  person: {
    firstName: string;
    lastName: string;
  };
  location: {
    building: string;
    floor: string;
    room: string;
    text: string;
  };
};

const recordTypeOptions: Array<{ value: RecordType; label: string }> = [
  { value: "person", label: "Persona" },
  { value: "service", label: "Servicio" },
  { value: "department", label: "Departamento" },
  { value: "control", label: "Control" },
  { value: "supervision", label: "Supervisión" },
  { value: "room", label: "Sala" },
  { value: "external-center", label: "Centro externo" },
  { value: "other", label: "Otro" }
];

const areaOptions: Array<{ value: AreaType; label: string }> = [
  { value: "sanitaria-asistencial", label: "Sanitaria asistencial" },
  { value: "gestion-administracion", label: "Gestión y administración" },
  { value: "especialidades", label: "Especialidades" },
  { value: "otros", label: "Otros" }
];

const phoneKindOptions = [
  { value: "internal", label: "Interno" },
  { value: "external", label: "Externo" },
  { value: "mobile", label: "Móvil" },
  { value: "fax", label: "Fax" },
  { value: "other", label: "Otro" }
];

const formControlClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2";

// client-side only: used as React keys for draft phone/email entries, discarded on save
const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const createPhoneDraft = (): EditablePhoneContact => ({
  id: createId("ph"),
  label: "",
  number: "",
  extension: "",
  kind: "internal",
  isPrimary: true,
  confidential: false,
  noPatientSharing: false,
  notes: ""
});

const createEmailDraft = (): EditableEmailContact => ({
  id: createId("em"),
  label: "",
  address: "",
  isPrimary: true
});

const createEmptyFormState = (): ContactFormState => ({
  type: "person",
  displayName: "",
  externalId: "",
  person: {
    firstName: "",
    lastName: ""
  },
  organization: {
    department: "",
    service: "",
    area: undefined,
    specialty: ""
  },
  location: {
    building: "",
    floor: "",
    room: "",
    text: ""
  },
  contactMethods: {
    phones: [createPhoneDraft()],
    emails: []
  },
  aliases: [],
  tags: [],
  notes: "",
  status: "active"
});

const toFormState = (record: EditableContactRecord): ContactFormState => ({
  ...record,
  externalId: record.externalId ?? "",
  person: {
    firstName: record.person?.firstName ?? "",
    lastName: record.person?.lastName ?? ""
  },
  organization: {
    department: record.organization.department ?? "",
    service: record.organization.service ?? "",
    area: record.organization.area,
    specialty: record.organization.specialty ?? ""
  },
  location: {
    building: record.location?.building ?? "",
    floor: record.location?.floor ?? "",
    room: record.location?.room ?? "",
    text: record.location?.text ?? ""
  },
  contactMethods: {
    phones: record.contactMethods.phones.length > 0 ? record.contactMethods.phones : [createPhoneDraft()],
    emails: record.contactMethods.emails
  },
  aliases: record.aliases,
  tags: record.tags,
  notes: record.notes ?? ""
});

const buildPayload = (state: ContactFormState): EditableContactRecord => ({
  id: state.id,
  externalId: state.externalId,
  type: state.type,
  displayName: state.displayName,
  person: state.person,
  organization: state.organization,
  location: state.location,
  contactMethods: state.contactMethods,
  aliases: state.aliases,
  tags: state.tags,
  notes: state.notes,
  status: state.status
});

const buildErrorMap = (error: ZodError<EditableContactRecord>) => {
  const nextErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (path && !nextErrors[path]) {
      nextErrors[path] = issue.message;
    }
  }

  return nextErrors;
};

const promoteSiblingAsPrimary = <T extends { id: string; isPrimary: boolean }>(
  entries: T[],
  excludedId: string
) => {
  if (entries.some((entry) => entry.isPrimary)) {
    return entries;
  }

  const fallbackIndex = entries.findIndex((entry) => entry.id !== excludedId);

  if (fallbackIndex === -1) {
    return normalizePrimaryEntries(entries);
  }

  return entries.map((entry, index) =>
    index === fallbackIndex
      ? {
          ...entry,
          isPrimary: true
        }
      : entry
  );
};

export const ContactFormPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const {
    contacts,
    settings,
    initialize,
    isLoading,
    setContacts,
    setSettings,
    setSelectedRecordId
  } = useAppStore();
  const [formState, setFormState] = useState<ContactFormState>(() => createEmptyFormState());
  const [bootstrapError, setBootstrapError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const existingRecord = useMemo(
    () => contacts?.records.find((record) => record.id === id),
    [contacts, id]
  );

  // NOTE: App.tsx handles global bootstrap and blocks navigation during loading/recovery.
  // This local loader is retained only for page-level retry and test isolation.
  useEffect(() => {
    if (contacts) {
      return;
    }

    void (async () => {
      try {
        setBootstrapError("");
        const payload = await window.hospitalDirectory.getBootstrapData();
        if (isRecoveryBootstrap(payload)) {
          setBootstrapError(payload.recovery.message);
          return;
        }
        initialize(payload);
      } catch {
        setBootstrapError("No se pudieron cargar los datos locales para preparar el formulario.");
      }
    })();
  }, [contacts, initialize]);

  useEffect(() => {
    if (isEditing && existingRecord) {
      setFormState(toFormState(existingRecord));
      setFieldErrors({});
      setSubmitError("");
      return;
    }

    if (!isEditing) {
      setFormState(createEmptyFormState());
      setFieldErrors({});
      setSubmitError("");
    }
  }, [existingRecord, isEditing]);

  const availableAreas = contacts?.catalogs.areas ?? [];

  const setCommaSeparatedField = (key: "aliases" | "tags", rawValue: string) => {
    setFormState((current) => ({
      ...current,
      [key]: rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    }));
  };

  const updatePhone = (phoneId: string, patch: Partial<EditablePhoneContact>) => {
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        phones: (() => {
          const nextPhones = current.contactMethods.phones.map((phone) => {
            if (phone.id !== phoneId) {
              return patch.isPrimary ? { ...phone, isPrimary: false } : phone;
            }

            return {
              ...phone,
              ...patch
            };
          });

          return patch.isPrimary === false
            ? normalizePrimaryEntries(promoteSiblingAsPrimary(nextPhones, phoneId))
            : normalizePrimaryEntries(nextPhones);
        })()
      }
    }));
  };

  const updateEmail = (emailId: string, patch: Partial<EditableEmailContact>) => {
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        emails: (() => {
          const nextEmails = current.contactMethods.emails.map((email) => {
            if (email.id !== emailId) {
              return patch.isPrimary ? { ...email, isPrimary: false } : email;
            }

            return {
              ...email,
              ...patch
            };
          });

          return patch.isPrimary === false
            ? normalizePrimaryEntries(promoteSiblingAsPrimary(nextEmails, emailId))
            : normalizePrimaryEntries(nextEmails);
        })()
      }
    }));
  };

  const removePhone = (phoneId: string) => {
    setFormState((current) => {
      const nextPhones = current.contactMethods.phones.filter((phone) => phone.id !== phoneId);
      return {
        ...current,
        contactMethods: {
          ...current.contactMethods,
          phones: nextPhones.length > 0 ? normalizePrimaryEntries(nextPhones) : [createPhoneDraft()]
        }
      };
    });
  };

  const removeEmail = (emailId: string) => {
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        emails: normalizePrimaryEntries(
          current.contactMethods.emails.filter((email) => email.id !== emailId)
        )
      }
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError("");

    const payload = buildPayload(formState);
    const parsed = editableContactRecordSchema.safeParse(payload);

    if (!parsed.success) {
      setFieldErrors(buildErrorMap(parsed.error));
      setSubmitError("Revisa los campos marcados antes de guardar.");
      return;
    }

    try {
      setIsSubmitting(true);
      setFieldErrors({});
      const result = isEditing && id
        ? await window.hospitalDirectory.updateRecord(id, parsed.data)
        : await window.hospitalDirectory.createRecord(parsed.data);

      setContacts(result.contacts);
      setSettings(result.settings);
      setSelectedRecordId(result.savedRecordId);
      navigate("/");
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el registro. Inténtalo de nuevo."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">No se pudo abrir el formulario</h2>
        <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setBootstrapError("");
              void window.hospitalDirectory
                .getBootstrapData()
                .then((payload) => {
                  if (isRecoveryBootstrap(payload)) {
                    setBootstrapError(payload.recovery.message);
                    return;
                  }

                  initialize(payload);
                })
                .catch(() => {
                  setBootstrapError("No se pudieron cargar los datos locales para preparar el formulario.");
                });
            }}
            className="rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
          >
            Reintentar
          </button>
          <Link
            to="/"
            className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
          >
            Volver al directorio
          </Link>
        </div>
      </section>
    );
  }

  if (isLoading || !contacts || !settings) {
    return <section className="rounded-3xl bg-white p-6 shadow-panel">Cargando formulario…</section>;
  }

  if (isEditing && !existingRecord) {
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
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">
            {isEditing ? "Editar registro" : "Nuevo registro"}
          </p>
          <h2 className="text-2xl font-semibold text-scs-blueDark">
            {isEditing ? formState.displayName || "Actualizar contacto" : "Alta de contacto"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Completa la ficha operativa con teléfonos, correos, ubicación y notas. La validación usa el mismo esquema compartido del dataset.
          </p>
        </div>
        <Link to="/" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Cancelar
        </Link>
      </div>

      <form className="mt-6 space-y-8" onSubmit={handleSubmit}>
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <h3 className="text-lg font-semibold text-scs-blueDark">Identidad</h3>
            <div>
              <label htmlFor="displayName" className="text-sm font-medium text-slate-700">
                Nombre visible
              </label>
              <input
                id="displayName"
                value={formState.displayName}
                onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
              {fieldErrors.displayName && <p className="mt-2 text-sm text-red-600">{fieldErrors.displayName}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SelectField
                  id="type"
                  label="Tipo"
                  value={formState.type}
                  onChange={(value) =>
                    setFormState((current) => ({ ...current, type: value as RecordType }))
                  }
                  options={recordTypeOptions}
                />
              </div>

              <div>
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
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className="text-sm font-medium text-slate-700">
                  Nombre
                </label>
                <input
                  id="firstName"
                  value={formState.person.firstName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      person: { ...current.person, firstName: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="text-sm font-medium text-slate-700">
                  Apellidos
                </label>
                <input
                  id="lastName"
                  value={formState.person.lastName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      person: { ...current.person, lastName: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>
            </div>

            <div>
              <label htmlFor="externalId" className="text-sm font-medium text-slate-700">
                ID externo
              </label>
              <input
                id="externalId"
                value={formState.externalId}
                onChange={(event) => setFormState((current) => ({ ...current, externalId: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
              />
            </div>
          </section>

          <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
            <h3 className="text-lg font-semibold text-scs-blueDark">Organización y ubicación</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="department" className="text-sm font-medium text-slate-700">
                  Departamento
                </label>
                <input
                  id="department"
                  value={formState.organization.department}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      organization: { ...current.organization, department: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>

              <div>
                <label htmlFor="service" className="text-sm font-medium text-slate-700">
                  Servicio
                </label>
                <input
                  id="service"
                  value={formState.organization.service}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      organization: { ...current.organization, service: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <SelectField
                  id="area"
                  label="Área"
                  value={formState.organization.area ?? ""}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      organization: {
                        ...current.organization,
                        area: value ? (value as AreaType) : undefined
                      }
                    }))
                  }
                  options={[
                    { value: "", label: "Sin área" },
                    ...availableAreas.map((area) => ({
                      value: area,
                      label: areaOptions.find((option) => option.value === area)?.label ?? area
                    }))
                  ]}
                />
              </div>

              <div>
                <label htmlFor="specialty" className="text-sm font-medium text-slate-700">
                  Especialidad
                </label>
                <input
                  id="specialty"
                  value={formState.organization.specialty}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      organization: { ...current.organization, specialty: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="building" className="text-sm font-medium text-slate-700">
                  Edificio
                </label>
                <input
                  id="building"
                  value={formState.location.building}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      location: { ...current.location, building: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>

              <div>
                <label htmlFor="floor" className="text-sm font-medium text-slate-700">
                  Planta
                </label>
                <input
                  id="floor"
                  value={formState.location.floor}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      location: { ...current.location, floor: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="room" className="text-sm font-medium text-slate-700">
                  Sala / despacho
                </label>
                <input
                  id="room"
                  value={formState.location.room}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      location: { ...current.location, room: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>

              <div>
                <label htmlFor="locationText" className="text-sm font-medium text-slate-700">
                  Texto libre de ubicación
                </label>
                <input
                  id="locationText"
                  value={formState.location.text}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      location: { ...current.location, text: event.target.value }
                    }))
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                />
              </div>
            </div>
          </section>
        </div>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold text-scs-blueDark">Teléfonos</h3>
            <button
              type="button"
              onClick={() =>
                setFormState((current) => ({
                  ...current,
                  contactMethods: {
                    ...current.contactMethods,
                    phones: [
                      ...current.contactMethods.phones,
                      {
                        ...createPhoneDraft(),
                        isPrimary: current.contactMethods.phones.length === 0
                      }
                    ]
                  }
                }))
              }
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              Añadir teléfono
            </button>
          </div>

          <div className="space-y-4">
            {formState.contactMethods.phones.map((phone, index) => (
              <div key={phone.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-700">Teléfono {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removePhone(phone.id)}
                    className="text-sm font-semibold text-slate-500 hover:text-red-600"
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
                      value={phone.number}
                      onChange={(event) => updatePhone(phone.id, { number: event.target.value })}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                    />
                    {fieldErrors[`contactMethods.phones.${index}.number`] && (
                      <p className="mt-2 text-sm text-red-600">{fieldErrors[`contactMethods.phones.${index}.number`]}</p>
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
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={phone.confidential}
                      onChange={(event) => updatePhone(phone.id, { confidential: event.target.checked })}
                    />
                    Confidencial
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
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

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/60 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold text-scs-blueDark">Correos electrónicos</h3>
            <button
              type="button"
              onClick={() =>
                setFormState((current) => ({
                  ...current,
                  contactMethods: {
                    ...current.contactMethods,
                    emails: [
                      ...current.contactMethods.emails,
                      {
                        ...createEmailDraft(),
                        isPrimary: current.contactMethods.emails.length === 0
                      }
                    ]
                  }
                }))
              }
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              Añadir correo
            </button>
          </div>

          <div className="space-y-4">
            {formState.contactMethods.emails.map((email, index) => (
              <div key={email.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-700">Correo {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeEmail(email.id)}
                    className="text-sm font-semibold text-slate-500 hover:text-red-600"
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
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                    />
                  </div>
                  <div>
                    <label htmlFor={`email-address-${email.id}`} className="text-sm font-medium text-slate-700">Correo electrónico</label>
                    <input
                      id={`email-address-${email.id}`}
                      value={email.address}
                      onChange={(event) => updateEmail(email.id, { address: event.target.value })}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
                    />
                    {fieldErrors[`contactMethods.emails.${index}.address`] && (
                      <p className="mt-2 text-sm text-red-600">{fieldErrors[`contactMethods.emails.${index}.address`]}</p>
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
              </div>
            ))}
          </div>
        </section>

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

        {submitError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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
