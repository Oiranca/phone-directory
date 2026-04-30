import { create } from "zustand";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import type {
  BootstrapData,
  ContactRecord,
  DirectoryDataset,
  EditableAppSettings,
  RecoveryState
} from "../../shared/types/contact";
import type { DirectoryFilters } from "../services/search.service";
import { searchRecords } from "../services/search.service";

interface AppStore {
  contacts: DirectoryDataset | null;
  settings: EditableAppSettings | null;
  recovery: RecoveryState | null;
  selectedRecordId: string | null;
  query: string;
  selectedType: RecordType | "all";
  selectedArea: AreaType | "all";
  selectedTags: string[];
  showInactive: boolean;
  isLoading: boolean;
  initialize: (payload: BootstrapData) => void;
  initializeRecovery: (recovery: RecoveryState, settings: EditableAppSettings) => void;
  setIsLoading: (isLoading: boolean) => void;
  setQuery: (query: string) => void;
  setSelectedType: (type: RecordType | "all") => void;
  setSelectedArea: (area: AreaType | "all") => void;
  setSelectedTags: (tags: string[]) => void;
  setShowInactive: (showInactive: boolean) => void;
  setSelectedRecordId: (id: string | null) => void;
  setSettings: (settings: EditableAppSettings) => void;
  setContacts: (contacts: DirectoryDataset) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  contacts: null,
  settings: null,
  recovery: null,
  selectedRecordId: null,
  query: "",
  selectedType: "all",
  selectedArea: "all",
  selectedTags: [],
  showInactive: false,
  isLoading: true,
  initialize: (payload) =>
    set({
      contacts: payload.contacts,
      settings: payload.settings,
      recovery: null,
      selectedRecordId: payload.contacts.records[0]?.id ?? null,
      selectedType: "all",
      selectedArea: "all",
      selectedTags: [],
      showInactive: payload.settings.ui.showInactiveByDefault,
      isLoading: false
    }),
  initializeRecovery: (recovery, settings) =>
    set({
      contacts: null,
      settings,
      recovery,
      selectedRecordId: null,
      selectedType: "all",
      selectedArea: "all",
      selectedTags: [],
      showInactive: settings.ui.showInactiveByDefault,
      isLoading: false
    }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setQuery: (query) => set({ query }),
  setSelectedType: (selectedType) => set({ selectedType }),
  setSelectedArea: (selectedArea) => set({ selectedArea }),
  setSelectedTags: (selectedTags) => set({ selectedTags }),
  setShowInactive: (showInactive) => set({ showInactive }),
  setSelectedRecordId: (selectedRecordId) => set({ selectedRecordId }),
  setSettings: (settings) => set({ settings }),
  setContacts: (contacts) => set({ contacts })
}));

export const selectVisibleRecords = (
  records: ContactRecord[],
  query: string,
  filters: DirectoryFilters
) => searchRecords(records, query, filters);
