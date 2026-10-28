import { useState } from 'preact/hooks';
import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';
import { PluginCard } from '@/client/components/settings/categories/panel-plugins/PluginCard';
import { PluginReadmeModal } from '@/client/components/settings/categories/panel-plugins/ReadmeModal';
import type { PluginSlots } from '@/client/lib/plugins/slots';
import { isNewer } from '@/shared/lib/updates/semver';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

interface InstalledGridProps {
  plugins: PanelPluginStatus[];
  /** Registrations, once each plugin's bundle has loaded. */
  slots: Map<string, PluginSlots>;
  /** Why a plugin's bundle could not load, by plugin id. */
  failures: Map<string, string>;
  /** Installed plugins' icons, by plugin id. */
  iconUrls: Map<string, string | undefined>;
  /** Installed plugins' READMEs, by plugin id. */
  readmeUrls: Map<string, string | undefined>;
  busy: string | null;
  /** Panel placement, read once here and handed to every card. */
  dock: LeftDockHandle;
  onBuild: (pluginId: string) => Promise<boolean>;
  onRemove: (pluginId: string) => Promise<boolean>;
  onSetEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  /** The last known freshness of each git-installed plugin. */
  gitStatus: Record<string, PanelGitStatus>;
  onUpdateGit: (pluginId: string) => Promise<boolean>;
}

/**
 * The plugins that are INSTALLED, as a grid of cards.
 *
 * Cards come from the installed list, NOT from the loaded registrations: a
 * plugin that is switched off publishes no component at all, so a grid built
 * from registrations would make the plugin the user just disabled disappear —
 * the one card they need in order to switch it back on.
 *
 * What a plugin CONTRIBUTES is read from its registration, which is why the
 * slots and the failures both come in here: a plugin whose bundle has not
 * loaded yet, or failed, is a different answer from one that registered nothing,
 * and a card that showed nothing for all three would make them look alike.
 */
export function InstalledList({
  plugins,
  slots,
  failures,
  iconUrls,
  readmeUrls,
  busy,
  dock,
  onBuild,
  onRemove,
  onSetEnabled,
  gitStatus,
  onUpdateGit,
}: InstalledGridProps) {
  const [reading, setReading] = useState<PanelPluginStatus | null>(null);
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;
  // `isNewer`, not `!==`: a clone whose remote is at the SAME version is current,
  // and counting it would announce an update that changes nothing.
  const updates = plugins.filter(
    (plugin) => plugin.latestVersion !== undefined && isNewer(plugin.latestVersion, plugin.version),
  ).length;

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-ink">Installed</h3>
        <span className="text-[11px] text-ink/45">
          {enabledCount}/{plugins.length} enabled
        </span>
        {updates > 0 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning border border-warning/25">
            {updates} update{updates === 1 ? '' : 's'} available
          </span>
        ) : null}
      </header>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        {plugins.map((plugin) => (
          <PluginCard
            key={plugin.pluginId}
            plugin={plugin}
            entry={slots.get(plugin.pluginId)}
            failure={failures.get(plugin.pluginId)}
            iconUrl={iconUrls.get(plugin.pluginId)}
            readmeUrl={readmeUrls.get(plugin.pluginId)}
            busy={busy}
            gitStatus={gitStatus[plugin.pluginId]}
            dock={dock}
            onReadme={() => setReading(plugin)}
            onBuild={onBuild}
            onRemove={onRemove}
            onSetEnabled={onSetEnabled}
            onUpdateGit={onUpdateGit}
          />
        ))}
      </div>

      {reading && readmeUrls.get(reading.pluginId) ? (
        <PluginReadmeModal
          pluginId={reading.pluginId}
          name={reading.name}
          readmeUrl={readmeUrls.get(reading.pluginId) as string}
          onClose={() => setReading(null)}
        />
      ) : null}
    </section>
  );
}
