import { AlertCircle, CheckCircle2, Copy, ExternalLink, Key, Loader2 } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';
import { Modal } from '@/client/components/common/Modal';
import { useProviderLogin, deviceCodeOf, canOpenLocally } from '@/client/hooks/settings/providers/login';

interface LoginModalProps {
  isOpen: boolean;
  provider: ProviderItem;
  onClose: () => void;
  onAuthenticated: () => void;
}

/**
 * Sign in to an OAuth provider through omp's own `/login` flow.
 *
 * Everything the flow needs is on screen, because each piece is the ONLY way
 * some provider can be completed:
 *
 * - the authorization URL, shown and copyable (a device flow is finished on
 *   another machine, so a link that cannot be copied is a dead end);
 * - omp's `instructions`, with a device code lifted out of the sentence;
 * - an input field for the pasted code or redirect URL;
 * - the progress lines omp sends while it waits.
 *
 * The dialog never cancels a flow it does not understand: `open_url` without a
 * `launchUrl` is a NORMAL device flow, and treating it as an unknown method is
 * what made every device-code login fail instantly.
 */
export function LoginModal({ isOpen, provider, onClose, onAuthenticated }: LoginModalProps) {
  const { state, inputValue, setInputValue, submitInput } = useProviderLogin({
    isOpen,
    providerId: provider.slug,
    onAuthenticated,
  });
  if (!isOpen) return null;

  const deviceCode = deviceCodeOf(state.instructions);
  const canOpen = canOpenLocally(state.launchUrl ?? state.authUrl);
  const openTarget = state.launchUrl ?? state.authUrl;

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).catch(() => {});
  };

  return (
    <Modal
      onClose={onClose}
      header={
        <div className="flex items-center gap-2.5">
          <ProviderIconPlate provider={provider} size={26} />
          <div>
            <h3 className="text-sm font-semibold text-ink">Sign in to {provider.name}</h3>
            <p className="text-[11px] text-ink/50 font-mono">{provider.slug}</p>
          </div>
        </div>
      }
      footer={
        <div className="px-5 py-3 border-t border-ink/10 flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink/45">
            {state.status === 'success'
              ? 'omp stored the credential — its models appear in the chat picker.'
              : 'The browser step runs on omp’s side; this dialog follows it.'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            {state.status === 'success' ? 'Done' : 'Close'}
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        {state.status === 'connecting' && !state.prompt && (
          <div className="flex items-center gap-2.5 text-xs text-ink/70">
            <Loader2 size={14} className="animate-spin" />
            Starting the login flow…
          </div>
        )}

        {state.authUrl && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-ink">Authorization URL</div>
            <p className="text-[11px] text-ink/55 leading-relaxed">
              {canOpen
                ? 'Finish the sign-in in the browser tab that opened. If it did not open, use the link below.'
                : 'This URL belongs to the machine running omp. Open it there, or copy it into a browser on that machine.'}
            </p>
            <div className="flex items-start gap-2">
              <code className="flex-1 min-w-0 text-[11px] font-mono break-all bg-ink/5 border border-ink/10 rounded-md px-2.5 py-2 text-ink/80 select-text">
                {state.authUrl}
              </code>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => copy(state.authUrl as string)}
                  title="Copy the authorization URL"
                  aria-label="Copy the authorization URL"
                  className="p-1.5 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
                >
                  <Copy size={13} />
                </button>
                {canOpen && openTarget && (
                  <button
                    type="button"
                    onClick={() => window.open(openTarget, '_blank', 'noopener')}
                    title="Open the authorization URL"
                    aria-label="Open the authorization URL"
                    className="p-1.5 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {deviceCode && (
          <div className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-2.5 space-y-1.5">
            <div className="text-[11px] font-semibold text-ink">Device code</div>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono font-semibold tracking-[0.12em] text-ink select-text">
                {deviceCode}
              </code>
              <button
                type="button"
                onClick={() => copy(deviceCode)}
                title="Copy the device code"
                aria-label="Copy the device code"
                className="p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
              >
                <Copy size={12} />
              </button>
            </div>
            <p className="text-[10px] text-ink/50 leading-relaxed select-text">{state.instructions}</p>
          </div>
        )}

        {!deviceCode && state.instructions && (
          <p className="text-[11px] text-ink/60 leading-relaxed select-text">{state.instructions}</p>
        )}

        {state.prompt && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Key size={13} className="text-ink/50" />
              {state.prompt.title ?? state.prompt.message ?? 'Authorization code'}
            </div>
            <input
              type="text"
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitInput(false)}
              placeholder={state.prompt.placeholder ?? 'Paste the code or the full redirect URL'}
              className="w-full bg-paper border border-ink/20 rounded-md px-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => submitInput(true)}
                className="px-3 py-1.5 rounded-md border border-ink/20 text-xs text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submitInput(false)}
                disabled={!inputValue.trim()}
                className="px-3.5 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {state.notices.length > 0 && (
          <ul className="space-y-1">
            {state.notices.map((notice, index) => (
              <li key={`${index}-${notice}`} className="flex items-start gap-2 text-[11px] text-ink/60">
                <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />
                <span className="select-text">{notice}</span>
              </li>
            ))}
          </ul>
        )}

        {state.status === 'success' && (
          <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
            <CheckCircle2 size={14} /> Signed in. omp stored the credential.
          </div>
        )}
        {state.status === 'failed' && (
          <div className="flex items-start gap-2 text-xs text-error font-medium">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="select-text">{state.error ?? 'Login failed'}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
