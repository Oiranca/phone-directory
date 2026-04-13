/// <reference types="vite/client" />

import type { BootstrapData, EditableAppSettings } from "../shared/types/contact";

declare global {
  interface Window {
    hospitalDirectory: {
      getBootstrapData: () => Promise<BootstrapData>;
      saveSettings: (settings: EditableAppSettings) => Promise<EditableAppSettings>;
      createBackup: () => Promise<void>;
    };
  }
}

export {};
