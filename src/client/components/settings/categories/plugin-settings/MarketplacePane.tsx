import { useMemo, useState } from 'preact/hooks';
import { AlertCircle, Download, Plus, RefreshCw, Search, Trash2, X } from 'lucide-preact';
import type { PluginCatalogItem, PluginItem, PluginMarketplaceItem } from '@/shared/types';

interface PluginMarketplacePaneProps {
  marketplaces: PluginMarketplaceItem[];
  catalog: PluginCatalogItem[];
  plugins: PluginItem[];
  busy: string | null;
  error: string | null;
  onClearError: () => void;
  workspace: string | null;
  run: (label: string, body: Record<string, unknown>) => Promise<boolean>;
}

/**
 * Marketplaces and the plugins they offer.
 *
 * A marketplace is not a plugin: it has no enable flag, no features and no
 * settings, and its actions are catalog-level (re-fetch, remove). Its plugins
 * are therefore rendered as a catalog to install FROM rather than as another
 * tree of installed rows — installing one switches the sidebar back to the
 * installed list, which is where its features and settings live.
 *
 * The catalog is the cached `marketplace.json` omp cloned, so a plugin that is
 * not listed here cannot be installed by name either; `Update` is what re-fetches
 * it, and a catalog that could not be read says so instead of rendering as an
 * empty marketplace.
 */
