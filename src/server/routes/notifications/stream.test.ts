/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/notifications/stream` — the phone's delivery path while no page is
 * open.
 *
 * Three contracts, each one a reported bug in the client-side version this
 * replaced: a consumer with NO cursor is primed with the newest id and is never
 * replayed the outbox (a fresh install announced history), a consumer WITH a
 * cursor resumes from it, and a silenced platform keeps the stream open with
 * heartbeats only rather than being refused (the setting can be flipped from
 * another device).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { appendNotificationEvent } from '@/server/lib/notifications/store.server';
import { noteAwaitingInput } from '@/server/lib/notifications/feed.server';
import { loader } from '@/server/routes/notifications/stream';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

function requestFor(query: string): Request {
  return new Request(new URL(`http://localhost/api/notifications/stream${query}`));
}

/** Read exactly one SSE frame, then cancel so the stream's heartbeat is torn down. */
async function firstFrame(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  const end = text.indexOf('\n\n');
  return text.slice(0, end === -1 ? text.length : end);
}

async function seedEvents(): Promise<void> {
  await appendNotificationEvent({ kind: 'finish', sessionId: 's-1', title: 'One', body: 'Done.' });
  await appendNotificationEvent({ kind: 'error', sessionId: 's-2', title: 'Two', body: 'Failed.' });
}

async function setSettings(settings: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    'kabmo_settings',
    JSON.stringify(settings),
  ]);
}

describe('the notification stream', () => {
  test('answers a cancellable event stream, not a JSON body', async () => {
    const res = (await loader({ request: requestFor('') } as never)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    await res.body!.cancel();
  });

  test('a consumer with no cursor is primed with the newest id, not the outbox', async () => {
    await seedEvents();
    const res = (await loader({ request: requestFor('?platform=mobile') } as never)) as Response;
    const frame = await firstFrame(res);
    expect(frame).toStartWith('event: cursor\n');
    // The prime is the LAST id, and none of the two events is delivered.
    expect(frame).toContain('"id":2');
    expect(frame).not.toContain('s-1');
  });

  test('a consumer resumes from its cursor and receives only what is newer', async () => {
    await seedEvents();
    const res = (await loader({ request: requestFor('?platform=mobile&after=1') } as never)) as Response;
    const frame = await firstFrame(res);
    expect(frame).toStartWith('event: notification\n');
    expect(frame).toContain('"sessionId":"s-2"');
    expect(frame).not.toContain('s-1');
  });

  test('a silenced mobile platform keeps the stream open and says so', async () => {
    await setSettings({ notifyMobileEnabled: false });
    const res = (await loader({ request: requestFor('?platform=mobile') } as never)) as Response;
    expect(await firstFrame(res)).toBe('event: disabled\ndata: {"platform":"mobile"}');
  });

  test('an event recorded while the stream is open is delivered live', async () => {
    // The whole point of the stream: nothing polls, and the banner must arrive
    // when the run settles — while no page exists to ask.
    await setSettings({ notifyOnAsk: true });
    const res = (await loader({ request: requestFor('?platform=mobile') } as never)) as Response;
    const reader = res.body!.getReader();
    const prime = new TextDecoder().decode((await reader.read()).value);
    expect(prime).toStartWith('event: cursor\n');

    await noteAwaitingInput('s-live');

    const live = new TextDecoder().decode((await reader.read()).value);
    expect(live).toStartWith('event: notification\n');
    expect(live).toContain('"sessionId":"s-live"');
    await reader.cancel();
  });

  test('an absent platform master still delivers: the keys postdate the feature', async () => {
    await seedEvents();
    const res = (await loader({ request: requestFor('?platform=desktop') } as never)) as Response;
    expect(await firstFrame(res)).toStartWith('event: cursor\n');
  });
});
