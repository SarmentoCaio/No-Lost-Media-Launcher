import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidateSources = [
  process.env.NO_LOST_MEDIA_CATALOG_SOURCE,
  resolve(root, "..", "workspaces", "no-lost-media", "limpet", "src", "data", "games.json"),
  resolve(root, "..", "no-lost-media", "limpet", "src", "data", "games.json"),
  resolve(root, "..", "no-lost-media", "src", "data", "games.json"),
].filter(Boolean);

const source = candidateSources.find((candidate) => existsSync(candidate));
if (!source) {
  console.error("Arquivo de origem games.json não encontrado nas pastas candidatas.");
  process.exit(1);
}
console.log(`Usando catálogo de origem: ${source}`);

const output = resolve(root, "apps", "launcher", "public", "catalog", "no-lost-media.json");
const distOutput = resolve(root, "apps", "launcher", "dist", "catalog", "no-lost-media.json");
const gateway = (process.env.NO_LOST_MEDIA_ARCHIVE_GATEWAY
  ?? "https://api.nolost.media/api/stream").replace(/\/+$/, "");

const systemByPlatform = {
  PS1: "ps1",
  PS2: "ps2",
  PS3: "ps3",
  DC: "dreamcast",
  N64: "n64",
  SNES: "snes",
  NES: "nes",
  GBA: "gba",
  GC: "gamecube",
  Wii: "wii",
  PC: "pc",
  OUTROS: "pc",
};
const authenticatedPlatforms = new Set(["PS2", "PS3", "PC", "OUTROS"]);

function defaultCollection(game) {
  if (game.archiveCollection) return game.archiveCollection;
  const letter = (game.initialLetter || "#").toUpperCase();
  if (game.platform === "PS3") {
    return "ps3-redump-roms321com";
  }
  if (game.platform === "PC" || game.platform === "OUTROS") {
    return (letter >= "A" && letter <= "Z") ? `redump_pc_${letter}` : "pc_redump";
  }
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
  if (!collection) return undefined;
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
    sourceUrl: sourceUrl(game),
    fileName,
    checksum: game.sha1 || undefined,
  }];
});

await mkdir(dirname(output), { recursive: true });
const jsonContent = `${JSON.stringify({ generatedAt: new Date().toISOString(), games })}\n`;
await writeFile(output, jsonContent, "utf8");
try {
  await mkdir(dirname(distOutput), { recursive: true });
  await writeFile(distOutput, jsonContent, "utf8");
} catch {}
console.log(`Catálogo sincronizado: ${games.length} jogos em ${output}`);
