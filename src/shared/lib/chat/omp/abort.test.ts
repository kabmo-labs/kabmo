/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When the Stop button escalates.
 *
 * The escalation exists because `abort` is awaited server-side until the turn
 * really stops, so a wedged session never answers and the button would hang with
 * it. Its first line of defence is the reply itself: a 500 means the server
 * FAILED to stop anything, and treating any HTTP status as a clean stop left the
 * button doing nothing at all — measured on `omp-acp`, where `abort` answered
 * `{"error":"undefined is not an object (evaluating 'this.write')"}` and the
 * turn kept running.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { stopAgentSession } from '@/shared/lib/chat/omp/abort';

const realFetch = globalThis.fetch;
const posted: Array<{ type: string }> = [];

function stubFetch(answer: (body: { type: string }) => Response): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type: string };
    posted.push(body);
    return answer(body);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  posted.length = 0;
});

describe('stopAgentSession', () => {
  test('a successful abort is enough, and nothing is reset', async () => {
    stubFetch(() => Response.json({ success: true, data: null }));
    await stopAgentSession('session-1');
    expect(posted.map((body) => body.type)).toEqual(['abort']);
  });

  test('a failed abort escalates to force_reset', async () => {
    stubFetch((body) =>
      body.type === 'abort'
        ? Response.json({ error: 'undefined is not an object' }, { status: 500 })
        : Response.json({ success: true, data: null }),
    );
    await stopAgentSession('session-1');
    expect(posted.map((body) => body.type)).toEqual(['abort', 'force_reset']);
  });

  test('an abort the server never answered escalates too', async () => {
    stubFetch(() => {
      throw new TypeError('connection dropped');
    });
    await stopAgentSession('session-1');
    expect(posted.map((body) => body.type)).toEqual(['abort', 'force_reset']);
  });
});