/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One panel id, ONE hue — the property that four surfaces were breaking.
 *
 * The measurements that motivated this: `Files` drew at `hsl(0 …)` on the
 * activity bar (hash of the PANEL id) and `hsl(320 …)` in Settings → Panel
 * Plugins → Built-in (hash of the GLYPH `Files`), and `Wiki`'s `BookOpen` was
 * `info` in Settings because a glyph that MEANS something takes a signal colour.
 * These tests pin the two things that make the disagreement impossible: the map
 * is derived from the whole built-in set (so it cannot depend on what a surface
 * is drawing), and every view gets a slot of its own.
 */

import { describe, expect, test } from 'bun:test';
import { RIGHT_PANEL_TYPES } from '@/shared/lib/workspace/right-panels';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { hashHue } from '@/shared/lib/icons/tint';
import { panelHueOf, panelHueUniverse, resolvePanelHues } from '@/shared/lib/workspace/panel-hues';

describe('panel hues', () => {
  test('the universe holds every built-in view and the dock view, and nothing else', () => {
    const universe = panelHueUniverse();
    expect(new Set(universe)).toEqual(new Set([SESSIONS_VIEW_ID, ...RIGHT_PANEL_TYPES]));
    expect(universe.length).toBe(RIGHT_PANEL_TYPES.length + 1);
  });

  test('every built-in view gets a hue of its own', () => {
    // A collision is what `assignPanelHues` exists to resolve: 13 views on a
    // 36-slot wheel collide by birthday about nine times in ten, and two
    // neighbours on one blue is the opposite of "each panel has its colour".
    const hues = resolvePanelHues();
    expect(hues.size).toBe(panelHueUniverse().length);
    expect(new Set(hues.values()).size).toBe(hues.size);
  });

  test('the answer does not depend on what a surface draws or the order it asks', () => {
    // The defect this replaces: the rail built its map from the panels it was
    // DRAWING, so switching one off or dragging it recoloured the rest, and
    // Settings (which lists the switched-off views too) could never agree.
    // `panelHueOf` is a pure lookup on one static map.
    const hues = resolvePanelHues();
    const forward = panelHueUniverse().map((id) => panelHueOf(hues, id));
    const reversed = [...panelHueUniverse()].reverse().map((id) => panelHueOf(hues, id));
    expect(reversed).toEqual([...forward].reverse());
    expect(panelHueOf(hues, 'files')).toBe(hues.get('files')!);
  });

  test('an id outside the map keeps a stable hue instead of a shared default', () => {
    // A plugin's slot id, or an id from a newer version. Falling back to
    // `DEFAULT_ICON_HUE` would paint every unknown panel the same neutral blue,
    // which is the "one colour for everything" failure the mode exists to avoid.
    const hues = resolvePanelHues();
    expect(panelHueOf(hues, 'plugin:unknown:rightPanel')).toBe(hashHue('plugin:unknown:rightPanel'));
    expect(panelHueOf(hues, 'plugin:a:rightPanel')).not.toBe(panelHueOf(hues, 'plugin:b:rightPanel'));
  });

  test('a built-in hue is keyed by the PANEL id, never the glyph', () => {
    // The literal defect: `lucide-files` hashes to 320, `files` to 0. If the map
    // ever answered with the glyph's hue again, these two lines catch it.
    const hues = resolvePanelHues();
    expect(panelHueOf(hues, 'files')).toBe(hashHue('files'));
    expect(panelHueOf(hues, 'files')).not.toBe(hashHue('Files'));
  });
});
