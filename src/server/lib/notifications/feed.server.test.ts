/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The notification feed's gate: an event is recorded only when its OWN switch
 * is on, and it is recorded once.
 *
 * The switches ship false, so the default path is "silence" — the failure this
 * pins is an install that never opted in receiving banners, and the second is a
 * transition that fires twice (a repaired status write is not news).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { resetRealtimeHub } from '@/server/lib/realtime/hub.server';
import {
  noteAwaitingInput,
  noteRunSettled,
  onNotificationEvent,
} from '@/server/lib/notifications/feed.server';
import { listNotificationEventsAfter } from '@/server/lib/notifications/store.server';
import type { NotificationEvent } from '@/shared/lib/notifications/events';

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const originalMock = Bun.env.MOCK;
let seen: NotificationEvent[] = [];
let unsubscribe: (() => void) | null = null;

beforeAll(() => {
  // An EMPTY agent dir: the title resolver falls back to the app name instead
  // of scanning the developer's real sessions.
  Bun.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'kabmo-agent-'));
});

afterAll(() => {
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

beforeEach(async () => {
  await isolateDb();
  invalidateOmpSidebarData();
  resetRealtimeHub();
  seen = [];
  unsubscribe = onNotificationEvent((event) => seen.push(event));
});

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = null;
  await releaseDb();
});

/** The settings blob the console writes; the feed reads it per event. */
async function setSwitches(switches: Record<string, boolean>): Promise<void> {
  const db = await getDb();
  await db.run(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    ['kabmo_settings', JSON.stringify(switches)],
  );
}

describe('the notification feed', () => {
  test('records nothing when every switch is off (the shipped default)', async () => {
    await setSwitches({});
    await noteRunSettled('s-1', null);
    await noteAwaitingInput('s-1');
    expect(await listNotificationEventsAfter(0)).toEqual([]);
    expect(seen).toEqual([]);
  });

  test('a settled run is a finish event, and reaches the live consumers', async () => {
    await setSwitches({ notifyOnFinish: true });
    await noteRunSettled('s-1', null);

    const [event] = await listNotificationEventsAfter(0);
    expect(event).toMatchObject({
      kind: 'finish',
      sessionId: 's-1',
      title: 'Kabmo',
      body: 'The run finished.',
    });
    // The same event the outbox holds is what the socket and the SSE route see.
    expect(seen.map((entry) => entry.id)).toEqual([event.id]);
  });

  test('a settled run carries how long it took', async () => {
    await setSwitches({ notifyOnFinish: true });
    await noteRunSettled('s-1', null, 192_000);

    const [event] = await listNotificationEventsAfter(0);
    expect(event.durationMs).toBe(192_000);
  });

  test('a failure is an error event, and the reason is its body', async () => {
    await setSwitches({ notifyOnError: true });
    await noteRunSettled('s-2', 'Provider returned 401');

    const [event] = await listNotificationEventsAfter(0);
    expect(event.kind).toBe('error');
    expect(event.body).toBe('Provider returned 401');
  });

  test('finish switched off silences a failed run and vice versa', async () => {
    await setSwitches({ notifyOnFinish: true });
    await noteRunSettled('s-3', 'The run ended with error');
    expect(await listNotificationEventsAfter(0)).toEqual([]);
  });

  test('an awaiting-input event uses the ask switch', async () => {
    await setSwitches({ notifyOnAsk: true });
    await noteAwaitingInput('s-4');

    const [event] = await listNotificationEventsAfter(0);
    expect(event).toMatchObject({ kind: 'ask', sessionId: 's-4', body: 'Waiting for your answer.' });
  });
});
