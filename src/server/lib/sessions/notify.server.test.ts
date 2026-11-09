/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Child outcomes: filtering, coalescing and the one queue row they become.
 *
 * The window is exercised through `materializeNotice` rather than by waiting
 * two seconds; the timer itself is cancelled in `afterEach` so a suite does not
 * leak a flush into the next case.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import {
  createSessionRelation,
  setParentNotifications,
} from '@/server/lib/sessions/relations.server';
import {
  cancelNoticeTimer,
  materializeNotice,
  noteChildOutcome,
} from '@/server/lib/sessions/notify.server';
import { listQueue } from '@/server/lib/queue/store.server';

const parents = new Set<string>();

beforeEach(async () => {
  parents.clear();
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
});

afterEach(async () => {
  for (const parent of parents) cancelNoticeTimer(parent);
  await releaseDb();
});

async function childOf(
  sessionId: string,
  parentSessionId: string,
  preference?: 'auto' | 'stuck' | 'off',
): Promise<void> {
  await createSessionRelation({ sessionId, parentSessionId });
  if (preference) await setParentNotifications(sessionId, preference);
  parents.add(parentSessionId);
}

describe('child outcome notices', () => {
  test('two children collapse into one row, not two turns', async () => {
    await childOf('c1', 'p');
    await childOf('c2', 'p');
    await noteChildOutcome({ sessionId: 'c1', status: 'completed', output: 'first done' });
    await noteChildOutcome({ sessionId: 'c2', status: 'completed', output: 'second done' });

    const text = await materializeNotice('p');
    expect(text).toContain('Child session updates');
    expect(text).toContain('c1');
    expect(text).toContain('c2');
    expect(await listQueue('p')).toHaveLength(1);
  });

  test('a repeated outcome for one child replaces the earlier line', async () => {
    await childOf('c1', 'p');
    await noteChildOutcome({ sessionId: 'c1', status: 'interrupted' });
    await noteChildOutcome({ sessionId: 'c1', status: 'completed', output: 'finished later' });

    const text = await materializeNotice('p');
    expect(text).not.toBeNull();
    if (text === null) throw new Error('expected a notice');
    expect(text).toContain('completed');
    expect(text).not.toContain('interrupted');
    expect(text.match(/c1/g)).toHaveLength(1);
  });

  test('off writes nothing; stuck skips a completed turn', async () => {
    await childOf('quiet', 'p', 'off');
    await noteChildOutcome({ sessionId: 'quiet', status: 'completed', output: 'x' });
    expect(await materializeNotice('p')).toBeNull();

    await childOf('stuck-child', 'p', 'stuck');
    await noteChildOutcome({ sessionId: 'stuck-child', status: 'completed', output: 'x' });
    expect(await materializeNotice('p')).toBeNull();

    await noteChildOutcome({ sessionId: 'stuck-child', status: 'failed', failure: 'boom' });
    expect(await materializeNotice('p')).toContain('boom');
  });

  test('a fork and a root session are both silent', async () => {
    await createSessionRelation({
      sessionId: 'fork-1',
      sourceSessionId: 'source',
      originKind: 'fork',
    });
    await createSessionRelation({ sessionId: 'root' });
    await noteChildOutcome({ sessionId: 'fork-1', status: 'completed', output: 'x' });
    await noteChildOutcome({ sessionId: 'root', status: 'completed', output: 'x' });
    expect(await materializeNotice('source')).toBeNull();
    expect(await materializeNotice('root')).toBeNull();
  });

  test('a second materialize cannot duplicate the row', async () => {
    await childOf('c1', 'p');
    await noteChildOutcome({ sessionId: 'c1', status: 'completed', output: 'done' });
    expect(await materializeNotice('p')).not.toBeNull();
    expect(await materializeNotice('p')).toBeNull();
    expect(await listQueue('p')).toHaveLength(1);
  });
});
