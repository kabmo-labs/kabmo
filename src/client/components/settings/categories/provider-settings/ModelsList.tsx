import { useMemo, useState } from 'preact/hooks';
import {
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-preact';
import type { ProviderModel } from '@/shared/types';
import { formatContextWindow } from '@/shared/lib/code/format';
import { formatPrice } from '@/shared/lib/format/number';
import { MODEL_KIND_LABELS, modelKindOf, type ProviderModelKind } from '@/shared/lib/models/provider/dialect';

interface ProviderModelsListProps {
  models: ProviderModel[];
  /** Why the list is empty, when it legitimately is — never a generic excuse. */
  emptyReason?: string;
  onToggleModelVisibility: (modelId: string) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  /** Ask omp to re-run discovery (`omp models refresh`). */
  onRefreshModels: () => Promise<void>;
  /** Opens the manual "Add Model" dialog. */
  onAddModel: () => void;
  /**
   * Probe the provider's endpoint and write the ids into models.yml.
   * Absent for a provider whose list omp owns — the button then has nothing to
   * promise, and a snapshot beside a live discovery list is the drift the
   * writer's `overrideOnly` exists to prevent.
   */
  onImportModels?: () => Promise<void>;
  /**
   * Why a fetch is not possible, or undefined when it is. One prop rather than a
   * boolean plus a message: the button's `disabled` state and its tooltip have
   * to come from the same rule, or they can disagree about why it is off.
   */
  fetchBlockReason?: string;
  isFetchingModels: boolean;
  onOpenModelConfig: (model: ProviderModel) => void;
  onOpenModelCapabilities: (model: ProviderModel) => void;
}

/**
 * A provider's models, grouped by omp's own kind.
 *
 * The kind tabs are not decoration: a provider routinely serves an embedding
 * model, an image model and a reranker beside its chat models, and a flat list
 * made them look like chat models that behave oddly. The counts come from the
 * rows themselves, so a tab appears exactly when the provider has one.
 *
 * The price badge is omp's own accounting (`cost` + `pricingStatus`), and the
 * capability icons come from the row's declared `input` and `thinking` — the
 * panel used to hardcode `hasVision: false` / `hasTools: true`, so a vision
 * model read as text-only while the agent used it for images.
 */
export function ProviderModelsList({
  models,
  emptyReason,
  onToggleModelVisibility,
  onHideAll,
  onShowAll,
  onRefreshModels,
  onImportModels,
  onAddModel,
  fetchBlockReason,
  isFetchingModels,
  onOpenModelConfig,
  onOpenModelCapabilities,
}: ProviderModelsListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [kind, setKind] = useState<ProviderModelKind | 'all'>('all');

  const counts = useMemo(() => {
    const map = new Map<ProviderModelKind, number>();
    for (const model of models) {
      const entry = modelKindOf(model.kind);
      map.set(entry, (map.get(entry) ?? 0) + 1);
    }
    return map;
  }, [models]);

  const kinds = useMemo(() => [...counts.entries()].sort((a, b) => b[1] - a[1]), [counts]);

  const filteredModels = models.filter((model) => {
    if (kind !== 'all' && modelKindOf(model.kind) !== kind) return false;
    if (!searchQuery.trim()) return true;
    const needle = searchQuery.trim().toLowerCase();
    return model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle);
  });

  const hiddenCount = models.filter((model) => !model.isVisible).length;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="text-xs font-semibold text-ink">
          Models <span className="font-normal text-ink/60">({models.length})</span>
          {hiddenCount > 0 && (
            <span className="font-normal text-ink/40"> · {hiddenCount} hidden</span>
          )}
        </div>

        {/* Wraps: four action chips need ~330px, which the detail pane does not
            have in a two-pane modal at a 768-900px window. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefreshModels}
            disabled={isFetchingModels}
            title="Ask omp to re-run model discovery for every provider"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink text-canvas text-[11px] font-medium hover:opacity-90 transition-opacity cursor-pointer border border-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={12} className={isFetchingModels ? 'animate-spin' : ''} />
            <span>{isFetchingModels ? 'refreshing…' : 'refresh'}</span>
          </button>
          {onImportModels && (
            <button
              type="button"
              onClick={onImportModels}
              disabled={Boolean(fetchBlockReason) || isFetchingModels}
              title={fetchBlockReason ?? 'List this endpoint’s models and register them in models.yml'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink/5 hover:bg-ink/10 text-[11px] font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer border border-ink/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} />
              <span>import</span>
            </button>
          )}
          {/* Manual registration, for the ids no listing endpoint reports:
              a gateway model its /models omits, an Azure deployment name, a
              provider with no listing route at all (Bedrock, Vertex). */}
          <button
            type="button"
            onClick={onAddModel}
            title="Register a model by hand"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink/5 hover:bg-ink/10 text-[11px] font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer border border-ink/10"
          >
            <Plus size={12} />
            <span>add model</span>
          </button>
          <button
            type="button"
            onClick={onHideAll}
            disabled={models.length === 0}
            title="Hide every model from the chat picker"
            className="px-2.5 py-1 rounded bg-ink/5 hover:bg-ink/10 text-[11px] font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer border border-ink/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            hide all
          </button>
          <button
            type="button"
            onClick={onShowAll}
            disabled={hiddenCount === 0}
            title="Show every model in the chat picker"
            className="px-2.5 py-1 rounded bg-ink/5 hover:bg-ink/10 text-[11px] font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer border border-ink/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            show all
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setKind('all')}
          aria-pressed={kind === 'all'}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
            kind === 'all'
              ? 'border-ink/40 bg-ink/10 text-ink'
              : 'border-ink/10 text-ink/60 hover:text-ink hover:border-ink/25'
          }`}
        >
          All <span className="font-mono text-ink/45">{models.length}</span>
        </button>
        {kinds.map(([entry, count]) => (
          <button
            key={entry}
            type="button"
            onClick={() => setKind(entry)}
            aria-pressed={kind === entry}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
              kind === entry
                ? 'border-ink/40 bg-ink/10 text-ink'
                : 'border-ink/10 text-ink/60 hover:text-ink hover:border-ink/25'
            }`}
          >
            {MODEL_KIND_LABELS[entry]} <span className="font-mono text-ink/45">{count}</span>
          </button>
        ))}
      </div>

      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-ink/40 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder="Filter models by id or name…"
          aria-label="Filter models"
          className="w-full bg-paper border border-ink/15 rounded-lg pl-9 pr-9 py-2 text-xs text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors shadow-2xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            title="Clear the filter"
            aria-label="Clear the model filter"
            className="absolute right-2 p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="space-y-1 pt-1">
        {filteredModels.length === 0 ? (
          <div className="py-8 text-center text-xs text-ink/40">
            {searchQuery || kind !== 'all'
              ? 'No model matches this filter.'
              : emptyReason || 'No models registered for this provider yet.'}
          </div>
        ) : (
          filteredModels.map((model) => {
            const modelKind = modelKindOf(model.kind);
            return (
              <div
                key={model.id}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-ink/5 transition-colors group ${
                  !model.isVisible ? 'opacity-50' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`text-xs font-medium truncate ${
                        model.isVisible ? 'text-ink' : 'text-ink/60 line-through decoration-ink/40'
                      }`}
                      title={model.id}
                    >
                      {model.name}
                    </span>
                    {modelKind !== 'chat' && (
                      <span className="shrink-0 px-1 py-0 rounded border border-ink/15 text-[9px] font-mono uppercase tracking-wide text-ink/55">
                        {MODEL_KIND_LABELS[modelKind]}
                      </span>
                    )}
                  </div>
                  {model.name !== model.id && (
                    <span className="text-[10px] font-mono text-ink/40 truncate block">{model.id}</span>
                  )}
                </div>

                {/* Wraps rather than running past the pane: a long price plus a
                    context badge plus three icons exceeds the detail pane's
                    width in a two-pane modal on a ~768px window. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(model.priceInput !== undefined || model.priceOutput !== undefined) && (
                    <span
                      title={`$${model.priceInput ?? '?'} in / $${model.priceOutput ?? '?'} out per 1M tokens${
                        model.pricingStatus && model.pricingStatus !== 'exact'
                          ? ` (${model.pricingStatus})`
                          : ''
                      }`}
                      className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink/5 text-ink/70 border border-ink/10"
                    >
                      {formatPrice(model.priceInput)} / {formatPrice(model.priceOutput)}
                    </span>
                  )}

                  {model.contextWindow && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink/5 text-ink/70 border border-ink/10">
                      {formatContextWindow(model.contextWindow)}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenModelCapabilities(model)}
                    title="What this model declares — tools, vision, reasoning"
                    aria-label={`Capabilities of ${model.name}`}
                    className="p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
                  >
                    <SlidersHorizontal size={13} strokeWidth={1.8} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenModelConfig(model)}
                    title="Per-model overrides omp honours (max output, reasoning level)"
                    aria-label={`Configure ${model.name}`}
                    className="p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
                  >
                    <Settings2 size={13} strokeWidth={1.8} />
                  </button>

                  {model.hasVision && (
                    <span
                      title="Accepts image input"
                      className="p-1 text-ink/60"
                      aria-label="Accepts image input"
                    >
                      <ImageIcon size={13} strokeWidth={1.8} />
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onToggleModelVisibility(model.id)}
                    title={model.isVisible ? 'Hide model from chat picker' : 'Show model in chat picker'}
                    aria-label={model.isVisible ? `Hide ${model.name}` : `Show ${model.name}`}
                    aria-pressed={model.isVisible}
                    className={`p-1 rounded transition-colors cursor-pointer ${
                      model.isVisible
                        ? 'text-ink/60 hover:text-ink hover:bg-ink/10'
                        : 'text-ink/30 hover:text-ink/70 hover:bg-ink/10'
                    }`}
                  >
                    {model.isVisible ? (
                      <Eye size={14} strokeWidth={1.8} />
                    ) : (
                      <EyeOff size={14} strokeWidth={1.8} />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
