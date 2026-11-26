/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/sessions/:id/answer` — the last closed answer, and why a run failed.
 *
 * The failure half exists because a FAILED run has no answer at all: the
 * command printed "No assistant answer recorded." for a worker whose provider
 * had said exactly why it stopped, so a coordinator had nothing to report and
 * nothing to act on. Both fields are read from their own durable row, so the
 * answer survives a restart and the reason survives the process that wrote it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { getSessionAnswer } from '@/server/routes/sessions/answer';
import { saveSessionAnswer } from '@kabmo-labs/kabmo-session/relations/answers.server';
import { markStreamStatus } from '@kabmo-labs/kabmo-session/stream-state';

beforeEach(isolateDb);
afterEach(releaseDb);

async function read(sessionId: string): Promise<{ answer: string | null; failure: string | null }> {
  const response = await getSessionAnswer({
    request: new Request(`http://localhost/api/sessions/${sessionId}/answer`),
    params: { sessionId },
  } as never);
  return (await (response as Response).json()) as { answer: string | null; failure: string | null };
}

describe('the session answer route', () => {
  test('a completed run reports its answer and no failure', async () => {
    await saveSessionAnswer('s1', 'all done');
    await markStreamStatus('s1', 'finish');

    expect(await read('s1')).toMatchObject({ answer: 'all done', failure: null });
  });

  test('a failed run reports the reason, which is all it has', async () => {
    await markStreamStatus('s1', 'finish', undefined, '400 The model is unavailable');

    const body = await read('s1');
    expect(body.answer).toBeNull();
    expect(body.failure).toBe('400 The model is unavailable');
  });

  test('a session that never ran reports neither', async () => {
    expect(await read('never-ran')).toMatchObject({ answer: null, failure: null });
  });

  test('a new run clears the previous failure', async () => {
    await markStreamStatus('s1', 'finish', undefined, 'boom');
    await markStreamStatus('s1', 'stream');

    expect((await read('s1')).failure).toBeNull();
    // The row itself is what the route reads; keep the handle honest.
    expect(await getDb()).toBeDefined();
  });
});
