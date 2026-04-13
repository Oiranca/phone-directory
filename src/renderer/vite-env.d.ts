/// <reference types="vite/client" />

import type { AppSettings, BootstrapData } from "../shared/types/contact";

declare global {
  interface Window {
    hospitalDirectory: {
      getBootstrapData: () => Promise<BootstrapData>;
      saveSettings: (settings: AppSettings) => Promise<AppSettings>;
      createBackup: () => Promise<string>;
    };
  }
}

export {};
