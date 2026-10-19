import { useState } from 'preact/hooks';
import { BookOpen, Download, Loader2, Store } from 'lucide-preact';
import type { PanelCatalogEntry } from '@/shared/types';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PluginReadmeModal } from '@/client/components/settings/categories/panel-plugins/ReadmeModal';

interface AvailableListProps {
  entries: PanelCatalogEntry[];
  busy: string | null;
  onInstall: (pluginId: string) => Promise<boolean>;
}

/**
 * What the bundled marketplace OFFERS, as a grid of cards.
 *
 * A grid rather than a list because the unit here is a plugin, not a field of
 * one: a card has room for the mark, the name, the version and the description,
 * and the eye scans a store by its marks. A row of stacked text fields made
 * every plugin look alike.
 *
 * A card cannot describe what the plugin CONTRIBUTES: its panels exist only once
 * its bundle has loaded, and this plugin is not installed yet, so there is
 * nothing to read. The description is what the author wrote for exactly this
 * purpose.
 */
export function AvailableList({ entries, busy, onInstall }: AvailableListProps) {
  // Which README is open. A card's button is only rendered when the plugin
  // ships one, so a plugin with no README offers no button rather than one that
  // opens an error.
  const [reading, setReading] = useState<PanelCatalogEntry | null>(null);

  if (entries.length === 0) return null;

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <Store size={14} className="text-ink/50 flex-shrink-0" />
        <h3 className="text-sm font-medium text-ink">Available from Kabmo</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {entries.length} plugin{entries.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {entries.map((entry) => (
          <article
            key={entry.pluginId}
            className="flex flex-col gap-2 border border-ink/10 rounded-lg p-3 bg-paper hover:border-ink/20 transition-colors"
          >
            <div className="flex items-start gap-2.5">
              <PluginMark name={entry.name} iconUrl={entry.iconUrl} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink truncate" title={entry.name}>
                  {entry.name}
                </div>
                <div className="text-[11px] text-ink/45 font-mono truncate" title={entry.pluginId}>
                  {entry.pluginId}
                </div>
              </div>
              <span className="text-[10px] text-ink/40 font-mono flex-shrink-0">v{entry.version}</span>
            </div>

            {entry.description ? (
              <p className="text-[11px] text-ink/60 leading-relaxed line-clamp-3">{entry.description}</p>
            ) : null}

            <div className="mt-auto flex items-center gap-1.5">
              {entry.readmeUrl ? (
                <button
                  type="button"
                  onClick={() => setReading(entry)}
                  title={`Read ${entry.name}'s README`}
                  aria-label={`Read ${entry.name}'s README`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded border border-ink/15 hover:bg-ink/5 text-ink/70"
                >
                  <BookOpen size={12} />
                  README
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void onInstall(entry.pluginId)}
                disabled={busy !== null}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded border border-ink/15 hover:bg-ink/5 disabled:opacity-40"
              >
                {busy === `install:${entry.pluginId}` ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                Install
              </button>
            </div>
          </article>
        ))}
      </div>

      {reading?.readmeUrl ? (
        <PluginReadmeModal
          pluginId={reading.pluginId}
          name={reading.name}
          readmeUrl={reading.readmeUrl}
          onClose={() => setReading(null)}
        />
      ) : null}
    </section>
  );
}
