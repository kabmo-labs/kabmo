/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Confirmation for deleting a project.
 *
 * The trash button used to run the delete straight away, and a refusal (the
 * last project, a missing id) went to `console.error` — so the row could vanish
 * from the list on screen while the folder was still there. The dialog names
 * what disappears before anything is removed, and renders a refusal in place.
 */

import { useEffect } from 'preact/hooks';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import type { ProjectConfigItem } from '@/shared/types';

interface DeleteProjectModalProps {
  project: ProjectConfigItem | null;
  isDeleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteProjectModal({
  project,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: DeleteProjectModalProps) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || isDeleting) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isDeleting]);

  if (!project) return null;

  return (
    <Modal
      onClose={isDeleting ? () => {} : onClose}
      zClass="z-[70]"
      maxWidthClass="max-w-[440px]"
      ariaLabel="Delete project"
      header={
        <div className="flex items-center gap-3 min-w-0">
          <Trash2 size={16} className="text-error shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Delete project?</h2>
            <p className="text-[11px] text-ink/50 truncate">{project.name}</p>
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
            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            <span>{isDeleting ? 'Deleting…' : 'Delete project'}</span>
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 space-y-3">
        <ul className="text-[11.5px] leading-relaxed text-ink/70 space-y-1.5">
          <li>
            The workspace is unregistered from Kabmo — its place in the sidebar, its chats' grouping and
            its settings go.
          </li>
          <li>
            {project.path
              ? 'The directory itself is NOT deleted; a tombstone keeps omp discovery from re-adding it on the next boot.'
              : 'It has no directory, so nothing on disk is touched.'}
          </li>
          <li>Chat transcripts stay on disk under ~/.omp/agent/sessions.</li>
        </ul>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
