import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
  Download,
  X,
} from "lucide-react";
import type { PlatformRuntime, BiosImportedItem } from "@nlm/core";
import { openExternalUrl } from "../services/updateService";

interface BiosConsoleOption {
  id: "ps1" | "ps2" | "dreamcast" | "ps3";
  name: string;
  shortName: string;
  expectedFile: string;
  url: string;
}

const BIOS_OPTIONS: BiosConsoleOption[] = [
  {
    id: "ps1",
    name: "PlayStation 1",
    shortName: "PS1",
    expectedFile: "PS1_BIOS.zip",
    url: "https://archive.org/download/retro_arch_bios_megapack/RetroArch%20Bios%20Mega%20Pack/",
  },
  {
    id: "ps2",
    name: "PlayStation 2",
    shortName: "PS2",
    expectedFile: "PS2_BIOS.zip",
    url: "https://archive.org/download/retro_arch_bios_megapack/RetroArch%20Bios%20Mega%20Pack/",
  },
  {
    id: "dreamcast",
    name: "Sega Dreamcast",
    shortName: "Dreamcast",
    expectedFile: "Dreamcast.zip",
    url: "https://archive.org/download/retro_arch_bios_megapack/RetroArch%20Bios%20Mega%20Pack/",
  },
  {
    id: "ps3",
    name: "PlayStation 3 (RPCS3)",
    shortName: "PS3",
    expectedFile: "PS3UPDAT.PUP",
    url: "https://archive.org/download/ps3-official-firmwares/Firmware%204.91/",
  },
];

interface BiosAssistantModalProps {
  runtime: PlatformRuntime;
  onClose: () => void;
  onSuccessNotification?: (message: string) => void;
}

