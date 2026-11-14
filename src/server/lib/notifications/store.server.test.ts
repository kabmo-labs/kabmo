/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The notification outbox: the cursor and the retention it promises.
 *
 * The cursor is the whole contract — a consumer resumes from the last id it
 * posted, so an id that is not monotonic, or a read that returns an older row,
 * means a banner arrives twice (or never). Retention is the other half: an
 * unbounded outbox would grow one row per run forever.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import {
  appendNotificationEvent,
  latestNotificationEventId,
  listNotificationEventsAfter,
  pruneNotificationEvents,
} from '@/server/lib/notifications/store.server';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('the notification outbox', () => {
  test('assigns ascending ids and reads only what is newer than the cursor', async () => {
    const first = await appendNotificationEvent({
      kind: 'finish',
      sessionId: 's-1',
      title: 'One',
      body: 'The run finished.',
    });
    const second = await appendNotificationEvent({
      kind: 'error',
      sessionId: 's-2',
      title: 'Two',
      body: 'The run failed.',
    });

    expect(second.id).toBeGreaterThan(first.id);
    expect((await listNotificationEventsAfter(0)).map((event) => event.id)).toEqual([first.id, second.id]);
    // Resuming from the first id delivers the second and nothing else: a
    // consumer that already posted the first must never see it again.
    expect((await listNotificationEventsAfter(first.id)).map((event) => event.id)).toEqual([second.id]);
    expect(await latestNotificationEventId()).toBe(second.id);
  });

  test('a duration rides the row and comes back on the event', async () => {
    const withDuration = await appendNotificationEvent({
      kind: 'finish',
      sessionId: 's-1',
      title: 'One',
      body: 'The run finished.',
      durationMs: 192_000,
    });
    const without = await appendNotificationEvent({
      kind: 'ask',
      sessionId: 's-2',
      title: 'Two',
      body: 'Waiting for your answer.',
    });

    const [first, second] = await listNotificationEventsAfter(0);
    expect(first.durationMs).toBe(192_000);
    // An ask has no duration, and the field is absent rather than 0 — a banner
    // must not print "0s".
    expect(second.durationMs).toBeUndefined();
    expect(withDuration.durationMs).toBe(192_000);
    expect(without.durationMs).toBeUndefined();
  });

  test('an empty outbox has cursor 0, so a first run starts at the beginning', async () => {
    expect(await latestNotificationEventId()).toBe(0);
    expect(await listNotificationEventsAfter(0)).toEqual([]);
  });

  test('a row written with an unknown kind is still delivered', async () => {
    // A downgrade (or a hand-edited row) must not make an event disappear: the
    // kind only decides the banner's wording.
    const db = await getDb();
    await db.run(
      'INSERT INTO notification_events (kind, session_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ['mystery', 's-3', 'Title', 'Body', Date.now()],
    );
    const [event] = await listNotificationEventsAfter(0);
    expect(event.kind).toBe('finish');
    expect(event.sessionId).toBe('s-3');
  });

  test('retention keeps the newest rows and drops the rest', async () => {
    const db = await getDb();
    // 210 rows, one more than the outbox keeps.
    for (let index = 0; index < 210; index += 1) {
      await appendNotificationEvent({
        kind: 'finish',
        sessionId: `s-${index}`,
        title: 'T',
        body: 'B',
      });
    }
    await pruneNotificationEvents();
    const rows = (await db.get('SELECT COUNT(*) AS n FROM notification_events')) as { n: number };
    expect(rows.n).toBe(200);
    // The newest survived, the oldest did not.
    const kept = await listNotificationEventsAfter(0);
    expect(kept.at(-1)?.sessionId).toBe('s-209');
    expect(kept[0]?.sessionId).not.toBe('s-0');
  });
});
