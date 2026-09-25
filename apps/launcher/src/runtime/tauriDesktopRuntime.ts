import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { EmulatorInstallProgress, EmulatorSettings, Game, InstalledGame, InstallProgress, LauncherSettings, PlatformRuntime, RemoveGameResult, RuntimeInfo } from "@nlm/core";

export class TauriDesktopRuntime implements PlatformRuntime {
  getInfo(): Promise<RuntimeInfo> {
    return invoke<RuntimeInfo>("runtime_info");
  }

  listInstalledGames(): Promise<InstalledGame[]> {
    return invoke<InstalledGame[]>("list_installed_games");
  }

  async chooseLibrary(): Promise<RuntimeInfo | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Escolha a pasta da biblioteca No Lost Media",
    });
    if (typeof selected !== "string") return null;
    return invoke<RuntimeInfo>("configure_library", { path: selected });
  }

  async configureEmulator(emulatorId: string): Promise<RuntimeInfo | null> {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selecione o executável do emulador",
      filters: [{ name: "Aplicativo Windows", extensions: ["exe"] }],
    });
    if (typeof selected !== "string") return null;
    return invoke<RuntimeInfo>("configure_emulator", { emulatorId, executablePath: selected });
  }

  installEmulator(emulatorId: string, onProgress: (progress: EmulatorInstallProgress) => void): Promise<RuntimeInfo> {
    const onEvent = new Channel<EmulatorInstallProgress>();
    onEvent.onmessage = onProgress;
    return invoke<RuntimeInfo>("install_emulator", { emulatorId, onEvent });
  }

  cancelDownload(kind: "game" | "emulator", id: string, discard = false): Promise<void> {
    return invoke<void>("cancel_download", { kind, id, discard });
  }

  saveSettings(settings: LauncherSettings): Promise<RuntimeInfo> {
    return invoke<RuntimeInfo>("save_settings", { settings });
  }

  getEmulatorSettings(emulatorId: string): Promise<EmulatorSettings> {
    return invoke<EmulatorSettings>("get_emulator_settings", { emulatorId });
  }

  saveEmulatorSettings(settings: EmulatorSettings): Promise<EmulatorSettings> {
    return invoke<EmulatorSettings>("save_emulator_settings", { settings });
  }

  async importBios(emulatorId: string): Promise<boolean> {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Selecione a BIOS extraída do seu próprio console",
      filters: [{ name: "Arquivo de BIOS", extensions: ["bin", "rom"] }],
    });
    if (typeof selected !== "string") return false;
    await invoke<void>("import_bios", { emulatorId, filePath: selected });
    return true;
  }

  async importLocalGame(game: Game): Promise<InstalledGame | null> {
    const selected = await open({
      multiple: false,
      directory: false,
      title: `Selecione o arquivo de ${game.title}`,
      filters: [{
        name: "Arquivo do jogo",
        extensions: game.system === "ps2"
          ? ["iso", "bin", "chd", "cso"]
          : game.system === "ps1"
            ? ["chd", "cue", "bin", "pbp"]
            : ["zip", "7z", "nes", "sfc", "smc", "gba", "z64", "n64", "v64", "gdi", "cdi", "iso", "chd", "rvz", "wbfs"],
      }],
    });
    if (typeof selected !== "string") return null;
    return invoke<InstalledGame>("import_local_game", { game, filePath: selected });
  }

  async installGame(game: Game, onProgress: (progress: InstallProgress) => void): Promise<InstalledGame> {
    const onEvent = new Channel<InstallProgress>();
    onEvent.onmessage = onProgress;
    return invoke<InstalledGame>("install_game", { game, onEvent });
  }

  launchGame(game: Game): Promise<void> {
    return invoke<void>("launch_game", { game });
  }

  removeGame(game: Game, deleteSaves: boolean): Promise<RemoveGameResult> {
    return invoke<RemoveGameResult>("remove_game", { game, deleteSaves });
  }
}
