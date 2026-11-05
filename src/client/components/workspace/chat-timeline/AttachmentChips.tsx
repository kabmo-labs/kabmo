import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

import { File as FileIcon, X } from 'lucide-preact';

export interface AttachmentChip {
  name?: string;
  preview?: string;
  type?: string;
  size?: number;
  content?: string;
}

interface AttachmentChipsProps {
  attachments: AttachmentChip[];
  className?: string;
  /** Open a non-image attachment in the editor panel (via omp:open-file). */
  onOpenFile?: (att: AttachmentChip) => void;
}

function isImageAttachment(att: AttachmentChip): boolean {
  if (att.preview?.startsWith('data:image/') || att.preview?.startsWith('blob:')) return true;
  return att.type?.startsWith('image/') ?? false;
}

/** Lightbox modal for image attachments, Google-Photos style (dark overlay,
 *  large centered image, click outside or X to close, scroll to zoom). */
function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${name}`}
    >
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 flex items-center justify-center w-8 h-8 rounded-full bg-paper/10 text-canvas hover:bg-paper/20 transition-colors"
          title="Close (Esc)"
        >
          <X size={18} />
        </button>
        <img
          src={src}
          alt={name}
          onClick={() => setZoomed(z => !z)}
          title={zoomed ? 'Zoom out' : 'Zoom in (click image)'}
          className={`max-w-[90vw] max-h-[85vh] object-contain rounded-md shadow-2xl bg-canvas/5 cursor-zoom-in transition-transform ${
            zoomed ? 'scale-150 cursor-zoom-out' : 'scale-100'
          }`}
        />
        <div className="mt-3 max-w-[90vw] truncate text-[11px] font-mono text-on-ink-muted">{name}</div>
      </div>
    </div>,
    document.body
  );
}

/** Clickable attachment chips: images open a lightbox, other files open in
 *  the editor panel (via omp:open-file so DesktopLayout opens its tab). */
export function AttachmentChips({ attachments, className = '', onOpenFile }: AttachmentChipsProps) {
  const [lightbox, setLightbox] = useState<AttachmentChip | null>(null);

  const handleChipClick = (att: AttachmentChip) => {
    if (isImageAttachment(att) && att.preview) {
      setLightbox(att);
      return;
    }
    if (onOpenFile) {
      onOpenFile(att);
    } else {
      window.dispatchEvent(new CustomEvent('omp:open-file', { detail: { path: att.name ?? 'attachment' } }));
    }
  };

  return (
    <>
      {attachments.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 pt-2 border-t border-ink/10 ${className}`}>
          {attachments.map((att, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleChipClick(att)}
              title={isImageAttachment(att) ? 'Preview image' : 'Open in editor'}
              className="flex items-center bg-canvas border border-ink/10 rounded-md p-0.5 pr-1.5 text-xs font-sans hover:border-ink/40 hover:bg-ink/5 hover:shadow-sm transition-all cursor-pointer group"
            >
              {att.preview ? (
                <img
                  src={att.preview}
                  alt="attachment preview"
                  className="w-5 h-5 rounded-sm object-cover mr-1.5 border border-ink/5 group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="w-5 h-5 flex items-center justify-center bg-ink/5 rounded-sm mr-1.5 text-ink/60">
                  <FileIcon size={11} />
                </div>
              )}
              <span className="truncate max-w-[100px] font-mono text-[10px] text-ink/80">{att.name}</span>
            </button>
          ))}
        </div>
      )}
      {lightbox && lightbox.preview && (
        <ImageLightbox src={lightbox.preview} name={lightbox.name ?? 'image'} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
