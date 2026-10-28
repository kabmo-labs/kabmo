import { useState } from 'preact/hooks';
import { AlertCircle, Ban, Check, Info, KeyRound, LogIn, LogOut, Pencil, Trash2 } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { credentialOriginLabel, canSignOut, connectOffers } from '@/shared/lib/models/provider/origin';
import { providerDeletable } from '@/client/components/settings/categories/provider-settings/groups';

interface ProviderAuthSectionProps {
  provider: ProviderItem;
  /** Opens one of the connection dialogs the provider actually offers. */
  onConnect: (kind: 'login' | 'edit') => void;
  /** Writes/removes the provider in omp's config.yml `disabledProviders`. */
  onToggleDisabled: () => void;
  /** Opens the delete confirmation. */
  onDelete: () => void;
  /** Opens the credential-removal dialog. */
  onSignOut: () => void;
}

/**
 * The provider's identity block: what it is signed in with, and the three
 * operations that are actually different from each other.
 *
 * - **disable / enable** writes `config.yml disabledProviders` — the provider
 *   and every model it serves leave the chat picker, and the credential stays.
 * - **sign out** removes a credential omp has stored. It is offered only where
 *   one exists: an environment-authenticated provider has nothing on disk, so
 *   the control used to be a button whose only outcome was a failure.
 * - **connect** is one control, not two. The old panel had `connect` AND
 *   `reconnect`, both of which wrote the same SQLite overlay, and a separate
 *   `disconnect` that was literally the disable switch under a second name.
 *   The label follows the state and the action follows the provider's shape:
 *   an OAuth provider with no credential opens the sign-in flow, a
 *   `models.yml` entry opens its editor.
 */
