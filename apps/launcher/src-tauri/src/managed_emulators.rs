use reqwest::{
    blocking::Client,
    header::{CONTENT_LENGTH, RANGE},
    StatusCode,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

const RETROARCH_VERSION: &str = "1.22.2";
const RETROARCH_URL: &str =
    "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z";
const RETROARCH_CORES_URL: &str =
    "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch_cores.7z";
const RETROARCH_SIZE: u64 = 202_509_078;
const RETROARCH_CORES_SIZE: u64 = 229_761_684;
const PCSX2_VERSION: &str = "2.8.2";
const DUCKSTATION_VERSION: &str = "2026.09.12";
const DOLPHIN_VERSION: &str = "2609";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInstallEvent {
    pub state: &'static str,
    pub progress: f64,
    pub message: String,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<u64>,
    pub eta_seconds: Option<u64>,
}

pub struct ManagedEmulatorManifest {
    pub version: &'static str,
    pub download_size_bytes: u64,
    pub download_size_label: &'static str,
    pub source_name: &'static str,
}

struct Archive {
    file_name: &'static str,
    url: &'static str,
    expected_size: u64,
    sha256: &'static str,
    label: &'static str,
    kind: ArchiveKind,
}

#[derive(Clone, Copy)]
enum ArchiveKind {
    SevenZip,
    Zip,
}

fn verify_sha256(path: &Path, expected: &str) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(expected))
}

pub fn manifest(id: &str) -> Option<ManagedEmulatorManifest> {
    match id {
        "pcsx2" => Some(ManagedEmulatorManifest {
            version: PCSX2_VERSION,
            download_size_bytes: 25_670_075,
            download_size_label: "24,5 MB",
            source_name: "PCSX2 Team (oficial)",
        }),
        "duckstation" => Some(ManagedEmulatorManifest {
            version: DUCKSTATION_VERSION,
            download_size_bytes: 72_669_228,
            download_size_label: "69,3 MB",
            source_name: "DuckStation (oficial)",
        }),
        "dolphin" => Some(ManagedEmulatorManifest {
            version: DOLPHIN_VERSION,
            download_size_bytes: 20_034_258,
            download_size_label: "19,1 MB",
            source_name: "Dolphin Emulator (oficial)",
        }),
        "retroarch" => Some(ManagedEmulatorManifest {
            version: RETROARCH_VERSION,
            download_size_bytes: RETROARCH_SIZE + RETROARCH_CORES_SIZE,
            download_size_label: "412 MB",
            source_name: "Libretro (oficial)",
        }),
        _ => None,
    }
}

fn send_progress(
    channel: &Channel<EmulatorInstallEvent>,
    state: &'static str,
    progress: f64,
    message: impl Into<String>,
) {
    let _ = channel.send(EmulatorInstallEvent {
        state,
        progress: progress.clamp(0.0, 100.0),
        message: message.into(),
        downloaded_bytes: None,
        total_bytes: None,
        speed_bytes_per_second: None,
        eta_seconds: None,
    });
}

fn send_transfer_progress(
    channel: &Channel<EmulatorInstallEvent>,
    progress: f64,
    message: impl Into<String>,
    downloaded: u64,
    total: u64,
    speed: u64,
) {
    let _ = channel.send(EmulatorInstallEvent {
        state: "downloading",
        progress: progress.clamp(0.0, 100.0),
        message: message.into(),
        downloaded_bytes: Some(downloaded),
        total_bytes: Some(total),
        speed_bytes_per_second: Some(speed),
        eta_seconds: (speed > 0 && total > downloaded).then_some((total - downloaded) / speed),
    });
}

fn ensure_disk_space(path: &Path, total_size: u64, downloaded: u64) -> Result<(), String> {
    let remaining = total_size.saturating_sub(downloaded);
    let required = remaining
        .saturating_add(total_size)
        .saturating_add(256 * 1024 * 1024);
    let available = fs2::available_space(path).map_err(|error| error.to_string())?;
    if available < required {
        return Err(format!(
            "Espaço insuficiente: são necessários aproximadamente {:.1} GB livres, mas há {:.1} GB disponíveis.",
            required as f64 / 1_073_741_824.0,
            available as f64 / 1_073_741_824.0
        ));
    }
    Ok(())
}

