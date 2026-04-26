import { beforeEach, describe, expect, it } from "vitest";
import { selectVisibleRecords, useAppStore } from "./useAppStore";
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

    const filters = { selectedType: "all" as const, selectedArea: "all" as const, showInactive: true };

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
        showInactive: false
      })
    ).toEqual([active]);

    expect(
      selectVisibleRecords([active, inactive], "", {
        selectedType: "external-center",
        selectedArea: "otros",
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
  useAppStore.setState({
    contacts: null,
    settings: null,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    showInactive: false,
    isLoading: true
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
      useAppStore.setState({ selectedType: "person", selectedArea: "otros" });
      useAppStore.getState().initialize(bootstrapPayload);
      const state = useAppStore.getState();
      expect(state.selectedType).toBe("all");
      expect(state.selectedArea).toBe("all");
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
      useAppStore.setState({ selectedType: "service", selectedArea: "especialidades" });
      useAppStore.getState().initializeRecovery(recoveryState, defaultSettings);
      const state = useAppStore.getState();
      expect(state.selectedType).toBe("all");
      expect(state.selectedArea).toBe("all");
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
});
