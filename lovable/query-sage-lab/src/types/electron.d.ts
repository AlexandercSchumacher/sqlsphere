/**
 * TypeScript definitions for Electron API
 */

export interface ElectronAPI {
  getLocalBackendUrl: () => Promise<string>;
  isElectron: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

