/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel hue map, as a hook, so every surface reads the same one.
 *
 * The map covers the BUILT-IN views only, and it is computed over all of them
 * rather than over the ones a surface is drawing (`shared/lib/workspace/panel-hues.ts`
 * explains why). A plugin panel keeps its own mark colour instead — the brand
 * hex from its manifest, else the hue of its name — so it looks the same here as
 * on its marketplace card.
 */

import { useMemo } from 'preact/hooks';
import { resolvePanelHues } from '@/shared/lib/workspace/panel-hues';

/** The hue map, keyed by built-in panel id. */
export function usePanelHues(): ReadonlyMap<string, number> {
  // The universe is static, so this resolves once for the life of the page.
  return useMemo(resolvePanelHues, []);
}
