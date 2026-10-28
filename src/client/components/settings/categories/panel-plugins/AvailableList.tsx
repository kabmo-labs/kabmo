import { useState } from 'preact/hooks';
import { BookOpen, Download, Loader2, Store } from 'lucide-preact';
import type { PanelCatalogEntry } from '@/shared/types';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PluginReadmeModal } from '@/client/components/settings/categories/panel-plugins/ReadmeModal';
import {
  AuthorLine,
  SlotBadges,
  VersionLine,
} from '@/client/components/settings/categories/panel-plugins/Meta';
import { declaredContributions } from '@/client/hooks/workspace/plugin-contributions';

interface AvailableListProps {
  entries: PanelCatalogEntry[];
  busy: string | null;
  /** Install a store offer, by plugin id. */
  onInstall: (pluginId: string) => Promise<boolean>;
  /** Install a catalog entry that names a git URL, by URL. */
  onInstallUrl: (url: string) => Promise<boolean>;
}

/**
 * What the catalogs OFFER, as a grid of cards.
 *
 * A grid rather than a list because the unit here is a plugin, not a field of
 * one: a card has room for the mark, the name, the version, the author and the
 * description, and the eye scans a store by its marks. A row of stacked text
 * fields made every plugin look alike.
 *
 * TWO sources feed this grid and the card says which, because they behave
 * differently after installing: Kabmo's bundled store (kept current by Kabmo's
 * own update) and a git URL a `marketplace.json` curates (a clone the user
 * owns). Both are one noun to a reader — a plugin that can be installed — so
 * splitting them into two grids would make one catalog look like two.
 *
 * A card cannot ask a plugin what it contributes: its panels exist only once its
 * bundle has loaded, and an offer has no bundle here. What it CAN show is what
 * the manifest declares, drawn in the dashed variant so a claim never reads as
 * a fact.
 */
export function AvailableList({ entries, busy, onInstall, onInstallUrl }: AvailableListProps) {
  // Which README is open. A card's button is only rendered when the plugin
  // ships one, so a plugin with no README offers no button rather than one that
  // opens an error.
  const [reading, setReading] = useState<PanelCatalogEntry | null>(null);

  if (entries.length === 0) return null;

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <Store size={14} className="text-ink/50 flex-shrink-0" />
        <h3 className="text-sm font-medium text-ink">Available</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {entries.length} plugin{entries.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {entries.map((entry) => {
          // A store offer installs under `install:<id>` and a git offer under the
          // plain `install` label (it is addressed by URL, not by id) — so both
          // spellings are the same "this card is working".
          const installing = busy === 'install' || busy === `install:${entry.pluginId}`;
          const declared = declaredContributions(entry.slots);
          return (
            <article
              key={`${entry.origin}:${entry.pluginId}`}
              className="flex flex-col gap-2 border border-ink/10 rounded-lg p-3 bg-paper hover:border-ink/20 transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <PluginMark name={entry.name} iconUrl={entry.iconUrl} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate" title={entry.name}>
                    {entry.name}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {/* A git offer's catalog name IS its id, so printing both
                        would put the same word on two lines. */}
                    {entry.pluginId === entry.name ? null : (
                      <span className="text-[11px] text-ink/45 font-mono truncate" title={entry.pluginId}>
                        {entry.pluginId}
                      </span>
                    )}
                    <VersionLine version={entry.version} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-ink/5 border border-ink/10 text-[10px] text-ink/55"
                  title={
                    entry.origin === 'git'
                      ? 'Listed in marketplace.json as a git repository — installing clones it.'
                      : 'Shipped inside Kabmo’s own store.'
                  }
                >
                  {entry.origin === 'git' ? 'Git' : 'Bundled'}
                </span>
                <AuthorLine author={entry.author} />
              </div>

              {entry.description ? (
                <p className="text-[11px] text-ink/60 leading-relaxed line-clamp-3">{entry.description}</p>
              ) : null}

              <SlotBadges items={declared} declared />

              {entry.origin === 'git' && entry.url ? (
                <p className="text-[10px] font-mono text-ink/40 truncate" title={entry.url}>
                  {entry.url}
                </p>
              ) : null}

              <div className="mt-auto flex items-center gap-1.5 pt-1">
                {entry.readmeUrl ? (
                  <button
                    type="button"
                    onClick={() => setReading(entry)}
                    title={`Read ${entry.name}'s README`}
                    aria-label={`Read ${entry.name}'s README`}
                    className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border border-ink/15 hover:bg-ink/5 text-ink/70"
                  >
                    <BookOpen size={12} />
                    README
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    // A git offer installs by URL and a store offer by id: the
                    // two routes are the two install sources the server has,
                    // and picking the wrong one answers "no bundled plugin".
                    if (entry.origin === 'git' && entry.url) void onInstallUrl(entry.url);
                    else void onInstall(entry.pluginId);
                  }}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg border border-ink/20 text-[11px] text-ink/70 hover:text-ink hover:border-ink/40 transition-colors disabled:opacity-40"
                >
                  {installing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Install
                </button>
              </div>
            </article>
          );
        })}
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
