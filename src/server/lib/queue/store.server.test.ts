/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The follow-up queue is the one place where "exactly one consumer sends the
 * head" has to hold across tabs, reloads and racing nudges, so its row
 * decoding, ordering and claim behavior are the contract the delivery timer
 * depends on.
 *
 * The tests run against a throwaway SQLite file (never Kabmo database)
 * and pin: positions increase on append and are rewritten exactly by
 * `reorderQueue`; a claim returns the head in position order and deletes it so
 * the next claim cannot see it again; a failed delivery's requeue lands ahead
 * of everything still queued; and the model/attachment snapshot survives the
 * JSON round trip with the documented fallbacks for corrupt or missing values.
 * The last group pins the schema property the FK migration exists for: a queue
 * row may reference a session that has no `sessions` row at all.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@/server/db.server';
import {
  appendQueueItem,
  claimHeadQueueItem,
  deleteQueueItem,
  hasQueuedItem,
  listQueue,
  normalizeModel,
  patchQueueItem,
  requeueHeadQueueItem,
  reorderQueue,
  rowToQueuedMessage,
} from '@/server/lib/queue/store.server';
import { restoreStore } from '@/server/lib/queue/delivery-harness';
import type { QueuedMessage } from '@/shared/types/chat';
import { removeDir } from '@/test-support/remove-dir';

/**
 * `delivery-harness` registers a `mock.module` stand-in for this store for the
 * whole `bun test` run, and Bun imports every test file before running any of
 * them — so the three delivery functions this file asserts against can be
 * bound to that stand-in (which reads an in-memory map that is always empty)
 * no matter which file runs first. Putting the real module back first is what
 * makes the claim/append behavior here testable in either order.
 */
beforeAll(() => {
  restoreStore();
});

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  dirs.push(dir);
  return dir;
}

function useTempDb(): void {
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    session_id: 's1',
    position: 0,
    message: 'hello',
    attachments: '[]',
    provider: null,
    model_id: null,
    thinking_level: null,
    access_mode: null,
    ...over,
  };
}

