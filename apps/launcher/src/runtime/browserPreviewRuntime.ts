import type { EmulatorInstallProgress, EmulatorSettings, Game, InstalledGame, InstallProgress, LauncherSettings, PlatformRuntime, RuntimeInfo } from "@nlm/core";

const STORAGE_KEY = "nlm-launcher-preview-library-v1";
const defaultLibrary: InstalledGame[] = [
  {
    gameId: "shadow-colossus",
    installedAt: "2026-09-20T12:00:00.000Z",
    lastPlayedAt: "2026-09-23T21:30:00.000Z",
    playTimeMinutes: 326,
  },
  {
    gameId: "chrono-trigger",
    installedAt: "2026-09-18T12:00:00.000Z",
    playTimeMinutes: 84,
  },
];

const defaultSettings: LauncherSettings = {
  masterVolume: 100,
  muted: false,
  startFullscreen: true,
  pauseWhenInactive: true,
  autoSave: true,
  controllerMode: "auto",
  qualityPreset: "auto",
  graphics: {
    internalResolution: 3,
    antiAliasing: "fxaa",
    textureFiltering: "bilinear",
    anisotropicFiltering: 8,
    vsync: true,
    frameLimit: 60,
  },
};

let previewSettings = defaultSettings;
const previewEmulatorSettings = new Map<string, EmulatorSettings>();

function defaultEmulatorSettings(emulatorId: string): EmulatorSettings {
  return {
    emulatorId,
    video: { renderer: "auto", internalResolution: 3, aspectRatio: "auto", antiAliasing: "fxaa", textureFiltering: "bilinear", anisotropicFiltering: 8, vsync: true, widescreenPatches: false, integerScaling: false, frameSkip: 0, speedPercent: 100 },
    audio: { backend: "auto", volume: 100, latencyMs: 64, sync: true, muted: false },
    controller: { layout: emulatorId === "pcsx2" ? "ps2" : emulatorId === "duckstation" ? "ps1" : emulatorId === "dolphin" ? "gamecube" : "snes", device: "auto", deadzone: 15, sensitivity: 100, rumble: true, bindings: {} },
    emulation: { pauseWhenInactive: true, autoSave: true, rewind: false, cheats: false, fastForwardMultiplier: 2 },
    hotkeys: {},
  };
}

function readLibrary(): InstalledGame[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as InstalledGame[];
  } catch {
    // O modo de demonstração continua com a biblioteca inicial.
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultLibrary));
  return defaultLibrary;
}

