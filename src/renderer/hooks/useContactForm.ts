import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ZodError } from "zod";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import { editableContactRecordSchema } from "../../shared/schemas/contact";
import type { EditableContactRecord, EditableCustomField, EditableEmailContact, EditablePhoneContact, EditableSocialContact, SocialPlatform } from "../../shared/types/contact";
import { normalizePrimaryEntries } from "../../shared/utils/contacts";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";

export type ContactFormState = Omit<EditableContactRecord, "person" | "location" | "customFields"> & {
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
  customFields: EditableCustomField[];
};

export type PendingFocusTarget =
  | {
    kind: "displayName";
  }
  | {
    kind: "phone";
    id?: string;
    fallback: "add-phone";
  }
  | {
    kind: "email";
    id?: string;
    fallback: "add-email";
  }
  | {
    kind: "customField";
    id?: string;
    fallback: "add-custom-field";
  };

export const recordTypeOptions: Array<{ value: RecordType; label: string }> = [
  { value: "person", label: "Persona" },
  { value: "service", label: "Servicio" },
  { value: "department", label: "Departamento" },
  { value: "control", label: "Control" },
  { value: "supervision", label: "Supervisión" },
  { value: "room", label: "Sala" },
  { value: "external-center", label: "Centro externo" },
  { value: "other", label: "Otro" }
];

export const areaOptions: Array<{ value: AreaType; label: string }> = [
  { value: "sanitaria-asistencial", label: "Sanitaria asistencial" },
  { value: "gestion-administracion", label: "Gestión y administración" },
  { value: "especialidades", label: "Especialidades" },
  { value: "otros", label: "Otros" }
];

export const phoneKindOptions = [
  { value: "internal", label: "Interno" },
  { value: "external", label: "Externo" },
  { value: "mobile", label: "Móvil" },
  { value: "fax", label: "Fax" },
  { value: "other", label: "Otro" }
];

export const socialPlatformOptions: Array<{ value: SocialPlatform; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter / X" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "web", label: "Sitio web" },
  { value: "other", label: "Otro" }
];

