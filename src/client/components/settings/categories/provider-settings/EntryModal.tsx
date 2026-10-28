import { useEffect, useState } from 'preact/hooks';
import type { FormEvent } from 'preact/compat';
import { AlertCircle, Globe, Info, Key, Save } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';
import { Modal } from '@/client/components/common/Modal';
import {
  EntryAdvanced,
  type DiscoveryDraft,
} from '@/client/components/settings/categories/provider-settings/EntryAdvanced';
import { saveProviderEntry, type ProviderEntryPatch } from '@/shared/lib/models/provider/connection';
import {
  PROVIDER_APIS,
  PROVIDER_API_LABELS,
  PROVIDER_AUTH_MODES,
} from '@/shared/lib/models/provider/dialect';
import type { OmpProviderApi, ProviderAuthMode } from '@/shared/types/settings/provider';

interface ProviderEntryModalProps {
  isOpen: boolean;
  provider: ProviderItem;
  onClose: () => void;
  /** Called after a successful write so the panel reloads the merged registry. */
  onSaved: (changed: string[]) => void;
}

const fieldClass = 'w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 '
  + 'bg-paper focus:outline-none focus:border-ink text-ink transition-colors';

const MASKED_KEY = 'sk-••••••••••••••••••••••••';

/**
 * Edit a `models.yml` provider entry — the endpoint, credential and dialect omp
 * actually reads.
 *
 * This dialog exists because the panel's "connect" control wrote Kabmo's SQLite
 * overlay, which the registry merge discards for any slug `models.yml` owns. A
 * rotated key or a moved endpoint was stored where nothing reads it: the panel
 * reported "connected", omp kept using the old credential, and a reload reverted
 * the display. Every field here goes through `PUT /api/settings/provider-entry`.
 *
 * The key field starts EMPTY with a placeholder that says a value is already
 * stored — prefilling the mask and saving it would replace a working credential
 * with a string that authenticates nothing (the server refuses that, and the
 * dialog should not offer it).
 */
