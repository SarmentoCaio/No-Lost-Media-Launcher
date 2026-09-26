use reqwest::{
    blocking::Client,
    header::{CONTENT_LENGTH, RANGE},
    StatusCode, Url,
};
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstallEvent {
    pub state: &'static str,
    pub progress: f64,
    pub message: String,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<u64>,
    pub eta_seconds: Option<u64>,
}

pub struct GameDownload<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub system: &'a str,
    pub source_url: &'a str,
    pub file_name: &'a str,
    pub expected_size: Option<u64>,
    pub sha1: Option<&'a str>,
}

fn send(
    channel: &Channel<GameInstallEvent>,
    state: &'static str,
    progress: f64,
    message: impl Into<String>,
) {
    let _ = channel.send(GameInstallEvent {
        state,
        progress: progress.clamp(0.0, 100.0),
        message: message.into(),
        downloaded_bytes: None,
        total_bytes: None,
        speed_bytes_per_second: None,
        eta_seconds: None,
    });
}

fn send_transfer(
    channel: &Channel<GameInstallEvent>,
    progress: f64,
    message: impl Into<String>,
    downloaded: u64,
    total: Option<u64>,
    speed: u64,
) {
    let _ = channel.send(GameInstallEvent {
        state: "downloading",
        progress: progress.clamp(0.0, 100.0),
        message: message.into(),
        downloaded_bytes: Some(downloaded),
        total_bytes: total,
        speed_bytes_per_second: Some(speed),
        eta_seconds: total.and_then(|size| {
            (speed > 0 && size > downloaded).then_some((size - downloaded) / speed)
        }),
    });
}

fn ensure_disk_space(
    path: &Path,
    download_size: Option<u64>,
    already_downloaded: u64,
) -> Result<(), String> {
    let Some(size) = download_size else {
        return Ok(());
    };
    let remaining = size.saturating_sub(already_downloaded);
    let required = remaining
        .saturating_add(size)
        .saturating_add(512 * 1024 * 1024);
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

fn validate_source(value: &str) -> Result<Url, String> {
    let mut url_str = value.to_string();
    if url_str.contains("no-lost-media-bff.onrender.com") {
        url_str = url_str.replace("https://no-lost-media-bff.onrender.com", "https://api.nolost.media");
    }
    let url = Url::parse(&url_str).map_err(|_| "O endereço de download do catálogo é inválido.")?;
    if url.scheme() != "https" {
        return Err("O launcher aceita somente downloads protegidos por HTTPS.".into());
    }
    let host = url.host_str().unwrap_or_default();
    let archive = host == "archive.org" || host.ends_with(".archive.org");
    let gateway = host == "nolost.media"
        || host.ends_with(".nolost.media")
        || host.ends_with(".trycloudflare.com")
        || host.ends_with(".pages.dev")
        || host.ends_with(".vercel.app")
        || host == "no-lost-media-bff.onrender.com"
        || host.ends_with(".onrender.com");
    if !archive && !gateway {
        return Err(
            "A origem do arquivo não pertence ao acervo autorizado do No Lost Media.".into(),
        );
    }
    Ok(url)
}

fn safe_component(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains(':')
    {
        return Err("O catálogo informou um nome de arquivo inseguro.".into());
    }
    Ok(value)
}

fn local_file_name(value: &str) -> Result<String, String> {
    let source = Path::new(value)
        .file_name()
        .and_then(|item| item.to_str())
        .ok_or_else(|| "O catálogo informou um nome de arquivo inválido.".to_string())?;
    let sanitized: String = source
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) || character.is_control()
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let sanitized = sanitized.trim().trim_end_matches(['.', ' ']).to_string();
    if sanitized.is_empty() {
        return Err("O catálogo informou um nome de arquivo vazio.".into());
    }
    Ok(sanitized)
}

fn verify_sha1(path: &Path, expected: &str) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha1::new();
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

