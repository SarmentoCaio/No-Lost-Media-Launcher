use reqwest::{
    blocking::{Client, Response},
    header::{CONTENT_LENGTH, LOCATION, RANGE},
    redirect, StatusCode, Url,
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

const DEFAULT_ARCHIVE_COOKIE: &str = "logged-in-user=nathatargino.dev%40gmail.com; logged-in-sig=1821453954%201789917954%20Nwul2op1i%2BJ1x5jZxsYspiC6jnnORKhvrwluHg5VJTnCqALRFgz7dFvdw1YYlzFGnUIvF4grDOubSiqaD5EMw9hAWmX0xgvpGDeR7e8j8pCZ%2BX%2Bx%2B562uCZZUZl%2BDIWyhQ%2FGrzdN6wCKHAoKQ3PRyZuPUsC7bfkqhE23kAqAtuZEGg%2B4QJ6%2FaQxHR2vC0n4TNFgLkKZPABmkUOiSSwnS7e4qDqnPOf8H4j6Rtp1ZSHBXMi%2FGotbGdhqaKH4odbBjwIpRe00CIAyIRyeIGuNCD7Yt3cFBx0A%2FbaV6UwEAER%2FGVCpWJ96XJIQAEOXh%2Be1cI9YEXZWw7JkmK5fP1ZjwPg%3D%3D;";

fn resolve_archive_response(
    client: &Client,
    initial_url: &Url,
    downloaded: u64,
    cookie: &str,
) -> Result<(Response, Url), String> {
    let mut current_url = initial_url.clone();
    let mut redirects = 0;
    const MAX_REDIRECTS: usize = 8;

    while redirects < MAX_REDIRECTS {
        let mut request = client.get(current_url.clone());
        if downloaded > 0 {
            request = request.header(RANGE, format!("bytes={downloaded}-"));
        }
        if current_url.host_str().map(|h| h.ends_with("archive.org")).unwrap_or(false) {
            request = request.header("Cookie", cookie);
        }

        let response = request
            .send()
            .map_err(|error| format!("Não foi possível acessar o acervo: {error}"))?;

        if response.status().is_redirection() {
            if let Some(location) = response.headers().get(LOCATION) {
                if let Ok(loc_str) = location.to_str() {
                    if let Ok(next_url) = current_url.join(loc_str) {
                        current_url = next_url;
                        redirects += 1;
                        continue;
                    }
                }
            }
        }

        return Ok((response, current_url));
    }

    Err("Limite de redirecionamentos do acervo excedido.".into())
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
    let extension = Path::new(game.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_archive = matches!(extension.as_str(), "7z" | "zip");

    if complete.is_file() {
        let size_matches = game
            .expected_size
            .map(|size| complete.metadata().is_ok_and(|item| item.len() == size))
            .unwrap_or(true);
        let hash_matches = game
            .sha1
            .map(|checksum| verify_sha1(&complete, checksum))
            .transpose()?
            .unwrap_or(true);
        if hash_matches && size_matches {
            return Ok(complete);
        }
        if is_archive && (hash_matches || complete.metadata().is_ok_and(|item| item.len() > 0)) {
            return Ok(complete);
        }
    }

    let mut downloaded = partial.metadata().map(|item| item.len()).unwrap_or(0);
    if game.expected_size.is_some_and(|size| downloaded == size) {
        let valid = game
            .sha1
            .map(|checksum| verify_sha1(&partial, checksum))
            .transpose()?
            .unwrap_or(true);
        if valid || is_archive {
            if complete.exists() {
                fs::remove_file(&complete).map_err(|error| error.to_string())?;
            }
            fs::rename(&partial, &complete).map_err(|error| error.to_string())?;
            return Ok(complete);
        }
    }
    ensure_disk_space(cache_dir, game.expected_size, downloaded)?;
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 No-Lost-Media-Launcher/0.1")
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(60 * 60 * 8))
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;

    let mut target_url = url.clone();
    // Converte qualquer URL de gateway (/api/stream/) diretamente para Archive.org
    if target_url.as_str().contains("/api/stream/") {
        let direct_str = target_url
            .as_str()
            .replace("https://api.nolost.media/api/stream", "https://archive.org/download")
            .replace("https://no-lost-media-bff.onrender.com/api/stream", "https://archive.org/download");
        if let Ok(direct_url) = Url::parse(&direct_str) {
            target_url = direct_url;
        }
    }

    let cookie = std::env::var("ARCHIVE_COOKIE").unwrap_or_else(|_| DEFAULT_ARCHIVE_COOKIE.to_string());
    let (mut response, final_url) = resolve_archive_response(&client, &target_url, downloaded, &cookie)?;
    target_url = final_url;

    // Se retornar 404 em coleção PS2 particionada (Parte 1 vs Parte 2), tenta a outra partição automaticamente
    if response.status() == StatusCode::NOT_FOUND {
        let url_str = target_url.as_str();
        let fallback_url_opt = if url_str.contains("RedumpSonyPS2NTSCU/") && !url_str.contains("RedumpSonyPS2NTSCUPart2") {
            Url::parse(&url_str.replace("RedumpSonyPS2NTSCU/", "RedumpSonyPS2NTSCUPart2/")).ok()
        } else if url_str.contains("RedumpSonyPS2NTSCUPart2/") {
            Url::parse(&url_str.replace("RedumpSonyPS2NTSCUPart2/", "RedumpSonyPS2NTSCU/")).ok()
        } else {
            None
        };

        if let Some(fallback_url) = fallback_url_opt {
            if let Ok((fb_resp, fb_url)) = resolve_archive_response(&client, &fallback_url, downloaded, &cookie) {
                if fb_resp.status().is_success() {
                    target_url = fb_url;
                    response = fb_resp;
                }
            }
        }
    }

    if downloaded > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        let _ = fs::remove_file(&partial);
        downloaded = 0;
        let (retry_resp, _) = resolve_archive_response(&client, &target_url, 0, &cookie)?;
        response = retry_resp;
    }

    if !response.status().is_success() {
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(format!(
                "O acervo do Archive.org recusou o download de {} (HTTP {}). Verifique sua conexão.",
                game.title, status
            ));
        }
        if status.as_u16() == 530
            || status == StatusCode::SERVICE_UNAVAILABLE
            || status == StatusCode::BAD_GATEWAY
        {
            return Err("O servidor do acervo está temporariamente indisponível (Erro 530/503). Tente novamente mais tarde.".into());
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
        let archive_matched = verify_sha1(&partial, checksum)?;
        if !archive_matched {
            if is_archive {
                eprintln!(
                    "Aviso: O checksum do catálogo ({checksum}) não corresponde ao contêiner compactado {}. A integridade dos arquivos será validada na extração.",
                    game.file_name
                );
            } else {
                fs::remove_file(&partial).map_err(|error| error.to_string())?;
                return Err("O arquivo baixado não corresponde ao registro do acervo.".into());
            }
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
    channel: &Channel<GameInstallEvent>,
    cancel: &crate::DownloadCancellation,
) -> Result<(), String> {
    let file = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("O arquivo ZIP não pôde ser aberto: {error}"))?;
    let total = archive.len();
    for index in 0..total {
        check_cancelled(cancel)?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "O arquivo compactado contém um caminho inseguro.".to_string())?;
        let output_path = destination.join(relative);
        let pct = 86.0 + ((index + 1) as f64 / total.max(1) as f64) * 13.0;
        let file_name = output_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("arquivo");
        send(
            channel,
            "extracting",
            pct,
            &format!("Extraindo: {file_name} ({}/{})…", index + 1, total),
        );
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let output = fs::File::create(&output_path).map_err(|error| error.to_string())?;
            let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, output);
            std::io::copy(&mut entry, &mut writer).map_err(|error| error.to_string())?;
            use std::io::Write;
            writer.flush().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn extract_7z(
    source: &Path,
    destination: &Path,
    channel: &Channel<GameInstallEvent>,
    cancel: &crate::DownloadCancellation,
) -> Result<(), String> {
    check_cancelled(cancel)?;
    send(channel, "extracting", 86.0, "Iniciando descompressão do pacote 7z…");

    let mut file_idx = 0usize;
    sevenz_rust::decompress_file_with_extract_fn(source, destination, |entry, reader, dest| {
        if cancel.is_requested() {
            return Ok(false);
        }
        file_idx += 1;
        let file_name = entry.name().to_string();
        let target_path = dest.join(&file_name);

        let pct = 86.0 + (file_idx as f64 % 14.0);
        send(
            channel,
            "extracting",
            pct,
            &format!("Extraindo: {file_name}…"),
        );

        if entry.is_directory() {
            fs::create_dir_all(&target_path).map_err(sevenz_rust::Error::io)?;
            return Ok(true);
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(sevenz_rust::Error::io)?;
        }

        let out_file = fs::File::create(&target_path).map_err(sevenz_rust::Error::io)?;
        let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, out_file);

        let total_size = entry.size();
        if total_size > 5 * 1024 * 1024 {
            let mut buffer = vec![0u8; 1024 * 1024];
            let mut copied = 0u64;
            let mut last_pct = 0u64;
            loop {
                if cancel.is_requested() {
                    return Ok(false);
                }
                let n = reader.read(&mut buffer).map_err(sevenz_rust::Error::io)?;
                if n == 0 {
                    break;
                }
                writer.write_all(&buffer[..n]).map_err(sevenz_rust::Error::io)?;
                copied += n as u64;
                let file_pct = (copied * 100 / total_size).min(100);
                if file_pct != last_pct && file_pct % 10 == 0 {
                    last_pct = file_pct;
                    let overall_pct = 86.0 + (copied as f64 / total_size as f64) * 13.0;
                    send(
                        channel,
                        "extracting",
                        overall_pct,
                        &format!(
                            "Extraindo {file_name}: {file_pct}% ({} MB de {} MB)…",
                            copied / (1024 * 1024),
                            total_size / (1024 * 1024)
                        ),
                    );
                }
            }
        } else {
            std::io::copy(reader, &mut writer).map_err(sevenz_rust::Error::io)?;
        }
        writer.flush().map_err(sevenz_rust::Error::io)?;

        Ok(true)
    })
    .map_err(|error| format!("Não foi possível extrair o arquivo 7z: {error}"))?;

    check_cancelled(cancel)?;
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
        "pc" => &["exe", "bat", "cmd", "msi", "iso", "cue", "bin"],
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
        extract_zip(&downloaded, &staging, &channel, &cancel)?;
    } else if extension == "7z" {
        extract_7z(&downloaded, &staging, &channel, &cancel)?;
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
