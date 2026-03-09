/// <reference types="vite/client" />

declare global {
  interface Window {
    electron?: { isElectron: true };
  }
}
