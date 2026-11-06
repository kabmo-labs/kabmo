/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One settings MENU entry per harness.
 *
 * A harness is a subject with its own config, providers and state, so it gets a
 * page rather than a card in a list of thirteen. Two decisions are pinned here:
 *
 *  - the ids are DYNAMIC (`harness:claude`), derived from the catalog. A union
 *    member per adapter would need a build-time edit for every agent added at
 *    runtime, and the catalog is already the thing that decides which exist.
 *  - the overview page survives. A sidebar of fourteen agents with no "is any of
 *    this installed?" summary is a list, not an overview — and the install hint
 *    is the one piece of information a per-agent page cannot show when the agent
 *    is not installed at all.
 */

import { describe, expect, test } from 'bun:test';
import {
  HARNESS_CATEGORY_PREFIX,
  HARNESS_INDEX_CATEGORY,
  harnessCategoryId,
  harnessIdFromCategory,
  harnessMenuEntries,
  isHarnessCategory,
} from '@/shared/lib/harness/menu';
import { HARNESS_IDS, harnessDescriptor } from '@/shared/lib/harness/catalog';
import { SETTINGS_CATEGORIES } from '@/client/components/settings/Sidebar';

describe('harness menu ids', () => {
  test('a category round-trips to its harness and back', () => {
    expect(harnessCategoryId('claude')).toBe('harness:claude');
    expect(harnessIdFromCategory('harness:claude')).toBe('claude');
    expect(harnessIdFromCategory('harness:opencode2')).toBe('opencode2');
  });

  test('a non-harness category names no harness', () => {
    for (const category of ['appearance', 'providers', 'harness-index', 'harness', '']) {
      expect(harnessIdFromCategory(category)).toBeNull();
    }
  });

  test('the overview is a harness category, but names no agent', () => {
    expect(isHarnessCategory(HARNESS_INDEX_CATEGORY)).toBe(true);
    expect(isHarnessCategory(`${HARNESS_CATEGORY_PREFIX}claude`)).toBe(true);
    expect(isHarnessCategory('providers')).toBe(false);
    expect(harnessIdFromCategory(HARNESS_INDEX_CATEGORY)).toBeNull();
  });
});

describe('harnessMenuEntries', () => {
  test('the overview comes first, then one entry per non-built-in harness', () => {
    const entries = harnessMenuEntries();
    expect(entries[0].id).toBe(HARNESS_INDEX_CATEGORY);
    expect(entries[0].harness).toBeNull();

    const expected = HARNESS_IDS.filter((id) => !harnessDescriptor(id)?.builtIn);
    expect(entries.slice(1).map((entry) => entry.harness)).toEqual([...expected]);
  });

  test('the built-in transport gets no page', () => {
    // `omp` over RPC has nothing to install, probe or configure, so a page whose
    // only content is "this is built in" is a dead entry in a menu.
    const entries = harnessMenuEntries();
    expect(entries.some((entry) => entry.harness === 'omp-rpc')).toBe(false);
  });

  test('every entry names the transport it runs over', () => {
    for (const entry of harnessMenuEntries().slice(1)) {
      expect(entry.description).toContain('ACP over stdio');
      expect(entry.label).toBeTruthy();
    }
  });

  test('the settings sidebar actually lists every entry', () => {
    // The menu and the drawer are one list; a page that exists in the catalog but
    // not in the drawer is unreachable.
    const ids = SETTINGS_CATEGORIES.map((category) => category.id);
    for (const entry of harnessMenuEntries()) {
      expect(ids).toContain(entry.id);
    }
    expect(SETTINGS_CATEGORIES.filter((c) => c.section === 'HARNESSES')).toHaveLength(harnessMenuEntries().length);
  });

  test('every harness page is filed under HARNESSES, never under OMP', () => {
    for (const entry of harnessMenuEntries()) {
      const category = SETTINGS_CATEGORIES.find((c) => c.id === entry.id);
      expect(category?.section).toBe('HARNESSES');
    }
  });
});