function saveLibrary(library: InstalledGame[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class BrowserPreviewRuntime implements PlatformRuntime {
  private cancelledDownloads = new Set<string>();

  private async cancellableWait(kind: "game" | "emulator", id: string, ms: number): Promise<void> {
    await wait(ms);
    const key = `${kind}:${id}`;
    if (this.cancelledDownloads.delete(key)) throw new Error("DOWNLOAD_CANCELLED");
  }

  async getInfo(): Promise<RuntimeInfo> {
    return {
      mode: "preview",
      capabilities: {
        platform: "browser",
        nativeGameLaunch: false,
        filesystemAccess: false,
        backgroundDownloads: false,
        controllerNavigation: true,
      },
      settings: previewSettings,
      hardwareProfile: { logicalCores: navigator.hardwareConcurrency || 4, recommendedQuality: "high" },
      emulators: [
        { id: "pcsx2", name: "PCSX2", systems: ["ps2"], installed: true, version: "2.8.2", managedInstall: true, downloadSizeLabel: "24,5 MB", sourceName: "PCSX2 Team (oficial)", setupNote: "Você precisará adicionar a BIOS do seu próprio console.", biosImport: true },
        { id: "duckstation", name: "DuckStation", systems: ["ps1"], installed: true, version: "2026.09.12", managedInstall: true, downloadSizeLabel: "69,3 MB", sourceName: "DuckStation (oficial)", setupNote: "Você precisará adicionar a BIOS do seu próprio console.", biosImport: true },
        { id: "dolphin", name: "Dolphin", systems: ["gamecube", "wii"], installed: false, version: "2609", managedInstall: true, downloadSizeLabel: "19,1 MB", sourceName: "Dolphin Emulator (oficial)", biosImport: false },
        { id: "retroarch", name: "RetroArch", systems: ["nes", "snes", "gba", "n64", "dreamcast"], installed: true, version: "1.22.2", managedInstall: true, downloadSizeBytes: 432270762, downloadSizeLabel: "412 MB", sourceName: "Libretro (oficial)", setupNote: "Dreamcast pode exigir a BIOS do seu próprio console.", biosImport: false },
      ],
    };
  }

  async saveSettings(settings: LauncherSettings): Promise<RuntimeInfo> {
    previewSettings = settings;
    return this.getInfo();
  }

  async getEmulatorSettings(emulatorId: string): Promise<EmulatorSettings> {
    return previewEmulatorSettings.get(emulatorId) ?? defaultEmulatorSettings(emulatorId);
  }

  async saveEmulatorSettings(settings: EmulatorSettings): Promise<EmulatorSettings> {
    previewEmulatorSettings.set(settings.emulatorId, settings);
    return settings;
  }

  async listInstalledGames(): Promise<InstalledGame[]> {
    return readLibrary();
  }

  async chooseLibrary(): Promise<RuntimeInfo | null> {
    return this.getInfo();
  }

  async configureEmulator(): Promise<RuntimeInfo | null> {
    return this.getInfo();
  }

  async installEmulator(emulatorId: string, onProgress: (progress: EmulatorInstallProgress) => void): Promise<RuntimeInfo> {
    this.cancelledDownloads.delete(`emulator:${emulatorId}`);
    const stages: EmulatorInstallProgress[] = [
      { state: "queued", progress: 2, message: "Preparando instalação…" },
      { state: "downloading", progress: 38, message: "Baixando emulador e núcleos…" },
      { state: "extracting", progress: 82, message: "Extraindo pacotes…" },
      { state: "configuring", progress: 100, message: "Emulador pronto." },
    ];
    for (const stage of stages) {
      onProgress(stage);
      await this.cancellableWait("emulator", emulatorId, 300);
    }
    return this.getInfo();
  }

  async cancelDownload(kind: "game" | "emulator", id: string, _discard = false): Promise<void> {
    this.cancelledDownloads.add(`${kind}:${id}`);
  }

  async importBios(): Promise<boolean> {
    await wait(200);
    return true;
  }

  async importLocalGame(game: Game): Promise<InstalledGame | null> {
    return this.installGame(game, () => undefined);
  }

  async installGame(game: Game, onProgress: (progress: InstallProgress) => void): Promise<InstalledGame> {
    this.cancelledDownloads.delete(`game:${game.id}`);
    const stages: InstallProgress[] = [
      { state: "queued", progress: 2, message: "Preparando download…" },
      { state: "downloading", progress: 18, message: "Baixando… 18%" },
      { state: "downloading", progress: 46, message: "Baixando… 46%" },
      { state: "downloading", progress: 78, message: "Baixando… 78%" },
      { state: "extracting", progress: 91, message: "Extraindo e verificando…" },
      { state: "extracting", progress: 99, message: "Registrando na biblioteca…" },
    ];
    for (const stage of stages) {
      onProgress(stage);
      await this.cancellableWait("game", game.id, 360);
    }
    const installed: InstalledGame = {
      gameId: game.id,
      installedAt: new Date().toISOString(),
      playTimeMinutes: 0,
    };
    const library = readLibrary().filter((item) => item.gameId !== game.id);
    saveLibrary([...library, installed]);
    return installed;
  }

  async launchGame(): Promise<void> {
    await wait(250);
  }

  async removeGame(gameId: string): Promise<void> {
    saveLibrary(readLibrary().filter((item) => item.gameId !== gameId));
  }
}
