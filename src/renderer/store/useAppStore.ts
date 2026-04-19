import { create } from "zustand";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import type { BootstrapData, ContactRecord, DirectoryDataset, EditableAppSettings } from "../../shared/types/contact";
import { searchRecords } from "../services/search.service";

interface AppStore {
  contacts: DirectoryDataset | null;
  settings: EditableAppSettings | null;
  selectedRecordId: string | null;
  query: string;
  selectedType: RecordType | "all";
  selectedArea: AreaType | "all";
  showInactive: boolean;
  isLoading: boolean;
  initialize: (payload: BootstrapData) => void;
  setQuery: (query: string) => void;
  setSelectedType: (type: RecordType | "all") => void;
  setSelectedArea: (area: AreaType | "all") => void;
  setShowInactive: (showInactive: boolean) => void;
  setSelectedRecordId: (id: string | null) => void;
  setSettings: (settings: EditableAppSettings) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  contacts: null,
  settings: null,
  selectedRecordId: null,
  query: "",
  selectedType: "all",
  selectedArea: "all",
  showInactive: false,
  isLoading: true,
  initialize: (payload) =>
    set({
      contacts: payload.contacts,
      settings: payload.settings,
      selectedRecordId: payload.contacts.records[0]?.id ?? null,
      selectedType: "all",
      selectedArea: "all",
      showInactive: payload.settings.ui.showInactiveByDefault,
      isLoading: false
    }),
  setQuery: (query) => set({ query }),
  setSelectedType: (selectedType) => set({ selectedType }),
  setSelectedArea: (selectedArea) => set({ selectedArea }),
  setShowInactive: (showInactive) => set({ showInactive }),
  setSelectedRecordId: (selectedRecordId) => set({ selectedRecordId }),
  setSettings: (settings) => set({ settings })
}));

export const selectVisibleRecords = (
  records: ContactRecord[],
  query: string,
  filters: {
    selectedType: RecordType | "all";
    selectedArea: AreaType | "all";
    showInactive: boolean;
  }
) => searchRecords(records, query, filters);
