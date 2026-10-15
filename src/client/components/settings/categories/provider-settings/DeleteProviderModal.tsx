import { useEffect } from 'preact/hooks';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIcon } from '@/client/components/common/provider-icon';

interface DeleteProviderModalProps {
  isOpen: boolean;
  provider: ProviderItem | null;
  /** True while the delete request is in flight. */
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation for deleting a provider registered in `models.yml`.
 *
 * The dialog names what actually disappears — the file entry, its model list,
 * and the endpoint/credential stored on it — because the action is not
 * reversible from the UI: the endpoint and API key are only ever shown masked,
 * so a deleted provider has to be reconfigured from scratch.
 *
 * It also says what is NOT touched. A provider omp ships (a login provider, or
 * a bundled catalog entry) keeps its own configuration; only the `models.yml`
 * override goes, and that distinction is the difference between "I can add this
 * back" and "I just deleted my Anthropic login".
 */
export function DeleteProviderModal({
  isOpen,
  provider,
  isDeleting,
  onClose,
  onConfirm,
}: DeleteProviderModalProps) {
  useEffect(() => {
    // No dismissing mid-delete: the modal resolves itself on success, and an
    // early close would let a second delete be queued against a stale list.
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || isDeleting) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, isDeleting]);

  if (!isOpen || !provider) return null;

  const modelCount = provider.models.length;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 backdrop-blur-[2px] p-4"
      onClick={isDeleting ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm provider deletion"
    >
      <div
        className="bg-paper border border-ink/20 rounded-xl shadow-2xl w-[min(94vw,460px)] max-h-full overflow-y-auto scrollbar-overlay-container text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink/10">
          <Trash2 size={16} className="text-error shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Delete provider?</h2>
            <p className="text-[11px] text-ink/50 truncate">
              <span className="font-mono">{provider.slug}</span>
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-ink/5 border border-ink/10">
            <ProviderIcon icon={provider.icon} slug={provider.slug} name={provider.name} size={18} />
            <span className="text-xs font-medium text-ink truncate">{provider.name}</span>
          </div>

          <ul className="text-[11.5px] leading-relaxed text-ink/70 space-y-1.5">
            <li>
              Its entry is removed from{' '}
              <span className="font-mono text-ink">~/.omp/agent/models.yml</span>
              {modelCount > 0
                ? `, along with its ${modelCount} registered model${modelCount === 1 ? '' : 's'}.`
                : '.'}
            </li>
            <li>The endpoint and API key stored on that entry are removed with it — they are shown masked here, so you would need to enter them again.</li>
            {provider.credentialSource === 'omp-auth' && (
              <li className="text-ink/60">
                Your omp login for <span className="font-mono">{provider.slug}</span> is NOT touched — only the models.yml
                entry above. The provider stays available through that login.
              </li>
            )}
          </ul>

          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/75">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
            <span>This cannot be undone from the UI. Re-adding the provider starts from an empty endpoint and key.</span>
          </div>
        </div>

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
                <span>Delete provider</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