fn check_cancelled(cancel: &crate::DownloadCancellation) -> Result<(), String> {
    if cancel.is_requested() {
        Err(crate::DOWNLOAD_CANCELLED.into())
    } else {
        Ok(())
    }
}

fn download_archive(
    client: &Client,
    archive: &Archive,
    cache_dir: &Path,
    completed_before: u64,
    total_size: u64,
    channel: &Channel<EmulatorInstallEvent>,
    cancel: &crate::DownloadCancellation,
) -> Result<PathBuf, String> {
    check_cancelled(cancel)?;
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
    let final_path = cache_dir.join(archive.file_name);
    if final_path
        .metadata()
        .is_ok_and(|metadata| metadata.len() == archive.expected_size)
        && verify_sha256(&final_path, archive.sha256)?
    {
        return Ok(final_path);
    }

    let partial_path = cache_dir.join(format!("{}.part", archive.file_name));
    let mut downloaded = partial_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if downloaded == archive.expected_size {
        if verify_sha256(&partial_path, archive.sha256)? {
            if final_path.exists() {
                fs::remove_file(&final_path).map_err(|error| error.to_string())?;
            }
            fs::rename(&partial_path, &final_path).map_err(|error| error.to_string())?;
            return Ok(final_path);
        }
        fs::remove_file(&partial_path).map_err(|error| error.to_string())?;
        downloaded = 0;
    }
    if downloaded > archive.expected_size {
        fs::remove_file(&partial_path).map_err(|error| error.to_string())?;
        downloaded = 0;
    }
    ensure_disk_space(cache_dir, total_size, completed_before + downloaded)?;

    let mut request = client.get(archive.url);
    if downloaded > 0 {
        request = request.header(RANGE, format!("bytes={downloaded}-"));
    }
    let mut response = request
        .send()
        .map_err(|error| format!("Falha ao baixar {}: {error}", archive.label))?;

    let append = downloaded > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    if !append {
        downloaded = 0;
    }
    if !response.status().is_success() {
        return Err(format!(
            "O servidor oficial recusou o download de {} (HTTP {}).",
            archive.label,
            response.status()
        ));
    }

    let response_size = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if let Some(response_size) = response_size {
        let resulting_size = if append {
            downloaded + response_size
        } else {
            response_size
        };
        if resulting_size != archive.expected_size {
            return Err(format!(
                "O tamanho informado para {} não corresponde ao pacote oficial esperado.",
                archive.label
            ));
        }
    }

    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial_path)
        .map_err(|error| error.to_string())?;
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut last_update = Instant::now() - Duration::from_secs(1);
    let transfer_started = Instant::now();
    let transfer_start_bytes = downloaded;
    loop {
        check_cancelled(cancel)?;
        let read = response.read(&mut buffer).map_err(|error| {
            format!("O download de {} foi interrompido: {error}", archive.label)
        })?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        downloaded += read as u64;
        if last_update.elapsed() >= Duration::from_millis(180) {
            let current_total = completed_before + downloaded;
            let progress = 2.0 + (current_total as f64 / total_size as f64) * 72.0;
            let elapsed = transfer_started.elapsed().as_secs_f64().max(0.001);
            let speed = ((downloaded - transfer_start_bytes) as f64 / elapsed) as u64;
            send_transfer_progress(
                channel,
                progress,
                format!(
                    "Baixando {}… {:.0}%",
                    archive.label,
                    downloaded as f64 / archive.expected_size as f64 * 100.0
                ),
                current_total,
                total_size,
                speed,
            );
            last_update = Instant::now();
        }
    }
    output.flush().map_err(|error| error.to_string())?;
    drop(output);
    check_cancelled(cancel)?;

    let actual_size = partial_path
        .metadata()
        .map_err(|error| error.to_string())?
        .len();
    if actual_size != archive.expected_size {
        return Err(format!(
            "O download de {} ficou incompleto ({} de {} bytes). Ele poderá ser retomado.",
            archive.label, actual_size, archive.expected_size
        ));
    }
    send_progress(
        channel,
        "downloading",
        2.0 + ((completed_before + actual_size) as f64 / total_size as f64) * 72.0,
        format!("Verificando a integridade de {}…", archive.label),
    );
    if !verify_sha256(&partial_path, archive.sha256)? {
        fs::remove_file(&partial_path).map_err(|error| error.to_string())?;
        return Err(format!(
            "A verificação de segurança de {} falhou. Baixe novamente.",
            archive.label
        ));
    }
    if final_path.exists() {
        fs::remove_file(&final_path).map_err(|error| error.to_string())?;
    }
    fs::rename(&partial_path, &final_path).map_err(|error| error.to_string())?;
    Ok(final_path)
}

