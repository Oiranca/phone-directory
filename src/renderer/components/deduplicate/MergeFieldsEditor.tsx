import type { RecordType } from "../../../shared/constants/catalogs";
import type { MergeContactsOverrides } from "../../../shared/schemas/merge-contacts.schema";
import type { ContactRecord, EditablePhoneContact } from "../../../shared/types/contact";
import { normalizePhoneForMergeDedup } from "../../../shared/utils/matching";
import { recordTypeOptions } from "../../hooks/useContactForm";
import { SelectField } from "../inputs/SelectField";

export interface MergeFieldsDraft {
  displayName: string;
  type: RecordType;
  phones: EditablePhoneContact[];
}

// client-side only id for phones added via the "usar de la otra ficha" affordance —
// never sent as a NEW contact id concept, just a React key / editablePhoneContactSchema id.
const createDraftPhoneId = () => `mph_${crypto.randomUUID().slice(0, 8)}`;

/**
 * Builds the editor's starting point: the "keep" record's own fields, plus
 * the SAME phone union the backend's automatic merge would already produce
 * (keep phones + discard phones not already present, by normalized digits —
 * mirrors `normalizePhoneForMergeDedup` usage in app-data.service.ts and
 * MergeLossPreview.tsx). This means a user who opens the editor and changes
 * nothing ends up with a draft that is byte-equivalent to the default
 * (no-overrides) merge result — see `diffMergeOverrides` below.
 */
export function buildInitialMergeDraft(
  keepRecord: ContactRecord,
  discardRecord: ContactRecord
): MergeFieldsDraft {
  const keepPhoneNums = new Set(
    keepRecord.contactMethods.phones.map((p) => normalizePhoneForMergeDedup(p.number))
  );
  const extraPhones = discardRecord.contactMethods.phones.filter(
    (p) => !keepPhoneNums.has(normalizePhoneForMergeDedup(p.number))
  );

  return {
    displayName: keepRecord.displayName,
    type: keepRecord.type,
    phones: [...keepRecord.contactMethods.phones, ...extraPhones].map((phone) => ({ ...phone }))
  };
}

/**
 * Compares the current draft against the editor's own starting point
 * (`buildInitialMergeDraft`, NOT the raw keep record — that baseline already
 * includes the discard record's unique phones, same as the backend's own
 * automatic union) and returns only the overrides that actually differ.
 *
 * A user who opens the editor but changes nothing gets `overrides ===
 * undefined` — the merge then goes through the pre-existing no-overrides
 * path and produces an identical result, satisfying "editing is additive,
 * never required".
 */
export function diffMergeOverrides(
  keepRecord: ContactRecord,
  discardRecord: ContactRecord,
  draft: MergeFieldsDraft
): MergeContactsOverrides | undefined {
  const baseline = buildInitialMergeDraft(keepRecord, discardRecord);
  const overrides: MergeContactsOverrides = {};
  let changed = false;

  const trimmedName = draft.displayName.trim();
  if (trimmedName && trimmedName !== baseline.displayName) {
    overrides.displayName = trimmedName;
    changed = true;
  }

  if (draft.type !== baseline.type) {
    overrides.type = draft.type;
    changed = true;
  }

  const phonesChanged =
    draft.phones.length !== baseline.phones.length ||
    draft.phones.some((phone, index) => {
      const original = baseline.phones[index];
      return (
        !original ||
        original.id !== phone.id ||
        original.number !== phone.number ||
        (original.label ?? "") !== (phone.label ?? "")
      );
    });

  if (phonesChanged) {
    overrides.contactMethods = { phones: draft.phones };
    changed = true;
  }

  return changed ? overrides : undefined;
}

interface MergeFieldsEditorProps {
  keepRecord: ContactRecord;
  discardRecord: ContactRecord;
  draft: MergeFieldsDraft;
  onChange: (next: MergeFieldsDraft) => void;
}

/**
 * Lets the operator edit the surviving record's key fields
 * (displayName, type, phones) before confirming a duplicate merge, instead
 * of only being able to pick one whole record over the other. Each field
 * offers a "usar de la otra ficha" shortcut to pull in the discarded
 * record's value when it differs.
 */
