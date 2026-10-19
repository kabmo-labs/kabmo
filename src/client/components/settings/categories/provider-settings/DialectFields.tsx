import type {
  OmpProviderApi,
  ProviderAuthMode,
  ProviderDiscoveryType,
  ProviderModelSource,
} from '@/shared/types/settings/provider';
import {
  PROVIDER_APIS,
  PROVIDER_API_LABELS,
  PROVIDER_AUTH_MODES,
  PROVIDER_DISCOVERY_TYPES,
} from '@/shared/lib/models/provider/dialect';

interface DialectFieldsProps {
  api: OmpProviderApi;
  onApiChange: (api: OmpProviderApi) => void;
  auth: ProviderAuthMode;
  onAuthChange: (auth: ProviderAuthMode) => void;
  source: ProviderModelSource;
  onSourceChange: (source: ProviderModelSource) => void;
  discovery: ProviderDiscoveryType;
  onDiscoveryChange: (discovery: ProviderDiscoveryType) => void;
}

const SOURCE_OPTIONS: ReadonlyArray<{ value: ProviderModelSource; label: string; hint: string }> = [
  { value: 'fetch', label: 'Fetch now', hint: 'List the endpoint here and write the ids into models.yml' },
  { value: 'discovery', label: 'Let omp discover', hint: 'omp lists the models live on every run' },
  { value: 'override', label: 'Endpoint only', hint: 'Keep omp’s own model list, change only the URL' },
];

const fieldClass = 'w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 '
  + 'bg-paper focus:outline-none focus:border-ink text-ink transition-colors cursor-pointer';

/**
 * The provider DIALECT controls: wire API, auth mode, and where the model list
 * comes from.
 *
 * These three are the `models.yml` fields that decide whether a provider works
 * at all, and each one is a decision Kabmo cannot make for the user:
 *
 * - An Anthropic-shaped proxy reached with a Bearer header authorises nothing,
 *   and omp rejects an unknown `api` by disabling every custom provider in the
 *   file — so the dialect is picked from omp's own list, never guessed into it.
 * - `auth: none` is what makes a local server keyless; without it omp demands a
 *   key and the provider is reported as unconfigured.
 * - A provider omp can discover should not also receive a snapshot of ids, or
 *   the two lists drift as soon as the endpoint adds a model.
 */
export function DialectFields({
  api,
  onApiChange,
  auth,
  onAuthChange,
  source,
  onSourceChange,
  discovery,
  onDiscoveryChange,
}: DialectFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Wire API</label>
          <select
            value={api}
            onChange={(e) => onApiChange(e.currentTarget.value as OmpProviderApi)}
            className={fieldClass}
          >
            {PROVIDER_APIS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Auth</label>
          <select
            value={auth}
            onChange={(e) => onAuthChange(e.currentTarget.value as ProviderAuthMode)}
            className={fieldClass}
          >
            {PROVIDER_AUTH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[10px] text-ink/40 leading-relaxed -mt-1">
        {PROVIDER_API_LABELS[api]} · {PROVIDER_AUTH_MODES.find((m) => m.value === auth)?.hint}
      </p>

      <div>
        <label className="block text-xs font-semibold text-ink mb-1">Model source</label>
        <div className="grid grid-cols-3 gap-2">
          {SOURCE_OPTIONS.map((option) => {
            const isSelected = source === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSourceChange(option.value)}
                className={`px-2 py-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-ink/50 bg-ink/5 font-semibold text-ink'
                    : 'border-ink/15 hover:border-ink/30 text-ink/70'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-ink/40 mt-1 leading-relaxed">
          {SOURCE_OPTIONS.find((option) => option.value === source)?.hint}
        </p>
      </div>

      {source === 'discovery' && (
        <div>
          <label className="block text-xs font-semibold text-ink mb-1">Discovery protocol</label>
          <select
            value={discovery}
            onChange={(e) => onDiscoveryChange(e.currentTarget.value as ProviderDiscoveryType)}
            className={fieldClass}
          >
            {PROVIDER_DISCOVERY_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-ink/40 mt-1">
            {PROVIDER_DISCOVERY_TYPES.find((type) => type.value === discovery)?.hint}
          </p>
        </div>
      )}
    </>
  );
}
