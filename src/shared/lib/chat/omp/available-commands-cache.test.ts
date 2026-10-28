/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * `available_commands_update` must drop the composer's cached command pool.
 * The cache lives five minutes, and this frame is the only signal that omp's
 * discovered command set changed (`/reload-plugins`, `/move`, a skill install),
 * so ignoring it leaves the popup offering a list omp no longer matches.
 */

import { describe, expect, test } from 'bun:test';

import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { invalidateComposerCache, loadComposerItems } from '@/shared/lib/chat/composer/client';

function foldDeps(): OmpAgentFoldDeps {
  const noop = () => {};
  const ref = <T,>(value: T) => ({ current: value });
  return {
    setState: noop,
    sessionId: 'test-session',
    callbacksRef: { current: {} },
    toolResultsRef: ref(new Map()),
    lastToolMessageRef: ref(null),
    activityRef: ref(''),
    providerRetryVerbRef: ref(null),
    currentThinkingLevelRef: ref(undefined),
    fileMutatingCallsRef: ref(new Set()),
  } as unknown as OmpAgentFoldDeps;
}

describe('available_commands_update', () => {
  test('refetches the command pool on the next composer open', async () => {
    let fetches = 0;
    /** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/api/settings/commands')) {
        fetches += 1;
        return new Response(JSON.stringify({ commands: [] }), { status: 200 });
      }
      if (href.includes('/api/settings/skills')) {
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      invalidateComposerCache();
      await loadComposerItems('command');
      expect(fetches).toBe(1);
      // Cached: a second open inside the TTL does not refetch.
      await loadComposerItems('command');
      expect(fetches).toBe(1);

      // omp reports the command set changed.
      foldAgentEvent({ type: 'available_commands_update', commands: [] }, foldDeps());

      await loadComposerItems('command');
      expect(fetches).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      invalidateComposerCache();
    }
  });
});