export function ProviderEntryModal({ isOpen, provider, onClose, onSaved }: ProviderEntryModalProps) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [api, setApi] = useState<OmpProviderApi | ''>(provider.api ?? '');
  const [auth, setAuth] = useState<ProviderAuthMode>(provider.auth ?? 'apiKey');
  const [discovery, setDiscovery] = useState<DiscoveryDraft>({
    type: provider.discovery ?? '',
    timeoutMs: '',
    injectV1: undefined,
    advertisedReasoning: undefined,
  });
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(
    Object.entries(provider.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounting is the reset: the dialog is keyed by the provider it edits, so a
  // different provider never inherits the previous one's draft.
  useEffect(() => {
    if (!isOpen) return;
    setBaseUrl(provider.baseUrl ?? '');
    setApiKey('');
    setApi(provider.api ?? '');
    setAuth(provider.auth ?? 'apiKey');
    setDiscovery({
      type: provider.discovery ?? '',
      timeoutMs: '',
      injectV1: undefined,
      advertisedReasoning: undefined,
    });
    setHeaders(Object.entries(provider.headers ?? {}).map(([key, value]) => ({ key, value })));
    setError(null);
  }, [isOpen, provider.id, provider.baseUrl, provider.api, provider.auth, provider.discovery]);

  if (!isOpen) return null;

  // The registry never sends key material, so "a credential exists" is read from
  // its ORIGIN — the two values that mean omp can already resolve one. Testing
  // `provider.apiKey` was always false, which made the dialog demand a key the
  // provider already had and disabled Save on an entry that needed no change.
  const hasStoredKey = provider.credentialOrigin === 'models.yml' || provider.credentialOrigin === 'api-key';
  const keyless = auth !== 'apiKey';
  const keyError = !keyless && !apiKey.trim() && !hasStoredKey
    ? 'omp needs a credential for a keyed provider — enter the key, or switch Auth to "No auth".'
    : '';
  const canSubmit = !isSaving && !keyError;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    const patch: ProviderEntryPatch = {};
    const trimmedUrl = baseUrl.trim();
    if (trimmedUrl !== (provider.baseUrl ?? '')) patch.baseUrl = trimmedUrl || null;
    // An empty field means "leave the stored key alone"; clearing a credential
    // is `sign out`, not an empty text box.
    if (apiKey.trim()) patch.apiKey = apiKey.trim();
    if (api && api !== provider.api) patch.api = api;
    if (auth !== (provider.auth ?? 'apiKey')) patch.auth = auth;
    if (discovery.type !== (provider.discovery ?? '')) {
      patch.discovery = discovery.type
        ? {
          type: discovery.type,
          ...(discovery.timeoutMs.trim() && Number(discovery.timeoutMs) > 0
            ? { timeoutMs: Number(discovery.timeoutMs) }
            : {}),
          ...(discovery.injectV1 !== undefined ? { injectV1: discovery.injectV1 } : {}),
          ...(discovery.advertisedReasoning !== undefined
            ? { advertisedReasoning: discovery.advertisedReasoning }
            : {}),
        }
        : null;
    }
    // Headers are compared as a map so reordering alone is not a "change".
    const nextHeaders = Object.fromEntries(
      headers.filter((header) => header.key.trim()).map((header) => [header.key.trim(), header.value.trim()]),
    );
    const currentHeaders = provider.headers ?? {};
    const headersDiffer = JSON.stringify(nextHeaders) !== JSON.stringify(currentHeaders);
    if (headersDiffer) patch.headers = Object.keys(nextHeaders).length > 0 ? nextHeaders : null;

    if (Object.keys(patch).length === 0) {
      setIsSaving(false);
      onClose();
      return;
    }

    const result = await saveProviderEntry(provider.slug, patch);
    setIsSaving(false);
    if (!result.ok) {
      // omp's own sentence names the field it refused; the dialog stays open on
      // it so the value can be fixed rather than retyped from scratch.
      setError(result.error ?? 'Could not write the provider entry.');
      return;
    }
    onSaved(result.changed ?? []);
    onClose();
  };

  return (
    <Modal
      onClose={onClose}
      header={
        <div className="flex items-center gap-2.5">
          <ProviderIconPlate provider={provider} size={26} />
          <div>
            <h3 className="text-sm font-semibold text-ink">Edit connection</h3>
            <p className="text-[11px] text-ink/50 font-mono">models.yml · {provider.slug}</p>
          </div>
        </div>
      }
      form={{ onSubmit: handleSubmit, className: 'p-5 space-y-4' }}
      footer={
        <div className="pt-3 flex items-center justify-end gap-2 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3.5 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            <Save size={13} />
            <span>{isSaving ? 'Saving…' : 'Save to models.yml'}</span>
          </button>
        </div>
      }
    >
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">Endpoint URL</label>
        <div className="relative flex items-center">
          <Globe size={13} className="absolute left-2.5 text-ink/40 pointer-events-none" />
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.currentTarget.value)}
            placeholder="https://api.example.com/v1"
            className={`${fieldClass} pl-8 font-mono`}
          />
        </div>
      </div>

      {keyless ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-ink/5 border border-ink/10 text-[11px] text-ink/60">
          <Info size={13} className="mt-0.5 flex-shrink-0 text-ink/50" />
          <span>
            Registered with <span className="font-mono">auth: {auth}</span> — omp sends no API key for this
            provider. Switch Auth to “API key” if the endpoint starts requiring one.
          </span>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            API key
            {hasStoredKey && <span className="font-normal text-ink/40"> — stored; leave empty to keep it</span>}
          </label>
          <div className="relative flex items-center">
            <Key size={13} className="absolute left-2.5 text-ink/40 pointer-events-none" />
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder={hasStoredKey ? MASKED_KEY : 'sk-…'}
              autoComplete="off"
              spellcheck={false}
              className={`${fieldClass} pl-8 font-mono`}
            />
          </div>
          {keyError && <p className="text-[11px] text-error mt-1">{keyError}</p>}
          <p className="text-[10px] text-ink/40 mt-1 leading-relaxed">
            A literal key, or <span className="font-mono">!command</span> to have omp run a command for it —
            both are stored in <span className="font-mono">models.yml</span>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Wire API</label>
          <select
            value={api}
            onChange={(e) => setApi(e.currentTarget.value as OmpProviderApi)}
            className={fieldClass}
          >
            <option value="">— inherit omp’s —</option>
            {PROVIDER_APIS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Auth</label>
          <select
            value={auth}
            onChange={(e) => setAuth(e.currentTarget.value as ProviderAuthMode)}
            className={fieldClass}
          >
            {PROVIDER_AUTH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </div>
      </div>
      {api && (
        <p className="text-[10px] text-ink/40 leading-relaxed -mt-2">{PROVIDER_API_LABELS[api]}</p>
      )}

      <EntryAdvanced
        discovery={discovery}
        onDiscoveryChange={setDiscovery}
        headers={headers}
        onHeadersChange={setHeaders}
      />

      {error && (
        <div className="flex items-start gap-2 text-[11px] text-error">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="select-text">{error}</span>
        </div>
      )}
    </Modal>
  );
}
