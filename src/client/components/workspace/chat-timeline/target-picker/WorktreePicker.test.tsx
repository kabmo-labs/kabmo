/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's WORKTREE picker, rendered.
 *
 * These are the cases a reader would otherwise meet in a browser and nowhere
 * else:
 *
 *  - a workspace that is not a git repository gets NO control (a permanently
 *    disabled one in every notes folder is noise, and a click that can only
 *    refuse is worse);
 *  - the trigger names the BRANCH, which is why the list is read on mount and
 *    not only when the menu opens;
 *  - the menu's groups are the three the plan names, with creating ABOVE the
 *    list so a long list cannot hide it;
 *  - the project root row clears the worktree pick.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  WorktreePicker,
  selectedWorktree,
  worktreeLabel,
} from '@/client/components/workspace/chat-timeline/target-picker/WorktreePicker';
import type { WorktreeInfo } from '@/shared/lib/workspace/worktree/types';
import type { WorkspaceFolderData } from '@/shared/types';

const folder: WorkspaceFolderData = {
  id: 1,
  name: 'kabmo',
  project_path: '/repo',
  isExpanded: true,
  hasMore: false,
  totalSessions: 0,
  sessions: [],
};

const row = (overrides: Partial<WorktreeInfo>): WorktreeInfo => ({
  path: '/data/worktrees/x/main',
  branch: 'main',
  head: 'abc1234',
  detached: false,
  missing: false,
  isPrimary: true,
  dirty: 0,
  aheadOfStart: 0,
  startRef: '',
  sessions: 0,
  ...overrides,
});

const primary = row({});
const made = row({
  path: '/data/worktrees/x/cosmic-dolphin',
  branch: 'wt/cosmic-dolphin',
  isPrimary: false,
  dirty: 2,
});

const nativeFetch = Bun.fetch;
const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

/** Answer the list read without a server. `isRepo` is the whole point here. */
function stubList(worktrees: WorktreeInfo[], isRepo = true): string[] {
  const calls: string[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const payload = { worktrees, base: '/data/worktrees/x', isRepo };
    return { ok: true, json: async () => payload } as unknown as Response;
  };
  return calls;
}

/**
 * A stub whose LIST grows once a create has answered — the state a real control
 * is in the moment after it makes a worktree.
 */
function stubCreate(listBefore: WorktreeInfo[], created: WorktreeInfo): string[] {
  const calls: string[] = [];
  let created_ = false;
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (init?.method === 'POST') {
      created_ = true;
      return { ok: true, json: async () => ({ worktree: created }) } as unknown as Response;
    }
    const worktrees = created_ ? [...listBefore, created] : listBefore;
    return {
      ok: true,
      json: async () => ({ worktrees, base: '/data/worktrees/x', isRepo: true }),
    } as unknown as Response;
  };
  return calls;
}

