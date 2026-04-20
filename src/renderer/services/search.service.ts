import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import type { ContactRecord } from "../../shared/types/contact.js";

export interface DirectoryFilters {
  selectedType: RecordType | "all";
  selectedArea: AreaType | "all";
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

const fuseCache = new WeakMap<ContactRecord[], Fuse<ContactRecord>>();

const applyFilters = (records: ContactRecord[], filters: DirectoryFilters) =>
  records.filter((record) => {
    if (!filters.showInactive && record.status === "inactive") {
      return false;
    }

    if (filters.selectedType !== "all" && record.type !== filters.selectedType) {
      return false;
    }

    if (filters.selectedArea !== "all" && record.organization.area !== filters.selectedArea) {
      return false;
    }

    return true;
  });

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

  return applyFilters(
    fuse.search(normalizedQuery).map((result) => result.item),
    filters
  );
};

export const getPreferredResultPhone = (record: ContactRecord) =>
  record.contactMethods.phones.find((phone) => !phone.confidential && !phone.noPatientSharing) ??
  record.contactMethods.phones.find((phone) => !phone.confidential) ??
  record.contactMethods.phones.find((phone) => phone.isPrimary) ??
  record.contactMethods.phones[0];

export const getPhonePrivacyFlags = (record: ContactRecord): PrivacyFlag[] => {
  let hasConfidentialPhone = false;
  let hasNoPatientSharingPhone = false;

  for (const phone of record.contactMethods.phones) {
    if (phone.confidential) {
      hasConfidentialPhone = true;
    }

    if (phone.noPatientSharing) {
      hasNoPatientSharingPhone = true;
    }

    if (hasConfidentialPhone && hasNoPatientSharingPhone) {
      break;
    }
  }

  const flags: PrivacyFlag[] = [];

  if (hasConfidentialPhone) {
    flags.push("Confidencial");
  }

  if (hasNoPatientSharingPhone) {
    flags.push("No facilitar a pacientes");
  }

  return flags;
};

/** @internal — for tests only */
export function _getFuseCacheEntry(records: ContactRecord[]): Fuse<ContactRecord> | undefined {
  return fuseCache.get(records);
}
