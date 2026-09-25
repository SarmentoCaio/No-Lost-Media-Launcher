import type { EmulatorControllerSettings } from "@nlm/core";

export type ControllerLayout = EmulatorControllerSettings["layout"];

type Hotspot = { action: string; label: string; x: number; y: number; size?: "small" | "wide" | "stick" };
type LayoutDefinition = {
  name: string;
  image: string;
  aspect: number;
  brand: { x: number; y: number; tone: "light" | "dark" | "purple"; width?: number };
  additionalBrands?: Array<{ x: number; y: number; tone: "light" | "dark" | "purple"; width?: number }>;
  hotspots: Hotspot[];
};

const dpad = (x: number, y: number, step = 5): Hotspot[] => [
  { action: "dpadUp", label: "↑", x, y: y - step, size: "small" },
  { action: "dpadDown", label: "↓", x, y: y + step, size: "small" },
  { action: "dpadLeft", label: "←", x: x - step, y, size: "small" },
  { action: "dpadRight", label: "→", x: x + step, y, size: "small" },
];

const stick = (prefix: "left" | "right", x: number, y: number, step = 3.5): Hotspot[] => [
  { action: `${prefix}StickUp`, label: "↑", x, y: y - step, size: "small" },
  { action: `${prefix}StickDown`, label: "↓", x, y: y + step, size: "small" },
  { action: `${prefix}StickLeft`, label: "←", x: x - step, y, size: "small" },
  { action: `${prefix}StickRight`, label: "→", x: x + step, y, size: "small" },
  { action: prefix === "left" ? "l3" : "r3", label: prefix === "left" ? "L3" : "R3", x, y, size: "stick" },
];

