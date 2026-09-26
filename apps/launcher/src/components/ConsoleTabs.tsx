import { Disc, Gamepad2, Layers, Monitor } from "lucide-react";
import type { SystemId } from "@nlm/core";

export interface ConsoleTabsProps {
  selectedSystem: SystemId;
  onSelectSystem: (system: SystemId) => void;
  systemCounts: Map<SystemId, number>;
}

interface TabDef {
  id: SystemId;
  label: string;
  shortLabel: string;
  icon: typeof Layers;
  accent: string;
  activeClass: string;
  badgeClass: string;
  extraBadge?: React.ReactNode;
}

const TOP_ROW_TABS: readonly TabDef[] = [
  {
    id: "all",
    label: "Todos os Jogos",
    shortLabel: "Todos",
    icon: Layers,
    accent: "#3b82f6",
    activeClass: "system-tab--all",
    badgeClass: "badge--all",
  },
  {
    id: "ps1",
    label: "PlayStation 1",
    shortLabel: "PS1",
    icon: Disc,
    accent: "#94a3b8",
    activeClass: "system-tab--ps1",
    badgeClass: "badge--ps1",
    extraBadge: (
      <span className="retro-badge retro-badge--ps1">
        <span className="text-red-500">P</span>
        <span className="text-blue-400">S</span>
        <span className="text-yellow-400">1</span>
      </span>
    ),
  },
  {
    id: "ps2",
    label: "PlayStation 2",
    shortLabel: "PS2",
    icon: Disc,
    accent: "#0070d1",
    activeClass: "system-tab--ps2",
    badgeClass: "badge--ps2",
    extraBadge: <span className="retro-badge retro-badge--ps2">2</span>,
  },
  {
    id: "ps3",
    label: "PlayStation 3",
    shortLabel: "PS3",
    icon: Disc,
    accent: "#38bdf8",
    activeClass: "system-tab--ps3",
    badgeClass: "badge--ps3",
    extraBadge: <span className="retro-badge retro-badge--ps3">3</span>,
  },
  {
    id: "dreamcast",
    label: "Sega Dreamcast",
    shortLabel: "Dreamcast",
    icon: Disc,
    accent: "#f97316",
    activeClass: "system-tab--dc",
    badgeClass: "badge--dc",
    extraBadge: (
      <span className="retro-badge retro-badge--dc">
        <span className="text-orange-400">128</span>
        <span className="text-amber-300">BIT</span>
      </span>
    ),
  },
  {
    id: "n64",
    label: "Nintendo 64",
    shortLabel: "N64",
    icon: Gamepad2,
    accent: "#10b981",
    activeClass: "system-tab--n64",
    badgeClass: "badge--n64",
    extraBadge: (
      <span className="retro-badge retro-badge--n64">
        <span className="text-red-400">6</span>
        <span className="text-yellow-300">4</span>
        <span className="text-blue-400">BIT</span>
      </span>
    ),
  },
  {
    id: "snes",
    label: "Super Nintendo",
    shortLabel: "SNES",
    icon: Gamepad2,
    accent: "#a855f7",
    activeClass: "system-tab--snes",
    badgeClass: "badge--snes",
    extraBadge: (
      <span className="retro-badge retro-badge--snes">
        <span className="text-red-400">16</span>
        <span className="text-purple-300">BIT</span>
      </span>
    ),
  },
];

const BOTTOM_ROW_TABS: readonly TabDef[] = [
  {
    id: "gba",
    label: "Game Boy Advance",
    shortLabel: "GBA",
    icon: Gamepad2,
    accent: "#6366f1",
    activeClass: "system-tab--gba",
    badgeClass: "badge--gba",
    extraBadge: (
      <span className="retro-badge retro-badge--gba">
        <span className="text-indigo-400">32</span>
        <span className="text-violet-300">BIT</span>
      </span>
    ),
  },
  {
    id: "nes",
    label: "Nintendo NES",
    shortLabel: "NES",
    icon: Gamepad2,
    accent: "#e11d48",
    activeClass: "system-tab--nes",
    badgeClass: "badge--nes",
    extraBadge: (
      <span className="retro-badge retro-badge--nes">
        <span className="text-red-400">8</span>
        <span className="text-rose-300">BIT</span>
      </span>
    ),
  },
  {
    id: "gamecube",
    label: "Nintendo GameCube",
    shortLabel: "GameCube",
    icon: Disc,
    accent: "#9333ea",
    activeClass: "system-tab--gc",
    badgeClass: "badge--gc",
    extraBadge: <span className="retro-badge retro-badge--gc">GC</span>,
  },
  {
    id: "wii",
    label: "Nintendo Wii",
    shortLabel: "Wii",
    icon: Disc,
    accent: "#06b6d4",
    activeClass: "system-tab--wii",
    badgeClass: "badge--wii",
    extraBadge: <span className="retro-badge retro-badge--wii">Wii</span>,
  },
  {
    id: "pc",
    label: "Jogos de PC",
    shortLabel: "PC",
    icon: Monitor,
    accent: "#14b8a6",
    activeClass: "system-tab--pc",
    badgeClass: "badge--pc",
    extraBadge: (
      <span className="retro-badge retro-badge--pc">
        <span className="text-teal-300">WIN</span>
        <span className="text-cyan-300">/DOS</span>
      </span>
    ),
  },
];

export function ConsoleTabs({
  selectedSystem,
  onSelectSystem,
  systemCounts,
}: ConsoleTabsProps) {
  const renderTab = (tab: TabDef) => {
    const isActive = selectedSystem === tab.id;
    const count = systemCounts.get(tab.id) ?? 0;
    const Icon = tab.icon;

    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => onSelectSystem(tab.id)}
        title={`${tab.label} (${count.toLocaleString("pt-BR")} títulos preservados)`}
        style={{ "--system-accent": tab.accent } as React.CSSProperties}
        className={`console-tab ${tab.activeClass} ${isActive ? "is-active" : ""}`}
      >
        <div className="console-tab__content">
          <Icon className="console-tab__icon" size={15} />
          <span className="console-tab__name">{tab.shortLabel}</span>
          {tab.extraBadge}
        </div>

        <span className={`console-tab__badge ${tab.badgeClass} ${isActive ? "is-active" : ""}`}>
          {count.toLocaleString("pt-BR")}
        </span>

        {isActive && <span className="console-tab__glow-bar" />}
      </button>
    );
  };

  return (
    <div className="console-tabs-section" aria-label="Menu de consoles No Lost Media">
      <div className="console-tabs-container">
        {/* Linha 1 (Superior): 7 Botões (Todos, PS1, PS2, PS3, Dreamcast, N64, SNES) */}
        <div className="console-tabs-row console-tabs-row--top">
          {TOP_ROW_TABS.map(renderTab)}
        </div>

        {/* Linha 2 (Inferior): 5 Botões Centralizados (GBA, NES, GC, Wii, PC) */}
        <div className="console-tabs-row console-tabs-row--bottom">
          {BOTTOM_ROW_TABS.map(renderTab)}
        </div>
      </div>
    </div>
  );
}