fn download(
    game: &GameDownload<'_>,
    cache_dir: &Path,
    channel: &Channel<GameInstallEvent>,
    cancel: &crate::DownloadCancellation,
) -> Result<PathBuf, String> {
    check_cancelled(cancel)?;
    let url = validate_source(game.source_url)?;
    let file_name = local_file_name(game.file_name)?;
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
    let partial = cache_dir.join(format!("{file_name}.part"));
    let complete = cache_dir.join(&file_name);
    if complete.is_file()
        && game
            .expected_size
            .map(|size| complete.metadata().is_ok_and(|item| item.len() == size))
            .unwrap_or(true)
        && game
            .sha1
            .map(|checksum| verify_sha1(&complete, checksum))
            .transpose()?
            .unwrap_or(true)
    {
        return Ok(complete);
    }

    let mut downloaded = partial.metadata().map(|item| item.len()).unwrap_or(0);
    if game.expected_size.is_some_and(|size| downloaded == size) {
        let valid = game
            .sha1
            .map(|checksum| verify_sha1(&partial, checksum))
            .transpose()?
            .unwrap_or(true);
        if valid {
            if complete.exists() {
                fs::remove_file(&complete).map_err(|error| error.to_string())?;
            }
            fs::rename(&partial, &complete).map_err(|error| error.to_string())?;
            return Ok(complete);
        }
        fs::remove_file(&partial).map_err(|error| error.to_string())?;
        downloaded = 0;
    }
    if game.expected_size.is_some_and(|size| downloaded > size) {
        fs::remove_file(&partial).map_err(|error| error.to_string())?;
        downloaded = 0;
    }
    ensure_disk_space(cache_dir, game.expected_size, downloaded)?;
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 No-Lost-Media-Launcher/0.1")
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(60 * 60 * 8))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);
    if downloaded > 0 {
        request = request.header(RANGE, format!("bytes={downloaded}-"));
    }
    let mut response = request
        .send()
        .map_err(|error| format!("Não foi possível acessar o acervo: {error}"))?;
    if !response.status().is_success() {
        if response.status() == StatusCode::SERVICE_UNAVAILABLE
            && (game.source_url.contains("no-lost-media-bff.onrender.com") || game.source_url.contains("nolost.media"))
        {
            return Err("O gateway do acervo está temporariamente indisponível. Verifique o status da conexão e tente novamente mais tarde.".into());
        }
        return Err(format!(
            "O acervo não liberou este arquivo (HTTP {}). Tente novamente mais tarde.",
            response.status()
        ));
    }
    let append = downloaded > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    if !append {
        downloaded = 0;
    }
    let response_size = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let total = response_size
        .map(|size| if append { downloaded + size } else { size })
        .or(game.expected_size);
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial)
        .map_err(|error| error.to_string())?;
    let mut buffer = vec![0_u8; 512 * 1024];
    let mut last_update = Instant::now() - Duration::from_secs(1);
    let transfer_started = Instant::now();
    let transfer_start_bytes = downloaded;
    loop {
        check_cancelled(cancel)?;
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("O download foi interrompido: {error}"))?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        downloaded += count as u64;
        if last_update.elapsed() >= Duration::from_millis(200) {
            let progress = total
                .map(|size| downloaded as f64 / size as f64 * 82.0)
                .unwrap_or(0.0);
            let message = total
                .map(|size| format!("Baixando… {:.0}%", downloaded as f64 / size as f64 * 100.0))
                .unwrap_or_else(|| format!("Baixando… {:.1} MB", downloaded as f64 / 1_048_576.0));
            let elapsed = transfer_started.elapsed().as_secs_f64().max(0.001);
            let speed = ((downloaded - transfer_start_bytes) as f64 / elapsed) as u64;
            send_transfer(channel, progress, message, downloaded, total, speed);
            last_update = Instant::now();
        }
    }
    output.flush().map_err(|error| error.to_string())?;
    drop(output);
    check_cancelled(cancel)?;
    if let Some(size) = total {
        if downloaded != size {
            return Err(format!(
                "O download ficou incompleto ({} de {} bytes) e poderá ser retomado.",
                downloaded, size
            ));
        }
    }
    if let Some(checksum) = game.sha1 {
        send(
            channel,
            "extracting",
            84.0,
            "Verificando a integridade do jogo…",
        );
        if !verify_sha1(&partial, checksum)? {
            fs::remove_file(&partial).map_err(|error| error.to_string())?;
            return Err("O arquivo baixado não corresponde ao registro do acervo.".into());
        }
    }
    if complete.exists() {
        fs::remove_file(&complete).map_err(|error| error.to_string())?;
    }
    fs::rename(&partial, &complete).map_err(|error| error.to_string())?;
    Ok(complete)
}

fn extract_zip(
    source: &Path,
    destination: &Path,
    cancel: &crate::DownloadCancellation,
) -> Result<(), String> {
    let file = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("O arquivo ZIP não pôde ser aberto: {error}"))?;
    for index in 0..archive.len() {
        check_cancelled(cancel)?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "O arquivo compactado contém um caminho inseguro.".to_string())?;
        let output_path = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = fs::File::create(output_path).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn collect_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            collect_files(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}