export const controllerLayouts: Record<ControllerLayout, LayoutDefinition> = {
  ps1: {
    name: "PlayStation 1", image: "/controllers/ps1.png", aspect: 1,
    brand: { x: 50, y: 42, tone: "light", width: 20 },
    hotspots: [
      ...dpad(24, 46, 5),
      { action: "faceNorth", label: "△", x: 76, y: 39 }, { action: "faceSouth", label: "×", x: 77, y: 53 },
      { action: "faceWest", label: "□", x: 69, y: 46 }, { action: "faceEast", label: "○", x: 84, y: 46 },
      { action: "select", label: "Select", x: 43, y: 46, size: "wide" }, { action: "start", label: "Start", x: 59, y: 46, size: "wide" },
      { action: "touchpad", label: "Analog", x: 51, y: 54, size: "wide" },
      { action: "l1", label: "L1", x: 28, y: 32, size: "wide" }, { action: "r1", label: "R1", x: 75, y: 32, size: "wide" },
      { action: "l2", label: "L2", x: 23, y: 29, size: "wide" }, { action: "r2", label: "R2", x: 81, y: 29, size: "wide" },
      ...stick("left", 37, 59), ...stick("right", 64, 59),
    ],
  },
  ps2: {
    name: "PlayStation 2", image: "/controllers/ps2.jpg", aspect: 1.246,
    brand: { x: 55, y: 22, tone: "dark", width: 22 },
    hotspots: [
      ...dpad(27, 21, 5),
      { action: "faceNorth", label: "△", x: 82, y: 25 }, { action: "faceSouth", label: "×", x: 76, y: 42 },
      { action: "faceWest", label: "□", x: 72, y: 30 }, { action: "faceEast", label: "○", x: 87, y: 35 },
      { action: "select", label: "Select", x: 48, y: 28, size: "wide" }, { action: "start", label: "Start", x: 63, y: 33, size: "wide" },
      { action: "l1", label: "L1", x: 35, y: 8, size: "wide" }, { action: "r1", label: "R1", x: 84, y: 12, size: "wide" },
      { action: "l2", label: "L2", x: 30, y: 6, size: "wide" }, { action: "r2", label: "R2", x: 90, y: 10, size: "wide" },
      ...stick("left", 38, 39), ...stick("right", 63, 44),
      { action: "touchpad", label: "Analog", x: 54, y: 36, size: "wide" },
    ],
  },
  gba: {
    name: "Game Boy Advance", image: "/controllers/gba.png", aspect: 1.5,
    brand: { x: 49, y: 48, tone: "purple", width: 28 },
    additionalBrands: [{ x: 50, y: 7, tone: "purple", width: 19 }],
    hotspots: [
      ...dpad(15, 46, 5),
      { action: "faceSouth", label: "B", x: 78, y: 42 }, { action: "faceEast", label: "A", x: 87, y: 36 },
      { action: "select", label: "Select", x: 21, y: 65, size: "wide" }, { action: "start", label: "Start", x: 21, y: 73, size: "wide" },
      { action: "l1", label: "L", x: 9, y: 19, size: "wide" }, { action: "r1", label: "R", x: 91, y: 19, size: "wide" },
    ],
  },
  nes: {
    name: "Nintendo Entertainment System", image: "/controllers/nes.jpg", aspect: 1.377,
    brand: { x: 74, y: 49, tone: "light", width: 23 },
    hotspots: [
      ...dpad(26, 33, 6),
      { action: "select", label: "Select", x: 41, y: 48, size: "wide" }, { action: "start", label: "Start", x: 52, y: 53, size: "wide" },
      { action: "faceWest", label: "B", x: 66, y: 56 }, { action: "faceSouth", label: "A", x: 77, y: 61 },
    ],
  },
  snes: {
    name: "Super Nintendo", image: "/controllers/snes.jpg", aspect: 1.519,
    brand: { x: 51, y: 20, tone: "light", width: 28 },
    hotspots: [
      ...dpad(25, 34, 6),
      { action: "select", label: "Select", x: 40, y: 43, size: "wide" }, { action: "start", label: "Start", x: 53, y: 47, size: "wide" },
      { action: "faceWest", label: "Y", x: 69, y: 44 }, { action: "faceNorth", label: "X", x: 80, y: 38 },
      { action: "faceSouth", label: "B", x: 75, y: 55 }, { action: "faceEast", label: "A", x: 86, y: 50 },
      { action: "l1", label: "L", x: 24, y: 15, size: "wide" }, { action: "r1", label: "R", x: 80, y: 15, size: "wide" },
    ],
  },
  n64: {
    name: "Nintendo 64", image: "/controllers/n64.jpg", aspect: 1.254,
    brand: { x: 58, y: 12, tone: "light", width: 20 },
    hotspots: [
      ...dpad(30, 19, 5), ...stick("left", 47, 45, 4),
      { action: "start", label: "Start", x: 55, y: 25, size: "wide" },
      { action: "faceWest", label: "B", x: 70, y: 31 }, { action: "faceSouth", label: "A", x: 74, y: 40 },
      { action: "rightStickUp", label: "C↑", x: 87, y: 25 }, { action: "rightStickDown", label: "C↓", x: 84, y: 35 },
      { action: "rightStickLeft", label: "C←", x: 80, y: 27 }, { action: "rightStickRight", label: "C→", x: 91, y: 31 },
      { action: "l1", label: "L", x: 22, y: 11, size: "wide" }, { action: "r1", label: "R", x: 91, y: 13, size: "wide" },
      { action: "l2", label: "Z", x: 50, y: 60, size: "wide" },
    ],
  },
  dreamcast: {
    name: "Dreamcast", image: "/controllers/dreamcast.jpg", aspect: .954,
    brand: { x: 63, y: 11, tone: "light", width: 25 },
    hotspots: [
      ...dpad(27, 35, 5), ...stick("left", 28, 15, 3),
      { action: "faceNorth", label: "Y", x: 80, y: 31 }, { action: "faceSouth", label: "A", x: 75, y: 43 },
      { action: "faceWest", label: "X", x: 68, y: 35 }, { action: "faceEast", label: "B", x: 86, y: 39 },
      { action: "start", label: "Start", x: 48, y: 55, size: "wide" },
      { action: "l2", label: "L", x: 18, y: 10, size: "wide" }, { action: "r2", label: "R", x: 88, y: 13, size: "wide" },
    ],
  },
  gamecube: {
    name: "GameCube", image: "/controllers/gamecube.jpg", aspect: 1.221,
    brand: { x: 63, y: 12, tone: "light", width: 27 },
    hotspots: [
      ...dpad(36, 31, 4), ...stick("left", 34, 11, 3), ...stick("right", 58, 45, 3),
      { action: "faceNorth", label: "Y", x: 80, y: 19 }, { action: "faceSouth", label: "A", x: 77, y: 29 },
      { action: "faceWest", label: "B", x: 68, y: 31 }, { action: "faceEast", label: "X", x: 88, y: 30 },
      { action: "start", label: "Start", x: 58, y: 25, size: "wide" },
      { action: "l1", label: "L", x: 24, y: 9, size: "wide" }, { action: "r1", label: "R", x: 91, y: 14, size: "wide" },
      { action: "r2", label: "Z", x: 96, y: 22, size: "wide" },
    ],
  },
  wii: {
    name: "Wii Remote + Nunchuk", image: "/controllers/wii.jpg", aspect: 1.088,
    brand: { x: 70, y: 65, tone: "light", width: 18 },
    hotspots: [
      ...dpad(78, 20, 4), ...stick("left", 40, 10, 3),
      { action: "faceSouth", label: "A", x: 76, y: 30 }, { action: "faceEast", label: "B", x: 87, y: 30 },
      { action: "select", label: "−", x: 69, y: 38 }, { action: "start", label: "+", x: 83, y: 39 },
      { action: "touchpad", label: "Home", x: 76, y: 39, size: "wide" },
      { action: "faceWest", label: "1", x: 72, y: 53 }, { action: "faceNorth", label: "2", x: 70, y: 59 },
      { action: "l2", label: "C", x: 48, y: 20, size: "wide" }, { action: "r2", label: "Z", x: 49, y: 25, size: "wide" },
    ],
  },
};

