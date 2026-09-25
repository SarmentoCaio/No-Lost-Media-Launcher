import { useEffect, useState } from "react";
import { Gamepad2, Gauge, Keyboard, Monitor, Save, Volume2, X } from "lucide-react";
import type { EmulatorSettings } from "@nlm/core";
import { ControllerPhotoMapper, controllerLayouts, layoutsByEmulator } from "./ControllerPhotoMapper";

type SettingsTab = "video" | "audio" | "controller" | "emulation" | "hotkeys";

interface EmulatorSettingsDialogProps {
  emulatorName: string;
  settings: EmulatorSettings;
  onChange: (settings: EmulatorSettings) => void;
  onClose: () => void;
  onSave: () => void;
}

const controlActions = [
  ["dpadUp", "Direcional cima"], ["dpadDown", "Direcional baixo"], ["dpadLeft", "Direcional esquerda"], ["dpadRight", "Direcional direita"],
  ["faceSouth", "Botão inferior / X / A"], ["faceEast", "Botão direito / ○ / B"], ["faceWest", "Botão esquerdo / □ / X"], ["faceNorth", "Botão superior / △ / Y"],
  ["select", "Select / Criar"], ["start", "Start / Opções"], ["l1", "L1 / LB"], ["r1", "R1 / RB"], ["l2", "L2 / LT"], ["r2", "R2 / RT"], ["l3", "L3"], ["r3", "R3"],
  ["leftStickUp", "Analógico E: cima"], ["leftStickDown", "Analógico E: baixo"], ["leftStickLeft", "Analógico E: esquerda"], ["leftStickRight", "Analógico E: direita"],
  ["rightStickUp", "Analógico D: cima"], ["rightStickDown", "Analógico D: baixo"], ["rightStickLeft", "Analógico D: esquerda"], ["rightStickRight", "Analógico D: direita"],
  ["touchpad", "Touchpad / clique central"],
] as const;

const hotkeyActions = [
  ["pause", "Pausar / continuar"], ["fastForward", "Avanço rápido"], ["saveState", "Salvar estado"], ["loadState", "Carregar estado"],
  ["nextSlot", "Próximo slot"], ["screenshot", "Captura de tela"], ["fullscreen", "Alternar tela cheia"], ["menu", "Menu do emulador"],
] as const;

function inputLabel(binding?: string): string {
  if (!binding) return "Não definido";
  const parts = binding.split(":");
  if (parts[0] === "keyboard") return parts[1]?.replace(/^Key/, "") ?? "Tecla";
  if (parts[2] === "button") return `Controle ${Number(parts[1]) + 1} • botão ${parts[3]}`;
  if (parts[2] === "axis") return `Controle ${Number(parts[1]) + 1} • eixo ${parts[3]} ${parts[4] === "+" ? "+" : "−"}`;
  return binding;
}

