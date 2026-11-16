import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { AttachmentDTO } from '@reformar/shared';
import { api, errorMessage } from '../lib/api';
import { compressImage } from '../lib/image';
import { useToast } from '../lib/toast';
import { Button } from './ui';
import { fmtDay, t } from '../lib/i18n';

/**
 * Envio de fotos da obra: câmera traseira ou galeria, várias de uma vez.
 * `uploadUrl` já deve conter os parâmetros (medição, etapa, diário).
 */
export function PhotoPicker({
  uploadUrl,
  onUploaded,
  label = t('Adicionar fotos'),
  disabled,
}: {
  uploadUrl: string;
  onUploaded: (a: AttachmentDTO) => void;
  label?: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const cameraId = useId();
  const galleryId = useId();
  const [progress, setProgress] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(t('Enviando foto {i} de {n}…', { i: i + 1, n: list.length }));
      try {
        const blob = await compressImage(list[i]!);
        const a = await api<AttachmentDTO>(uploadUrl, {
          method: 'POST',
          rawBody: blob,
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
        });
        onUploaded(a);
        ok++;
      } catch (e) {
        toast(t('Foto {i}: {error}', { i: i + 1, error: errorMessage(e) }), 'error');
      }
    }
    setProgress(null);
    if (ok) toast(ok === 1 ? t('Foto enviada.') : t('{n} fotos enviadas.', { n: ok }));
  };

  return (
    <div className="photo-picker">
      <span className="label-strong">{label}</span>
      <div className="actions">
        <label htmlFor={cameraId} className={`btn btn-secondary${disabled ? ' disabled' : ''}`}>
          <Camera aria-hidden />
          <span>{t('Tirar foto')}</span>
        </label>
        <input
          id={cameraId}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled || !!progress}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
        <label htmlFor={galleryId} className={`btn btn-ghost${disabled ? ' disabled' : ''}`}>
          <ImagePlus aria-hidden />
          <span>{t('Escolher da galeria')}</span>
        </label>
        <input
          id={galleryId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          disabled={disabled || !!progress}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
    </div>
  );
}

export function PhotoGrid({ photos, onRemove }: { photos: AttachmentDTO[]; onRemove?: (a: AttachmentDTO) => void }) {
  if (!photos.length) return null;
  return (
    <ul className="photo-grid">
      {photos.map((p) => (
        <li key={p.id}>
          <a href={p.url} target="_blank" rel="noopener">
            <img src={p.url} alt={p.caption ?? t('Foto da obra')} loading="lazy" />
          </a>
          <span className="small muted">
            {p.caption ?? fmtDay(p.createdAt)}
            {p.uploadedByName ? ` · ${p.uploadedByName}` : ''}
          </span>
          {onRemove && (
            <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => onRemove(p)} aria-label={t('Remover foto')}>
              {t('Remover')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
