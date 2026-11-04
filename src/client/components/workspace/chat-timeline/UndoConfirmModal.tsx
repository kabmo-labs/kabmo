
import { useEffect } from 'preact/hooks';
import { Loader2, Undo2 } from 'lucide-preact';

interface UndoConfirmModalProps {
  /** Preview of the message being undone (truncated by the caller). */
  content: string;
  /** Omp rewinds agent context; other session types only trim the timeline. */
  isOmpSession: boolean;
  /** True while the rewind request is in flight. */
  undoing: boolean;
  /** Why the last attempt failed; the modal stays open when it is set. */
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation dialog for the undo button on a user-message footer. Undo
 * rewinds the session before this turn — the turn and everything after it
 * leave the timeline and the agent context — so the user should opt in.
 */
export function UndoConfirmModal({ content, isOmpSession, undoing, error, onClose, onConfirm }: UndoConfirmModalProps) {
  useEffect(() => {
    // No dismissing mid-rewind: the modal resolves itself on success, and an
    // early close would let the user queue another undo against a stale view.
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || undoing) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, undoing]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-scrim animate-in fade-in duration-200 p-4"
      onClick={undoing ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm undo"
    >
      <div
        className="glass-overlay bg-paper border border-ink/20 rounded-xl shadow-xl w-[min(94vw,420px)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/10">
          <Undo2 size={16} className="text-ink/70 shrink-0" />
          <h2 className="text-[13px] font-semibold text-ink">Undo message?</h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="rounded-lg border border-ink/10 bg-canvas/50 px-3 py-2 text-[12px] text-ink/80 leading-relaxed max-h-28 overflow-y-auto scrollbar-overlay-container">
            {content || 'Empty message or attachment-only prompt'}
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink/60">
            {isOmpSession
              ? 'The timeline and agent context rewind to before this message. Its reply and everything after it are removed; the text returns to the composer for editing.'
              : 'This message and everything after it are removed from the timeline. The text returns to the composer for editing.'}
          </p>
          {error && (
            <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11.5px] leading-relaxed text-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            disabled={undoing}
            className="px-3 py-1.5 rounded border border-ink/20 text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors cursor-pointer text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus={!undoing}
            onClick={onConfirm}
            disabled={undoing}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {undoing && <Loader2 size={13} className="animate-spin shrink-0" />}
            {undoing ? 'Rewinding…' : 'Undo'}
          </button>
        </div>
      </div>
    </div>
  );
}