export function EmulatorSettingsDialog({ emulatorName, settings, onChange, onClose, onSave }: EmulatorSettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("video");
  const [capturing, setCapturing] = useState<{ group: "bindings" | "hotkeys"; action: string } | null>(null);
  const availableLayouts = layoutsByEmulator[settings.emulatorId] ?? ["ps2"];
  const activeLayout = availableLayouts.includes(settings.controller.layout) ? settings.controller.layout : availableLayouts[0];
  const controlNames = new Map<string, string>(controlActions);
  const visualActions = Array.from(new Set(controllerLayouts[activeLayout].hotspots.map((item) => item.action)))
    .map((action) => [action, controlNames.get(action) ?? controllerLayouts[activeLayout].hotspots.find((item) => item.action === action)?.label ?? action] as const);

  const patch = <K extends Exclude<keyof EmulatorSettings, "emulatorId">>(group: K, values: Partial<EmulatorSettings[K]>) => {
    onChange({ ...settings, [group]: { ...(settings[group] as object), ...values } });
  };

  useEffect(() => {
    if (!capturing) return;
    const complete = (value: string) => {
      const source = capturing.group === "bindings" ? settings.controller.bindings : settings.hotkeys;
      if (capturing.group === "bindings") patch("controller", { bindings: { ...source, [capturing.action]: value } });
      else patch("hotkeys", { ...source, [capturing.action]: value });
      setCapturing(null);
    };
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.key === "Escape") setCapturing(null);
      else complete(`keyboard:${event.code}`);
    };
    window.addEventListener("keydown", keydown, true);
    let frame = 0;
    let active = true;
    const poll = () => {
      if (!active) return;
      for (const gamepad of navigator.getGamepads?.() ?? []) {
        if (!gamepad) continue;
        const button = gamepad.buttons.findIndex((item) => item.pressed && item.value > .6);
        if (button >= 0) {
          complete(`gamepad:${gamepad.index}:button:${button}`);
          return;
        }
        const axis = gamepad.axes.findIndex((value) => Math.abs(value) > .7);
        if (axis >= 0) {
          complete(`gamepad:${gamepad.index}:axis:${axis}:${gamepad.axes[axis] > 0 ? "+" : "-"}`);
          return;
        }
      }
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const bindingGrid = (group: "bindings" | "hotkeys", actions: ReadonlyArray<readonly [string, string]>) => {
    const values = group === "bindings" ? settings.controller.bindings : settings.hotkeys;
    return <div className="mapping-grid">{actions.map(([action, label]) => (
      <div className={`mapping-row ${capturing?.group === group && capturing.action === action ? "is-capturing" : ""}`} key={action}>
        <span><strong>{label}</strong><small>{inputLabel(values[action])}</small></span>
        <button type="button" onClick={() => setCapturing({ group, action })}>{capturing?.group === group && capturing.action === action ? "Pressione uma entrada…" : "Mapear"}</button>
        {values[action] && <button type="button" className="mapping-clear" aria-label={`Limpar ${label}`} onClick={() => {
          const next = { ...values }; delete next[action];
          if (group === "bindings") patch("controller", { bindings: next }); else onChange({ ...settings, hotkeys: next });
        }}><X size={13} /></button>}
      </div>
    ))}</div>;
  };

  return (
    <div className="emulator-settings-layer" role="dialog" aria-modal="true" aria-labelledby="emulator-settings-title">
      <div className="emulator-settings-dialog">
        <header><div><span className="eyebrow">Configuração nativa</span><h2 id="emulator-settings-title">{emulatorName}</h2><p>Estas opções são gravadas diretamente nos arquivos do emulador.</p></div><button className="dialog-close" type="button" onClick={onClose} aria-label="Fechar"><X /></button></header>
        <nav className="settings-tabs">
          <button className={tab === "video" ? "is-active" : ""} onClick={() => setTab("video")}><Monitor /> Vídeo</button>
          <button className={tab === "audio" ? "is-active" : ""} onClick={() => setTab("audio")}><Volume2 /> Áudio</button>
          <button className={tab === "controller" ? "is-active" : ""} onClick={() => setTab("controller")}><Gamepad2 /> Controles</button>
          <button className={tab === "emulation" ? "is-active" : ""} onClick={() => setTab("emulation")}><Gauge /> Emulação</button>
          <button className={tab === "hotkeys" ? "is-active" : ""} onClick={() => setTab("hotkeys")}><Keyboard /> Atalhos</button>
        </nav>
        <div className="emulator-settings-content">
          {tab === "video" && <div className="native-settings-grid">
            <label><span>Renderizador</span><select value={settings.video.renderer} onChange={(event) => patch("video", { renderer: event.target.value as EmulatorSettings["video"]["renderer"] })}><option value="auto">Automático</option><option value="vulkan">Vulkan</option><option value="d3d11">Direct3D 11</option><option value="d3d12">Direct3D 12</option><option value="opengl">OpenGL</option><option value="software">Software</option></select></label>
            <label><span>Resolução interna</span><select value={settings.video.internalResolution} onChange={(event) => patch("video", { internalResolution: Number(event.target.value) })}>{[1,2,3,4,5,6,8].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>
            <label><span>Proporção</span><select value={settings.video.aspectRatio} onChange={(event) => patch("video", { aspectRatio: event.target.value as EmulatorSettings["video"]["aspectRatio"] })}><option value="auto">Automática</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="stretch">Esticar</option></select></label>
            <label><span>Antisserrilhamento</span><select value={settings.video.antiAliasing} onChange={(event) => patch("video", { antiAliasing: event.target.value as EmulatorSettings["video"]["antiAliasing"] })}><option value="off">Desativado</option><option value="fxaa">FXAA</option><option value="msaa2">MSAA 2x</option><option value="msaa4">MSAA 4x</option><option value="msaa8">MSAA 8x</option></select></label>
            <label><span>Filtragem de textura</span><select value={settings.video.textureFiltering} onChange={(event) => patch("video", { textureFiltering: event.target.value as EmulatorSettings["video"]["textureFiltering"] })}><option value="nearest">Nítida / original</option><option value="bilinear">Bilinear</option><option value="trilinear">Trilinear</option></select></label>
            <label><span>Filtro anisotrópico</span><select value={settings.video.anisotropicFiltering} onChange={(event) => patch("video", { anisotropicFiltering: Number(event.target.value) })}>{[1,2,4,8,16].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>
            <label><span>Velocidade normal</span><input type="number" min="25" max="300" value={settings.video.speedPercent} onChange={(event) => patch("video", { speedPercent: Number(event.target.value) })} /><small>% da velocidade original</small></label>
            <label><span>Pular quadros</span><input type="number" min="0" max="5" value={settings.video.frameSkip} onChange={(event) => patch("video", { frameSkip: Number(event.target.value) })} /></label>
            <label className="switch-row"><span><strong>VSync</strong><small>Sincroniza a imagem com o monitor.</small></span><input type="checkbox" checked={settings.video.vsync} onChange={(event) => patch("video", { vsync: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Patches widescreen</strong><small>Força suporte 16:9 quando disponível.</small></span><input type="checkbox" checked={settings.video.widescreenPatches} onChange={(event) => patch("video", { widescreenPatches: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Escala inteira</strong><small>Evita pixels irregulares em jogos 2D.</small></span><input type="checkbox" checked={settings.video.integerScaling} onChange={(event) => patch("video", { integerScaling: event.target.checked })} /></label>
          </div>}
          {tab === "audio" && <div className="native-settings-grid">
            <label><span>Backend de áudio</span><select value={settings.audio.backend} onChange={(event) => patch("audio", { backend: event.target.value as EmulatorSettings["audio"]["backend"] })}><option value="auto">Automático</option><option value="cubeb">Cubeb</option><option value="xaudio2">XAudio2</option><option value="wasapi">WASAPI</option><option value="sdl">SDL</option></select></label>
            <label><span>Volume</span><input type="range" min="0" max="100" value={settings.audio.volume} onChange={(event) => patch("audio", { volume: Number(event.target.value) })} /><small>{settings.audio.volume}%</small></label>
            <label><span>Latência</span><input type="range" min="16" max="256" step="8" value={settings.audio.latencyMs} onChange={(event) => patch("audio", { latencyMs: Number(event.target.value) })} /><small>{settings.audio.latencyMs} ms</small></label>
            <label className="switch-row"><span><strong>Sincronizar áudio</strong><small>Evita estalos quando o jogo oscila.</small></span><input type="checkbox" checked={settings.audio.sync} onChange={(event) => patch("audio", { sync: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Silenciar</strong><small>Desativa a saída do emulador.</small></span><input type="checkbox" checked={settings.audio.muted} onChange={(event) => patch("audio", { muted: event.target.checked })} /></label>
          </div>}
          {tab === "controller" && <>
            <div className="controller-layout-bar">
              <label><span>Controle do console</span><select value={activeLayout} onChange={(event) => patch("controller", { layout: event.target.value as EmulatorSettings["controller"]["layout"] })}>{availableLayouts.map((layout) => <option key={layout} value={layout}>{controllerLayouts[layout].name}</option>)}</select></label>
              <span>Clique diretamente nos botões da imagem para mapear.</span>
            </div>
            <ControllerPhotoMapper layout={activeLayout} bindings={settings.controller.bindings} capturingAction={capturing?.group === "bindings" ? capturing.action : null} onMap={(action) => setCapturing({ group: "bindings", action })} />
            <div className="controller-options native-settings-grid"><label><span>Dispositivo</span><select value={settings.controller.device} onChange={(event) => patch("controller", { device: event.target.value as EmulatorSettings["controller"]["device"] })}><option value="auto">Detectar automaticamente</option><option value="gamepad">Controle</option><option value="keyboard">Teclado</option></select></label><label><span>Zona morta</span><input type="range" min="0" max="50" value={settings.controller.deadzone} onChange={(event) => patch("controller", { deadzone: Number(event.target.value) })} /><small>{settings.controller.deadzone}%</small></label><label><span>Sensibilidade</span><input type="range" min="50" max="200" value={settings.controller.sensitivity} onChange={(event) => patch("controller", { sensitivity: Number(event.target.value) })} /><small>{settings.controller.sensitivity}%</small></label><label className="switch-row"><span><strong>Vibração</strong><small>Usa os motores do controle.</small></span><input type="checkbox" checked={settings.controller.rumble} onChange={(event) => patch("controller", { rumble: event.target.checked })} /></label></div>
            <div className="mapping-help"><Gamepad2 /><span><strong>Mapeamento completo</strong><small>Clique em Mapear e pressione uma tecla, botão, touchpad ou mova o analógico na direção desejada. Esc cancela.</small></span></div>
            {bindingGrid("bindings", visualActions)}
          </>}
          {tab === "emulation" && <div className="native-settings-grid">
            <label className="switch-row"><span><strong>Pausar sem foco</strong><small>Pausa ao trocar de janela.</small></span><input type="checkbox" checked={settings.emulation.pauseWhenInactive} onChange={(event) => patch("emulation", { pauseWhenInactive: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Save automático</strong><small>Salva ao fechar e restaura ao abrir.</small></span><input type="checkbox" checked={settings.emulation.autoSave} onChange={(event) => patch("emulation", { autoSave: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Rebobinar</strong><small>Permite voltar alguns segundos.</small></span><input type="checkbox" checked={settings.emulation.rewind} onChange={(event) => patch("emulation", { rewind: event.target.checked })} /></label>
            <label className="switch-row"><span><strong>Cheats</strong><small>Habilita os códigos do próprio emulador.</small></span><input type="checkbox" checked={settings.emulation.cheats} onChange={(event) => patch("emulation", { cheats: event.target.checked })} /></label>
            <label><span>Velocidade do avanço rápido</span><select value={settings.emulation.fastForwardMultiplier} onChange={(event) => patch("emulation", { fastForwardMultiplier: Number(event.target.value) })}>{[2,3,4,5,6,8,10].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>
          </div>}
          {tab === "hotkeys" && <><div className="mapping-help"><Keyboard /><span><strong>Atalhos do emulador</strong><small>Podem ser associados ao teclado ou a qualquer botão do controle.</small></span></div>{bindingGrid("hotkeys", hotkeyActions)}</>}
        </div>
        <footer><span>Algumas opções só entram em vigor ao abrir o próximo jogo.</span><div><button className="dialog-secondary-action" type="button" onClick={onClose}>Cancelar</button><button className="primary-action" type="button" onClick={onSave}><Save size={16} /> Salvar no emulador</button></div></footer>
      </div>
    </div>
  );
}
