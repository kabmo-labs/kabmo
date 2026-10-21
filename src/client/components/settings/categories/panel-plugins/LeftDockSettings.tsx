/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The left dock's settings: whether its rail is drawn, and which panels live on
 * it.
 *
 * Two controls, and they answer two different questions:
 *
 * - **The switch** is the FEATURE's. Off (the default) means the left column is
 *   the session list and nothing else: no rail, no second width to reserve, no
 *   catalog read. That is what makes the dock free for the users who never place
 *   a plugin on the left, and it is why this is not simply "show every panel on
 *   both rails".
 * - **The placement list** is the user's. A plugin keeps registering
 *   `app.rightPanel(...)`; where it is drawn is decided here. One id therefore
 *   keeps meaning one panel for the enablement set, the width map, the stored
 *   order and the server's own bundle gate.
 *
 * The rows come from the LOADED registrations rather than from the registry
 * payload: the payload names plugins, not slots, so a plugin that has not
 * imported yet has no panel to place. A plugin listed as installed but with no
 * component is reported as still loading rather than as having nothing.
 */

import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-preact';
import type { PanelPluginStatus } from '@/shared/types';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import type { PluginSlots } from '@/client/lib/plugins/slots';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

interface LeftDockSettingsProps {
  dock: LeftDockHandle;
  plugins: PanelPluginStatus[];
  slots: Map<string, PluginSlots>;
}

export function LeftDockSettings({ dock, plugins, slots }: LeftDockSettingsProps) {
  const placed = new Set(dock.panels);
  // Only a plugin that actually registered a right panel has a panel to place;
  // the rest are listed nowhere, because a row that cannot be moved is noise.
  const placeable = plugins
    .filter((plugin) => plugin.enabled && slots.get(plugin.pluginId)?.components.rightPanel)
    .map((plugin) => ({ plugin, key: pluginPanelKey(plugin.pluginId) }));
  const loading = plugins.filter((plugin) => plugin.enabled && !slots.get(plugin.pluginId)).length;

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-ink">Left dock</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {dock.enabled ? `${placed.size} on the rail` : 'rail off'}
        </span>
      </header>

      <p className="text-[11px] text-ink/50 mb-2">
        The left column always holds the session list. Turn its rail on to add views beside it — a
        plugin panel you place here gets its own button and its own width, and leaves the right
        column.
      </p>
      {/* The two controls are dependent — a placement is invisible without the
          rail — so the pane says which way the dependency runs instead of
          leaving the user to discover it. */}
      {!dock.enabled ? (
        <p className="text-[11px] text-ink/45 mb-2">
          The rail is off. Placing a panel below turns it on, and you can switch it back off here at
          any time.
        </p>
      ) : null}

      <div className="flex items-center gap-2.5 border border-ink/10 rounded-lg px-2.5 py-2 mb-2">
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-ink">Show the left activity bar</span>
          <span className="block text-[10px] text-ink/40">
            Off by default. With it off the column shows only its active view.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={dock.enabled}
          aria-label={dock.enabled ? 'Hide the left activity bar' : 'Show the left activity bar'}
          onClick={() => dock.setEnabled(!dock.enabled)}
          className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
            dock.enabled ? 'bg-ink/70' : 'bg-ink/20'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-canvas transition-all ${
              dock.enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {placeable.length === 0 ? (
        <p className="text-[11px] text-ink/45">
          {loading > 0
            ? `Loading ${loading} plugin ${loading === 1 ? 'bundle' : 'bundles'}…`
            : 'No installed plugin contributes a panel yet. Install one from the store above and it appears here.'}
        </p>
      ) : (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
          <div className="flex items-center gap-2.5 border border-ink/10 rounded-lg px-2.5 py-2 bg-ink/[0.02]">
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-ink">Sessions</span>
              <span className="block text-[10px] text-ink/40">The dock's own view — always here.</span>
            </span>
            <span className="text-[10px] font-mono text-ink/40">{SESSIONS_VIEW_ID}</span>
          </div>
          {placeable.map(({ plugin, key }) => {
            const onLeft = placed.has(key);
            return (
              <div key={key} className="flex items-center gap-2.5 border border-ink/10 rounded-lg px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink truncate" title={plugin.name}>
                    {plugin.name}
                  </span>
                  <span className="block text-[10px] text-ink/40">
                    {onLeft ? 'Left column' : 'Right column'}
                    {onLeft && !dock.enabled ? ' · rail off' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => dock.setSide(key, onLeft ? 'right' : 'left')}
                  title={
                    onLeft
                      ? `Move ${plugin.name} to the right column`
                      : dock.enabled
                        ? `Place ${plugin.name} on the left`
                        : `Place ${plugin.name} on the left and show the rail`
                  }
                  aria-label={
                    onLeft
                      ? `Move ${plugin.name} to the right column`
                      : dock.enabled
                        ? `Place ${plugin.name} on the left`
                        : `Place ${plugin.name} on the left and show the rail`
                  }
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-ink/15 text-ink/70 hover:bg-ink/5 flex-shrink-0"
                >
                  {onLeft ? <ArrowRight size={11} /> : <ArrowLeft size={11} />}
                  {onLeft ? 'Right' : 'Left'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {loading > 0 && placeable.length > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink/45">
          <Loader2 size={11} className="animate-spin" />
          {loading} plugin {loading === 1 ? 'bundle is' : 'bundles are'} still loading.
        </p>
      ) : null}
    </section>
  );
}