fn find_file(root: &Path, file_name: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(file_name))
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file(&path, file_name, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn extract_archive(archive: &Archive, source: &Path, destination: &Path) -> Result<(), String> {
    match archive.kind {
        ArchiveKind::SevenZip => sevenz_rust::decompress_file(source, destination)
            .map_err(|error| format!("Não foi possível extrair o pacote: {error}")),
        ArchiveKind::Zip => {
            let file = fs::File::open(source).map_err(|error| error.to_string())?;
            let mut zip = zip::ZipArchive::new(file)
                .map_err(|error| format!("O pacote ZIP é inválido: {error}"))?;
            for index in 0..zip.len() {
                let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
                let relative = entry
                    .enclosed_name()
                    .ok_or_else(|| "O pacote contém um caminho inseguro.".to_string())?;
                let output_path = destination.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
                    continue;
                }
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                let mut output =
                    fs::File::create(&output_path).map_err(|error| error.to_string())?;
                std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
            }
            Ok(())
        }
    }
}

fn install_portable_emulator(
    id: &str,
    library: &Path,
    archive: Archive,
    executable_names: &[&str],
    portable_marker: &str,
    channel: Channel<EmulatorInstallEvent>,
    cancel: Arc<crate::DownloadCancellation>,
) -> Result<(PathBuf, String), String> {
    check_cancelled(&cancel)?;
    let manifest = manifest(id).ok_or_else(|| "Manifesto do emulador ausente.".to_string())?;
    send_progress(
        &channel,
        "queued",
        1.0,
        format!("Preparando a instalação de {}…", archive.label),
    );
    let cache_dir = library
        .join("cache")
        .join("emulators")
        .join(id)
        .join(manifest.version);
    let client = Client::builder()
        .user_agent("No-Lost-Media-Launcher/0.1")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 30))
        .build()
        .map_err(|error| error.to_string())?;
    let archive_path = download_archive(
        &client,
        &archive,
        &cache_dir,
        0,
        archive.expected_size,
        &channel,
        &cancel,
    )?;
    check_cancelled(&cancel)?;

    let emulators_dir = library.join("emulators");
    fs::create_dir_all(&emulators_dir).map_err(|error| error.to_string())?;
    let staging = emulators_dir.join(format!(".{id}-installing-{}", manifest.version));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    send_progress(
        &channel,
        "extracting",
        78.0,
        format!("Extraindo {}…", archive.label),
    );
    extract_archive(&archive, &archive_path, &staging)?;
    check_cancelled(&cancel)?;

    let extracted_executable = executable_names
        .iter()
        .find_map(|name| find_file(&staging, name, 5))
        .ok_or_else(|| {
            format!(
                "O pacote oficial de {} não contém o executável esperado.",
                archive.label
            )
        })?;
    let extracted_root = extracted_executable
        .parent()
        .ok_or_else(|| "A estrutura do pacote é inválida.".to_string())?
        .to_path_buf();
    send_progress(
        &channel,
        "configuring",
        94.0,
        "Ativando o modo portátil e organizando os dados…",
    );
    fs::write(extracted_root.join(portable_marker), b"").map_err(|error| error.to_string())?;

    let install_dir = emulators_dir.join(id);
    let backup_dir = emulators_dir.join(format!(".{id}-previous"));
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    }
    if install_dir.exists() {
        fs::rename(&install_dir, &backup_dir).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&extracted_root, &install_dir) {
        if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &install_dir);
        }
        return Err(format!("Não foi possível ativar a instalação: {error}"));
    }
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    let executable_name = extracted_executable
        .file_name()
        .ok_or_else(|| "O nome do executável é inválido.".to_string())?;
    let executable = install_dir.join(executable_name);
    if !executable.is_file() {
        return Err("A instalação terminou sem o executável esperado.".into());
    }
    send_progress(
        &channel,
        "configuring",
        100.0,
        format!("{} pronto para jogar.", archive.label),
    );
    Ok((executable, manifest.version.to_string()))
}

