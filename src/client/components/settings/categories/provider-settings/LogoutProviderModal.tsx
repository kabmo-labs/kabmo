import { useEffect, useState } from 'preact/hooks';
import { AlertTriangle, Loader2, LogOut } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';
import { fetchLogoutAccounts, logoutProvider, type LogoutAccount } from '@/client/hooks/settings/providers/logout';

interface LogoutProviderModalProps {
  isOpen: boolean;
  provider: ProviderItem | null;
  onClose: () => void;
  /** Called after a credential is removed, so the provider list re-reads. */
  onSignedOut: (message: string) => void;
}

/**
 * Confirmation for removing a STORED CREDENTIAL, which is not what `disable` or
 * `disconnect` do.
 *
 * Those two write `disabledProviders` in `config.yml`, which only hides the
 * provider's models from the picker — the OAuth token or API key stays on disk.
 * omp exposes `get_logout_accounts` + `logout` for the real operation, and this
 * dialog is the only place Kabmo calls them.
 *
 * The account list is read on open (omp addresses a credential by
 * `(providerId, credentialId)`, so it cannot be guessed) and the dialog names
 * what survives: a `models.yml` entry and a Kabmo-overlay row are untouched.
 */
export function LogoutProviderModal({ isOpen, provider, onClose, onSignedOut }: LogoutProviderModalProps) {
  const [accounts, setAccounts] = useState<LogoutAccount[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !provider) return;
    let cancelled = false;
    setAccounts(null);
    setError(null);
    void fetchLogoutAccounts(provider.slug).then((result) => {
      if (cancelled) return;
      if (result.error) {
        // A refused read is reported rather than rendered as "no accounts":
        // the two look identical on screen but only one is actionable.
        setError(result.error);
        setAccounts([]);
        return;
      }
      setAccounts(result.accounts);
    });
    return () => { cancelled = true; };
  }, [isOpen, provider]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || busyId !== null) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, busyId]);

  if (!isOpen || !provider) return null;

  const signOut = async (credentialId: number) => {
    setBusyId(credentialId);
    setError(null);
    const result = await logoutProvider(provider.slug, credentialId);
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSignedOut(
      result.remainingSource
        ? `Signed out of ${provider.name}. It still authenticates via ${result.remainingSource}.`
        : `Signed out of ${provider.name} — its stored credential is gone.`,
    );
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 backdrop-blur-[2px] p-4"
      onClick={busyId !== null ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm sign out"
    >
      <div
        className="bg-paper border border-ink/20 rounded-xl shadow-2xl w-[min(94vw,480px)] max-h-full overflow-y-auto scrollbar-overlay-container text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink/10">
          <LogOut size={16} className="text-error shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Sign out?</h2>
            <p className="text-[11px] text-ink/50 truncate">
              <span className="font-mono">{provider.slug}</span>
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-ink/5 border border-ink/10">
            <ProviderIconPlate provider={provider} size={26} />
            <span className="text-xs font-medium text-ink truncate">{provider.name}</span>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-error/30 bg-error/5 text-[11px] text-ink/80">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
              <span>{error}</span>
            </div>
          )}

          {accounts === null ? (
            <div className="flex items-center gap-2 py-3 text-[11.5px] text-ink/55">
              <Loader2 size={13} className="animate-spin" />
              <span>Reading stored credentials…</span>
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-[11.5px] leading-relaxed text-ink/70">
              omp holds no removable credential for this provider — its authentication
              comes from somewhere this dialog cannot touch (an API key in{' '}
              <span className="font-mono text-ink">models.yml</span>, or the environment).
              Use <span className="font-medium text-ink">disable</span> to hide it instead.
            </p>
          ) : (
            <>
              <p className="text-[11.5px] leading-relaxed text-ink/70">
                This removes the stored credential. The provider disappears from the model
                list until you sign in again — different from{' '}
                <span className="font-medium text-ink">disable</span>, which only hides it
                and leaves the credential in place.
              </p>
              <div className="space-y-1.5">
                {accounts.map((account) => (
                  <div
                    key={account.credentialId}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink/15 bg-paper"
                  >
                    <div className="min-w-0">
                      <div className="text-[11.5px] text-ink truncate">{account.label}</div>
                      {account.active && <div className="text-[10px] text-ink/45">in use</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void signOut(account.credentialId)}
                      disabled={busyId !== null}
                      className="shrink-0 px-2.5 py-1 rounded-md bg-error/10 hover:bg-error/20 text-error text-[11px] font-medium border border-error/30 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {busyId === account.credentialId ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />
                          <span>removing…</span>
                        </>
                      ) : (
                        <span>sign out</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-ink/55">
                A <span className="font-mono">models.yml</span> entry for this provider is not
                touched — use <span className="font-medium text-ink">delete</span> for that.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            disabled={busyId !== null}
            className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
