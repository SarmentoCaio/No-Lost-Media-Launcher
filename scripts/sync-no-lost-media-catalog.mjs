import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.env.NO_LOST_MEDIA_CATALOG_SOURCE
  ?? resolve(root, "..", "no-lost-media", "src", "data", "games.json");
const output = resolve(root, "apps", "launcher", "public", "catalog", "no-lost-media.json");
const gateway = (process.env.NO_LOST_MEDIA_ARCHIVE_GATEWAY
  ?? "https://no-lost-media-bff.onrender.com/api/stream").replace(/\/+$/, "");

const systemByPlatform = {
  PS1: "ps1",
  PS2: "ps2",
  DC: "dreamcast",
  N64: "n64",
  SNES: "snes",
  NES: "nes",
  GBA: "gba",
  GC: "gamecube",
  Wii: "wii",
};
const authenticatedPlatforms = new Set(["PS2"]);

function defaultCollection(game) {
  if (game.archiveCollection) return game.archiveCollection;
  const letter = (game.initialLetter || "#").toUpperCase();
  if (game.platform === "PS1") {
    if (letter === "#" || letter <= "E") return "ef_Sony_PlayStation1_Redump_Collection_1of4";
    if (letter <= "M") return "ef_Sony_PlayStation1_Redump_Collection_2of4";
    if (letter <= "R") return "ef_Sony_PlayStation1_Redump_Collection_3of4";
    return "ef_Sony_PlayStation1_Redump_Collection_4of4";
  }
  return {
    DC: "sega-dreamcast-roms",
    GC: "zoocube",
    Wii: "Wii_ISO",
    NES: "roms_nes",
    GBA: "roms-bestset-nintendo-game-boy-advance",
    N64: "roms-bestset-nintendo-64",
    SNES: "super-nintendo-snes-rom-collection-usa",
    PS2: letter === "#" || letter <= "M" ? "RedumpSonyPS2NTSCU" : "RedumpSonyPS2NTSCUPart2",
  }[game.platform];
}

function sourceUrl(game) {
  const collection = defaultCollection(game);
  const encodedPath = game.rawFileName.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const base = authenticatedPlatforms.has(game.platform)
    ? gateway
    : "https://archive.org/download";
  return `${base}/${encodeURIComponent(collection)}/${encodedPath}`;
}

const sourceGames = JSON.parse(await readFile(source, "utf8"));
const games = sourceGames.flatMap((game) => {
  const system = systemByPlatform[game.platform];
  if (!system || !game.rawFileName || !game.id || !game.title) return [];
  const fileName = game.rawFileName.split("/").filter(Boolean).at(-1);
  const downloadable = !fileName.toLowerCase().endsWith(".rar");
  return [{
    id: game.id,
    title: game.title,
    system,
    year: game.year,
    genre: game.genre,
    region: game.region,
    coverUrl: game.coverUrl,
    fileSizeBytes: game.fileSizeBytes,
    fileSizeLabel: game.fileSize,
    sourceUrl: downloadable ? sourceUrl(game) : undefined,
    fileName,
    checksum: game.sha1 || undefined,
  }];
});

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), games })}\n`, "utf8");
console.log(`Catálogo sincronizado: ${games.length} jogos em ${output}`);