export function ProviderAuthSection({
  provider,
  onConnect,
  onToggleDisabled,
  onDelete,
  onSignOut,
}: ProviderAuthSectionProps) {
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);
  const isConnected = provider.status === 'connected';
  const isDisabled = provider.disabled === true;
  const origin = provider.credentialOrigin;
  const signOutAvailable = canSignOut(origin);
  const offers = connectOffers(provider);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="text-xs font-semibold text-ink">Authentication</div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 min-w-0">
            {isDisabled ? (
              <>
                <Ban size={15} className="text-ink/50 flex-shrink-0" strokeWidth={2.4} />
                <span className="text-xs font-medium text-ink/70">Disabled</span>
              </>
            ) : isConnected ? (
              <>
                <Check size={15} className="text-emerald-500 flex-shrink-0" strokeWidth={2.4} />
                <span className="text-xs font-medium text-ink">Connected</span>
              </>
            ) : (
              <>
                <AlertCircle size={15} className="text-amber-500 flex-shrink-0" strokeWidth={2.4} />
                <span className="text-xs font-medium text-ink/80">Not signed in</span>
              </>
            )}

            <span className="text-[11px] text-ink/55 font-mono px-1.5 py-0.5 rounded bg-ink/5 border border-ink/10">
              {credentialOriginLabel(origin)}
            </span>

            <div
              className="relative inline-block cursor-help ml-0.5"
              onMouseEnter={() => setShowInfoTooltip(true)}
              onMouseLeave={() => setShowInfoTooltip(false)}
            >
              <Info size={13} className="text-ink/40 hover:text-ink/70 transition-colors" />
              {showInfoTooltip && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 bg-ink text-canvas text-[10px] rounded px-2.5 py-1.5 shadow-xl w-64 z-50 pointer-events-none leading-relaxed">
                  {isDisabled
                    ? 'Disabled in omp’s config.yml — none of its models appear in the chat model list. The credential is untouched.'
                    : isConnected
                      ? 'omp can resolve a credential for this provider, so its models are offered in the chat picker.'
                      : 'omp knows this provider but has no credential for it. Connect to sign in or supply a key.'}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleDisabled}
              title={isDisabled
                ? 'Offer this provider in the model list again'
                : 'Hide this provider and its models from the model list'}
              className="px-3 py-1.5 rounded-md bg-ink/5 hover:bg-ink/10 text-ink text-xs font-medium transition-colors cursor-pointer border border-ink/10"
            >
              {isDisabled ? 'enable' : 'disable'}
            </button>

            {/* One button per thing the provider can DO. An Anthropic override
                pointing at a proxy is both an OAuth login and a models.yml
                entry, and a single button made whichever lost unreachable. */}
            {offers.login && (
              <button
                type="button"
                onClick={() => onConnect('login')}
                title="Sign in to this provider through omp"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <LogIn size={12} />
                <span>{isConnected && origin === 'login' ? 'sign in again' : 'sign in'}</span>
              </button>
            )}
            {offers.edit && (
              <button
                type="button"
                onClick={() => onConnect('edit')}
                title="Edit this provider’s endpoint, credential and dialect in models.yml"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                  offers.login
                    ? 'bg-ink/5 hover:bg-ink/10 text-ink border-ink/15'
                    : 'bg-ink text-canvas hover:opacity-90 border-ink'
                }`}
              >
                <Pencil size={12} />
                <span>edit</span>
              </button>
            )}
            {!offers.login && !offers.edit && (
              <button
                type="button"
                disabled
                title={offers.reason}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium opacity-40 cursor-not-allowed"
              >
                <KeyRound size={12} />
                <span>connect</span>
              </button>
            )}

            {/* Only where a stored credential exists: `disable` writes
                config.yml and leaves the token on disk, and an environment
                credential has nothing to remove at all. */}
            {signOutAvailable && (
              <button
                type="button"
                onClick={onSignOut}
                title="Remove the credential omp stored for this provider"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-ink/5 hover:bg-ink/10 text-ink text-xs font-medium transition-colors cursor-pointer border border-ink/10"
              >
                <LogOut size={12} />
                <span>sign out</span>
              </button>
            )}

            {/* Delete removes the models.yml entry and/or Kabmo's own row; a
                login provider's credential is never touched by it. Disabled
                where neither exists, with the reason on the button — a control
                whose only outcome is a server refusal is worse than none. */}
            <button
              type="button"
              onClick={onDelete}
              disabled={!providerDeletable(provider)}
              title={providerDeletable(provider)
                ? (provider.inModelsYml
                  ? 'Remove this provider’s models.yml entry'
                  : 'Remove this provider’s Kabmo settings row')
                : 'Nothing to delete: omp discovered this provider from its endpoint. Use disable to hide it.'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-error/10 hover:bg-error/20 text-error text-xs font-medium transition-colors cursor-pointer border border-error/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              <span>delete</span>
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-ink/10" />

      <div className="space-y-3">
        <div className="text-xs font-semibold text-ink">Connection details</div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-ink/70 min-w-0">
            Configured in:{' '}
            <span className="font-mono text-ink font-medium break-all">{provider.configuredIn}</span>
          </div>
          <span className="text-[11px] text-ink/40 italic shrink-0">
            {isDisabled ? 'hidden' : isConnected ? 'active' : 'inactive'}
          </span>
        </div>

        {(provider.api || provider.auth || provider.discovery || provider.transport) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {provider.api && (
              <span
                className="px-1.5 py-0.5 rounded border border-ink/15 text-[10px] font-mono text-ink/70"
                title="Wire API omp uses for this provider"
              >
                {provider.api}
              </span>
            )}
            {provider.auth && provider.auth !== 'apiKey' && (
              <span
                className="px-1.5 py-0.5 rounded border border-ink/15 text-[10px] font-mono text-ink/70"
                title="Auth mode from models.yml"
              >
                auth: {provider.auth}
              </span>
            )}
            {provider.discovery && (
              <span
                className="px-1.5 py-0.5 rounded border border-ink/15 text-[10px] font-mono text-ink/70"
                title="omp lists this provider's models live"
              >
                discovery: {provider.discovery}
              </span>
            )}
            {provider.transport && (
              <span
                className="px-1.5 py-0.5 rounded border border-ink/15 text-[10px] font-mono text-ink/70"
                title="Requests are routed through the auth gateway"
              >
                transport: {provider.transport}
              </span>
            )}
            {provider.headers && Object.keys(provider.headers).length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded border border-ink/15 text-[10px] font-mono text-ink/70"
                title={Object.entries(provider.headers).map(([key, value]) => `${key}: ${value}`).join('\n')}
              >
                {Object.keys(provider.headers).length} header
                {Object.keys(provider.headers).length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-b border-ink/10" />
    </div>
  );
}
