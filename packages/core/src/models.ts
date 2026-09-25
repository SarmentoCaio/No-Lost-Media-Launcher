export type SystemId =
  | "all"
  | "ps1"
  | "ps2"
  | "ps3"
  | "dreamcast"
  | "n64"
  | "snes"
  | "nes"
  | "gba"
  | "gamecube"
  | "wii"
  | "pc";

export type GameInstallState = "available" | "queued" | "retrying" | "paused" | "downloading" | "extracting" | "installed" | "error";

export interface Game {
  id: string;
  title: string;
  system: Exclude<SystemId, "all">;
  year?: number;
  genre?: string;
  region?: string;
  coverUrl?: string;
  fileSizeBytes?: number;
  fileSizeLabel?: string;
  sourceUrl?: string;
  fileName?: string;
  checksum?: string;
}

export interface InstalledGame {
  gameId: string;
  installedAt: string;
  lastPlayedAt?: string;
  playTimeMinutes: number;
  localPath?: string;
}

export interface DownloadTask {
  id: string;
  gameId: string;
  state: Exclude<GameInstallState, "available" | "installed">;
  progress: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  attempts?: number;
  queuedAt?: number;
}

export interface EmulatorDefinition {
  id: string;
  name: string;
  systems: readonly Exclude<SystemId, "all">[];
  installed: boolean;
  version?: string;
  managedInstall: boolean;
  downloadSizeBytes?: number;
  downloadSizeLabel?: string;
  sourceName?: string;
  setupNote?: string;
  biosImport: boolean;
}

export interface EmulatorInstallProgress {
  state: "queued" | "retrying" | "paused" | "downloading" | "extracting" | "configuring" | "error";
  progress: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  attempts?: number;
  queuedAt?: number;
}

export interface EmulatorVideoSettings {
  renderer: "auto" | "vulkan" | "d3d11" | "d3d12" | "opengl" | "software";
  internalResolution: number;
  aspectRatio: "auto" | "4:3" | "16:9" | "stretch";
  antiAliasing: AntiAliasingMode;
  textureFiltering: TextureFilteringMode;
  anisotropicFiltering: number;
  vsync: boolean;
  widescreenPatches: boolean;
  integerScaling: boolean;
  frameSkip: number;
  speedPercent: number;
}

export interface EmulatorAudioSettings {
  backend: "auto" | "cubeb" | "xaudio2" | "wasapi" | "sdl";
  volume: number;
  latencyMs: number;
  sync: boolean;
  muted: boolean;
}

export interface EmulatorControllerSettings {
  layout: "nes" | "snes" | "gba" | "n64" | "dreamcast" | "ps1" | "ps2" | "gamecube" | "wii";
  device: "auto" | "gamepad" | "keyboard";
  deadzone: number;
  sensitivity: number;
  rumble: boolean;
  bindings: Record<string, string>;
}

export interface EmulatorEmulationSettings {
  pauseWhenInactive: boolean;
  autoSave: boolean;
  rewind: boolean;
  cheats: boolean;
  fastForwardMultiplier: number;
}

export interface EmulatorSettings {
  emulatorId: string;
  video: EmulatorVideoSettings;
  audio: EmulatorAudioSettings;
  controller: EmulatorControllerSettings;
  emulation: EmulatorEmulationSettings;
  hotkeys: Record<string, string>;
}

export interface RuntimeCapabilities {
  platform: "browser" | "windows" | "android" | "ios" | "unknown";
  nativeGameLaunch: boolean;
  filesystemAccess: boolean;
  backgroundDownloads: boolean;
  controllerNavigation: boolean;
}

export type QualityPreset = "auto" | "low" | "medium" | "high" | "ultra" | "custom";
export type AntiAliasingMode = "off" | "fxaa" | "msaa2" | "msaa4" | "msaa8";
export type TextureFilteringMode = "nearest" | "bilinear" | "trilinear";

export interface GraphicsSettings {
  internalResolution: number;
  antiAliasing: AntiAliasingMode;
  textureFiltering: TextureFilteringMode;
  anisotropicFiltering: number;
  vsync: boolean;
  frameLimit: number;
}

export interface LauncherSettings {
  masterVolume: number;
  muted: boolean;
  startFullscreen: boolean;
  pauseWhenInactive: boolean;
  autoSave: boolean;
  controllerMode: "auto" | "xinput" | "playstation" | "keyboard";
  qualityPreset: QualityPreset;
  graphics: GraphicsSettings;
}

export interface HardwareProfile {
  logicalCores: number;
  memoryGb?: number;
  gpuName?: string;
  gpuMemoryGb?: number;
  recommendedQuality: Exclude<QualityPreset, "auto" | "custom">;
}

export interface RuntimeInfo {
  mode: "preview" | "native";
  capabilities: RuntimeCapabilities;
  libraryPath?: string;
  emulators: EmulatorDefinition[];
  settings: LauncherSettings;
  hardwareProfile: HardwareProfile;
}

export interface InstallProgress {
  state: "queued" | "downloading" | "extracting";
  progress: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
}
