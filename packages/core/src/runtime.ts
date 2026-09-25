import type { EmulatorInstallProgress, EmulatorSettings, Game, InstalledGame, InstallProgress, LauncherSettings, RuntimeInfo } from "./models";

export interface PlatformRuntime {
  getInfo(): Promise<RuntimeInfo>;
  listInstalledGames(): Promise<InstalledGame[]>;
  chooseLibrary(): Promise<RuntimeInfo | null>;
  configureEmulator(emulatorId: string): Promise<RuntimeInfo | null>;
  installEmulator(emulatorId: string, onProgress: (progress: EmulatorInstallProgress) => void): Promise<RuntimeInfo>;
  cancelDownload(kind: "game" | "emulator", id: string, discard?: boolean): Promise<void>;
  saveSettings(settings: LauncherSettings): Promise<RuntimeInfo>;
  getEmulatorSettings(emulatorId: string): Promise<EmulatorSettings>;
  saveEmulatorSettings(settings: EmulatorSettings): Promise<EmulatorSettings>;
  importBios(emulatorId: string): Promise<boolean>;
  importLocalGame(game: Game): Promise<InstalledGame | null>;
  installGame(game: Game, onProgress: (progress: InstallProgress) => void): Promise<InstalledGame>;
  launchGame(game: Game): Promise<void>;
  removeGame(gameId: string): Promise<void>;
}
