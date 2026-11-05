import { useEffect, useState } from 'preact/hooks';
import { Check, DownloadCloud, Globe, Key, Layers } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import type {
  OmpProviderApi,
  PresetProviderOption,
  ProviderAuthMode,
  ProviderDiscoveryType,
  ProviderModelSource,
} from '@/shared/types/settings/provider';
import { fetchProviderModelsRemote } from '@/shared/lib/models/provider/models';
import { inferProviderApi } from '@/shared/lib/models/provider/dialect';
import { Modal } from '@/client/components/common/Modal';
import { DialectFields } from '@/client/components/settings/categories/provider-settings/DialectFields';
import { PresetPicker } from '@/client/components/settings/categories/provider-settings/PresetPicker';

interface AddProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProvider: (newProvider: ProviderItem, options: { fetchedCount: number; ompNote?: string }) => void;
  presets: PresetProviderOption[];
  /**
   * Slugs already present in the omp registry. A new provider's slug becomes a
   * models.yml key, so reusing one would overwrite that provider's entry.
   */
  existingSlugs: string[];
}

/** Slug shape omp accepts as a `models.yml` provider key. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The dialect a preset seeds, with the model-source its shape implies. */
function presetDefaults(preset: PresetProviderOption | undefined) {
  const api: OmpProviderApi = preset?.api ?? inferProviderApi(preset?.defaultUrl ?? '');
  return {
    api,
    auth: preset?.auth ?? ('apiKey' as ProviderAuthMode),
    discovery: preset?.discovery ?? ('openai-models-list' as ProviderDiscoveryType),
    source: (preset?.discovery
      ? 'discovery'
      : preset?.bundled
        ? 'override'
        : 'fetch') as ProviderModelSource,
  };
}

/**
 * Add Provider.
 *
 * The form exists to write ONE `models.yml` provider entry, so it asks for
 * exactly the fields omp reads: the endpoint, the wire dialect, the auth mode,
 * and where the model list comes from. Everything else is derived.
 *
 * Two shapes the previous version could not express are the point of this
 * dialog:
 *
 * - A provider omp already bundles (Azure, Bedrock, Vertex, Codex) is written
 *   as an OVERRIDE entry: omp keeps its own model list and only the endpoint
 *   changes. Writing ids for it would shadow the bundled catalog with a
 *   snapshot.
 * - A provider omp can discover (Ollama, LM Studio, llama.cpp, LiteLLM, any
 *   OpenAI-compatible endpoint) is registered with an EMPTY model list and a
 *   `discovery` block, so omp lists the models live instead of serving a frozen
 *   copy that goes stale the moment the endpoint adds one.
 */
