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
  year?: unknown;
  genre?: unknown;
  region?: unknown;
  coverUrl?: unknown;
  fileSize?: unknown;
  fileSizeBytes?: unknown;
  sha1?: unknown;
  sourceUrl?: unknown;
  fileName?: unknown;
}

export function normalizeCatalog(records: unknown): Game[] {
  if (!Array.isArray(records)) return [];
  const games: Game[] = [];
  for (const item of records as CatalogRecord[]) {
    if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.platform !== "string") continue;
    const system = platformMap[item.platform.toUpperCase()];
    if (!system) continue;
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
      checksum: typeof item.sha1 === "string" ? item.sha1 : undefined,
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
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
