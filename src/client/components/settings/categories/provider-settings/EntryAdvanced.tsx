import { Plus, X } from 'lucide-preact';
import { PROVIDER_DISCOVERY_TYPES } from '@/shared/lib/models/provider/dialect';
import type { ProviderDiscoveryType } from '@/shared/types/settings/provider';

const fieldClass = 'w-full text-xs py-2 px-3 rounded-lg border border-ink/20 hover:border-ink/40 '
  + 'bg-paper focus:outline-none focus:border-ink text-ink transition-colors';

/** The discovery types whose `/v1/models` rows carry a reasoning ladder. */
const ADVERTISED_REASONING_TYPES: Readonly<Record<string, true>> = {
  'openai-models-list': true,
  'lm-studio': true,
  proxy: true,
};

export interface DiscoveryDraft {
  type: ProviderDiscoveryType | '';
  timeoutMs: string;
  injectV1: boolean | undefined;
  advertisedReasoning: boolean | undefined;
}

interface EntryAdvancedProps {
  discovery: DiscoveryDraft;
  onDiscoveryChange: (next: DiscoveryDraft) => void;
  headers: Array<{ key: string; value: string }>;
  onHeadersChange: (next: Array<{ key: string; value: string }>) => void;
}

/**
 * The `models.yml` fields a provider rarely needs but omp honours: its own
 * discovery block, and pinned request headers.
 *
 * Each control is narrowed to what omp's schema accepts for the chosen
 * discovery type, and the narrowing is the whole reason this is a component:
 * `injectV1` outside `openai-models-list` and `advertisedReasoning` outside the
 * three `/v1/models` readers are REFUSED by omp, and one refused field disables
 * every custom provider in the file. Offering a checkbox the server would have
 * to silently drop is worse than not offering it.
 */
export function EntryAdvanced({
  discovery,
  onDiscoveryChange,
  headers,
  onHeadersChange,
}: EntryAdvancedProps) {
  const patch = (next: Partial<DiscoveryDraft>) => onDiscoveryChange({ ...discovery, ...next });
  const showInjectV1 = discovery.type === 'openai-models-list';
  const showAdvertised = ADVERTISED_REASONING_TYPES[discovery.type] === true;

  const setHeader = (index: number, next: Partial<{ key: string; value: string }>) => {
    onHeadersChange(headers.map((header, at) => (at === index ? { ...header, ...next } : header)));
  };

  return (
    <>
      <div>
        <label className="block text-xs font-semibold text-ink mb-1">
          Discovery <span className="font-normal text-ink/40">— optional</span>
        </label>
        <select
          value={discovery.type}
          onChange={(e) => patch({ type: e.currentTarget.value as ProviderDiscoveryType | '' })}
          className={fieldClass}
        >
          <option value="">— omp uses the registered model list —</option>
          {PROVIDER_DISCOVERY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-ink/40 mt-1 leading-relaxed">
          {discovery.type
            ? PROVIDER_DISCOVERY_TYPES.find((type) => type.value === discovery.type)?.hint
            : 'With discovery set, omp lists this provider’s models live and importing here would freeze a snapshot beside that list.'}
        </p>
      </div>

      {discovery.type && (
        <div className="space-y-2 pl-3 border-l-2 border-ink/10">
          <div>
            <label className="block text-[11px] font-medium text-ink/70 mb-1">
              Timeout <span className="font-normal text-ink/40">— ms, optional</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={discovery.timeoutMs}
              onChange={(e) => patch({ timeoutMs: e.currentTarget.value })}
              placeholder="omp default"
              className={`${fieldClass} font-mono`}
            />
          </div>
          {showInjectV1 && (
            <label className="flex items-start gap-2 text-[11px] text-ink/70">
              <input
                type="checkbox"
                checked={discovery.injectV1 === true}
                onChange={(e) => patch({ injectV1: e.currentTarget.checked })}
                className="mt-0.5"
              />
              <span>
                Skip the forced <span className="font-mono">/v1</span> prefix — for a gateway rooted at a
                versioned path.
              </span>
            </label>
          )}
          {showAdvertised && (
            <label className="flex items-start gap-2 text-[11px] text-ink/70">
              <input
                type="checkbox"
                checked={discovery.advertisedReasoning === true}
                onChange={(e) => patch({ advertisedReasoning: e.currentTarget.checked })}
                className="mt-0.5"
              />
              <span>Trust the reasoning ladder the endpoint advertises in its model rows.</span>
            </label>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="block text-xs font-semibold text-ink">
            Request headers <span className="font-normal text-ink/40">— optional</span>
          </label>
          <button
            type="button"
            onClick={() => onHeadersChange([...headers, { key: '', value: '' }])}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            <Plus size={11} />
            <span>add</span>
          </button>
        </div>
        {headers.length === 0 ? (
          <p className="text-[10px] text-ink/40 leading-relaxed">
            Sent with every request to this provider — the place for a gateway’s routing or
            version header.
          </p>
        ) : (
          <div className="space-y-1.5">
            {headers.map((header, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={header.key}
                  onChange={(e) => setHeader(index, { key: e.currentTarget.value })}
                  placeholder="Header-Name"
                  aria-label={`Header ${index + 1} name`}
                  className={`${fieldClass} font-mono`}
                />
                <input
                  type="text"
                  value={header.value}
                  onChange={(e) => setHeader(index, { value: e.currentTarget.value })}
                  placeholder="value"
                  aria-label={`Header ${index + 1} value`}
                  className={`${fieldClass} font-mono`}
                />
                <button
                  type="button"
                  onClick={() => onHeadersChange(headers.filter((_, at) => at !== index))}
                  title="Remove this header"
                  aria-label={`Remove header ${index + 1}`}
                  className="shrink-0 p-1.5 rounded text-ink/40 hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
