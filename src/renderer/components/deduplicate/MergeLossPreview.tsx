import type { DuplicateRecordSummary } from "../../../shared/types/duplicate";

/**
 * A field from the discarded record that will be lost during merge because
 * the keeper already has a different value for that field.
 *
 * Source: app-data.service.ts mergeContacts() — scalar fields use the pattern
 * `keepRecord.field || discardRecord.field`, so if the keeper already has a
 * non-empty value the discard's value is permanently dropped.
 */
export interface MergeFieldConflict {
  field: string;
  discardValue: string;
  keepValue: string;
}

export interface MergeLossPreviewData {
  /** Phones from discard that are unique (will be added to keeper). */
  phonesAdded: Array<{ id: string; label?: string; number: string }>;
  /**
   * Fields where the discard's value will be lost because the keeper already
   * has a different value. Only includes fields visible in DuplicateRecordSummary.
   */
  fieldConflicts: MergeFieldConflict[];
}

/**
 * Computes a client-side preview of which data changes during merge, using
 * only the fields available in DuplicateRecordSummary.
 *
 * Mirrors the merge rules in app-data.service.ts mergeContacts():
 * - phones: union of unique entries (last-9-digit normalisation)
 * - displayName (from person.*): keeper wins if non-empty; discard fills gap
 * - department (from organization.department): keeper wins if non-empty; discard fills gap
 */
export function computeMergeLossPreview(
  keepRecord: DuplicateRecordSummary,
  discardRecord: DuplicateRecordSummary
): MergeLossPreviewData {
  // Phones: mirror the last-9-digit normalisation from app-data.service.ts
  const normalizePhone = (n: string) => n.replace(/\D/g, "").slice(-9);
  const keepPhoneNums = new Set(keepRecord.phones.map((p) => normalizePhone(p.number)));
  const phonesAdded = discardRecord.phones.filter(
    (p) => !keepPhoneNums.has(normalizePhone(p.number))
  );

  const fieldConflicts: MergeFieldConflict[] = [];

  // displayName — derived from person.firstName / person.lastName in the service.
  // If both records have a displayName and they differ, the discard's name is lost.
  if (
    keepRecord.displayName &&
    discardRecord.displayName &&
    keepRecord.displayName !== discardRecord.displayName
  ) {
    fieldConflicts.push({
      field: "Nombre",
      discardValue: discardRecord.displayName,
      keepValue: keepRecord.displayName
    });
  }

  // department — maps to organization.department in the service.
  // Conflict only when BOTH have a department and they differ.
  if (
    keepRecord.department &&
    discardRecord.department &&
    keepRecord.department !== discardRecord.department
  ) {
    fieldConflicts.push({
      field: "Departamento",
      discardValue: discardRecord.department,
      keepValue: keepRecord.department
    });
  }

  return { phonesAdded, fieldConflicts };
}

interface MergeLossPreviewProps {
  keepRecord: DuplicateRecordSummary;
  discardRecord: DuplicateRecordSummary;
}

/**
 * Inline panel shown inside a duplicate pair card once the user has selected
 * which record to keep, before confirming the irreversible merge.
 *
 * Displays in plain Spanish (no technical jargon) what data will be preserved
 * and what will be permanently lost from the discarded record.
 */
export function MergeLossPreview({ keepRecord, discardRecord }: MergeLossPreviewProps) {
  const { phonesAdded, fieldConflicts } = computeMergeLossPreview(keepRecord, discardRecord);

  return (
    <div
      role="note"
      aria-label="Resumen de la fusión"
      className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
    >
      <p className="mb-2 font-semibold text-amber-900">Qué ocurrirá al fusionar</p>

      <ul className="space-y-1.5 text-amber-800">
        {/* Union fields — always preserved */}
        <li>
          <span className="font-medium">Se conservarán</span> los teléfonos, correos y etiquetas
          únicos de ambos registros.
          {phonesAdded.length > 0 && (
            <span>
              {" "}
              Se añadirán al conservado{" "}
              {phonesAdded.length === 1 ? "1 teléfono" : `${phonesAdded.length} teléfonos`} del
              descartado:{" "}
              {phonesAdded
                .map((p) => (p.label ? `${p.label}: ${p.number}` : p.number))
                .join(", ")}
              .
            </span>
          )}
        </li>

        {/* Dynamic field conflicts based on available summary data */}
        {fieldConflicts.length > 0 && (
          <li>
            <span className="font-medium">Se perderán</span> del registro descartado los
            siguientes campos, porque el conservado ya los tiene:
            <ul className="ml-4 mt-1 list-disc space-y-0.5">
              {fieldConflicts.map((c) => (
                <li key={c.field}>
                  {c.field}:{" "}
                  <span className="font-medium">«{c.discardValue}»</span> (el conservado tiene «
                  {c.keepValue}»)
                </li>
              ))}
            </ul>
          </li>
        )}

        {/* Static note for fields not in the summary (notes, location, emails, etc.) */}
        <li className="text-amber-700">
          <span className="font-medium">Otros campos</span> del registro descartado (notas,
          ubicación, correos, servicio, etc.): si el registro conservado ya los tiene, el
          valor del descartado se perderá permanentemente; si el conservado no los tiene, se
          copiarán del descartado.
        </li>
      </ul>
    </div>
  );
}