export function AddProviderModal({
  isOpen,
  onClose,
  onAddProvider,
  presets,
  existingSlugs,
}: AddProviderModalProps) {
  const presetList = presets;
  const initialPreset = presetList[0];
  const initial = presetDefaults(initialPreset);
  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset?.id || 'openai');
  const [name, setName] = useState(initialPreset?.name || 'OpenAI');
  const [baseUrl, setBaseUrl] = useState(initialPreset?.defaultUrl || 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [api, setApi] = useState<OmpProviderApi>(initial.api);
  const [auth, setAuth] = useState<ProviderAuthMode>(initial.auth);
  const [source, setSource] = useState<ProviderModelSource>(initial.source);
  const [discovery, setDiscovery] = useState<ProviderDiscoveryType>(initial.discovery);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectPreset = (preset: PresetProviderOption) => {
    const defaults = presetDefaults(preset);
    setSelectedPresetId(preset.id);
    setName(preset.name);
    setBaseUrl(preset.defaultUrl);
    setApi(defaults.api);
    setAuth(defaults.auth);
    setDiscovery(defaults.discovery);
    setSource(defaults.source);
  };

  useEffect(() => {
    const selectedPreset = presetList.find((preset) => preset.id === selectedPresetId);
    if (!selectedPreset && presetList[0]) {
      handleSelectPreset(presetList[0]);
    }
  }, [presetList, selectedPresetId]);

  if (!isOpen) return null;

  const selectedPreset = presetList.find((p) => p.id === selectedPresetId);
  const trimmedName = name.trim();
  // Prefer the preset's own slug so a provider lands under the id omp knows it
  // by; only a renamed provider gets one derived from its display name.
  const slug = (trimmedName && selectedPreset && trimmedName === selectedPreset.name
    ? selectedPreset.slug
    : trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  ).toLowerCase();
  const takenSlugs = new Set(existingSlugs.map((value) => value.trim().toLowerCase()));
  // A bundled preset names a provider omp already ships, and its entry in
  // models.yml is an add-only OVERRIDE — reusing that slug is the point.
  const isBundledOverride = selectedPreset?.bundled === true;
  const slugError = !slug
    ? 'Enter a provider name to derive an id.'
    : !SLUG_PATTERN.test(slug)
      ? 'The derived id must start with a letter or digit.'
      : takenSlugs.has(slug) && !isBundledOverride
        ? `"${slug}" is already registered in models.yml — connecting it would overwrite that provider. Pick another name.`
        : '';
  // omp requires a key only for a provider that carries MODELS. An endpoint
  // override (omp keeps its own model list) and a discovery shell are both
  // valid without one — that is how a keyless local server and a proxy that
  // authenticates through `/login` are declared — so the key is optional there
  // rather than hidden, since a proxy usually still wants its own bearer.
  const showsApiKey = auth === 'apiKey';
  const requiresApiKey = showsApiKey && source === 'fetch';
  const keyError = requiresApiKey && !apiKey.trim()
    ? 'Enter the API key, or set Auth to "No auth" for a keyless local server.'
    : '';
  const canSubmit = Boolean(trimmedName) && !slugError && !keyError && !isSubmitting;

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      const timestamp = Date.now();
      const trimmedUrl = baseUrl.trim();
      const trimmedKey = apiKey.trim();
      const newProvider: ProviderItem = {
        id: `provider-${timestamp}`,
        name: trimmedName,
        slug,
        icon: selectedPreset?.icon || 'custom',
        status: 'connected',
        configuredIn: 'auth credentials',
        credentialSource: 'models.yml',
        baseUrl: trimmedUrl,
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
        api,
        ...(auth !== 'apiKey' ? { auth } : {}),
        ...(source === 'discovery' ? { discovery } : {}),
        modelSource: source,
        models: [],
      };

      const fetchResult = await fetchProviderModelsRemote({
        baseUrl: trimmedUrl,
        apiKey: trimmedKey || undefined,
        providerSlug: newProvider.slug,
        persistToOmp: true,
        api,
        auth,
        ...(source === 'discovery' ? { discovery } : {}),
        ...(source === 'override' ? { registerOnly: true } : {}),
      });

      if (fetchResult.ok && fetchResult.models) {
        newProvider.models = fetchResult.models;
        onAddProvider(newProvider, {
          fetchedCount: fetchResult.models.length,
          ompNote: fetchResult.omp?.reason,
        });
      } else {
        // The listing failed but the provider may still have been registered
        // (discovery/override shapes never list). Report what omp said rather
        // than a bare "failed" that hides a written file.
        onAddProvider(newProvider, {
          fetchedCount: -1,
          ompNote: fetchResult.omp?.written ? undefined : fetchResult.error,
        });
      }

      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      header={
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-ink/70" />
          <h3 className="text-sm font-semibold text-ink">Add Model Provider</h3>
        </div>
      }
      form={{ onSubmit: handleSubmit, className: 'p-5 space-y-4' }}
      maxWidthClass="max-w-lg"
      footer={
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-ink/10">
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
            className="px-3.5 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <DownloadCloud size={14} className="animate-pulse" />
                <span>{source === 'fetch' ? 'Fetching models...' : 'Registering...'}</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Connect Provider</span>
              </>
            )}
          </button>
        </div>
      }
    >
      {/* Preset Picker */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1.5">
          Provider Preset
        </label>
        <PresetPicker
          presets={presetList}
          selectedPresetId={selectedPresetId}
          onSelectPreset={handleSelectPreset}
        />
      </div>

      {/* Provider Name */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          Display Name
        </label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. My Provider"
          className="w-full bg-paper border border-ink/20 rounded-md px-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60"
        />
        {slug && (
          <p className="text-[10px] text-ink/40 mt-1 font-mono">
            models.yml id: {slug}
          </p>
        )}
        {slugError && (
          <p className="text-[11px] text-error mt-1">
            {slugError}
          </p>
        )}
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          API Base URL
        </label>
        <div className="relative flex items-center">
          <Globe size={13} className="absolute left-2.5 text-ink/40 pointer-events-none" />
          <input
            type="text"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.currentTarget.value)}
            placeholder="https://api.domain.com/v1"
            className="w-full bg-paper border border-ink/20 rounded-md pl-8 pr-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
          />
        </div>
      </div>

      <DialectFields
        api={api}
        onApiChange={setApi}
        auth={auth}
        onAuthChange={setAuth}
        source={source}
        onSourceChange={setSource}
        discovery={discovery}
        onDiscoveryChange={setDiscovery}
      />

      {/* API Key — hidden only for a keyless provider, which omp accepts
          without a credential at all. */}
      {showsApiKey && (
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            API Key (stored securely)
            {!requiresApiKey && <span className="font-normal text-ink/40"> (optional)</span>}
          </label>
          <div className="relative flex items-center">
            <Key size={13} className="absolute left-2.5 text-ink/40 pointer-events-none" />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder="sk-••••••••••••••••"
              className="w-full bg-paper border border-ink/20 rounded-md pl-8 pr-3 py-1.5 text-xs text-ink outline-none focus:border-ink/60 font-mono"
            />
          </div>
          {keyError && (
            <p className="text-[11px] text-error mt-1">{keyError}</p>
          )}
          <p className="text-[10px] text-ink/40 mt-1">
            {requiresApiKey
              ? 'May name an environment variable (e.g. '
              : 'Leave empty to keep using the provider’s existing credential. May name an environment variable (e.g. '}
            <span className="font-mono">MY_KEY</span>) or run a command with a leading{' '}
            <span className="font-mono">!</span>.
          </p>
        </div>
      )}
    </Modal>
  );
}
