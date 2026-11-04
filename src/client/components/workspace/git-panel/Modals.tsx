import type { ReactNode, RefObject } from 'preact/compat';
import { useCallback } from 'preact/hooks';
import { AlertTriangle, GitMerge } from 'lucide-preact';

export { GitCommitModal as GitOutputModal } from '@/client/components/workspace/git-panel/commit-modal';

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 modal-scrim flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-overlay bg-paper border border-ink/20 rounded-lg shadow-xl flex flex-col overflow-hidden w-[min(94vw,420px)] max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmActionModal({ modal, onClose, onConfirm }: { modal: { type: string; file?: string; message: string } | null; onClose: () => void; onConfirm: () => void }) {
  if (!modal) return null;
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/10">
        <AlertTriangle size={16} className="text-error flex-shrink-0" />
        <h3 className="text-sm font-semibold text-ink">Confirm Action</h3>
      </div>
      <div className="px-4 py-4 text-xs text-ink/80 leading-relaxed">{modal.message}</div>
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
          onClick={onConfirm}
          className="px-3 py-1.5 rounded bg-error text-canvas hover:bg-error/90 transition-colors cursor-pointer text-xs font-medium"
        >
          Confirm
        </button>
      </div>
    </ModalShell>
  );
}

export function BranchPromptModal({ isOpen, branchName, inputRef, onChange, onClose, onCreate }: { isOpen: boolean; branchName: string; inputRef: RefObject<HTMLInputElement>; onChange: (v: string) => void; onClose: () => void; onCreate: () => void }) {
  if (!isOpen) return null;

  const submit = useCallback(() => {
    if (branchName.trim()) onCreate();
  }, [branchName, onCreate]);

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/10">
        <GitMerge size={16} className="text-ink/60 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-ink">Create New Branch</h3>
      </div>
      <div className="px-4 py-4">
        <input
          ref={inputRef}
          type="text"
          value={branchName}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          placeholder="branch-name"
          className="w-full bg-canvas border border-ink/20 rounded px-3 py-2 text-xs focus:outline-none focus:border-ink/40 text-ink placeholder-ink/40 transition-colors"
        />
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
          onClick={submit}
          disabled={!branchName.trim()}
          className="px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}
