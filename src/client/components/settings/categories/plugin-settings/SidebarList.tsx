import { useState } from 'preact/hooks';
import { AlertCircle, ArrowDownToLine, Check, Package, RefreshCw, Store, X } from 'lucide-preact';
import type { PluginItem, PluginMarketplaceItem } from '@/shared/types';
import { ProjectSelectorDropdown, type ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';
import { pluginSelectionKey } from '@/client/components/settings/categories/plugin-settings/selection';

export type PluginView = 'installed' | 'marketplaces';

interface PluginSidebarListProps {
  plugins: PluginItem[];
  marketplaces: PluginMarketplaceItem[];
  catalogCount: number;
  view: PluginView;
  onSelectView: (view: PluginView) => void;
  selectedPluginKey: string | null;
  onSelectPlugin: (key: string) => void;
  selectedProject: string;
  onSelectProject: (project: string) => void;
  projectOptions?: ProjectOption[];
  isWorkspaceScope: boolean;
  busy: string | null;
  error: string | null;
  onClearError: () => void;
  onInstall: (spec: string) => void;
  onRefresh: () => void;
}

/**
 * The Plugins list: a scope picker, a view switch, an install box, and the
 * installed plugins.
 *
 * The view switch is two SEGMENTS rather than a nested list because marketplaces
 * and plugins are different nouns — a marketplace has no enable flag, no
 * features and no settings — so a single tree would have to hide every row
 * action for half its nodes.
 */
export function PluginSidebarList({
  plugins,
  marketplaces,
  catalogCount,
  view,
  onSelectView,
  selectedPluginKey,
  onSelectPlugin,
  selectedProject,
  onSelectProject,
  projectOptions,
  isWorkspaceScope,
  busy,
  error,
  onClearError,
  onInstall,
  onRefresh,
}: PluginSidebarListProps) {
  const [spec, setSpec] = useState('');
  const installedCount = plugins.filter((plugin) => plugin.enabled).length;

  return (
    <div className="w-full md:w-72 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      <ProjectSelectorDropdown
        variant="compact"
        selectedProject={selectedProject}
        onChangeProject={onSelectProject}
        {...(projectOptions ? { options: projectOptions } : {})}
        getTriggerLabel={(options, value) =>
          options.find((option) => option.id === value || option.value === value)?.label || value
        }
      />

      {/* View switch. Each segment SETS its view; a toggle would flip the
          already-active segment back to the other one. */}
      <div className="px-3 pt-2.5">
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-ink/5 border border-ink/10">
          {([
            { id: 'installed' as const, label: 'Installed', count: plugins.length },
            { id: 'marketplaces' as const, label: 'Marketplaces', count: marketplaces.length },
          ]).map((segment) => (
            <button
              key={segment.id}
              type="button"
              onClick={() => onSelectView(segment.id)}
              aria-pressed={view === segment.id}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                view === segment.id ? 'bg-paper text-ink shadow-2xs' : 'text-ink/60 hover:text-ink'
              }`}
            >
              <span className="truncate">{segment.label}</span>
              <span className="font-mono text-[10px] text-ink/50">{segment.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-3.5 py-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          {view === 'installed' ? `${installedCount}/${plugins.length} enabled` : `${catalogCount} available`}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          title="Re-read omp's plugin registries"
          className="p-1 rounded-md text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} />
        </button>
      </div>

      {/* Install box. The spec grammar is omp's own: `name@marketplace`, an npm
          package, a git spec, or a local path (which links). */}
      {view === 'installed' && (
        <form
          className="px-3 pb-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = spec.trim();
            if (!value) return;
            onInstall(value);
            setSpec('');
          }}
        >
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={spec}
              onInput={(event) => setSpec(event.currentTarget.value)}
              placeholder="name@marketplace, npm, git, or ./path"
              spellcheck={false}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-ink/15 bg-paper focus:outline-none focus:border-ink/40 text-[11px] font-mono text-ink placeholder-ink/40 transition-colors"
            />
            <button
              type="submit"
              disabled={!spec.trim() || busy !== null}
              title={isWorkspaceScope ? 'Install into this workspace' : 'Install for all projects'}
              className="p-1.5 rounded-lg border border-ink/20 text-ink/70 hover:text-ink hover:border-ink/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowDownToLine size={14} />
            </button>
          </div>
          <p className="mt-1 text-[10px] text-ink/45 leading-snug">
            {isWorkspaceScope ? 'Installs into this workspace (.omp/plugins)' : 'Installs for all projects (~/.omp/plugins)'}
          </p>
        </form>
      )}

      {busy && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-lg border border-ink/15 bg-ink/5 text-[11px] text-ink/70 truncate">
          {busy}…
        </div>
      )}

      {error && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg border border-error/30 bg-error/5 text-[11px] text-error leading-snug">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 break-words">{error}</span>
          <button type="button" onClick={onClearError} aria-label="Dismiss" className="cursor-pointer">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-0.5">
        {view === 'marketplaces' ? (
          <MarketplaceRows marketplaces={marketplaces} />
        ) : plugins.length === 0 ? (
          <p className="px-2.5 py-6 text-[11px] text-ink/50 leading-relaxed text-center">
            No plugins installed in this scope. Install one above, or browse a marketplace.
          </p>
        ) : (
          plugins.map((plugin) => (
            <PluginRow
              key={pluginSelectionKey(plugin)}
              plugin={plugin}
              isSelected={pluginSelectionKey(plugin) === selectedPluginKey}
              onSelect={() => onSelectPlugin(pluginSelectionKey(plugin))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MarketplaceRows({ marketplaces }: { marketplaces: PluginMarketplaceItem[] }) {
  if (marketplaces.length === 0) {
    return (
      <p className="px-2.5 py-6 text-[11px] text-ink/50 leading-relaxed text-center">
        No marketplaces configured. Add one from the marketplace pane.
      </p>
    );
  }
  return (
    <>
      {marketplaces.map((marketplace) => (
        <div key={marketplace.name} className="px-2.5 py-2 rounded-lg text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Store size={13} className="text-ink/50 flex-shrink-0" />
            <span className="truncate font-medium text-ink">{marketplace.name}</span>
          </div>
          <p className="mt-0.5 pl-5 text-[10px] font-mono text-ink/50 truncate">{marketplace.sourceUri}</p>
          <p className="pl-5 text-[10px] text-ink/45">
            {marketplace.error ? <span className="text-error">{marketplace.error}</span> : `${marketplace.pluginCount ?? 0} plugins`}
          </p>
        </div>
      ))}
    </>
  );
}

function PluginRow({
  plugin,
  isSelected,
  onSelect,
}: {
  plugin: PluginItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
        isSelected ? 'bg-ink/10 text-ink shadow-2xs' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {plugin.kind === 'marketplace' ? (
            <Store size={13} className="text-ink/50 flex-shrink-0" />
          ) : (
            <Package size={13} className="text-ink/50 flex-shrink-0" />
          )}
          <span className="truncate text-xs font-medium">{plugin.name}</span>
          {plugin.enabled && <Check size={11} className="text-success flex-shrink-0" />}
        </div>
        <span className="text-[10px] font-mono text-ink/45 flex-shrink-0">{plugin.version || '—'}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 pl-[19px]">
        <span className="text-[10px] font-mono uppercase text-ink/50">{plugin.scope}</span>
        {plugin.shadowedBy && <span className="text-[10px] text-ink/45">shadowed</span>}
        {plugin.updateAvailable && (
          <span className="text-[10px] px-1 rounded bg-amber-500/15 text-amber-900 border border-amber-500/20">
            {plugin.updateAvailable}
          </span>
        )}
        {!plugin.enabled && <span className="text-[10px] text-ink/45">disabled</span>}
      </div>
    </button>
  );
}
