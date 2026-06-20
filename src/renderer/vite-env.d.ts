/// <reference types="vite/client" />

import type { HospitalDirectoryApi } from "../shared/ipc/api";

declare global {
  interface Window {
    hospitalDirectory: HospitalDirectoryApi;
  }
}

export {};
