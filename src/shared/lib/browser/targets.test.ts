/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { ownedPages, pickTargetId, type PageTarget } from '@/shared/lib/browser/targets';

const page = (targetId: string): PageTarget => ({ targetId, url: `https://${targetId}.example`, title: targetId });

// The daemon is project-shared: `Target.getTargets` lists every session's tabs.
const live = [page('other-1'), page('mine-1'), page('other-2'), page('mine-2')];

describe('pickTargetId', () => {
  test('picks the newest owned page, not the newest page overall', () => {
    expect(pickTargetId(live, ['mine-1', 'mine-2'])).toBe('mine-2');
  });

  test('never falls back to another session page', () => {
    expect(pickTargetId(live, [])).toBeNull();
    expect(pickTargetId(live, ['mine-gone'])).toBeNull();
  });

  test('honours an explicit pin only while that page is live and owned', () => {
    expect(pickTargetId(live, ['mine-1', 'mine-2'], 'mine-1')).toBe('mine-1');
    expect(pickTargetId(live, ['mine-1', 'mine-2'], 'other-2')).toBe('mine-2');
    expect(pickTargetId(live, ['mine-1', 'mine-2'], 'closed-tab')).toBe('mine-2');
  });

  test('returns null with no live pages', () => {
    expect(pickTargetId([], ['mine-1'])).toBeNull();
  });
});

describe('ownedPages', () => {
  test('keeps only owned pages, in registry order', () => {
    expect(ownedPages(live, ['mine-2', 'mine-1']).map((target) => target.targetId)).toEqual(['mine-2', 'mine-1']);
  });

  test('drops registry ids that are no longer live pages', () => {
    expect(ownedPages(live, ['mine-1', 'mine-gone']).map((target) => target.targetId)).toEqual(['mine-1']);
    expect(ownedPages(live, [])).toEqual([]);
  });
});
