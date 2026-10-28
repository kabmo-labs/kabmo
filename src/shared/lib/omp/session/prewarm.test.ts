/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The prewarm trigger and the cwd it resolves.
 *
 * Split from `prewarm-misc.test.ts` (which covers the other leftover edges of
 * the omp bridge) because both halves of this feature live in `prewarm.ts` and
 * they fail in the same way: a prewarm in the wrong cwd, or under a different
 * access mode, is a process the send never claims — the claim KILLS it and
 * cold-spawns, which is the 675-934 ms boot the feature exists to hide.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { ACCESS_MODE_SETTING_KEY } from '@/shared/lib/omp/config/access-mode';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { primeKabmoSettings, writeSetting } from '@/shared/lib/settings/client';

describe('triggerSessionPrewarm', () => {
  /** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
  const originalFetch = Bun.fetch;
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const post = (url: unknown, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  beforeAll(() => { globalThis.fetch = post as unknown as typeof fetch; });
  afterAll(() => { globalThis.fetch = originalFetch; });

  /** The settings snapshot is module state: every case states what it boots with. */
  const prime = (mode?: string) => {
    primeKabmoSettings(mode ? { [ACCESS_MODE_SETTING_KEY]: mode } : {});
    calls.length = 0;
  };

  test('carries the mode the settings snapshot holds', () => {
    prime('yolo');
    triggerSessionPrewarm('/tmp/project');
    expect(calls).toEqual([
      { url: '/api/agent/prewarm', method: 'POST', body: { cwd: '/tmp/project', accessMode: 'yolo' } },
    ]);
  });

  test('a mode chosen AFTER boot is the one sent', () => {
    // The regression: the sidebar used to hand over `appSettings.omp_access_mode`,
    // a boot-time prop, so a mode picked in the composer left the prewarm on the
    // previous one — and a mismatched prewarm is KILLED by the claim, which is
    // the 762 ms cold spawn this feature exists to remove.
    prime('always-ask');
    writeSetting(ACCESS_MODE_SETTING_KEY, 'yolo');
    calls.length = 0;
    triggerSessionPrewarm('/tmp/project');
    expect(calls).toEqual([
      { url: '/api/agent/prewarm', method: 'POST', body: { cwd: '/tmp/project', accessMode: 'yolo' } },
    ]);
  });

  test('an unset or unusable mode sends the cwd alone', () => {
    prime();
    triggerSessionPrewarm('/tmp/project');
    // The server falls back to the persisted row, exactly as it would for a
    // request that named nothing; sending garbage would only look like a choice.
    primeKabmoSettings({ [ACCESS_MODE_SETTING_KEY]: 'turbo' });
    triggerSessionPrewarm('/tmp/project');
    expect(calls).toEqual([
      { url: '/api/agent/prewarm', method: 'POST', body: { cwd: '/tmp/project' } },
      { url: '/api/agent/prewarm', method: 'POST', body: { cwd: '/tmp/project' } },
    ]);
  });

  test('an empty cwd sends nothing', () => {
    prime('yolo');
    triggerSessionPrewarm('');
    expect(calls).toEqual([]);
  });

  test('a rejected request is swallowed — prewarm must never reach the UI', () => {
    // Fire-and-forget: the function returns undefined synchronously and the
    // module attaches its own catch, so the rejection never becomes an
    // unhandled one that would surface as a test-run error.
    prime('yolo');
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(triggerSessionPrewarm('/tmp/project')).toBeUndefined();
    expect(calls).toEqual([]);
    globalThis.fetch = post as unknown as typeof fetch;
  });
});

describe('spawnCwdForNewSession', () => {
  const folders = [
    { id: 1, name: 'alpha', project_path: '/work/alpha', sessions: [{ id: 's-1' }] },
    { id: 2, name: 'beta', project_path: null, sessions: [] },
    { id: 3, name: 'gamma', project_path: '/work/gamma' },
  ];

  test('an explicit folder id wins, resolved loosely by string form', () => {
    expect(spawnCwdForNewSession(folders, null, 3)).toBe('/work/gamma');
    expect(spawnCwdForNewSession(folders, null, '3')).toBe('/work/gamma');
  });

  test('an unknown folder id yields no cwd rather than the wrong one', () => {
    expect(spawnCwdForNewSession(folders, null, 99)).toBeNull();
  });

  test('otherwise the folder owning the active session is used', () => {
    expect(spawnCwdForNewSession(folders, 's-1')).toBe('/work/alpha');
  });

  test('without a session match the first folder WITH a project path is used', () => {
    // Neither the active session nor an id matched, so the first folder that
    // carries a project path (alpha) wins; folder 2 has none.
    expect(spawnCwdForNewSession(folders, 'unknown-session')).toBe('/work/alpha');
  });

  test('a matched folder with no project path falls back to its name', () => {
    const sessionFolder = [{ id: 2, name: 'beta', project_path: null, sessions: [{ id: 's-9' }] }];
    expect(spawnCwdForNewSession(sessionFolder, 's-9')).toBe('beta');
    expect(spawnCwdForNewSession(sessionFolder, null, 2)).toBe('beta');
  });

  test('no matching folder at all yields null', () => {
    expect(spawnCwdForNewSession([{ id: 2, name: 'beta', project_path: null }], null)).toBeNull();
  });

  test('no folders at all yields null', () => {
    expect(spawnCwdForNewSession([], null)).toBeNull();
    expect(spawnCwdForNewSession([], 's-1', 1)).toBeNull();
  });
});
