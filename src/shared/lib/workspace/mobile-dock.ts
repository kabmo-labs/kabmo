/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * **The left drawer's strip follows the rail SWITCH and nothing else.** It used
 * to need a second destination (a placed panel, or a stored view that no longer
 * resolves), on the reasoning that a strip holding only `Sessions` is chrome
 * that never changes. That rule made the Settings switch — "Show the left
 * activity bar" — a no-op on every phone with no plugin panel placed on the
 * left: the rail was on, the desktop column drew its `Sessions` button, and the
 * phone drawer drew nothing, which reads as the switch being broken. On a phone
 * the strip IS the rail, so it is drawn whenever the rail is on.
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
 * The switch alone: on a phone the strip is the rail, so "Show the left activity
 * bar" that draws nothing is a control with no effect. The strip holding one
 * `Sessions` chip is the honest picture of a rail with one view on it — the same
 * picture the desktop column draws — and it grows the moment a panel is placed.
 */
export function phoneLeftStripVisible(dockEnabled: boolean): boolean {
  return dockEnabled;
}
