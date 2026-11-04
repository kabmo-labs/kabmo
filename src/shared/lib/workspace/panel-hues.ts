/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The colour a BUILT-IN panel's mark is drawn in, as one fact for every surface.
 *
 * A built-in panel's mark is drawn by the activity bar, the phone's chip strip
 * and the Built-in list in Settings, and each of them used to answer "what
 * colour is this?" differently: the rail hashed the PANEL ID (`files` → 0°),
 * while the two lists drew the glyph and therefore took the GLYPH's hue
 * (`lucide-files` → 320°, and `lucide-book-open` even fell through to the `info`
 * signal colour). One panel, two colours — measured, the same `Files` mark was
 * `hsl(0 …)` in the rail and `hsl(320 …)` in Settings.
 *
 * The answer is computed ONCE, over the whole SET of built-in views rather than
 * over whatever a surface happens to be drawing:
 *
 * - **The universe is fixed, not the drawn set.** Every built-in view plus the
 *   dock's own view, including the ones switched OFF — because the Settings list
 *   draws exactly those, and the colour must not change when a view is toggled
 *   or dragged.
 * - **Collisions are resolved over that same universe** (`assignPanelHues`), so
 *   two neighbours never land on one blue, and the answer does not depend on the
 *   order a surface asks in.
 *
 * A PLUGIN panel is deliberately absent: its colour is the plugin's OWN mark
 * colour (the brand hex its manifest declares, else the hue of its name), the
 * same one its marketplace card draws. Keying that by the slot id instead would
 * give one plugin two colours — the exact defect this module removes.
 */

import { assignPanelHues, hashHue } from '@/shared/lib/icons/tint';
import { RIGHT_PANEL_TYPES } from '@/shared/lib/workspace/right-panels';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';

/** Every id the built-in hue map is computed over: all of them, drawn or not. */
export function panelHueUniverse(): string[] {
  return [SESSIONS_VIEW_ID, ...RIGHT_PANEL_TYPES];
}

/** The hue map every surface reads. */
export function resolvePanelHues(): Map<string, number> {
  return assignPanelHues(panelHueUniverse());
}

/**
 * The hue for one panel id, with the plain hash as the fallback.
 *
 * An id outside the universe is one this build does not know — a plugin's slot,
 * an id from a newer version. A stable hash still gives it a colour on the same
 * wheel instead of the neutral default every unknown glyph shares.
 */
export function panelHueOf(hues: ReadonlyMap<string, number>, panelId: string): number {
  return hues.get(panelId) ?? hashHue(panelId);
}
