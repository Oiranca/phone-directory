import Fuse from "fuse.js";
import type { FuseResult, IFuseOptions } from "fuse.js";
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import type { ContactRecord } from "../../shared/types/contact.js";

export interface DirectoryFilters {
  selectedType: RecordType | "all";
  selectedArea: AreaType | "all";
  selectedTags: string[];
  showInactive: boolean;
}

export type PrivacyFlag = "Confidencial" | "No facilitar a pacientes";

const fuseOptions: IFuseOptions<ContactRecord> = {
  distance: 120,
  ignoreLocation: false,
  location: 0,
  threshold: 0.22,
  keys: [
    { name: "displayName", weight: 10 },
    { name: "contactMethods.phones.extension", weight: 8 },
    { name: "contactMethods.phones.number", weight: 7 },
    { name: "organization.service", weight: 6 },
    { name: "organization.department", weight: 5 },
    { name: "tags", weight: 4 },
    { name: "location.building", weight: 3 },
    { name: "location.floor", weight: 3 },
    { name: "location.room", weight: 3 },
    { name: "location.text", weight: 3 },
    { name: "aliases", weight: 3 },
    { name: "organization.specialty", weight: 2 },
    { name: "organization.area", weight: 2 },
    { name: "contactMethods.phones.label", weight: 2 },
    { name: "contactMethods.emails.address", weight: 2 },
    { name: "notes", weight: 1 }
  ]
};

const shortTextFuseOptions: IFuseOptions<ContactRecord> = {
  ...fuseOptions,
  includeMatches: true
};

const SHORT_TEXT_QUERY_MAX_LENGTH = 4;

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es");

const isShortTextQuery = (query: string) =>
  query.length <= SHORT_TEXT_QUERY_MAX_LENGTH && /^\p{L}[\p{L}\p{N}]*$/u.test(query);

const startsAtTokenBoundary = (value: string, query: string) =>
  normalizeSearchText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => token.startsWith(query));

const hasShortTextBoundaryMatch = (result: FuseResult<ContactRecord>, query: string) =>
  result.matches?.some((match) => match.value && startsAtTokenBoundary(match.value, query)) ?? false;

const fuseCache = new WeakMap<ContactRecord[], Fuse<ContactRecord>>();
const shortTextFuseCache = new WeakMap<ContactRecord[], Fuse<ContactRecord>>();

export const normalizeTag = (value: string) => value.trim().toLocaleLowerCase("es");

const applyFilters = (records: ContactRecord[], filters: DirectoryFilters) =>
  {
    const normalizedSelectedTags = filters.selectedTags.map(normalizeTag);

    return records.filter((record) => {
    if (!filters.showInactive && record.status === "inactive") {
      return false;
    }

    if (filters.selectedType !== "all" && record.type !== filters.selectedType) {
      return false;
    }

    if (filters.selectedArea !== "all" && record.organization.area !== filters.selectedArea) {
      return false;
    }

    if (normalizedSelectedTags.length > 0) {
      const recordTags = new Set(record.tags.map(normalizeTag));

      if (!normalizedSelectedTags.some((tag) => recordTags.has(tag))) {
        return false;
      }
    }

    return true;
  });
  };

export const searchRecords = (records: ContactRecord[], query: string, filters: DirectoryFilters) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return applyFilters(records, filters);
  }

  const cachedFuse = fuseCache.get(records);
  const fuse = cachedFuse ?? new Fuse(records, fuseOptions);

  if (!cachedFuse) {
    fuseCache.set(records, fuse);
  }

  const normalizedSearchQuery = normalizeSearchText(normalizedQuery);
  const usesShortTextBoundaryMatching = isShortTextQuery(normalizedSearchQuery);
  let searchFuse = fuse;

  if (usesShortTextBoundaryMatching) {
    const cachedShortTextFuse = shortTextFuseCache.get(records);
    searchFuse = cachedShortTextFuse ?? new Fuse(records, shortTextFuseOptions, fuse.getIndex());

    if (!cachedShortTextFuse) {
      shortTextFuseCache.set(records, searchFuse);
    }
  }

  const fuseResults = searchFuse.search(normalizedQuery);
  const matchingResults = usesShortTextBoundaryMatching
    ? fuseResults.filter((result) => hasShortTextBoundaryMatch(result, normalizedSearchQuery))
    : fuseResults;

  return applyFilters(matchingResults.map((result) => result.item), filters);
};

export const getPreferredResultPhone = (record: ContactRecord) =>
  record.contactMethods.phones.find((phone) => !phone.confidential && !phone.noPatientSharing) ??
  record.contactMethods.phones.find((phone) => !phone.confidential) ??
  record.contactMethods.phones.find((phone) => phone.isPrimary) ??
  record.contactMethods.phones[0];

export const getPhonePrivacyFlags = (record: ContactRecord): PrivacyFlag[] => {
  const hasConfidentialPhone = record.contactMethods.phones.some((phone) => phone.confidential);

  const flags: PrivacyFlag[] = [];

  if (hasConfidentialPhone) {
    flags.push("Confidencial");
  }

  return flags;
};

/** @internal — for tests only */
export function _getFuseCacheEntry(records: ContactRecord[]): Fuse<ContactRecord> | undefined {
  return fuseCache.get(records);
}