/** Drain the fetch promise chain; each empty `act` is one round. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await act(async () => {});
}

function textOf(host: HTMLElement): string {
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('worktreeLabel', () => {
  test('the branch the project root holds, not the word "root"', () => {
    expect(worktreeLabel([primary], null)).toBe('main');
  });

  test('the picked worktree’s branch', () => {
    expect(worktreeLabel([primary, made], { folderId: 1, worktreePath: made.path })).toBe('wt/cosmic-dolphin');
  });

  test('a pick the list has not caught up with still names something', () => {
    // The dialog selects the new worktree the moment it is created, and the
    // list that answers the next render may predate it.
    expect(worktreeLabel([primary], { folderId: 1, worktreePath: '/data/worktrees/x/just-made' })).toBe('just-made');
  });

  test('nothing read yet falls back to the words a reader can act on', () => {
    expect(worktreeLabel([], null)).toBe('Project root');
  });
});

describe('selectedWorktree', () => {
  test('the row the pick names, and null for the root', () => {
    expect(selectedWorktree([primary, made], { folderId: 1, worktreePath: made.path })?.branch).toBe('wt/cosmic-dolphin');
    expect(selectedWorktree([primary, made], null)).toBeNull();
  });
});

describe('WorktreePicker', () => {
  test('a workspace that is not a git repository draws no control', async () => {
    const calls = stubList([], false);
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: null,
        setTarget: () => {},
      }),
    );
    await settle();

    // The read happened — the answer is what suppresses the control, not a
    // guess about the folder's shape.
    expect(calls.length).toBeGreaterThan(0);
    expect(host.querySelector('button')).toBeNull();
  });

  test('the trigger names the root branch, read before the menu is opened', async () => {
    stubList([primary, made]);
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: null,
        setTarget: () => {},
      }),
    );
    await settle();

    const trigger = host.querySelector('button') as HTMLButtonElement | null;
    expect(trigger?.textContent).toContain('main');
  });

  test('the menu offers the project root, both create paths, and the list', async () => {
    stubList([primary, made]);
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: null,
        setTarget: () => {},
      }),
    );
    await settle();

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    await settle();

    const text = textOf(host);
    expect(text).toContain('Project root');
    expect(text).toContain('Quick worktree');
    expect(text).toContain('New worktree…');
    expect(text).toContain('Worktrees');
    expect(text).toContain('wt/cosmic-dolphin');
    // Creating sits above the LIST: a project with many worktrees must not push
    // the action that makes one out of sight.
    expect(text.indexOf('Quick worktree')).toBeLessThan(text.indexOf('wt/cosmic-dolphin'));
  });

  test('the project root row clears the worktree pick', async () => {
    stubList([primary, made]);
    const picks: Array<{ folderId: number | null; worktreePath: string | null } | null> = [];
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: { folderId: 1, worktreePath: made.path },
        setTarget: (next) => picks.push(next),
      }),
    );
    await settle();

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    await settle();

    const rows = [...host.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[];
    // Root first, then the worktree.
    expect(rows.length).toBe(2);
    await act(async () => {
      rows[0]?.click();
    });

    expect(picks).toEqual([{ folderId: 1, worktreePath: null }]);
  });

  test('a picked worktree marks its own row and names itself on the trigger', async () => {
    stubList([primary, made]);
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: { folderId: 1, worktreePath: made.path },
        setTarget: () => {},
      }),
    );
    await settle();

    expect((host.querySelector('button') as HTMLButtonElement).textContent).toContain('wt/cosmic-dolphin');
    // The dirty count is on the trigger too: a chat about to run in a checkout
    // with two changed files should say so before the first prompt.
    expect(host.querySelector('[aria-label="2 uncommitted files in this checkout"]')).not.toBeNull();
  });

  test('a create re-reads the list, so the trigger names the branch not the folder', async () => {
    // The pick names a path the list has never seen — exactly the state after a
    // create. `worktreeLabel` falls back to the folder's last segment there, so
    // the trigger read `groovy-yak` where the branch is `wt/groovy-yak`, and it
    // kept reading that until the menu was opened again (measured in the
    // browser). The list is what the label is derived from, so the create has to
    // re-read it.
    const fresh = row({
      path: '/data/worktrees/x/groovy-yak',
      branch: 'wt/groovy-yak',
      isPrimary: false,
    });
    const calls = stubCreate([primary], fresh);
    const picks: Array<{ folderId: number | null; worktreePath: string | null } | null> = [];
    const host = await mount(
      h(WorktreePicker, {
        folders: [folder],
        selectedFolderId: 1,
        target: null,
        setTarget: (next) => picks.push(next),
      }),
    );
    await settle();

    await act(async () => {
      (host.querySelector('button') as HTMLButtonElement).click();
    });
    await settle();

    const quick = [...host.querySelectorAll('[role="menuitem"]')].find((node) =>
      (node.textContent ?? '').includes('Quick worktree'),
    ) as HTMLButtonElement | undefined;
    expect(quick).toBeDefined();
    await act(async () => {
      quick?.click();
    });
    await settle();

    expect(picks).toEqual([{ folderId: 1, worktreePath: fresh.path }]);
    // The read AFTER the POST is the one that matters; without it the label is
    // `groovy-yak`.
    const postIndex = calls.findIndex((call) => call.startsWith('POST'));
    expect(postIndex).toBeGreaterThanOrEqual(0);
    expect(calls.slice(postIndex + 1).some((call) => call.startsWith('GET'))).toBe(true);
  });
});
