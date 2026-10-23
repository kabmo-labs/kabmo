/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins five small workspace modules whose contracts are easy to break and
 * invisible at the call site:
 *
 * - `right-panels.ts` is the single source of the panel order and of one
 *   width/fraction/floor per view; a type added to one table but not another
 *   renders a panel with `undefined` geometry.
 * - `file-tab-id.ts` derives tab ids, and both the diff conversion and a later
 *   `omp:open-file` must land on the SAME id or one file opens twice.
 * - `active-project.ts` decides which workspace scopes the dev tools; an
 *   unbound session folder deliberately wins over an explicit folder pick.
 * - `sidebar-expanded.ts` persists a cross-session set and caps it on save.
 * - `session-state/listeners.ts` is the observer bus behind every follower.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { activeProjectForSession, composerRootFor, effectiveRootFor } from '@/shared/lib/workspace/active-project';
import { diffTabId, diffTabName, fileTabId } from '@/shared/lib/workspace/file-tab-id';
import {
  DEFAULT_RIGHT_PANEL_FRACTION,
  DEFAULT_RIGHT_PANEL_WIDTHS,
  MIN_RIGHT_PANEL_WIDTHS,
  RIGHT_PANEL_TYPES,
  isRightPanelType,
} from '@/shared/lib/workspace/right-panels';
import { notifySessionKey, subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { loadExpandedSessionIds, saveExpandedSessionIds } from '@/shared/lib/workspace/sidebar-expanded';
import { primeKabmoSettings, readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import type { WorkspaceFolderData } from '@/shared/types';

const EXPANDED_KEY = 'omp_sidebar_expanded_sessions';
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;

afterEach(() => {
  Reflect.set(globalThis, 'fetch', originalFetch);
});

afterAll(() => {
  // Leave the settings snapshot as close to how it was found as possible:
  // other suites share this module instance within one `bun test` process.
  primeKabmoSettings({});
  Reflect.set(globalThis, 'fetch', originalFetch);
});

describe('right-panels catalog', () => {
  test('the activity-bar order is pinned', () => {
    expect([...RIGHT_PANEL_TYPES]).toEqual([
      'context',
      'files',
      'search',
      'git',
      'wiki',
      'terminal',
      'user-browser',
      'browser',
      'usage',
      'todo',
      'plan',
    ]);
  });

  test('every view has a number in all three geometry tables', () => {
    for (const type of RIGHT_PANEL_TYPES) {
      expect(typeof DEFAULT_RIGHT_PANEL_WIDTHS[type]).toBe('number');
      expect(typeof MIN_RIGHT_PANEL_WIDTHS[type]).toBe('number');
    }
    // ONE fraction for every view: the right panel is half of a coupled pair
    // with the editor, so a per-view share would break the pair's sum.
    expect(typeof DEFAULT_RIGHT_PANEL_FRACTION).toBe('number');
  });

  test('the right fraction is a real share and a floor never exceeds the default width', () => {
    expect(DEFAULT_RIGHT_PANEL_FRACTION).toBeGreaterThan(0);
    expect(DEFAULT_RIGHT_PANEL_FRACTION).toBeLessThan(1);
    for (const type of RIGHT_PANEL_TYPES) {
      expect(MIN_RIGHT_PANEL_WIDTHS[type]).toBeLessThanOrEqual(DEFAULT_RIGHT_PANEL_WIDTHS[type]);
    }
  });

  test('spot values that the comments justify', () => {
    expect(DEFAULT_RIGHT_PANEL_FRACTION).toBe(0.3);
    expect(DEFAULT_RIGHT_PANEL_WIDTHS.files).toBe(268);
    expect(DEFAULT_RIGHT_PANEL_WIDTHS.terminal).toBe(640);
    expect(MIN_RIGHT_PANEL_WIDTHS.files).toBe(200);
    expect(MIN_RIGHT_PANEL_WIDTHS.terminal).toBe(320);
  });

  test('isRightPanelType accepts only catalog members', () => {
    expect(isRightPanelType('git')).toBe(true);
    expect(isRightPanelType('plan')).toBe(true);
    expect(isRightPanelType('nope')).toBe(false);
    expect(isRightPanelType('')).toBe(false);
    expect(isRightPanelType('toString')).toBe(false);
    expect(isRightPanelType(3)).toBe(false);
    expect(isRightPanelType(null)).toBe(false);
  });
});

describe('file-tab-id', () => {
  test('fileTabId is a pure function of the path', () => {
    expect(fileTabId('main.ts')).toBe(830975700);
    expect(fileTabId('src/index.ts')).toBe(2052066534);
    expect(fileTabId('main.ts')).toBe(fileTabId('main.ts'));
    expect(fileTabId('src/a.ts')).not.toBe(fileTabId('src/b.ts'));
  });

  test('an empty path falls back to a timestamp so it is never 0', () => {
    expect(fileTabId('')).toBeGreaterThan(1_000_000_000_000);
    expect(Number.isInteger(fileTabId(''))).toBe(true);
  });

  test('diffTabId separates staged from working diffs', () => {
    expect(diffTabId('src/a.ts', true)).toBe('diff-staged-src/a.ts');
    expect(diffTabId('src/a.ts', false)).toBe('diff-working-src/a.ts');
  });

  test('diffTabName shows the basename with a (Diff) suffix', () => {
    expect(diffTabName('main.ts')).toBe('main.ts (Diff)');
    expect(diffTabName('src/deep/a.ts')).toBe('a.ts (Diff)');
  });
});

describe('active-project', () => {
  function folder(id: number, name: string, projectPath: string | null, sessionIds: Array<number | string> = []): WorkspaceFolderData {
    return {
      id,
      name,
      project_path: projectPath,
      isExpanded: false,
      sessions: sessionIds.map((sessionId) => ({ id: sessionId, folder_id: id, title: `s-${sessionId}` })),
      hasMore: false,
      totalSessions: sessionIds.length,
    };
  }

  const folders = [
    folder(1, 'alpha', '/work/alpha', [10, 'uuid-a']),
    folder(2, 'beta', null, [20]),
    folder(3, 'gamma', '/work/gamma', [30]),
  ];

  test('a missing session id resolves to nothing', () => {
    expect(activeProjectForSession(folders, null)).toEqual({ folder: null, projectPath: null });
    expect(activeProjectForSession(folders, undefined)).toEqual({ folder: null, projectPath: null });
    expect(activeProjectForSession(folders, '')).toEqual({ folder: null, projectPath: null });
  });

  test('the owning folder is returned with its project path', () => {
    expect(activeProjectForSession(folders, 10)).toEqual({ folder: folders[0], projectPath: '/work/alpha' });
  });

  test('session ids compare across number/string representations', () => {
    expect(activeProjectForSession(folders, '10').folder?.id).toBe(1);
    expect(activeProjectForSession(folders, 'uuid-a').folder?.id).toBe(1);
  });

  test('a folder without a project path still owns the session', () => {
    expect(activeProjectForSession(folders, 20)).toEqual({ folder: folders[1], projectPath: null });
  });

  test('an unknown session resolves to nothing', () => {
    expect(activeProjectForSession(folders, 999)).toEqual({ folder: null, projectPath: null });
  });

  test('composerRootFor prefers the session binding over the folder pick', () => {
    expect(composerRootFor(folders, 30, 1)).toBe('/work/gamma');
  });

  /**
   * The root the panels follow. A worktree session runs OUTSIDE its folder's
   * project path, so pointing the panels at `project_path` showed the checkout
   * the agent had left — measured: every panel kept reading the main tree while
   * the run wrote to the worktree.
   */
  describe('effectiveRootFor', () => {
    const withWorktree = (status: 'ready' | 'missing'): WorkspaceFolderData[] => [
      {
        id: 1,
        name: 'alpha',
        project_path: '/work/alpha',
        isExpanded: true,
        hasMore: false,
        totalSessions: 2,
        sessions: [
          {
            id: 'wt-session',
            folder_id: 1,
            title: 'in a worktree',
            worktree: {
              branch: 'wt/cosmic-dolphin',
              path: '/data/worktrees/abc/cosmic-dolphin',
              primaryRoot: '/work/alpha',
              status,
              detached: false,
            },
          },
          { id: 'plain', folder_id: 1, title: 'in the checkout' },
        ],
      },
    ];

    test('a ready worktree wins over the folder project path', () => {
      expect(effectiveRootFor(withWorktree('ready'), 'wt-session')).toBe('/data/worktrees/abc/cosmic-dolphin');
    });

    test('a MISSING worktree falls back to the project path — a directory that is gone is not a root', () => {
      expect(effectiveRootFor(withWorktree('missing'), 'wt-session')).toBe('/work/alpha');
    });

    test('an ordinary session keeps the project path', () => {
      expect(effectiveRootFor(withWorktree('ready'), 'plain')).toBe('/work/alpha');
      expect(effectiveRootFor(folders, 30)).toBe('/work/gamma');
      expect(effectiveRootFor(folders, 999)).toBeNull();
    });
  });

  test('composerRootFor falls back to the selected folder without a session match', () => {
    expect(composerRootFor(folders, null, 3)).toBe('/work/gamma');
    expect(composerRootFor(folders, 999, 3)).toBe('/work/gamma');
  });

  test('composerRootFor returns null when neither resolves', () => {
    expect(composerRootFor(folders, null, null)).toBeNull();
    expect(composerRootFor(folders, 999, 999)).toBeNull();
    expect(composerRootFor([], null, 1)).toBeNull();
  });

  test('an unbound session folder wins over a bound explicit pick', () => {
    // The session folder takes precedence even when it has no project_path, so
    // the composer does not silently scope to another workspace.
    expect(composerRootFor(folders, 20, 1)).toBeNull();
  });
});

describe('sidebar-expanded', () => {
  function stored(): unknown {
    return readKabmoSetting<unknown>(EXPANDED_KEY);
  }

  test('an absent setting loads as an empty set', () => {
    writeSetting(EXPANDED_KEY, undefined);
    expect(loadExpandedSessionIds().size).toBe(0);
  });

  test('a non-array setting loads as an empty set', () => {
    writeSetting(EXPANDED_KEY, 'not-an-array');
    expect(loadExpandedSessionIds().size).toBe(0);
  });

  test('non-string entries are filtered out', () => {
    writeSetting(EXPANDED_KEY, ['a', 1, null, 'b', { id: 'c' }]);
    expect([...loadExpandedSessionIds()]).toEqual(['a', 'b']);
  });

  test('a save round-trips the set in insertion order', () => {
    saveExpandedSessionIds(new Set(['x', 'y', 'z']));
    expect([...loadExpandedSessionIds()]).toEqual(['x', 'y', 'z']);
  });

  test('a save keeps only the newest 50 ids', () => {
    const ids = new Set(Array.from({ length: 60 }, (_unused, index) => `id-${index}`));
    saveExpandedSessionIds(ids);
    const persisted = stored();
    // `Array.isArray` narrows the unknown read to a real array before indexing.
    if (!Array.isArray(persisted)) throw new Error('expected an array');
    expect(persisted.length).toBe(50);
    expect(persisted[0]).toBe('id-10');
    expect(persisted[49]).toBe('id-59');
  });
});

describe('session-state listeners bus', () => {
  test('subscribing with a null session id returns an inert unsubscribe', () => {
    const unsubscribe = subscribeSessionKey(null, 'k', () => {
      throw new Error('must never fire');
    });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(() => notifySessionKey('anything', 'k')).not.toThrow();
  });

  test('notify routes to the slot bucket and the session-wide bucket only', () => {
    const hits: string[] = [];
    const unsubscribeA = subscribeSessionKey('s1', 'a', () => hits.push('a'));
    const unsubscribeAny = subscribeSessionKey('s1', null, () => hits.push('any'));
    const unsubscribeB = subscribeSessionKey('s1', 'b', () => hits.push('b'));

    notifySessionKey('s1', 'a');
    expect(hits).toEqual(['a', 'any']);

    notifySessionKey('s1');
    expect(hits).toEqual(['a', 'any', 'a', 'any', 'b']);

    unsubscribeA();
    unsubscribeAny();
    unsubscribeB();
  });

  test('notify without a key fires each bucket exactly once', () => {
    let calls = 0;
    const unsubscribe = subscribeSessionKey('s2', 'only', () => {
      calls += 1;
    });
    notifySessionKey('s2');
    expect(calls).toBe(1);
    unsubscribe();
  });

  test('unsubscribing twice is safe and removes only that listener', () => {
    const hits: string[] = [];
    const first = subscribeSessionKey('s3', 'k', () => hits.push('first'));
    const unsubscribeSecond = subscribeSessionKey('s3', 'k', () => hits.push('second'));

    unsubscribeSecond();
    unsubscribeSecond();
    notifySessionKey('s3', 'k');
    expect(hits).toEqual(['first']);
    first();
  });

  test('a listener added during a notify pass does not fire until the next one', () => {
    const hits: string[] = [];
    const unsubscribeLate = subscribeSessionKey('s4', 'k', () => hits.push('late'));
    let registered = false;
    const unsubscribeEarly = subscribeSessionKey('s4', 'k', () => {
      hits.push('early');
      if (!registered) {
        registered = true;
        subscribeSessionKey('s4', 'k', () => hits.push('added'));
      }
    });

    notifySessionKey('s4', 'k');
    expect(hits).toEqual(['late', 'early']);

    notifySessionKey('s4', 'k');
    expect(hits).toEqual(['late', 'early', 'late', 'early', 'added']);
    unsubscribeEarly();
    unsubscribeLate();
  });
});
