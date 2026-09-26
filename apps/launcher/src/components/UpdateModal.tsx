import { Download, ExternalLink, Sparkles, X, Clock, HardDrive, CheckCircle2 } from "lucide-react";
import type { AppRelease } from "../services/updateService";
import { openExternalUrl } from "../services/updateService";

interface UpdateModalProps {
  release: AppRelease;
  currentVersion: string;
  onClose: () => void;
  onRemindLater: () => void;
  onUpdateNow: () => void;
  isUpdating?: boolean;
}

export function UpdateModal({
  release,
  currentVersion,
  onClose,
  onRemindLater,
  onUpdateNow,
  isUpdating = false,
}: UpdateModalProps) {
  const formattedDate = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "";

  const fileSizeLabel = release.setupAsset?.size
    ? `${(release.setupAsset.size / (1024 * 1024)).toFixed(1)} MB`
    : null;

  return (
    <div
      className="modal-layer update-modal-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isUpdating) {
          onClose();
        }
      }}
    >
      <div className="update-dialog">
        <button
          className="dialog-close"
          onClick={onClose}
          disabled={isUpdating}
          aria-label="Fechar"
        >
          <X size={18} />
        </button>

        <div className="update-dialog__header">
          <div className="update-dialog__icon-wrapper">
            <Sparkles className="update-dialog__icon" size={24} />
          </div>
          <div>
            <span className="eyebrow">
              <Sparkles size={12} /> Atualização do Launcher
            </span>
            <h2 id="update-dialog-title">Nova versão disponível!</h2>
          </div>
        </div>

        <div className="update-dialog__version-banner">
          <div className="version-pill version-pill--current">
            <small>Versão atual</small>
            <strong>v{currentVersion}</strong>
          </div>
          <div className="version-arrow">→</div>
          <div className="version-pill version-pill--new">
            <small>Nova versão</small>
            <strong>{release.tagName || `v${release.version}`}</strong>
          </div>
          <span className="version-tag-badge">Oficial</span>
        </div>

        <div className="update-dialog__meta">
          {formattedDate && (
            <span>
              <Clock size={13} /> {formattedDate}
            </span>
          )}
          {fileSizeLabel && (
            <span>
              <HardDrive size={13} /> {fileSizeLabel}
            </span>
          )}
          <span>
            <CheckCircle2 size={13} /> GitHub Release
          </span>
        </div>

        <div className="update-dialog__notes-section">
          <div className="update-dialog__notes-title">
            <span>O que mudou nesta versão</span>
            <button
              type="button"
              className="update-dialog__github-link"
              onClick={() => void openExternalUrl(release.htmlUrl)}
              title="Abrir página desta release no GitHub"
            >
              <span>Ver no GitHub</span>
              <ExternalLink size={12} />
            </button>
          </div>
          <div className="update-dialog__notes-content">
            {release.body ? (
              <pre className="update-dialog__body-text">{release.body}</pre>
            ) : (
              <p className="update-dialog__empty-notes">
                Melhorias gerais de estabilidade, compatibilidade e interface.
              </p>
            )}
          </div>
        </div>

        <div className="update-dialog__actions">
          <button
            type="button"
            className="dialog-secondary-action update-dialog__btn-later"
            disabled={isUpdating}
            onClick={onRemindLater}
          >
            Lembrar mais tarde
          </button>
          <button
            type="button"
            className="primary-action update-dialog__btn-update"
            disabled={isUpdating}
            onClick={onUpdateNow}
          >
            <Download size={16} />
            {isUpdating ? "Iniciando atualização…" : "Atualizar agora"}
          </button>
        </div>
      </div>
    </div>
  );
}