fn primary_game_file(root: &Path, system: &str) -> Result<PathBuf, String> {
    let priorities: &[&str] = match system {
        "ps3" => &["iso", "bin", "pkg", "sfb", "self", "eboot.bin"],
        "pc" => &["exe", "bat", "cmd", "msi", "iso", "bin"],
        "ps1" => &["cue", "chd", "pbp", "bin"],
        "ps2" => &["iso", "chd", "cso", "bin"],
        "gamecube" => &["rvz", "iso", "gcm", "wia", "chd"],
        "wii" => &["rvz", "wbfs", "iso", "wia"],
        "dreamcast" => &["gdi", "chd", "cdi"],
        "n64" => &["z64", "n64", "v64"],
        "snes" => &["sfc", "smc"],
        "nes" => &["nes"],
        "gba" => &["gba"],
        _ => &[],
    };
    let mut files = Vec::new();
    collect_files(root, &mut files)?;
    for extension in priorities {
        if let Some(file) = files.iter().find(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        }) {
            return Ok(file.clone());
        }
    }
    if system == "pc" || system == "ps3" {
        if let Some(first_file) = files.first() {
            return Ok(first_file.clone());
        }
    }
    Err("O pacote foi baixado, mas não contém um formato compatível com este console.".into())
}

fn install_game_inner(
    library: &Path,
    game: GameDownload<'_>,
    channel: Channel<GameInstallEvent>,
    cancel: Arc<crate::DownloadCancellation>,
) -> Result<PathBuf, String> {
    check_cancelled(&cancel)?;
    let source_extension = Path::new(game.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if source_extension == "rar" {
        return Err("Este item está em RAR e ainda não pode ser preparado automaticamente. Escolha outra edição do acervo.".into());
    }
    send(
        &channel,
        "queued",
        1.0,
        format!("Preparando o download de {}…", game.title),
    );
    let cache_dir = library
        .join("cache")
        .join("games")
        .join(safe_component(game.id)?);
    let downloaded = download(&game, &cache_dir, &channel, &cancel)?;
    check_cancelled(&cancel)?;
    let extension = downloaded
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let games_root = library.join("games").join(safe_component(game.system)?);
    fs::create_dir_all(&games_root).map_err(|error| error.to_string())?;
    let install_dir = games_root.join(safe_component(game.id)?);
    let staging = games_root.join(format!(".{}-installing", game.id));
    let backup = games_root.join(format!(".{}-previous", game.id));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    send(
        &channel,
        "extracting",
        86.0,
        "Preparando o jogo para o emulador…",
    );
    if extension == "zip" {
        extract_zip(&downloaded, &staging, &cancel)?;
    } else if extension == "7z" {
        check_cancelled(&cancel)?;
        sevenz_rust::decompress_file(&downloaded, &staging)
            .map_err(|error| format!("Não foi possível extrair o arquivo 7z: {error}"))?;
    } else {
        let destination = staging.join(local_file_name(game.file_name)?);
        fs::copy(&downloaded, destination).map_err(|error| error.to_string())?;
    }
    check_cancelled(&cancel)?;
    let primary = primary_game_file(&staging, game.system)?;
    let relative_primary = primary
        .strip_prefix(&staging)
        .map_err(|error| error.to_string())?
        .to_path_buf();
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|error| error.to_string())?;
    }
    if install_dir.exists() {
        fs::rename(&install_dir, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&staging, &install_dir) {
        if backup.exists() {
            let _ = fs::rename(&backup, &install_dir);
        }
        return Err(format!("Não foi possível concluir a instalação: {error}"));
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(&backup);
    }
    let _ = fs::remove_file(downloaded);
    send(&channel, "extracting", 100.0, "Jogo pronto para abrir.");
    Ok(install_dir.join(relative_primary))
}

pub fn install_game(
    library: &Path,
    game: GameDownload<'_>,
    channel: Channel<GameInstallEvent>,
    cancel: Arc<crate::DownloadCancellation>,
) -> Result<PathBuf, String> {
    let game_id = safe_component(game.id)?.to_string();
    let system = safe_component(game.system)?.to_string();
    let cache_dir = library.join("cache").join("games").join(&game_id);
    let staging = library
        .join("games")
        .join(system)
        .join(format!(".{game_id}-installing"));
    let result = install_game_inner(library, game, channel, Arc::clone(&cancel));
    if result.is_err() && cancel.should_discard() {
        let _ = fs::remove_dir_all(cache_dir);
        let _ = fs::remove_dir_all(staging);
    }
    result
}
