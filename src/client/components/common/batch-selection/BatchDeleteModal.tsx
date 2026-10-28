/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Confirmation for a batch delete, for both nouns.
 *
 * It names what actually disappears, because the two modes destroy different
 * things and only one of them is recoverable by re-adding: deleting SESSIONS
 * removes transcripts from disk, while deleting WORKSPACES only unregisters
 * them (the files stay, and the folder can be added back). Saying the same
 * sentence for both would be a lie in one direction or the other.
 *
 * Refusals are listed IN the dialog after the run: the server answers per-id
 * verdicts, and a batch of twenty that removed eighteen must report the two
 * that survived with their reasons — closing on a toast would leave the user
 * with a count they cannot reconcile against the list.
 */

import { useEffect } from 'preact/hooks';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import type { BatchDeleteOutcome } from '@/client/hooks/workspace/batch-delete';
import type { BatchMode } from '@/shared/lib/workspace/batch-select';

export interface BatchDeleteModalProps {
  mode: BatchMode;
  /** How many rows the user asked to delete; 0 closes the dialog. */
  count: number;
  /** The scope's name, so the sentence names the workspace. */
  scopeLabel?: string;
  isDeleting: boolean;
  /** The settled outcome, once the run finished. Null while running. */
  outcome: BatchDeleteOutcome | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function BatchDeleteModal({
  mode,
  count,
  scopeLabel,
  isDeleting,
  outcome,
  onClose,
  onConfirm,
}: BatchDeleteModalProps) {
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || isDeleting) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isDeleting]);

  if (count === 0) return null;

  const sessions = mode === 'session';
  const noun = sessions ? 'session' : 'workspace';
  const plural = count === 1 ? noun : `${noun}s`;
  const where = sessions && scopeLabel ? ` in ${scopeLabel}` : '';
  const finished = !isDeleting && outcome !== null;
  const removed = outcome?.removed.length ?? 0;
  const refused = outcome?.refused ?? [];

  return (
    <Modal
      onClose={isDeleting ? () => {} : onClose}
      zClass="z-[70]"
      maxWidthClass="max-w-[460px]"
      header={
        <div className="flex items-center gap-3 min-w-0">
          <Trash2 size={16} className="text-error shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              Delete {count} {plural}?
            </h2>
            <p className="text-[11px] text-ink/50 truncate">{where ? where.trim() : 'Selected rows'}</p>
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
            {finished ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting || finished}
            className="px-3.5 py-1.5 rounded-md bg-error text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isDeleting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>Deleting…</span>
              </>
            ) : (
              <>
                <Trash2 size={13} />
                <span>Delete {count} {plural}</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-3">
        {sessions ? (
          <ul className="text-[11.5px] leading-relaxed text-ink/70 space-y-1.5">
            <li>
              Each transcript is removed from{' '}
              <span className="font-mono text-ink">~/.omp/agent/sessions</span> — the conversations are
              gone from the sidebar and from oh-my-pi.
            </li>
            <li>Their subagent transcripts, side questions, queued messages and saved layout go too.</li>
            <li>A session that is mid-run is refused rather than interrupted; stop it and delete again.</li>
          </ul>
        ) : (
          <ul className="text-[11.5px] leading-relaxed text-ink/70 space-y-1.5">
            <li>The workspaces are removed from this sidebar.</li>
            <li>
              Their directories and every transcript on disk are left alone — re-add a workspace with{' '}
              <span className="font-mono text-ink">New Workspace</span> when you want it back.
            </li>
          </ul>
        )}

        {outcome?.error ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>{outcome.error}</span>
          </div>
        ) : finished ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-ink/15 bg-ink/5 text-[11px] text-ink/75">
            <span>
              Removed {removed} {removed === 1 ? noun : `${noun}s`}
              {refused.length > 0 ? `, ${refused.length} refused:` : '.'}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>
              {sessions
                ? 'This cannot be undone from the UI. Archive a session instead to keep its transcript.'
                : 'This removes the sidebar entry only. The folder itself is not deleted.'}
            </span>
          </div>
        )}

        {refused.length > 0 && (
          <ul className="max-h-40 overflow-y-auto scrollbar-overlay-container space-y-1 text-[11px] text-ink/70">
            {refused.map((entry) => (
              <li key={entry.id} className="flex items-start gap-1.5">
                {/* The whole id, truncated by CSS rather than sliced: a sliced
                    `new-…` reads `new-1792`, which names nothing. */}
                <span className="font-mono text-ink/50 shrink-0 max-w-[7rem] truncate" title={entry.id}>
                  {entry.id}
                </span>
                <span className="min-w-0">{entry.error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
