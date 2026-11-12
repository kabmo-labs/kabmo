/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/chat/prompt-history — the scope the composer's ArrowUp asks for.
 *
 * The static path shares its position with `:sessionId`, which is why the
 * route is mounted before the session loader in `chat/index.ts`. This file
 * pins both the scope rules and that ordering: a bare request must answer the
 * merged list, never `{ error: 'Session ID is required' }`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { listPrompts, recordPrompt } from '@/server/lib/chat/prompt-history.server';
import { loader } from '@/server/routes/chat/prompt-history';
import { chatBindings } from '@/server/routes/chat';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe('chat prompt-history loader', () => {
  test('answers the merged list when no session is named', async () => {
    await recordPrompt('s1', 'from one');
    await recordPrompt('s2', 'from two');
    const response = (await loader({ request: request('/api/chat/prompt-history') } as never)) as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prompts: ['from two', 'from one'] });
  });

  test('scopes to the named session', async () => {
    await recordPrompt('s1', 'from one');
    await recordPrompt('s2', 'from two');
    const response = (await loader({ request: request('/api/chat/prompt-history?sessionId=s1') } as never)) as Response;
    expect(await response.json()).toEqual({ prompts: ['from one'] });
  });

  test('clamps an out-of-range limit instead of failing', async () => {
    await recordPrompt('s1', 'one');
    await recordPrompt('s1', 'two');
    const clamped = (await loader({ request: request('/api/chat/prompt-history?limit=0') } as never)) as Response;
    expect(await clamped.json()).toEqual({ prompts: ['two'] });
    const junk = (await loader({ request: request('/api/chat/prompt-history?limit=abc') } as never)) as Response;
    expect((await junk.json()).prompts).toHaveLength(2);
  });

  test('is mounted ahead of the session route it shares a position with', () => {
    const paths = chatBindings.map((binding) => binding.path);
    expect(paths.indexOf('/api/chat/prompt-history')).toBeLessThan(paths.indexOf('/api/chat/:sessionId'));
  });

  test('the store it reads is the one a sent prompt writes', async () => {
    await recordPrompt('s9', 'sent once');
    expect(await listPrompts('s9')).toEqual(['sent once']);
  });
});
