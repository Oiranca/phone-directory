import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectVisibleRecords, useAppStore, resetBootstrapInFlight } from "./useAppStore";
import type { BootstrapData, EditableAppSettings, RecoveryState } from "../../shared/types/contact";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { getPhonePrivacyFlags, getPreferredResultPhone } from "../services/search.service";

describe("selectVisibleRecords", () => {
  it("matches operational search fields beyond the display name", () => {
    const record = structuredClone(defaultContacts.records[0]);
    record.person = { firstName: "Ana", lastName: "Pérez" };
    record.location = { building: "Hospital General", floor: "Planta 2", room: "Sala 12", text: "Control norte" };
    record.notes = "Cobertura de noche";
    record.tags = ["triaje"];
    record.contactMethods.phones[0].extension = "1234";
    record.contactMethods.phones[0].notes = "Solo uso interno";
    record.contactMethods.emails = [{ id: "email_1", address: "ana.perez@hospital.local", label: "Laboral", isPrimary: true }];

    const filters = { selectedType: "all" as const, selectedArea: "all" as const, selectedTags: [], showInactive: true };

    expect(selectVisibleRecords([record], "1234", filters)).toHaveLength(1);
    expect(selectVisibleRecords([record], "admisión", filters)).toHaveLength(1);
    expect(selectVisibleRecords([record], "ana.perez@hospital.local", filters)).toHaveLength(1);
  });

  it("filters by type, area, and inactive visibility", () => {
    const active = structuredClone(defaultContacts.records[0]);
    const inactive = structuredClone(defaultContacts.records[1]);
    inactive.status = "inactive";

    expect(
      selectVisibleRecords([active, inactive], "", {
        selectedType: "all",
        selectedArea: "all",
        selectedTags: [],
        showInactive: false
      })
    ).toEqual([active]);

    expect(
      selectVisibleRecords([active, inactive], "", {
        selectedType: "external-center",
        selectedArea: "otros",
        selectedTags: [],
        showInactive: true
      })
    ).toEqual([inactive]);
  });
});

describe("search service helpers", () => {
  it("prefers a non-sensitive phone for result cards", () => {
    const record = structuredClone(defaultContacts.records[0]);
    record.contactMethods.phones = [
      {
        ...record.contactMethods.phones[0],
        id: "sensitive",
        number: "999",
        confidential: true,
        noPatientSharing: true,
        isPrimary: true
      },
      {
        ...record.contactMethods.phones[0],
        id: "safe",
        number: "111",
        confidential: false,
        noPatientSharing: false,
        isPrimary: false
      }
    ];

    expect(getPreferredResultPhone(record)?.number).toBe("111");
    expect(getPhonePrivacyFlags(record)).toEqual(["Confidencial", "No facilitar a pacientes"]);
  });

  it("returns privacy flags in a stable priority order", () => {
    const record = structuredClone(defaultContacts.records[0]);
    record.contactMethods.phones = [
      {
        ...record.contactMethods.phones[0],
        id: "no-patient-sharing-first",
        noPatientSharing: true,
        confidential: false
      },
      {
        ...record.contactMethods.phones[0],
        id: "confidential-second",
        noPatientSharing: false,
        confidential: true
      }
    ];

    expect(getPhonePrivacyFlags(record)).toEqual(["Confidencial", "No facilitar a pacientes"]);
  });
});

// ─── Store Action Tests ───────────────────────────────────────────────────────

const defaultSettings: EditableAppSettings = {
  editorName: "Test Editor",
  dataFilePath: "/data/contacts.json",
  backupDirectoryPath: "/data/backups",
  ui: { showInactiveByDefault: false }
};

const bootstrapPayload: BootstrapData = {
  contacts: defaultContacts,
  settings: defaultSettings
};

const recoveryState: RecoveryState = {
  reason: "invalid-contacts-json",
  contactsFilePath: "/data/contacts.json",
  message: "Failed to parse contacts"
};

function resetStore() {
  resetBootstrapInFlight();
  useAppStore.setState({
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
    bootstrapHelp: ""
  });
}

