/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel placement: which destination each contributed panel is drawn on.
 *
 * The section was "Left dock", and its one question was "is this plugin's panel
 * on the left or the right?" — which could not be answered for a plugin that
 * contributes TWO panels. `marketplace/plugins/session-info` ships a `rightPanel`
 * and a `panel`, and with one row per plugin, moving its right panel onto the
 * left dock would have had no way to say what happened to the other one.
 *
 * So the row is per PANEL INSTANCE, and the row's destinations come from the
 * SLOT rather than from the plugin:
 *
 * - a `rightPanel` is a view — it rides the left dock or the right column;
 * - a `panel` is a takeover — it rides the editor column, and only that, because
 *   a takeover on a rail would be a button that opens a column it is not on.
 *
 * The dock's switch stays here as well, because a placement on the left is
 * invisible without the rail: placing a panel turns it on (`setPanelSide`), and
 * the pane says so rather than leaving the user to discover it.
 */

import { ArrowLeft, ArrowRight, Columns2, Loader2, PanelLeft, PanelRight } from 'lucide-preact';
import type { PanelPluginStatus } from '@/shared/types';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { SESSIONS_VIEW_ID, panelSideOf, ridesSides, type PanelSide } from '@/shared/lib/workspace/left-dock';
import type { PluginSlots } from '@/client/lib/plugins/slots';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

interface LeftDockSettingsProps {
  dock: LeftDockHandle;
  plugins: PanelPluginStatus[];
  slots: Map<string, PluginSlots>;
}

/** One contributed panel, with the row's own facts resolved. */
interface PlaceablePanel {
  plugin: PanelPluginStatus;
  key: string;
  /** The slot it was registered for, which decides where it may go. */
  slot: 'rightPanel' | 'panel';
  /** The destination it is on right now. */
  side: PanelSide;
  title: string;
}

/** The status line's wording, which is a sentence rather than a button label. */
const SIDE_STATUS: Record<PanelSide, string> = {
  left: 'Left dock',
  right: 'Right column',
  editor: 'Editor column',
};

/** What each destination is called, in a button and in a row's status line. */
const SIDE_LABEL: Record<PanelSide, string> = {
  left: 'left dock',
  right: 'right column',
  editor: 'editor column',
};

const SIDE_GLYPH: Record<PanelSide, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  editor: Columns2,
};

/**
 * The destinations one panel may be moved to.
 *
 * ONE button per destination rather than a toggle: there are up to three, so a
 * toggle cannot express the choice, and a button carrying the CURRENT position
 * would read as a state ("Left") on a control that is about to move it. Each
 * button therefore names its destination, and the one the panel is already on is
 * disabled — a control that can only go where it already is does nothing.
 */
