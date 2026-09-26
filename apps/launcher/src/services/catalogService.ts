import { normalizeCatalog, type Game } from "@nlm/core";
import { demoCatalog } from "../data/demoCatalog";

export interface CatalogResult {
  games: Game[];
  source: "remote" | "bundled" | "demo";
  message?: string;
}

async function loadBundledCatalog(): Promise<Game[]> {
  try {
    const response = await fetch("./catalog/no-lost-media.json");
    if (!response.ok) return [];
    const payload = await response.json();
    return normalizeCatalog(payload);
  } catch {
    return [];
  }
}

export async function loadCatalog(): Promise<CatalogResult> {
  const endpoint = import.meta.env.VITE_CATALOG_ENDPOINT?.trim();
  const bundledCatalog = await loadBundledCatalog();
  if (!endpoint) {
    return bundledCatalog.length > 0
      ? { games: bundledCatalog, source: "bundled" }
      : { games: demoCatalog, source: "demo", message: "O acervo incluído não pôde ser carregado." };
  }

  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const games = normalizeCatalog(await response.json());
    if (games.length === 0) throw new Error("O endpoint não retornou jogos compatíveis.");
    return { games, source: "remote" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "falha desconhecida";
    return {
      games: bundledCatalog.length > 0 ? bundledCatalog : demoCatalog,
      source: bundledCatalog.length > 0 ? "bundled" : "demo",
      message: `Atualização online indisponível (${detail}). Exibindo o acervo incluído no aplicativo.`,
    };
  }
}
