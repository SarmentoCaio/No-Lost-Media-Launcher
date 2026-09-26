import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUpDown,
  Car,
  Check,
  ChevronRight,
  Compass,
  Cpu,
  Download,
  ExternalLink,
  Flame,
  Gamepad2,
  Gauge,
  Ghost,
  Globe,
  HardDrive,
  Heart,
  Home,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Library,
  List,
  Menu,
  MonitorCog,
  Music,
  Play,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Trophy,
  Volume2,
  X,
} from "lucide-react";
import {
  getSystem,
  searchGames,
  type DownloadTask,
  type EmulatorInstallProgress,
  type EmulatorSettings,
  type Game,
  type InstalledGame,
  type GraphicsSettings,
  type LauncherSettings,
  type QualityPreset,
  type RuntimeInfo,
  type SystemId,
} from "@nlm/core";
import { createRuntime } from "./runtime";
import { loadCatalog } from "./services/catalogService";
import { EmulatorSettingsDialog } from "./components/EmulatorSettingsDialog";
import { ConsoleTabs } from "./components/ConsoleTabs";
import { CustomDropdown } from "./components/CustomDropdown";
import { UpdateModal } from "./components/UpdateModal";
import {
  checkForUpdates,
  openExternalUrl,
  APP_VERSION,
  GITHUB_REPO,
  UPDATE_DISMISSED_SESSION_KEY,
  type AppRelease,
} from "./services/updateService";

type ViewId = "home" | "library" | "downloads" | "emulators" | "settings";
type Toast = { id: number; message: string; tone: "info" | "success" | "error" };
type EmulatorTask = EmulatorInstallProgress & { emulatorId: string };
type CatalogSort = "title-asc" | "title-desc" | "size-desc" | "size-asc" | "year-desc" | "year-asc";
type DesktopDeepLinkPayload = { url: string };

const FAVORITES_STORAGE_KEY = "nolostmedia_favorites_v1";
const GAME_DOWNLOADS_STORAGE_KEY = "nlm-launcher-game-downloads-v2";
const EMULATOR_DOWNLOADS_STORAGE_KEY = "nlm-launcher-emulator-downloads-v2";
const MAX_CONCURRENT_DOWNLOADS = 2;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const catalogLetters = ["ALL", "#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const catalogGenres = [
  "ALL",
  "Ação & Aventura",
  "RPG",
  "Terror / Horror",
  "Corrida",
  "Luta",
  "Tiro / Shooter",
  "Esportes",
  "Plataforma / Aventura",
  "Música & Ritmo",
  "Estratégia & Simulação",
  "Puzzle / Tabuleiro",
] as const;

interface GenreMeta {
  shortLabel: string;
  icon: typeof Gamepad2;
}

const GENRE_META: Record<string, GenreMeta> = {
  "ALL": { shortLabel: "Todos", icon: Compass },
  "Ação & Aventura": { shortLabel: "Ação", icon: Swords },
  "RPG": { shortLabel: "RPG", icon: Shield },
  "Terror / Horror": { shortLabel: "Terror", icon: Ghost },
  "Corrida": { shortLabel: "Corrida", icon: Car },
  "Luta": { shortLabel: "Luta", icon: Flame },
  "Tiro / Shooter": { shortLabel: "Tiro", icon: Target },
  "Esportes": { shortLabel: "Esportes", icon: Trophy },
  "Plataforma / Aventura": { shortLabel: "Plataforma", icon: Gamepad2 },
  "Música & Ritmo": { shortLabel: "Música", icon: Music },
  "Estratégia & Simulação": { shortLabel: "Estratégia", icon: Cpu },
  "Puzzle / Tabuleiro": { shortLabel: "Puzzle", icon: Puzzle },
};

function getSystemDiscType(systemId: string): string | null {
  switch (systemId) {
    case "ps1": return "CD-ROM";
    case "ps2": return "DVD-ROM";
    case "ps3": return "BLU-RAY DISC";
    case "dreamcast": return "GD-ROM";
    case "gamecube": return "MINI-DVD";
    case "wii": return "DVD-ROM";
    case "pc": return "WIN/DOS";
    case "n64": return "64-BIT";
    case "snes": return "16-BIT";
    case "gba": return "32-BIT";
    case "nes": return "8-BIT";
    default: return null;
  }
}

const catalogSortOptions: { value: CatalogSort; label: string }[] = [
  { value: "title-asc", label: "Ordem Alfabética (A → Z)" },
  { value: "title-desc", label: "Ordem Alfabética (Z → A)" },
  { value: "year-desc", label: "Ano (Mais recente)" },
  { value: "year-asc", label: "Ano (Mais clássico)" },
  { value: "size-desc", label: "Tamanho (Maior)" },
  { value: "size-asc", label: "Tamanho (Menor)" },
];

function gameIdFromDeepLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "nolostmedia:" || url.hostname !== "game") return null;
    const gameId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return gameId || null;
  } catch {
    return null;
  }
}

function initialLetter(game: Game): string {
  const letter = game.title.trim().charAt(0).toLocaleUpperCase("pt-BR");
  return /^[A-Z]$/.test(letter) ? letter : "#";
}

function matchesGenre(gameGenre: string | undefined, selectedGenre: string): boolean {
  if (selectedGenre === "ALL") return true;
  const genre = gameGenre ?? "";
  if (genre === selectedGenre) return true;
  if (selectedGenre === "Terror / Horror") return genre === "Survival Horror" || genre.includes("Terror") || genre.includes("Horror");
  if (selectedGenre === "Ação & Aventura") return genre === "Ação" || genre === "Ação / Aventura" || genre === "Stealth / Ação";
  if (selectedGenre === "Plataforma / Aventura") return genre === "Plataforma" || genre.includes("Plataforma");
  if (selectedGenre === "Puzzle / Tabuleiro") return genre === "Puzzle / Estratégia" || genre.includes("Puzzle") || genre.includes("Tabuleiro");
  if (selectedGenre === "Estratégia & Simulação") return genre.includes("Estratégia") || genre.includes("Simulação");
  if (selectedGenre === "Música & Ritmo") return genre.includes("Música") || genre.includes("Ritmo");
  return false;
}

function restoreGameDownloads(): Record<string, DownloadTask> {
  try {
    const parsed = JSON.parse(localStorage.getItem(GAME_DOWNLOADS_STORAGE_KEY) ?? "{}") as Record<string, DownloadTask>;
    return Object.fromEntries(Object.entries(parsed).map(([id, task]) => [id, {
      ...task,
      state: task.state === "queued" || task.state === "error" || task.state === "paused" ? task.state : "paused",
      message: task.state === "queued" ? "Na fila…" : task.state === "error" ? task.message : "Pausado ao fechar o launcher. Clique em Continuar.",
      speedBytesPerSecond: undefined,
      etaSeconds: undefined,
    }]));
  } catch {
    return {};
  }
}

