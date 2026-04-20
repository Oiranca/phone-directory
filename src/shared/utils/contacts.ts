/**
 * Ensures exactly one entry in the array has `isPrimary: true`.
 *
 * - If multiple entries claim isPrimary, only the first one keeps it.
 * - If no entry claims isPrimary, the first entry is promoted.
 * - Empty arrays are returned unchanged.
 *
 * Used in both the renderer (ContactFormPage draft state) and the main process
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