// client-side only: used as React keys for draft phone/email entries, discarded on save
const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const createPhoneDraft = (): EditablePhoneContact => ({
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

export const createEmailDraft = (): EditableEmailContact => ({
  id: createId("em"),
  label: "",
  address: "",
  isPrimary: true
});

export const createSocialDraft = (): EditableSocialContact => ({
  id: createId("soc"),
  platform: "instagram",
  handle: "",
  url: "",
  label: "",
  isPrimary: true
});

export const createCustomFieldDraft = (): EditableCustomField => ({
  id: createId("cf"),
  key: "",
  value: ""
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
    emails: [],
    socials: []
  },
  aliases: [],
  tags: [],
  notes: "",
  customFields: [],
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
    emails: record.contactMethods.emails,
    socials: record.contactMethods.socials ?? []
  },
  aliases: record.aliases,
  tags: record.tags,
  notes: record.notes ?? "",
  customFields: record.customFields ?? []
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
  customFields: state.customFields,
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

export type UseContactFormResult = {
  // routing / loading state
  isEditing: boolean;
  isLoading: boolean;
  hasContacts: boolean;
  hasSettings: boolean;
  existingRecordMissing: boolean;
  // form state
  formState: ContactFormState;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  fieldErrors: Record<string, string>;
  isSubmitting: boolean;
  liveMessage: string;
  setLiveMessage: React.Dispatch<React.SetStateAction<string>>;
  // derived
  availableAreas: AreaType[];
  /** Key names already used in customFields across all currently-loaded contacts (deduped, sorted), for the key-name autocomplete. */
  existingCustomFieldKeys: string[];
  // refs
  displayNameInputRef: React.RefObject<HTMLInputElement>;
  addPhoneButtonRef: React.RefObject<HTMLButtonElement>;
  addEmailButtonRef: React.RefObject<HTMLButtonElement>;
  addCustomFieldButtonRef: React.RefObject<HTMLButtonElement>;
  phoneNumberInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  emailAddressInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  customFieldKeyInputRefs: React.RefObject<Record<string, HTMLInputElement | null>>;
  /** Tracks whether the user has made unsaved changes. Reset on load and after successful save. */
  isDirtyRef: React.MutableRefObject<boolean>;
  // mutation callbacks
  clearFieldError: (path: string) => void;
  setCommaSeparatedField: (key: "aliases" | "tags", rawValue: string) => void;
  updatePhone: (phoneId: string, patch: Partial<EditablePhoneContact>) => void;
  removePhone: (phoneId: string) => void;
  updateEmail: (emailId: string, patch: Partial<EditableEmailContact>) => void;
  removeEmail: (emailId: string) => void;
  updateSocial: (socialId: string, patch: Partial<EditableSocialContact>) => void;
  removeSocial: (socialId: string) => void;
  updateCustomField: (fieldId: string, patch: Partial<EditableCustomField>) => void;
  removeCustomField: (fieldId: string) => void;
  setPendingFocusTarget: React.Dispatch<React.SetStateAction<PendingFocusTarget | null>>;
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
};

export const useContactForm = (): UseContactFormResult => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const {
    contacts,
    settings,
    isLoading,
    setContacts,
    setSettings,
    setSelectedRecordId,
    ensureBootstrapLoaded
  } = useAppStore();
  const { pushToast } = useToast();
  const [formState, setFormStateRaw] = useState<ContactFormState>(() => createEmptyFormState());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * Ref-based dirty flag — updated synchronously so navigation guards (e.g.
   * useBlocker in ContactFormPage) always read the latest value at the moment
   * a navigation is attempted, avoiding stale-closure issues.
   */
  const isDirtyRef = useRef<boolean>(false);

  /**
   * User-facing state setter: marks the form as dirty whenever the user
   * makes any change. Internal reset paths (loading a record, clearing after
   * a successful save) use setFormStateRaw directly so they do not flag the
   * form as dirty.
   */
  const setFormState = useCallback<React.Dispatch<React.SetStateAction<ContactFormState>>>((action) => {
    isDirtyRef.current = true;
    setFormStateRaw(action);
  }, [setFormStateRaw]);

  /** Clears a single field error by dot-path (e.g. "displayName", "contactMethods.phones.0.number"). */
  const clearFieldError = useCallback((path: string) => {
    setFieldErrors((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingFocusTarget, setPendingFocusTarget] = useState<PendingFocusTarget | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const addPhoneButtonRef = useRef<HTMLButtonElement>(null);
  const addEmailButtonRef = useRef<HTMLButtonElement>(null);
  const addCustomFieldButtonRef = useRef<HTMLButtonElement>(null);
  const phoneNumberInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const emailAddressInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const customFieldKeyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const existingRecord = useMemo(
    () => contacts?.records.find((record) => record.id === id),
    [contacts, id]
  );

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, []);

  useEffect(() => {
    if (isEditing && existingRecord) {
      isDirtyRef.current = false;
      setFormStateRaw(toFormState(existingRecord));
      setFieldErrors({});
      return;
    }

    if (!isEditing) {
      isDirtyRef.current = false;
      setFormStateRaw(createEmptyFormState());
      setFieldErrors({});
    }
  }, [existingRecord, isEditing]);

  useEffect(() => {
    if (!pendingFocusTarget) {
      return;
    }

    if (pendingFocusTarget.kind === "displayName") {
      displayNameInputRef.current?.focus();
      setPendingFocusTarget(null);
      return;
    }

    if (pendingFocusTarget.kind === "phone" && pendingFocusTarget.id) {
      const input = phoneNumberInputRefs.current[pendingFocusTarget.id];
      if (input) {
        input.focus();
        setPendingFocusTarget(null);
        return;
      }
    }

    if (pendingFocusTarget.kind === "email" && pendingFocusTarget.id) {
      const input = emailAddressInputRefs.current[pendingFocusTarget.id];
      if (input) {
        input.focus();
        setPendingFocusTarget(null);
        return;
      }
    }

    if (pendingFocusTarget.kind === "customField" && pendingFocusTarget.id) {
      const input = customFieldKeyInputRefs.current[pendingFocusTarget.id];
      if (input) {
        input.focus();
        setPendingFocusTarget(null);
        return;
      }
    }

    if (pendingFocusTarget.fallback === "add-phone") {
      addPhoneButtonRef.current?.focus();
      setPendingFocusTarget(null);
      return;
    }

    if (pendingFocusTarget.fallback === "add-email") {
      addEmailButtonRef.current?.focus();
      setPendingFocusTarget(null);
      return;
    }

    addCustomFieldButtonRef.current?.focus();
    setPendingFocusTarget(null);
  }, [formState.contactMethods.emails, formState.contactMethods.phones, formState.customFields, pendingFocusTarget]);

  const availableAreas = contacts?.catalogs.areas ?? [];

  /**
   * Key names already used in customFields across every currently-loaded
   * contact (not just the one being edited) — surfaced as autocomplete
   * suggestions so a new custom field reuses an existing name (e.g.
   * "Número extranjero") instead of creating a near-duplicate
   * ("Numero Extranjero", "Núm. Extranjero", …).
   */
  const existingCustomFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const record of contacts?.records ?? []) {
      for (const field of record.customFields ?? []) {
        if (field.key.trim()) {
          keys.add(field.key.trim());
        }
      }
    }
    return Array.from(keys).sort((a, b) => a.localeCompare(b, "es"));
  }, [contacts]);

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
    const removedIndex = formState.contactMethods.phones.findIndex((phone) => phone.id === phoneId);
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
    setLiveMessage(`Teléfono ${removedIndex + 1} eliminado.`);
    setPendingFocusTarget({ kind: "phone", fallback: "add-phone" });
  };

  const removeEmail = (emailId: string) => {
    const removedIndex = formState.contactMethods.emails.findIndex((email) => email.id === emailId);
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        emails: normalizePrimaryEntries(
          current.contactMethods.emails.filter((email) => email.id !== emailId)
        )
      }
    }));
    setLiveMessage(`Correo ${removedIndex + 1} eliminado.`);
    setPendingFocusTarget({ kind: "email", fallback: "add-email" });
  };

  const updateSocial = (socialId: string, patch: Partial<EditableSocialContact>) => {
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        socials: (() => {
          const nextSocials = current.contactMethods.socials.map((social) => {
            if (social.id !== socialId) {
              return patch.isPrimary ? { ...social, isPrimary: false } : social;
            }
            return { ...social, ...patch };
          });
          return patch.isPrimary === false
            ? normalizePrimaryEntries(promoteSiblingAsPrimary(nextSocials, socialId))
            : normalizePrimaryEntries(nextSocials);
        })()
      }
    }));
  };

  const removeSocial = (socialId: string) => {
    const removedIndex = formState.contactMethods.socials.findIndex((s) => s.id === socialId);
    setFormState((current) => ({
      ...current,
      contactMethods: {
        ...current.contactMethods,
        socials: normalizePrimaryEntries(
          current.contactMethods.socials.filter((s) => s.id !== socialId)
        )
      }
    }));
    setLiveMessage(`Red social ${removedIndex + 1} eliminada.`);
  };

  const updateCustomField = (fieldId: string, patch: Partial<EditableCustomField>) => {
    setFormState((current) => ({
      ...current,
      customFields: current.customFields.map((field) =>
        field.id === fieldId ? { ...field, ...patch } : field
      )
    }));
  };

  const removeCustomField = (fieldId: string) => {
    const removedIndex = formState.customFields.findIndex((field) => field.id === fieldId);
    setFormState((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== fieldId)
    }));
    setLiveMessage(`Campo personalizado ${removedIndex + 1} eliminado.`);
    setPendingFocusTarget({ kind: "customField", fallback: "add-custom-field" });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const payload = buildPayload(formState);
    const parsed = editableContactRecordSchema.safeParse(payload);

    if (!parsed.success) {
      const errorMap = buildErrorMap(parsed.error);
      setFieldErrors(errorMap);

      // Move focus to the first field with an error (form/visual order):
      //   1. displayName  2. phones (by array index)  3. emails (by array index)
      if (errorMap["displayName"]) {
        setPendingFocusTarget({ kind: "displayName" });
      } else {
        const firstPhoneIdx = formState.contactMethods.phones.findIndex((_, idx) =>
          Object.keys(errorMap).some((k) => k.startsWith(`contactMethods.phones.${idx}.`))
        );
        if (firstPhoneIdx >= 0) {
          setPendingFocusTarget({
            kind: "phone",
            id: formState.contactMethods.phones[firstPhoneIdx]!.id,
            fallback: "add-phone"
          });
        } else {
          const firstEmailIdx = formState.contactMethods.emails.findIndex((_, idx) =>
            Object.keys(errorMap).some((k) => k.startsWith(`contactMethods.emails.${idx}.`))
          );
          if (firstEmailIdx >= 0) {
            setPendingFocusTarget({
              kind: "email",
              id: formState.contactMethods.emails[firstEmailIdx]!.id,
              fallback: "add-email"
            });
          } else {
            const firstCustomFieldIdx = formState.customFields.findIndex((_, idx) =>
              Object.keys(errorMap).some((k) => k.startsWith(`customFields.${idx}.`))
            );
            if (firstCustomFieldIdx >= 0) {
              setPendingFocusTarget({
                kind: "customField",
                id: formState.customFields[firstCustomFieldIdx]!.id,
                fallback: "add-custom-field"
              });
            }
          }
        }
      }

      pushToast({
        type: "error",
        message: "Revisa los campos marcados antes de guardar."
      });
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
      // Reset synchronously before navigating so the just-completed save
      // never triggers the unsaved-changes navigation guard.
      isDirtyRef.current = false;
      navigate("/");
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo guardar el registro. Inténtalo de nuevo."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isEditing,
    isLoading,
    hasContacts: contacts !== null,
    hasSettings: settings !== null,
    existingRecordMissing: isEditing && !existingRecord && !isLoading,
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
    setCommaSeparatedField,
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
  };
};
