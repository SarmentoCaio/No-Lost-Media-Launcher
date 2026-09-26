import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

export const APP_VERSION = "0.1.3";
export const GITHUB_REPO = "SarmentoCaio/No-Lost-Media-Launcher";
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
export const GITHUB_API_LATEST_RELEASE = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const UPDATE_DISMISSED_SESSION_KEY = "nlm_update_dismissed_version";

export interface ReleaseAsset {
  name: string;
  size: number;
  browserDownloadUrl: string;
}

export interface AppRelease {
  version: string;
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
  setupAsset?: ReleaseAsset;
  isNewer: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  release?: AppRelease;
  error?: string;
}

export interface UpdateProgress {
  /** Bytes já baixados */
  downloaded: number;
  /** Total de bytes (pode ser undefined se Content-Length não estiver disponível) */
  total?: number;
  /** Percentual de 0 a 100 (undefined se total não conhecido) */
  percent?: number;
}

/**
 * Normaliza e compara duas versões semânticas (ex: "v0.1.2" vs "0.1.1").
 * Retorna:
 *  > 0 se v1 > v2
 *  < 0 se v1 < v2
 *  0 se v1 == v2
 */
export function compareSemver(v1: string, v2: string): number {
  const clean = (v: string) => v.trim().replace(/^v/i, "").split("-")[0];
  const parts1 = clean(v1).split(".").map((n) => parseInt(n, 10) || 0);
  const parts2 = clean(v2).split(".").map((n) => parseInt(n, 10) || 0);

  const length = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < length; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Consulta a última release publicada no repositório GitHub.
 * Usa a GitHub API diretamente (sem o plugin do Tauri) para obter os metadados
 * de exibição (notas de release, tamanho, data) que serão mostrados no modal.
 */
export async function checkForUpdates(currentVersion: string = APP_VERSION): Promise<UpdateCheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);

    const response = await fetch(GITHUB_API_LATEST_RELEASE, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return { hasUpdate: false, currentVersion };
      }
      return {
        hasUpdate: false,
        currentVersion,
        error: `Servidor GitHub respondeu com status ${response.status}`,
      };
    }

    const data = await response.json();
    const tagName = (data.tag_name as string) || "";
    const versionString = tagName.replace(/^v/i, "");

    const isNewer = compareSemver(versionString, currentVersion) > 0;

    const assets: ReleaseAsset[] = Array.isArray(data.assets)
      ? data.assets.map((asset: { name?: string; size?: number; browser_download_url?: string }) => ({
          name: asset.name ?? "",
          size: asset.size ?? 0,
          browserDownloadUrl: asset.browser_download_url ?? "",
        }))
      : [];

    const setupAsset =
      assets.find((a) => a.name.toLowerCase().endsWith(".exe") || a.name.toLowerCase().endsWith(".msi")) ||
      assets[0];

    const release: AppRelease = {
      version: versionString,
      tagName,
      name: (data.name as string) || `Versão ${tagName}`,
      body: (data.body as string) || "Nenhuma nota de atualização fornecida.",
      publishedAt: (data.published_at as string) || "",
      htmlUrl: (data.html_url as string) || GITHUB_RELEASES_URL,
      assets,
      setupAsset,
      isNewer,
    };

    return {
      hasUpdate: isNewer,
      currentVersion,
      release,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na conexão";
    return {
      hasUpdate: false,
      currentVersion,
      error: message,
    };
  }
}

/**
 * Realiza a atualização silenciosa usando o tauri-plugin-updater:
 *  1. Verifica se há atualização disponível via endpoint do Tauri
 *  2. Baixa o instalador em background reportando progresso
 *  3. Instala silenciosamente e reinicia o app
 *
 * @param onProgress Callback chamado a cada chunk baixado
 * @throws Se não houver atualização disponível ou ocorrer um erro de rede/disco
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  const update = await check();

  if (!update?.available) {
    throw new Error("Nenhuma atualização disponível para instalação.");
  }

  let downloaded = 0;
  let total: number | undefined;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? undefined;
        downloaded = 0;
        onProgress?.({ downloaded: 0, total, percent: 0 });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({
          downloaded,
          total,
          percent: total ? Math.round((downloaded / total) * 100) : undefined,
        });
        break;
      case "Finished":
        onProgress?.({ downloaded, total, percent: 100 });
        break;
    }
  });

  // Reinicia o app para aplicar a atualização instalada
  await relaunch();
}

/**
 * Abre uma URL externamente no navegador padrão do usuário ou via Tauri
 */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    // Tenta invocar o comando Tauri nativo para abrir no Windows
    await invoke("open_external_url", { url });
  } catch {
    // Fallback para navegador web comum
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
