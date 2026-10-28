/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One INSTALLED panel plugin, as a card.
 *
 * The card answers five questions in the order a reader asks them: what is this
 * (mark, name, id), which version am I running and is there a newer one, who
 * wrote it and where did it come from, what does it actually add, and what can I
 * do about it. Every one of those had a different home before — the version in a
 * 10px corner, the origin nowhere, the contributions a single raw slot name —
 * so a plugin could be installed, enabled and silently inert with nothing on
 * screen saying why.
 *
 * The switch is the primary control and sits where a card's action belongs. The
 * rest are icon buttons in the footer, and each one only appears when it can do
 * something: Rebuild only for an unbuilt bundle, Update only for a clone behind
 * its remote, README only when the plugin ships one.
 *
 * Its own file because the card grew past what the grid could hold and because
 * the AVAILABLE (store) card is the same shape with a different footer — the two
 * now share the version, author, origin and slot pieces in `Meta.tsx`.
 */

import { Hammer, Loader2, BookOpen } from 'lucide-preact';
import type { PanelGitStatus, PanelPluginStatus } from '@/shared/types';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { RemovePluginButton } from '@/client/components/settings/categories/panel-plugins/InstallForm';
import { GitFreshness } from '@/client/components/settings/categories/panel-plugins/GitFreshness';
import {
  AuthorLine,
  Fact,
  OriginBadge,
  SlotBadge,
  VersionLine,
} from '@/client/components/settings/categories/panel-plugins/Meta';
import { PlacementChips } from '@/client/components/settings/categories/panel-plugins/Placement';
import {
  contributionBadges,
  usePluginContributions,
} from '@/client/hooks/workspace/plugin-contributions';
import type { PluginSlots } from '@/client/lib/plugins/slots';
import { isPluginPanelSlot, pluginEnablementKey } from '@/shared/lib/workspace/panel-ids';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

interface PluginCardProps {
  plugin: PanelPluginStatus;
  /** Registrations, once the plugin's bundle has loaded. */
  entry: PluginSlots | undefined;
  /** Why the plugin's bundle could not load, when it could not. */
  failure: string | undefined;
  iconUrl: string | undefined;
  readmeUrl: string | undefined;
  busy: string | null;
  gitStatus: PanelGitStatus | undefined;
  /** Panel placement, so a panel's own card can say (and change) where it lives. */
  dock: LeftDockHandle;
  onReadme: () => void;
  onBuild: (pluginId: string) => Promise<boolean>;
  onRemove: (pluginId: string) => Promise<boolean>;
  onSetEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  onUpdateGit: (pluginId: string) => Promise<boolean>;
}