export const layoutsByEmulator: Record<string, ControllerLayout[]> = {
  pcsx2: ["ps2"],
  duckstation: ["ps1"],
  dolphin: ["gamecube", "wii"],
  retroarch: ["nes", "snes", "gba", "n64", "dreamcast"],
};

interface ControllerPhotoMapperProps {
  layout: ControllerLayout;
  bindings: Record<string, string>;
  capturingAction: string | null;
  onMap: (action: string) => void;
}

export function ControllerPhotoMapper({ layout, bindings, capturingAction, onMap }: ControllerPhotoMapperProps) {
  const definition = controllerLayouts[layout];
  return (
    <div className={`controller-photo controller-photo--${layout}`}>
      <div className="controller-photo__stage" style={{ aspectRatio: definition.aspect }}>
        <img src={definition.image} alt={`Controle ${definition.name}`} draggable={false} />
        {[definition.brand, ...(definition.additionalBrands ?? [])].map((brand, index) => <span key={index} className={`controller-photo__brand controller-photo__brand--${brand.tone}`} style={{ left: `${brand.x}%`, top: `${brand.y}%`, width: `${brand.width ?? 22}%` }}>NO LOST MEDIA</span>)}
        {definition.hotspots.map((hotspot) => {
          const mapped = Boolean(bindings[hotspot.action]);
          const listening = capturingAction === hotspot.action;
          return <button
            type="button"
            key={`${layout}-${hotspot.action}`}
            className={`controller-hotspot controller-hotspot--${hotspot.size ?? "normal"}${mapped ? " is-mapped" : ""}${listening ? " is-listening" : ""}`}
            style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
            title={`${hotspot.label}: ${mapped ? "mapeado" : "clique para mapear"}`}
            aria-label={`Mapear ${hotspot.label}`}
            onClick={() => onMap(hotspot.action)}
          ><span>{listening ? "…" : hotspot.label}</span></button>;
        })}
      </div>
      <p><span className="controller-photo__legend is-mapped" /> Mapeado <span className="controller-photo__legend" /> Não definido</p>
    </div>
  );
}