fn retroarch_config(library: &Path) -> Result<String, String> {
    let saves = library.join("saves").join("retroarch");
    let states = saves.join("states");
    fs::create_dir_all(&states).map_err(|error| error.to_string())?;
    let normalize = |path: &Path| path.to_string_lossy().replace('\\', "/");
    Ok(format!(
        "savefile_directory = \"{}\"\nsavestate_directory = \"{}\"\nsavestate_auto_save = \"true\"\nsavestate_auto_load = \"true\"\npause_nonactive = \"false\"\nmenu_driver = \"ozone\"\n",
        normalize(&saves),
        normalize(&states)
    ))
}

pub fn install_retroarch(
    library: &Path,
    channel: Channel<EmulatorInstallEvent>,
    cancel: Arc<crate::DownloadCancellation>,
) -> Result<(PathBuf, String), String> {
    check_cancelled(&cancel)?;
    send_progress(
        &channel,
        "queued",
        1.0,
        "Preparando a instalação do RetroArch…",
    );
    let manifest = manifest("retroarch").expect("manifesto do RetroArch ausente");
    let cache_dir = library
        .join("cache")
        .join("emulators")
        .join("retroarch")
        .join(manifest.version);
    let archives = [
        Archive {
            file_name: "RetroArch.7z",
            url: RETROARCH_URL,
            expected_size: RETROARCH_SIZE,
            sha256: "b2139b1d0f9d4526dc6b5ce23cbb3efdc766096fa6f2c3df016818b486ac6372",
            label: "RetroArch",
            kind: ArchiveKind::SevenZip,
        },
        Archive {
            file_name: "RetroArch_cores.7z",
            url: RETROARCH_CORES_URL,
            expected_size: RETROARCH_CORES_SIZE,
            sha256: "86b871e11b9b4772ac644b40a38f2c8e9449da1f355eae7da08aa061148547b0",
            label: "núcleos dos consoles",
            kind: ArchiveKind::SevenZip,
        },
    ];
    let client = Client::builder()
        .user_agent("No-Lost-Media-Launcher/0.1")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 30))
        .build()
        .map_err(|error| error.to_string())?;

    let mut downloaded_archives = Vec::new();
    let mut completed = 0;
    for archive in &archives {
        downloaded_archives.push(download_archive(
            &client,
            archive,
            &cache_dir,
            completed,
            manifest.download_size_bytes,
            &channel,
            &cancel,
        )?);
        completed += archive.expected_size;
    }

    let emulators_dir = library.join("emulators");
    fs::create_dir_all(&emulators_dir).map_err(|error| error.to_string())?;
    let staging = emulators_dir.join(".retroarch-installing-1.22.2");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    for (index, archive_path) in downloaded_archives.iter().enumerate() {
        check_cancelled(&cancel)?;
        send_progress(
            &channel,
            "extracting",
            76.0 + index as f64 * 8.0,
            if index == 0 {
                "Extraindo o RetroArch…"
            } else {
                "Instalando os núcleos dos consoles…"
            },
        );
        sevenz_rust::decompress_file(archive_path, &staging)
            .map_err(|error| format!("Não foi possível extrair o pacote: {error}"))?;
        check_cancelled(&cancel)?;
    }

    let extracted_executable = find_file(&staging, "retroarch.exe", 4)
        .ok_or_else(|| "O pacote oficial não contém o executável do RetroArch.".to_string())?;
    let extracted_root = extracted_executable
        .parent()
        .ok_or_else(|| "A estrutura do pacote do RetroArch é inválida.".to_string())?
        .to_path_buf();
    let cores_dir = extracted_root.join("cores");
    for core in [
        "mesen_libretro.dll",
        "snes9x_libretro.dll",
        "mgba_libretro.dll",
        "mupen64plus_next_libretro.dll",
        "flycast_libretro.dll",
    ] {
        if !cores_dir.join(core).is_file() {
            return Err(format!(
                "O núcleo obrigatório {core} não foi encontrado no pacote oficial."
            ));
        }
    }

    send_progress(
        &channel,
        "configuring",
        94.0,
        "Aplicando saves e configurações padrão…",
    );
    fs::write(
        extracted_root.join("NoLostMedia.cfg"),
        retroarch_config(library)?,
    )
    .map_err(|error| error.to_string())?;

    let install_dir = emulators_dir.join("retroarch");
    let backup_dir = emulators_dir.join(".retroarch-previous");
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    }
    if install_dir.exists() {
        fs::rename(&install_dir, &backup_dir).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&extracted_root, &install_dir) {
        if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &install_dir);
        }
        return Err(format!(
            "Não foi possível ativar a nova instalação: {error}"
        ));
    }
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    let executable = install_dir.join("retroarch.exe");
    if !executable.is_file() {
        return Err("A instalação terminou sem o executável do RetroArch.".into());
    }
    send_progress(
        &channel,
        "configuring",
        100.0,
        "RetroArch pronto para jogar.",
    );
    Ok((executable, manifest.version.to_string()))
}

