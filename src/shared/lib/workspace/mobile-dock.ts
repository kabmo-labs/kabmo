/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which panels each phone drawer offers.
 *
 * The phone has TWO drawers and one catalog, so the split is a rule rather
 * than a per-component filter. It used to be one rule for the right drawer
 * (`all`, minus the session list), because a panel placed on the left had
 * nowhere else to be reached — the left drawer was a plain session list. Now
 * the left drawer draws the dock too, so leaving `all` in the right one puts a
 * single panel on two strips of one phone.
 *
 * Pure, and separate from both components, so the two drawers cannot drift and
 * the rule can be tested without mounting either.
 */

import type { PanelSide } from '@/shared/lib/workspace/left-dock';

/** The parts of a catalog entry these rules read. */
interface SidedPanel {
  id: string;
  side: PanelSide;
}

/**
 * The right drawer's chips.
 *
 * `all` while the left rail is OFF: a placed panel is then unreachable from the
 * left drawer (it has no strip), and hiding it from both would make the
 * placement look like an uninstall. With the rail on the left drawer owns them.
 */
export function phoneRightPanels<T extends SidedPanel>(
  panels: readonly T[],
  sessionsViewId: string,
  dockEnabled: boolean,
): T[] {
  return panels.filter(
    (panel) => panel.id !== sessionsViewId && !(dockEnabled && panel.side === 'left'),
  );
}

/**
 * Whether the left drawer draws its chip strip.
 *
 * A strip holding one chip is chrome that never changes, so it needs a second
 * destination — either a placed panel, or a stored view that no longer
 * resolves. The second half is the escape hatch: that body is a notice, and
 * without the strip the session list would be unreachable.
 */
export function phoneLeftStripVisible(dockEnabled: boolean, placedCount: number, showingSessions: boolean): boolean {
  return dockEnabled && (placedCount > 0 || !showingSessions);
}
