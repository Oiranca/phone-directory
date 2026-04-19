/// <reference types="vite/client" />

import type { BootstrapData, EditableAppSettings, EditableContactRecord, SaveContactResult } from "../shared/types/contact";

declare global {
  interface Window {
    hospitalDirectory: {
      getBootstrapData: () => Promise<BootstrapData>;
      saveSettings: (settings: EditableAppSettings) => Promise<EditableAppSettings>;
      createBackup: () => Promise<void>;
      createRecord: (record: EditableContactRecord) => Promise<SaveContactResult>;
      updateRecord: (recordId: string, record: EditableContactRecord) => Promise<SaveContactResult>;
    };
  }
}

export {};
