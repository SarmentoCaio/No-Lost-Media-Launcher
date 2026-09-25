mod managed_emulators;
mod managed_games;

use chrono::Utc;
use managed_emulators::EmulatorInstallEvent;
use managed_games::GameInstallEvent;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{ipc::Channel, Emitter, Manager, State};

const SYSTEM_FOLDERS: &[&str] = &[
    "ps1",
    "ps2",
    "ps3",
    "dreamcast",
    "n64",
    "snes",
    "nes",
    "gba",
    "gamecube",
    "wii",
    "pc",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCapabilities {
    platform: &'static str,
    native_game_launch: bool,
    filesystem_access: bool,
    background_downloads: bool,
    controller_navigation: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorDefinition {
    id: &'static str,
    name: &'static str,
    systems: Vec<&'static str>,
    installed: bool,
    version: Option<String>,
    managed_install: bool,
    download_size_bytes: Option<u64>,
    download_size_label: Option<&'static str>,
    source_name: Option<&'static str>,
    setup_note: Option<&'static str>,
    bios_import: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    mode: &'static str,
    capabilities: RuntimeCapabilities,
    library_path: Option<String>,
    emulators: Vec<EmulatorDefinition>,
    settings: LauncherSettings,
    hardware_profile: HardwareProfile,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum QualityPreset {
    Auto,
    Low,
    Medium,
    High,
    Ultra,
    Custom,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphicsSettings {
    internal_resolution: u8,
    anti_aliasing: String,
    texture_filtering: String,
    anisotropic_filtering: u8,
    vsync: bool,
    frame_limit: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    master_volume: u8,
    muted: bool,
    start_fullscreen: bool,
    pause_when_inactive: bool,
    auto_save: bool,
    controller_mode: String,
    quality_preset: QualityPreset,
    graphics: GraphicsSettings,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorVideoSettings {
    renderer: String,
    internal_resolution: u8,
    aspect_ratio: String,
    anti_aliasing: String,
    texture_filtering: String,
    anisotropic_filtering: u8,
    vsync: bool,
    widescreen_patches: bool,
    integer_scaling: bool,
    frame_skip: u8,
    speed_percent: u16,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorAudioSettings {
    backend: String,
    volume: u8,
    latency_ms: u16,
    sync: bool,
    muted: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorControllerSettings {
    #[serde(default = "default_controller_layout")]
    layout: String,
    device: String,
    deadzone: u8,
    sensitivity: u16,
    rumble: bool,
    bindings: HashMap<String, String>,
}

fn default_controller_layout() -> String {
    "snes".into()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorEmulationSettings {
    pause_when_inactive: bool,
    auto_save: bool,
    rewind: bool,
    cheats: bool,
    fast_forward_multiplier: u8,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmulatorSettings {
    emulator_id: String,
    video: EmulatorVideoSettings,
    audio: EmulatorAudioSettings,
    controller: EmulatorControllerSettings,
    emulation: EmulatorEmulationSettings,
    hotkeys: HashMap<String, String>,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            master_volume: 100,
            muted: false,
            start_fullscreen: true,
            pause_when_inactive: true,
            auto_save: true,
            controller_mode: "auto".into(),
            quality_preset: QualityPreset::Auto,
            graphics: graphics_for_preset(QualityPreset::Medium),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareProfile {
    logical_cores: usize,
    memory_gb: Option<u64>,
    gpu_name: Option<String>,
    gpu_memory_gb: Option<u64>,
    recommended_quality: QualityPreset,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledGame {
    game_id: String,
    installed_at: String,
    last_played_at: Option<String>,
    play_time_minutes: u64,
    local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    managed: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveGameResult {
    game_files_deleted: bool,
    save_files_deleted: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameInput {
    id: String,
    title: String,
    system: String,
    source_url: Option<String>,
    file_name: Option<String>,
    file_size_bytes: Option<u64>,
    checksum: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    library_path: Option<PathBuf>,
    emulators: HashMap<String, PathBuf>,
    emulator_versions: HashMap<String, String>,
    settings: LauncherSettings,
    emulator_settings: HashMap<String, EmulatorSettings>,
}

struct AppState {
    data_dir: PathBuf,
    download_cancellations: Mutex<HashMap<String, Arc<DownloadCancellation>>>,
    pending_deep_link: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepLinkPayload {
    url: String,
}

pub(crate) struct DownloadCancellation {
    requested: AtomicBool,
    discard: AtomicBool,
}

impl DownloadCancellation {
    fn new() -> Self {
        Self {
            requested: AtomicBool::new(false),
            discard: AtomicBool::new(false),
        }
    }

    fn request(&self, discard: bool) {
        self.discard.store(discard, Ordering::Relaxed);
        self.requested.store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_requested(&self) -> bool {
        self.requested.load(Ordering::Relaxed)
    }

    pub(crate) fn should_discard(&self) -> bool {
        self.discard.load(Ordering::Relaxed)
    }
}

impl AppState {
    fn config_path(&self) -> PathBuf {
        self.data_dir.join("config.json")
    }

    fn library_index_path(&self) -> PathBuf {
        self.data_dir.join("library.json")
    }
}

fn deep_link_from_args(args: impl IntoIterator<Item = String>) -> Option<String> {
    args.into_iter()
        .find(|value| value.starts_with("nolostmedia://"))
}

fn safe_path_component(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.contains(['/', '\\', ':'])
        || matches!(value, "." | "..")
        || value.contains("..")
    {
        return Err("O identificador do jogo não é válido.".into());
    }
    Ok(value)
}

fn deliver_deep_link(app: &tauri::AppHandle, url: String) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pending_deep_link.lock() {
            *pending = Some(url.clone());
        }
    }
    let _ = app.emit("desktop-deep-link", DeepLinkPayload { url });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn take_pending_deep_link(state: State<'_, AppState>) -> Option<String> {
    state
        .pending_deep_link
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
}

const DOWNLOAD_CANCELLED: &str = "DOWNLOAD_CANCELLED";

fn download_key(kind: &str, id: &str) -> Result<String, String> {
    if !matches!(kind, "game" | "emulator")
        || id.is_empty()
        || id.contains(['/', '\\', ':'])
        || matches!(id, "." | "..")
    {
        return Err("O download informado não é válido.".into());
    }
    Ok(format!("{kind}:{id}"))
}

fn register_download(
    state: &AppState,
    kind: &str,
    id: &str,
) -> Result<(String, Arc<DownloadCancellation>), String> {
    let key = download_key(kind, id)?;
    let cancel = Arc::new(DownloadCancellation::new());
    let mut cancellations = state
        .download_cancellations
        .lock()
        .map_err(|_| "Não foi possível preparar o controle do download.".to_string())?;
    if cancellations.contains_key(&key) {
        return Err("Este download já está em andamento.".into());
    }
    cancellations.insert(key.clone(), Arc::clone(&cancel));
    Ok((key, cancel))
}

fn unregister_download(state: &AppState, key: &str) {
    if let Ok(mut cancellations) = state.download_cancellations.lock() {
        cancellations.remove(key);
    }
}

fn discard_download_files(state: &AppState, kind: &str, id: &str) -> Result<(), String> {
    let config: AppConfig = read_json(&state.config_path());
    let library = config
        .library_path
        .ok_or_else(|| "A pasta da biblioteca não está configurada.".to_string())?;
    let cache = library.join("cache").join(match kind {
        "game" => "games",
        _ => "emulators",
    });
    let target = cache.join(id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    }
    if kind == "game" {
        let games = library.join("games");
        if let Ok(systems) = fs::read_dir(games) {
            for system in systems.flatten().filter(|entry| entry.path().is_dir()) {
                let staging = system.path().join(format!(".{id}-installing"));
                if staging.exists() {
                    let _ = fs::remove_dir_all(staging);
                }
            }
        }
    } else {
        let emulators = library.join("emulators");
        if let Ok(entries) = fs::read_dir(emulators) {
            let prefix = format!(".{id}-installing-");
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with(&prefix) {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    Ok(())
}

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn graphics_for_preset(preset: QualityPreset) -> GraphicsSettings {
    match preset {
        QualityPreset::Low => GraphicsSettings {
            internal_resolution: 1,
            anti_aliasing: "off".into(),
            texture_filtering: "nearest".into(),
            anisotropic_filtering: 1,
            vsync: false,
            frame_limit: 60,
        },
        QualityPreset::Medium => GraphicsSettings {
            internal_resolution: 2,
            anti_aliasing: "fxaa".into(),
            texture_filtering: "bilinear".into(),
            anisotropic_filtering: 4,
            vsync: true,
            frame_limit: 60,
        },
        QualityPreset::High | QualityPreset::Auto => GraphicsSettings {
            internal_resolution: 3,
            anti_aliasing: "fxaa".into(),
            texture_filtering: "bilinear".into(),
            anisotropic_filtering: 8,
            vsync: true,
            frame_limit: 60,
        },
        QualityPreset::Ultra => GraphicsSettings {
            internal_resolution: 6,
            anti_aliasing: "msaa4".into(),
            texture_filtering: "trilinear".into(),
            anisotropic_filtering: 16,
            vsync: true,
            frame_limit: 60,
        },
        QualityPreset::Custom => graphics_for_preset(QualityPreset::Medium),
    }
}

fn default_emulator_settings(id: &str, launcher: &LauncherSettings) -> EmulatorSettings {
    EmulatorSettings {
        emulator_id: id.to_string(),
        video: EmulatorVideoSettings {
            renderer: "auto".into(),
            internal_resolution: launcher.graphics.internal_resolution,
            aspect_ratio: "auto".into(),
            anti_aliasing: launcher.graphics.anti_aliasing.clone(),
            texture_filtering: launcher.graphics.texture_filtering.clone(),
            anisotropic_filtering: launcher.graphics.anisotropic_filtering,
            vsync: launcher.graphics.vsync,
            widescreen_patches: false,
            integer_scaling: false,
            frame_skip: 0,
            speed_percent: 100,
        },
        audio: EmulatorAudioSettings {
            backend: "auto".into(),
            volume: launcher.master_volume,
            latency_ms: 64,
            sync: true,
            muted: launcher.muted,
        },
        controller: EmulatorControllerSettings {
            layout: match id {
                "pcsx2" => "ps2",
                "duckstation" => "ps1",
                "dolphin" => "gamecube",
                _ => "snes",
            }
            .into(),
            device: "auto".into(),
            deadzone: 15,
            sensitivity: 100,
            rumble: true,
            bindings: HashMap::new(),
        },
        emulation: EmulatorEmulationSettings {
            pause_when_inactive: launcher.pause_when_inactive,
            auto_save: launcher.auto_save,
            rewind: false,
            cheats: false,
            fast_forward_multiplier: 2,
        },
        hotkeys: HashMap::new(),
    }
}

fn validate_emulator_settings(settings: &EmulatorSettings) -> Result<(), String> {
    if emulator_metadata(&settings.emulator_id).is_none() {
        return Err("Emulador não reconhecido pelo launcher.".into());
    }
    let video = &settings.video;
    let audio = &settings.audio;
    let controller = &settings.controller;
    if !matches!(
        video.renderer.as_str(),
        "auto" | "vulkan" | "d3d11" | "d3d12" | "opengl" | "software"
    ) || !(1..=8).contains(&video.internal_resolution)
        || !matches!(
            video.aspect_ratio.as_str(),
            "auto" | "4:3" | "16:9" | "stretch"
        )
        || !matches!(
            video.anti_aliasing.as_str(),
            "off" | "fxaa" | "msaa2" | "msaa4" | "msaa8"
        )
        || !matches!(
            video.texture_filtering.as_str(),
            "nearest" | "bilinear" | "trilinear"
        )
        || !matches!(video.anisotropic_filtering, 1 | 2 | 4 | 8 | 16)
        || video.frame_skip > 5
        || !(25..=300).contains(&video.speed_percent)
    {
        return Err("Uma configuração de vídeo está fora dos limites aceitos.".into());
    }
    if audio.volume > 100
        || !(16..=256).contains(&audio.latency_ms)
        || !matches!(
            audio.backend.as_str(),
            "auto" | "cubeb" | "xaudio2" | "wasapi" | "sdl"
        )
    {
        return Err("Uma configuração de áudio está fora dos limites aceitos.".into());
    }
    if !matches!(
        controller.layout.as_str(),
        "nes" | "snes" | "gba" | "n64" | "dreamcast" | "ps1" | "ps2" | "gamecube" | "wii"
    ) || !matches!(controller.device.as_str(), "auto" | "gamepad" | "keyboard")
        || controller.deadzone > 50
        || !(50..=200).contains(&controller.sensitivity)
        || !(1..=10).contains(&settings.emulation.fast_forward_multiplier)
        || controller.bindings.values().any(|value| value.len() > 100)
        || settings.hotkeys.values().any(|value| value.len() > 100)
    {
        return Err("Uma configuração de controle ou emulação é inválida.".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn total_memory_gb() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..unsafe { std::mem::zeroed() }
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        None
    } else {
        Some((status.ullTotalPhys / 1_073_741_824).max(1))
    }
}

#[cfg(not(target_os = "windows"))]
fn total_memory_gb() -> Option<u64> {
    None
}

#[cfg(target_os = "windows")]
fn gpu_profile() -> (Option<String>, Option<u64>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = "$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-CimInstance Win32_VideoController | Where-Object {$_.Name -notlike '*Microsoft*'} | Sort-Object AdapterRAM -Descending | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress";
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok();
    let value = output
        .filter(|result| result.status.success())
        .and_then(|result| serde_json::from_slice::<serde_json::Value>(&result.stdout).ok());
    let name = value
        .as_ref()
        .and_then(|item| item.get("Name"))
        .and_then(|item| item.as_str())
        .map(str::to_owned);
    let memory = value
        .as_ref()
        .and_then(|item| item.get("AdapterRAM"))
        .and_then(serde_json::Value::as_u64)
        .map(|bytes| (bytes / 1_073_741_824).max(1));
    (name, memory)
}

#[cfg(not(target_os = "windows"))]
fn gpu_profile() -> (Option<String>, Option<u64>) {
    (None, None)
}

fn hardware_profile() -> HardwareProfile {
    static PROFILE: OnceLock<HardwareProfile> = OnceLock::new();
    PROFILE
        .get_or_init(|| {
            let logical_cores = std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(4);
            let memory_gb = total_memory_gb();
            let (gpu_name, gpu_memory_gb) = gpu_profile();
            let recommended_quality = if logical_cores <= 4
                || memory_gb.is_some_and(|memory| memory < 8)
                || gpu_memory_gb.is_some_and(|memory| memory < 2)
            {
                QualityPreset::Low
            } else if logical_cores <= 8
                || memory_gb.is_some_and(|memory| memory < 16)
                || gpu_memory_gb.is_some_and(|memory| memory < 4)
            {
                QualityPreset::Medium
            } else if logical_cores >= 16
                && memory_gb.is_some_and(|memory| memory >= 32)
                && gpu_memory_gb.is_some_and(|memory| memory >= 8)
            {
                QualityPreset::Ultra
            } else {
                QualityPreset::High
            };
            HardwareProfile {
                logical_cores,
                memory_gb,
                gpu_name,
                gpu_memory_gb,
                recommended_quality,
            }
        })
        .clone()
}

fn effective_graphics(settings: &LauncherSettings, hardware: &HardwareProfile) -> GraphicsSettings {
    match settings.quality_preset {
        QualityPreset::Auto => graphics_for_preset(hardware.recommended_quality),
        QualityPreset::Custom => settings.graphics.clone(),
        preset => graphics_for_preset(preset),
    }
}

fn upsert_ini_section(path: &Path, section: &str, values: &[(&str, String)]) -> Result<(), String> {
    let existing = fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = existing.lines().map(str::to_owned).collect();
    let header = format!("[{section}]");
    let section_start = lines
        .iter()
        .position(|line| line.trim().eq_ignore_ascii_case(&header));

    let start = if let Some(index) = section_start {
        index + 1
    } else {
        if !lines.is_empty() && !lines.last().is_some_and(String::is_empty) {
            lines.push(String::new());
        }
        lines.push(header);
        lines.len()
    };
    let end = lines[start..]
        .iter()
        .position(|line| {
            let trimmed = line.trim();
            trimmed.starts_with('[') && trimmed.ends_with(']')
        })
        .map(|offset| start + offset)
        .unwrap_or(lines.len());

    let mut pending: Vec<(&str, String)> = values.to_vec();
    for line in &mut lines[start..end] {
        let Some((key, _)) = line.split_once('=') else {
            continue;
        };
        if let Some(index) = pending
            .iter()
            .position(|(candidate, _)| key.trim().eq_ignore_ascii_case(candidate))
        {
            let (name, value) = pending.remove(index);
            *line = format!("{name} = {value}");
        }
    }
    for (offset, (name, value)) in pending.into_iter().enumerate() {
        lines.insert(end + offset, format!("{name} = {value}"));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|error| error.to_string())
}

fn binding_to_sdl(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        ["keyboard", code] => {
            let key = code
                .strip_prefix("Key")
                .or_else(|| code.strip_prefix("Digit"))
                .unwrap_or(code);
            Some(format!("Keyboard/{key}"))
        }
        ["gamepad", pad, "button", button] => {
            let name = match *button {
                "0" => "A",
                "1" => "B",
                "2" => "X",
                "3" => "Y",
                "4" => "LeftShoulder",
                "5" => "RightShoulder",
                "6" => "LeftTrigger",
                "7" => "RightTrigger",
                "8" => "Back",
                "9" => "Start",
                "10" => "LeftStick",
                "11" => "RightStick",
                "12" => "DPadUp",
                "13" => "DPadDown",
                "14" => "DPadLeft",
                "15" => "DPadRight",
                "16" => "Guide",
                "17" => "Touchpad",
                other => return Some(format!("SDL-{pad}/Button{other}")),
            };
            Some(format!("SDL-{pad}/{name}"))
        }
        ["gamepad", pad, "axis", axis, direction] => {
            let name = match *axis {
                "0" => "LeftX",
                "1" => "LeftY",
                "2" => "RightX",
                "3" => "RightY",
                other => return Some(format!("SDL-{pad}/{direction}Axis{other}")),
            };
            Some(format!("SDL-{pad}/{direction}{name}"))
        }
        _ => None,
    }
}

fn action_pairs(
    bindings: &HashMap<String, String>,
    actions: &[(&str, &'static str)],
) -> Vec<(&'static str, String)> {
    actions
        .iter()
        .filter_map(|(action, key)| {
            bindings
                .get(*action)
                .and_then(|binding| binding_to_sdl(binding))
                .map(|binding| (*key, binding))
        })
        .collect()
}

fn apply_pcsx2_detailed(emulator_dir: &Path, settings: &EmulatorSettings) -> Result<(), String> {
    let ini = emulator_dir.join("inis").join("PCSX2.ini");
    let renderer = match settings.video.renderer.as_str() {
        "d3d11" => "3",
        "opengl" => "12",
        "vulkan" => "14",
        "software" => "13",
        _ => "-1",
    };
    let multisampling = match settings.video.anti_aliasing.as_str() {
        "msaa2" => 2,
        "msaa4" => 4,
        "msaa8" => 8,
        _ => 0,
    };
    upsert_ini_section(
        &ini,
        "EmuCore/GS",
        &[
            ("Renderer", renderer.into()),
            (
                "upscale_multiplier",
                settings.video.internal_resolution.to_string(),
            ),
            (
                "MaxAnisotropy",
                settings.video.anisotropic_filtering.to_string(),
            ),
            (
                "filter",
                if settings.video.texture_filtering == "nearest" {
                    "0".into()
                } else {
                    "2".into()
                },
            ),
            ("UserHacks_MSAA", multisampling.to_string()),
            ("fxaa", (settings.video.anti_aliasing == "fxaa").to_string()),
            ("VsyncEnable", u8::from(settings.video.vsync).to_string()),
            (
                "EnableWideScreenPatches",
                settings.video.widescreen_patches.to_string(),
            ),
            ("FrameSkip", settings.video.frame_skip.to_string()),
            ("EnableCheats", settings.emulation.cheats.to_string()),
        ],
    )?;
    upsert_ini_section(
        &ini,
        "Framerate",
        &[(
            "NominalScalar",
            format!("{:.2}", f32::from(settings.video.speed_percent) / 100.0),
        )],
    )?;
    upsert_ini_section(
        &ini,
        "SPU2/Output",
        &[
            (
                "OutputVolume",
                if settings.audio.muted {
                    "0".into()
                } else {
                    settings.audio.volume.to_string()
                },
            ),
            ("Latency", settings.audio.latency_ms.to_string()),
        ],
    )?;
    let mut pad = vec![
        ("Type", "DualShock2".to_string()),
        ("Deadzone", settings.controller.deadzone.to_string()),
        ("AxisScale", settings.controller.sensitivity.to_string()),
        (
            "LargeMotorScale",
            u8::from(settings.controller.rumble).to_string(),
        ),
        (
            "SmallMotorScale",
            u8::from(settings.controller.rumble).to_string(),
        ),
    ];
    pad.extend(action_pairs(
        &settings.controller.bindings,
        &[
            ("dpadUp", "Up"),
            ("dpadDown", "Down"),
            ("dpadLeft", "Left"),
            ("dpadRight", "Right"),
            ("faceSouth", "Cross"),
            ("faceEast", "Circle"),
            ("faceWest", "Square"),
            ("faceNorth", "Triangle"),
            ("select", "Select"),
            ("start", "Start"),
            ("l1", "L1"),
            ("r1", "R1"),
            ("l2", "L2"),
            ("r2", "R2"),
            ("l3", "L3"),
            ("r3", "R3"),
            ("leftStickUp", "LUp"),
            ("leftStickDown", "LDown"),
            ("leftStickLeft", "LLeft"),
            ("leftStickRight", "LRight"),
            ("rightStickUp", "RUp"),
            ("rightStickDown", "RDown"),
            ("rightStickLeft", "RLeft"),
            ("rightStickRight", "RRight"),
            ("touchpad", "Analog"),
        ],
    ));
    upsert_ini_section(&ini, "Pad1", &pad)?;
    let hotkeys = action_pairs(
        &settings.hotkeys,
        &[
            ("pause", "TogglePause"),
            ("fastForward", "ToggleTurbo"),
            ("saveState", "SaveState"),
            ("loadState", "LoadState"),
            ("nextSlot", "NextSaveStateSlot"),
            ("screenshot", "Screenshot"),
            ("fullscreen", "ToggleFullscreen"),
            ("menu", "OpenPauseMenu"),
        ],
    );
    if !hotkeys.is_empty() {
        upsert_ini_section(&ini, "Hotkeys", &hotkeys)?;
    }
    Ok(())
}

fn apply_duckstation_detailed(
    emulator_dir: &Path,
    settings: &EmulatorSettings,
) -> Result<(), String> {
    let ini = emulator_dir.join("settings.ini");
    let renderer = match settings.video.renderer.as_str() {
        "d3d11" => "D3D11",
        "d3d12" => "D3D12",
        "vulkan" => "Vulkan",
        "opengl" => "OpenGL",
        "software" => "Software",
        _ => "Automatic",
    };
    let samples = match settings.video.anti_aliasing.as_str() {
        "msaa2" => 2,
        "msaa4" => 4,
        "msaa8" => 8,
        _ => 1,
    };
    upsert_ini_section(
        &ini,
        "GPU",
        &[
            ("Renderer", renderer.into()),
            (
                "ResolutionScale",
                settings.video.internal_resolution.to_string(),
            ),
            ("Multisamples", samples.to_string()),
            (
                "TextureFilter",
                match settings.video.texture_filtering.as_str() {
                    "nearest" => "Nearest",
                    "trilinear" => "JINC2",
                    _ => "Bilinear",
                }
                .into(),
            ),
            (
                "PerSampleShading",
                settings.video.anti_aliasing.starts_with("msaa").to_string(),
            ),
            ("UseThread", "true".into()),
            (
                "WidescreenHack",
                settings.video.widescreen_patches.to_string(),
            ),
        ],
    )?;
    upsert_ini_section(
        &ini,
        "Display",
        &[
            ("AspectRatio", settings.video.aspect_ratio.clone()),
            ("VSync", settings.video.vsync.to_string()),
            ("IntegerScaling", settings.video.integer_scaling.to_string()),
        ],
    )?;
    upsert_ini_section(
        &ini,
        "Audio",
        &[
            ("Backend", settings.audio.backend.clone()),
            ("OutputMuted", settings.audio.muted.to_string()),
            ("OutputVolume", settings.audio.volume.to_string()),
            ("BufferMS", settings.audio.latency_ms.to_string()),
        ],
    )?;
    upsert_ini_section(
        &ini,
        "Main",
        &[
            (
                "EmulationSpeed",
                format!("{:.2}", f32::from(settings.video.speed_percent) / 100.0),
            ),
            (
                "PauseOnFocusLoss",
                settings.emulation.pause_when_inactive.to_string(),
            ),
            ("SaveStateOnExit", settings.emulation.auto_save.to_string()),
            ("RewindEnable", settings.emulation.rewind.to_string()),
        ],
    )?;
    let mut controller = vec![
        ("Type", "AnalogController".to_string()),
        (
            "AnalogDeadzone",
            format!("{:.2}", f32::from(settings.controller.deadzone) / 100.0),
        ),
        (
            "AnalogSensitivity",
            format!("{:.2}", f32::from(settings.controller.sensitivity) / 100.0),
        ),
        (
            "VibrationBias",
            if settings.controller.rumble {
                "8".into()
            } else {
                "0".into()
            },
        ),
    ];
    controller.extend(action_pairs(
        &settings.controller.bindings,
        &[
            ("dpadUp", "ButtonUp"),
            ("dpadDown", "ButtonDown"),
            ("dpadLeft", "ButtonLeft"),
            ("dpadRight", "ButtonRight"),
            ("faceSouth", "ButtonCross"),
            ("faceEast", "ButtonCircle"),
            ("faceWest", "ButtonSquare"),
            ("faceNorth", "ButtonTriangle"),
            ("select", "ButtonSelect"),
            ("start", "ButtonStart"),
            ("l1", "ButtonL1"),
            ("r1", "ButtonR1"),
            ("l2", "ButtonL2"),
            ("r2", "ButtonR2"),
            ("l3", "ButtonL3"),
            ("r3", "ButtonR3"),
            ("touchpad", "ButtonAnalog"),
            ("leftStickLeft", "AxisLeftX"),
            ("leftStickUp", "AxisLeftY"),
            ("rightStickLeft", "AxisRightX"),
            ("rightStickUp", "AxisRightY"),
        ],
    ));
    upsert_ini_section(&ini, "Controller1", &controller)?;
    let hotkeys = action_pairs(
        &settings.hotkeys,
        &[
            ("pause", "General/TogglePause"),
            ("fastForward", "General/FastForward"),
            ("saveState", "SaveStates/SaveSelectedSlot"),
            ("loadState", "SaveStates/LoadSelectedSlot"),
            ("nextSlot", "SaveStates/SelectNextSlot"),
            ("screenshot", "General/Screenshot"),
            ("fullscreen", "General/ToggleFullscreen"),
            ("menu", "General/OpenPauseMenu"),
        ],
    );
    if !hotkeys.is_empty() {
        upsert_ini_section(&ini, "Hotkeys", &hotkeys)?;
    }
    Ok(())
}

fn binding_to_dolphin(value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        ["keyboard", code] => Some(format!("`{code}`")),
        ["gamepad", _, "button", button] => {
            let name = match *button {
                "0" => "Button A",
                "1" => "Button B",
                "2" => "Button X",
                "3" => "Button Y",
                "4" => "Shoulder L",
                "5" => "Shoulder R",
                "6" => "Trigger L",
                "7" => "Trigger R",
                "8" => "Button Back",
                "9" => "Button Start",
                "10" => "Thumb L",
                "11" => "Thumb R",
                "12" => "Pad N",
                "13" => "Pad S",
                "14" => "Pad W",
                "15" => "Pad E",
                "17" => "Touchpad",
                other => return Some(format!("`Button {other}`")),
            };
            Some(format!("`{name}`"))
        }
        ["gamepad", _, "axis", axis, direction] => {
            let name = match *axis {
                "0" => "Left X",
                "1" => "Left Y",
                "2" => "Right X",
                "3" => "Right Y",
                other => return Some(format!("`Axis {other}{direction}`")),
            };
            Some(format!("`{name}{direction}`"))
        }
        _ => None,
    }
}

fn apply_dolphin_detailed(emulator_dir: &Path, settings: &EmulatorSettings) -> Result<(), String> {
    let config_dir = emulator_dir.join("User").join("Config");
    let renderer = match settings.video.renderer.as_str() {
        "d3d11" | "d3d12" => "D3D",
        "vulkan" => "Vulkan",
        "opengl" => "OGL",
        "software" => "Software Renderer",
        _ => "",
    };
    let msaa = match settings.video.anti_aliasing.as_str() {
        "msaa2" => 2,
        "msaa4" => 4,
        "msaa8" => 8,
        _ => 1,
    };
    upsert_ini_section(
        &config_dir.join("GFX.ini"),
        "Settings",
        &[
            ("Backend", renderer.into()),
            (
                "InternalResolution",
                settings.video.internal_resolution.to_string(),
            ),
            ("MSAA", msaa.to_string()),
            ("VSync", settings.video.vsync.to_string()),
            (
                "AspectRatio",
                match settings.video.aspect_ratio.as_str() {
                    "4:3" => "1",
                    "16:9" => "2",
                    "stretch" => "3",
                    _ => "0",
                }
                .into(),
            ),
        ],
    )?;
    upsert_ini_section(
        &config_dir.join("GFX.ini"),
        "Enhancements",
        &[
            (
                "MaxAnisotropy",
                settings.video.anisotropic_filtering.ilog2().to_string(),
            ),
            (
                "ForceFiltering",
                (settings.video.texture_filtering != "nearest").to_string(),
            ),
            (
                "ForceTrueColor",
                settings.video.widescreen_patches.to_string(),
            ),
        ],
    )?;
    let dolphin_ini = config_dir.join("Dolphin.ini");
    upsert_ini_section(
        &dolphin_ini,
        "Core",
        &[
            ("GFXBackend", renderer.into()),
            (
                "EmulationSpeed",
                format!("{:.2}", f32::from(settings.video.speed_percent) / 100.0),
            ),
            ("EnableCheats", settings.emulation.cheats.to_string()),
        ],
    )?;
    upsert_ini_section(
        &dolphin_ini,
        "DSP",
        &[
            (
                "Volume",
                if settings.audio.muted {
                    "0".into()
                } else {
                    settings.audio.volume.to_string()
                },
            ),
            ("Backend", settings.audio.backend.clone()),
        ],
    )?;
    upsert_ini_section(
        &dolphin_ini,
        "Interface",
        &[(
            "PauseOnFocusLost",
            settings.emulation.pause_when_inactive.to_string(),
        )],
    )?;
    let mut pad = vec![("Device", "XInput/0/Gamepad".to_string())];
    let (controller_path, controller_section, actions): (PathBuf, &str, &[(&str, &str)]) =
        if settings.controller.layout == "wii" {
            (
                config_dir.join("WiimoteNew.ini"),
                "Wiimote1",
                &[
                    ("faceSouth", "Buttons/A"),
                    ("faceEast", "Buttons/B"),
                    ("faceWest", "Buttons/1"),
                    ("faceNorth", "Buttons/2"),
                    ("select", "Buttons/-"),
                    ("start", "Buttons/+"),
                    ("touchpad", "Buttons/Home"),
                    ("dpadUp", "D-Pad/Up"),
                    ("dpadDown", "D-Pad/Down"),
                    ("dpadLeft", "D-Pad/Left"),
                    ("dpadRight", "D-Pad/Right"),
                    ("leftStickUp", "Nunchuk/Stick/Up"),
                    ("leftStickDown", "Nunchuk/Stick/Down"),
                    ("leftStickLeft", "Nunchuk/Stick/Left"),
                    ("leftStickRight", "Nunchuk/Stick/Right"),
                    ("l2", "Nunchuk/Buttons/C"),
                    ("r2", "Nunchuk/Buttons/Z"),
                ],
            )
        } else {
            pad.extend([
                ("Dead Zone", settings.controller.deadzone.to_string()),
                (
                    "Rumble/Motor",
                    if settings.controller.rumble {
                        "`Motor L` | `Motor R`".into()
                    } else {
                        String::new()
                    },
                ),
            ]);
            (
                config_dir.join("GCPadNew.ini"),
                "GCPad1",
                &[
                    ("faceSouth", "Buttons/A"),
                    ("faceEast", "Buttons/B"),
                    ("faceWest", "Buttons/X"),
                    ("faceNorth", "Buttons/Y"),
                    ("start", "Buttons/Start"),
                    ("dpadUp", "D-Pad/Up"),
                    ("dpadDown", "D-Pad/Down"),
                    ("dpadLeft", "D-Pad/Left"),
                    ("dpadRight", "D-Pad/Right"),
                    ("l1", "Triggers/L"),
                    ("r1", "Triggers/R"),
                    ("l2", "Triggers/L-Analog"),
                    ("r2", "Triggers/R-Analog"),
                    ("leftStickUp", "Main Stick/Up"),
                    ("leftStickDown", "Main Stick/Down"),
                    ("leftStickLeft", "Main Stick/Left"),
                    ("leftStickRight", "Main Stick/Right"),
                    ("rightStickUp", "C-Stick/Up"),
                    ("rightStickDown", "C-Stick/Down"),
                    ("rightStickLeft", "C-Stick/Left"),
                    ("rightStickRight", "C-Stick/Right"),
                ],
            )
        };
    for (action, key) in actions {
        if let Some(value) = settings
            .controller
            .bindings
            .get(*action)
            .and_then(|binding| binding_to_dolphin(binding))
        {
            pad.push((*key, value));
        }
    }
    upsert_ini_section(&controller_path, controller_section, &pad)
}

fn retroarch_binding_line(key: &str, value: &str) -> Option<String> {
    let parts: Vec<&str> = value.split(':').collect();
    match parts.as_slice() {
        ["keyboard", code] => {
            let key_name = code
                .strip_prefix("Key")
                .or_else(|| code.strip_prefix("Digit"))
                .unwrap_or(code)
                .to_ascii_lowercase();
            Some(format!("{key} = \"{key_name}\""))
        }
        ["gamepad", _, "button", button] => Some(format!("{key}_btn = \"{button}\"")),
        ["gamepad", _, "axis", axis, direction] => {
            Some(format!("{key}_axis = \"{direction}{axis}\""))
        }
        _ => None,
    }
}

fn apply_retroarch_detailed(
    emulator_dir: &Path,
    settings: &EmulatorSettings,
) -> Result<PathBuf, String> {
    let volume_db = if settings.audio.muted || settings.audio.volume == 0 {
        -80.0
    } else {
        -60.0 + f64::from(settings.audio.volume) * 0.6
    };
    let mut lines = vec![
        format!(
            "video_driver = \"{}\"",
            match settings.video.renderer.as_str() {
                "vulkan" => "vulkan",
                "d3d11" | "d3d12" => "d3d11",
                "opengl" => "glcore",
                _ => "d3d11",
            }
        ),
        format!("video_vsync = \"{}\"", settings.video.vsync),
        format!(
            "video_scale_integer = \"{}\"",
            settings.video.integer_scaling
        ),
        format!(
            "video_smooth = \"{}\"",
            settings.video.texture_filtering != "nearest"
        ),
        format!("audio_enable = \"{}\"", !settings.audio.muted),
        format!("audio_volume = \"{volume_db:.1}\""),
        format!("audio_latency = \"{}\"", settings.audio.latency_ms),
        format!(
            "pause_nonactive = \"{}\"",
            settings.emulation.pause_when_inactive
        ),
        format!("savestate_auto_save = \"{}\"", settings.emulation.auto_save),
        format!("savestate_auto_load = \"{}\"", settings.emulation.auto_save),
        format!("rewind_enable = \"{}\"", settings.emulation.rewind),
        format!("cheevos_enable = \"{}\"", false),
        format!(
            "fastforward_ratio = \"{}\"",
            settings.emulation.fast_forward_multiplier
        ),
        format!(
            "input_rumble_gain = \"{}\"",
            if settings.controller.rumble { 100 } else { 0 }
        ),
        "input_player1_analog_dpad_mode = \"1\"".to_string(),
        format!(
            "input_axis_threshold = \"{:.2}\"",
            f32::from(settings.controller.deadzone) / 100.0
        ),
    ];
    for (action, key) in [
        ("faceSouth", "input_player1_a"),
        ("faceEast", "input_player1_b"),
        ("faceWest", "input_player1_x"),
        ("faceNorth", "input_player1_y"),
        ("dpadUp", "input_player1_up"),
        ("dpadDown", "input_player1_down"),
        ("dpadLeft", "input_player1_left"),
        ("dpadRight", "input_player1_right"),
        ("start", "input_player1_start"),
        ("select", "input_player1_select"),
        ("l1", "input_player1_l"),
        ("r1", "input_player1_r"),
        ("l2", "input_player1_l2"),
        ("r2", "input_player1_r2"),
        ("l3", "input_player1_l3"),
        ("r3", "input_player1_r3"),
        ("leftStickLeft", "input_player1_l_x_minus"),
        ("leftStickRight", "input_player1_l_x_plus"),
        ("leftStickUp", "input_player1_l_y_minus"),
        ("leftStickDown", "input_player1_l_y_plus"),
        ("rightStickLeft", "input_player1_r_x_minus"),
        ("rightStickRight", "input_player1_r_x_plus"),
        ("rightStickUp", "input_player1_r_y_minus"),
        ("rightStickDown", "input_player1_r_y_plus"),
    ] {
        if let Some(line) = settings
            .controller
            .bindings
            .get(action)
            .and_then(|binding| retroarch_binding_line(key, binding))
        {
            lines.push(line);
        }
    }
    for (action, key) in [
        ("pause", "input_pause_toggle"),
        ("fastForward", "input_toggle_fast_forward"),
        ("saveState", "input_save_state"),
        ("loadState", "input_load_state"),
        ("nextSlot", "input_state_slot_increase"),
        ("screenshot", "input_screenshot"),
        ("fullscreen", "input_toggle_fullscreen"),
        ("menu", "input_menu_toggle"),
    ] {
        if let Some(line) = settings
            .hotkeys
            .get(action)
            .and_then(|binding| retroarch_binding_line(key, binding))
        {
            lines.push(line);
        }
    }
    let path = emulator_dir.join("NoLostMediaEmulator.cfg");
    fs::write(&path, format!("{}\n", lines.join("\n"))).map_err(|error| error.to_string())?;
    Ok(path)
}

fn apply_emulator_settings_to_disk(
    emulator: &Path,
    settings: &EmulatorSettings,
) -> Result<(), String> {
    let directory = emulator
        .parent()
        .ok_or_else(|| "A pasta do emulador não foi encontrada.".to_string())?;
    match settings.emulator_id.as_str() {
        "pcsx2" if directory.join("portable.ini").is_file() || directory.join("inis").is_dir() => {
            apply_pcsx2_detailed(directory, settings)
        }
        "duckstation" if directory.join("portable.txt").is_file() => {
            apply_duckstation_detailed(directory, settings)
        }
        "dolphin"
            if directory.join("portable.txt").is_file() || directory.join("User").is_dir() =>
        {
            apply_dolphin_detailed(directory, settings)
        }
        "retroarch" => apply_retroarch_detailed(directory, settings).map(|_| ()),
        _ => Ok(()),
    }
}

fn validate_settings(settings: &LauncherSettings) -> Result<(), String> {
    if settings.master_volume > 100 {
        return Err("O volume deve estar entre 0 e 100.".into());
    }
    if !matches!(
        settings.controller_mode.as_str(),
        "auto" | "xinput" | "playstation" | "keyboard"
    ) {
        return Err("O perfil de controle selecionado não é válido.".into());
    }
    if !(1..=8).contains(&settings.graphics.internal_resolution)
        || !matches!(
            settings.graphics.anti_aliasing.as_str(),
            "off" | "fxaa" | "msaa2" | "msaa4" | "msaa8"
        )
        || !matches!(
            settings.graphics.texture_filtering.as_str(),
            "nearest" | "bilinear" | "trilinear"
        )
        || !matches!(settings.graphics.anisotropic_filtering, 1 | 2 | 4 | 8 | 16)
        || !matches!(settings.graphics.frame_limit, 0 | 30 | 60 | 120)
    {
        return Err("Uma das opções gráficas está fora dos limites aceitos.".into());
    }
    Ok(())
}

fn create_library_folders(library: &Path) -> Result<(), String> {
    for system in SYSTEM_FOLDERS {
        fs::create_dir_all(library.join("games").join(system))
            .map_err(|error| error.to_string())?;
    }
    for folder in ["emulators", "saves", "bios", "cache"] {
        fs::create_dir_all(library.join(folder)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn emulator_metadata(id: &str) -> Option<(&'static str, Vec<&'static str>, Vec<&'static str>)> {
    match id {
        "pcsx2" => Some(("PCSX2", vec!["ps2"], vec!["pcsx2-qt.exe", "pcsx2.exe"])),
        "duckstation" => Some((
            "DuckStation",
            vec!["ps1"],
            vec!["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe"],
        )),
        "dolphin" => Some(("Dolphin", vec!["gamecube", "wii"], vec!["Dolphin.exe"])),
        "retroarch" => Some((
            "RetroArch",
            vec!["nes", "snes", "gba", "n64", "dreamcast"],
            vec!["retroarch.exe"],
        )),
        _ => None,
    }
}

fn executable_roots(config: &AppConfig, id: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current_executable) = env::current_exe() {
        if let Some(parent) = current_executable.parent() {
            roots.push(parent.join("emulators").join(id));
        }
    }
    if let Some(library) = &config.library_path {
        roots.push(library.join("emulators").join(id));
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        let base = PathBuf::from(program_files);
        roots.push(base.join(id));
        roots.push(base.join(id.to_uppercase()));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data).join("Programs");
        roots.push(base.join(id));
        roots.push(base.join(id.to_uppercase()));
    }
    roots
}

fn find_named_executable(root: &Path, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        let direct = root.join(name);
        if direct.is_file() {
            return direct.canonicalize().ok().or(Some(direct));
        }
    }
    let children = fs::read_dir(root).ok()?;
    for child in children.flatten().filter(|entry| entry.path().is_dir()) {
        for name in names {
            let candidate = child.path().join(name);
            if candidate.is_file() {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }
    None
}

fn detect_emulator(config: &AppConfig, id: &str) -> Option<PathBuf> {
    if let Some(configured) = config.emulators.get(id).filter(|path| path.is_file()) {
        return configured
            .canonicalize()
            .ok()
            .or_else(|| Some(configured.clone()));
    }
    let (_, _, names) = emulator_metadata(id)?;
    executable_roots(config, id)
        .iter()
        .find_map(|root| find_named_executable(root, &names))
}

fn build_runtime_info(state: &AppState) -> RuntimeInfo {
    let config: AppConfig = read_json(&state.config_path());
    let hardware_profile = hardware_profile();
    let emulators: Vec<EmulatorDefinition> = ["pcsx2", "duckstation", "dolphin", "retroarch"]
        .into_iter()
        .filter_map(|id| {
            let (name, systems, _) = emulator_metadata(id)?;
            let managed = managed_emulators::manifest(id);
            let installed = detect_emulator(&config, id).is_some();
            Some(EmulatorDefinition {
                id: match id {
                    "pcsx2" => "pcsx2",
                    "duckstation" => "duckstation",
                    "dolphin" => "dolphin",
                    _ => "retroarch",
                },
                name,
                systems,
                installed,
                version: if installed {
                    config.emulator_versions.get(id).cloned()
                } else {
                    None
                },
                managed_install: managed.is_some(),
                download_size_bytes: managed.as_ref().map(|item| item.download_size_bytes),
                download_size_label: managed.as_ref().map(|item| item.download_size_label),
                source_name: managed.as_ref().map(|item| item.source_name),
                setup_note: match id {
                    "pcsx2" | "duckstation" => {
                        Some("Você precisará adicionar a BIOS do seu próprio console.")
                    }
                    "retroarch" => Some("Dreamcast pode exigir a BIOS do seu próprio console."),
                    _ => None,
                },
                bios_import: matches!(id, "pcsx2" | "duckstation"),
            })
        })
        .collect();
    let native_game_launch = emulators.iter().any(|emulator| emulator.installed);
    RuntimeInfo {
        mode: "native",
        capabilities: RuntimeCapabilities {
            platform: if cfg!(target_os = "windows") {
                "windows"
            } else if cfg!(target_os = "android") {
                "android"
            } else if cfg!(target_os = "ios") {
                "ios"
            } else {
                "unknown"
            },
            native_game_launch,
            filesystem_access: true,
            background_downloads: true,
            controller_navigation: true,
        },
        library_path: config
            .library_path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        emulators,
        settings: config.settings,
        hardware_profile,
    }
}

fn supported_extensions(system: &str) -> &'static [&'static str] {
    match system {
        "ps2" => &["iso", "bin", "chd", "cso"],
        "ps1" => &["chd", "cue", "bin", "pbp"],
        "gamecube" => &["iso", "gcm", "rvz", "wia", "chd"],
        "wii" => &["iso", "wbfs", "rvz", "wia"],
        "n64" => &["z64", "n64", "v64", "zip", "7z"],
        "snes" => &["sfc", "smc", "zip", "7z"],
        "nes" => &["nes", "zip", "7z"],
        "gba" => &["gba", "zip", "7z"],
        "dreamcast" => &["gdi", "cdi", "chd"],
        _ => &[],
    }
}

fn emulator_for_system(system: &str) -> Option<&'static str> {
    match system {
        "ps2" => Some("pcsx2"),
        "ps1" => Some("duckstation"),
        "gamecube" | "wii" => Some("dolphin"),
        "nes" | "snes" | "gba" | "n64" | "dreamcast" => Some("retroarch"),
        _ => None,
    }
}

fn retroarch_core_for_system(system: &str) -> Option<&'static str> {
    match system {
        "nes" => Some("mesen_libretro.dll"),
        "snes" => Some("snes9x_libretro.dll"),
        "gba" => Some("mgba_libretro.dll"),
        "n64" => Some("mupen64plus_next_libretro.dll"),
        "dreamcast" => Some("flycast_libretro.dll"),
        _ => None,
    }
}

#[tauri::command]
fn runtime_info(state: State<'_, AppState>) -> RuntimeInfo {
    build_runtime_info(&state)
}

#[tauri::command]
fn save_settings(
    settings: LauncherSettings,
    state: State<'_, AppState>,
) -> Result<RuntimeInfo, String> {
    validate_settings(&settings)?;
    let mut config: AppConfig = read_json(&state.config_path());
    config.settings = settings;
    write_json(&state.config_path(), &config)?;
    Ok(build_runtime_info(&state))
}

#[tauri::command]
fn get_emulator_settings(
    emulator_id: String,
    state: State<'_, AppState>,
) -> Result<EmulatorSettings, String> {
    if emulator_metadata(&emulator_id).is_none() {
        return Err("Emulador não reconhecido pelo launcher.".into());
    }
    let config: AppConfig = read_json(&state.config_path());
    Ok(config
        .emulator_settings
        .get(&emulator_id)
        .cloned()
        .unwrap_or_else(|| default_emulator_settings(&emulator_id, &config.settings)))
}

#[tauri::command]
fn save_emulator_settings(
    settings: EmulatorSettings,
    state: State<'_, AppState>,
) -> Result<EmulatorSettings, String> {
    validate_emulator_settings(&settings)?;
    let mut config: AppConfig = read_json(&state.config_path());
    if let Some(emulator) = detect_emulator(&config, &settings.emulator_id) {
        apply_emulator_settings_to_disk(&emulator, &settings)?;
    }
    config
        .emulator_settings
        .insert(settings.emulator_id.clone(), settings.clone());
    write_json(&state.config_path(), &config)?;
    Ok(settings)
}

#[tauri::command]
fn list_installed_games(state: State<'_, AppState>) -> Vec<InstalledGame> {
    read_json(&state.library_index_path())
}

#[tauri::command]
fn configure_library(path: String, state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    let selected = PathBuf::from(path);
    if !selected.is_dir() {
        return Err("A pasta escolhida não existe ou não pode ser acessada.".into());
    }
    let library = selected.canonicalize().map_err(|error| error.to_string())?;
    create_library_folders(&library)?;
    let mut config: AppConfig = read_json(&state.config_path());
    config.library_path = Some(library);
    write_json(&state.config_path(), &config)?;
    Ok(build_runtime_info(&state))
}

#[tauri::command]
fn configure_emulator(
    emulator_id: String,
    executable_path: String,
    state: State<'_, AppState>,
) -> Result<RuntimeInfo, String> {
    let (display_name, _, _) = emulator_metadata(&emulator_id)
        .ok_or_else(|| "Emulador não reconhecido pelo launcher.".to_string())?;
    let selected = PathBuf::from(executable_path);
    if !selected.is_file() {
        return Err("O executável selecionado não existe.".into());
    }
    if !selected
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err(format!(
            "Selecione o arquivo .exe correspondente ao {}.",
            display_name
        ));
    }
    let canonical = selected.canonicalize().map_err(|error| error.to_string())?;
    let mut config: AppConfig = read_json(&state.config_path());
    config.emulator_versions.remove(&emulator_id);
    config.emulators.insert(emulator_id, canonical);
    write_json(&state.config_path(), &config)?;
    Ok(build_runtime_info(&state))
}

#[tauri::command]
async fn install_emulator(
    emulator_id: String,
    on_event: Channel<EmulatorInstallEvent>,
    state: State<'_, AppState>,
) -> Result<RuntimeInfo, String> {
    let config_path = state.config_path();
    let config: AppConfig = read_json(&config_path);
    let library = config.library_path.clone().ok_or_else(|| {
        "Escolha primeiro a pasta da biblioteca antes de baixar um emulador.".to_string()
    })?;
    if !cfg!(target_os = "windows") {
        return Err("A instalação gerenciada de emuladores está disponível no Windows.".into());
    }
    if managed_emulators::manifest(&emulator_id).is_none() {
        return Err(
            "Este emulador ainda não possui instalação automática. Use a opção avançada para selecionar uma instalação existente."
                .into(),
        );
    }

    let (download_key, cancel) = register_download(&state, "emulator", &emulator_id)?;
    let install_id = emulator_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        managed_emulators::install(&install_id, &library, on_event, cancel)
    })
    .await
    .map_err(|error| format!("A instalação foi interrompida: {error}"));
    unregister_download(&state, &download_key);
    let result = result?;
    let (executable, version) = result?;

    let mut config: AppConfig = read_json(&config_path);
    config.emulators.insert(emulator_id.clone(), executable);
    config.emulator_versions.insert(emulator_id, version);
    write_json(&config_path, &config)?;
    Ok(build_runtime_info(&state))
}

#[tauri::command]
fn cancel_download(
    kind: String,
    id: String,
    discard: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = download_key(&kind, &id)?;
    let active = {
        let cancellations = state
            .download_cancellations
            .lock()
            .map_err(|_| "Não foi possível acessar o controle do download.".to_string())?;
        cancellations.get(&key).cloned()
    };
    if let Some(cancel) = active {
        cancel.request(discard);
        return Ok(());
    }
    if discard {
        return discard_download_files(&state, &kind, &id);
    }
    Err("Este download não está em execução.".into())
}

#[tauri::command]
fn import_bios(
    emulator_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !matches!(emulator_id.as_str(), "pcsx2" | "duckstation") {
        return Err(
            "A importação guiada de BIOS ainda não está disponível para este emulador.".into(),
        );
    }
    let source = PathBuf::from(file_path);
    if !source.is_file() {
        return Err("O arquivo de BIOS selecionado não existe.".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !matches!(extension.to_ascii_lowercase().as_str(), "bin" | "rom") {
        return Err("Selecione uma BIOS nos formatos .bin ou .rom.".into());
    }
    let config: AppConfig = read_json(&state.config_path());
    let emulator = detect_emulator(&config, &emulator_id)
        .ok_or_else(|| "Instale o emulador antes de adicionar a BIOS.".to_string())?;
    let bios_dir = emulator
        .parent()
        .ok_or_else(|| "A pasta do emulador não foi encontrada.".to_string())?
        .join("bios");
    fs::create_dir_all(&bios_dir).map_err(|error| error.to_string())?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "O nome do arquivo de BIOS é inválido.".to_string())?;
    let destination = bios_dir.join(file_name);
    if source.canonicalize().ok().as_ref() == destination.canonicalize().ok().as_ref() {
        return Ok(());
    }
    if destination.exists() {
        return Err(
            "Já existe uma BIOS com esse nome. Renomeie o arquivo antes de importar outra.".into(),
        );
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|error| format!("Não foi possível copiar a BIOS: {error}"))
}

#[tauri::command]
fn import_local_game(
    game: GameInput,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<InstalledGame, String> {
    let config: AppConfig = read_json(&state.config_path());
    if config.library_path.is_none() {
        return Err("Escolha primeiro a pasta da biblioteca nas configurações.".into());
    }
    let selected = PathBuf::from(file_path);
    if !selected.is_file() {
        return Err("O arquivo do jogo não existe ou não pode ser acessado.".into());
    }
    let extension = selected
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !supported_extensions(&game.system).contains(&extension.as_str()) {
        return Err(format!(
            "O formato .{} não é aceito para {}.",
            extension, game.title
        ));
    }
    let canonical = selected.canonicalize().map_err(|error| error.to_string())?;
    let mut library: Vec<InstalledGame> = read_json(&state.library_index_path());
    let previous = library.iter().find(|item| item.game_id == game.id).cloned();
    library.retain(|item| item.game_id != game.id);
    let installed = InstalledGame {
        game_id: game.id,
        installed_at: previous
            .as_ref()
            .map(|item| item.installed_at.clone())
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        last_played_at: previous
            .as_ref()
            .and_then(|item| item.last_played_at.clone()),
        play_time_minutes: previous.map(|item| item.play_time_minutes).unwrap_or(0),
        local_path: Some(canonical.to_string_lossy().into_owned()),
        managed: Some(false),
    };
    library.push(installed.clone());
    write_json(&state.library_index_path(), &library)?;
    Ok(installed)
}

#[tauri::command]
async fn install_game(
    game: GameInput,
    on_event: Channel<GameInstallEvent>,
    state: State<'_, AppState>,
) -> Result<InstalledGame, String> {
    let config_path = state.config_path();
    let library_index_path = state.library_index_path();
    let config: AppConfig = read_json(&config_path);
    let library_path = config
        .library_path
        .ok_or_else(|| "A biblioteca padrão não pôde ser configurada.".to_string())?;
    let source_url = game
        .source_url
        .clone()
        .ok_or_else(|| "Este item do catálogo ainda não possui download disponível.".to_string())?;
    let file_name = game
        .file_name
        .clone()
        .ok_or_else(|| "O catálogo não informou o nome do arquivo.".to_string())?;
    let (download_key, cancel) = register_download(&state, "game", &game.id)?;
    let id = game.id.clone();
    let title = game.title.clone();
    let system = game.system.clone();
    let expected_size = game.file_size_bytes;
    let checksum = game.checksum.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        managed_games::install_game(
            &library_path,
            managed_games::GameDownload {
                id: &id,
                title: &title,
                system: &system,
                source_url: &source_url,
                file_name: &file_name,
                expected_size,
                sha1: checksum.as_deref().filter(|value| value.len() == 40),
            },
            on_event,
            cancel,
        )
    })
    .await
    .map_err(|error| format!("A instalação foi interrompida: {error}"));
    unregister_download(&state, &download_key);
    let result = result?;
    let local_path = result?;

    let mut library: Vec<InstalledGame> = read_json(&library_index_path);
    let previous = library.iter().find(|item| item.game_id == game.id).cloned();
    library.retain(|item| item.game_id != game.id);
    let installed = InstalledGame {
        game_id: game.id,
        installed_at: previous
            .as_ref()
            .map(|item| item.installed_at.clone())
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        last_played_at: previous
            .as_ref()
            .and_then(|item| item.last_played_at.clone()),
        play_time_minutes: previous.map(|item| item.play_time_minutes).unwrap_or(0),
        local_path: Some(local_path.to_string_lossy().into_owned()),
        managed: Some(true),
    };
    library.push(installed.clone());
    write_json(&library_index_path, &library)?;
    Ok(installed)
}

#[tauri::command]
fn launch_game(game: GameInput, state: State<'_, AppState>) -> Result<(), String> {
    let config: AppConfig = read_json(&state.config_path());
    let hardware = hardware_profile();
    let graphics = effective_graphics(&config.settings, &hardware);
    let emulator_id = emulator_for_system(&game.system)
        .ok_or_else(|| "Este sistema ainda não possui emulador configurado.".to_string())?;
    let emulator = detect_emulator(&config, emulator_id).ok_or_else(|| {
        format!(
            "Configure o {} antes de iniciar este jogo.",
            emulator_metadata(emulator_id)
                .map(|metadata| metadata.0)
                .unwrap_or("emulador")
        )
    })?;
    let mut emulator_settings = config
        .emulator_settings
        .get(emulator_id)
        .cloned()
        .unwrap_or_else(|| default_emulator_settings(emulator_id, &config.settings));
    if !config.emulator_settings.contains_key(emulator_id) {
        emulator_settings.video.internal_resolution = graphics.internal_resolution;
        emulator_settings.video.anti_aliasing = graphics.anti_aliasing.clone();
        emulator_settings.video.texture_filtering = graphics.texture_filtering.clone();
        emulator_settings.video.anisotropic_filtering = graphics.anisotropic_filtering;
        emulator_settings.video.vsync = graphics.vsync;
    }
    apply_emulator_settings_to_disk(&emulator, &emulator_settings)?;
    let mut library: Vec<InstalledGame> = read_json(&state.library_index_path());
    let installed = library
        .iter_mut()
        .find(|item| item.game_id == game.id)
        .ok_or_else(|| "O jogo ainda não foi adicionado à biblioteca.".to_string())?;
    let game_path = installed
        .local_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .ok_or_else(|| "O arquivo local do jogo não foi encontrado.".to_string())?;

    let mut command = Command::new(&emulator);
    if let Some(parent) = emulator.parent() {
        command.current_dir(parent);
    }
    match emulator_id {
        "pcsx2" => {
            if config.settings.start_fullscreen {
                command.arg("-fullscreen");
            }
            command.arg("-batch").arg(&game_path);
        }
        "duckstation" => {
            command.arg("-batch");
            if config.settings.start_fullscreen {
                command.arg("-fullscreen");
            }
            command.arg(&game_path);
        }
        "dolphin" => {
            command.arg("-b");
            if config.settings.start_fullscreen {
                command.arg("-f");
            }
            let multisampling = match emulator_settings.video.anti_aliasing.as_str() {
                "msaa2" => 2,
                "msaa4" => 4,
                "msaa8" => 8,
                _ => 1,
            };
            let anisotropy = emulator_settings.video.anisotropic_filtering.ilog2();
            command
                .arg(format!(
                    "--config=GFX.Settings.InternalResolution={}",
                    emulator_settings.video.internal_resolution
                ))
                .arg(format!(
                    "--config=GFX.Hardware.VSync={}",
                    emulator_settings.video.vsync
                ))
                .arg(format!("--config=GFX.Settings.MSAA={multisampling}"))
                .arg(format!(
                    "--config=GFX.Enhancements.MaxAnisotropy={anisotropy}"
                ))
                .arg(format!(
                    "--config=Dolphin.DSP.Volume={}",
                    if emulator_settings.audio.muted {
                        0
                    } else {
                        emulator_settings.audio.volume
                    }
                ))
                .arg(format!(
                    "--config=Dolphin.Interface.PauseOnFocusLost={}",
                    emulator_settings.emulation.pause_when_inactive
                ))
                .arg("-e")
                .arg(&game_path);
        }
        "retroarch" => {
            let emulator_dir = emulator
                .parent()
                .ok_or_else(|| "A pasta do RetroArch não foi encontrada.".to_string())?;
            let core_name = retroarch_core_for_system(&game.system)
                .ok_or_else(|| "Não há um núcleo definido para este console.".to_string())?;
            let core_path = emulator_dir.join("cores").join(core_name);
            if !core_path.is_file() {
                return Err(format!(
                    "O núcleo {core_name} não está instalado. Reinstale o RetroArch pelo launcher para corrigir."
                ));
            }
            let config_path = emulator_dir.join("NoLostMedia.cfg");
            let runtime_config = apply_retroarch_detailed(emulator_dir, &emulator_settings)?;
            let library_path = config
                .library_path
                .as_ref()
                .ok_or_else(|| "A pasta da biblioteca não está configurada.".to_string())?;
            let game_save_dir = library_path
                .join("saves")
                .join(safe_path_component(&game.system)?)
                .join(safe_path_component(&game.id)?);
            let game_state_dir = game_save_dir.join("states");
            fs::create_dir_all(&game_state_dir).map_err(|error| error.to_string())?;
            let normalized_save_dir = game_save_dir.to_string_lossy().replace('\\', "/");
            let normalized_state_dir = game_state_dir.to_string_lossy().replace('\\', "/");
            let mut runtime_file = fs::OpenOptions::new()
                .append(true)
                .open(&runtime_config)
                .map_err(|error| error.to_string())?;
            writeln!(
                runtime_file,
                "savefile_directory = \"{normalized_save_dir}\"\nsavestate_directory = \"{normalized_state_dir}\""
            )
            .map_err(|error| error.to_string())?;
            if config.settings.start_fullscreen {
                command.arg("-f");
            }
            if config_path.is_file() {
                command.args(["-c"]).arg(config_path);
            }
            command.arg("--appendconfig").arg(runtime_config);
            command.args(["-L"]).arg(core_path).arg(&game_path);
        }
        _ => return Err("Emulador não reconhecido.".into()),
    }
    command
        .spawn()
        .map_err(|error| format!("Não foi possível abrir o emulador: {error}"))?;
    installed.last_played_at = Some(Utc::now().to_rfc3339());
    let _ = write_json(&state.library_index_path(), &library);
    Ok(())
}

fn count_regular_files(root: &Path) -> Result<usize, String> {
    if !root.exists() {
        return Ok(0);
    }
    let mut count = 0;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            count += count_regular_files(&entry.path())?;
        } else if kind.is_file() {
            count += 1;
        }
    }
    Ok(count)
}

fn save_file_matches(file_name: &str, game_stem: &str) -> bool {
    let name = file_name.to_lowercase();
    let stem = game_stem.to_lowercase();
    !stem.is_empty() && (name == stem || name.starts_with(&format!("{stem}.")))
}

fn remove_legacy_save_files(root: &Path, game_stem: &str) -> Result<usize, String> {
    if !root.exists() || game_stem.is_empty() {
        return Ok(0);
    }
    let mut deleted = 0;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            deleted += remove_legacy_save_files(&entry.path(), game_stem)?;
        } else if kind.is_file()
            && save_file_matches(&entry.file_name().to_string_lossy(), game_stem)
        {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

fn direct_managed_directory(root: &Path, candidate: &Path) -> Result<Option<PathBuf>, String> {
    if !candidate.is_dir() {
        return Ok(None);
    }
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if canonical_candidate.parent() != Some(canonical_root.as_path()) {
        return Err("O launcher recusou apagar uma pasta fora da biblioteca gerenciada.".into());
    }
    Ok(Some(canonical_candidate))
}

#[tauri::command]
fn remove_game(
    game: GameInput,
    delete_saves: bool,
    state: State<'_, AppState>,
) -> Result<RemoveGameResult, String> {
    let game_id = safe_path_component(&game.id)?;
    let system = safe_path_component(&game.system)?;
    let config: AppConfig = read_json(&state.config_path());
    let library_path = config
        .library_path
        .ok_or_else(|| "A pasta da biblioteca não está configurada.".to_string())?;
    let mut library: Vec<InstalledGame> = read_json(&state.library_index_path());
    let installed = library
        .iter()
        .find(|item| item.game_id == game.id)
        .cloned()
        .ok_or_else(|| "O jogo não está na biblioteca local.".to_string())?;

    let managed_games_root = library_path.join("games").join(system);
    let managed_game_dir = managed_games_root.join(game_id);
    let game_files_deleted = if let Some(managed_canonical) =
        direct_managed_directory(&managed_games_root, &managed_game_dir)?
    {
        let inferred_managed = installed
            .local_path
            .as_ref()
            .map(PathBuf::from)
            .and_then(|path| path.canonicalize().ok())
            .is_some_and(|path| path.starts_with(&managed_canonical));
        let local_is_managed = installed.managed.unwrap_or(inferred_managed);
        if local_is_managed {
            fs::remove_dir_all(&managed_canonical)
                .map_err(|error| format!("Não foi possível apagar os arquivos do jogo: {error}"))?;
            true
        } else {
            false
        }
    } else {
        false
    };

    let cache_root = library_path.join("cache").join("games");
    let cache_dir = cache_root.join(game_id);
    if let Some(cache_canonical) = direct_managed_directory(&cache_root, &cache_dir)? {
        let _ = fs::remove_dir_all(cache_canonical);
    }

    let mut save_files_deleted = 0;
    if delete_saves {
        let saves_root = library_path.join("saves").join(system);
        let per_game_saves = saves_root.join(game_id);
        if let Some(saves_canonical) = direct_managed_directory(&saves_root, &per_game_saves)? {
            save_files_deleted += count_regular_files(&saves_canonical)?;
            fs::remove_dir_all(&saves_canonical)
                .map_err(|error| format!("Não foi possível apagar os saves do jogo: {error}"))?;
        }
        if matches!(
            game.system.as_str(),
            "nes" | "snes" | "gba" | "n64" | "dreamcast"
        ) {
            if let Some(game_stem) = installed
                .local_path
                .as_ref()
                .and_then(|path| Path::new(path).file_stem())
                .and_then(|value| value.to_str())
            {
                let saves_root = library_path.join("saves");
                let legacy_root = saves_root.join("retroarch");
                if let Some(legacy_canonical) = direct_managed_directory(&saves_root, &legacy_root)?
                {
                    save_files_deleted += remove_legacy_save_files(&legacy_canonical, game_stem)?;
                }
            }
        }
    }

    library.retain(|item| item.game_id != game.id);
    write_json(&state.library_index_path(), &library)?;
    Ok(RemoveGameResult {
        game_files_deleted,
        save_files_deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::{direct_managed_directory, remove_legacy_save_files, save_file_matches};
    use std::fs;

    #[test]
    fn save_files_are_matched_by_the_complete_game_stem() {
        assert!(save_file_matches("Pokemon Emerald.srm", "Pokemon Emerald"));
        assert!(save_file_matches(
            "Pokemon Emerald.state.auto.png",
            "Pokemon Emerald"
        ));
        assert!(!save_file_matches(
            "Pokemon Emerald 2.srm",
            "Pokemon Emerald"
        ));
        assert!(!save_file_matches("Pokemon.srm", "Pokemon Emerald"));
    }

    #[test]
    fn only_the_selected_games_legacy_saves_are_removed() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let core_dir = temporary.path().join("retroarch").join("mGBA");
        fs::create_dir_all(&core_dir).expect("save directory");
        fs::write(core_dir.join("Pokemon Emerald.srm"), b"save").expect("save file");
        fs::write(core_dir.join("Pokemon Emerald.state.auto"), b"state").expect("state file");
        fs::write(core_dir.join("Pokemon Emerald 2.srm"), b"other").expect("other save");

        let deleted =
            remove_legacy_save_files(temporary.path(), "Pokemon Emerald").expect("save cleanup");

        assert_eq!(deleted, 2);
        assert!(core_dir.join("Pokemon Emerald 2.srm").is_file());
    }

    #[test]
    fn destructive_directories_must_be_direct_children_of_the_managed_root() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let managed_root = temporary.path().join("games");
        let direct_child = managed_root.join("game-id");
        let nested_child = direct_child.join("unexpected");
        fs::create_dir_all(&nested_child).expect("managed directories");

        assert!(direct_managed_directory(&managed_root, &direct_child)
            .expect("direct child validation")
            .is_some());
        assert!(direct_managed_directory(&managed_root, &nested_child).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(url) = deep_link_from_args(args) {
                deliver_deep_link(app, url);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let state = AppState {
                data_dir: data_dir.clone(),
                download_cancellations: Mutex::new(HashMap::new()),
                pending_deep_link: Mutex::new(deep_link_from_args(env::args())),
            };
            let mut config: AppConfig = read_json(&state.config_path());
            if config.library_path.is_none() {
                config.library_path = Some(data_dir.join("Library"));
            }
            if let Some(library) = &config.library_path {
                create_library_folders(library).map_err(std::io::Error::other)?;
            }
            write_json(&state.config_path(), &config).map_err(std::io::Error::other)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            take_pending_deep_link,
            save_settings,
            get_emulator_settings,
            save_emulator_settings,
            list_installed_games,
            configure_library,
            configure_emulator,
            install_emulator,
            cancel_download,
            import_bios,
            import_local_game,
            install_game,
            launch_game,
            remove_game
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o No Lost Media Launcher");
}
