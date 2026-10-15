import { useState } from 'preact/hooks';
import { BookOpen, Hammer, Loader2 } from 'lucide-preact';
import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';
import { RemovePluginButton } from '@/client/components/settings/categories/panel-plugins/InstallForm';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PluginReadmeModal } from '@/client/components/settings/categories/panel-plugins/ReadmeModal';
import { GitFreshness } from '@/client/components/settings/categories/panel-plugins/GitFreshness';
import type { PluginSlots, SlotName } from '@/client/lib/plugins/slots';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';

/** The four slots a plugin may fill, in the order a card lists them. */
const SLOT_ORDER: readonly SlotName[] = ['rightPanel', 'panel', 'headerPanel', 'settingsSection'];

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
  onBuild,
  onRemove,
  onSetEnabled,
  gitStatus,
  onUpdateGit,
}: InstalledGridProps) {
  const [reading, setReading] = useState<PanelPluginStatus | null>(null);

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-ink">Installed</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
        {plugins.map((plugin) => {
          const entry = slots.get(plugin.pluginId);
          const failure = failures.get(plugin.pluginId);
          // The ENABLEMENT key is the panel key, not the plugin id: it is the
          // id the client filters its panel catalog by, so a switch that wrote
          // the bare id would report success while the panel stayed hidden.
          const panelKey = pluginPanelKey(plugin.pluginId);
          const toggling = busy === `enable:${panelKey}` || busy === `disable:${panelKey}`;
          const contributed = entry ? SLOT_ORDER.filter((slot) => entry.components[slot]) : [];

          return (
            <article
              key={plugin.pluginId}
              className={`flex flex-col gap-2 border rounded-lg p-3 transition-colors ${
                plugin.enabled ? 'border-ink/10 bg-paper' : 'border-ink/10 bg-ink/[0.02]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className={plugin.enabled ? '' : 'opacity-50'}>
                  <PluginMark name={plugin.name} iconUrl={iconUrls.get(plugin.pluginId)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate" title={plugin.name}>
                    {plugin.name}
                  </div>
                  <div className="text-[11px] text-ink/45 font-mono truncate" title={plugin.pluginId}>
                    {plugin.pluginId}
                  </div>
                </div>
                {/* The switch is the card's primary control, so it sits where a
                    card's action belongs rather than in a row of chrome. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={plugin.enabled}
                  aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
                  disabled={busy !== null}
                  onClick={() => void onSetEnabled(panelKey, !plugin.enabled)}
                  title={plugin.enabled ? 'Disable — keep the files, remove its buttons' : 'Enable this plugin'}
                  className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 mt-0.5 disabled:opacity-40 ${
                    plugin.enabled ? 'bg-ink/70' : 'bg-ink/20'
                  }`}
                >
                  {toggling ? (
                    <Loader2 size={9} className="absolute inset-0 m-auto animate-spin text-canvas" />
                  ) : (
                    <span
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-canvas transition-all ${
                        plugin.enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  )}
                </button>
              </div>

              {/* Three distinct states, and the difference matters: a plugin
                  that is switched off has no components BY DESIGN, one whose
                  bundle failed has a reason to show, and one that loaded says
                  what it contributes. */}
              {!plugin.enabled ? (
                <p className="text-[11px] text-ink/45">Disabled — contributes nothing while the switch is off.</p>
              ) : failure ? (
                <p className="text-[11px] text-error">Bundle failed to load — {failure}</p>
              ) : !entry ? (
                <p className="text-[11px] text-ink/45">Loading bundle…</p>
              ) : contributed.length === 0 ? (
                <p className="text-[11px] text-ink/45">Loaded, but registers no panels.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {contributed.map((slot) => (
                    <span
                      key={slot}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink/10 text-ink/60"
                      title={entry.titles[slot] ?? slot}
                    >
                      {slot}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center gap-1.5 pt-1">
                {plugin.bundled ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink/10 text-ink/50">bundled</span>
                ) : null}
                {!plugin.built ? (
                  <button
                    type="button"
                    onClick={() => void onBuild(plugin.pluginId)}
                    disabled={busy !== null}
                    title={plugin.reason ? `Rebuild — ${plugin.reason}` : 'Rebuild this plugin'}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-warning/40 text-warning hover:bg-warning/10 disabled:opacity-40"
                  >
                    {busy === `build:${plugin.pluginId}` ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Hammer size={11} />
                    )}
                    Rebuild
                  </button>
                ) : null}
                <span className="ml-auto flex items-center gap-1">
                  {readmeUrls.get(plugin.pluginId) ? (
                    <button
                      type="button"
                      onClick={() => setReading(plugin)}
                      title={`Read ${plugin.name}'s README`}
                      aria-label={`Read ${plugin.name}'s README`}
                      className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/5 flex-shrink-0"
                    >
                      <BookOpen size={13} />
                    </button>
                  ) : null}
                  <RemovePluginButton pluginId={plugin.pluginId} disabled={busy !== null} onRemove={onRemove} />
                </span>
              </div>

              {!plugin.built ? (
                <p className="text-[11px] text-warning">
                  Not built{plugin.reason ? ` — ${plugin.reason}` : ''}. The bundle will 404 until it is built.
                </p>
              ) : null}

              {/* A git-installed plugin's freshness. Rendered for a clone only —
                  a bundled install is kept current by the chamber's own update,
                  so a git row there would describe a remote it does not have. */}
              {plugin.gitOrigin ? (
                <GitFreshness
                  status={gitStatus[plugin.pluginId]}
                  origin={plugin.gitOrigin}
                  busy={busy}
                  pluginId={plugin.pluginId}
                  onUpdate={onUpdateGit}
                />
              ) : null}
            </article>
          );
        })}
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