function restoreEmulatorDownloads(): Record<string, EmulatorTask> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMULATOR_DOWNLOADS_STORAGE_KEY) ?? "{}") as Record<string, EmulatorTask>;
    return Object.fromEntries(Object.entries(parsed).map(([id, task]) => [id, {
      ...task,
      state: task.state === "queued" || task.state === "error" || task.state === "paused" ? task.state : "paused",
      message: task.state === "queued" ? "Na fila…" : task.state === "error" ? task.message : "Pausado ao fechar o launcher. Clique em Continuar.",
      speedBytesPerSecond: undefined,
      etaSeconds: undefined,
    }]));
  } catch {
    return {};
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

function formatEta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s restantes`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}min restantes`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${Math.ceil((seconds % 3600) / 60)}min restantes`;
}

function isRetryableDownloadError(message: string): boolean {
  const permanentErrors = ["Espaço insuficiente", "não pertence ao acervo", "nome de arquivo", "formato", "RAR", "BIOS", "DOWNLOAD_CANCELLED"];
  return !permanentErrors.some((value) => message.includes(value));
}

function isDownloadActive(state: string | undefined): boolean {
  return Boolean(state && ["queued", "retrying", "downloading", "extracting", "configuring"].includes(state));
}

function transferSummary(task: { downloadedBytes?: number; totalBytes?: number; speedBytesPerSecond?: number; etaSeconds?: number }): string {
  const parts: string[] = [];
  if (task.downloadedBytes) parts.push(task.totalBytes ? `${formatBytes(task.downloadedBytes)} de ${formatBytes(task.totalBytes)}` : formatBytes(task.downloadedBytes));
  if (task.speedBytesPerSecond) parts.push(`${formatBytes(task.speedBytesPerSecond)}/s`);
  if (task.etaSeconds !== undefined) parts.push(formatEta(task.etaSeconds));
  return parts.filter(Boolean).join(" • ");
}

const runtime = createRuntime();

const navigation: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Início", icon: Home },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "emulators", label: "Emuladores", icon: Gamepad2 },
  { id: "settings", label: "Configurações", icon: Settings },
];

const qualityLabels: Record<Exclude<QualityPreset, "custom">, string> = {
  auto: "Automático",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  ultra: "Ultra",
};

const presetGraphics: Record<Exclude<QualityPreset, "auto" | "custom">, GraphicsSettings> = {
  low: { internalResolution: 1, antiAliasing: "off", textureFiltering: "nearest", anisotropicFiltering: 1, vsync: false, frameLimit: 60 },
  medium: { internalResolution: 2, antiAliasing: "fxaa", textureFiltering: "bilinear", anisotropicFiltering: 4, vsync: true, frameLimit: 60 },
  high: { internalResolution: 3, antiAliasing: "fxaa", textureFiltering: "bilinear", anisotropicFiltering: 8, vsync: true, frameLimit: 60 },
  ultra: { internalResolution: 6, antiAliasing: "msaa4", textureFiltering: "trilinear", anisotropicFiltering: 16, vsync: true, frameLimit: 60 },
};

function formatPlayTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function readableError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error ? error.message : fallback;
}

function GameArtwork({
  game,
  compact = false,
  onCoverError,
  coverAvailable = true,
  showBadges = false,
}: {
  game: Game;
  compact?: boolean;
  onCoverError?: () => void;
  coverAvailable?: boolean;
  showBadges?: boolean;
}) {
  const system = getSystem(game.system);
  const initials = game.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
  const discType = getSystemDiscType(game.system);

  return (
    <div className={`game-artwork ${compact ? "game-artwork--compact" : ""}`} style={{ "--game-accent": system.accent } as React.CSSProperties}>
      {game.coverUrl && coverAvailable ? (
        <img src={game.coverUrl} alt="" loading="lazy" onError={onCoverError} />
      ) : (
        <>
          <span className="game-artwork__system">{system.shortName}</span>
          <strong>{initials}</strong>
          <i aria-hidden="true" />
        </>
      )}

      {showBadges && (
        <div className="game-artwork__badges-overlay">
          <div className="game-artwork__badges-left">
            <span className="cover-badge cover-badge--system">{system.shortName}</span>
            {discType && <span className="cover-badge cover-badge--disc">{discType}</span>}
          </div>
          {game.year && <span className="cover-badge cover-badge--year">{game.year}</span>}
        </div>
      )}
    </div>
  );
}

function GameCard({
  game,
  installed,
  task,
  nativeMode,
  onSelect,
  onPrimary,
  onCancel,
  stopping,
  favorite,
  onToggleFavorite,
  onCoverError,
  coverAvailable,
}: {
  game: Game;
  installed?: InstalledGame;
  task?: DownloadTask;
  nativeMode: boolean;
  onSelect: () => void;
  onPrimary: () => void;
  onCancel: () => void;
  stopping: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onCoverError: () => void;
  coverAvailable: boolean;
}) {
  const system = getSystem(game.system);
  const busy = isDownloadActive(task?.state);
  const sizeText = game.fileSizeLabel || (game.fileSizeBytes ? formatBytes(game.fileSizeBytes) : null);
  const secondaryTitle = game.fileName || (game.region ? `Região: ${game.region}` : null);

  return (
    <article
      className="game-card"
      style={{ "--card-accent": system.accent } as React.CSSProperties}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <div className="game-card__media">
        <GameArtwork
          game={game}
          onCoverError={onCoverError}
          coverAvailable={coverAvailable}
          showBadges
        />
        <button
          className={`favorite-button ${favorite ? "is-active" : ""}`}
          type="button"
          aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Heart size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="game-card__body">
        <h3 title={game.title}>{game.title}</h3>
        {secondaryTitle ? (
          <p className="game-card__sub" title={secondaryTitle}>{secondaryTitle}</p>
        ) : (
          <p className="game-card__sub">{[game.year, game.genre].filter(Boolean).join(" • ")}</p>
        )}

        <div className="game-card__chips">
          {sizeText && (
            <span className="game-card__chip-size">
              <HardDrive size={11} /> {sizeText}
            </span>
          )}
          {game.genre && (
            <span className="game-card__chip-genre" title={game.genre}>
              {game.genre}
            </span>
          )}
        </div>

        {task && task.state !== "error" && (
          <div className="card-progress" aria-label={task.message}>
            <span style={{ width: `${task.progress}%` }} />
          </div>
        )}

        <button
          className={installed ? "card-action card-action--play" : busy ? "card-action card-action--stop" : "card-action"}
          type="button"
          disabled={stopping}
          onClick={(event) => {
            event.stopPropagation();
            if (busy) onCancel();
            else onPrimary();
          }}
        >
          {installed ? <Play size={14} fill="currentColor" /> : busy ? <X size={14} /> : <Download size={14} />}
          <span>
            {installed
              ? "Jogar"
              : busy
              ? stopping
                ? "Parando…"
                : `Baixando (${Math.floor(task?.progress ?? 0)}%)`
              : task?.state === "paused"
              ? "Continuar"
              : game.sourceUrl
              ? "Baixar"
              : nativeMode
              ? "Adicionar"
              : "Instalar"}
          </span>
        </button>
      </div>
    </article>
  );
}

function GameListRow({
  game,
  installed,
  task,
  nativeMode,
  onSelect,
  onPrimary,
  onCancel,
  stopping,
  favorite,
  onToggleFavorite,
  onCoverError,
  coverAvailable,
}: {
  game: Game;
  installed?: InstalledGame;
  task?: DownloadTask;
  nativeMode: boolean;
  onSelect: () => void;
  onPrimary: () => void;
  onCancel: () => void;
  stopping: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onCoverError: () => void;
  coverAvailable: boolean;
}) {
  const system = getSystem(game.system);
  const busy = isDownloadActive(task?.state);
  const sizeText = game.fileSizeLabel || (game.fileSizeBytes ? formatBytes(game.fileSizeBytes) : "—");

  return (
    <div
      className="game-list-row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <div className="col-fav" onClick={(event) => event.stopPropagation()}>
        <button
          className={`favorite-button favorite-button--inline ${favorite ? "is-active" : ""}`}
          type="button"
          aria-label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          onClick={onToggleFavorite}
        >
          <Heart size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="col-cover">
        <div className="game-artwork game-artwork--mini" style={{ "--game-accent": system.accent } as React.CSSProperties}>
          {game.coverUrl && coverAvailable ? (
            <img src={game.coverUrl} alt="" loading="lazy" onError={onCoverError} />
          ) : (
            <span className="game-artwork__mini-initials">
              {game.title.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
      </div>

      <div className="col-title">
        <strong title={game.title}>{game.title}</strong>
        {task && task.state !== "error" && (
          <div className="list-progress" aria-label={task.message}>
            <span style={{ width: `${task.progress}%` }} />
          </div>
        )}
      </div>

      <div className="col-system">
        <span className="system-chip" style={{ "--chip-accent": system.accent } as React.CSSProperties}>
          {system.shortName}
        </span>
      </div>

      <div className="col-genre" title={game.genre ?? ""}>
        <span>{game.genre ?? "—"}</span>
      </div>

      <div className="col-year">
        <span>{game.year ?? "—"}</span>
      </div>

      <div className="col-size">
        <span>{sizeText}</span>
      </div>

      <div className="col-action" onClick={(event) => event.stopPropagation()}>
        <button
          className={installed ? "list-action list-action--play" : busy ? "list-action list-action--stop" : "list-action"}
          type="button"
          disabled={stopping}
          onClick={() => {
            if (busy) onCancel();
            else onPrimary();
          }}
        >
          {installed ? <Play size={13} fill="currentColor" /> : busy ? <X size={13} /> : <Download size={13} />}
          <span>
            {installed ? "Jogar" : busy ? (stopping ? "Parando…" : "Parar") : task?.state === "paused" ? "Continuar" : game.sourceUrl ? "Baixar" : nativeMode ? "Adicionar" : "Instalar"}
          </span>
        </button>
      </div>
    </div>
  );
}

function EmptyState({ view }: { view: ViewId }) {
  return (
    <div className="empty-state">
      <Library size={38} />
      <h3>{view === "library" ? "Sua biblioteca está vazia" : "Nenhum jogo encontrado"}</h3>
      <p>{view === "library" ? "Instale um jogo pelo catálogo para encontrá-lo aqui." : "Tente outro termo ou selecione todos os sistemas."}</p>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<ViewId>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [installed, setInstalled] = useState<InstalledGame[]>([]);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [system, setSystem] = useState<SystemId>("all");
  const [query, setQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedLetter, setSelectedLetter] = useState("ALL");
  const [selectedGenre, setSelectedGenre] = useState("ALL");
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("title-asc");
  const [onlyWithCovers, setOnlyWithCovers] = useState(true);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [brokenCoverIds, setBrokenCoverIds] = useState<Set<string>>(new Set());
  const [catalogPage, setCatalogPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(48);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [gameToRemove, setGameToRemove] = useState<Game | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<string, DownloadTask>>(restoreGameDownloads);
  const [emulatorTasks, setEmulatorTasks] = useState<Record<string, EmulatorTask>>(restoreEmulatorDownloads);
  const [stoppingDownloads, setStoppingDownloads] = useState<Set<string>>(new Set());
  const cancelledDownloads = useRef(new Set<string>());
  const discardedDownloads = useRef(new Set<string>());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeDownloadKeys = useRef(new Set<string>());
  const pendingDeepLinkRequested = useRef(false);
  const [loading, setLoading] = useState(true);
  const [catalogSource, setCatalogSource] = useState<"remote" | "bundled" | "demo">("bundled");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<LauncherSettings | null>(null);
  const [advancedGraphics, setAdvancedGraphics] = useState(false);
  const [connectedControllers, setConnectedControllers] = useState(0);
  const [editingEmulator, setEditingEmulator] = useState<EmulatorSettings | null>(null);
  const [desktopGameId, setDesktopGameId] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AppRelease | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"grid" | "list">(() => {
    try {
      const saved = localStorage.getItem("nlm_display_mode");
      return saved === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });

  const handleSetDisplayMode = (mode: "grid" | "list") => {
    setDisplayMode(mode);
    try {
      localStorage.setItem("nlm_display_mode", mode);
    } catch {}
  };

  useEffect(() => {
    let mounted = true;
    const checkInitialUpdate = async () => {
      const result = await checkForUpdates(APP_VERSION);
      if (!mounted) return;
      if (result.hasUpdate && result.release) {
        setAvailableUpdate(result.release);
        const dismissed = sessionStorage.getItem(UPDATE_DISMISSED_SESSION_KEY);
        if (dismissed !== result.release.tagName) {
          setShowUpdateModal(true);
        }
      }
    };
    const timer = window.setTimeout(checkInitialUpdate, 1500);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleManualCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatusMessage("Consultando GitHub...");
    const result = await checkForUpdates(APP_VERSION);
    setIsCheckingUpdate(false);

    if (result.error) {
      setUpdateStatusMessage(`Não foi possível verificar: ${result.error}`);
      notify("Não foi possível verificar atualizações no momento.", "error");
      return;
    }

    if (result.hasUpdate && result.release) {
      setAvailableUpdate(result.release);
      setShowUpdateModal(true);
      setUpdateStatusMessage(`Nova versão disponível: ${result.release.tagName}`);
      notify(`Nova versão ${result.release.tagName} disponível!`, "success");
    } else {
      setUpdateStatusMessage("Você já está na versão mais recente.");
      notify(`Você já está na versão mais recente (v${APP_VERSION}).`, "success");
    }
  };

  const handleRemindLater = () => {
    if (availableUpdate) {
      sessionStorage.setItem(UPDATE_DISMISSED_SESSION_KEY, availableUpdate.tagName);
    }
    setShowUpdateModal(false);
  };

  const handleUpdateNow = async () => {
    if (!availableUpdate) return;
    setIsInstallingUpdate(true);
    notify("Iniciando download da atualização...", "info");
    const targetUrl = availableUpdate.setupAsset?.browserDownloadUrl || availableUpdate.htmlUrl;
    try {
      await openExternalUrl(targetUrl);
    } catch {
      window.open(targetUrl, "_blank");
    }
    setIsInstallingUpdate(false);
    setShowUpdateModal(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem(GAME_DOWNLOADS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(EMULATOR_DOWNLOADS_STORAGE_KEY, JSON.stringify(emulatorTasks));
  }, [emulatorTasks]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey && event.key.toLowerCase() === "k") || (event.key === "/" && document.activeElement !== searchInputRef.current)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "Escape" && document.activeElement === searchInputRef.current) {
        setQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    const receive = (value: string | null) => {
      const gameId = value ? gameIdFromDeepLink(value) : null;
      if (!disposed && gameId) setDesktopGameId(gameId);
    };
    void listen<DesktopDeepLinkPayload>("desktop-deep-link", (event) => receive(event.payload.url))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stopListening = unlisten;
      });
    return () => {
      disposed = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ || pendingDeepLinkRequested.current) return;
    pendingDeepLinkRequested.current = true;
    void invoke<string | null>("take_pending_deep_link")
      .then((value) => {
        const gameId = value ? gameIdFromDeepLink(value) : null;
        if (gameId) setDesktopGameId(gameId);
      })
      .catch(() => undefined);
  }, []);

  const notify = (message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([loadCatalog(), runtime.getInfo(), runtime.listInstalledGames()]).then(([catalog, info, library]) => {
      if (!active) return;
      setGames(catalog.games);
      setCatalogSource(catalog.source);
      setRuntimeInfo(info);
      setSettingsDraft(info.settings);
      setInstalled(library);
      setLoading(false);
      if (catalog.message) notify(catalog.message, "error");
    }).catch((error: unknown) => {
      if (!active) return;
      setLoading(false);
      notify(readableError(error, "Não foi possível iniciar o launcher."), "error");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refreshControllers = () => {
      const pads = navigator.getGamepads?.() ?? [];
      setConnectedControllers(Array.from(pads).filter(Boolean).length);
    };
    refreshControllers();
    window.addEventListener("gamepadconnected", refreshControllers);
    window.addEventListener("gamepaddisconnected", refreshControllers);
    return () => {
      window.removeEventListener("gamepadconnected", refreshControllers);
      window.removeEventListener("gamepaddisconnected", refreshControllers);
    };
  }, []);

  const installedById = useMemo(() => new Map(installed.map((item) => [item.gameId, item])), [installed]);
  const visibleInstalled = useMemo(() => {
    const catalogIds = new Set(games.map((game) => game.id));
    return installed.filter((entry) => catalogIds.has(entry.gameId));
  }, [games, installed]);
  const letterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let base = system === "all" ? games : games.filter((game) => game.system === system);
    if (onlyWithCovers) base = base.filter((game) => Boolean(game.coverUrl) && !brokenCoverIds.has(game.id));
    for (const game of base) {
      const letter = initialLetter(game);
      counts[letter] = (counts[letter] ?? 0) + 1;
    }
    return counts;
  }, [brokenCoverIds, games, onlyWithCovers, system]);
  const systemCounts = useMemo(() => {
    const counts = new Map<SystemId, number>([["all", games.length]]);
    for (const game of games) counts.set(game.system, (counts.get(game.system) ?? 0) + 1);
    return counts;
  }, [games]);
  const letterTotal = useMemo(() => Object.values(letterCounts).reduce((total, count) => total + count, 0), [letterCounts]);
  const filteredGames = useMemo(() => {
    const searching = Boolean(debouncedSearch.trim());
    let result = searchGames(games, debouncedSearch, system);
    if (view === "library") result = result.filter((game) => installedById.has(game.id));
    if (onlyFavorites) result = result.filter((game) => favorites.has(game.id));
    if (onlyWithCovers && !searching) result = result.filter((game) => Boolean(game.coverUrl) && !brokenCoverIds.has(game.id));
    if (selectedLetter !== "ALL") result = result.filter((game) => initialLetter(game) === selectedLetter);
    if (selectedGenre !== "ALL") result = result.filter((game) => matchesGenre(game.genre, selectedGenre));
    const sorted = [...result];
    switch (catalogSort) {
      case "title-desc": sorted.sort((left, right) => right.title.localeCompare(left.title, "pt-BR")); break;
      case "size-desc": sorted.sort((left, right) => (right.fileSizeBytes ?? 0) - (left.fileSizeBytes ?? 0)); break;
      case "size-asc": sorted.sort((left, right) => (left.fileSizeBytes ?? 0) - (right.fileSizeBytes ?? 0)); break;
      case "year-desc": sorted.sort((left, right) => (right.year ?? 0) - (left.year ?? 0)); break;
      case "year-asc": sorted.sort((left, right) => (left.year ?? 0) - (right.year ?? 0)); break;
      default: sorted.sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));
    }
    return sorted;
  }, [brokenCoverIds, catalogSort, debouncedSearch, favorites, games, installedById, onlyFavorites, onlyWithCovers, selectedGenre, selectedLetter, system, view]);
  const totalCatalogPages = Math.max(1, Math.ceil(filteredGames.length / itemsPerPage));
  const paginatedGames = useMemo(() => filteredGames.slice((catalogPage - 1) * itemsPerPage, catalogPage * itemsPerPage), [catalogPage, filteredGames, itemsPerPage]);

  useEffect(() => {
    setCatalogPage(1);
  }, [catalogSort, debouncedSearch, itemsPerPage, onlyFavorites, onlyWithCovers, selectedGenre, selectedLetter, system, view]);

  useEffect(() => {
    setCatalogPage((page) => Math.min(page, totalCatalogPages));
  }, [totalCatalogPages]);
  const activeTasks = Object.values(tasks).filter((task) => isDownloadActive(task.state));
  const activeEmulatorTasks = Object.values(emulatorTasks).filter((task) => isDownloadActive(task.state));
  const continueGame = useMemo(() => {
    const sorted = visibleInstalled
      .slice()
      .sort((left, right) => (right.lastPlayedAt ?? "").localeCompare(left.lastPlayedAt ?? ""));

    if (system !== "all") {
      const matching = sorted
        .map((entry) => games.find((game) => game.id === entry.gameId))
        .find((game) => game && game.system === system);
      if (matching) return matching;
    }

    return sorted
      .map((entry) => games.find((game) => game.id === entry.gameId))
      .find(Boolean);
  }, [games, system, visibleInstalled]);

  const navigate = (nextView: ViewId) => {
    setView(nextView);
    setSidebarOpen(false);
    if (nextView === "downloads" || nextView === "emulators" || nextView === "settings") setSystem("all");
  };

  const installGame = (game: Game) => {
    if ((tasks[game.id] && !["error", "paused"].includes(tasks[game.id].state)) || installedById.has(game.id)) return;
    setTasks((current) => ({
      ...current,
      [game.id]: {
        id: `install-${game.id}`,
        gameId: game.id,
        state: "queued",
        progress: current[game.id]?.progress ?? 0,
        message: current[game.id]?.progress ? "Na fila para continuar…" : "Na fila…",
        downloadedBytes: current[game.id]?.downloadedBytes,
        totalBytes: game.fileSizeBytes ?? current[game.id]?.totalBytes,
        attempts: 0,
        queuedAt: Date.now(),
      },
    }));
  };

  const runGameInstall = async (game: Game, queuedTask: DownloadTask) => {
    const key = `game:${game.id}`;
    const taskId = queuedTask.id;
    const attempt = (queuedTask.attempts ?? 0) + 1;
    activeDownloadKeys.current.add(key);
    setTasks((current) => current[game.id] ? {
      ...current,
      [game.id]: { ...current[game.id], state: "downloading", message: attempt > 1 ? `Reconectando… tentativa ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}` : "Conectando ao acervo…", attempts: attempt },
    } : current);
    try {
      const result = await runtime.installGame(game, (progress) => {
        if (cancelledDownloads.current.has(key)) return;
        setTasks((current) => ({
          ...current,
          [game.id]: { ...current[game.id], id: taskId, gameId: game.id, ...progress, attempts: attempt },
        }));
      });
      setInstalled((current) => [...current.filter((item) => item.gameId !== game.id), result]);
      setTasks((current) => {
        const next = { ...current };
        delete next[game.id];
        return next;
      });
      notify(`${game.title} foi adicionado à biblioteca.`, "success");
    } catch (error) {
      const message = readableError(error, "Falha durante a instalação.");
      if (message.includes("DOWNLOAD_CANCELLED") || cancelledDownloads.current.has(key)) {
        if (discardedDownloads.current.has(key)) {
          setTasks((current) => {
            const next = { ...current };
            delete next[game.id];
            return next;
          });
          notify(`Download de ${game.title} cancelado e arquivos temporários removidos.`);
        } else {
          setTasks((current) => current[game.id] ? {
            ...current,
            [game.id]: { ...current[game.id], state: "paused", message: "Download pausado. O progresso está salvo.", speedBytesPerSecond: undefined, etaSeconds: undefined },
          } : current);
          notify(`Download de ${game.title} pausado. Você pode continuar depois.`);
        }
        return;
      }
      if (attempt < MAX_DOWNLOAD_ATTEMPTS && isRetryableDownloadError(message)) {
        const delay = attempt * 2;
        setTasks((current) => current[game.id] ? {
          ...current,
          [game.id]: { ...current[game.id], state: "retrying", message: `Conexão interrompida. Nova tentativa em ${delay}s…`, speedBytesPerSecond: undefined, etaSeconds: undefined, attempts: attempt },
        } : current);
        window.setTimeout(() => setTasks((current) => current[game.id]?.state === "retrying" ? {
          ...current,
          [game.id]: { ...current[game.id], state: "queued", message: `Tentativa ${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS} na fila…` },
        } : current), delay * 1000);
        return;
      }
      setTasks((current) => ({
        ...current,
        [game.id]: { ...current[game.id], id: taskId, gameId: game.id, state: "error", message, speedBytesPerSecond: undefined, etaSeconds: undefined, attempts: attempt },
      }));
      notify(message, "error");
    } finally {
      activeDownloadKeys.current.delete(key);
      cancelledDownloads.current.delete(key);
      discardedDownloads.current.delete(key);
      setStoppingDownloads((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const stopGameDownload = async (game: Game, discard = false) => {
    if (discard && !window.confirm(`Cancelar o download de ${game.title} e apagar todo o progresso baixado?`)) return;
    const key = `game:${game.id}`;
    const currentTask = tasks[game.id];
    if (currentTask && ["queued", "retrying", "paused", "error"].includes(currentTask.state)) {
      if (discard) {
        try {
          await runtime.cancelDownload("game", game.id, true);
        } catch {
          // A limpeza local pode não existir no modo de prévia.
        }
        setTasks((current) => {
          const next = { ...current };
          delete next[game.id];
          return next;
        });
      } else {
        setTasks((current) => ({ ...current, [game.id]: { ...current[game.id], state: "paused", message: "Download pausado. O progresso está salvo." } }));
      }
      return;
    }
    cancelledDownloads.current.add(key);
    if (discard) discardedDownloads.current.add(key);
    setStoppingDownloads((current) => new Set(current).add(key));
    setTasks((current) => current[game.id] ? {
      ...current,
      [game.id]: { ...current[game.id], message: discard ? "Cancelando download…" : "Parando download…" },
    } : current);
    try {
      await runtime.cancelDownload("game", game.id, discard);
    } catch (error) {
      cancelledDownloads.current.delete(key);
      discardedDownloads.current.delete(key);
      setStoppingDownloads((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      notify(readableError(error, "Não foi possível parar o download."), "error");
    }
  };

  const importLocalGame = async (game: Game) => {
    if (!runtimeInfo?.libraryPath) {
      notify("Escolha primeiro a pasta da biblioteca nas configurações.", "error");
      navigate("settings");
      return;
    }
    try {
      const result = await runtime.importLocalGame(game);
      if (!result) return;
      setInstalled((current) => [...current.filter((item) => item.gameId !== game.id), result]);
      notify(`${game.title} foi adicionado à biblioteca.`, "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível adicionar o jogo."), "error");
    }
  };

  const launchGame = async (game: Game) => {
    if (runtimeInfo?.mode !== "native") {
      notify("Prévia da interface: a execução nativa será habilitada no aplicativo desktop.");
      return;
    }
    if (game.system === "pc") {
      try {
        await runtime.launchGame(game);
      } catch (error) {
        notify(readableError(error, "Não foi possível iniciar o jogo de PC."), "error");
      }
      return;
    }
    const compatibleEmulator = runtimeInfo.emulators.find((emulator) => emulator.systems.includes(game.system));
    if (!compatibleEmulator?.installed) {
      if (game.system === "ps3") {
        try {
          await runtime.launchGame(game);
        } catch (error) {
          notify(readableError(error, "O jogo foi aberto na pasta local. Configure o RPCS3 para executá-lo diretamente."), "info");
        }
        return;
      }
      notify(`${compatibleEmulator?.name ?? "O emulador deste sistema"} precisa ser instalado antes de iniciar ${game.title}.`, "error");
      navigate("emulators");
      return;
    }
    try {
      await runtime.launchGame(game);
    } catch (error) {
      notify(readableError(error, "Não foi possível iniciar o jogo."), "error");
    }
  };

  useEffect(() => {
    if (!desktopGameId || loading || !runtimeInfo) return;
    const game = games.find((candidate) => candidate.id === desktopGameId);
    setDesktopGameId(null);
    if (!game) {
      notify("O jogo solicitado pelo site não foi encontrado neste catálogo.", "error");
      return;
    }
    setView("home");
    setSystem(game.system);
    setSelectedGame(game);
    if (installedById.has(game.id)) {
      setSelectedGame(null);
      void launchGame(game);
    } else {
      notify(`${game.title} foi aberto pelo site. Baixe-o para jogar no PC.`);
    }
  }, [desktopGameId, games, installedById, loading, runtimeInfo]);

  const configureLibrary = async () => {
    if (runtimeInfo?.mode !== "native") {
      notify("A escolha de pasta funciona dentro do aplicativo Windows.");
      return;
    }
    try {
      const nextInfo = await runtime.chooseLibrary();
      if (!nextInfo) return;
      setRuntimeInfo(nextInfo);
      notify("Biblioteca configurada e pastas criadas.", "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível configurar a biblioteca."), "error");
    }
  };

  const configureEmulator = async (emulatorId: string) => {
    if (runtimeInfo?.mode !== "native") {
      notify("A detecção de emuladores funciona dentro do aplicativo Windows.");
      return;
    }
    try {
      const nextInfo = await runtime.configureEmulator(emulatorId);
      if (!nextInfo) return;
      setRuntimeInfo(nextInfo);
      notify("Emulador configurado com sucesso.", "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível configurar o emulador."), "error");
    }
  };

  const installEmulator = (emulatorId: string) => {
    if (runtimeInfo?.mode !== "native") {
      notify("O download automático funciona dentro do aplicativo Windows.");
      return;
    }
    if (!runtimeInfo.libraryPath) {
      notify("Escolha primeiro a pasta da biblioteca.", "error");
      return;
    }
    if (emulatorTasks[emulatorId] && !["error", "paused"].includes(emulatorTasks[emulatorId].state)) return;
    setEmulatorTasks((current) => ({
      ...current,
      [emulatorId]: { emulatorId, state: "queued", progress: current[emulatorId]?.progress ?? 0, message: current[emulatorId]?.progress ? "Na fila para continuar…" : "Na fila…", downloadedBytes: current[emulatorId]?.downloadedBytes, totalBytes: runtimeInfo.emulators.find((item) => item.id === emulatorId)?.downloadSizeBytes, attempts: 0, queuedAt: Date.now() },
    }));
  };

  const runEmulatorInstall = async (emulatorId: string, queuedTask: EmulatorTask) => {
    const key = `emulator:${emulatorId}`;
    const attempt = (queuedTask.attempts ?? 0) + 1;
    activeDownloadKeys.current.add(key);
    setEmulatorTasks((current) => current[emulatorId] ? {
      ...current,
      [emulatorId]: { ...current[emulatorId], state: "downloading", message: attempt > 1 ? `Reconectando… tentativa ${attempt}/${MAX_DOWNLOAD_ATTEMPTS}` : "Conectando ao servidor oficial…", attempts: attempt },
    } : current);
    try {
      const nextInfo = await runtime.installEmulator(emulatorId, (progress) => {
        if (cancelledDownloads.current.has(key)) return;
        setEmulatorTasks((current) => ({ ...current, [emulatorId]: { ...current[emulatorId], emulatorId, ...progress, attempts: attempt } }));
      });
      setRuntimeInfo(nextInfo);
      setEmulatorTasks((current) => {
        const next = { ...current };
        delete next[emulatorId];
        return next;
      });
      const emulator = nextInfo.emulators.find((item) => item.id === emulatorId);
      notify(`${emulator?.name ?? "Emulador"} foi baixado e configurado.`, "success");
    } catch (error) {
      const message = readableError(error, "Não foi possível instalar o emulador.");
      if (message.includes("DOWNLOAD_CANCELLED") || cancelledDownloads.current.has(key)) {
        if (discardedDownloads.current.has(key)) {
          setEmulatorTasks((current) => {
            const next = { ...current };
            delete next[emulatorId];
            return next;
          });
          notify("Download do emulador cancelado e arquivos temporários removidos.");
        } else {
          setEmulatorTasks((current) => current[emulatorId] ? {
            ...current,
            [emulatorId]: { ...current[emulatorId], state: "paused", message: "Download pausado. O progresso está salvo.", speedBytesPerSecond: undefined, etaSeconds: undefined },
          } : current);
          notify("Download do emulador pausado. Você pode continuar depois.");
        }
        return;
      }
      if (attempt < MAX_DOWNLOAD_ATTEMPTS && isRetryableDownloadError(message)) {
        const delay = attempt * 2;
        setEmulatorTasks((current) => current[emulatorId] ? {
          ...current,
          [emulatorId]: { ...current[emulatorId], state: "retrying", message: `Conexão interrompida. Nova tentativa em ${delay}s…`, speedBytesPerSecond: undefined, etaSeconds: undefined, attempts: attempt },
        } : current);
        window.setTimeout(() => setEmulatorTasks((current) => current[emulatorId]?.state === "retrying" ? {
          ...current,
          [emulatorId]: { ...current[emulatorId], state: "queued", message: `Tentativa ${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS} na fila…` },
        } : current), delay * 1000);
        return;
      }
      setEmulatorTasks((current) => ({
        ...current,
        [emulatorId]: { ...current[emulatorId], emulatorId, state: "error", message, speedBytesPerSecond: undefined, etaSeconds: undefined, attempts: attempt },
      }));
      notify(message, "error");
    } finally {
      activeDownloadKeys.current.delete(key);
      cancelledDownloads.current.delete(key);
      discardedDownloads.current.delete(key);
      setStoppingDownloads((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const stopEmulatorDownload = async (emulatorId: string, discard = false) => {
    if (discard && !window.confirm("Cancelar este download e apagar todo o progresso baixado?")) return;
    const key = `emulator:${emulatorId}`;
    const currentTask = emulatorTasks[emulatorId];
    if (currentTask && ["queued", "retrying", "paused", "error"].includes(currentTask.state)) {
      if (discard) {
        try {
          await runtime.cancelDownload("emulator", emulatorId, true);
        } catch {
          // A limpeza local pode não existir no modo de prévia.
        }
        setEmulatorTasks((current) => {
          const next = { ...current };
          delete next[emulatorId];
          return next;
        });
      } else {
        setEmulatorTasks((current) => ({ ...current, [emulatorId]: { ...current[emulatorId], state: "paused", message: "Download pausado. O progresso está salvo." } }));
      }
      return;
    }
    cancelledDownloads.current.add(key);
    if (discard) discardedDownloads.current.add(key);
    setStoppingDownloads((current) => new Set(current).add(key));
    setEmulatorTasks((current) => current[emulatorId] ? {
      ...current,
      [emulatorId]: { ...current[emulatorId], message: discard ? "Cancelando download…" : "Parando download…" },
    } : current);
    try {
      await runtime.cancelDownload("emulator", emulatorId, discard);
    } catch (error) {
      cancelledDownloads.current.delete(key);
      discardedDownloads.current.delete(key);
      setStoppingDownloads((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      notify(readableError(error, "Não foi possível parar o download."), "error");
    }
  };

  useEffect(() => {
    if (loading || !runtimeInfo) return;
    const availableSlots = MAX_CONCURRENT_DOWNLOADS - activeDownloadKeys.current.size;
    if (availableSlots <= 0) return;
    const queued = [
      ...Object.values(tasks)
        .filter((task) => task.state === "queued")
        .map((task) => ({ kind: "game" as const, id: task.gameId, queuedAt: task.queuedAt ?? 0, task })),
      ...Object.values(emulatorTasks)
        .filter((task) => task.state === "queued")
        .map((task) => ({ kind: "emulator" as const, id: task.emulatorId, queuedAt: task.queuedAt ?? 0, task })),
    ].sort((left, right) => left.queuedAt - right.queuedAt);
    for (const item of queued.slice(0, availableSlots)) {
      const key = `${item.kind}:${item.id}`;
      if (activeDownloadKeys.current.has(key)) continue;
      activeDownloadKeys.current.add(key);
      if (item.kind === "game") {
        const game = games.find((candidate) => candidate.id === item.id);
        if (game) void runGameInstall(game, item.task);
        else activeDownloadKeys.current.delete(key);
      } else {
        void runEmulatorInstall(item.id, item.task);
      }
    }
  }, [emulatorTasks, games, loading, runtimeInfo, tasks]);

  const importBios = async (emulatorId: string) => {
    try {
      const imported = await runtime.importBios(emulatorId);
      if (imported) notify("BIOS adicionada à pasta correta do emulador.", "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível adicionar a BIOS."), "error");
    }
  };

  const editEmulatorSettings = async (emulatorId: string) => {
    try {
      setEditingEmulator(await runtime.getEmulatorSettings(emulatorId));
    } catch (error) {
      notify(readableError(error, "Não foi possível carregar as configurações do emulador."), "error");
    }
  };

  const saveNativeEmulatorSettings = async () => {
    if (!editingEmulator) return;
    try {
      await runtime.saveEmulatorSettings(editingEmulator);
      notify("Configurações gravadas no emulador.", "success");
      setEditingEmulator(null);
    } catch (error) {
      notify(readableError(error, "Não foi possível gravar as configurações no emulador."), "error");
    }
  };

  const updateSettings = (patch: Partial<LauncherSettings>) => {
    setSettingsDraft((current) => current ? { ...current, ...patch } : current);
  };

  const updateGraphics = (patch: Partial<GraphicsSettings>) => {
    setSettingsDraft((current) => current ? {
      ...current,
      qualityPreset: "custom",
      graphics: { ...current.graphics, ...patch },
    } : current);
  };

  const selectQuality = (qualityPreset: Exclude<QualityPreset, "custom">) => {
    setSettingsDraft((current) => current ? {
      ...current,
      qualityPreset,
      graphics: qualityPreset === "auto"
        ? presetGraphics[runtimeInfo?.hardwareProfile.recommendedQuality ?? "medium"]
        : presetGraphics[qualityPreset],
    } : current);
  };

  const saveLauncherSettings = async () => {
    if (!settingsDraft) return;
    try {
      const nextInfo = await runtime.saveSettings(settingsDraft);
      setRuntimeInfo(nextInfo);
      setSettingsDraft(nextInfo.settings);
      notify("Configurações salvas e prontas para os emuladores.", "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível salvar as configurações."), "error");
    }
  };

  const primaryAction = (game: Game) => {
    if (installedById.has(game.id)) return launchGame(game);
    return game.sourceUrl ? installGame(game) : runtimeInfo?.mode === "native" ? importLocalGame(game) : installGame(game);
  };

  const removeInstalledGame = async (game: Game, deleteSaves: boolean) => {
    setRemovingGameId(game.id);
    try {
      const result = await runtime.removeGame(game, deleteSaves);
      setInstalled((current) => current.filter((item) => item.gameId !== game.id));
      setTasks((current) => {
        const next = { ...current };
        delete next[game.id];
        return next;
      });
      setSelectedGame(null);
      setGameToRemove(null);
      const gameMessage = result.gameFilesDeleted
        ? `${game.title} e seus arquivos foram apagados.`
        : `${game.title} foi removido da biblioteca; o arquivo importado foi preservado.`;
      const saveMessage = deleteSaves
        ? result.saveFilesDeleted > 0
          ? ` ${result.saveFilesDeleted} arquivo${result.saveFilesDeleted === 1 ? "" : "s"} de save também ${result.saveFilesDeleted === 1 ? "foi apagado" : "foram apagados"}.`
          : " Nenhum save individual deste jogo foi encontrado."
        : " Os saves foram mantidos.";
      notify(`${gameMessage}${saveMessage}`, "success");
    } catch (error) {
      notify(readableError(error, "Não foi possível apagar o jogo."), "error");
    } finally {
      setRemovingGameId(null);
    }
  };

  const toggleFavorite = (gameId: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  const markBrokenCover = (gameId: string) => {
    setBrokenCoverIds((current) => {
      if (current.has(gameId)) return current;
      return new Set(current).add(gameId);
    });
  };

  const resetCatalogFilters = () => {
    setQuery("");
    setSelectedLetter("ALL");
    setSelectedGenre("ALL");
    setCatalogSort("title-asc");
    setOnlyFavorites(false);
    setOnlyWithCovers(true);
  };

  const hasCatalogFilters = Boolean(query.trim()) || selectedLetter !== "ALL" || selectedGenre !== "ALL" || onlyFavorites || !onlyWithCovers || catalogSort !== "title-asc";
  const incompleteDownloadCount = [...Object.values(tasks), ...Object.values(emulatorTasks)].filter((task) => ["paused", "error"].includes(task.state)).length;

  const clearIncompleteDownloads = async () => {
    if (!incompleteDownloadCount || !window.confirm(`Apagar os arquivos temporários de ${incompleteDownloadCount} download(s) pausado(s) ou com erro?`)) return;
    const gameIds = Object.values(tasks).filter((task) => ["paused", "error"].includes(task.state)).map((task) => task.gameId);
    const emulatorIds = Object.values(emulatorTasks).filter((task) => ["paused", "error"].includes(task.state)).map((task) => task.emulatorId);
    await Promise.allSettled([
      ...gameIds.map((id) => runtime.cancelDownload("game", id, true)),
      ...emulatorIds.map((id) => runtime.cancelDownload("emulator", id, true)),
    ]);
    setTasks((current) => Object.fromEntries(Object.entries(current).filter(([, task]) => !gameIds.includes(task.gameId))));
    setEmulatorTasks((current) => Object.fromEntries(Object.entries(current).filter(([, task]) => !emulatorIds.includes(task.emulatorId))));
    notify("Downloads incompletos removidos.", "success");
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <img className="brand__mark" src="/brand/no-lost-mark.svg" alt="" />
          <div><strong>No Lost Media</strong><small>Universal Launcher</small></div>
        </div>
        <nav className="sidebar__nav" aria-label="Navegação principal">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={19} /><span>{item.label}</span>
                {item.id === "downloads" && activeTasks.length + activeEmulatorTasks.length > 0 && <b>{activeTasks.length + activeEmulatorTasks.length}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar__device">
          <span className="status-dot" />
          <div><strong>{runtimeInfo?.mode === "native" ? "Aplicativo desktop" : "Prévia da interface"}</strong><small>{visibleInstalled.length} {visibleInstalled.length === 1 ? "jogo" : "jogos"} na biblioteca</small></div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar__left">
            <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu /></button>
          </div>
          <div className="search-box">
            <Search size={19} />
            <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar títulos, arquivos, regiões ou gêneros…" />
            {query && <button onClick={() => setQuery("")} aria-label="Limpar busca"><X size={16} /></button>}
            {!query && <kbd>Ctrl+K</kbd>}
          </div>
          <div className="topbar__right">
            <div className="topbar__mode">
              {runtimeInfo?.capabilities.platform === "browser" ? <MonitorCog size={18} /> : <Gamepad2 size={18} />}
              <span>{catalogSource === "demo" ? "Modo demonstração" : catalogSource === "remote" ? "Acervo conectado" : "Acervo No Lost Media"}</span>
            </div>
          </div>
        </header>

        <div className="content-scroll">
          {view === "home" && !hasCatalogFilters && continueGame && (
            <section className="hero-panel" style={{ "--hero-accent": getSystem(continueGame.system).accent } as React.CSSProperties}>
              <div className="hero-panel__glow" />
              <div className="hero-panel__copy">
                <span className="eyebrow"><Sparkles size={14} /> Continue de onde parou</span>
                <h1>{continueGame.title}</h1>
                <p>{getSystem(continueGame.system).name} • {continueGame.genre} • {continueGame.year}</p>
                <button className="primary-action" onClick={() => void launchGame(continueGame)}><Play size={18} fill="currentColor" /> Jogar agora</button>
              </div>
              <GameArtwork game={continueGame} compact />
            </section>
          )}

          {(view === "home" || view === "library") && (
            <>
              <ConsoleTabs
                selectedSystem={system}
                onSelectSystem={(nextSystem) => {
                  setSystem(nextSystem);
                  setSelectedLetter("ALL");
                }}
                systemCounts={systemCounts}
              />

              {/* Filtro Alfabético (Barra flutuante inspirada no site) */}
              <div className="alphabet-bar-container" aria-label="Filtro alfabético">
                <div className="alphabet-bar">
                  {catalogLetters.map((letter) => {
                    const count = letter === "ALL" ? letterTotal : (letterCounts[letter] ?? 0);
                    return (
                      <button
                        key={letter}
                        type="button"
                        disabled={count === 0}
                        className={`alphabet-pill ${selectedLetter === letter ? "is-active" : ""}`}
                        title={letter === "ALL" ? `${count} jogos` : `${count} jogos com a letra ${letter}`}
                        onClick={() => setSelectedLetter(letter)}
                      >
                        {letter === "ALL" ? "Todos (A–Z)" : letter}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Barra de Ações & Opções de Visualização */}
              <div className="catalog-toolbar">
                <div className="catalog-toolbar__left">
                  <button
                    type="button"
                    className={`filter-toggle ${onlyWithCovers ? "is-active" : ""}`}
                    onClick={() => setOnlyWithCovers((current) => !current)}
                  >
                    <ImageIcon size={15} />
                    <span>Apenas com capas</span>
                    <i className="toggle-switch" aria-hidden="true"><span /></i>
                  </button>
                  <button
                    type="button"
                    className={`filter-toggle ${onlyFavorites ? "is-favorite" : ""}`}
                    onClick={() => setOnlyFavorites((current) => !current)}
                  >
                    <Heart size={15} fill={onlyFavorites ? "currentColor" : "none"} />
                    <span>Favoritos ({favorites.size})</span>
                  </button>
                </div>

                <div className="catalog-toolbar__right">
                  <div className="view-mode-group" role="group" aria-label="Modo de exibição">
                    <button
                      type="button"
                      className={`view-mode-btn ${displayMode === "grid" ? "is-active" : ""}`}
                      onClick={() => handleSetDisplayMode("grid")}
                      title="Visualização em Grade"
                      aria-label="Visualização em Grade"
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      type="button"
                      className={`view-mode-btn ${displayMode === "list" ? "is-active" : ""}`}
                      onClick={() => handleSetDisplayMode("list")}
                      title="Visualização em Lista"
                      aria-label="Visualização em Lista"
                    >
                      <List size={16} />
                    </button>
                  </div>
                  <CustomDropdown
                    value={catalogSort}
                    onChange={(val) => setCatalogSort(val as CatalogSort)}
                    options={catalogSortOptions}
                    title="Ordem de exibição"
                    icon={<ArrowUpDown size={14} />}
                    ariaLabel="Ordenar resultados"
                  />
                </div>
              </div>

              {/* Filtro de Categorias / Gêneros (Pills elegantes com ícones) */}
              <div className="genre-bar-container" aria-label="Filtro por gênero">
                <div className="genre-bar">
                  {catalogGenres.map((genre) => {
                    const meta = GENRE_META[genre] ?? { shortLabel: genre, icon: Gamepad2 };
                    const Icon = meta.icon;
                    const isActive = selectedGenre === genre;
                    return (
                      <button
                        key={genre}
                        type="button"
                        className={`genre-pill ${isActive ? "is-active" : ""}`}
                        onClick={() => setSelectedGenre(genre)}
                      >
                        <Icon size={14} />
                        <span>{meta.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Resumo de Status & Filtros Ativos */}
              <div className="catalog-status-bar">
                <div className="catalog-status-bar__info">
                  <span className="live-status-dot" />
                  <span>
                    <strong>{filteredGames.length.toLocaleString("pt-BR")}</strong> de{" "}
                    {games.length.toLocaleString("pt-BR")} títulos{" "}
                    {onlyWithCovers && !debouncedSearch.trim() && <em>(apenas com capa)</em>}
                    {debouncedSearch.trim() && <em>• busca por "{debouncedSearch}"</em>}
                  </span>
                </div>

                {hasCatalogFilters && (
                  <div className="active-filters-chips">
                    {selectedLetter !== "ALL" && (
                      <button onClick={() => setSelectedLetter("ALL")}>
                        Letra: {selectedLetter} <X size={12} />
                      </button>
                    )}
                    {selectedGenre !== "ALL" && (
                      <button onClick={() => setSelectedGenre("ALL")}>
                        {GENRE_META[selectedGenre]?.shortLabel ?? selectedGenre} <X size={12} />
                      </button>
                    )}
                    {onlyFavorites && (
                      <button onClick={() => setOnlyFavorites(false)}>
                        Favoritos <X size={12} />
                      </button>
                    )}
                    <button className="clear-all-filters" onClick={resetCatalogFilters}>
                      Limpar filtros
                    </button>
                  </div>
                )}
              </div>

              <section className="catalog-section">
                <div className="section-title">
                  <div>
                    <span className="eyebrow">{view === "library" ? "Meus jogos" : hasCatalogFilters || system !== "all" ? "Resultados" : "Descubra"}</span>
                    <h2>{view === "library" ? "Sua biblioteca" : system === "all" ? "Jogos em destaque" : getSystem(system).name}</h2>
                  </div>
                  <span>{filteredGames.length} {filteredGames.length === 1 ? "jogo" : "jogos"}</span>
                </div>
                {loading ? <div className="loading-grid">Carregando sua central…</div> : filteredGames.length === 0 ? <EmptyState view={view} /> : displayMode === "grid" ? (
                  <div className="games-grid">
                    {paginatedGames.map((game) => (
                      <GameCard key={game.id} game={game} installed={installedById.get(game.id)} task={tasks[game.id]} nativeMode={runtimeInfo?.mode === "native"} onSelect={() => setSelectedGame(game)} onPrimary={() => void primaryAction(game)} onCancel={() => void stopGameDownload(game)} stopping={stoppingDownloads.has(`game:${game.id}`)} favorite={favorites.has(game.id)} onToggleFavorite={() => toggleFavorite(game.id)} onCoverError={() => markBrokenCover(game.id)} coverAvailable={!brokenCoverIds.has(game.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="games-list-container">
                    <div className="games-list-header">
                      <span className="col-fav" aria-label="Favorito" />
                      <span className="col-cover">Capa</span>
                      <span className="col-title">Título</span>
                      <span className="col-system">Console</span>
                      <span className="col-genre">Gênero</span>
                      <span className="col-year">Ano</span>
                      <span className="col-size">Tamanho</span>
                      <span className="col-action">Ação</span>
                    </div>
                    <div className="games-list-body">
                      {paginatedGames.map((game) => (
                        <GameListRow
                          key={game.id}
                          game={game}
                          installed={installedById.get(game.id)}
                          task={tasks[game.id]}
                          nativeMode={runtimeInfo?.mode === "native"}
                          onSelect={() => setSelectedGame(game)}
                          onPrimary={() => void primaryAction(game)}
                          onCancel={() => void stopGameDownload(game)}
                          stopping={stoppingDownloads.has(`game:${game.id}`)}
                          favorite={favorites.has(game.id)}
                          onToggleFavorite={() => toggleFavorite(game.id)}
                          onCoverError={() => markBrokenCover(game.id)}
                          coverAvailable={!brokenCoverIds.has(game.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {!loading && filteredGames.length > 0 && (
                  <div className="catalog-pagination">
                    <div className="pagination-dropdown-box">
                      <span>Por página</span>
                      <CustomDropdown
                        value={itemsPerPage}
                        onChange={(val) => setItemsPerPage(Number(val))}
                        options={[
                          { value: 24, label: "24 jogos" },
                          { value: 48, label: "48 jogos" },
                          { value: 96, label: "96 jogos" },
                        ]}
                        title="Itens por página"
                        align="left"
                      />
                    </div>
                    <div>
                      <button disabled={catalogPage === 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>Anterior</button>
                      <span>Página {catalogPage} de {totalCatalogPages}</span>
                      <button disabled={catalogPage === totalCatalogPages} onClick={() => setCatalogPage((page) => Math.min(totalCatalogPages, page + 1))}>Próxima</button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {view === "downloads" && (
            <section className="standalone-section">
              <div className="section-title download-heading"><div><span className="eyebrow">Gerenciador persistente</span><h2>Downloads e instalações</h2><p>Até {MAX_CONCURRENT_DOWNLOADS} transferências simultâneas. A fila e o progresso parcial permanecem salvos ao fechar o launcher.</p></div><div><span>{activeDownloadKeys.current.size} ativos</span>{incompleteDownloadCount > 0 && <button type="button" onClick={() => void clearIncompleteDownloads()}>Limpar incompletos ({incompleteDownloadCount})</button>}</div></div>
              {Object.values(tasks).length === 0 && Object.values(emulatorTasks).length === 0 ? (
                <div className="empty-state"><Download size={38} /><h3>Nenhum download em andamento</h3><p>Jogos e emuladores baixados pelo launcher aparecerão aqui.</p></div>
              ) : (
                <div className="download-list">
                  {Object.values(emulatorTasks).map((task) => {
                    const emulator = runtimeInfo?.emulators.find((item) => item.id === task.emulatorId);
                    const stopping = stoppingDownloads.has(`emulator:${task.emulatorId}`);
                    const active = isDownloadActive(task.state);
                    const summary = transferSummary(task);
                    return <div className={`download-item download-item--emulator download-item--${task.state}`} key={`emulator-${task.emulatorId}`}><span className="download-emulator-logo"><Gamepad2 /></span><div><strong>{emulator?.name ?? "Emulador"}</strong><span>{task.message}</span>{summary && <small>{summary}</small>}<div className="download-progress"><i style={{ width: `${task.progress}%` }} /></div></div><div className="download-item__actions"><b>{task.state === "error" ? "Erro" : task.state === "paused" ? "Pausado" : task.state === "queued" ? "Na fila" : `${Math.floor(task.progress)}%`}</b><div><button type="button" disabled={stopping} onClick={() => void (active ? stopEmulatorDownload(task.emulatorId) : installEmulator(task.emulatorId))}>{active ? "Pausar" : task.state === "error" ? "Tentar novamente" : "Continuar"}</button><button className="is-destructive" type="button" disabled={stopping} onClick={() => void stopEmulatorDownload(task.emulatorId, true)}><X size={13} /> {stopping ? "Aguarde…" : "Cancelar"}</button></div></div></div>;
                  })}
                  {Object.values(tasks).map((task) => {
                    const game = games.find((item) => item.id === task.gameId);
                    if (!game) return null;
                    const stopping = stoppingDownloads.has(`game:${game.id}`);
                    const active = isDownloadActive(task.state);
                    const summary = transferSummary(task);
                    return <div className={`download-item download-item--${task.state}`} key={task.id}><GameArtwork game={game} /><div><strong>{game.title}</strong><span>{task.message}</span>{summary && <small>{summary}</small>}<div className="download-progress"><i style={{ width: `${task.progress}%` }} /></div></div><div className="download-item__actions"><b>{task.state === "error" ? "Erro" : task.state === "paused" ? "Pausado" : task.state === "queued" ? "Na fila" : `${Math.floor(task.progress)}%`}</b><div><button type="button" disabled={stopping} onClick={() => void (active ? stopGameDownload(game) : installGame(game))}>{active ? "Pausar" : task.state === "error" ? "Tentar novamente" : "Continuar"}</button><button className="is-destructive" type="button" disabled={stopping} onClick={() => void stopGameDownload(game, true)}><X size={13} /> {stopping ? "Aguarde…" : "Cancelar"}</button></div></div></div>;
                  })}
                </div>
              )}
            </section>
          )}

          {view === "emulators" && runtimeInfo && (
            <section className="standalone-section">
              <div className="section-title"><div><span className="eyebrow">Motores do launcher</span><h2>Emuladores</h2><p>Baixe, detecte e prepare os emuladores usados por cada console.</p></div></div>
              <div className="emulator-panel emulator-panel--standalone">
                <div className="section-title section-title--small"><div><h2>Emuladores</h2><p>O launcher escolherá automaticamente o motor certo para cada jogo.</p></div></div>
                {runtimeInfo.emulators.map((emulator) => {
                  const task = emulatorTasks[emulator.id];
                  const busy = isDownloadActive(task?.state);
                  return (
                    <div className="emulator-row" key={emulator.id}>
                      <span className="emulator-logo"><Gamepad2 /></span>
                      <div className="emulator-copy">
                        <strong>{emulator.name} {emulator.version && <em>v{emulator.version}</em>}</strong>
                        <small>{emulator.systems.map((id) => getSystem(id).shortName).join(" • ")}</small>
                        {emulator.managedInstall && <small>{emulator.sourceName} • {emulator.downloadSizeLabel}</small>}
                        {emulator.setupNote && <small className="emulator-note">{emulator.setupNote}</small>}
                        {task && <><small className={task.state === "error" ? "emulator-error" : "emulator-progress-label"}>{task.message}</small><span className="emulator-progress"><i style={{ width: `${task.progress}%` }} /></span></>}
                      </div>
                      <div className="emulator-actions">
                        {emulator.managedInstall ? (
                          <button type="button" disabled={busy && stoppingDownloads.has(`emulator:${emulator.id}`)} onClick={() => void (busy ? stopEmulatorDownload(emulator.id) : installEmulator(emulator.id))} className={busy ? "emulator-state emulator-state--stop" : emulator.installed ? "emulator-state is-ready" : "emulator-state emulator-state--primary"}>
                            {busy ? <><X size={14} /> {stoppingDownloads.has(`emulator:${emulator.id}`) ? "Pausando…" : "Pausar download"}</> : emulator.installed ? <><Check size={14} /> Reinstalar</> : task?.state === "paused" ? <><Download size={14} /> Continuar download</> : <><Download size={14} /> Baixar e configurar</>}
                          </button>
                        ) : <span className="emulator-coming-soon">Download automático em breve</span>}
                        {task && <button type="button" disabled={stoppingDownloads.has(`emulator:${emulator.id}`)} onClick={() => void stopEmulatorDownload(emulator.id, true)} className="emulator-link emulator-link--cancel">Cancelar e apagar o download</button>}
                        <button type="button" disabled={busy} onClick={() => void editEmulatorSettings(emulator.id)} className="emulator-state emulator-state--settings"><Settings size={14} /> Configurar emulador</button>
                        <button type="button" disabled={busy} onClick={() => void configureEmulator(emulator.id)} className="emulator-link">Selecionar instalação existente</button>
                        {emulator.biosImport && emulator.installed && <button type="button" disabled={busy} onClick={() => void importBios(emulator.id)} className="emulator-link emulator-link--bios">Adicionar minha BIOS</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {view === "settings" && runtimeInfo && settingsDraft && (
            <section className="standalone-section settings-page">
              <div className="section-title">
                <div><span className="eyebrow">Preferências do launcher</span><h2>Configurações</h2><p>Um só perfil aplicado aos emuladores compatíveis.</p></div>
                <button className="primary-action settings-save" type="button" onClick={() => void saveLauncherSettings()}><Check size={16} /> Salvar configurações</button>
              </div>

              <div className="settings-layout">
                <section className="preference-panel preference-panel--wide">
                  <div className="preference-heading"><span><Gauge /></span><div><h3>Qualidade gráfica</h3><p>O modo automático se adapta ao computador. Você também pode escolher uma predefinição ou ajustar tudo manualmente.</p></div></div>
                  <div className="hardware-summary">
                    <strong>Recomendação para este PC: {qualityLabels[runtimeInfo.hardwareProfile.recommendedQuality]}</strong>
                    <small>{runtimeInfo.hardwareProfile.logicalCores} processadores lógicos{runtimeInfo.hardwareProfile.memoryGb ? ` • ${runtimeInfo.hardwareProfile.memoryGb} GB de RAM` : ""}{runtimeInfo.hardwareProfile.gpuName ? ` • ${runtimeInfo.hardwareProfile.gpuName}${runtimeInfo.hardwareProfile.gpuMemoryGb ? ` (${runtimeInfo.hardwareProfile.gpuMemoryGb} GB)` : ""}` : ""}.</small>
                  </div>
                  <div className="quality-presets">
                    {(Object.keys(qualityLabels) as Array<Exclude<QualityPreset, "custom">>).map((preset) => (
                      <button key={preset} type="button" className={settingsDraft.qualityPreset === preset ? "is-active" : ""} onClick={() => selectQuality(preset)}>
                        <strong>{qualityLabels[preset]}</strong>
                        <small>{preset === "auto" ? "Recomendado" : preset === "low" ? "Mais desempenho" : preset === "medium" ? "Equilibrado" : preset === "high" ? "Mais definição" : "Máxima qualidade"}</small>
                      </button>
                    ))}
                  </div>
                  <button className="advanced-toggle" type="button" onClick={() => setAdvancedGraphics((current) => !current)}><SlidersHorizontal size={16} /> {advancedGraphics ? "Ocultar ajustes avançados" : "Ajustar qualidade manualmente"}<ChevronRight size={16} /></button>
                  {advancedGraphics && (
                    <div className="advanced-grid">
                      <div className="select-setting">
                        <span>Resolução interna</span>
                        <CustomDropdown
                          value={settingsDraft.graphics.internalResolution}
                          onChange={(val) => updateGraphics({ internalResolution: Number(val) })}
                          options={[
                            { value: 1, label: "1x — Nativa" },
                            { value: 2, label: "2x — 720p" },
                            { value: 3, label: "3x — 1080p" },
                            { value: 4, label: "4x — 1440p" },
                            { value: 6, label: "6x — 4K" },
                            { value: 8, label: "8x — 5K+" },
                          ]}
                          title="Resolução interna"
                          align="left"
                        />
                      </div>
                      <div className="select-setting">
                        <span>Antisserrilhamento</span>
                        <CustomDropdown
                          value={settingsDraft.graphics.antiAliasing}
                          onChange={(val) => updateGraphics({ antiAliasing: val as GraphicsSettings["antiAliasing"] })}
                          options={[
                            { value: "off", label: "Desativado" },
                            { value: "fxaa", label: "FXAA" },
                            { value: "msaa2", label: "MSAA 2x" },
                            { value: "msaa4", label: "MSAA 4x" },
                            { value: "msaa8", label: "MSAA 8x" },
                          ]}
                          title="Antisserrilhamento"
                          align="left"
                        />
                      </div>
                      <div className="select-setting">
                        <span>Filtragem de textura</span>
                        <CustomDropdown
                          value={settingsDraft.graphics.textureFiltering}
                          onChange={(val) => updateGraphics({ textureFiltering: val as GraphicsSettings["textureFiltering"] })}
                          options={[
                            { value: "nearest", label: "Vizinho mais próximo" },
                            { value: "bilinear", label: "Bilinear" },
                            { value: "trilinear", label: "Trilinear" },
                          ]}
                          title="Filtragem de textura"
                          align="left"
                        />
                      </div>
                      <div className="select-setting">
                        <span>Filtro anisotrópico</span>
                        <CustomDropdown
                          value={settingsDraft.graphics.anisotropicFiltering}
                          onChange={(val) => updateGraphics({ anisotropicFiltering: Number(val) })}
                          options={[
                            { value: 1, label: "1x" },
                            { value: 2, label: "2x" },
                            { value: 4, label: "4x" },
                            { value: 8, label: "8x" },
                            { value: 16, label: "16x" },
                          ]}
                          title="Filtro anisotrópico"
                          align="left"
                        />
                      </div>
                      <div className="select-setting">
                        <span>Limite de quadros</span>
                        <CustomDropdown
                          value={settingsDraft.graphics.frameLimit}
                          onChange={(val) => updateGraphics({ frameLimit: Number(val) })}
                          options={[
                            { value: 0, label: "Sem limite" },
                            { value: 30, label: "30 FPS" },
                            { value: 60, label: "60 FPS" },
                            { value: 120, label: "120 FPS" },
                          ]}
                          title="Limite de quadros"
                          align="left"
                        />
                      </div>
                      <label className="switch-row"><span><strong>Sincronização vertical</strong><small>Evita cortes na imagem.</small></span><input type="checkbox" checked={settingsDraft.graphics.vsync} onChange={(event) => updateGraphics({ vsync: event.target.checked })} /></label>
                    </div>
                  )}
                  {settingsDraft.qualityPreset === "custom" && <span className="custom-badge">Predefinição personalizada</span>}
                </section>

                <section className="preference-panel">
                  <div className="preference-heading"><span><Volume2 /></span><div><h3>Áudio</h3><p>Volume geral usado pelos emuladores compatíveis.</p></div></div>
                  <label className="range-setting"><span><strong>Volume principal</strong><b>{settingsDraft.muted ? "Mudo" : `${settingsDraft.masterVolume}%`}</b></span><input type="range" min="0" max="100" value={settingsDraft.masterVolume} disabled={settingsDraft.muted} onChange={(event) => updateSettings({ masterVolume: Number(event.target.value) })} /></label>
                  <label className="switch-row"><span><strong>Silenciar tudo</strong><small>Desativa o som ao iniciar os jogos.</small></span><input type="checkbox" checked={settingsDraft.muted} onChange={(event) => updateSettings({ muted: event.target.checked })} /></label>
                </section>

                <section className="preference-panel">
                  <div className="preference-heading"><span><Gamepad2 /></span><div><h3>Controles</h3><p>{connectedControllers ? `${connectedControllers} controle${connectedControllers > 1 ? "s" : ""} conectado${connectedControllers > 1 ? "s" : ""}` : "Nenhum controle detectado agora"}</p></div></div>
                  <div className="select-setting">
                    <span>Perfil preferencial</span>
                    <CustomDropdown
                      value={settingsDraft.controllerMode}
                      onChange={(val) => updateSettings({ controllerMode: val as LauncherSettings["controllerMode"] })}
                      options={[
                        { value: "auto", label: "Detectar automaticamente" },
                        { value: "xinput", label: "Xbox / XInput" },
                        { value: "playstation", label: "PlayStation" },
                        { value: "keyboard", label: "Teclado" },
                      ]}
                      title="Perfil de controle"
                      align="left"
                    />
                  </div>
                  <p className="settings-note">O remapeamento fino de botões, analógicos e touchpad é aberto no painel nativo de cada emulador.</p>
                </section>

                <section className="preference-panel">
                  <div className="preference-heading"><span><Settings /></span><div><h3>Experiência</h3><p>Comportamento padrão ao abrir jogos.</p></div></div>
                  <label className="switch-row"><span><strong>Iniciar em tela cheia</strong><small>Abre os jogos ocupando toda a tela.</small></span><input type="checkbox" checked={settingsDraft.startFullscreen} onChange={(event) => updateSettings({ startFullscreen: event.target.checked })} /></label>
                  <label className="switch-row"><span><strong>Pausar em segundo plano</strong><small>Pausa ao trocar de janela.</small></span><input type="checkbox" checked={settingsDraft.pauseWhenInactive} onChange={(event) => updateSettings({ pauseWhenInactive: event.target.checked })} /></label>
                  <label className="switch-row"><span><strong>Save automático</strong><small>Salva e restaura o estado quando suportado.</small></span><input type="checkbox" checked={settingsDraft.autoSave} onChange={(event) => updateSettings({ autoSave: event.target.checked })} /></label>
                </section>

                <section className="preference-panel preference-panel--library">
                  <div className="preference-heading"><span><HardDrive /></span><div><h3>Biblioteca local</h3><p>{runtimeInfo.libraryPath ?? "Escolha onde jogos, saves e emuladores serão organizados."}</p></div></div>
                  <button className="secondary-action" type="button" onClick={() => void configureLibrary()}>Alterar pasta <ChevronRight size={16} /></button>
                </section>

                <section className="preference-panel preference-panel--about">
                  <div className="preference-heading">
                    <span><Info /></span>
                    <div>
                      <h3>Sobre o Aplicativo</h3>
                      <p>Gerenciamento de versões e canal oficial de atualizações.</p>
                    </div>
                  </div>

                  <div className="about-version-card">
                    <div className="about-version-info">
                      <strong>
                        No Lost Media Launcher
                        <span className="about-status-tag about-status-tag--ok">v{APP_VERSION}</span>
                        {availableUpdate?.isNewer && (
                          <span className="about-status-tag about-status-tag--update">
                            Update {availableUpdate.tagName}
                          </span>
                        )}
                      </strong>
                      <small>
                        {updateStatusMessage ?? (availableUpdate?.isNewer ? `Nova versão ${availableUpdate.tagName} disponível para download.` : "Você está usando a versão mais recente.")}
                      </small>
                    </div>

                    <button
                      type="button"
                      className="about-check-button"
                      disabled={isCheckingUpdate}
                      onClick={() => void handleManualCheckUpdates()}
                    >
                      <RefreshCw size={14} className={isCheckingUpdate ? "animate-spin" : ""} />
                      {isCheckingUpdate ? "Verificando…" : "Verificar atualizações"}
                    </button>
                  </div>

                  <div className="about-links">
                    <button type="button" onClick={() => void openExternalUrl("https://nolost.media/")}>
                      <Globe size={13} /> Site oficial: nolost.media
                    </button>
                    <button type="button" onClick={() => void openExternalUrl(`https://github.com/${GITHUB_REPO}`)}>
                      <ExternalLink size={13} /> Repositório no GitHub
                    </button>
                  </div>
                </section>
              </div>
            </section>
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {navigation.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}><Icon size={20} /><span>{item.label}</span></button>; })}
      </nav>

      {editingEmulator && (
        <EmulatorSettingsDialog
          emulatorName={runtimeInfo?.emulators.find((emulator) => emulator.id === editingEmulator.emulatorId)?.name ?? editingEmulator.emulatorId}
          settings={editingEmulator}
          onChange={setEditingEmulator}
          onClose={() => setEditingEmulator(null)}
          onSave={() => void saveNativeEmulatorSettings()}
        />
      )}

      {selectedGame && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="game-dialog-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedGame(null);
        }}>
          <div className="game-dialog">
            <button className="dialog-close" onClick={() => setSelectedGame(null)} aria-label="Fechar"><X /></button>
            <GameArtwork game={selectedGame} compact onCoverError={() => markBrokenCover(selectedGame.id)} coverAvailable={!brokenCoverIds.has(selectedGame.id)} />
            <div className="game-dialog__body">
              <span className="eyebrow">{getSystem(selectedGame.system).name}</span>
              <h2 id="game-dialog-title">{selectedGame.title}</h2>
              <p>{[selectedGame.year, selectedGame.genre, selectedGame.region].filter(Boolean).join(" • ")}</p>
              <div className="game-facts"><span><small>Tamanho</small><strong>{selectedGame.fileSizeLabel ?? "Não informado"}</strong></span><span><small>Status</small><strong>{installedById.has(selectedGame.id) ? "Instalado" : "Disponível"}</strong></span>{installedById.get(selectedGame.id) && <span><small>Tempo jogado</small><strong>{formatPlayTime(installedById.get(selectedGame.id)!.playTimeMinutes)}</strong></span>}</div>
              {selectedGame.system === "ps2" && <p className="platform-note"><Gamepad2 size={15} /><span><strong>PS2 roda pelo PCSX2 no aplicativo desktop.</strong> O site continua sendo o acervo; o launcher baixa o jogo e abre o emulador configurado sem você navegar por pastas.</span></p>}
              <button className={`primary-action primary-action--wide ${isDownloadActive(tasks[selectedGame.id]?.state) ? "primary-action--stop" : ""}`} disabled={stoppingDownloads.has(`game:${selectedGame.id}`)} onClick={() => void (isDownloadActive(tasks[selectedGame.id]?.state) ? stopGameDownload(selectedGame) : primaryAction(selectedGame))}>{installedById.has(selectedGame.id) ? <Play fill="currentColor" /> : isDownloadActive(tasks[selectedGame.id]?.state) ? <X /> : <Download />} {installedById.has(selectedGame.id) ? "Jogar agora" : tasks[selectedGame.id]?.state === "error" ? "Tentar baixar novamente" : tasks[selectedGame.id]?.state === "paused" ? "Continuar download" : isDownloadActive(tasks[selectedGame.id]?.state) ? stoppingDownloads.has(`game:${selectedGame.id}`) ? "Pausando download…" : "Pausar download" : selectedGame.sourceUrl ? "Baixar do acervo" : runtimeInfo?.mode === "native" ? "Adicionar arquivo local" : "Instalar jogo"}</button>
              {tasks[selectedGame.id] && <button className="dialog-secondary-action dialog-secondary-action--danger" type="button" disabled={stoppingDownloads.has(`game:${selectedGame.id}`)} onClick={() => void stopGameDownload(selectedGame, true)}>Cancelar e apagar o download</button>}
              {!installedById.has(selectedGame.id) && runtimeInfo?.mode === "native" && <button className="dialog-secondary-action" type="button" onClick={() => void importLocalGame(selectedGame)}>Usar um arquivo que já tenho</button>}
              {installedById.has(selectedGame.id) && <button className="dialog-secondary-action dialog-secondary-action--danger" type="button" onClick={() => setGameToRemove(selectedGame)}><Trash2 size={14} /> Apagar jogo</button>}
              <p className="legal-note">Use apenas jogos e arquivos de sistema que você possui autorização para utilizar.</p>
            </div>
          </div>
        </div>
      )}

      {gameToRemove && (
        <div className="modal-layer removal-layer" role="dialog" aria-modal="true" aria-labelledby="remove-game-title" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !removingGameId) setGameToRemove(null);
        }}>
          <div className="removal-dialog">
            <span className="removal-dialog__icon"><Trash2 /></span>
            <div>
              <span className="eyebrow">Gerenciar biblioteca</span>
              <h2 id="remove-game-title">Apagar {gameToRemove.title}?</h2>
              <p>O jogo baixado será apagado do computador e poderá ser baixado novamente pelo acervo.</p>
              <p className="removal-dialog__note">Se este jogo foi apenas importado de outra pasta, o arquivo original será preservado.</p>
            </div>
            <div className="removal-dialog__actions">
              <button type="button" disabled={Boolean(removingGameId)} onClick={() => setGameToRemove(null)}>Cancelar</button>
              <button type="button" className="remove-keep-saves" disabled={Boolean(removingGameId)} onClick={() => void removeInstalledGame(gameToRemove, false)}>
                <Trash2 size={15} /> {removingGameId ? "Apagando…" : "Apagar e manter saves"}
              </button>
              <button type="button" className="remove-with-saves" disabled={Boolean(removingGameId)} onClick={() => void removeInstalledGame(gameToRemove, true)}>
                <Trash2 size={15} /> {removingGameId ? "Apagando…" : "Apagar jogo e saves"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdateModal && availableUpdate && (
        <UpdateModal
          release={availableUpdate}
          currentVersion={APP_VERSION}
          onClose={() => setShowUpdateModal(false)}
          onRemindLater={handleRemindLater}
          onUpdateNow={() => void handleUpdateNow()}
          isUpdating={isInstallingUpdate}
        />
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast--${toast.tone}`} key={toast.id}>{toast.tone === "success" && <Check size={17} />}{toast.message}</div>)}
      </div>
    </div>
  );
}
