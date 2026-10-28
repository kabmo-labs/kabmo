/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The unsaved-changes guard: a `beforeunload` armed only while something is
 * dirty, and the dialog for closing one dirty tab.
 *
 * ## Why a guard at all
 *
 * The autosave is debounced at 800 ms, so closing a tab — or reloading — inside
 * that window loses the edit with no warning and no way to recover it. The tab
 * strip says which tabs are at risk (`editor-dirty-tabs`); this is what asks
 * before the loss happens.
 *
 * ## Why only DIRTY tabs ask
 *
 * A confirm on every close is one people learn to dismiss without reading, which
 * is worse than none. A clean tab closes instantly; the dialog appears only where
 * there is something to lose, and it names the file.
 *
 * ## `beforeunload` is the browser's own modal, and that is a cost
 *
 * It cannot be styled, it cannot offer "Save and close", and some users find it
 * more annoying than the loss. It is therefore armed only while `hasDirtyTabs()` —
 * the narrow case — and removed the moment nothing is dirty. The handler calls
 * `preventDefault()` and sets `returnValue`; a browser that ignores one still
 * honours the other, and `returnValue` is the deprecated-but-required spelling.
 */

import { useEffect } from 'preact/hooks';
import { AlertTriangle } from 'lucide-preact';

import { hasDirtyTabs } from '@/client/lib/editor-dirty-tabs';
import { Modal } from '@/client/components/common/Modal';

/** Arms `beforeunload` while any tab holds unsaved edits. */
export function useUnloadGuard(): void {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasDirtyTabs()) return;
      // Both are required: Chrome reads `returnValue`, Firefox reads
      // `preventDefault`, and neither is a superset of the other.
      event.preventDefault();
      // eslint-disable-next-line deprecation/deprecation -- required by Chrome.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

/** The three answers a dirty close offers. */
export type DirtyCloseAnswer = 'save' | 'discard' | 'cancel';

interface CloseDirtyTabModalProps {
  fileName: string;
  onAnswer: (answer: DirtyCloseAnswer) => void;
}

/**
 * Ask before closing a tab whose edits are not on disk.
 *
 * Three answers, and the difference between the first two is the whole point:
 * "Save & close" writes first (and a failed write leaves the tab open, because the
 * dialog closes only on a successful save), while "Discard" closes and takes the
 * loss knowingly. Cancel keeps the tab — the answer for someone who closed by
 * accident.
 *
 * A "Save" that silently failed would close the tab anyway, so the save path
 * reports its own failure through the toolbar's status; this dialog decides
 * WHETHER to close, never whether the write worked.
 */
export function CloseDirtyTabModal({ fileName, onAnswer }: CloseDirtyTabModalProps) {
  return (
    <Modal
      onClose={() => onAnswer('cancel')}
      header={
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-warning" />
          <span className="text-sm font-semibold text-ink">Unsaved changes</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button
            type="button"
            onClick={() => onAnswer('cancel')}
            className="px-3 py-1.5 rounded border border-ink/20 text-ink/80 hover:bg-ink/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAnswer('discard')}
            className="px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10 transition-colors cursor-pointer"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => onAnswer('save')}
            className="px-3 py-1.5 rounded bg-ink text-paper hover:bg-ink/90 transition-colors cursor-pointer"
          >
            Save &amp; close
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 text-xs text-ink/80">
        <span className="font-mono text-ink">{fileName}</span> has changes that are not on disk.
        <div className="mt-1 text-ink/50">Discarding them cannot be undone.</div>
      </div>
    </Modal>
  );
}
