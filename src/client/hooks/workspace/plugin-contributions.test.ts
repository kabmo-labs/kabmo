/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a card says a plugin contributes.
 *
 * Two facts are pinned here and both are easy to get wrong in a way nothing
 * notices:
 *
 * - The live registration wins over the manifest's declaration. A card that
 *   showed the declaration would be repeating the author's intent at a reader
 *   who is deciding whether to switch the plugin on.
 * - A fallback is MARKED as a declaration. `session-info` declares three slots
 *   and registers three, but a disabled plugin registers nothing at all — and a
 *   badge that looked identical in both cases would make a claim read as a fact.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { registerPluginBundle, resetPluginSlots } from '@/client/lib/plugins/slots';
import { resetListSlots } from '@/client/lib/plugins/list-slots';
import {
  contributionBadges,
  declaredContributions,
  hasContributions,
  readPluginContributions,
} from '@/client/hooks/workspace/plugin-contributions';

const Noop = () => null;

beforeEach(() => {
  resetPluginSlots();
  resetListSlots();
});

describe('declaredContributions', () => {
  test('names each declared slot in words, in the canonical order', () => {
    const declared = declaredContributions(['headerPanel', 'rightPanel']);
    expect(declared.map((entry) => entry.label)).toEqual(['Panel view', 'Header button']);
    expect(declared.every((entry) => entry.kind === 'panel')).toBe(true);
  });

  test('an undeclared manifest contributes nothing to show', () => {
    expect(declaredContributions(undefined)).toEqual([]);
    expect(declaredContributions([])).toEqual([]);
  });
});

describe('readPluginContributions', () => {
  test('reads the positional slots a bundle registered, in the card order', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => {
        app.rightPanel({ id: 'r', title: 'Right', component: Noop });
        app.headerPanel({ id: 'h', title: 'Header', component: Noop });
      }),
    });
    const live = readPluginContributions('demo');
    expect(live.live).toBe(true);
    expect(live.panels.map((entry) => entry.label)).toEqual(['Panel view', 'Header button']);
    // The title the bundle gave it rides along, so the badge can name the view.
    expect(live.panels[0]?.title).toBe('Right');
  });

  test('counts the rows a bundle contributes to one list slot', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => {
        app.messageAction({ id: 'copy', component: Noop });
        app.messageAction({ id: 'quote', component: Noop });
      }),
    });
    const live = readPluginContributions('demo');
    expect(live.panels).toEqual([]);
    expect(live.rows).toHaveLength(1);
    // ONE badge per slot with a count, not one badge per row: a plugin adding
    // four actions must not push a card's layout apart.
    expect(live.rows[0]).toMatchObject({ label: 'Message actions', kind: 'row', count: 2 });
  });

  test('a plugin whose bundle never registered reads as not live', () => {
    expect(readPluginContributions('missing')).toEqual({ live: false, panels: [], rows: [] });
  });
});

describe('contributionBadges', () => {
  test('a live registration is the answer, and it is not marked as a declaration', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.rightPanel({ id: 'r', title: 'Right', component: Noop })),
    });
    // The manifest claims a slot the bundle never registered. The bundle wins.
    const badges = contributionBadges(readPluginContributions('demo'), ['rightPanel', 'settingsSection']);
    expect(badges.fromDeclaration).toBe(false);
    expect(badges.items.map((item) => item.label)).toEqual(['Panel view']);
  });

  test('a disabled plugin falls back to its declaration, marked as one', () => {
    // Nothing registered — exactly the state of a switched-off plugin, whose
    // bundle is never imported.
    const badges = contributionBadges(readPluginContributions('demo'), ['rightPanel', 'panel']);
    expect(badges.items.map((item) => item.label)).toEqual(['Panel view', 'Editor takeover']);
    expect(badges.fromDeclaration).toBe(true);
  });

  test('nothing registered and nothing declared shows no badges at all', () => {
    const badges = contributionBadges(readPluginContributions('demo'), undefined);
    expect(badges.items).toEqual([]);
    expect(badges.fromDeclaration).toBe(false);
  });
});

describe('hasContributions', () => {
  test('a plugin that registers nothing says so rather than looking empty', () => {
    expect(hasContributions({ live: true, panels: [], rows: [] })).toBe(false);
    expect(hasContributions({ live: true, panels: declaredContributions(['panel']), rows: [] })).toBe(true);
  });
});