export function PluginMarketplacePane({
  marketplaces,
  catalog,
  plugins,
  busy,
  error,
  onClearError,
  workspace,
  run,
}: PluginMarketplacePaneProps) {
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>('');
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const isBusy = busy !== null;
  const installedIds = useMemo(() => new Set(plugins.map((plugin) => plugin.id)), [plugins]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (marketplaceFilter && item.marketplace !== marketplaceFilter) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        (item.category ?? '').toLowerCase().includes(needle)
      );
    });
  }, [catalog, marketplaceFilter, query]);

  return (
    <div className="flex-1 flex flex-col h-full scrollbar-overlay-container bg-paper text-ink p-6 md:p-8 space-y-6">
      <div className="pb-4 border-b border-ink/10">
        <h2 className="text-sm font-bold tracking-tight text-ink">Marketplaces</h2>
        <p className="text-xs text-ink/60 mt-0.5 leading-relaxed">
          A marketplace is a git repository (or local directory) publishing a catalog at
          {' '}<span className="font-mono text-ink/70">.omp-plugin/marketplace.json</span>. Adding one clones it
          and lets its plugins install by <span className="font-mono text-ink/70">name@marketplace</span>.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg border border-error/30 bg-error/5 text-[11px] text-error leading-snug">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 break-words">{error}</span>
          <button type="button" onClick={onClearError} aria-label="Dismiss" className="cursor-pointer">
            <X size={12} />
          </button>
        </div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = source.trim();
          if (!value) return;
          void run(`Adding ${value}`, { type: 'add_marketplace', source: value });
          setSource('');
        }}
      >
        <input
          type="text"
          value={source}
          onInput={(event) => setSource(event.currentTarget.value)}
          placeholder="owner/repo, https://…, git@…, or ./path"
          spellcheck={false}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-ink/15 bg-paper focus:outline-none focus:border-ink/40 text-xs font-mono text-ink placeholder-ink/40 transition-colors"
        />
        <button
          type="submit"
          disabled={!source.trim() || isBusy}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> Add
        </button>
      </form>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Configured</h3>
        {marketplaces.length === 0 ? (
          <p className="text-[11px] text-ink/50 leading-relaxed">
            No marketplaces configured. Add one above — for example
            {' '}<span className="font-mono text-ink/70">anthropics/claude-plugins-official</span>, which omp
            itself documents as the starting catalog.
          </p>
        ) : (
          <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
            {marketplaces.map((marketplace) => (
              <div key={marketplace.name} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-ink truncate">{marketplace.name}</span>
                    <span className="text-[10px] font-mono uppercase text-ink/45">{marketplace.sourceType}</span>
                  </div>
                  <p className="text-[11px] font-mono text-ink/50 truncate">{marketplace.sourceUri}</p>
                  <p className="text-[10px] text-ink/45">
                    {marketplace.error ? (
                      <span className="text-error">{marketplace.error}</span>
                    ) : (
                      `${marketplace.pluginCount ?? 0} plugins · updated ${formatDate(marketplace.updatedAt)}`
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void run(`Updating ${marketplace.name}`, {
                        type: 'update_marketplace',
                        name: marketplace.name,
                      })
                    }
                    title="Re-fetch this catalog"
                    className="p-1.5 rounded-lg border border-ink/20 text-ink/60 hover:text-ink hover:border-ink/40 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <RefreshCw size={13} />
                  </button>
                  {confirmingRemove === marketplace.name ? (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          void run(`Removing ${marketplace.name}`, {
                            type: 'remove_marketplace',
                            name: marketplace.name,
                          });
                          setConfirmingRemove(null);
                        }}
                        className="px-2 py-1 rounded-lg border border-error text-error text-[11px] font-medium hover:bg-error/5 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRemove(null)}
                        className="px-1.5 py-1 rounded-lg text-[11px] text-ink/60 hover:text-ink cursor-pointer"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmingRemove(marketplace.name)}
                      title="Remove this marketplace (installed plugins stay)"
                      className="p-1.5 rounded-lg border border-ink/20 text-ink/60 hover:border-error hover:text-error transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {catalog.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">
              Available plugins
              <span className="ml-1.5 font-mono text-[10px] text-ink/45">
                {filtered.length}/{catalog.length}
              </span>
            </h3>
            <div className="flex items-center gap-2">
              <select
                value={marketplaceFilter}
                onChange={(event) => setMarketplaceFilter(event.currentTarget.value)}
                className="px-2 py-1 rounded-lg border border-ink/15 bg-paper text-[11px] text-ink cursor-pointer focus:outline-none focus:border-ink/40"
              >
                <option value="">All marketplaces</option>
                {marketplaces.map((marketplace) => (
                  <option key={marketplace.name} value={marketplace.name}>{marketplace.name}</option>
                ))}
              </select>
              <div className="relative flex items-center">
                <Search size={12} className="absolute left-2 text-ink/40 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Filter"
                  className="w-40 pl-6 pr-2 py-1 rounded-lg border border-ink/15 bg-paper text-[11px] text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-ink/10 divide-y divide-ink/5 max-h-[420px] overflow-y-auto scrollbar-overlay-container">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-[11px] text-ink/50 text-center">No plugin matches this filter.</p>
            ) : (
              filtered.map((item) => (
                <CatalogRow
                  key={`${item.marketplace}::${item.name}`}
                  item={item}
                  installed={installedIds.has(`${item.name}@${item.marketplace}`)}
                  disabled={isBusy}
                  workspace={workspace}
                  run={run}
                />
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function CatalogRow({
  item,
  installed,
  disabled,
  workspace,
  run,
}: {
  item: PluginCatalogItem;
  installed: boolean;
  disabled: boolean;
  workspace: string | null;
  run: (label: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const spec = `${item.name}@${item.marketplace}`;
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink font-mono truncate">{item.name}</span>
          {item.category && (
            <span className="text-[10px] px-1 rounded bg-ink/5 text-ink/50 border border-ink/10">
              {item.category}
            </span>
          )}
          {item.version && <span className="text-[10px] font-mono text-ink/45">{item.version}</span>}
        </div>
        <p className="text-[11px] text-ink/60 leading-snug mt-0.5 line-clamp-2">{item.description}</p>
        <p className="text-[10px] font-mono text-ink/40">{item.marketplace}</p>
      </div>
      {installed ? (
        <span className="text-[10px] text-ink/45 flex-shrink-0 mt-0.5">installed</span>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void run(`Installing ${spec}`, {
              type: 'install',
              spec,
              ...(workspace ? { root: workspace } : { scope: 'user' }),
            })
          }
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-ink/20 text-[11px] text-ink/70 hover:text-ink hover:border-ink/40 transition-colors cursor-pointer flex-shrink-0 disabled:opacity-40"
        >
          <Download size={12} /> Install
        </button>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString();
}
