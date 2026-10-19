/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'preact/hooks';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import type { SessionItemData } from '@/shared/types';

export interface SessionDeleteModalProps {
  /** The session awaiting confirmation, or null when the dialog is closed. */
  session: SessionItemData | null;
  /** True while the DELETE request is in flight. */
  isDeleting: boolean;
  /** Why the server refused, shown in place of the warning strip. */
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for deleting a session.
 *
 * The dialog names what actually disappears — the transcript on disk, the
 * subagent transcripts beside it, the side questions asked in it, and the
 * Kabmo's own rows for it — because none of it is recoverable from the UI.
 * That is the whole difference between this button and the archive button next
 * to it, and a bare "Delete?" would leave the user guessing which one they
 * pressed.
 *
 * A refusal is rendered INSIDE the dialog rather than as a toast: the reasons
 * the server gives (the session is mid-run, or the chat has not been created
 * yet) are actionable, and the user is standing in the place where they act on
 * them.
 */
export function SessionDeleteModal({
  session,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: SessionDeleteModalProps) {
  useEffect(() => {
    // No dismissing mid-delete: the dialog resolves itself on success, and an
    // early close would let a second delete be queued against a stale row.
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || isDeleting) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isDeleting]);

  if (!session) return null;

  return (
    <Modal
      onClose={isDeleting ? () => {} : onClose}
      zClass="z-[70]"
      maxWidthClass="max-w-[460px]"
      header={
        <div className="flex items-center gap-3 min-w-0">
          <Trash2 size={16} className="text-error shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Delete session?</h2>
            <p className="text-[11px] text-ink/50 truncate">{session.title}</p>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-3.5 py-1.5 rounded-md bg-error text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isDeleting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 size={13} />
                <span>Delete session</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-3">
        <ul className="text-[11.5px] leading-relaxed text-ink/70 space-y-1.5">
          <li>
            Its transcript is removed from{' '}
            <span className="font-mono text-ink">~/.omp/agent/sessions</span> — the conversation is
            gone from the sidebar and from oh-my-pi.
          </li>
          <li>The subagent transcripts and any side questions asked in it are removed with it.</li>
          <li>Its queued messages, archive state, and saved panel layout go too.</li>
        </ul>

        {error ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>This cannot be undone from the UI. Archive it instead to keep the transcript.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
