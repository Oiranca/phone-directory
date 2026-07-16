/**
 * Ensures exactly one entry in the array has `isPrimary: true`.
 *
 * - If multiple entries claim isPrimary, only the first one keeps it.
 * - If no entry claims isPrimary, the first entry is promoted.
 * - Empty arrays are returned unchanged.
 *
 * Used in both the renderer (RecordFormPage draft state) and the main process
 * (AppDataService record persistence). Shared here to keep the logic in sync.
 */
export const normalizePrimaryEntries = <T extends { isPrimary: boolean }>(entries: T[]): T[] => {
  if (entries.length === 0) {
    return entries;
  }

  let primaryAssigned = false;

  const normalizedEntries = entries.map((entry) => {
    if (entry.isPrimary && !primaryAssigned) {
      primaryAssigned = true;
      return entry;
    }

    if (entry.isPrimary && primaryAssigned) {
      return {
        ...entry,
        isPrimary: false
      };
    }

    return entry;
  });

  return primaryAssigned
    ? normalizedEntries
    : normalizedEntries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              isPrimary: true
            }
          : entry
      );
};

/**
 * Formats a location's floor value with its Spanish "Planta " prefix (e.g.
 * "6" -> "Planta 6"). ODS parsing intentionally strips this prefix at parse
 * time and stores only the bare value (see spreadsheet-parsers.ts
 * `stripPlantaPrefix`), so every display site must reconstruct it via this
 * helper instead of rendering `location.floor` raw (: a raw `.join`
 * in DirectoryPage's Ubicación card rendered a bare "6" because it wasn't
 * using this reconstruction, while AppDataService's conflict-preview
 * locationSummary already did it correctly and had silently drifted from
 * the renderer).
 */
export const formatLocationFloor = (floor: string | undefined): string | undefined =>
  floor ? `Planta ${floor}` : undefined;

/**
 * Formats a location's room value with its Spanish "Hab " prefix (e.g. "301"
 * -> "Hab 301"). Same rationale as `formatLocationFloor` — see .
 */
export const formatLocationRoom = (room: string | undefined): string | undefined =>
  room ? `Hab ${room}` : undefined;

/**
 * Like `normalizePrimaryEntries`, but never invents a primary when none is
 * marked — "Principal" must stay a manual, user-editable choice.
 * Only reconciles a genuine conflict (more than one entry
 * explicitly marked isPrimary); demotes every extra after the first.
 *
 * - Zero entries marked primary: returned unchanged (zero stays zero).
 * - Exactly one entry marked primary: returned unchanged.
 * - Multiple entries marked primary: only the first keeps isPrimary, the
 *   rest are demoted to false.
 * - Empty arrays are returned unchanged.
 */
export const reconcilePrimaryEntries = <T extends { isPrimary: boolean }>(entries: T[]): T[] => {
  const primaryIndexes = entries
    .map((entry, index) => (entry.isPrimary ? index : -1))
    .filter((index) => index !== -1);

  if (primaryIndexes.length <= 1) {
    return entries;
  }

  const keepIndex = primaryIndexes[0]!;
  return entries.map((entry, index) =>
    entry.isPrimary && index !== keepIndex ? { ...entry, isPrimary: false } : entry
  );
};