afterEach(() => {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('row decoding', () => {
  test('normalizeModel rejects a model without a provider or id', () => {
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel('kenari')).toBeNull();
    expect(normalizeModel({})).toBeNull();
    expect(normalizeModel({ provider: 'kenari' })).toBeNull();
    expect(normalizeModel({ modelId: 'm1' })).toBeNull();
  });

  test('normalizeModel defaults the thinking level and refuses an unknown access mode', () => {
    expect(normalizeModel({ provider: 'kenari', modelId: 'm1' })).toEqual({
      provider: 'kenari',
      modelId: 'm1',
      thinkingLevel: 'auto',
      accessMode: 'always-ask',
    });
    expect(normalizeModel({ provider: 'k', modelId: 'm', thinkingLevel: 'max', accessMode: 'yolo' })).toEqual({
      provider: 'k',
      modelId: 'm',
      thinkingLevel: 'max',
      accessMode: 'yolo',
    });
    // A corrupted access mode must not reach the child as-is.
    expect(normalizeModel({ provider: 'k', modelId: 'm', accessMode: 'not-a-mode' })?.accessMode).toBe('always-ask');
  });

  test('rowToQueuedMessage tolerates corrupt attachments and missing model fields', () => {
    expect(rowToQueuedMessage(row()).attachments).toEqual([]);
    expect(rowToQueuedMessage(row({ attachments: 'not json' })).attachments).toEqual([]);
    expect(rowToQueuedMessage(row({ attachments: '{"not":"an array"}' })).attachments).toEqual([]);
    expect(JSON.parse(JSON.stringify(rowToQueuedMessage(row({ attachments: '[{"id":"a"}]' })).attachments))).toEqual([{ id: 'a' }]);
    // Half a model snapshot is no model at all.
    expect<unknown>(rowToQueuedMessage(row({ provider: 'kenari' })).model).toBeNull();
    expect(rowToQueuedMessage(row({ provider: 'k', model_id: 'm' })).model).toEqual({
      provider: 'k',
      modelId: 'm',
      thinkingLevel: 'auto',
      accessMode: 'always-ask',
    });
  });
});

describe('queue CRUD and ordering', () => {
  test('appendQueueItem appends in order and returns the canonical queue', async () => {
    useTempDb();
    await appendQueueItem('s1', { text: 'first' });
    await appendQueueItem('s1', { text: 'second' });
    const canonical = await appendQueueItem('s1', { text: 'third' });

    expect(canonical.map((item) => item.text)).toEqual(['first', 'second', 'third']);
    expect((await listQueue('s1')).map((item) => item.text)).toEqual(['first', 'second', 'third']);
    // Scoped to the session: another session's queue is untouched.
    expect(await listQueue('s2')).toEqual([]);
  });

  test('appendQueueItem snapshots the model and drops a malformed one', async () => {
    useTempDb();
    const [withModel] = await appendQueueItem('s1', {
      text: 'modeled',
      model: { provider: 'kenari', modelId: 'deepseek-v4-flash', thinkingLevel: 'max', accessMode: 'yolo' },
    });
    expect(withModel.model).toEqual({
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
      thinkingLevel: 'max',
      accessMode: 'yolo',
    });

    const items = await appendQueueItem('s1', { text: 'no model', model: { provider: 'kenari' } });
    expect(items[items.length - 1].model).toBeNull();
  });

  test('a non-array attachment payload is stored as an empty list', async () => {
    useTempDb();
    const [item] = await appendQueueItem('s1', { text: 'x', attachments: { not: 'an array' } });
    expect(item.attachments).toEqual([]);
  });

  test('patchQueueItem patches only what was given and reports an unknown id', async () => {
    useTempDb();
    const [first] = await appendQueueItem('s1', {
      text: 'original',
      model: { provider: 'kenari', modelId: 'm1' },
    });

    const textOnly = await patchQueueItem('s1', first.id, { text: 'edited' });
    expect(textOnly?.[0].text).toBe('edited');
    // A text-only patch must not wipe the model snapshot.
    expect(textOnly?.[0].model).toEqual({ provider: 'kenari', modelId: 'm1', thinkingLevel: 'auto', accessMode: 'always-ask' });

    const modelOnly = await patchQueueItem('s1', first.id, { model: null });
    expect(modelOnly?.[0].text).toBe('edited');
    expect(modelOnly?.[0].model).toBeNull();

    expect(await patchQueueItem('s1', 'unknown', { text: 'x' })).toBeNull();
    // An empty patch is a no-op that still returns the canonical queue.
    expect((await patchQueueItem('s1', first.id, {}))?.map((item) => item.id)).toEqual([first.id]);
  });

  test('deleteQueueItem reports whether the row was there', async () => {
    useTempDb();
    const [item] = await appendQueueItem('s1', { text: 'x' });
    expect(await deleteQueueItem('s1', item.id)).toBe(true);
    expect(await deleteQueueItem('s1', item.id)).toBe(false);
    expect(await listQueue('s1')).toEqual([]);
  });

  test('reorderQueue rewrites exactly the given ids and ignores unknown ones', async () => {
    useTempDb();
    const a = (await appendQueueItem('s1', { text: 'a' }))[0];
    const b = (await appendQueueItem('s1', { text: 'b' }))[1];
    const c = (await appendQueueItem('s1', { text: 'c' }))[2];

    expect((await reorderQueue('s1', [c.id, a.id, b.id])).map((item) => item.text)).toEqual(['c', 'a', 'b']);
    // An unknown id matches no row: it must not throw, and it must not drop the
    // rows it never named.
    const afterGhost = await reorderQueue('s1', [b.id, 'ghost']);
    expect(afterGhost).toHaveLength(3);
    expect(afterGhost[0].text).toBe('b');
    expect(afterGhost.map((item) => item.text).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('claim, requeue and presence', () => {
  test('claimHeadQueueItem returns the head, removes it, then returns the next', async () => {
    useTempDb();
    await appendQueueItem('s1', { text: 'first' });
    await appendQueueItem('s1', { text: 'second' });

    const head = await claimHeadQueueItem('s1');
    expect(head?.text).toBe('first');
    // The claim is a delete: a second claimant cannot observe it again.
    expect((await listQueue('s1')).map((item) => item.text)).toEqual(['second']);
    expect((await claimHeadQueueItem('s1'))?.text).toBe('second');
    expect(await claimHeadQueueItem('s1')).toBeNull();
  });

  test('a claim never touches another session queue', async () => {
    useTempDb();
    await appendQueueItem('s1', { text: 'mine' });
    await appendQueueItem('s2', { text: 'theirs' });

    expect((await claimHeadQueueItem('s2'))?.text).toBe('theirs');
    expect((await listQueue('s1')).map((item) => item.text)).toEqual(['mine']);
  });

  test('requeueHeadQueueItem puts a failed item back ahead of the queue', async () => {
    useTempDb();
    await appendQueueItem('s1', { text: 'first' });
    await appendQueueItem('s1', { text: 'second' });
    const failed = (await claimHeadQueueItem('s1')) as QueuedMessage;
    expect(failed.text).toBe('first');

    await requeueHeadQueueItem('s1', failed);
    expect((await listQueue('s1')).map((item) => item.text)).toEqual(['first', 'second']);
    expect((await claimHeadQueueItem('s1'))?.text).toBe('first');
  });

  test('hasQueuedItem reports presence without claiming', async () => {
    useTempDb();
    expect(await hasQueuedItem('s1')).toBe(false);
    await appendQueueItem('s1', { text: 'x' });
    expect(await hasQueuedItem('s1')).toBe(true);
    expect(await hasQueuedItem('s2')).toBe(false);
    // Presence check must leave the queue intact.
    expect((await listQueue('s1')).length).toBe(1);
  });
});

describe('session foreign key', () => {
  test('the migrated table carries no FK, so an omp session id inserts without a sessions row', async () => {
    useTempDb();
    const db = await getDb();
    const foreignKeys = await db.all('PRAGMA foreign_key_list(queued_messages)');
    expect(foreignKeys).toEqual([]);

    const queue = await appendQueueItem('11111111-2222-3333-4444-555555555555', { text: 'real session id' });
    expect(queue).toHaveLength(1);
  });
});