export function PluginCard({
  plugin,
  entry,
  failure,
  iconUrl,
  readmeUrl,
  busy,
  gitStatus,
  dock,
  onReadme,
  onBuild,
  onRemove,
  onSetEnabled,
  onUpdateGit,
}: PluginCardProps) {
  // The ENABLEMENT key is the panel key, not the plugin id: it is the id the
  // client filters its panel catalog by, so a switch that wrote the bare id
  // would report success while the panel stayed hidden.
  const panelKey = pluginEnablementKey(plugin.pluginId);
  const toggling = busy === `enable:${panelKey}` || busy === `disable:${panelKey}`;
  const contributions = usePluginContributions(plugin.pluginId);
  const badges = contributionBadges(contributions, plugin.slots);

  return (
    <article
      className={`flex flex-col gap-2 border rounded-lg p-3 transition-colors ${
        plugin.enabled ? 'border-ink/10 bg-paper' : 'border-ink/10 bg-ink/[0.02]'
      }`}
    >
      <header className="flex items-start gap-2.5">
        <div className={plugin.enabled ? '' : 'opacity-50'}>
          <PluginMark name={plugin.name} iconUrl={iconUrl} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium text-ink truncate" title={plugin.name}>
              {plugin.name}
            </span>
            {!plugin.built ? (
              <span className="text-[10px] px-1 rounded bg-warning/15 text-warning border border-warning/25 flex-shrink-0">
                not built
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] text-ink/45 font-mono truncate" title={plugin.pluginId}>
              {plugin.pluginId}
            </span>
            <VersionLine version={plugin.version} latest={plugin.latestVersion} />
          </div>
        </div>
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
      </header>

      {plugin.description ? (
        <p className="text-[11px] text-ink/60 leading-relaxed line-clamp-2">{plugin.description}</p>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <OriginBadge origin={plugin.origin} />
        <AuthorLine author={plugin.author} />
        {plugin.settingsCount ? (
          <Fact label="settings">{plugin.settingsCount}</Fact>
        ) : null}
        {plugin.homepage ? (
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-[10px] text-ink/45 hover:text-ink truncate max-w-[10rem]"
            title={plugin.homepage}
          >
            {hostOf(plugin.homepage)}
          </a>
        ) : null}
      </div>

      {/* Four distinct states, and the difference matters: a plugin that is
          switched off has no components BY DESIGN, one whose bundle failed has a
          reason to show, one that is still loading is neither, and one that
          loaded says what it contributes. */}
      {!plugin.enabled ? (
        <p className="text-[11px] text-ink/45">
          Disabled — contributes nothing while the switch is off.
          {badges.fromDeclaration ? ' The slots below are what its manifest declares.' : ''}
        </p>
      ) : failure ? (
        <p className="text-[11px] text-error leading-snug">Bundle failed to load — {failure}</p>
      ) : !entry ? (
        <p className="text-[11px] text-ink/45">Loading bundle…</p>
      ) : badges.items.length === 0 ? (
        <p className="text-[11px] text-ink/45">Loaded, but registers nothing — no panel, no button, no hook.</p>
      ) : null}

      {/* The badges name what the plugin contributes; a PANEL one also carries
          its placement, because a plugin registers a slot and never a column.
          A card that said only "panel view" would misdescribe the screen for a
          panel the user has already moved to the left dock. Chips are drawn
          only for a LIVE registration: a declared-only row names a panel the
          host never received, so there is nothing to place. */}
      {badges.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {badges.items.map((item) => (
            <span key={item.key} className="flex items-center gap-1">
              <SlotBadge item={item} declared={badges.fromDeclaration} />
              {!badges.fromDeclaration && isPluginPanelSlot(item.key) ? (
                <PlacementChips
                  name={item.title ?? plugin.name}
                  pluginId={plugin.pluginId}
                  slot={item.key}
                  dock={dock}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {!plugin.built ? (
        <p className="text-[11px] text-warning">
          Not built{plugin.reason ? ` — ${plugin.reason}` : ''}. The bundle will 404 until it is built.
        </p>
      ) : null}

      {/* A git-installed plugin's freshness. Rendered for a clone only — a
          bundled install is kept current by Kabmo's own update, so a git row
          there would describe a remote it does not have. */}
      {plugin.gitOrigin ? (
        <GitFreshness
          status={gitStatus}
          origin={plugin.gitOrigin}
          busy={busy}
          pluginId={plugin.pluginId}
          onUpdate={onUpdateGit}
          latestVersion={plugin.latestVersion}
        />
      ) : null}

      <footer className="mt-auto flex items-center gap-1.5 pt-1">
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
        {plugin.gitOrigin && gitStatus?.updateAvailable ? null : null}
        <span className="ml-auto flex items-center gap-1">
          {readmeUrl ? (
            <button
              type="button"
              onClick={onReadme}
              title={`Read ${plugin.name}'s README`}
              aria-label={`Read ${plugin.name}'s README`}
              className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/5 flex-shrink-0"
            >
              <BookOpen size={13} />
            </button>
          ) : null}
          <RemovePluginButton pluginId={plugin.pluginId} disabled={busy !== null} onRemove={onRemove} />
        </span>
      </footer>
    </article>
  );
}

/** The host of a homepage URL, so a footer link reads as a name rather than a URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