describe("useAppStore actions", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("initialize", () => {
    it("loads contacts and settings, selects first record, clears recovery", () => {
      useAppStore.getState().initialize(bootstrapPayload);
      const state = useAppStore.getState();
      expect(state.contacts).toBe(defaultContacts);
      expect(state.settings).toBe(defaultSettings);
      expect(state.recovery).toBeNull();
      expect(state.selectedRecordId).toBe(defaultContacts.records[0].id);
      expect(state.selectedType).toBe("all");
      expect(state.selectedArea).toBe("all");
      expect(state.selectedTags).toEqual([]);
      expect(state.showInactive).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("respects showInactiveByDefault from settings", () => {
      const settings: EditableAppSettings = {
        editorName: "T",
        dataFilePath: "/data/contacts.json",
        backupDirectoryPath: "/data/backups",
        ui: { showInactiveByDefault: true }
      };
      useAppStore.getState().initialize({ contacts: defaultContacts, settings });
      expect(useAppStore.getState().showInactive).toBe(true);
    });

    it("sets selectedRecordId to null when dataset has no records", () => {
      const empty = { ...defaultContacts, records: [] };
      useAppStore.getState().initialize({ contacts: empty, settings: defaultSettings });
      expect(useAppStore.getState().selectedRecordId).toBeNull();
    });

    it("resets filters to all", () => {
      useAppStore.setState({ selectedType: "person", selectedArea: "otros", selectedTags: ["urgencias"] });
      useAppStore.getState().initialize(bootstrapPayload);
      const state = useAppStore.getState();
      expect(state.selectedType).toBe("all");
      expect(state.selectedArea).toBe("all");
      expect(state.selectedTags).toEqual([]);
    });
  });

  describe("initializeRecovery", () => {
    it("sets recovery mode, clears contacts and selectedRecordId", () => {
      useAppStore.getState().initializeRecovery(recoveryState, defaultSettings);
      const state = useAppStore.getState();
      expect(state.contacts).toBeNull();
      expect(state.recovery).toBe(recoveryState);
      expect(state.settings).toBe(defaultSettings);
      expect(state.selectedRecordId).toBeNull();
      expect(state.selectedTags).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it("respects showInactiveByDefault in recovery mode", () => {
      const settings: EditableAppSettings = {
        editorName: "T",
        dataFilePath: "/data/contacts.json",
        backupDirectoryPath: "/data/backups",
        ui: { showInactiveByDefault: true }
      };
      useAppStore.getState().initializeRecovery(recoveryState, settings);
      expect(useAppStore.getState().showInactive).toBe(true);
    });

    it("resets filters to all in recovery mode", () => {
      useAppStore.setState({ selectedType: "service", selectedArea: "especialidades", selectedTags: ["admisión"] });
      useAppStore.getState().initializeRecovery(recoveryState, defaultSettings);
      const state = useAppStore.getState();
      expect(state.selectedType).toBe("all");
      expect(state.selectedArea).toBe("all");
      expect(state.selectedTags).toEqual([]);
    });
  });

  describe("setIsLoading", () => {
    it("sets loading true", () => {
      useAppStore.setState({ isLoading: false });
      useAppStore.getState().setIsLoading(true);
      expect(useAppStore.getState().isLoading).toBe(true);
    });

    it("sets loading false", () => {
      useAppStore.getState().setIsLoading(false);
      expect(useAppStore.getState().isLoading).toBe(false);
    });
  });

  describe("setQuery", () => {
    it("updates the search query", () => {
      useAppStore.getState().setQuery("urgencias");
      expect(useAppStore.getState().query).toBe("urgencias");
    });

    it("clears the query", () => {
      useAppStore.setState({ query: "something" });
      useAppStore.getState().setQuery("");
      expect(useAppStore.getState().query).toBe("");
    });
  });

  describe("setSelectedType", () => {
    it("sets a specific record type", () => {
      useAppStore.getState().setSelectedType("person");
      expect(useAppStore.getState().selectedType).toBe("person");
    });

    it("resets to all", () => {
      useAppStore.setState({ selectedType: "service" });
      useAppStore.getState().setSelectedType("all");
      expect(useAppStore.getState().selectedType).toBe("all");
    });
  });

  describe("setSelectedArea", () => {
    it("sets a specific area", () => {
      useAppStore.getState().setSelectedArea("sanitaria-asistencial");
      expect(useAppStore.getState().selectedArea).toBe("sanitaria-asistencial");
    });

    it("resets to all", () => {
      useAppStore.setState({ selectedArea: "otros" });
      useAppStore.getState().setSelectedArea("all");
      expect(useAppStore.getState().selectedArea).toBe("all");
    });
  });

  describe("setSelectedTags", () => {
    it("sets selected tags", () => {
      useAppStore.getState().setSelectedTags(["admisión"]);
      expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    });

    it("clears selected tags", () => {
      useAppStore.setState({ selectedTags: ["urgencias"] });
      useAppStore.getState().setSelectedTags([]);
      expect(useAppStore.getState().selectedTags).toEqual([]);
    });
  });

  describe("setShowInactive", () => {
    it("enables showing inactive records", () => {
      useAppStore.getState().setShowInactive(true);
      expect(useAppStore.getState().showInactive).toBe(true);
    });

    it("disables showing inactive records", () => {
      useAppStore.setState({ showInactive: true });
      useAppStore.getState().setShowInactive(false);
      expect(useAppStore.getState().showInactive).toBe(false);
    });
  });

  describe("setSelectedRecordId", () => {
    it("sets a record id", () => {
      useAppStore.getState().setSelectedRecordId("cnt_0001");
      expect(useAppStore.getState().selectedRecordId).toBe("cnt_0001");
    });

    it("clears the selection", () => {
      useAppStore.setState({ selectedRecordId: "cnt_0001" });
      useAppStore.getState().setSelectedRecordId(null);
      expect(useAppStore.getState().selectedRecordId).toBeNull();
    });
  });

  describe("setSettings", () => {
    it("updates settings", () => {
      const newSettings: EditableAppSettings = {
        editorName: "Dr. García",
        dataFilePath: "/data/contacts.json",
        backupDirectoryPath: "/data/backups",
        ui: { showInactiveByDefault: true }
      };
      useAppStore.getState().setSettings(newSettings);
      expect(useAppStore.getState().settings).toBe(newSettings);
    });
  });

  describe("setContacts", () => {
    it("replaces the contacts dataset", () => {
      const updated = { ...defaultContacts, version: "2.0.0" };
      useAppStore.getState().setContacts(updated);
      expect(useAppStore.getState().contacts).toBe(updated);
    });

    it("does not affect other state slices", () => {
      useAppStore.setState({ query: "test", selectedRecordId: "cnt_0001" });
      useAppStore.getState().setContacts(defaultContacts);
      const state = useAppStore.getState();
      expect(state.query).toBe("test");
      expect(state.selectedRecordId).toBe("cnt_0001");
    });
  });

  describe("applyMergeResult", () => {
    const survivor = {
      ...structuredClone(defaultContacts.records[0]),
      id: "cnt_0001",
      displayName: "Admisión General (fusionado)"
    };
    const discardedId = "cnt_0002";

    beforeEach(() => {
      useAppStore.getState().initialize(bootstrapPayload);
    });

    it("removes the discarded record from the store", () => {
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      const records = useAppStore.getState().contacts!.records;
      expect(records.find((r) => r.id === discardedId)).toBeUndefined();
    });

    it("updates the survivor record in the store with merged fields", () => {
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      const records = useAppStore.getState().contacts!.records;
      const found = records.find((r) => r.id === survivor.id);
      expect(found).toBeDefined();
      expect(found!.displayName).toBe("Admisión General (fusionado)");
    });

    it("leaves other records untouched", () => {
      const before = useAppStore.getState().contacts!.records.length;
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      const after = useAppStore.getState().contacts!.records.length;
      // one record removed, survivor updated in place
      expect(after).toBe(before - 1);
    });

    it("redirects selectedRecordId to survivor when the discarded record was selected", () => {
      useAppStore.setState({ selectedRecordId: discardedId });
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      expect(useAppStore.getState().selectedRecordId).toBe(survivor.id);
    });

    it("preserves selectedRecordId when an unrelated record was selected", () => {
      useAppStore.setState({ selectedRecordId: "cnt_0001" });
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      expect(useAppStore.getState().selectedRecordId).toBe("cnt_0001");
    });

    it("is a no-op when contacts is null", () => {
      useAppStore.setState({ contacts: null });
      // should not throw
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      expect(useAppStore.getState().contacts).toBeNull();
    });

    it("does not mutate the store when contacts is null (no partial mutation)", () => {
      useAppStore.setState({ contacts: null, selectedRecordId: "cnt_0001" });
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      expect(useAppStore.getState().selectedRecordId).toBe("cnt_0001");
    });

    it("post-merge in-memory records equal a fresh load of the same dataset", () => {
      useAppStore.getState().applyMergeResult(survivor, discardedId);
      const inMemoryRecords = useAppStore.getState().contacts!.records;

      // Simulate a reload: build the expected dataset as if persisted state was fetched fresh
      const reloadedContacts = {
        ...defaultContacts,
        records: defaultContacts.records
          .filter((r) => r.id !== discardedId)
          .map((r) => (r.id === survivor.id ? survivor : r))
      };
      useAppStore.getState().initialize({ contacts: reloadedContacts, settings: defaultSettings });
      const reloadedRecords = useAppStore.getState().contacts!.records;

      expect(inMemoryRecords).toEqual(reloadedRecords);
    });
  });
});

// ─── ensureBootstrapLoaded Tests ─────────────────────────────────────────────

describe("ensureBootstrapLoaded", () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue(bootstrapPayload)
      }
    });
  });

  it("loads bootstrap data and transitions to success status", async () => {
    await useAppStore.getState().ensureBootstrapLoaded();
    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("success");
    expect(state.contacts).toBe(bootstrapPayload.contacts);
    expect(state.settings).toBe(bootstrapPayload.settings);
    expect(state.isLoading).toBe(false);
    expect(state.bootstrapError).toBe("");
  });

  it("is idempotent — second call while status is success is a no-op", async () => {
    await useAppStore.getState().ensureBootstrapLoaded();
    await useAppStore.getState().ensureBootstrapLoaded();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls trigger AT MOST one in-flight load", async () => {
    // Fire two concurrent calls before either resolves
    const [, ] = await Promise.all([
      useAppStore.getState().ensureBootstrapLoaded(),
      useAppStore.getState().ensureBootstrapLoaded()
    ]);
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
  });

  it("transitions to error status and stores the error message on failure", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("IPC failed"));

    await useAppStore.getState().ensureBootstrapLoaded();
    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("error");
    expect(state.bootstrapError).toBe(
      "No se pudieron cargar los datos locales. Revisa la configuración o importa una copia válida."
    );
    expect(state.isLoading).toBe(false);
  });

  it("retries after a previous failure (error status allows retry)", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValueOnce(bootstrapPayload);

    await useAppStore.getState().ensureBootstrapLoaded();
    expect(useAppStore.getState().bootstrapStatus).toBe("error");

    // Second call should retry because status is "error"
    await useAppStore.getState().ensureBootstrapLoaded();
    expect(useAppStore.getState().bootstrapStatus).toBe("success");
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(2);
  });

  it("transitions to recovery mode when bootstrap returns recovery data", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: recoveryState,
      settings: defaultSettings
    });

    await useAppStore.getState().ensureBootstrapLoaded();
    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("success");
    expect(state.recovery).toBe(recoveryState);
    expect(state.contacts).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("sets an error with browser-context help when hospitalDirectory bridge is absent", async () => {
    // Remove the bridge
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: undefined
    });

    await useAppStore.getState().ensureBootstrapLoaded();
    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("error");
    expect(state.bootstrapError).toContain("navegador");
    expect(state.bootstrapHelp).toContain("pnpm dev");
    expect(state.isLoading).toBe(false);
  });

  it("absent-bridge: bootstrapInFlight is NOT set after the synchronous early exit", async () => {
    // Regression lock for FIX 1: the synchronous bridge-precheck must return
    // Promise.resolve() without ever assigning bootstrapInFlight. If it did assign
    // it, the immediately-resolved promise would remain in the guard and the next
    // call (with the bridge present) would return that stale resolved value and
    // never call getBootstrapData.
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: undefined
    });

    // First call — bridge absent → synchronous error, bootstrapInFlight stays null
    await useAppStore.getState().ensureBootstrapLoaded();
    expect(useAppStore.getState().bootstrapStatus).toBe("error");

    // Restore the bridge to simulate "Reintentar" after Electron reloads the preload
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue(bootstrapPayload)
      }
    });

    // Second call — bridge now present → must perform a real load, NOT return the
    // stale resolved promise that the old (buggy) code would have left in bootstrapInFlight.
    await useAppStore.getState().ensureBootstrapLoaded();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().bootstrapStatus).toBe("success");
  });

  it("absent-bridge error is retryable: bootstrapInFlight is cleared so a second call proceeds", async () => {
    // Simulate the state left by a prior absent-bridge failure:
    // bootstrapStatus is "error" and bootstrapInFlight is null (already reset by resetStore / resetBootstrapInFlight).
    // The bridge IS available (set up by beforeEach).
    useAppStore.setState({
      bootstrapStatus: "error",
      bootstrapError: "La interfaz abierta en el navegador no puede acceder a los datos locales.",
      bootstrapHelp: "Usa la ventana de Electron que arranca con `pnpm dev`. La URL http://localhost:5173 solo sirve como renderer de desarrollo.",
      isLoading: false
    });

    // ensureBootstrapLoaded must NOT return the stale resolved promise — it must
    // start a new load because status is "error" (not "success") and no in-flight
    // promise exists. If bootstrapInFlight were still set, getBootstrapData would
    // never be called and status would remain "error".
    await useAppStore.getState().ensureBootstrapLoaded();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().bootstrapStatus).toBe("success");
  });

  it("initialize sets bootstrapStatus to success and clears error fields", () => {
    // Simulate a prior error
    useAppStore.setState({ bootstrapStatus: "error", bootstrapError: "old error", bootstrapHelp: "old help" });
    useAppStore.getState().initialize(bootstrapPayload);
    const state = useAppStore.getState();
    expect(state.bootstrapStatus).toBe("success");
    expect(state.bootstrapError).toBe("");
    expect(state.bootstrapHelp).toBe("");
  });

  it("initializeRecovery sets bootstrapStatus to success", () => {
    useAppStore.getState().initializeRecovery(recoveryState, defaultSettings);
    expect(useAppStore.getState().bootstrapStatus).toBe("success");
  });
});