function DestinationGroup({
  name,
  destinations,
  current,
  onMove,
}: {
  name: string;
  destinations: readonly PanelSide[];
  current: PanelSide;
  onMove: (side: PanelSide) => void;
}) {
  if (destinations.length < 2) return null;
  return (
    <span className="flex items-center gap-1 flex-shrink-0">
      {destinations.map((side) => {
        const Glyph = SIDE_GLYPH[side];
        const here = side === current;
        return (
          <button
            key={side}
            type="button"
            disabled={here}
            onClick={() => onMove(side)}
            title={here ? `${name} is on the ${SIDE_LABEL[side]}` : `Move ${name} to the ${SIDE_LABEL[side]}`}
            aria-label={here ? `${name} is on the ${SIDE_LABEL[side]}` : `Move ${name} to the ${SIDE_LABEL[side]}`}
            aria-pressed={here}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border flex-shrink-0 transition-colors ${
              here
                ? 'border-ink/30 bg-ink/10 text-ink/50 cursor-default'
                : 'border-ink/25 text-ink/80 hover:bg-ink/5 cursor-pointer'
            }`}
          >
            <Glyph size={11} />
            {side === 'left' ? 'Left' : side === 'right' ? 'Right' : 'Editor'}
          </button>
        );
      })}
    </span>
  );
}

export function LeftDockSettings({ dock, plugins, slots }: LeftDockSettingsProps) {
  // ONE row per contributed panel, not per plugin: a plugin may register both a
  // view and a takeover, and they are placed independently.
  const placeable: PlaceablePanel[] = [];
  for (const plugin of plugins) {
    const entry = slots.get(plugin.pluginId);
    if (!plugin.enabled || !entry) continue;
    for (const slot of ['rightPanel', 'panel'] as const) {
      if (!entry.components[slot]) continue;
      const key = pluginPanelKey(plugin.pluginId, slot);
      placeable.push({
        plugin,
        key,
        slot,
        side: panelSideOf(key, dock),
        title: entry.titles[slot] ?? plugin.name,
      });
    }
  }
  const loading = plugins.filter((plugin) => plugin.enabled && !slots.get(plugin.pluginId)).length;

  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-ink">Panel placement</h3>
        <span className="ml-auto text-[11px] text-ink/50">
          {dock.enabled ? `${dock.panels.length} on the rail` : 'rail off'}
        </span>
      </header>

      <p className="text-[11px] text-ink/50 mb-2">
        The left column always holds the session list. Turn its rail on to add views beside it — a
        panel placed there gets its own button and its own width, and leaves the right column. Each
        contributed panel is placed on its own: a plugin that ships two panels gets two rows.
      </p>

      {!dock.enabled ? (
        <p className="text-[11px] text-ink/45 mb-2">
          The rail is off. Placing a panel on the left turns it on, and you can switch it back off
          here at any time.
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
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          <div className="flex flex-col gap-1.5 border border-ink/10 rounded-lg px-2.5 py-2 bg-ink/[0.02]">
            <span className="min-w-0">
              <span className="block text-xs text-ink">Sessions</span>
              <span className="block text-[10px] text-ink/40">The dock's own view — always here.</span>
            </span>
            <span className="text-[10px] font-mono text-ink/40 self-start">{SESSIONS_VIEW_ID}</span>
          </div>

          {placeable.map(({ plugin, key, slot, side, title }) => {
            const destinations = ridesSides(slot);
            // TWO rows, not one. The identity block and the destination buttons
            // shared a line, and two buttons with glyphs and labels (`Left`
            // `Right`) took the width the title needed — so the title was
            // truncated inside a card that had room for it, at the very column
            // width this grid produces (240px). Stacked, the title gets the full
            // card and the buttons get their own row.
            return (
              <div key={key} className="flex flex-col gap-1.5 border border-ink/10 rounded-lg px-2.5 py-2">
                <span className="min-w-0">
                  <span className="block text-xs text-ink" title={`${title} — ${plugin.name}`}>
                    {title}
                    <span className="text-ink/40"> · {plugin.name}</span>
                  </span>
                  <span className="block text-[10px] text-ink/40">
                    {SIDE_STATUS[side]}
                    {slot === 'panel' ? ' · takeover' : ' · view'}
                    {side === 'left' && !dock.enabled ? ' · rail off' : ''}
                  </span>
                </span>
                {/* A takeover has one destination, so it gets a STATUS rather
                    than a control: a button that can only go where it already
                    is would be a control that does nothing. */}
                {destinations.length > 1 ? (
                  <DestinationGroup
                    name={title}
                    destinations={destinations}
                    current={side}
                    onMove={(next) => dock.setSide(key, next)}
                  />
                ) : (
                  <span
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-ink/10 text-ink/50 self-start"
                    title={`${title} draws the editor column — its slot has no other destination`}
                  >
                    <ArrowLeft size={11} className="opacity-40" />
                    Fixed
                  </span>
                )}
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

      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink/40">
        <ArrowRight size={11} className="mt-0.5 flex-shrink-0 opacity-60" />
        <span>
          A takeover draws the editor column whole, so its switch is the editor panel's own rail
          (Files · your panels). A view rides a rail and gets one button on the column it is placed
          on.
        </span>
      </p>
    </section>
  );
}
