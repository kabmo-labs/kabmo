/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Settings → Appearance sidebar's group table.
 *
 * The failure this prevents is a section that exists but cannot be reached: the
 * category's detail pane renders `group.sections`, so a section missing from
 * every group is invisible in the product while its file, its imports and its
 * unit tests all still pass. The reverse — one section listed under two groups —
 * renders it twice and makes an edit in one place look like it did nothing.
 */

import { describe, expect, test } from 'bun:test';
import {
  APPEARANCE_GROUPS,
  APPEARANCE_SECTION_IDS,
} from '@/client/components/settings/categories/appearance-settings/groups';

describe('appearance setting groups', () => {
  test('every section is owned by exactly one group', () => {
    const assigned = APPEARANCE_GROUPS.flatMap((group) => group.sections);

    expect(assigned).toHaveLength(APPEARANCE_SECTION_IDS.length);
    expect([...assigned].sort()).toEqual([...APPEARANCE_SECTION_IDS].sort());
  });

  test('group ids are unique and each row states a label, a hint and a description', () => {
    const ids = APPEARANCE_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const group of APPEARANCE_GROUPS) {
      expect(group.label.trim()).not.toBe('');
      expect(group.hint.trim()).not.toBe('');
      expect(group.description.trim()).not.toBe('');
      expect(typeof group.icon).toBe('function');
      expect(group.sections.length).toBeGreaterThan(0);
    }
  });

  test('the palette is the first group, because Appearance is the modal default', () => {
    expect(APPEARANCE_GROUPS[0].id).toBe('palette');
    expect(APPEARANCE_GROUPS[0].sections).toEqual(['theme']);
  });
});
