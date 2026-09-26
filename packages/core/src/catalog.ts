import type { Game, SystemId } from "./models";

const platformMap: Record<string, Exclude<SystemId, "all"> | undefined> = {
  PS1: "ps1",
  PS2: "ps2",
  PS3: "ps3",
  DC: "dreamcast",
  N64: "n64",
  SNES: "snes",
  NES: "nes",
  GBA: "gba",
  GC: "gamecube",
  WII: "wii",
  PC: "pc",
};

interface CatalogRecord {
  id?: unknown;
  title?: unknown;
  platform?: unknown;
  system?: unknown;
  year?: unknown;
  genre?: unknown;
  region?: unknown;
  coverUrl?: unknown;
  fileSize?: unknown;
  fileSizeBytes?: unknown;
  sha1?: unknown;
  checksum?: unknown;
  sourceUrl?: unknown;
  fileName?: unknown;
}

export function normalizeCatalog(records: unknown): Game[] {
  let list: unknown[] = [];
  if (Array.isArray(records)) {
    list = records;
  } else if (records && typeof records === "object" && "games" in records && Array.isArray((records as { games: unknown }).games)) {
    list = (records as { games: unknown[] }).games;
  } else {
    return [];
  }

  const games: Game[] = [];
  for (const item of list as CatalogRecord[]) {
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    let system: Exclude<SystemId, "all"> | undefined;
    if (typeof item.system === "string") {
      const sys = item.system.toLowerCase();
      if (
        sys === "ps1" ||
        sys === "ps2" ||
        sys === "ps3" ||
        sys === "dreamcast" ||
        sys === "n64" ||
        sys === "snes" ||
        sys === "nes" ||
        sys === "gba" ||
        sys === "gamecube" ||
        sys === "wii" ||
        sys === "pc"
      ) {
        system = sys;
      }
    }
    if (!system && typeof item.platform === "string") {
      system = platformMap[item.platform.toUpperCase()];
    }
    if (!system) continue;

    let sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : undefined;
    if (sourceUrl && sourceUrl.includes("no-lost-media-bff.onrender.com")) {
      sourceUrl = sourceUrl.replace("https://no-lost-media-bff.onrender.com", "https://api.nolost.media");
    }

    const rawChecksum = typeof item.checksum === "string"
      ? item.checksum
      : typeof item.sha1 === "string"
        ? item.sha1
        : undefined;
    const checksum = rawChecksum && /^[0-9a-fA-F]{40}$/.test(rawChecksum.trim())
      ? rawChecksum.trim().toLowerCase()
      : undefined;

    games.push({
      id: item.id,
      title: item.title,
      system,
      year: typeof item.year === "number" ? item.year : undefined,
      genre: typeof item.genre === "string" ? item.genre : undefined,
      region: typeof item.region === "string" ? item.region : undefined,
      coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : undefined,
      fileSizeBytes: typeof item.fileSizeBytes === "number" ? item.fileSizeBytes : undefined,
      fileSizeLabel: typeof item.fileSize === "string" ? item.fileSize : undefined,
      checksum,
      sourceUrl,
      fileName: typeof item.fileName === "string" ? item.fileName : undefined,
    });
  }
  return games;
}

export function searchGames(games: readonly Game[], query: string, system: SystemId): Game[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  return games.filter((game) => {
    if (system !== "all" && game.system !== system) return false;
    if (!normalizedQuery) return true;
    return [game.title, game.fileName, game.genre, game.region, game.system]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
  });
}
