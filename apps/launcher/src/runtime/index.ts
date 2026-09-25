import type { PlatformRuntime } from "@nlm/core";
import { BrowserPreviewRuntime } from "./browserPreviewRuntime";
import { TauriDesktopRuntime } from "./tauriDesktopRuntime";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function createRuntime(): PlatformRuntime {
  return window.__TAURI_INTERNALS__ ? new TauriDesktopRuntime() : new BrowserPreviewRuntime();
}