export const MergeFieldsEditor = ({
  keepRecord,
  discardRecord,
  draft,
  onChange
}: MergeFieldsEditorProps) => {
  const updatePhone = (id: string, patch: Partial<EditablePhoneContact>) => {
    onChange({
      ...draft,
      phones: draft.phones.map((phone) => (phone.id === id ? { ...phone, ...patch } : phone))
    });
  };

  const removePhone = (id: string) => {
    onChange({ ...draft, phones: draft.phones.filter((phone) => phone.id !== id) });
  };

  const addPhoneFromDiscard = (phone: EditablePhoneContact) => {
    onChange({
      ...draft,
      phones: [...draft.phones, { ...phone, id: createDraftPhoneId() }]
    });
  };

  // Discard phones with no normalized-digit match already present in the draft —
  // offered as "añadir de la otra ficha" shortcuts. In the common case (untouched
  // draft) this list is empty because buildInitialMergeDraft already unioned them.
  const addablePhones = discardRecord.contactMethods.phones.filter(
    (phone) =>
      !draft.phones.some(
        (p) => normalizePhoneForMergeDedup(p.number) === normalizePhoneForMergeDedup(phone.number)
      )
  );

  const typeLabel = (type: RecordType) =>
    recordTypeOptions.find((option) => option.value === type)?.label ?? type;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left">
      <div>
        <label htmlFor="merge-override-displayName" className="text-sm font-medium text-slate-700">
          Nombre
        </label>
        <input
          id="merge-override-displayName"
          value={draft.displayName}
          onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
        />
        {discardRecord.displayName !== draft.displayName && (
          <button
            type="button"
            onClick={() => onChange({ ...draft, displayName: discardRecord.displayName })}
            className="focus-ring mt-1.5 rounded-lg text-xs font-medium text-scs-blue hover:underline"
          >
            Usar de la otra ficha: «{discardRecord.displayName}»
          </button>
        )}
      </div>

      <div>
        <SelectField
          id="merge-override-type"
          label="Tipo"
          value={draft.type}
          onChange={(value) => onChange({ ...draft, type: value as RecordType })}
          options={recordTypeOptions}
        />
        {discardRecord.type !== draft.type && (
          <button
            type="button"
            onClick={() => onChange({ ...draft, type: discardRecord.type })}
            className="focus-ring mt-1.5 rounded-lg text-xs font-medium text-scs-blue hover:underline"
          >
            Usar de la otra ficha: «{typeLabel(discardRecord.type)}»
          </button>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-slate-700">Teléfonos</h4>
        <ul className="mt-2 space-y-2">
          {draft.phones.map((phone, index) => {
            const discardMatch = discardRecord.contactMethods.phones.find(
              (p) => normalizePhoneForMergeDedup(p.number) === normalizePhoneForMergeDedup(phone.number)
            );
            const canCopyLabel =
              discardMatch && (discardMatch.label ?? "") !== (phone.label ?? "");

            return (
              <li key={phone.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`merge-phone-label-${phone.id}`} className="sr-only">
                    Etiqueta teléfono {index + 1}
                  </label>
                  <input
                    id={`merge-phone-label-${phone.id}`}
                    value={phone.label ?? ""}
                    placeholder="Etiqueta"
                    onChange={(event) => updatePhone(phone.id, { label: event.target.value })}
                    className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
                  />
                  <label htmlFor={`merge-phone-number-${phone.id}`} className="sr-only">
                    Número teléfono {index + 1}
                  </label>
                  <input
                    id={`merge-phone-number-${phone.id}`}
                    type="tel"
                    value={phone.number}
                    onChange={(event) => updatePhone(phone.id, { number: event.target.value })}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:ring-2"
                  />
                  <button
                    type="button"
                    aria-label={`Eliminar teléfono ${index + 1}`}
                    onClick={() => removePhone(phone.id)}
                    className="focus-ring rounded-lg px-2 py-1 text-xs font-medium text-scs-blue hover:bg-slate-100"
                  >
                    Eliminar
                  </button>
                </div>
                {canCopyLabel && (
                  <button
                    type="button"
                    onClick={() => updatePhone(phone.id, { label: discardMatch!.label })}
                    className="focus-ring mt-1.5 rounded-lg text-xs font-medium text-scs-blue hover:underline"
                  >
                    Usar etiqueta de la otra ficha: «{discardMatch!.label || "(sin etiqueta)"}»
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {addablePhones.length > 0 && (
          <div className="mt-2 space-y-1">
            {addablePhones.map((phone) => (
              <button
                key={phone.id}
                type="button"
                onClick={() => addPhoneFromDiscard(phone)}
                className="focus-ring block rounded-lg text-xs font-medium text-scs-blue hover:underline"
              >
                Añadir de la otra ficha: {phone.label ? `${phone.label}: ${phone.number}` : phone.number}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
