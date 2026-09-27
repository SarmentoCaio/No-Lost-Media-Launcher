import type { BiosImportResult, BiosScanResult, EmulatorInstallProgress, EmulatorSettings, Game, InstalledGame, InstallProgress, LauncherSettings, RemoveGameResult, RuntimeInfo } from "./models";

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
  checkBiosInstalled(system: string): Promise<boolean>;
  checkBiosExists?(system: string): Promise<boolean>;
  openEmulator?(emulatorId: string): Promise<void>;
  scanAndImportBios(): Promise<BiosScanResult>;
  importBiosZip(filePath?: string, targetSystem?: string): Promise<BiosImportResult>;
  openFolder(path?: string): Promise<void>;
  importLocalGame(game: Game): Promise<InstalledGame | null>;
  installGame(game: Game, onProgress: (progress: InstallProgress) => void): Promise<InstalledGame>;
  launchGame(game: Game): Promise<void>;
  removeGame(game: Game, deleteSaves: boolean): Promise<RemoveGameResult>;
}
