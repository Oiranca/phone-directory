import type { ContactRecord } from "../../shared/types/contact.js";
import { normalizePhoneForDedup } from "../../shared/utils/matching.js";

export const buildStableMergeKeys = (record: ContactRecord): string[] => {
  const normalized = (value?: string) => (value ?? "").trim().toLowerCase();
  const phoneNumbers = record.contactMethods.phones
    .map((phone) => normalizePhoneForDedup(phone.number))
    .filter(Boolean)
    .sort();
  const emailAddresses = record.contactMethods.emails
    .map((email) => normalized(email.address))
    .filter(Boolean)
    .sort();
  const keys = new Set<string>();
  const base = [
    normalized(record.type),
    normalized(record.organization.department),
    normalized(record.organization.service),
    normalized(record.location?.text)
  ].join("|");

  if (phoneNumbers.length > 0) keys.add(`${base}|phones:${phoneNumbers.join(",")}`);
  if (emailAddresses.length > 0) keys.add(`${base}|emails:${emailAddresses.join(",")}`);
  if (normalized(record.displayName) && phoneNumbers.length > 0) {
    keys.add(`${normalized(record.type)}|${normalized(record.displayName)}|phones:${phoneNumbers.join(",")}`);
  }

  return [...keys];
};

export const buildExistingRecordMatchIndexes = (records: ContactRecord[]) => {
  const byExternalId = new Map<string, number>();
  const byStableKey = new Map<string, number>();

  records.forEach((record, index) => {
    if (record.externalId && !byExternalId.has(record.externalId)) byExternalId.set(record.externalId, index);
    for (const stableKey of buildStableMergeKeys(record)) {
      if (!byStableKey.has(stableKey)) byStableKey.set(stableKey, index);
    }
  });

  return { byExternalId, byStableKey };
};
