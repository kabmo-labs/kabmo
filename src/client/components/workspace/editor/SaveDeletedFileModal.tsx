import { useEffect } from 'preact/hooks';
import { FileWarning } from 'lucide-preact';

interface SaveDeletedFileModalProps {
  /** The tab's file name, shown so the user knows which file is at stake. */
  fileName: string;
  /** The path, in full — the name alone may be ambiguous across folders. */
  filePath: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * The dialog a Save opens when the file it names is no longer on disk.
 *
 * The tab strip already says the file is gone (red, struck through), but that
 * is a statement about DISK — the buffer is still here and still editable. What
 * it cannot say is whether writing it back is wanted: the deletion may have
 * been the user's own, or a `rm` from another terminal. So a Save asks rather
 * than recreating the file silently, and the debounced autosave refuses
 * outright (see `use-file-writes.ts`).
 */
export function SaveDeletedFileModal({ fileName, filePath, onClose, onConfirm }: SaveDeletedFileModalProps) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 animate-in fade-in duration-200 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Save deleted file"
    >
      <div
        className="bg-paper border border-ink/20 rounded-xl shadow-xl w-[min(94vw,440px)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/10">
          <FileWarning size={16} className="text-error shrink-0" />
          <h2 className="text-[13px] font-semibold text-ink">This file was deleted</h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="rounded-lg border border-ink/10 bg-canvas/50 px-3 py-2">
            <div className="text-[12px] font-mono text-error line-through truncate">{fileName}</div>
            <div className="text-[11px] font-mono text-ink/50 break-all mt-0.5">{filePath}</div>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink/60">
            It was removed from disk while this tab was open. Saving recreates it with the buffer's current
            contents — anything written to that path since the deletion is lost.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-ink/20 text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors cursor-pointer text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="px-3 py-1.5 rounded bg-error text-canvas hover:bg-error/90 transition-colors cursor-pointer text-xs font-medium"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
