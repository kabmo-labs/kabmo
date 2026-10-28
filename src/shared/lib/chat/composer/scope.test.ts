/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * The composer's command pool is WORKSPACE-scoped: omp resolves project
 * commands and project skills from the process's cwd, so a request that omits
 * the root answers with `$HOME`'s inventory and the popup silently misses the
 * workspace's own `.omp/commands` and `.omp/skills` (measured: 7 skill entries
 * for $HOME against 9 for this repository). The cache is keyed per root for the
 * same reason — one shared `command` key served the previous workspace's list
 * after a switch.
 */

import { afterAll, describe, expect, test, beforeEach } from 'bun:test';

import { invalidateComposerCache, loadComposerItems } from '@/shared/lib/chat/composer/client';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;
let requested: string[] = [];

function stubFetch(): void {
  requested = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    const body = url.includes('/commands') ? { commands: [] } : { skills: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

beforeEach(() => {
  invalidateComposerCache();
  stubFetch();
});

describe('loadComposerItems workspace scope', () => {
  test('scopes both command sources to the given root', async () => {
    await loadComposerItems('command', '/ws/one');

    expect(requested.some((url) => url === '/api/settings/commands?root=%2Fws%2Fone')).toBe(true);
    expect(requested.some((url) => url === '/api/settings/skills?root=%2Fws%2Fone')).toBe(true);
  });

  test('omits the query when no root is known', async () => {
    await loadComposerItems('command', null);

    expect(requested).toContain('/api/settings/commands');
    expect(requested).toContain('/api/settings/skills');
    expect(requested.every((url) => !url.includes('root='))).toBe(true);
  });

  test('does not serve one workspace from another workspace cache entry', async () => {
    await loadComposerItems('command', '/ws/one');
    const afterFirst = requested.length;

    await loadComposerItems('command', '/ws/two');

    expect(requested.length).toBeGreaterThan(afterFirst);
    expect(requested.some((url) => url === '/api/settings/commands?root=%2Fws%2Ftwo')).toBe(true);
  });

  test('a repeated read is served from the cache', async () => {
    await loadComposerItems('command', '/ws/one');
    const afterFirst = requested.length;

    await loadComposerItems('command', '/ws/one');

    expect(requested.length).toBe(afterFirst);
  });

  test('invalidating the logical kind clears every workspace entry', async () => {
    await loadComposerItems('command', '/ws/one');
    await loadComposerItems('command', '/ws/two');
    const afterBoth = requested.length;

    invalidateComposerCache('command');
    await loadComposerItems('command', '/ws/one');
    await loadComposerItems('command', '/ws/two');

    expect(requested.length).toBeGreaterThan(afterBoth);
  });
});

// The real fetch goes back when this FILE is done. `process.once('exit', …)`
// was the wrong hook: every file after this one shares the process, so the
// stub lived on for the rest of the run and answered their requests with this
// file's `{commands: []}` — measured as `listPlugins` returning `[]`, every
// `fetchHealth` probe answering `null` and the model-listing dialect checks
// reading "unrecognized response format".
afterAll(() => {
  globalThis.fetch = realFetch;
});
