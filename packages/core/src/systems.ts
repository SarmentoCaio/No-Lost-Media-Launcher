import type { SystemId } from "./models";

export interface SystemDefinition {
  id: SystemId;
  name: string;
  shortName: string;
  accent: string;
}

export const systems: readonly SystemDefinition[] = [
  { id: "all", name: "Todos os sistemas", shortName: "Todos", accent: "#79f2d0" },
  { id: "ps2", name: "PlayStation 2", shortName: "PS2", accent: "#6988ff" },
  { id: "ps1", name: "PlayStation", shortName: "PS1", accent: "#b8c0cf" },
  { id: "ps3", name: "PlayStation 3", shortName: "PS3", accent: "#55a4ff" },
  { id: "gamecube", name: "Nintendo GameCube", shortName: "GC", accent: "#8d71ff" },
  { id: "wii", name: "Nintendo Wii", shortName: "Wii", accent: "#55cfff" },
  { id: "n64", name: "Nintendo 64", shortName: "N64", accent: "#5de09e" },
  { id: "snes", name: "Super Nintendo", shortName: "SNES", accent: "#c392ff" },
  { id: "nes", name: "Nintendo NES", shortName: "NES", accent: "#e75d5d" },
  { id: "gba", name: "Game Boy Advance", shortName: "GBA", accent: "#8678ff" },
  { id: "dreamcast", name: "Dreamcast", shortName: "DC", accent: "#ff9254" },
  { id: "pc", name: "Computador", shortName: "PC", accent: "#ffcf5d" },
];

export function getSystem(id: SystemId): SystemDefinition {
  return systems.find((system) => system.id === id) ?? systems[0];
}
