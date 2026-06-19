import { create } from "zustand";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import type {
  BootstrapData,
  ContactRecord,
  DirectoryDataset,
  EditableAppSettings,
  RecoveryState
} from "../../shared/types/contact";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import type { DirectoryFilters } from "../services/search.service";
import { searchRecords } from "../services/search.service";

export type BootstrapStatus = "idle" | "loading" | "success" | "error";

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
  bootstrapStatus: BootstrapStatus;
  bootstrapError: string;
  bootstrapHelp: string;
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
  applyMergeResult: (survivor: ContactRecord, discardedId: string) => void;
  ensureBootstrapLoaded: () => Promise<void>;
}

// Module-level in-flight guard: ensures at most one bootstrap IPC call in progress
// regardless of how many concurrent callers invoke ensureBootstrapLoaded.
let bootstrapInFlight: Promise<void> | null = null;

/** Reset the in-flight guard. Call this in test teardown after resetting store state. */
export function resetBootstrapInFlight() {
  bootstrapInFlight = null;
}

export const useAppStore = create<AppStore>((set, get) => ({
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
  bootstrapStatus: "idle",
  bootstrapError: "",
  bootstrapHelp: "",
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
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
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
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setQuery: (query) => set({ query }),
  setSelectedType: (selectedType) => set({ selectedType }),
  setSelectedArea: (selectedArea) => set({ selectedArea }),
  setSelectedTags: (selectedTags) => set({ selectedTags }),
  setShowInactive: (showInactive) => set({ showInactive }),
  setSelectedRecordId: (selectedRecordId) => set({ selectedRecordId }),
  setSettings: (settings) => set({ settings }),
  setContacts: (contacts) => set({ contacts }),
  applyMergeResult: (survivor, discardedId) =>
    set((state) => {
      if (!state.contacts) return {};
      const records = state.contacts.records
        .filter((r) => r.id !== discardedId)
        .map((r) => (r.id === survivor.id ? survivor : r));
      const selectedRecordId =
        state.selectedRecordId === discardedId ? survivor.id : state.selectedRecordId;
      return {
        contacts: { ...state.contacts, records },
        selectedRecordId
      };
    }),
  ensureBootstrapLoaded: () => {
    const state = get();

    // Success: already loaded — no-op
    if (state.bootstrapStatus === "success") {
      return Promise.resolve();
    }

    // In-flight: share the existing promise so concurrent callers wait on the
    // same load and at most one IPC call is ever made at a time.
    if (bootstrapInFlight !== null) {
      return bootstrapInFlight;
    }

    // Error: allow retry (fall through to start a new load)

    // Synchronous bridge-presence check: if the IPC bridge is not available
    // we set the error state and return immediately WITHOUT touching
    // bootstrapInFlight, so a later retry (once the bridge exists) is not
    // blocked by a stale resolved promise left in the module-level guard.
    // We skip the set() call when the status is already "error" and the bridge
    // is still absent — the store already reflects this error, so writing it
    // again is a redundant render. When the bridge later becomes present the
    // check below passes and we fall through to start a real load.
    if (typeof window.hospitalDirectory?.getBootstrapData !== "function") {
      if (state.bootstrapStatus !== "error") {
        set({
          bootstrapStatus: "error",
          isLoading: false,
          bootstrapError: "La interfaz abierta en el navegador no puede acceder a los datos locales.",
          bootstrapHelp: "Usa la ventana de Electron que arranca con `pnpm dev`. La URL http://localhost:5173 solo sirve como renderer de desarrollo."
        });
      }
      return Promise.resolve();
    }

    const run = async () => {
      try {
        set({ bootstrapStatus: "loading", isLoading: true, bootstrapError: "", bootstrapHelp: "" });

        try {
          const payload = await window.hospitalDirectory.getBootstrapData();

          if (isRecoveryBootstrap(payload)) {
            get().initializeRecovery(payload.recovery, payload.settings);
            return;
          }

          get().initialize(payload);
        } catch (error) {
          console.error("[AppStore] Bootstrap failed:", error);
          set({
            bootstrapStatus: "error",
            isLoading: false,
            bootstrapError: "No se pudieron cargar los datos locales. Revisa la configuración o importa una copia válida.",
            bootstrapHelp: ""
          });
        }
      } finally {
        bootstrapInFlight = null;
      }
    };

    bootstrapInFlight = run();
    return bootstrapInFlight;
  }
}));

export const selectVisibleRecords = (
  records: ContactRecord[],
  query: string,
  filters: DirectoryFilters
) => searchRecords(records, query, filters);
