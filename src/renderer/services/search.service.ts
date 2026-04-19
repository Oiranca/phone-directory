import Fuse from "fuse.js";
import type { IFuseOptions } from "fuse.js";
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import type { ContactRecord } from "../../shared/types/contact.js";

export interface DirectoryFilters {
  selectedType: RecordType | "all";
  selectedArea: AreaType | "all";
  showInactive: boolean;
}

const fuseOptions: IFuseOptions<ContactRecord> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.28,
  keys: [
    { name: "displayName", weight: 0.3 },
    { name: "aliases", weight: 0.18 },
    { name: "organization.department", weight: 0.14 },
    { name: "organization.service", weight: 0.12 },
    { name: "organization.specialty", weight: 0.07 },
    { name: "organization.area", weight: 0.05 },
    { name: "tags", weight: 0.04 },
    { name: "contactMethods.phones.number", weight: 0.06 },
    { name: "contactMethods.phones.extension", weight: 0.02 },
    { name: "contactMethods.phones.label", weight: 0.01 },
    { name: "contactMethods.emails.address", weight: 0.01 }
  ]
};

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
  const filteredRecords = applyFilters(records, filters);
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return filteredRecords;
  }

  const fuse = new Fuse(filteredRecords, fuseOptions);
  return fuse.search(normalizedQuery).map((result) => result.item);
};

export const getPreferredResultPhone = (record: ContactRecord) =>
  record.contactMethods.phones.find((phone) => !phone.confidential && !phone.noPatientSharing) ??
  record.contactMethods.phones.find((phone) => !phone.confidential) ??
  record.contactMethods.phones.find((phone) => phone.isPrimary) ??
  record.contactMethods.phones[0];

export const getPhonePrivacyFlags = (record: ContactRecord) => {
  const flags = new Set<string>();

  record.contactMethods.phones.forEach((phone) => {
    if (phone.confidential) {
      flags.add("Confidencial");
    }

    if (phone.noPatientSharing) {
      flags.add("No facilitar a pacientes");
    }
  });

  return Array.from(flags);
};