export function BiosAssistantModal({ runtime, onClose, onSuccessNotification }: BiosAssistantModalProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [isImportingManual, setIsImportingManual] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importedItems, setImportedItems] = useState<BiosImportedItem[]>([]);
  const [configuredSystems, setConfiguredSystems] = useState<Record<string, boolean>>({});
  const [isCheckingDisk, setIsCheckingDisk] = useState(true);

  const refreshStatusesFromDisk = useCallback(async () => {
    setIsCheckingDisk(true);
    const statuses: Record<string, boolean> = {};
    for (const consoleOption of BIOS_OPTIONS) {
      try {
        const isInstalled = runtime.checkBiosExists
          ? await runtime.checkBiosExists(consoleOption.id)
          : await runtime.checkBiosInstalled(consoleOption.id);
        statuses[consoleOption.id] = isInstalled;
      } catch {
        statuses[consoleOption.id] = false;
      }
    }
    setConfiguredSystems(statuses);
    setIsCheckingDisk(false);
  }, [runtime]);

  useEffect(() => {
    void refreshStatusesFromDisk();
  }, [refreshStatusesFromDisk]);

  const handleOpenLink = (url: string) => {
    void openExternalUrl(url);
  };

  const handleAutoScan = async () => {
    setIsScanning(true);
    setErrorMessage(null);
    try {
      const result = await runtime.scanAndImportBios();
      if (result.found) {
        setImportedItems((prev) => {
          const combined = [...prev];
          for (const item of result.imported) {
            if (!combined.some((c) => c.system === item.system)) {
              combined.push(item);
            }
          }
          return combined;
        });
        await refreshStatusesFromDisk();
        if (onSuccessNotification) {
          onSuccessNotification(result.message);
        }
      } else {
        setErrorMessage("Não foi possível localizar os arquivos na sua pasta de Downloads. Por favor, importe-os manualmente.");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Erro ao verificar a pasta de Downloads: ${msg}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualImport = async () => {
    setIsImportingManual(true);
    setErrorMessage(null);
    try {
      const result = await runtime.importBiosZip();
      if (result.success && result.item) {
        setImportedItems((prev) => {
          const combined = [...prev.filter((i) => i.system !== result.item!.system), result.item!];
          return combined;
        });
        await refreshStatusesFromDisk();
        if (onSuccessNotification) {
          onSuccessNotification(result.message);
        }
      } else if (!result.success && result.message !== "Nenhum arquivo selecionado.") {
        setErrorMessage(result.message);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Erro na importação manual: ${msg}`);
    } finally {
      setIsImportingManual(false);
    }
  };

  const hasImportedAny = importedItems.length > 0;

  return (
    <div
      className="modal-layer bios-assistant-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bios-assistant-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isScanning && !isImportingManual) {
          onClose();
        }
      }}
    >
      <div className="bios-assistant-dialog bios-assistant-dialog--simplified">
        <button
          className="dialog-close"
          type="button"
          onClick={onClose}
          disabled={isScanning || isImportingManual}
          aria-label="Fechar"
        >
          <X size={18} />
        </button>

        <header className="bios-assistant__header">
          <div className="bios-assistant__icon-wrapper">
            <Archive className="bios-assistant__icon" size={24} />
          </div>
          <div>
            <span className="eyebrow">
              <Sparkles size={12} /> Configuração do Sistema
            </span>
            <h2 id="bios-assistant-title">Assistente de Configuração de BIOS</h2>
            <p className="bios-assistant__subtitle">
              Pesquise e configure as BIOS compatíveis para os consoles do seu launcher.
            </p>
          </div>
        </header>

        {/* 1. AVISO LEGAL */}
        <div className="bios-assistant__legal-notice" role="alert">
          <div className="bios-assistant__legal-icon">
            <ShieldAlert size={20} />
          </div>
          <div className="bios-assistant__legal-text">
            <strong>Aviso Legal & Termos de Uso</strong>
            <p>
              Por questões de direitos autorais, não podemos baixar arquivos de BIOS automaticamente. Contudo, você pode usar os atalhos abaixo para pesquisar as opções compatíveis e, em seguida, usar nossa ferramenta de configuração automática.
            </p>
          </div>
        </div>

        {/* 2. CARDS DOS CONSOLES SIMPLIFICADOS */}
        <div className="bios-assistant__consoles-section">
          <div className="bios-assistant__grid">
            {BIOS_OPTIONS.map((console) => {
              const isConfiguredOnDisk = Boolean(configuredSystems[console.id]);
              const isImportedInSession = importedItems.some((i) => i.system === console.id);
              const isConfigured = isConfiguredOnDisk || isImportedInSession;

              return (
                <div
                  key={console.id}
                  className={`bios-console-card bios-console-card--simple ${isConfigured ? "is-configured" : ""}`}
                >
                  <div className="bios-console-card__simple-header">
                    <div className="bios-console-card__info">
                      <span className="bios-console-card__badge">{console.shortName}</span>
                      <h4>{console.name}</h4>
                    </div>
                    {isConfigured && (
                      <span className="bios-console-card__status-tag">
                        <CheckCircle2 size={13} /> Configurado
                      </span>
                    )}
                  </div>

                  <div className="bios-console-card__simple-file">
                    <small>Arquivo esperado:</small>
                    <code>{console.expectedFile}</code>
                  </div>

                  <div className="bios-console-card__simple-actions">
                    <button
                      type="button"
                      className={`bios-btn-search bios-btn-search--full ${isConfigured ? "is-configured" : ""}`}
                      onClick={() => {
                        if (!isConfigured) handleOpenLink(console.url);
                      }}
                      disabled={isConfigured}
                      title={isConfigured ? "Arquivo já configurado e detectado no sistema." : "Abrir link para baixar"}
                    >
                      {isConfigured ? (
                        <>
                          <CheckCircle2 size={14} />
                          Configurado
                        </>
                      ) : (
                        <>
                          <ExternalLink size={14} />
                          {console.id === "ps3" ? "Procurar Firmware" : "Procurar BIOS"}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. AVISO ESPECÍFICO PS3 (Estilo Foto 1) */}
        <div className={`bios-ps3-card ${Boolean(configuredSystems["ps3"]) ? "is-configured" : ""}`} role="note">
          <div className="bios-ps3-card__icon-wrap">
            {Boolean(configuredSystems["ps3"]) ? (
              <CheckCircle2 size={24} className="bios-ps3-card__icon" style={{ color: "#34d399" }} />
            ) : (
              <Info size={24} className="bios-ps3-card__icon" />
            )}
          </div>
          <div className="bios-ps3-card__content">
            <h4 className="bios-ps3-card__title">
              {Boolean(configuredSystems["ps3"])
                ? "PlayStation 3 (RPCS3) — Firmware Configurado"
                : "Aviso para o PlayStation 3 (RPCS3)"}
            </h4>
            <p className="bios-ps3-card__text">
              {Boolean(configuredSystems["ps3"]) ? (
                "O firmware oficial (PS3UPDAT.PUP) já foi detectado e configurado no RPCS3. Seus jogos de PS3 serão iniciados diretamente!"
              ) : (
                <>
                  O PS3 possui uma instalação diferente. Após baixar, abra o emulador RPCS3, vá em{" "}
                  <strong>'File &gt; Install Firmware'</strong> e selecione o arquivo{" "}
                  <code className="bios-ps3-pup-badge">PS3UPDAT.PUP</code>.
                </>
              )}
            </p>
          </div>
        </div>

        {/* FEEDBACK DE SUCESSO DA SESSÃO */}
        {hasImportedAny && (
          <div className="bios-assistant__success-box">
            <div className="bios-assistant__success-title">
              <CheckCircle2 size={18} />
              <strong>BIOS configuradas recentemente para:</strong>
            </div>
            <ul className="bios-assistant__success-list">
              {importedItems.map((item) => (
                <li key={item.system}>
                  <div className="bios-success-item">
                    <strong>{item.consoleName}</strong>
                    <span>{item.extractedFilesCount} arquivos configurados a partir de <code>{item.sourceFile}</code></span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* MENSAGEM DE ERRO OU FALHA NO AUTO-SCAN */}
        {errorMessage && (
          <div className="bios-assistant__error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 4. RODAPÉ (Estilo Foto 1) */}
        <footer className="bios-modal-footer">
          {/* Elemento 1: Botão secundário "Fechar" */}
          <button
            className="bios-btn-fechar"
            type="button"
            onClick={onClose}
            disabled={isScanning || isImportingManual}
          >
            Fechar
          </button>

          <div className="bios-modal-footer__right">
            {/* Elemento 3: Botão text-link discreto "Importar .zip manualmente" */}
            <button
              className="bios-btn-import-zip"
              type="button"
              disabled={isScanning || isImportingManual}
              onClick={() => void handleManualImport()}
            >
              {isImportingManual ? (
                <>
                  <Loader2 size={15} className="spin" />
                  <span>Importando…</span>
                </>
              ) : (
                <>
                  <Download size={15} />
                  <span>Importar .zip manualmente</span>
                </>
              )}
            </button>

            {/* Elemento 2: Botão de ação principal (em destaque) "Já baixei! Configurar Automaticamente" */}
            <button
              className="bios-btn-config-auto"
              type="button"
              disabled={isScanning || isCheckingDisk}
              onClick={() => void handleAutoScan()}
            >
              {isScanning ? (
                <>
                  <Loader2 size={22} className="spin" />
                  <div className="bios-btn-config-auto__labels">
                    <span className="bios-btn-config-auto__sub">Aguarde…</span>
                    <strong className="bios-btn-config-auto__main">Varrendo pasta Downloads</strong>
                  </div>
                </>
              ) : (
                <>
                  <Sparkles size={22} className="bios-btn-config-auto__icon" />
                  <div className="bios-btn-config-auto__labels">
                    <span className="bios-btn-config-auto__sub">Já baixei!</span>
                    <strong className="bios-btn-config-auto__main">Configurar Automaticamente</strong>
                  </div>
                </>
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