pub fn install(
    id: &str,
    library: &Path,
    channel: Channel<EmulatorInstallEvent>,
    cancel: Arc<crate::DownloadCancellation>,
) -> Result<(PathBuf, String), String> {
    let result = match id {
        "pcsx2" => install_portable_emulator(
            id,
            library,
            Archive {
                file_name: "pcsx2-v2.8.2-windows-x64-Qt.7z",
                url: "https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/pcsx2-v2.8.2-windows-x64-Qt.7z",
                expected_size: 25_670_075,
                sha256: "7dfc829ca1994cc1045ac49f05e39b6cf968b72e6a374c40e05c2a2b4ac200b4",
                label: "PCSX2",
                kind: ArchiveKind::SevenZip,
            },
            &["pcsx2-qt.exe", "pcsx2.exe"],
            "portable.ini",
            channel,
            Arc::clone(&cancel),
        ),
        "duckstation" => install_portable_emulator(
            id,
            library,
            Archive {
                file_name: "duckstation-windows-x64-release.zip",
                url: "https://github.com/stenzek/duckstation/releases/download/latest/duckstation-windows-x64-release.zip",
                expected_size: 72_669_228,
                sha256: "5ba3b9624b3073d3398c2cb8185ba3a014ff9e84f9c486627e0e8aa56371d352",
                label: "DuckStation",
                kind: ArchiveKind::Zip,
            },
            &["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe"],
            "portable.txt",
            channel,
            Arc::clone(&cancel),
        ),
        "dolphin" => install_portable_emulator(
            id,
            library,
            Archive {
                file_name: "dolphin-2609-x64.7z",
                url: "https://dl.dolphin-emu.org/releases/2609/dolphin-2609-x64.7z",
                expected_size: 20_034_258,
                sha256: "1aa25785b7d4cb76259754c5fbcdd8856857b8e7bb4e523c57a8ac56665fba75",
                label: "Dolphin",
                kind: ArchiveKind::SevenZip,
            },
            &["Dolphin.exe"],
            "portable.txt",
            channel,
            Arc::clone(&cancel),
        ),
        "retroarch" => install_retroarch(library, channel, Arc::clone(&cancel)),
        _ => Err("Instalador gerenciado não implementado.".into()),
    };
    if result.is_err() && cancel.should_discard() {
        if let Some(manifest) = manifest(id) {
            let _ = fs::remove_dir_all(
                library
                    .join("cache")
                    .join("emulators")
                    .join(id)
                    .join(manifest.version),
            );
            let _ = fs::remove_dir_all(
                library
                    .join("emulators")
                    .join(format!(".{id}-installing-{}", manifest.version)),
            );
        }
    }
    result
}
