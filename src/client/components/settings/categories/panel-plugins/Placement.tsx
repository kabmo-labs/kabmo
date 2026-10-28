/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a contributed panel is drawn, and the control that moves it.
 *
 * A plugin registers a SLOT, never a column: `app.rightPanel(...)` is a view
 * with its own button, and the USER decides whether that button lives on the
 * left dock or in the right column. So a card that said only "right panel" was
 * describing the registration and misdescribing the screen — a plugin sitting on
 * the left dock read as if it were on the right.
 *
 * The rule is the slot's (`ridesSides`), never a per-call-site copy: a
 * `rightPanel` rides left or right, a `panel` takeover rides the editor column
 * and nothing else. A destination the slot cannot use is not offered, because a
 * button that would be refused is worse than no button.
 *
 * The control is the same one the Panel placement section draws — one button per
 * destination, the current one disabled — so a card and that section cannot
 * teach two different gestures for one operation. It writes through the dock's
 * own store, which is what turns the rail on when a panel is placed on the left.
 */

import { Columns2, PanelLeft, PanelRight } from 'lucide-preact';
import { panelSideOf, ridesSides, type PanelSide } from '@/shared/lib/workspace/left-dock';
import { pluginPanelKey, type PluginPanelSlot } from '@/shared/lib/workspace/panel-ids';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

/** What each destination is called on a button, in a card and in the settings row. */
export const SIDE_LABEL: Record<PanelSide, string> = {
  left: 'left dock',
  right: 'right column',
  editor: 'editor column',
};

/** The short form a chip shows. */
const SIDE_SHORT: Record<PanelSide, string> = { left: 'Left', right: 'Right', editor: 'Editor' };

const SIDE_GLYPH: Record<PanelSide, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  editor: Columns2,
};

interface PlacementChipsProps {
  /** The panel's title, for the buttons' accessible names. */
  name: string;
  /** The plugin the panel belongs to. */
  pluginId: string;
  /** The slot it registered, which decides where it may go. */
  slot: PluginPanelSlot;
  /** The dock's handle, so a move goes through the store that owns placement. */
  dock: LeftDockHandle;
}

/**
 * The destinations one panel may be moved to, with the current one marked.
 *
 * Rendered only when there is a CHOICE. A takeover's only home is the editor
 * column, and a chip row of one disabled button is a control that can never do
 * anything — the badge beside it already says what the panel is.
 */
export function PlacementChips({ name, pluginId, slot, dock }: PlacementChipsProps) {
  const destinations = ridesSides(slot);
  if (destinations.length < 2) return null;

  const key = pluginPanelKey(pluginId, slot);
  const current = panelSideOf(key, dock);

  return (
    <span className="flex items-center gap-0.5 flex-shrink-0" data-placement-for={key}>
      {destinations.map((side) => {
        const Glyph = SIDE_GLYPH[side];
        const here = side === current;
        return (
          <button
            key={side}
            type="button"
            disabled={here}
            onClick={() => dock.setSide(key, side)}
            title={here ? `${name} is on the ${SIDE_LABEL[side]}` : `Move ${name} to the ${SIDE_LABEL[side]}`}
            aria-label={here ? `${name} is on the ${SIDE_LABEL[side]}` : `Move ${name} to the ${SIDE_LABEL[side]}`}
            aria-pressed={here}
            className={`flex items-center gap-0.5 px-1 py-0.5 rounded border text-[10px] transition-colors ${
              here
                ? 'border-ink/30 bg-ink/10 text-ink/50 cursor-default'
                : 'border-ink/20 text-ink/70 hover:bg-ink/5 hover:text-ink cursor-pointer'
            }`}
          >
            <Glyph size={10} />
            {SIDE_SHORT[side]}
          </button>
        );
      })}
    </span>
  );
}
