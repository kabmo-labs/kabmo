/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending chat's warm: WHAT it warms, WHEN it re-fires, and what it leaves
 * alone.
 *
 * Three rules, each one a measured cost when it is dropped:
 *
 *  - the HARNESS rides the request, because a pending chat on an ACP agent must
 *    warm that agent (the pool is chosen server-side by this field);
 *  - the cwd is the SEND path's cwd (worktree pick, then the folder's project
 *    path), because a warm child in another directory is a spawn AND a kill;
 *  - a render that changed none of those facts fires nothing, because the
 *    composer re-renders on every keystroke.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';

import { usePendingWarmup, type PendingWarmupInput } from '@/client/hooks/chat/timeline/pending-warmup';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import type { WorkspaceFolderData } from '@/shared/types';

let container: HTMLElement;
const calls: Array<Record<string, unknown>> = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  globalThis.fetch = ((input: unknown, init?: { body?: string }) => {
    if (String(input).endsWith('/api/agent/prewarm')) calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch;
});
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  calls.length = 0;
  container = document.body.appendChild(document.createElement('div'));
  // A settings snapshot, so the access pick is a stated constant.
  primeKabmoSettings({ omp_access_mode: 'yolo' });
});
afterEach(() => {
  render(null, container);
  container.remove();
});

const FOLDERS = [
  { id: 1, name: 'ws', project_path: '/work/alpha' },
  { id: 2, name: 'no-project', project_path: null },
] as unknown as WorkspaceFolderData[];

async function mount(input: Partial<PendingWarmupInput> = {}) {
  function Probe() {
    usePendingWarmup({
      sessionId: 'new-1',
      folders: FOLDERS,
      selectedFolderId: 1,
      worktreePath: null,
      harness: undefined,
      plan: false,
      ...input,
    });
    return null;
  }
  await act(async () => {
    render(h(Probe, {}), container);
  });
  // The trigger is fire-and-forget; one microtask turn lands the request.
  await act(async () => {});
}

describe('usePendingWarmup', () => {
  test('warms the selected folder in omp’s pool by default', async () => {
    await mount();
    expect(calls).toEqual([
      { cwd: '/work/alpha', harness: 'omp-rpc', accessMode: 'yolo', modes: { plan: false, goal: false } },
    ]);
  });

  test('an ACP pick names its harness, so that agent is the one booted', async () => {
    await mount({ harness: 'claude' });
    expect(calls).toEqual([
      { cwd: '/work/alpha', harness: 'claude', accessMode: 'yolo', modes: { plan: false, goal: false } },
    ]);
  });

  test('a Plan pick rides the warm, because omp reads it at start', async () => {
    await mount({ plan: true });
    expect(calls).toEqual([
      { cwd: '/work/alpha', harness: 'omp-rpc', accessMode: 'yolo', modes: { plan: true, goal: false } },
    ]);
  });

  test('the worktree pick wins over the folder, exactly as the send resolves it', async () => {
    await mount({ worktreePath: '/work/alpha-wt/feature' });
    expect(calls[0]?.cwd).toBe('/work/alpha-wt/feature');
  });

  test('a folder with no project path warms its own directory', async () => {
    await mount({ selectedFolderId: 2 });
    expect(calls[0]?.cwd).toBe('no-project');
  });

  test('a spawned chat warms nothing — there is no boot left to hide', async () => {
    await mount({ sessionId: 'sess-1' });
    expect(calls).toEqual([]);
  });

  test('a re-render that moved nothing fires no second prewarm', async () => {
    // A keystroke in the composer re-renders this hook; a second request would
    // be a `POST /api/agent/prewarm` per character typed.
    let rerender: () => void = () => {};
    function Probe() {
      const [, setTick] = useState(0);
      rerender = () => setTick((tick) => tick + 1);
      usePendingWarmup({
        sessionId: 'new-1',
        folders: FOLDERS,
        selectedFolderId: 1,
        worktreePath: null,
        harness: undefined,
        plan: false,
      });
      return null;
    }
    await act(async () => {
      render(h(Probe, {}), container);
    });
    await act(async () => {
      rerender();
    });
    expect(calls).toHaveLength(1);
  });

  test('a harness change re-fires, because a different agent is a different child', async () => {
    await mount({ harness: 'omp-rpc' });
    await mount({ harness: 'codex' });
    expect(calls.map((call) => call.harness)).toEqual(['omp-rpc', 'codex']);
  });
});
