/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The built-in panel catalog.
 *
 * Two properties are pinned here because both fail SILENTLY in the app: a view
 * whose geometry is missing renders at the wrong size or not at all, and a view
 * that declares the wrong `requiresWorkspace` either shows "No session
 * selected" over content it could draw, or reads a working tree that is not
 * there.
 */

import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_PANELS,
  BUILTIN_PANEL_IDS,
  enabledBuiltinPanels,
} from '@/client/components/workspace/panels/builtin';
import { RIGHT_PANEL_TYPES } from '@/shared/lib/workspace/right-panels';

describe('built-in panel catalog', () => {
  test('every view in the order table has a catalog entry, in that order', () => {
    expect(BUILTIN_PANEL_IDS).toEqual([...RIGHT_PANEL_TYPES]);
    expect(BUILTIN_PANELS.map((panel) => panel.id)).toEqual([...RIGHT_PANEL_TYPES]);
  });

  test('every view carries the geometry, identity and component the layout reads', () => {
    for (const panel of BUILTIN_PANELS) {
      expect(typeof panel.title).toBe('string');
      expect(panel.title.length).toBeGreaterThan(0);
      expect(typeof panel.label).toBe('string');
      expect(panel.label.length).toBeGreaterThan(0);
      expect(panel.icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof panel.Component);
      expect(panel.minWidth).toBeGreaterThan(0);
      expect(panel.defaultFraction).toBeGreaterThan(0);
      expect(panel.defaultFraction).toBeLessThan(1);
    }
  });

  test('a session-owned view is reachable without a workspace, a tree view is not', () => {
    const byId = new Map(BUILTIN_PANELS.map((panel) => [panel.id, panel]));
    for (const id of ['files', 'search', 'git', 'terminal', 'wiki', 'context'] as const) {
      expect(byId.get(id)?.requiresWorkspace).toBe(true);
    }
    // These read the SESSION, not the working tree: gating them on a folder
    // showed "No session selected" over a list that was right there.
    for (const id of ['todo', 'plan', 'usage', 'browser', 'user-browser'] as const) {
      expect(byId.get(id)?.requiresWorkspace).toBe(false);
    }
  });

  test('only the terminal stays live while another view is on screen', () => {
    const live = BUILTIN_PANELS.filter((panel) => panel.liveWhileHidden);
    expect(live.map((panel) => panel.id)).toEqual(['terminal']);
  });
});

describe('enabledBuiltinPanels', () => {
  test('an empty disabled set shows every view', () => {
    expect(enabledBuiltinPanels([]).map((panel) => panel.id)).toEqual([...RIGHT_PANEL_TYPES]);
  });

  test('a bare id switches exactly that view off', () => {
    const enabled = enabledBuiltinPanels(['git', 'wiki']);
    expect(enabled.map((panel) => panel.id)).toEqual(
      RIGHT_PANEL_TYPES.filter((id) => id !== 'git' && id !== 'wiki'),
    );
  });

  test('a plugin id does not switch a built-in view off', () => {
    // Enablement is one set of ids, and a plugin's id carries its prefix — so a
    // disabled plugin must not collide with a built-in view's id.
    expect(enabledBuiltinPanels(['plugin:git']).map((panel) => panel.id)).toEqual([...RIGHT_PANEL_TYPES]);
  });
});
