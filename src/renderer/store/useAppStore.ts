import { create } from "zustand";
import type { BootstrapData, ContactRecord, DirectoryDataset, EditableAppSettings } from "../../shared/types/contact";

interface AppStore {
  contacts: DirectoryDataset | null;
  settings: EditableAppSettings | null;
  selectedRecordId: string | null;
  query: string;
  isLoading: boolean;
  initialize: (payload: BootstrapData) => void;
  setQuery: (query: string) => void;
  setSelectedRecordId: (id: string | null) => void;
  setSettings: (settings: EditableAppSettings) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  contacts: null,
  settings: null,
  selectedRecordId: null,
  query: "",
  isLoading: true,
  initialize: (payload) =>
    set({
      contacts: payload.contacts,
      settings: payload.settings,
      selectedRecordId: payload.contacts.records[0]?.id ?? null,
      isLoading: false
    }),
  setQuery: (query) => set({ query }),
  setSelectedRecordId: (selectedRecordId) => set({ selectedRecordId }),
  setSettings: (settings) => set({ settings })
}));

export const selectVisibleRecords = (records: ContactRecord[], query: string, showInactive: boolean) => {
  const normalizedQuery = query.trim().toLowerCase();
  return records.filter((record) => {
    if (!showInactive && record.status === "inactive") {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [
      record.displayName,
      record.person?.firstName,
      record.person?.lastName,
      record.organization.department,
      record.organization.service,
      record.organization.specialty,
      record.organization.area,
      record.location?.building,
      record.location?.floor,
      record.location?.room,
      record.location?.text,
      record.notes,
      ...record.aliases,
      ...record.tags,
      ...record.contactMethods.phones.flatMap((phone) => [
        phone.label,
        phone.number,
        phone.extension,
        phone.notes
      ]),
      ...record.contactMethods.emails.flatMap((email) => [email.label, email.address])
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedQuery));
  });
};
