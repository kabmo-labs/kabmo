/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The waiting-prompt store, against a real temp database.
 *
 * The rules pinned here are the ones a second caller would break silently: the
 * claim is what makes two sweeps (or two Kabmo instances on the shared file)
 * safe, a terminal row has to stay readable long enough for the client that
 * created it to learn the outcome, and a retry must not look like a delivery.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import {
  cancelWaitingPrompt,
  claimWaitingPrompt,
  countWaitingAttempt,
  createWaitingPrompt,
  failWaitingOn,
  failWaitingPrompt,
  getWaitingPrompt,
  listWaitingOn,
  listWaitingPrompts,
  markWaitingDispatched,
  pruneWaitingPrompts,
  requeueWaitingPrompt,
  WAITING_RETENTION_MS,
} from '@/server/lib/waiting/store.server';

const ROOT = path.join(os.tmpdir(), `kabmo-waiting-store-${process.pid}`);

beforeAll(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  isolateDb();
});

afterAll(async () => {
  releaseDb();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  const db = await getDb();
  await db.run('DELETE FROM waiting_prompts');
});

const input = {
  pendingId: 'new-1700000000000',
  dependsOn: 'session-a',
  dependsOnTitle: 'Session A',
  prompt: 'summarise the diff',
  attachments: [{ id: 'a1', preview: '', name: 'notes.txt', type: 'text/plain', content: 'hello' }],
  model: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high', accessMode: 'yolo' },
  modes: { plan: true, goal: false },
  cwd: '/tmp/project',
  folderId: 3,
};

describe('waiting prompt store', () => {
  test('round-trips every field the dispatcher needs', async () => {
    const created = await createWaitingPrompt(input);
    expect(created.status).toBe('waiting');
    const stored = await getWaitingPrompt(created.id);
    expect(stored).toMatchObject({
      pendingId: 'new-1700000000000',
      dependsOn: 'session-a',
      dependsOnTitle: 'Session A',
      prompt: 'summarise the diff',
      cwd: '/tmp/project',
      folderId: 3,
      modes: { plan: true, goal: false },
    });
    expect(stored?.model).toEqual({
      provider: 'anthropic',
      modelId: 'claude',
      thinkingLevel: 'high',
      accessMode: 'yolo',
    });
    expect(stored?.attachments[0]?.content).toBe('hello');
  });

  test('the claim is won once, and only from `waiting`', async () => {
    const created = await createWaitingPrompt(input);
    expect(await claimWaitingPrompt(created.id)).toBe(true);
    expect(await claimWaitingPrompt(created.id)).toBe(false);
  });

  test('a requeued prompt can be claimed again', async () => {
    const created = await createWaitingPrompt(input);
    await claimWaitingPrompt(created.id);
    await requeueWaitingPrompt(created.id, 'omp did not start');
    const stored = await getWaitingPrompt(created.id);
    expect(stored?.status).toBe('waiting');
    expect(stored?.error).toBe('omp did not start');
    expect(await claimWaitingPrompt(created.id)).toBe(true);
  });

  test('a dispatch records the session it became', async () => {
    const created = await createWaitingPrompt(input);
    await claimWaitingPrompt(created.id);
    await markWaitingDispatched(created.id, 'omp-session-9');
    expect((await getWaitingPrompt(created.id))?.sessionId).toBe('omp-session-9');
  });

  // A claimed prompt that then failed to deliver is a FAILURE, not a delivery:
  // leaving it at `dispatched` would tell the client its prompt arrived.
  test('a claimed prompt can still be failed', async () => {
    const created = await createWaitingPrompt(input);
    await claimWaitingPrompt(created.id);
    await failWaitingPrompt(created.id, 'the child died');
    expect(await getWaitingPrompt(created.id)).toMatchObject({ status: 'error', error: 'the child died' });
  });

  test('cancel reaches only a prompt that has not been claimed', async () => {
    const created = await createWaitingPrompt(input);
    expect(await cancelWaitingPrompt(created.id)).toBe(true);
    expect((await getWaitingPrompt(created.id))?.status).toBe('cancelled');
    expect(await cancelWaitingPrompt(created.id)).toBe(false);

    const claimed = await createWaitingPrompt(input);
    await claimWaitingPrompt(claimed.id);
    expect(await cancelWaitingPrompt(claimed.id)).toBe(false);
    expect((await getWaitingPrompt(claimed.id))?.status).toBe('dispatched');
  });

  test('deleting a session fails everything waiting on it, by name', async () => {
    const first = await createWaitingPrompt(input);
    const second = await createWaitingPrompt({ ...input, dependsOn: 'session-b' });
    expect(await listWaitingOn('session-a')).toHaveLength(1);
    expect(await failWaitingOn('session-a', 'The session being waited for was deleted.')).toBe(1);
    expect(await getWaitingPrompt(first.id)).toMatchObject({
      status: 'error',
      error: 'The session being waited for was deleted.',
    });
    expect((await getWaitingPrompt(second.id))?.status).toBe('waiting');
  });

  test('the list carries waiting rows plus recent outcomes, and prunes the rest', async () => {
    const waiting = await createWaitingPrompt(input);
    const done = await createWaitingPrompt(input);
    await claimWaitingPrompt(done.id);
    await markWaitingDispatched(done.id, 'omp-1');

    const now = Date.now();
    expect((await listWaitingPrompts(now)).map((row) => row.id)).toContain(waiting.id);
    expect((await listWaitingPrompts(now)).map((row) => row.id)).toContain(done.id);

    // Past retention the terminal row goes; the waiting one stays, because it
    // has no outcome yet.
    expect(await pruneWaitingPrompts(now + WAITING_RETENTION_MS + 1)).toBe(1);
    const remaining = await listWaitingPrompts(now + WAITING_RETENTION_MS + 1);
    expect(remaining.map((row) => row.id)).toEqual([waiting.id]);
  });

  test('attempts are counted for the failure ceiling', async () => {
    const created = await createWaitingPrompt(input);
    expect(await countWaitingAttempt(created.id)).toBe(1);
    expect(await countWaitingAttempt(created.id)).toBe(2);
  });
});
